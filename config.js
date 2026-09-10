'use strict';

// Cấu hình từ biến môi trường (có mặc định dev để chạy local).
const cfg = {
  port: +process.env.PORT || 3000,
  oauthClientId: process.env.OAUTH_CLIENT_ID || '406754557714-nje05ja79vh24e0pvaflsrd9l9huc3tq.apps.googleusercontent.com',
  oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || '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',
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/auth/callback',
  sessionSecret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  appsScriptUrl: process.env.APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbwI2qR93N_Zy0XdCmKDuinhWUgnX0I8Q5Wn6-jmbPxJo9DF8GS7AYGvbD56ReFbE6ZHcw/exec',
  sharedToken: process.env.SHARED_TOKEN || 'dev-shared-token'
};

module.exports = cfg;

