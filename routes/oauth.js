'use strict';

const { expandScope, computeTier, computeSectors } = require('../lib/authz');
const signal = require('../lib/auth-signal');

const oauth = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://www.googleapis.com/oauth2/v3/userinfo',
};

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

module.exports = function registerOAuth(app, ctx) {
  const { call, authz } = ctx;
  const { send } = authz;

  app.get('/auth/google', (c) => {
    const state = randomHex(16);
    const sess = c.get('session') || {};
    c.set('session', { ...sess, oauthState: state });
    const q = new URLSearchParams({
      client_id: c.env.OAUTH_CLIENT_ID,
      redirect_uri: c.env.OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    return c.redirect(`${oauth.authorize}?${q}`);
  });

  app.get('/auth/callback', async (c) => {
    try {
      const { code, state, error } = c.req.query();
      const sess = c.get('session') || {};
      if (error) return c.redirect('/login/?login=denied');
      if (!code || !state || state !== sess.oauthState) return send(c, 400, 'Phiên đăng nhập không hợp lệ.');

      const tok = await fetch(oauth.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: c.env.OAUTH_CLIENT_ID,
          client_secret: c.env.OAUTH_CLIENT_SECRET,
          redirect_uri: c.env.OAUTH_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });
      if (!tok.ok) return send(c, 502, 'Google không cấp token.');
      const { access_token } = await tok.json();

      const me = await fetch(oauth.userinfo, { headers: { Authorization: `Bearer ${access_token}` } });
      if (!me.ok) return send(c, 502, 'Không lấy được thông tin tài khoản.');
      const info = await me.json();
      if (!info.email || info.email_verified === false) return send(c, 401, 'Tài khoản Google không hợp lệ.');

      const data = await call('getSessionUser', { email: info.email });
      const s = data.session;
      const classes = s.classes || [];
      c.set('session', {
        email: s.email,
        fullName: s.fullName,
        groups: s.groups,
        scope: expandScope(s.groups, s.catalog, classes),
        tier: computeTier(s.groups),
        sectors: computeSectors(s.groups),
      });
      signal.clear(s.email);
      return c.redirect('/');
    } catch (e) {
      console.error('login callback failed:', e.message || e);
      const denied = e.status === 401;
      return c.redirect(denied ? '/login/?login=denied' : `/login/?login=error&msg=${encodeURIComponent(e.message || '')}`);
    }
  });

  app.get('/auth/logout', (c) => {
    c.set('session', null);
    return c.redirect('/login/');
  });
};
