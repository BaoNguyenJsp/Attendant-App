/**
 * Sổ Thiếu Nhi — Apps Script dịch vụ lưu trữ (web app, chỉ doPost)
 *
 * DEPLOY: web app "Execute as: Me" + "Anyone with link". KHÔNG có doGet — Node
 * (server.js) phục vụ HTML; trình duyệt không bao giờ gọi thẳng đây. doPost từ
 * chối mọi request thiếu đúng SHARED_TOKEN (script property). Không phân quyền
 * tại đây — Node là lớp chặn chính, Apps Script chỉ đọc/ghi Sheet + Drive.
 *
 * Script properties:
 *   SPREADSHEET_ID — id Google Sheet dữ liệu (12 tab, schema GOOGLE-SHEET-DESIGN.md)
 *   SHARED_TOKEN   — token chung, phải khớp config.js của Node
 *   (folder giáo án nằm trong Config tab → khóa DriveFolderId)
 *
 * 12 tab + cột (tự tạo khi thiếu):
 *   Users             Email | SaintName | FullName | Status | Id
 *   Groups            GroupName | Type | Scope | Description
 *   GroupMembers      GroupName | Email
 *   Classes           ClassName | Grade
 *   Students          IdNumber | SaintName | FullName | DateOfBirth | Gender | Father | Mother | CurrentClass | EnrollYear | Status | Note
 *   Attendance        SchoolYear | WeekOf | Session | IdNumber | ClassName | AttendanceStatus | Note
 *   TeacherAttendance SchoolYear | WeekOf | Session | TeacherEmail | Status | Note
 *   Teaching          SchoolYear | WeekOf | ClassName | TeacherEmail | LessonContent | LessonPlanUrl | LessonPlanNames | RevisedPlanUrl | RevisedPlanNames | UpdatedBy
 *   Scores            SchoolYear | IdNumber | ClassName | Quiz15_S1 | Exam_S1 | Quiz15_S2 | Exam_S2
 *   Config            Key | Value          (CurrentSchoolYear, DriveFolderId)
 *   Holidays          SchoolYear | WeekOf | Session | Reason   (Session rỗng = nghỉ cả tuần)
 *   AcademicYear      SchoolYear | IdNumber | ClassName | HK1Score | HK2Score | YearScore | YearAttendant | Status
 */

const TAB_HEADERS = {
  Users:             ['Email', 'SaintName', 'FullName', 'Status', 'Id', 'SDT'],
  Groups:            ['GroupName', 'Type', 'Scope', 'Description'],
  GroupMembers:      ['GroupName', 'Email'],
  Classes:           ['ClassName', 'Grade'],
  Students:          ['IdNumber', 'SaintName', 'FullName', 'DateOfBirth', 'Gender', 'Father', 'Mother', 'CurrentClass', 'EnrollYear', 'Status', 'Note'],
  Attendance:        ['SchoolYear', 'WeekOf', 'Session', 'IdNumber', 'ClassName', 'AttendanceStatus', 'Note'],
  TeacherAttendance: ['SchoolYear', 'WeekOf', 'Session', 'TeacherEmail', 'Status', 'Note'],
  Teaching:          ['SchoolYear', 'WeekOf', 'ClassName', 'TeacherEmail', 'LessonContent', 'LessonPlanUrl', 'LessonPlanNames', 'RevisedPlanUrl', 'RevisedPlanNames', 'UpdatedBy'],
  Scores:            ['SchoolYear', 'IdNumber', 'ClassName', 'Quiz15_S1', 'Exam_S1', 'Quiz15_S2', 'Exam_S2'],
  Config:            ['Key', 'Value'],
  Holidays:          ['SchoolYear', 'WeekOf', 'Session', 'Reason'],
  AcademicYear:      ['SchoolYear', 'IdNumber', 'ClassName', 'HK1Score', 'HK2Score', 'YearScore', 'YearAttendant', 'Status'],
};

const SESSIONS = ['Lễ Chúa Nhật', 'Học Giáo Lý', 'Chầu Thánh Thể', 'Lễ Thứ Năm'];
const TEACHER_SESSIONS = [...SESSIONS, 'Họp Huynh Trưởng'];
// Giá trị sector 'Xứ đoàn' ở trang giaovien = lọc thành viên nhóm Type='Quản trị' (BCH Xứ đoàn).
const XUDOAN = '__Xudoan__';
const CACHE_TTL = 300;

/* ---------- HTTP entry: chỉ doPost, cửa chính là SHARED_TOKEN ---------- */
function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out({ status: 'error', message: 'Body không hợp lệ.' }); }
  if (b.token !== PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN'))
    return out({ status: 'error', message: 'Token không hợp lệ.' });
  const fn = ACTIONS[b.action];
  if (!fn) return out({ status: 'error', message: 'Unknown action: ' + b.action });
  try { return out(fn(b)); }
  catch (err) { return out({ status: 'error', message: String(err) }); }
}
function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- helpers: đọc cả sheet 1 lần (tự tạo tab thiếu) ---------- */
function ss() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')); }

// WeekOf có thể là ô định dạng Ngày → trả về Date thay vì "YYYY-MM-DD",
// làm hỏng so sánh chuỗi với weekOf frontend gửi. Chuẩn hóa về văn bản khi đọc.
// Restores Apps Script timezone accuracy while preventing 1899 Invalid Date loops
const fmtDate = d => {
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
};

// CCCD dạng "001234" khi nhập bằng Excel bị mất số 0 đầu → nén về số thuần để khớp.
const normId = s => String(s ?? '').replace(/^['0]+/, '').trim();

// Id (Users) là số nguyên — người dùng có thể nhập tay sai kiểu, quy về số (0 nếu rỗng/hỏng).
const numId = v => { const n = +v; return Number.isFinite(n) ? n : 0; };

// Normalizes text to ensure students aren't accidentally filtered out
function activeStudents(className) {
  const targetClass = String(className).normalize('NFC').trim();
  return cachedRead('Students').filter(s => 
    String(s.CurrentClass).normalize('NFC').trim() === targetClass && 
    String(s.Status).normalize('NFC').trim().toLowerCase() === 'hoạt động'
  ).sort((a, b) => genderRank(a.Gender) - genderRank(b.Gender));
}

// Roster order: Nữ trước, Nam sau, còn lại (trống/khác) cuối.
function genderRank(v) {
  const g = String(v ?? '').normalize('NFC').trim().toLowerCase();
  return g === 'nữ' ? 0 : g === 'nam' ? 1 : 2;
}
function rowObj(head, r) {
  const o = {};
  head.forEach((h, i) => {
    let val = r[i];
    if (val instanceof Date) {
      o[h] = fmtDate(val);
    } else if (h === 'IdNumber' || h === 'SchoolYear' || h === 'ClassName') {
      o[h] = String(val).trim(); 
    } else if (typeof val === 'string') {
      o[h] = val.trim(); 
    } else {
      o[h] = val;
    }
  });
  return o;
}

// Cột thiếu vì schema mở rộng sau khi tab đã tồn tại → chèn đúng vị trí schema
// (insertColumns dịch dữ liệu phải sang, giữ các cột sau — vd thêm HK1Score/HK2Score
// trước YearScore). Idempotent: header đủ rồi thì bỏ qua; cột đã có thì không nhân bản.
function ensureHeader(name) {
  const want = TAB_HEADERS[name];
  if (!want) return false;
  const sh = ss().getSheetByName(name);
  if (!sh) return false;
  const cur0 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(c => String(c ?? ''));
  if (want.every(h => cur0.includes(h))) return false;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let changed = false;
  try {
    const cur = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(c => String(c ?? ''));
    for (let i = 0; i < want.length; i++) {
      if (cur[i] === want[i] || cur.includes(want[i])) continue; // đã đúng vị trí / đã tồn tại
      sh.insertColumns(i + 1);
      sh.getRange(1, i + 1).setValue(want[i]);
      cur.splice(i, 0, want[i]);
      changed = true;
    }
  } finally { lock.releaseLock(); }
  return changed;
}

function readAll(name) {
  let sh = ss().getSheetByName(name);
  if (!sh) {
    const h = TAB_HEADERS[name];
    if (!h) throw new Error('Missing tab: ' + name);
    sh = ss().insertSheet(name);
    sh.getRange(1, 1, 1, h.length).setValues([h]);
  }
  ensureHeader(name);
  const values = sh.getDataRange().getValues();
  const head = values.shift();
  if (name === 'Users' && values.some(r => String(r[0]) !== '' && !String(r[TAB_HEADERS.Users.indexOf('Id')] ?? '').trim())) {
    backfillUsersId();
    return readAll(name); // backfill lấp hết ô trống → lần sau không rơi vào vòng lặp
  }
  return values.filter(r => String(r[0]) !== '').map(r => rowObj(head, r));
}

// Users thêm tay (Email/Họ tên, bỏ trống Id) → cấp số tự động = max hiện có + 1, tăng dần.
// Idempotent: hết ô trống thì bỏ qua không lock. Lock + re-đọc để 2 request song song không trùng số.
// Ghi theo từng ô (sheet row thật) — an toàn kể cả khi có dòng Email trống nằm xen (sheet sửa tay).
function backfillUsersId() {
  const sh = ss().getSheetByName('Users');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(c => String(c ?? ''));
  const ci = head.indexOf('Id');
  if (ci < 0) return;
  const data = sh.getDataRange().getValues().slice(1);
  const dirty = data.some(r => String(r[0]) !== '' && !String(r[ci] ?? '').trim());
  if (!dirty) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = sh.getDataRange().getValues().slice(1);
    if (!cur.some(r => String(r[0]) !== '' && !String(r[ci] ?? '').trim())) return;
    let max = 0;
    cur.forEach(r => { if (String(r[0]) !== '') { const n = +r[ci]; if (Number.isFinite(n) && n > max) max = n; } });
    let next = max + 1;
    cur.forEach((r, i) => {
      if (String(r[0]) !== '' && !String(r[ci] ?? '').trim()) {
        sh.getRange(i + 2, ci + 1).setValue(next++);
      }
    });
  } finally { lock.releaseLock(); }
  bustCache(['Users']);
}

// cachedRead chia nhỏ chuỗi JSON theo khối — CacheService giới hạn ~100KB/khóa nên nếu
// không, Attendance/Scores dày theo năm không cache được → searchByIdNumber đọc lại cả tab
// mỗi lần → Apps Script quá 6 phút → "Lỗi máy chủ". CHUNK = 20k ký tự ≤ 80KB UTF-8.
const CHUNK = 20000;
function cachedRead(name) {
  const cache = CacheService.getScriptCache();
  const n = cache.get('tab_' + name + '_n');
  if (n) {
    const keys = Array.from({length: +n}, (_, i) => 'tab_' + name + '_' + i);
    const partsMap = cache.getAll(keys);
    const parts = [];
    for (let i = 0; i < +n; i++) {
      if (!partsMap[keys[i]]) { parts.length = 0; break; }
      parts.push(partsMap[keys[i]]);
    }
    if (parts.length === +n) return JSON.parse(parts.join(''));
  }

  const data = readAll(name);
  const s = JSON.stringify(data);
  const chunks = {};
  const maxChunks = Math.ceil(s.length / CHUNK);

  for (let i = 0; i < s.length; i += CHUNK) {
    chunks['tab_' + name + '_' + (i / CHUNK)] = s.slice(i, i + CHUNK);
  }
  chunks['tab_' + name + '_n'] = String(maxChunks);

  if (maxChunks > 0) cache.putAll(chunks, CACHE_TTL);
  return data;
}
function bustCache(names) { CacheService.getScriptCache().removeAll(names.map(n => 'tab_' + n + '_n')); }

function appendRows(name, rows) {
  const sh = ss().getSheetByName(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length)
    .setValues(rows.map(r => head.map(h => {
      const v = r[h] !== undefined ? r[h] : '';
      // Chống formula injection: '='-prefix là công thức trong Sheets, vô hiệu hóa.
      return typeof v === 'string' && v.startsWith('=') ? "'" + v : v;
    })));
  bustCache([name]);
}

// Ghi đè theo key: xóa dòng khớp predicate, append bản mới (batch + lock chống race)
function upsertRows(name, predicate, newRows) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = ss().getSheetByName(name);
    const values = sh.getDataRange().getValues();
    const head = values[0];
    const kept = [head];
    values.slice(1).forEach(r => {
      const o = rowObj(head, r);
      if (!predicate(o)) kept.push(r);
    });
    sh.clearContents();
    sh.getRange(1, 1, kept.length, head.length).setValues(kept);
    appendRows(name, newRows);
  } finally { lock.releaseLock(); }
}

// Trích id file Drive từ URL (có thể nhiều URL cách nhau bởi dấu phẩy).
function driveFileIds(urls) {
  const set = new Set();
  String(urls || '').split(',').forEach(u => {
    const m = String(u).match(/\/d\/([^/]+)/);
    if (m) set.add(m[1]);
  });
  return set;
}

// Tên sub-folder giáo án = SchoolYear_WeekOf_ClassName_GLV / _TBM (role tách GLV và TBM).
const sanitize = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
function teachFolder(year, weekOf, className, role) {
  const root = config().DriveFolderId ? DriveApp.getFolderById(config().DriveFolderId) : DriveApp.getRootFolder();
  const name = sanitize([year, weekOf, className, role].filter(Boolean).join('_')) || '_uploads';
  // Cache id folder (key = cả tên + role) để đỡ query lặp; id lỗi thời → tạo lại.
  const ps = PropertiesService.getScriptProperties(), key = 'tf_' + name, id = ps.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const it = root.getFoldersByName(name);
  const f = it.hasNext() ? it.next() : root.createFolder(name);
  ps.setProperty(key, f.getId());
  return f;
}

function config() {
  const c = {};
  cachedRead('Config').forEach(r => c[r.Key] = r.Value);
  return c;
}
const currentYear = () => config().CurrentSchoolYear || '2026-2027';

/* Tuần nghỉ (lễ, kỷ niệm…) — loại khỏi mẫu số chuyên cần. Session rỗng = nghỉ cả tuần. */
function holidays(schoolYear) {
  const set = {};
  cachedRead('Holidays').forEach(h => {
    if (String(h.SchoolYear || schoolYear) === schoolYear) set[h.WeekOf + '|' + (h.Session || '')] = true;
  });
  return set;
}
const isHoliday = (set, weekOf, session) => set[weekOf + '|' + session] || set[weekOf + '|'];

// Chủ Nhật của tuần chứa ymd (lùi về đầu tuần) — dùng cho mẫu số chuyên cần.
function sundayOf(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

// Cửa sổ chuyên cần: từ Chủ Nhật của AttendanceStartDate (mặc định: bản ghi sớm nhất) đến Chủ Nhật vừa qua.
// Trả { start, lastYmd, max, nghi } — max[s] = số buổi không nghỉ của từng session trong cửa sổ.
function attendanceWindow(year) {
  const allAtt = cachedRead('Attendance').filter(r => r.SchoolYear === year);
  const nghi = holidays(year);
  let startYmd = config().AttendanceStartDate;
  if (!startYmd) {
    const weeks = allAtt.map(r => r.WeekOf).filter(Boolean);
    startYmd = weeks.length ? weeks.sort()[0] : '';
  }
  const max = {};
  SESSIONS.forEach(s => max[s] = 0);
  // Họp Huynh Trưởng (buổi 5 của Huynh trưởng) chỉ nghỉ khi nghỉ cả tuần (holiday Session rỗng).
  max['Họp Huynh Trưởng'] = 0;
  let start = null, lastYmd = '';
  if (startYmd) {
    start = sundayOf(startYmd);
    const end = new Date(); end.setDate(end.getDate() - end.getDay());
    lastYmd = fmtDate(end);
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 7)) {
      SESSIONS.forEach(s => { if (!isHoliday(nghi, fmtDate(d), s)) max[s]++; });
      if (!isHoliday(nghi, fmtDate(d), '')) max['Họp Huynh Trưởng']++;
    }
  }
  return { start, lastYmd, max, nghi };
}

function activeUsers() {
  return cachedRead('Users').filter(u => String(u.Status).toLowerCase() === 'hoạt động');
}

// Huynh trưởng = active User là GroupMember của Lớp thuộc scope Ngành. sector rỗng = toàn đoàn
// (gộp scope mọi Nhóm loại 'Ngành'). Mỗi GV 1 className (lớp gắn) → dòng nhân theo lớp.
const normText = s => String(s ?? '').normalize('NFC').trim();
function rosterFor(sector) {
  if (sector === XUDOAN) {
    const adminGroups = new Set();
    cachedRead('Groups').forEach(g => { if (g.Type === 'Quản trị') adminGroups.add(normText(g.GroupName)); });
    const active = {};
    activeUsers().forEach(u => active[String(u.Email).toLowerCase()] = u);
    const out = {};
    cachedRead('GroupMembers').forEach(m => {
      if (!adminGroups.has(normText(m.GroupName))) return;
      const u = active[String(m.Email || '').toLowerCase()];
      if (u) out[String(u.Email).toLowerCase()] = { email: u.Email, fullName: u.FullName || '', saintName: u.SaintName || '', className: '', id: numId(u.Id) };
    });
    return Object.values(out).sort((a, b) => (a.id - b.id) || String(a.fullName).localeCompare(String(b.fullName), 'vi'));
  }
  const sectorClasses = new Set();
  cachedRead('Groups').forEach(g => {
    if (g.Type === 'Ngành' && (sector === '' || normText(g.GroupName) === normText(sector)))
      String(g.Scope || '').split(',').forEach(c => { const x = normText(c); if (x) sectorClasses.add(x); });
  });
  const clsOfGroup = {};
  cachedRead('Groups').forEach(g => { if (g.Type === 'Lớp') clsOfGroup[normText(g.GroupName)] = normText(g.Scope || g.GroupName); });
  const active = {};
  activeUsers().forEach(u => active[String(u.Email).toLowerCase()] = u);
  const out = {};
  cachedRead('GroupMembers').forEach(m => {
    const cls = clsOfGroup[normText(m.GroupName)];
    if (!cls || !sectorClasses.has(cls)) return;
    const u = active[String(m.Email || '').toLowerCase()];
    if (u) out[String(u.Email).toLowerCase()] = { email: u.Email, fullName: u.FullName || '', saintName: u.SaintName || '', className: cls, id: numId(u.Id) };
  });
  return Object.values(out).sort((a, b) => (a.id - b.id) || String(a.fullName).localeCompare(String(b.fullName), 'vi'));
}

/* ĐTB HK = (15' + 2·HK)/3 · ĐTB năm = (HK1 + 2·HK2)/3 · xếp loại ≥8 Giỏi · ≥6.5 Tiên tiến · còn lại Trung bình */
// null/undefined/' ' = chưa có → null (tránh NaN khi ô trống). Điểm 0 hợp lệ.
function dtbHK(q, e) { return (q == null || q === '' || e == null || e === '') ? null : (+q + 2 * +e) / 3; }
function xepLoai(n) { return n >= 8 ? 'Giỏi' : n >= 6.5 ? 'Tiên tiến' : 'Trung bình'; }

// Tổng hợp điểm + chuyên cần cho một bộ lớp (dùng chung getSummary / startSchoolYear).
// Năm đã khóa (có dòng AcademicYear): danh sách lấy theo AcademicYear.SchoolYear + .ClassName;
// IdNumber chỉ để nối tên Thiếu nhi từ Students. Năm chưa khóa: đọc Scores/Attendance đang chạy,
// % CC giống tab Chuyên cần (Hiện diện ÷ số CN đã qua). Chọn nguồn theo DỮ LIỆU thực có, không
// theo Config.CurrentSchoolYear — Config chưa lăn năm không được làm ẩn dòng năm đã khóa.
function summaryRows(classNames, year) {
  const names = {};
  cachedRead('Students').forEach(st => {
    const sn = String(st.SaintName || '').trim();
    names[normId(st.IdNumber)] = sn ? sn + ' ' + st.FullName : st.FullName;
  });
  const archived = cachedRead('AcademicYear').filter(r => String(r.SchoolYear).trim() === year);
  if (archived.length) {
    // HK1/HK2 chốt lưu trong dòng. Dòng chốt trước khi có cột HK1Score/HK2Score → tính lại từ Scores
    // (Quiz15/Exam cố định theo năm nên khớp giá trị chốt). ĐTB năm/%CC/xếp loại giữ giá trị khóa.
    const sc = {};
    if (archived.some(r => r.HK1Score == null || r.HK1Score === '' || r.HK2Score == null || r.HK2Score === ''))
      cachedRead('Scores').filter(s => s.SchoolYear === year)
        .forEach(s => { sc[normId(s.IdNumber) + '|' + s.ClassName] = s; });
    return archived.filter(r => classNames.includes(r.ClassName)).map(r => {
      const avgYear = Number(r.YearScore) || null;
      const s = sc[normId(r.IdNumber) + '|' + r.ClassName] || {};
      const h1 = r.HK1Score != null && r.HK1Score !== '' ? +r.HK1Score : dtbHK(s.Quiz15_S1, s.Exam_S1);
      const h2 = r.HK2Score != null && r.HK2Score !== '' ? +r.HK2Score : dtbHK(s.Quiz15_S2, s.Exam_S2);
      return { idNumber: r.IdNumber, fullName: names[normId(r.IdNumber)] || '', className: r.ClassName,
        avgH1: h1, avgH2: h2, avgYear, attendancePct: Number(r.YearAttendant) || null,
        rating: avgYear == null ? '' : xepLoai(avgYear) };
    });
  }
  const w = attendanceWindow(year);
  const maxTotal = SESSIONS.reduce((a, s) => a + (w.max[s] || 0), 0);
  const coBy = {};
  const todayYmd = fmtDate(new Date());
  cachedRead('Attendance').forEach(r => {
    if (r.SchoolYear !== year || !classNames.includes(r.ClassName)) return;
    if (String(r.WeekOf) > todayYmd || isHoliday(w.nghi, r.WeekOf, r.Session)) return;
    if (r.AttendanceStatus === 'Hiện diện') coBy[normId(r.IdNumber)] = (coBy[normId(r.IdNumber)] || 0) + 1;
  });
  return cachedRead('Scores').filter(r => r.SchoolYear === year && classNames.includes(r.ClassName)).map(s => {
    const h1 = dtbHK(s.Quiz15_S1, s.Exam_S1), h2 = dtbHK(s.Quiz15_S2, s.Exam_S2);
    const nam = (h1 !== null && h2 !== null) ? (h1 + 2 * h2) / 3 : (h1 ?? h2);
    const pct = maxTotal ? Math.round((coBy[normId(s.IdNumber)] || 0) / maxTotal * 100) : null;
    return { idNumber: s.IdNumber, fullName: names[normId(s.IdNumber)] || '', className: s.ClassName,
      avgH1: h1, avgH2: h2, avgYear: nam, attendancePct: pct, rating: nam === null ? '' : xepLoai(nam) };
  });
}

// Tên tài liệu để hiển thị từng link: cột LessonPlanNames/RevisedPlanNames, 1 tên/dòng theo
// thứ tự URL trong cột tương ứng. Ô còn trống (dữ liệu cũ) → lấy tên file thật từ Drive và
// ghi lại 1 lần (chỉ ghi khi đủ mọi file — tránh lệch cột nếu 1 file đã bị xóa).
function planNames(rec, urlField, nameField) {
  const cur = String(rec[nameField] || '').trim();
  if (cur) return cur;
  const names = [];
  String(rec[urlField] || '').split(',').forEach(u => {
    const m = String(u).match(/\/d\/([^/]+)/);
    let n = '';
    if (m) { try { n = DriveApp.getFileById(m[1]).getName(); } catch (e) {} }
    names.push(n);
  });
  if (names.length && names.every(Boolean)) {
    const sh = ss().getSheetByName('Teaching');
    const data = sh.getDataRange().getValues(), ci = data[0].indexOf(nameField);
    if (ci >= 0) for (let r = 1; r < data.length; r++) {
      if (data[r][0] === rec.SchoolYear && data[r][1] === rec.WeekOf && data[r][2] === rec.ClassName)
        { sh.getRange(r + 1, ci + 1).setValue(names.join('\n')); break; }
    }
  }
  return names.join('\n');
}

// Thư mục chứa tài liệu = sub-folder {Năm}_{Tuần}_{Lớp}_{GLV|TBM}, lấy từ cha của file còn
// tồn tại đầu tiên. Không file / đã xóa → '' (ẩn link thư mục). Dùng cho cột Nội dung ở
// "Thống kê theo lớp" — chỉ gọi theo từng dòng hiển thị để khỏi quét cả năm.
function folderOfUrl(urls) {
  for (const u of String(urls || '').split(',')) {
    const m = String(u).match(/\/d\/([^/]+)/);
    if (!m) continue;
    try {
      const p = DriveApp.getFileById(m[1]).getParents();
      if (p.hasNext()) return p.next().getUrl();
    } catch (e) {}
  }
  return '';
}

/* ---------- ACTIONS ---------- */

const ACTIONS = {

  /* ---- Đăng nhập (Node gọi với email đã xác thực Google) ---- */
  getUser: b => {
    const email = String(b.email || '').toLowerCase();
    let u = null;
    cachedRead('Users').forEach(r => {
      if (String(r.Email).toLowerCase() === email)
        u = { email, fullName: r.FullName || email, saintName: r.SaintName || '', status: r.Status };
    });
    if (!u) return { status: 'error', message: 'Email ' + email + ' chưa được cấp quyền. Liên hệ admin.' };
    if (String(u.status).toLowerCase() !== 'hoạt động') return { status: 'error', message: 'Tài khoản đã bị khóa.' };
    const byName = {};
    cachedRead('Groups').forEach(g => byName[g.GroupName] = { name: g.GroupName, type: g.Type, scope: g.Scope });
    const groups = [];
    cachedRead('GroupMembers').forEach(m => {
      if (String(m.Email).toLowerCase() === email && byName[m.GroupName]) groups.push(byName[m.GroupName]);
    });
    return { status: 'ok', session: {
      email: u.email, fullName: u.fullName, groups,
      classes: cachedRead('Classes').map(c => c.ClassName), catalog: Object.values(byName),
      year: currentYear(),
    } };
  },

  /* ---- Danh mục ---- */
  getStudents: () => ({ status: 'ok', students: cachedRead('Students') }),
  getClasses:  () => ({ status: 'ok', classes: cachedRead('Classes') }),
  getTeachers: () => {
    if (ensureHeader('Users')) bustCache(['Users']); // schema mở rộng (SDT) → đọc lại để dòng có đủ cột
    return { status: 'ok', users: cachedRead('Users').sort((a, b) => numId(a.Id) - numId(b.Id)), members: cachedRead('GroupMembers'), groups: cachedRead('Groups') };
  },
  getConfig:   () => ({ status: 'ok', config: config() }),

  saveClass: b => {
    upsertRows('Classes', o => o.ClassName === b.oldClassName, [{ ClassName: b.className, Grade: b.grade }]);
    return { status: 'ok' };
  },

  // Thêm/sửa Thiếu nhi — không bao giờ xóa dòng (lịch sử tra theo CCCD)
  saveStudent: b => {
    const row = {
      IdNumber: b.idNumber, SaintName: b.saintName || '', FullName: b.fullName,
      DateOfBirth: b.dateOfBirth || '', Gender: b.gender || '', Father: b.father || '', Mother: b.mother || '',
      CurrentClass: b.className, EnrollYear: b.enrollYear || currentYear(),
      Status: b.status || 'Hoạt động', Note: b.note || '',
    };
    upsertRows('Students', o => o.IdNumber === b.idNumber, [row]);
    return { status: 'ok', student: row, idNumber: b.idNumber };
  },

  /* ---- Điểm danh (key ghi đè 1 buổi = SchoolYear + WeekOf + Session + ClassName) ---- */
  getAttendance: b => {
    const year = String(b.schoolYear || currentYear()).trim();
    const week = String(b.weekOf).trim();
    const sess = String(b.session).normalize('NFC').trim();
    const cls = String(b.className).normalize('NFC').trim();
    
    const recs = {};
    cachedRead('Attendance').forEach(r => {
      if (String(r.SchoolYear).trim() === year && 
          String(r.WeekOf).trim() === week && 
          String(r.Session).normalize('NFC').trim() === sess && 
          String(r.ClassName).normalize('NFC').trim() === cls) {
        // Strip both leading quotes and zeros
        recs[String(r.IdNumber).replace(/^['0]+/, '').trim()] = r;
      }
    });
    
    return { status: 'ok',
      records: activeStudents(b.className).map(st => {
        const idKey = String(st.IdNumber).replace(/^['0]+/, '').trim();
        const o = recs[idKey];
        return { idNumber: st.IdNumber, saintName: st.SaintName || '', fullName: st.FullName,
          photo: st.Photo || st.PhotoURL || st.Image || '',
          status: o ? o.AttendanceStatus : '', note: (o && o.Note) || '' };
      }),
      isHolidayWeek: !!isHoliday(holidays(year), b.weekOf, b.session) };
  },

  saveAttendance: b => {
    const rows = (b.records || []).map(r => ({
      SchoolYear: b.schoolYear, WeekOf: b.weekOf, Session: b.session,
      IdNumber: String(r.idNumber).trim(), // Reverted to standard string
      ClassName: b.className, AttendanceStatus: r.status, Note: r.note || '',
    }));
    upsertRows('Attendance',
      o => String(o.SchoolYear).trim() === String(b.schoolYear).trim() && 
           String(o.WeekOf).trim() === String(b.weekOf).trim() &&
           String(o.Session).normalize('NFC').trim() === String(b.session).normalize('NFC').trim() && 
           String(o.ClassName).normalize('NFC').trim() === String(b.className).normalize('NFC').trim(),
      rows);
    return { status: 'ok', records: rows };
  },

  /* ---- Chuyên cần: mẫu số chung = các Chủ Nhật từ AttendanceStartDate (mặc định: bản ghi sớm nhất)
         đến Chủ Nhật vừa qua, trừ tuần nghỉ. Tử số = số buổi 'Hiện diện' của từng Thiếu nhi. ---- */
getClassAttendanceStats: b => {
    const year = String(b.schoolYear || currentYear()).trim();
    const rawClassNames = b.className ? [b.className] : cachedRead('Classes').map(x => x.ClassName);
    const classNames = rawClassNames.map(c => String(c).normalize('NFC').trim());
    
    const w = attendanceWindow(year);
    const maxTotal = SESSIONS.reduce((a, s) => a + (w.max[s] || 0), 0);
    
    // Establish a hard boundary for "now" to exclude future records
    const todayYmd = fmtDate(new Date());
    
    const att = cachedRead('Attendance').filter(r => {
      const rYear = String(r.SchoolYear).trim();
      const rClass = String(r.ClassName).normalize('NFC').trim();
      const rSess = String(r.Session).normalize('NFC').trim();
      const rWeek = String(r.WeekOf).trim();
      
      // Count records only if they match the year, class, are not holidays, and are <= today
      return rYear === year && 
             classNames.includes(rClass) && 
             rWeek <= todayYmd &&
             !isHoliday(w.nghi, r.WeekOf, rSess);
    });

    const by = {};
    att.forEach(r => {
      const id = String(r.IdNumber).replace(/^['0]+/, '').trim();
      const sess = String(r.Session).normalize('NFC').trim();
      const key = id + '|' + sess;
      by[key] = by[key] || [];
      by[key].push(r);
    });

    const stats = [];
    classNames.forEach(cls => {
      activeStudents(cls).forEach(st => {
        const stId = String(st.IdNumber).replace(/^['0]+/, '').trim();
        const row = { className: cls, idNumber: st.IdNumber, fullName: st.FullName, present: {} };
        
        SESSIONS.forEach(ses => {
          const normSes = String(ses).normalize('NFC').trim();
          const list = (by[stId + '|' + normSes] || []).filter(r => String(r.ClassName).normalize('NFC').trim() === cls);
          row.present[ses] = list.filter(r => String(r.AttendanceStatus).normalize('NFC').trim().toLowerCase() === 'hiện diện').length;
        });
        stats.push(row);
      });
    });
    
    return { status: 'ok', max: w.max, maxTotal, stats };
  },

  /* ---- Giảng dạy ---- */
  getTeaching: b => {
    const year = b.schoolYear || currentYear();
    // Mỗi key (SchoolYear+WeekOf+ClassName) chỉ 1 dòng mới nhất: upsert đã đảm bảo,
    // bản này chỉ chống dòng trùng cũ sót trong sheet (dòng cuối appended = mới nhất).
    const by = {};
    readAll('Teaching').forEach(r => {
      if (r.SchoolYear !== year || (b.weekOf && r.WeekOf !== b.weekOf)) return;
      by[r.SchoolYear + '|' + r.WeekOf + '|' + r.ClassName] = r;
    });
    let records = Object.values(by);
    if (b.className) records = records.filter(r => r.ClassName === b.className);
    records.sort((a, b) => String(b.WeekOf).localeCompare(String(a.WeekOf)));
    const total = records.length;
    // recent: N dòng gần nhất (chế độ cũ); page/pageSize: phân trang. Drive lookup
    // chỉ khi trả về lát cắt giới hạn vì truy vấn DriveApp chậm, có giới hạn.
    if (b.recent && !b.page) records = records.slice(0, +b.recent);
    if (b.page) {
      const size = Math.max(1, Math.min(+b.pageSize || 10, 50));
      records = records.slice((+b.page - 1) * size, +b.page * size);
    }
    if (b.recent || b.page) records.forEach(r => {
      r.LessonFolderUrl = folderOfUrl(r.LessonPlanUrl);
      r.RevisedFolderUrl = folderOfUrl(r.RevisedPlanUrl);
    });
    records.forEach(r => {
      r.LessonPlanNames = planNames(r, 'LessonPlanUrl', 'LessonPlanNames');
      r.RevisedPlanNames = planNames(r, 'RevisedPlanUrl', 'RevisedPlanNames');
    });
    return { status: 'ok', records, total };
  },

  saveTeaching: b => {
    // Upload lại cùng key (SchoolYear+WeekOf+ClassName) → xóa file Drive cũ đã bị thay thế.
    const old = readAll('Teaching').find(o =>
      o.SchoolYear === b.schoolYear && o.WeekOf === b.weekOf && o.ClassName === b.className);
    if (old) {
      const keep = new Set([...driveFileIds(b.lessonPlanUrl), ...driveFileIds(b.revisedPlanUrl)]);
      [...driveFileIds(old.LessonPlanUrl), ...driveFileIds(old.RevisedPlanUrl)]
        .filter(id => !keep.has(id))
        .forEach(id => { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} });
    }
    const row = {
      SchoolYear: b.schoolYear, WeekOf: b.weekOf, ClassName: b.className,
      // Giữ GLV đầu tiên: TBM chỉnh sửa sau không ghi đè cột TeacherEmail.
      TeacherEmail: (old ? (old.TeacherEmail || '') : '') || b.teacherEmail || '',
      LessonContent: b.lessonContent || '',
      LessonPlanUrl: b.lessonPlanUrl || '', LessonPlanNames: b.lessonPlanNames || '',
      RevisedPlanUrl: b.revisedPlanUrl || '', RevisedPlanNames: b.revisedPlanNames || '',
      UpdatedBy: b.updatedBy || b.teacherEmail || '',
    };
    upsertRows('Teaching',
      o => o.SchoolYear === b.schoolYear && o.WeekOf === b.weekOf && o.ClassName === b.className,
      [row]);
    return { status: 'ok', record: row };
  },

  /* ---- Chẩn đoán quyền Drive (gọi bằng node test-drive.js) ---- */
  testDrive: () => {
    const r = { folderId: config().DriveFolderId || '' };
    try { r.rootName = DriveApp.getRootFolder().getName(); } catch (e) { r.rootError = String(e); }
    if (r.folderId) {
      try { r.folderName = DriveApp.getFolderById(r.folderId).getName(); } catch (e) { r.folderError = String(e); }
    }
    // Bước mà uploadFile thực sự cần: setSharing public — thử đúng nghiệp vụ upload.
    try {
      const folder = r.folderId ? DriveApp.getFolderById(r.folderId) : DriveApp.getRootFolder();
      const file = folder.createFile('_test_sharing', 'x', MimeType.PLAIN_TEXT);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      r.shareUrl = file.getUrl();
      file.setTrashed(true);
      r.shareOk = true;
    } catch (e) { r.shareError = String(e); }
    return { status: 'ok', ...r };
  },

  // Upload giáo án lên Drive — sheet chỉ giữ link. Khi có schoolYear+weekOf+className+kind
  // → sub-folder {Năm}_{Tuần}_{Lớp}_{GLV|TBM} (teachFolder). File/folder con kế thừa quyền
  // public (Viewer) của folder DriveFolderId ("Anyone with link → Viewer" trong Drive UI) —
  // không gọi setSharing để tránh cần scope auth/drive đầy đủ. Trùng tên trong cùng sub-folder
  // → xóa (trash) bản cũ, upsert thay thế. GLV vs TBM khác folder → không đè nhau.
  // ponytail: không dùng được nếu folder riêng tư; đổi lại setSharing khi có auth/drive.
  uploadFile: b => {
    const blob = Utilities.newBlob(Utilities.base64Decode(b.base64), b.mimeType, b.filename);
    let folder;
    if (b.schoolYear && b.weekOf && b.className) {
      folder = teachFolder(b.schoolYear, b.weekOf, b.className, b.kind === 'TBM' ? 'TBM' : 'GLV');
    } else {
      folder = config().DriveFolderId ? DriveApp.getFolderById(config().DriveFolderId) : DriveApp.getRootFolder();
    }
    const same = folder.getFilesByName(b.filename);
    while (same.hasNext()) same.next().setTrashed(true);
    const file = folder.createFile(blob);
    return { status: 'ok', url: file.getUrl() };
  },

  /* ---- Điểm (key ghi đè = SchoolYear + ClassName; ô trống = chưa có) ---- */
  getScores: b => {
    const year = b.schoolYear || currentYear();
    const scores = cachedRead('Scores').filter(r =>
      r.SchoolYear === year && (!b.className || r.ClassName === b.className));
    return { status: 'ok', scores };
  },

  saveScores: b => {
    const rows = (b.students || []).map(s => ({
      SchoolYear: b.schoolYear, IdNumber: s.idNumber, ClassName: b.className,
      Quiz15_S1: s.quiz15s1 || '', Exam_S1: s.exams1 || '',
      Quiz15_S2: s.quiz15s2 || '', Exam_S2: s.exams2 || '',
    }));
    upsertRows('Scores', o => o.SchoolYear === b.schoolYear && o.ClassName === b.className, rows);
    return { status: 'ok', students: rows };
  },

  /* ---- Tổng hợp & xếp loại ---- */
  getSummary: b => {
    const year = b.schoolYear || currentYear();
    const classNames = b.className ? [b.className] : cachedRead('Classes').map(x => x.ClassName);
    return { status: 'ok', summary: summaryRows(classNames, year) };
  },

  /* ---- Danh sách năm học có dữ liệu (AcademicYear ∪ Attendance ∪ Scores), sớm nhất trước ---- */
  getYearOptions: () => {
    const set = new Set([currentYear()]);
    ['AcademicYear', 'Attendance', 'Scores'].forEach(t =>
      cachedRead(t).forEach(r => { if (r.SchoolYear) set.add(String(r.SchoolYear).trim()); }));
    return { status: 'ok', years: [...set].sort() };
  },

  /* ---- Trích lục theo CCCD: mọi năm (giữ nguyên cả tuần nghỉ — tra lịch sử đầy đủ) ---- */
  // Trích lục theo CCCD. absences = mọi buổi không nghỉ trong cửa sổ chuyên cần (AttendanceStartDate → nay)
  // mà Thiếu nhi chưa ghi 'Hiện diện' — kể cả tuần chưa điểm danh (không có bản ghi) để tra đủ (FR-DD-17).
  searchByIdNumber: b => {
    const id = String(b.idNumber).replace(/^['0]+/, '').trim();
    const st = cachedRead('Students').find(s => String(s.IdNumber).replace(/^['0]+/, '').trim() === id);
    if (!st) return { status: 'ok', students: [], attendance: [], scores: [], absences: [] };
    
    const att = cachedRead('Attendance').filter(r => String(r.IdNumber).replace(/^['0]+/, '').trim() === id);
    const year = currentYear();
    const w = attendanceWindow(year);
    const present = {};
    
    att.forEach(r => { 
      if (String(r.SchoolYear).trim() === String(year).trim() && 
          String(r.AttendanceStatus).normalize('NFC').trim().toLowerCase() === 'hiện diện') {
        present[String(r.WeekOf).trim() + '|' + String(r.Session).normalize('NFC').trim()] = true; 
      }
    });
    
    const absences = [];
    if (w.start) {
      if (w.start.getFullYear() < 2020) w.start = new Date(2020, 0, 1);
      for (const d = new Date(w.start); fmtDate(d) <= w.lastYmd; d.setDate(d.getDate() + 7)) {
        const wk = fmtDate(d);
        SESSIONS.forEach(s => {
          const normS = String(s).normalize('NFC').trim();
          if (isHoliday(w.nghi, wk, normS) || present[wk + '|' + normS]) return;
          
          const rec = att.find(r => String(r.SchoolYear).trim() === String(year).trim() && 
                                    String(r.WeekOf).trim() === wk && 
                                    String(r.Session).normalize('NFC').trim() === normS);
          absences.push({ WeekOf: wk, Session: s, AttendanceStatus: rec ? rec.AttendanceStatus : '', Note: rec ? rec.Note : '' });
        });
      }
    }
    // Trích lục điểm = bản chốt AcademicYear từng năm (cùng nguồn Tổng hợp/xếp loại),
    // mọi năm Thiếu nhi có dòng (AcademicYear ∪ Scores), không giới hạn xếp loại.
    const ayRows = cachedRead('AcademicYear').filter(r => normId(r.IdNumber) === id);
    const scoreRows = cachedRead('Scores').filter(r => normId(r.IdNumber) === id);
    const clsOf = {};
    ayRows.forEach(r => { clsOf[String(r.SchoolYear).trim()] = r.ClassName; });
    scoreRows.forEach(r => { const y = String(r.SchoolYear).trim(); if (clsOf[y] == null) clsOf[y] = r.ClassName; });
    const academic = Object.keys(clsOf).sort().map(y => {
      const row = summaryRows([clsOf[y]], y).find(x => normId(x.idNumber) === id);
      return row ? { SchoolYear: y, ...row } : null;
    }).filter(Boolean);
    return { status: 'ok', students: [st], attendance: att, academic, scores: scoreRows, absences };
  },

  /* ---- Điểm danh Huynh trưởng (buổi 5 = Họp Huynh Trưởng) ---- */
  // 1 GV × 1 tuần × 1 buổi = 1 dòng TeacherAttendance. Chưa có bản ghi → để trống (chưa điểm danh).
  getTeacherAttendance: b => {
    const year = currentYear();
    const recs = {};
    cachedRead('TeacherAttendance').forEach(r => {
      if (String(r.SchoolYear).trim() === year &&
          String(r.WeekOf).trim() === String(b.weekOf).trim() &&
          normText(r.Session) === normText(b.session))
        recs[String(r.TeacherEmail).toLowerCase()] = r;
    });
    const roster = rosterFor(b.sector).map(u => {
      const r = recs[u.email.toLowerCase()];
      return { id: u.id, email: u.email, fullName: u.fullName, saintName: u.saintName, className: u.className,
        status: r ? r.Status : '', note: (r && r.Note) || '' };
    });
    return { status: 'ok', roster, isHolidayWeek: !!isHoliday(holidays(year), b.weekOf, b.session) };
  },

  saveTeacherAttendance: b => {
    const year = currentYear();
    const rows = (b.records || []).map(r => ({
      SchoolYear: year, WeekOf: String(b.weekOf).trim(), Session: normText(b.session),
      TeacherEmail: String(r.email).trim(), Status: r.status, Note: r.note || '',
    }));
    upsertRows('TeacherAttendance',
      o => String(o.SchoolYear).trim() === year &&
           String(o.WeekOf).trim() === String(b.weekOf).trim() &&
           normText(o.Session) === normText(b.session),
      rows);
    return { status: 'ok', records: rows };
  },

  // Thống kê theo (các) lớp thuộc Ngành: % từng buổi + Tỉ lệ hiện diện = Hiện diện ÷ tổng buổi đã qua.
  getTeacherStats: b => {
    const year = currentYear();
    const w = attendanceWindow(year);
    const maxTotal = TEACHER_SESSIONS.reduce((a, s) => a + (w.max[s] || 0), 0);
    const todayYmd = fmtDate(new Date());
    const roster = rosterFor(b.sector).filter(u => !b.className || normText(u.className) === normText(b.className));
    const emails = new Set(roster.map(u => u.email.toLowerCase()));
    const by = {};
    cachedRead('TeacherAttendance').forEach(r => {
      if (String(r.SchoolYear).trim() !== year || String(r.WeekOf).trim() > todayYmd) return;
      const e = String(r.TeacherEmail || '').toLowerCase();
      if (!emails.has(e) || isHoliday(w.nghi, r.WeekOf, r.Session)) return;
      if (normText(r.Status).toLowerCase() !== 'hiện diện') return;
      const k = e + '|' + normText(r.Session);
      by[k] = (by[k] || 0) + 1;
    });
    // Buổi dạy đã cập nhật = số giáo án (khác tuần/lớp) GV ghi trong năm, mọi môn.
    const taught = {};
    const seen = {};
    readAll('Teaching').forEach(r => {
      if (String(r.SchoolYear).trim() !== year) return;
      const e = String(r.TeacherEmail || '').toLowerCase();
      if (!e || !emails.has(e)) return;
      const k = e + '|' + r.WeekOf + '|' + r.ClassName;
      if (!seen[k]) { seen[k] = true; taught[e] = (taught[e] || 0) + 1; }
    });
    const stats = roster.map(u => {
      const e = u.email.toLowerCase();
      const present = {};
      TEACHER_SESSIONS.forEach(s => present[s] = by[e + '|' + normText(s)] || 0);
      return { id: u.id, email: u.email, fullName: u.fullName, className: u.className,
        taught: taught[e] || 0, present };
    });
    return { status: 'ok', max: w.max, maxTotal, stats };
  },

  // Trích lục Huynh trưởng: các buổi đã điểm danh KHÔNG phải 'Hiện diện' trong năm (không có CCCD → tra theo email).
  getTeacherTrichLuc: b => {
    const year = b.schoolYear || currentYear();
    const email = String(b.teacherEmail || '').toLowerCase();
    const u = cachedRead('Users').find(x => String(x.Email).toLowerCase() === email);
    if (!u) return { status: 'ok', teacher: null, absences: [] };
    const w = attendanceWindow(year);
    const absences = [];
    if (w.start) {
      const lo = fmtDate(w.start);
      cachedRead('TeacherAttendance').forEach(r => {
        if (String(r.TeacherEmail || '').toLowerCase() !== email ||
            String(r.SchoolYear).trim() !== String(year).trim()) return;
        const wk = String(r.WeekOf).trim();
        if (wk < lo || wk > w.lastYmd || isHoliday(w.nghi, r.WeekOf, r.Session)) return;
        if (normText(r.Status).toLowerCase() === 'hiện diện') return;
        absences.push({ WeekOf: wk, Session: r.Session, Status: r.Status, Note: r.Note || '' });
      });
    }
    absences.sort((a, b) => String(a.WeekOf).localeCompare(String(b.WeekOf)) || String(a.Session).localeCompare(String(b.Session)));
    return { status: 'ok', teacher: { email: u.Email, fullName: u.FullName || '', saintName: u.SaintName || '' }, absences };
  },

  /* ---- Admin (xem requirements/Rework_Admin.md) ---- */
  // Nghỉ lễ năm hiện tại (không cho chọn năm — Chuyển năm xóa sạch Holidays nên mặc định = năm hiện tại).
  getHolidays: b => {
    const year = b.schoolYear || currentYear();
    const list = cachedRead('Holidays').filter(o => String(o.SchoolYear) === year)
      .map(o => ({ weekOf: o.WeekOf, session: o.Session || '', reason: o.Reason || '' }))
      .sort((x, y) => String(x.weekOf).localeCompare(String(y.weekOf)) || String(x.session).localeCompare(String(y.session)));
    return { status: 'ok', holidays: list };
  },

  // Thay toàn bộ danh sách nghỉ lễ của NĂM HIỆN TẠI (1 lần ghi, không upsert từng dòng).
  saveHolidays: b => {
    const year = currentYear();
    const rows = (b.holidays || []).map(h => ({ SchoolYear: year, WeekOf: h.weekOf, Session: h.session || '', Reason: h.reason || '' }));
    upsertRows('Holidays', o => String(o.SchoolYear) === year, rows);
    return { status: 'ok', ok: true };
  },

  // Thêm/Sửa 1 người dùng theo email — giữ Id cũ; dòng mới thiếu Id được backfill cấp số tự động.
  saveUser: b => {
    ensureHeader('Users');
    const email = String((b.user || {}).email || '').trim().toLowerCase();
    if (!email) throw new Error('Thiếu email.');
    const old = cachedRead('Users').find(u => String(u.Email).toLowerCase() === email);
    const row = {
      Email: email,
      SaintName: String(b.user.saintName || '').trim(),
      FullName: String(b.user.fullName || '').trim(),
      SDT: String(b.user.sdt || '').trim(),
      Status: b.user.status || (old && old.Status) || 'Hoạt động',
      Id: (old && old.Id) ?? '',
    };
    upsertRows('Users', o => String(o.Email).toLowerCase() === email, [row]);
    backfillUsersId();
    // Đọc lại sau backfill để trả Id thật (dòng mới được cấp số tự động ở sheet).
    const saved = cachedRead('Users').find(u => String(u.Email).toLowerCase() === email);
    return { status: 'ok', user: saved || row };
  },

  // Gán lại toàn bộ nhóm cho từng email (danh sách gửi lên là đầy đủ; rỗng = gỡ hết nhóm).
  saveGroupMembers: b => {
    (b.assignments || []).forEach(a => {
      const email = String(a.email || '').trim().toLowerCase();
      if (!email) return;
      upsertRows('GroupMembers', o => String(o.Email).toLowerCase() === email,
        (a.groups || []).map(g => ({ GroupName: g, Email: email })));
    });
    return { status: 'ok', ok: true };
  },

  /* Chuyển năm: năm +1 tự động (không nhận newYear). Lưu Score/Attendance năm cũ vào AcademicYear,
     xóa sạch Attendance/TeacherAttendance/Holidays, Thiếu nhi 'Hoạt động' tự lên lớp kế tiếp theo thứ tự
     Classes (lớp cuối Dự bị trưởng 2 giữ nguyên — đổi Status thủ công để không còn hiện). */
  startSchoolYear: b => {
    const oldYear = config().CurrentSchoolYear || currentYear();
    const [a, c] = oldYear.split('-');
    const newYear = (+a + 1) + '-' + (+c + 1);
    const order = cachedRead('Classes').map(cl => cl.ClassName);
    upsertRows('AcademicYear', o => String(o.SchoolYear) === oldYear,
      summaryRows(order, oldYear).map(r => ({ SchoolYear: oldYear, IdNumber: r.idNumber, ClassName: r.className,
        HK1Score: r.avgH1, HK2Score: r.avgH2, YearScore: r.avgYear, YearAttendant: r.attendancePct, Status: r.rating })));
    ['Attendance', 'TeacherAttendance', 'Holidays'].forEach(n => upsertRows(n, () => true, []));
    const st = cachedRead('Students').map(s => {
      if (String(s.Status).toLowerCase() !== 'hoạt động') return s;
      const i = order.indexOf(s.CurrentClass);
      return (i >= 0 && i < order.length - 1) ? { ...s, CurrentClass: order[i + 1] } : s;
    });
    upsertRows('Students', () => false, st);
    upsertRows('Config', o => o.Key === 'CurrentSchoolYear', [{ Key: 'CurrentSchoolYear', Value: newYear }]);
    if (b.attendanceStartDate) upsertRows('Config', o => o.Key === 'AttendanceStartDate', [{ Key: 'AttendanceStartDate', Value: b.attendanceStartDate }]);
    return { status: 'ok', newYear };
  },
}
/* ponytail: readAll quét cả tab — đủ cho ~25k dòng/năm; đổi TextFinder theo tuần khi Attendance vượt vài trăm nghìn dòng. */
