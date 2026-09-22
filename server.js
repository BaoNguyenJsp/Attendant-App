'use strict';

const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const cfg = require('./config');
const { callAppsScript, makeProxy, warmCache, HttpError } = require('./lib/apps-script');
const { makeAuthz } = require('./lib/authz');
const registerOAuth = require('./routes/oauth');
const registerApi = require('./routes/api');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  
  app.use(cookieSession({
    name: 'session',
    secret: cfg.sessionSecret, 
    maxAge: 30 * 24 * 60 * 60 * 1000, 
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.SESSION_SECURE === '1',
  }));

  // ctx chia sẻ cho mọi route: gọi Apps Script, proxy chuẩn, phân quyền.
  const ctx = {
    call: callAppsScript,
    proxy: makeProxy(callAppsScript),
    authz: makeAuthz(),
  };

  registerOAuth(app, ctx);
  registerApi(app, ctx);

  app.use(express.static(path.join(__dirname, 'public')));
  app.use((err, req, res, next) => {
    const { send } = ctx.authz;
    if (err instanceof HttpError) return send(res, err.status, err.message);
    if (err.type === 'entity.too.large') return send(res, 413, 'File quá lớn.');
    console.error(err);
    send(res, 500, 'Lỗi máy chủ.');
  });

  return app;
}

if (process.argv.includes('--selfcheck')) {
  require('./selfcheck').run(createApp());
} else {
  createApp().listen(cfg.port, () => {
    console.log(`Sổ Thiếu Nhi chạy tại http://localhost:${cfg.port}`);
    warmCache();
  });
}