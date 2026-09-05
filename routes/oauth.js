'use strict';

const crypto = require('crypto');
const cfg = require('../config');
const { expandScope, computeTier, computeSectors } = require('../lib/authz');

const oauth = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://www.googleapis.com/oauth2/v3/userinfo',
};

module.exports = function registerOAuth(app, ctx) {
  const { call, authz } = ctx;
  const { send } = authz;

  app.get('/auth/google', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const q = new URLSearchParams({
      client_id: cfg.oauthClientId,
      redirect_uri: cfg.oauthRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    res.redirect(`${oauth.authorize}?${q}`);
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.redirect('/login/?login=denied');
      if (!code || !state || state !== req.session.oauthState) return send(res, 400, 'Phiên đăng nhập không hợp lệ.');
      delete req.session.oauthState;

      const tok = await fetch(oauth.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: cfg.oauthClientId, client_secret: cfg.oauthClientSecret,
          redirect_uri: cfg.oauthRedirectUri, grant_type: 'authorization_code',
        }),
      });
      if (!tok.ok) return send(res, 502, 'Google không cấp token.');
      const { access_token } = await tok.json();

      const me = await fetch(oauth.userinfo, { headers: { Authorization: `Bearer ${access_token}` } });
      if (!me.ok) return send(res, 502, 'Không lấy được thông tin tài khoản.');
      const info = await me.json();
      if (!info.email || info.email_verified === false) return send(res, 401, 'Tài khoản Google không hợp lệ.');

      // Đối chiếu Users + nhóm → session (FR-AUTH-02, FR-AUTH-05)
      const data = await call('getUser', { email: info.email });
      const s = data.session;
      const classes = s.classes || [];
      req.session.email = s.email;
      req.session.fullName = s.fullName;
      req.session.groups = s.groups;               // [{name, type}]
      req.session.scope = expandScope(s.groups, s.catalog, classes);
      req.session.tier = computeTier(s.groups);
      req.session.sectors = computeSectors(s.groups);
      res.redirect('/');
    } catch (e) {
      console.error('login callback failed:', e.message || e);
      const denied = e.status === 401;
      res.redirect(denied ? '/login/?login=denied' : `/login/?login=error&msg=${encodeURIComponent(e.message || '')}`);
    }
  });

  app.get('/auth/logout', (req, res) => { req.session = null; res.redirect('/login/'); });
};
