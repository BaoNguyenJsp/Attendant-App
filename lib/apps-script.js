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

// Ghi phải xếp hàng: mỗi lệnh ghi trong Apps Script đều lấy khoá script toàn cục
// (Code.gs LockService.waitLock), và mỗi lệnh ghi (vd saveAttendance) có thể đọc
// + ghi lại cả sheet. Vì GAS chạy tuần tự, gửi nhiều hơn 1 chỉ làm request thứ
// hai kẹt trong hàng đợi khoá của GAS và đốt hạn mức thực thi — nên cap = 1.
// Trả 503 nhanh cho phần vượt thay vì giữ request hàng chục giây.
const WRITE_MAX = +(process.env.GAS_WRITE_CONCURRENCY || 1);
const WRITE_WAIT_MS = +(process.env.GAS_WRITE_WAIT_MS || 10000);
let writeActive = 0;
const writeWaiters = [];

function releaseWrite() {
  const next = writeWaiters.shift();
  if (next) next();          // nhường slot cho người kế tiếp, không đổi số đếm
  else writeActive--;
}

// Trả về null nếu lấy được slot ngay; ngược lại trả Promise (chờ tới khi có slot
// hoặc hết WRITE_WAIT_MS thì ném 503).
function acquireWrite() {
  if (writeActive < WRITE_MAX) { writeActive++; return null; }
  return new Promise((resolve, reject) => {
    const entry = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      const i = writeWaiters.indexOf(entry);
      if (i >= 0) writeWaiters.splice(i, 1);
      reject(new HttpError(503, 'Hệ thống đang bận, vui lòng thử lại.'));
    }, WRITE_WAIT_MS);
    writeWaiters.push(entry);
  });
}

// Lùi theo hàm mũ + jitter. Nếu Google gửi Retry-After (429/503) thì ưu tiên nó.
function backoffMs(attempt, retryAfterMs) {
  if (retryAfterMs) return retryAfterMs;
  return Math.min(60000, 2000 * 2 ** (attempt - 1)) + Math.random() * 1000;
}

async function callAppsScript(action, body, maxRetries = 3) {
  // Trả thẳng từ bộ nhớ đệm nếu có (chỉ với read action hữu hạn key).
  if (cache.isCacheable(action)) {
    const hit = cache.get(action, body);
    if (hit) return hit;
  }

  const { token: _t, action: _a, ...rest } = body || {};
  const payload = JSON.stringify({ action, token: cfg.sharedToken, ...rest });

  const write = cache.isWrite(action);
  const snap = write ? takeSnapshot(action, body) : null;
  if (write) {
    const wait = acquireWrite();
    if (wait) await wait;
  }

  try {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let retryAfterMs = 0;
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
          // Google gửi Retry-After khi 429/503 — tôn trọng nó thay vì thử lại mù.
          retryAfterMs = (+resp.headers.get('retry-after') || 0) * 1000;
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
        patchCache(action, body, data, snap);
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
          await new Promise(r => setTimeout(r, backoffMs(attempt, retryAfterMs)));
        }
      }
    }

    throw new HttpError(502, `Kết nối với Google thất bại. Vui lòng thử lại. (${lastError.message})`);
  } finally {
    if (write) releaseWrite();
  }
}

// Mirrors GAS extractDriveFolderUrl — pure string transform, no API call.
function driveFolderUrl(urlStr) {
  if (!urlStr) return '';
  const first = String(urlStr).split(',')[0].trim();
  const m = first.match(/\/d\/([a-zA-Z0-9_-]+)/) || first.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? 'https://drive.google.com/file/d/' + m[1] + '/view' : first;
}

// Read the cache entries we'll need to merge into BEFORE invalidation wipes them.
function takeSnapshot(action, body) {
  switch (action) {
    case 'saveStudentPhoto':      return cache.get('getStudents', {});
    case 'saveStudentFull':       return cache.get('getStudents', {});
    case 'saveConfig':            return cache.get('getConfig', {});
    case 'saveClass':             return cache.get('getClasses', {});
    case 'saveStudentAttendance':        return cache.get('getStudentAttendance', { className: body.className });
    case 'saveTeacherAttendance': return cache.get('getTeacherAttendance', { sector: body.sector });
    case 'saveTeaching':          return cache.get('getTeaching', { schoolYear: body.schoolYear });
    case 'saveStudentScores':            return { all: cache.get('getStudentScores', {}), cls: cache.get('getStudentScores', { className: body.className }) };
    default:                      return null;
  }
}

// Logically update the cache from mutation data + pre-invalidation snapshot.
// Derived/aggregated keys (getClassAttendanceStats, getClassReport, getTeacherStats, etc.)
// are left invalidated — they re-fetch from GAS on next read.
function patchCache(action, body, data, snap) {
  switch (action) {
    case 'saveStudentPhoto': {
      if (!snap) break;
      const map = new Map(snap.students.map(s => [s.IdNumber, s]));
      const existing = map.get(body.idNumber);
      if (existing) map.set(body.idNumber, { ...existing, Photo: body.photo || '' });
      cache.set('getStudents', {}, { ...snap, students: [...map.values()] });
      break;
    }
    case 'saveStudentFull': {
      if (!snap) break;
      const map = new Map(snap.students.map(s => [s.IdNumber, s]));
      if (data.student) map.set(data.student.IdNumber, data.student);
      if (data.affected) data.affected.forEach(s => map.set(s.IdNumber, s));
      cache.set('getStudents', {}, { ...snap, students: [...map.values()] });
      break;
    }
    case 'saveHolidays':
      if (data.holidays) cache.set('getHolidays', {}, { status: 'ok', holidays: data.holidays });
      break;
    case 'saveConfig': {
      if (!snap) break;
      const updates = Object.fromEntries((body.config || []).map(i => [i.key, i.value]));
      cache.set('getConfig', {}, { ...snap, config: { ...snap.config, ...updates } });
      break;
    }
    case 'saveClass': {
      if (!snap) break;
      let found = false;
      const classes = snap.classes.map(c => {
        if (c.ClassName === body.oldClassName) { found = true; return { ClassName: body.className, Grade: body.grade }; }
        return c;
      });
      if (!found) classes.push({ ClassName: body.className, Grade: body.grade });
      cache.set('getClasses', {}, { ...snap, classes });
      break;
    }
    case 'saveStudentAttendance': {
      if (!snap) break;
      const others = (snap.records || []).filter(r => String(r.WeekOf) !== String(body.weekOf));
      const newRecs = (body.records || []).map(r => ({ WeekOf: body.weekOf, idNumber: r.idNumber, sessions: r.sessions }));
      cache.set('getStudentAttendance', { className: body.className }, { ...snap, records: [...others, ...newRecs] });
      break;
    }
    case 'saveTeacherAttendance': {
      if (!snap) break;
      const others = (snap.records || []).filter(r => String(r.WeekOf) !== String(body.weekOf));
      const newRecs = (body.records || []).map(r => ({ WeekOf: body.weekOf, email: String(r.email).toLowerCase(), sessions: r.sessions }));
      cache.set('getTeacherAttendance', { sector: body.sector }, { ...snap, records: [...others, ...newRecs] });
      break;
    }
    case 'saveTeaching': {
      if (!snap || !data.record) break;
      const rec = data.record;
      const enriched = { ...rec, LessonFolderUrl: driveFolderUrl(rec.LessonPlanUrl), RevisedFolderUrl: driveFolderUrl(rec.RevisedPlanUrl) };
      const others = (snap.records || []).filter(t => !(t.ClassName === rec.ClassName && t.WeekOf === rec.WeekOf));
      cache.set('getTeaching', { schoolYear: body.schoolYear }, { ...snap, records: [...others, enriched], total: others.length + 1 });
      break;
    }
    case 'saveStudentScores': {
      if (!snap) break;
      const newScores = (data.students || []).map(s => ({
        IdNumber: s.idNumber, ClassName: body.className,
        Quiz15_S1: s.quiz15s1 || '', Exam_S1: s.exams1 || '',
        Quiz15_S2: s.quiz15s2 || '', Exam_S2: s.exams2 || '',
      }));
      if (snap.all) {
        const others = (snap.all.scores || []).filter(s => s.ClassName !== body.className);
        cache.set('getStudentScores', {}, { ...snap.all, scores: [...others, ...newScores] });
      }
      if (snap.cls) cache.set('getStudentScores', { className: body.className }, { ...snap.cls, scores: newScores });
      break;
    }
  }
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
      // Wave 1: shape data needed to enumerate per-class and per-sector actions
      const [classesRes, configRes, teachersRes] = await Promise.all([
        safe(callAppsScript('getClasses', {}), 'getClasses'),
        safe(callAppsScript('getConfig', {}), 'getConfig'),
        safe(callAppsScript('getTeachers', {}), 'getTeachers'),
      ]);

      const classes = (classesRes && classesRes.classes) || [];
      const classNames = classes.map(c => c.ClassName || c.className).filter(Boolean);
      const schoolYear = configRes && configRes.config && configRes.config.CurrentSchoolYear;
      const groups = (teachersRes && teachersRes.groups) || [];
      const sectors = groups.filter(g => g.Type === 'Ngành').map(g => g.GroupName);

      // Wave 2: all remaining cacheable actions in parallel
      await Promise.all([
        safe(callAppsScript('getStudents', {}), 'getStudents'),
        safe(callAppsScript('getHolidays', {}), 'getHolidays'),
        safe(callAppsScript('getYearOptions', {}), 'getYearOptions'),
        safe(callAppsScript('getStudentScores', {}), 'getStudentScores'),
        schoolYear ? safe(callAppsScript('getTeaching', { schoolYear }), 'getTeaching') : null,
        ...classNames.map(cn => safe(callAppsScript('getStudentAttendance', { className: cn }), `getAttendance(${cn})`)),
        ...classNames.map(cn => safe(callAppsScript('getClassAttendanceStats', { className: cn }), `getClassAttendanceStats(${cn})`)),
        ...(schoolYear ? classNames.map(cn => safe(callAppsScript('getClassReport', { schoolYear, className: cn }), `getClassReport(${cn})`)) : []),
        ...sectors.map(s => safe(callAppsScript('getTeacherAttendance', { sector: s }), `getTeacherAttendance(${s})`)),
        ...sectors.map(s => safe(callAppsScript('getTeacherStats', { sector: s }), `getTeacherStats(${s})`)),
        ...sectors.map(s => safe(callAppsScript('getTeacherAbsences', { sector: s }), `getTeacherAbsences(${s})`)),
      ].filter(Boolean));

      console.log(`[cache] Warm-up complete (${classNames.length} classes, ${sectors.length} sectors)`);
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

/* ---------- Self-check ---------- */
if (require.main === module) {
  const assert = require('assert');
  (async () => {
    // Đầy cap thì request kế tiếp phải chờ, và khi có slot thì nhận được.
    for (let i = 0; i < WRITE_MAX; i++) assert.strictEqual(acquireWrite(), null);
    let acquired = false;
    const p = acquireWrite();
    assert.ok(p instanceof Promise, 'vượt cap phải chờ');
    p.then(() => { acquired = true; });

    releaseWrite();                 // nhường slot cho người đang chờ
    await Promise.resolve();
    assert.strictEqual(acquired, true, 'người chờ phải nhận được slot');
    assert.strictEqual(writeActive, WRITE_MAX, 'nhường slot phải giữ nguyên số đếm');

    for (let i = 0; i < WRITE_MAX; i++) releaseWrite();
    assert.strictEqual(writeActive, 0, 'phải trả hết slot');

    console.log(`apps-script self-check OK (cap=${WRITE_MAX})`);
  })().catch((e) => { console.error(e); process.exit(1); });
}