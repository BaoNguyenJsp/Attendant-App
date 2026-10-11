// src/session.js
const COOKIE = 'sess';
const OPTS = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'; // 30 days

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export async function readSession(request, secret) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return {};
  try {
    const [payload, sig] = m[1].split('.');
    if (!sig || sig !== await hmac(payload, secret)) return {};
    return JSON.parse(decodeURIComponent(atob(payload)));
  } catch { return {}; }
}

export async function makeSessionCookie(session, secret) {
  if (!session || Object.keys(session).length === 0)
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const payload = btoa(encodeURIComponent(JSON.stringify(session)));
  const sig = await hmac(payload, secret);
  return `${COOKIE}=${payload}.${sig}; ${OPTS}`;
}
