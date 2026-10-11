// Google sign-in (UC-A1), sign-out (UC-A3) and the Drive connection (UC-M8).
import { AppError, fail } from '../lib/errors.js';
import { requireTier } from '../lib/access.js';
import { loadSession, isSessionValid } from '../lib/db/users.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
// Full Drive scope: the app writes into a root folder the owner created by hand.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

const randomHex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
const driveRedirect = (env) => new URL('/auth/drive/callback', env.OAUTH_REDIRECT_URI).href;

export function registerAuth(app, { fetch }) {
  // Sends the browser to Google; the random state is kept in the session cookie until the callback.
  function toGoogle(c, params) {
    const state = randomHex(16);
    c.set('session', { ...c.get('session'), oauthState: state });
    return c.redirect(`${AUTHORIZE_URL}?${new URLSearchParams({ client_id: c.env.OAUTH_CLIENT_ID, response_type: 'code', state, ...params })}`);
  }

  // Checks the state, then exchanges the code. The state is single use.
  async function exchange(c, redirectUri) {
    const { code, state } = c.req.query();
    const { oauthState, ...session } = c.get('session');
    c.set('session', session);
    if (!code || !state || state !== oauthState) fail(400, 'Phiên đăng nhập không hợp lệ.');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: c.env.OAUTH_CLIENT_ID, client_secret: c.env.OAUTH_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
    });
    if (!res.ok) fail(502, 'Google không cấp token.');
    return res.json();
  }

  app.get('/auth/google', (c) => toGoogle(c, { redirect_uri: c.env.OAUTH_REDIRECT_URI, scope: 'openid email profile' }));

  app.get('/auth/callback', async (c) => {
    if (c.req.query('error')) return c.redirect('/login/?login=denied');
    const { access_token: accessToken } = await exchange(c, c.env.OAUTH_REDIRECT_URI);
    try {
      const me = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!me.ok) fail(502, 'Không lấy được thông tin tài khoản.');
      const info = await me.json();
      if (!info.email || info.email_verified === false) fail(401, 'Tài khoản Google không hợp lệ.');
      c.set('session', await loadSession(c.env.DB, info.email));
      return c.redirect('/');
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      c.set('session', {});
      return c.redirect(`/login/?login=error&msg=${encodeURIComponent(e.message)}`);
    }
  });

  app.get('/auth/logout', (c) => {
    c.set('session', {});
    return c.redirect('/login/');
  });

  // UC-M8. These are page navigations outside /api, so they check the session themselves.
  const requireAdmin = async (c, next) => {
    const session = c.get('session');
    if (!session.userId || !(await isSessionValid(c.env.DB, session))) fail(401, 'Chưa đăng nhập.');
    requireTier(session, 'ADMIN');
    await next();
  };

  // prompt=consent makes Google return a refresh token every time, so connecting again replaces the connection.
  app.get('/auth/drive', requireAdmin, (c) => toGoogle(c, { redirect_uri: driveRedirect(c.env), scope: DRIVE_SCOPE, access_type: 'offline', prompt: 'consent' }));

  app.get('/auth/drive/callback', requireAdmin, async (c) => {
    if (c.req.query('error')) return c.redirect('/admin/?drive=error');
    const { refresh_token: refreshToken } = await exchange(c, driveRedirect(c.env));
    if (!refreshToken) return c.redirect('/admin/?drive=error');
    await c.env.DB.prepare("INSERT INTO Secrets (Key, Value) VALUES ('DriveRefreshToken', ?) ON CONFLICT (Key) DO UPDATE SET Value = excluded.Value").bind(refreshToken).run();
    return c.redirect('/admin/?drive=connected');
  });
}
