'use strict';

// Cấu hình từ biến môi trường (có mặc định dev để chạy local).
const cfg = {
  port: +process.env.PORT || 3000,
  oauthClientId: process.env.OAUTH_CLIENT_ID || '406754557714-mfo0spn6jc8b9bvkh8b34gcv9ot2m3g9.apps.googleusercontent.com',
  oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || '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',
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback',
  sessionSecret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  appsScriptUrl: process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbzU3JlxkBt_kGmyHOn6W9BIap6O6h_E7GwZXyQuFBZlwy2c4wi40--XzUKkaTSD3tyXmg/exec',
  sharedToken: process.env.SHARED_TOKEN || 'dev-shared-token'
};

module.exports = cfg;
