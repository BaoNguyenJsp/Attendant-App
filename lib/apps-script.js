'use strict';

const cfg = require('../config');
const cache = require('./cache');
const signal = require('./auth-signal');
const { Agent } = require('undici');

// Giữ kết nối 10 giây, tối đa 20 kết nối cùng lúc
const keepAliveDispatcher = new Agent({
  keepAliveTimeout: 10000,
  keepAliveMaxTimeout: 10000,
  connections: 20
});

class HttpError extends Error {
  constructor(status, message) { 
    super(message); 
    this.status = status; 
  }
}

async function callAppsScript(action, body, maxRetries = 3) {
  // Trả thẳng từ bộ nhớ đệm nếu có (chỉ với read action hữu hạn key).
  if (cache.isCacheable(action)) {
    const hit = cache.get(action, body);
    if (hit) return hit;
  }

  const { token: _t, action: _a, ...rest } = body || {};
  const payload = JSON.stringify({ action, token: cfg.sharedToken, ...rest });

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(cfg.appsScriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: payload,
        redirect: 'follow',
        dispatcher: keepAliveDispatcher,
        // Ép Node.js cắt đứt kết nối nếu Google "im lặng" quá 15 giây
        signal: AbortSignal.timeout(15000) 
      });

      if (!resp.ok) {
        await resp.text().catch(() => ''); 
        console.warn(`[apps-script] ${action} (Lần ${attempt}/${maxRetries}) Lỗi HTTP ${resp.status}`);
        throw new Error(`HTTP ${resp.status}`); 
      }

      const txt = await resp.text();
      let data;
      
      try { 
        data = JSON.parse(txt); 
      } catch (e) { 
        console.warn(`[apps-script] ${action} (Lần ${attempt}/${maxRetries}) Lỗi Parse JSON. Raw:`, txt.slice(0, 150).replace(/\n/g, ' '));
        throw new Error('Dữ liệu trả về không hợp lệ.');
      }

      if (data.status === 'error') {
        throw new HttpError(400, data.message || 'Lỗi xử lý từ Apps Script.');
      }

      // Thành công: lưu read action vào đệm, xoá dữ liệu liên quan sau khi ghi.
      if (cache.isCacheable(action)) cache.set(action, body, data);
      cache.invalidate(action);
      // Ghi đổi nhóm/người dùng → buộc người liên quan đăng nhập lại.
      signal.record(action, body);

      return data;

    } catch (error) {
      lastError = error;

      if (error instanceof HttpError) {
        throw error;
      }

      // Xử lý riêng lỗi Timeout (Google treo)
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        console.warn(`[apps-script] ${action} (Lần ${attempt}/${maxRetries}) Google treo quá 15s. Đang ép Retry...`);
      }

      if (attempt < maxRetries) {
        // Nghỉ 1s ở lần 1, 2s ở lần 2 trước khi gọi lại
        const delayMs = attempt * 1000;
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  throw new HttpError(502, `Kết nối với Google thất bại. Vui lòng thử lại. (${lastError.message})`);
}

// Nạp sẵn dữ liệu đọc vào bộ nhớ đệm. Lỗi từng mục không làm sập warm-up;
// request thật sau đó sẽ tự nạp lại. warm-up đang chạy thì trả về chính nó
// (tránh bấm nút liên tục dội nhiều đợt gọi Apps Script).
let warming = null;
function warmCache() {
  if (warming) return warming;
  const safe = (p, label) => p.catch((e) => { console.warn(`[cache] ${label} failed: ${e.message}`); return null; });

  const run = (async () => {
    try {
      const [classesRes, configRes] = await Promise.all([
        safe(callAppsScript('getClasses', {}), 'getClasses'),
        safe(callAppsScript('getConfig', {}), 'getConfig'),
      ]);

      const classes = (classesRes && classesRes.classes) || [];
      const schoolYear = configRes && configRes.config && configRes.config.CurrentSchoolYear;

      await Promise.all([
        safe(callAppsScript('getStudents', {}), 'getStudents'),
        safe(callAppsScript('getHolidays', {}), 'getHolidays'),
        safe(callAppsScript('getTeachers', {}), 'getTeachers'),
        safe(callAppsScript('getYearOptions', {}), 'getYearOptions'),
        schoolYear ? safe(callAppsScript('getScores', { schoolYear }), 'getScores') : null,
        schoolYear ? safe(callAppsScript('getTeaching', { schoolYear }), 'getTeaching') : null,
      ].filter(Boolean));

      if (classes.length && schoolYear) {
        await Promise.all(classes.map((c) => {
          const className = c.ClassName || c.className;
          return safe(callAppsScript('getAttendance', { schoolYear, className }), `getAttendance(${className})`);
        }));
      }

      console.log(`[cache] Warm-up complete (${classes.length} classes)`);
    } catch (e) {
      console.warn('[cache] Warm-up error (non-fatal):', e.message);
    }
  })();

  warming = run;
  run.finally(() => { if (warming === run) warming = null; });
  return run;
}

function makeProxy(call) {
  return (action) => async (req, res, next) => {
    try { res.json(await call(action, req.body || {})); }
    catch (e) { next(e); }
  };
}

module.exports = { callAppsScript, makeProxy, warmCache, HttpError };