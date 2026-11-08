import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, cookieFor } from './helpers/env.mjs';
import { createApp } from '../src/app.js';
import { readSession } from '../src/session.js';
import worker from '../src/worker.js';

// A stand-in for Google: one account, one refresh token.
function fakeGoogle({ email = 'teacher08@example.com', verified = true, refreshToken = 'refresh-1' } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), body: String(init.body ?? '') });
    if (String(url).includes('/token')) return Response.json({ access_token: 'access-1', ...(refreshToken ? { refresh_token: refreshToken } : {}) });
    if (String(url).includes('/userinfo')) return Response.json({ email, email_verified: verified });
    return new Response('', { status: 404 });
  };
  return { fetch, calls };
}

const cookieOf = (res) => res.headers.get('Set-Cookie').split(';')[0];
const sessionOf = (res, env) => readSession(new Request('https://app.example/', { headers: { Cookie: cookieOf(res) } }), env.SESSION_SECRET);

// Runs /auth/<start> then its callback, like the browser does.
async function roundTrip(app, env, start, callback, { cookie, state } = {}) {
  const first = await app.request(start, { headers: cookie ? { Cookie: cookie } : {} }, env);
  if (first.status !== 302 || !first.headers.get('Location').startsWith('https://accounts.google.com/')) return { first };
  const sent = new URL(first.headers.get('Location')).searchParams;
  const second = await app.request(`${callback}?code=abc&state=${state ?? sent.get('state')}`, { headers: { Cookie: cookieOf(first) } }, env);
  return { first, sent, second };
}

test('sign-in: Google account listed and active -> session and launcher', async () => {
  const env = await testEnv();
  const google = fakeGoogle();
  const { app } = createApp({ fetch: google.fetch });
  const { sent, second } = await roundTrip(app, env, '/auth/google', '/auth/callback');
  assert.deepEqual([sent.get('client_id'), sent.get('redirect_uri'), sent.get('scope')], ['client-id', 'https://app.example/auth/callback', 'openid email profile']);
  assert.deepEqual([second.status, second.headers.get('Location')], [302, '/']);
  const session = await sessionOf(second, env);
  assert.deepEqual([session.userId, session.tier, session.classIds, session.oauthState], [13, 'CLASS', [1], undefined]);
  // the cookie works on the API
  const api = await app.request('/api/getSession', { method: 'POST', headers: { Cookie: cookieOf(second) } }, env);
  assert.equal(api.status, 200);
});

test('sign-in is refused for an unknown, locked or unverified account and for a wrong state', async () => {
  const env = await testEnv();
  const denied = async (google, options) => {
    const { second } = await roundTrip(createApp({ fetch: google.fetch }).app, env, '/auth/google', '/auth/callback', options);
    assert.equal((await sessionOf(second, env)).userId, undefined);
    return second;
  };
  const unknown = await denied(fakeGoogle({ email: 'nobody@example.com' }));
  assert.match(decodeURIComponent(unknown.headers.get('Location')), /^\/login\/\?login=error&msg=Email nobody@example\.com chưa được cấp quyền/);
  await env.DB.prepare("UPDATE Users SET Status = 'INACTIVE' WHERE Id = 13").run();
  assert.match(decodeURIComponent((await denied(fakeGoogle())).headers.get('Location')), /Tài khoản đã bị khóa/);
  assert.match(decodeURIComponent((await denied(fakeGoogle({ email: 'doruoora@gmail.com', verified: false }))).headers.get('Location')), /login=error/);

  const google = fakeGoogle({ email: 'doruoora@gmail.com' });
  const wrong = await denied(google, { state: 'forged' });
  assert.equal(wrong.status, 400);
  assert.equal(google.calls.length, 0); // Google is not even asked
});

test('the user cancelling at Google goes back to the login page', async () => {
  const env = await testEnv();
  const { app } = createApp({ fetch: fakeGoogle().fetch });
  const res = await app.request('/auth/callback?error=access_denied', {}, env);
  assert.deepEqual([res.status, res.headers.get('Location')], [302, '/login/?login=denied']);
});

test('sign-out clears the cookie', async () => {
  const env = await testEnv();
  const { app } = createApp();
  const res = await app.request('/auth/logout', { headers: { Cookie: await cookieFor(env, 'doruoora@gmail.com') } }, env);
  assert.deepEqual([res.status, res.headers.get('Location')], [302, '/login/']);
  assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('Drive connection: admin only; the refresh token is stored and replaced', async () => {
  const env = await testEnv();
  const google = fakeGoogle();
  const { app } = createApp({ fetch: google.fetch });
  const token = () => env.DB.prepare("SELECT Value FROM Secrets WHERE Key = 'DriveRefreshToken'").first('Value');

  const teacher = await app.request('/auth/drive', { headers: { Cookie: await cookieFor(env, 'teacher08@example.com') } }, env);
  assert.equal(teacher.status, 403);
  assert.equal((await app.request('/auth/drive', {}, env)).status, 401);

  const admin = await cookieFor(env, 'doruoora@gmail.com');
  const { sent, second } = await roundTrip(app, env, '/auth/drive', '/auth/drive/callback', { cookie: admin });
  assert.deepEqual([sent.get('redirect_uri'), sent.get('access_type'), sent.get('prompt'), sent.get('scope')],
    ['https://app.example/auth/drive/callback', 'offline', 'consent', 'https://www.googleapis.com/auth/drive']);
  assert.deepEqual([second.status, second.headers.get('Location')], [302, '/admin/?drive=connected']);
  assert.equal(await token(), 'refresh-1');
  assert.equal((await sessionOf(second, env)).userId, 1); // still signed in

  const again = createApp({ fetch: fakeGoogle({ refreshToken: 'refresh-2' }).fetch }).app;
  await roundTrip(again, env, '/auth/drive', '/auth/drive/callback', { cookie: admin });
  assert.equal(await token(), 'refresh-2');
});

test('Drive connection keeps the old token when Google gives none or the state is wrong', async () => {
  const env = await testEnv();
  await env.DB.prepare("INSERT INTO Secrets (Key, Value) VALUES ('DriveRefreshToken', 'old')").run();
  const token = () => env.DB.prepare("SELECT Value FROM Secrets WHERE Key = 'DriveRefreshToken'").first('Value');
  const admin = await cookieFor(env, 'doruoora@gmail.com');

  const none = await roundTrip(createApp({ fetch: fakeGoogle({ refreshToken: null }).fetch }).app, env, '/auth/drive', '/auth/drive/callback', { cookie: admin });
  assert.equal(none.second.headers.get('Location'), '/admin/?drive=error');
  const forged = await roundTrip(createApp({ fetch: fakeGoogle({ refreshToken: 'evil' }).fetch }).app, env, '/auth/drive', '/auth/drive/callback', { cookie: admin, state: 'forged' });
  assert.equal(forged.second.status, 400);
  assert.equal(await token(), 'old');
});

test('the hourly job empties the Drive trash queue and survives a Drive that is not connected', async () => {
  const env = await testEnv();
  await env.DB.exec("INSERT INTO DriveTrash (FileId) VALUES ('F1')");
  let pending;
  await worker.scheduled({}, env, { waitUntil: (p) => { pending = p; } });
  await pending; // not connected: logged, not thrown
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM DriveTrash').first('n'), 1);
});

test('the session cookie is marked Secure on https, and not on http where local dev runs', async () => {
  const env = await testEnv();
  const { app } = createApp();
  const headers = { Cookie: await cookieFor(env, 'doruoora@gmail.com') };
  const secure = await app.request('https://app.example/api/getSession', { method: 'POST', headers }, env);
  assert.match(secure.headers.get('Set-Cookie'), /; Secure$/);
  const local = await app.request('http://localhost:8787/api/getSession', { method: 'POST', headers }, env);
  assert.doesNotMatch(local.headers.get('Set-Cookie'), /Secure/);
});
