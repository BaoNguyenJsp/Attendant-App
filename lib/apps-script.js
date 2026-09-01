'use strict';

// Lớp gọi Apps Script (dịch vụ lưu trữ). Mọi /api/* proxy qua đây.

const cfg = require('../config');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function callAppsScript(action, body) {
  const { token: _t, action: _a, ...rest } = body || {};
  const resp = await fetch(cfg.appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: cfg.sharedToken, ...rest }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.error(`[apps-script] ${action} → ${cfg.appsScriptUrl} HTTP ${resp.status}:`, txt.slice(0, 300));
    const hint = resp.status === 401 ? ' — kiểm tra deployment Apps Script (Execute as: Me, Anyone with link) và URL /exec (không phải /dev)' : '';
    throw new HttpError(502, `Apps Script lỗi HTTP ${resp.status}${hint}`);
  }
  let data;
  try { data = JSON.parse(await resp.text()); }
  catch { throw new HttpError(502, 'Apps Script trả về dữ liệu không hợp lệ.'); }
  if (data.status === 'error') {
    console.error(`[apps-script] ${action} → ${cfg.appsScriptUrl} LỖI:`, String(data.message || '').slice(0, 300));
    throw new HttpError(502, data.message || 'Lỗi Apps Script.');
  }
  return data;
}

// Handler chuẩn cho route: proxy(body) → Apps Script, lỗi đi qua error middleware.
function makeProxy(call) {
  return (action) => async (req, res, next) => {
    try { res.json(await call(action, req.body || {})); }
    catch (e) { next(e); }
  };
}

module.exports = { callAppsScript, makeProxy, HttpError };
