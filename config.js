'use strict';

// Cấu hình từ biến môi trường (có mặc định dev để chạy local).
const cfg = {
  port: +process.env.PORT || 3000,
  oauthClientId: process.env.OAUTH_CLIENT_ID || '193461300791-gjfv9287ek3olbrdbvatthtqjnrn7g00.apps.googleusercontent.com',
  oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || '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',
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback',
  sessionSecret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  appsScriptUrl: process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycby_ZB6qniwHNEtLUgVqV8BPrgngF42gQB85ynUkHVifS9V3YGKuGMND3sI6B0wbgq93nw/exec',
  sharedToken: process.env.SHARED_TOKEN || '1LMUep-A-iOIXFM-Uu58LOvslW1mp4faAUljZpdwnSsA'
};

module.exports = cfg;