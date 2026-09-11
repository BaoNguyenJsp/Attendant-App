/**
 * Sổ Thiếu Nhi — Apps Script dịch vụ lưu trữ (web app, chỉ doPost)
 * Hybrid 1-Week-Per-Row Attendance Support (12 Cols Student / 14 Cols Teacher)
 */

const TAB_HEADERS = {
  Users:             ['Email', 'SaintName', 'FullName', 'Status', 'Id', 'SDT'],
  Groups:            ['GroupName', 'Type', 'Scope', 'Description'],
  GroupMembers:      ['GroupName', 'Email'],
  Classes:           ['ClassName', 'Grade'],
  Students:          ['IdNumber', 'SaintName', 'FullName', 'DateOfBirth', 'Gender', 'Father', 'Mother', 'CurrentClass', 'EnrollYear', 'Status', 'Note'],
  Teaching:          ['SchoolYear', 'WeekOf', 'ClassName', 'TeacherEmail', 'LessonContent', 'LessonPlanUrl', 'LessonPlanNames', 'RevisedPlanUrl', 'RevisedPlanNames', 'UpdatedBy'],
  Scores:            ['SchoolYear', 'IdNumber', 'ClassName', 'Quiz15_S1', 'Exam_S1', 'Quiz15_S2', 'Exam_S2'],
  Config:            ['Key', 'Value'],
  Holidays:          ['SchoolYear', 'WeekOf', 'Session', 'Reason'],
  AcademicYear:      ['SchoolYear', 'IdNumber', 'ClassName', 'HK1Score', 'HK2Score', 'YearScore', 'YearAttendant', 'Status'],
  Attendance:        ['SchoolYear', 'WeekOf', 'IdNumber', 'ClassName', 'LeChuaNhat_Status', 'LeChuaNhat_Note', 'HocGiaoLy_Status', 'HocGiaoLy_Note', 'ChauThanhThe_Status', 'ChauThanhThe_Note', 'LeThu5_Status', 'LeThu5_Note'],
  TeacherAttendance: ['SchoolYear', 'WeekOf', 'TeacherEmail', 'ClassName', 'LeChuaNhat_Status', 'LeChuaNhat_Note', 'HocGiaoLy_Status', 'HocGiaoLy_Note', 'ChauThanhThe_Status', 'ChauThanhThe_Note', 'LeThu5_Status', 'LeThu5_Note', 'HopHuynhTruong_Status', 'HopHuynhTruong_Note']
};

const SESSIONS = ['Lễ Chúa Nhật', 'Học Giáo Lý', 'Chầu Thánh Thể', 'Lễ Thứ Năm'];
const TEACHER_SESSIONS = [...SESSIONS, 'Họp Huynh Trưởng'];

const SESSION_COL_MAP = {
  'Lễ Chúa Nhật':   { status: 'LeChuaNhat_Status',   note: 'LeChuaNhat_Note',   sIdx: 4, nIdx: 5 },
  'Học Giáo Lý':     { status: 'HocGiaoLy_Status',    note: 'HocGiaoLy_Note',    sIdx: 6, nIdx: 7 },
  'Chầu Thánh Thể':  { status: 'ChauThanhThe_Status',  note: 'ChauThanhThe_Note',  sIdx: 8, nIdx: 9 },
  'Lễ Thứ Năm':     { status: 'LeThu5_Status',       note: 'LeThu5_Note',       sIdx: 10, nIdx: 11 },
  'Lễ Thứ 5':       { status: 'LeThu5_Status',       note: 'LeThu5_Note',       sIdx: 10, nIdx: 11 },
  'Họp Huynh Trưởng':{ status: 'HopHuynhTruong_Status',note: 'HopHuynhTruong_Note',sIdx: 12, nIdx: 13 }
};

const XUDOAN = '__Xudoan__';
const CACHE_TTL = 300;

/* ---------- HTTP Entry ---------- */
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

/* ---------- Core Helpers ---------- */
function ss() { return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')); }

const fmtDate = d => {
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
};

const normId = s => String(s ?? '').replace(/^['0]+/, '').trim();
const numId = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
const normText = s => String(s ?? '').normalize('NFC').trim();

function getAttSheetName(className) {
  return className ? ('Att_' + normText(className)) : 'Att_Chiên Con';
}

function genderRank(v) {
  const g = String(v ?? '').normalize('NFC').trim().toLowerCase();
  return g === 'nữ' ? 0 : g === 'nam' ? 1 : 2;
}

function activeStudents(className) {
  const targetClass = normText(className);
  return cachedRead('Students').filter(s => 
    normText(s.CurrentClass) === targetClass && 
    normText(s.Status).toLowerCase() === 'hoạt động'
  ).sort((a, b) => genderRank(a.Gender) - genderRank(b.Gender));
}

function rowObj(head, r) {
  const o = {};
  head.forEach((h, i) => {
    let val = r[i];
    if (val instanceof Date) {
      o[h] = fmtDate(val);
    } else if (h === 'IdNumber' || h === 'SchoolYear' || h === 'ClassName' || h === 'TeacherEmail') {
      o[h] = String(val).trim(); 
    } else if (typeof val === 'string') {
      o[h] = val.trim(); 
    } else {
      o[h] = val;
    }
  });
  return o;
}

function ensureHeader(name) {
  const want = TAB_HEADERS[name] || TAB_HEADERS.Attendance;
  if (!want) return false;
  const sh = ss().getSheetByName(name);
  if (!sh) return false;
  const cur0 = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(c => String(c ?? ''));
  if (want.every(h => cur0.includes(h))) return false;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let changed = false;
  try {
    const cur = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(c => String(c ?? ''));
    for (let i = 0; i < want.length; i++) {
      if (cur[i] === want[i] || cur.includes(want[i])) continue;
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
    const h = TAB_HEADERS[name] || (name.startsWith('Att_') ? TAB_HEADERS.Attendance : null);
    if (!h) throw new Error('Missing tab: ' + name);
    sh = ss().insertSheet(name);
    sh.getRange(1, 1, 1, h.length).setValues([h]);
  }
  ensureHeader(name);
  const values = sh.getDataRange().getValues();
  const head = values.shift();
  if (!head) return [];
  if (name === 'Users' && values.some(r => String(r[0]) !== '' && !String(r[TAB_HEADERS.Users.indexOf('Id')] ?? '').trim())) {
    backfillUsersId();
    return readAll(name);
  }
  return values.filter(r => String(r[0]) !== '').map(r => rowObj(head, r));
}

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

function bustCache(names) { 
  const cache = CacheService.getScriptCache();
  
  if (!names || names.length === 0) {
    // Dynamically get all sheet names (including dynamic Att_ tabs) and wipe their cache
    const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
    const allKeys = sheets.map(sh => 'tab_' + sh.getName() + '_n');
    cache.removeAll(allKeys);
  } else {
    // Wipe only specific requested tabs
    cache.removeAll(names.map(n => 'tab_' + n + '_n')); 
  }
}

function appendRows(name, rows) {
  let sh = ss().getSheetByName(name);
  if (!sh) {
    const h = TAB_HEADERS[name] || TAB_HEADERS.Attendance;
    sh = ss().insertSheet(name);
    sh.getRange(1, 1, 1, h.length).setValues([h]);
  }
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length)
    .setValues(rows.map(r => head.map(h => {
      const v = r[h] !== undefined ? r[h] : '';
      return typeof v === 'string' && v.startsWith('=') ? "'" + v : v;
    })));
  bustCache([name]);
}

function upsertRows(name, predicate, newRows) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let sh = ss().getSheetByName(name);
    if (!sh) {
      const h = TAB_HEADERS[name] || TAB_HEADERS.Attendance;
      sh = ss().insertSheet(name);
      sh.getRange(1, 1, 1, h.length).setValues([h]);
    }
    const values = sh.getDataRange().getValues();
    const head = values[0];
    const kept = [head];
    values.slice(1).forEach(r => {
      const o = rowObj(head, r);
      if (!predicate(o)) kept.push(r);
    });
    sh.clearContents();
    sh.getRange(1, 1, kept.length, head.length).setValues(kept);
    if (newRows && newRows.length > 0) {
      const payload = newRows.map(r => head.map(h => r[h] !== undefined ? r[h] : ''));
      sh.getRange(sh.getLastRow() + 1, 1, payload.length, head.length).setValues(payload);
    }
  } finally { lock.releaseLock(); }
}

/* HIGH-PERFORMANCE SCORES UPSERT */
function saveScoresOptimized(b) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  
  try {
    const sh = ss().getSheetByName('Scores');
    const values = sh.getDataRange().getValues();
    if (values.length === 0) return { status: 'ok', students: [] };

    const head = values[0];
    const syIdx = head.indexOf('SchoolYear');
    const clsIdx = head.indexOf('ClassName');

    const targetSY = String(b.schoolYear).trim();
    const targetCls = normText(b.className);

    const keptRows = [head];
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      const isTarget = String(row[syIdx]).trim() === targetSY && normText(row[clsIdx]) === targetCls;
      if (!isTarget && String(row[0]) !== '') {
        keptRows.push(row);
      }
    }

    const newStudents = b.students || [];
    newStudents.forEach(s => {
      const rowMap = {
        SchoolYear: b.schoolYear,
        IdNumber: s.idNumber,
        ClassName: b.className,
        Quiz15_S1: s.quiz15s1 || '',
        Exam_S1: s.exams1 || '',
        Quiz15_S2: s.quiz15s2 || '',
        Exam_S2: s.exams2 || ''
      };
      keptRows.push(head.map(h => rowMap[h] !== undefined ? rowMap[h] : ''));
    });

    sh.clearContents();
    sh.getRange(1, 1, keptRows.length, head.length).setValues(keptRows);

    SpreadsheetApp.flush();
    bustCache(['Scores']);
    return { status: 'ok', students: newStudents };
  } finally {
    lock.releaseLock();
  }
}

function driveFileIds(urls) {
  const set = new Set();
  String(urls || '').split(',').forEach(u => {
    const m = String(u).match(/\/d\/([^/]+)/);
    if (m) set.add(m[1]);
  });
  return set;
}

const sanitize = s => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
function teachFolder(year, weekOf, className, role) {
  const root = config().DriveFolderId ? DriveApp.getFolderById(config().DriveFolderId) : DriveApp.getRootFolder();
  const name = sanitize([year, weekOf, className, role].filter(Boolean).join('_')) || '_uploads';
  const ps = PropertiesService.getScriptProperties(), key = 'tf_' + name, id = ps.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const it = root.getFoldersByName(name);
  const f = it.hasNext() ? it.next() : root.createFolder(name);
  ps.setProperty(key, f.getId());
  return f;
}

let __memoConfig = null;
function config() {
  if (__memoConfig) return __memoConfig;
  const c = {};
  cachedRead('Config').forEach(r => c[r.Key] = r.Value);
  __memoConfig = c;
  return c;
}

const currentYear = () => config().CurrentSchoolYear || '2026-2027';

function holidays(schoolYear) {
  const set = {};
  cachedRead('Holidays').forEach(h => {
    if (String(h.SchoolYear || schoolYear) === schoolYear) set[h.WeekOf + '|' + (h.Session || '')] = true;
  });
  return set;
}

const isHoliday = (set, weekOf, session) => set[weekOf + '|' + session] || set[weekOf + '|'];

function sundayOf(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function attendanceWindow(year) {
  const nghi = holidays(year);
  let startYmd = config().AttendanceStartDate;
  let start = null, lastYmd = '';
  const max = {};
  SESSIONS.forEach(s => max[s] = 0);
  max['Họp Huynh Trưởng'] = 0;

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
    return Object.values(out).sort((a, b) => (a.id - b.id) || String(a.fullName).localeCompare(String(a.fullName), 'vi'));
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
  return Object.values(out).sort((a, b) => (a.id - b.id) || String(a.fullName).localeCompare(String(a.fullName), 'vi'));
}

function dtbHK(q, e) { return (q == null || q === '' || e == null || e === '') ? null : (+q + 2 * +e) / 3; }
function xepLoai(n) { return n >= 8 ? 'Giỏi' : n >= 6.5 ? 'Tiên tiến' : 'Trung bình'; }

function summaryRows(classNames, year) {
  const names = {};
  cachedRead('Students').forEach(st => {
    const sn = String(st.SaintName || '').trim();
    names[normId(st.IdNumber)] = sn ? sn + ' ' + st.FullName : st.FullName;
  });
  const archived = cachedRead('AcademicYear').filter(r => String(r.SchoolYear).trim() === year);
  if (archived.length) {
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

  classNames.forEach(cls => {
    const sheetName = getAttSheetName(cls);
    const sh = ss().getSheetByName(sheetName);
    if (!sh) return;
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowWk = row[1] instanceof Date ? fmtDate(row[1]) : String(row[1]).trim();
      if (row[0] !== year || rowWk > todayYmd) continue;
      
      const stId = normId(row[2]);
      SESSIONS.forEach(s => {
        const colInfo = SESSION_COL_MAP[s];
        if (colInfo) {
          const stVal = String(row[colInfo.sIdx] || '').trim();
          if ((stVal === 'Hiện diện' || stVal === 'Có mặt') && !isHoliday(w.nghi, rowWk, s)) {
            coBy[stId] = (coBy[stId] || 0) + 1;
          }
        }
      });
    }
  });

  return cachedRead('Scores').filter(r => r.SchoolYear === year && classNames.includes(r.ClassName)).map(s => {
    const h1 = dtbHK(s.Quiz15_S1, s.Exam_S1), h2 = dtbHK(s.Quiz15_S2, s.Exam_S2);
    const nam = (h1 !== null && h2 !== null) ? (h1 + 2 * h2) / 3 : (h1 ?? h2);
    const pct = maxTotal ? Math.round((coBy[normId(s.IdNumber)] || 0) / maxTotal * 100) : null;
    return { idNumber: s.IdNumber, fullName: names[normId(s.IdNumber)] || '', className: s.ClassName,
      avgH1: h1, avgH2: h2, avgYear: nam, attendancePct: pct, rating: nam === null ? '' : xepLoai(nam) };
  });
}

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

  getStudents: () => ({ status: 'ok', students: cachedRead('Students') }),
  getClasses:  () => ({ status: 'ok', classes: cachedRead('Classes') }),
  getTeachers: () => {
    if (ensureHeader('Users')) bustCache(['Users']);
    return { status: 'ok', users: cachedRead('Users').sort((a, b) => numId(a.Id) - numId(b.Id)), members: cachedRead('GroupMembers'), groups: cachedRead('Groups') };
  },
  getConfig:   () => ({ status: 'ok', config: config() }),

  saveClass: b => {
    upsertRows('Classes', o => o.ClassName === b.oldClassName, [{ ClassName: b.className, Grade: b.grade }]);
    return { status: 'ok' };
  },

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

  getAttendance: b => {
    const year = String(b.schoolYear || currentYear()).trim();
    const weekOf = String(b.weekOf).trim();
    const cls = normText(b.className);
    const sheetName = getAttSheetName(cls);

    const sh = ss().getSheetByName(sheetName);
    const recs = {};

    if (sh) {
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowWk = row[1] instanceof Date ? fmtDate(row[1]) : String(row[1]).trim();
        if (rowWk === weekOf) {
          const id = normId(row[2]); // IdNumber
          recs[id] = {
            'Lễ Chúa Nhật':   { status: row[4] || '', note: row[5] || '' },
            'Học Giáo Lý':     { status: row[6] || '', note: row[7] || '' },
            'Chầu Thánh Thể':  { status: row[8] || '', note: row[9] || '' },
            'Lễ Thứ Năm':     { status: row[10] || '', note: row[11] || '' }
          };
        }
      }
    }

    return { 
      status: 'ok',
      recordsByStudent: activeStudents(b.className).map(st => ({
        idNumber: st.IdNumber,
        saintName: st.SaintName || '',
        fullName: st.FullName,
        sessions: recs[normId(st.IdNumber)] || {}
      })),
      isHolidayWeek: !!isHoliday(holidays(year), b.weekOf, b.session) 
    };
  },

  saveAttendance: b => {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const year = String(b.schoolYear || currentYear()).trim();
      const weekOf = String(b.weekOf).trim();
      const cls = normText(b.className);
      const sheetName = getAttSheetName(cls);

      let sh = ss().getSheetByName(sheetName);
      if (!sh) {
        sh = ss().insertSheet(sheetName);
        sh.getRange(1, 1, 1, TAB_HEADERS.Attendance.length).setValues([TAB_HEADERS.Attendance]);
      }

      const data = sh.getDataRange().getValues();
      let modified = false;

      const incomingMap = {};
      (b.records || []).forEach(r => incomingMap[normId(r.idNumber)] = r);

      // Update existing rows
      for (let i = 1; i < data.length; i++) {
        const rowWk = data[i][1] instanceof Date ? fmtDate(data[i][1]) : String(data[i][1]).trim();
        if (rowWk === weekOf) {
          const stId = normId(data[i][2]);
          if (incomingMap[stId]) {
            const studentData = incomingMap[stId];
            SESSIONS.forEach(sess => {
              const colInfo = SESSION_COL_MAP[sess];
              if (colInfo && studentData.sessions && studentData.sessions[sess]) {
                const rec = studentData.sessions[sess];
                const normSt = (rec.status === 'Có mặt' || rec.status === 'Hiện diện') ? 'Hiện diện' : 
                               (rec.status === 'Vắng có phép' || rec.status === 'Có phép') ? 'Có phép' : rec.status;
                data[i][colInfo.sIdx] = normSt || '';
                data[i][colInfo.nIdx] = rec.note || '';
              }
            });
            delete incomingMap[stId];
            modified = true;
          }
        }
      }

      // Append new students for this week
      const activeList = activeStudents(cls);
      activeList.forEach(st => {
        const stId = normId(st.IdNumber);
        if (incomingMap[stId]) {
          const studentData = incomingMap[stId];
          const newRow = [year, weekOf, st.IdNumber, cls, '', '', '', '', '', '', '', ''];
          
          SESSIONS.forEach(sess => {
            const colInfo = SESSION_COL_MAP[sess];
            if (colInfo && studentData.sessions && studentData.sessions[sess]) {
              const rec = studentData.sessions[sess];
              const normSt = (rec.status === 'Có mặt' || rec.status === 'Hiện diện') ? 'Hiện diện' : 
                             (rec.status === 'Vắng có phép' || rec.status === 'Có phép') ? 'Có phép' : rec.status;
              newRow[colInfo.sIdx] = normSt || '';
              newRow[colInfo.nIdx] = rec.note || '';
            }
          });
          
          data.push(newRow);
          modified = true;
        }
      });

      if (modified) {
        sh.clearContents();
        sh.getRange(1, 1, data.length, data[0].length).setValues(data);
      }

      SpreadsheetApp.flush();
      bustCache([sheetName]);
      return { status: 'ok' };
    } finally {
      lock.releaseLock();
    }
  },

  getClassAttendanceStats: b => {
    const year = String(b.schoolYear || currentYear()).trim();
    const rawClassNames = b.className ? [b.className] : cachedRead('Classes').map(x => x.ClassName);
    const classNames = rawClassNames.map(c => normText(c));
    
    const activeByClass = {};
    cachedRead('Students').forEach(st => {
      if (normText(st.Status).toLowerCase() === 'hoạt động') {
        const cls = normText(st.CurrentClass);
        (activeByClass[cls] = activeByClass[cls] || []).push(st);
      }
    });

    const stats = [];
    classNames.forEach(cls => {
      const sheetName = getAttSheetName(cls);
      const sh = ss().getSheetByName(sheetName);
      if (!sh) return;

      const data = sh.getDataRange().getValues();
      const recordsById = {};

      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const id = normId(row[2]);
        (recordsById[id] = recordsById[id] || []).push(row);
      }

      const students = (activeByClass[cls] || []).sort((a, b) => genderRank(a.Gender) - genderRank(b.Gender));
      students.forEach(st => {
        const stId = normId(st.IdNumber);
        const rows = recordsById[stId] || [];
        const row = { className: cls, idNumber: st.IdNumber, fullName: st.FullName, present: {} };

        SESSIONS.forEach(ses => {
          const colInfo = SESSION_COL_MAP[ses];
          let count = 0;
          rows.forEach(r => {
            const stVal = String(r[colInfo.sIdx] || '').trim();
            if (stVal === 'Hiện diện' || stVal === 'Có mặt') count++;
          });
          row.present[ses] = count;
        });

        stats.push(row);
      });
    });

    return { status: 'ok', max: { 'Lễ Chúa Nhật': 53, 'Học Giáo Lý': 53, 'Chầu Thánh Thể': 53, 'Lễ Thứ Năm': 52 }, maxTotal: 211, stats };
  },

  searchByIdNumber: b => {
    const id = normId(b.idNumber);
    const st = cachedRead('Students').find(s => normId(s.IdNumber) === id);
    if (!st) return { status: 'ok', students: [], attendance: [], absences: [] };

    const cls = normText(st.CurrentClass);
    const sheetName = getAttSheetName(cls);
    const sh = ss().getSheetByName(sheetName);
    const absences = [];

    if (sh) {
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (normId(data[i][2]) === id) {
          const row = data[i];
          const weekYmd = row[1] instanceof Date ? fmtDate(row[1]) : String(row[1]).trim();
          
          SESSIONS.forEach(s => {
            const colInfo = SESSION_COL_MAP[s];
            const stVal = String(row[colInfo.sIdx] || '').trim();
            if (stVal !== 'Hiện diện' && stVal !== 'Có mặt' && stVal !== '') {
              absences.push({
                WeekOf: weekYmd,
                Session: s,
                AttendanceStatus: stVal || 'Vắng',
                Note: row[colInfo.nIdx] || ''
              });
            }
          });
        }
      }
    }

    return { status: 'ok', students: [st], absences };
  },

  getTeacherAttendance: b => {
    const year = currentYear();
    const weekOf = String(b.weekOf).trim();
    
    const sh = ss().getSheetByName('TeacherAttendance');
    const recs = {};

    if (sh) {
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowWk = row[1] instanceof Date ? fmtDate(row[1]) : String(row[1]).trim();
        if (rowWk === weekOf) {
          const email = String(row[2] || '').toLowerCase().trim();
          recs[email] = {
            'Lễ Chúa Nhật':   { status: row[4] || '', note: row[5] || '' },
            'Học Giáo Lý':     { status: row[6] || '', note: row[7] || '' },
            'Chầu Thánh Thể':  { status: row[8] || '', note: row[9] || '' },
            'Lễ Thứ Năm':     { status: row[10] || '', note: row[11] || '' },
            'Họp Huynh Trưởng':{ status: row[12] || '', note: row[13] || '' }
          };
        }
      }
    }

    return { 
      status: 'ok', 
      recordsByTeacher: rosterFor(b.sector).map(u => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        saintName: u.saintName,
        className: u.className,
        sessions: recs[u.email.toLowerCase()] || {}
      })), 
      isHolidayWeek: !!isHoliday(holidays(year), b.weekOf, b.session) 
    };
  },

  saveTeacherAttendance: b => {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const year = currentYear();
      const weekOf = String(b.weekOf).trim();

      let sh = ss().getSheetByName('TeacherAttendance');
      if (!sh) {
        sh = ss().insertSheet('TeacherAttendance');
        sh.getRange(1, 1, 1, TAB_HEADERS.TeacherAttendance.length).setValues([TAB_HEADERS.TeacherAttendance]);
      }

      const data = sh.getDataRange().getValues();
      let modified = false;
      const incomingMap = {};
      (b.records || []).forEach(r => incomingMap[String(r.email || '').toLowerCase().trim()] = r);

      for (let i = 1; i < data.length; i++) {
        const rowWk = data[i][1] instanceof Date ? fmtDate(data[i][1]) : String(data[i][1]).trim();
        if (rowWk === weekOf) {
          const emailKey = String(data[i][2] || '').toLowerCase().trim();
          if (incomingMap[emailKey]) {
            const teacherData = incomingMap[emailKey];
            TEACHER_SESSIONS.forEach(sess => {
              const colInfo = SESSION_COL_MAP[sess];
              if (colInfo && teacherData.sessions && teacherData.sessions[sess]) {
                const rec = teacherData.sessions[sess];
                const normSt = (rec.status === 'Có mặt' || rec.status === 'Hiện diện') ? 'Hiện diện' : 
                               (rec.status === 'Vắng có phép' || rec.status === 'Có phép') ? 'Có phép' : rec.status;
                data[i][colInfo.sIdx] = normSt || '';
                data[i][colInfo.nIdx] = rec.note || '';
              }
            });
            delete incomingMap[emailKey];
            modified = true;
          }
        }
      }

      const roster = rosterFor(b.sector);
      roster.forEach(u => {
        const emailKey = String(u.email).toLowerCase().trim();
        if (incomingMap[emailKey]) {
          const teacherData = incomingMap[emailKey];
          const newRow = [year, weekOf, u.email, u.className || 'Xứ đoàn', '', '', '', '', '', '', '', '', '', ''];
          
          TEACHER_SESSIONS.forEach(sess => {
            const colInfo = SESSION_COL_MAP[sess];
            if (colInfo && teacherData.sessions && teacherData.sessions[sess]) {
              const rec = teacherData.sessions[sess];
              const normSt = (rec.status === 'Có mặt' || rec.status === 'Hiện diện') ? 'Hiện diện' : 
                             (rec.status === 'Vắng có phép' || rec.status === 'Có phép') ? 'Có phép' : rec.status;
              newRow[colInfo.sIdx] = normSt || '';
              newRow[colInfo.nIdx] = rec.note || '';
            }
          });
          
          data.push(newRow);
          modified = true;
        }
      });

      if (modified) {
        sh.clearContents();
        sh.getRange(1, 1, data.length, data[0].length).setValues(data);
      }

      SpreadsheetApp.flush();
      bustCache(['TeacherAttendance']);
      return { status: 'ok' };
    } finally {
      lock.releaseLock();
    }
  },

  getTeacherStats: b => {
    const year = currentYear();
    const roster = rosterFor(b.sector).filter(u => !b.className || normText(u.className) === normText(b.className));
    const emails = new Set(roster.map(u => u.email.toLowerCase()));
    
    const by = {};
    const sh = ss().getSheetByName('TeacherAttendance');
    if (sh) {
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[0] !== year) continue;
        const email = String(row[2] || '').toLowerCase().trim();
        if (!emails.has(email)) continue;

        TEACHER_SESSIONS.forEach(s => {
          const colInfo = SESSION_COL_MAP[s];
          if (colInfo) {
            const stVal = String(row[colInfo.sIdx] || '').trim();
            if (stVal === 'Hiện diện' || stVal === 'Có mặt') {
              const k = email + '|' + normText(s);
              by[k] = (by[k] || 0) + 1;
            }
          }
        });
      }
    }

    const stats = roster.map(u => {
      const e = u.email.toLowerCase();
      const present = {};
      TEACHER_SESSIONS.forEach(s => present[s] = by[e + '|' + normText(s)] || 0);
      return { id: u.id, email: u.email, fullName: u.fullName, className: u.className, taught: 0, present };
    });

    return { status: 'ok', max: { 'Lễ Chúa Nhật': 53, 'Học Giáo Lý': 53, 'Chầu Thánh Thể': 53, 'Lễ Thứ Năm': 52, 'Họp Huynh Trưởng': 53 }, maxTotal: 264, stats };
  },

  getTeacherTrichLuc: b => {
    const year = b.schoolYear || currentYear();
    const email = String(b.teacherEmail || '').toLowerCase();
    const u = cachedRead('Users').find(x => String(x.Email).toLowerCase() === email);
    if (!u) return { status: 'ok', teacher: null, absences: [] };

    const absences = [];
    const sh = ss().getSheetByName('TeacherAttendance');
    if (sh) {
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[0] !== year) continue;
        const rowEmail = String(row[2] || '').toLowerCase().trim();
        if (rowEmail === email) {
          const weekYmd = row[1] instanceof Date ? fmtDate(row[1]) : String(row[1]).trim();
          TEACHER_SESSIONS.forEach(s => {
            const colInfo = SESSION_COL_MAP[s];
            if (colInfo) {
              const stVal = String(row[colInfo.sIdx] || '').trim();
              if (stVal !== 'Hiện diện' && stVal !== 'Có mặt' && stVal !== '') {
                absences.push({ WeekOf: weekYmd, Session: s, Status: stVal || 'Vắng', Note: row[colInfo.nIdx] || '' });
              }
            }
          });
        }
      }
    }
    return { status: 'ok', teacher: { email: u.Email, fullName: u.FullName || '', saintName: u.SaintName || '' }, absences };
  },

  getTeaching: b => {
    const year = b.schoolYear || currentYear();
    const by = {};
    readAll('Teaching').forEach(r => {
      if (r.SchoolYear !== year || (b.weekOf && r.WeekOf !== b.weekOf)) return;
      by[r.SchoolYear + '|' + r.WeekOf + '|' + r.ClassName] = r;
    });
    let records = Object.values(by);
    if (b.className) records = records.filter(r => r.ClassName === b.className);
    records.sort((a, b) => String(b.WeekOf).localeCompare(String(a.WeekOf)));
    const total = records.length;

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

  testDrive: () => {
    const r = { folderId: config().DriveFolderId || '' };
    try { r.rootName = DriveApp.getRootFolder().getName(); } catch (e) { r.rootError = String(e); }
    if (r.folderId) {
      try { r.folderName = DriveApp.getFolderById(r.folderId).getName(); } catch (e) { r.folderError = String(e); }
    }
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

  getScores: b => {
    const year = b.schoolYear || currentYear();
    const scores = cachedRead('Scores').filter(r =>
      r.SchoolYear === year && (!b.className || r.ClassName === b.className));
    return { status: 'ok', scores };
  },

  saveScores: b => saveScoresOptimized(b),

  getSummary: b => {
    const year = b.schoolYear || currentYear();
    const classNames = b.className ? [b.className] : cachedRead('Classes').map(x => x.ClassName);
    return { status: 'ok', summary: summaryRows(classNames, year) };
  },

  getYearOptions: () => {
    const set = new Set([currentYear()]);
    ['AcademicYear', 'Scores'].forEach(t =>
      cachedRead(t).forEach(r => { if (r.SchoolYear) set.add(String(r.SchoolYear).trim()); }));
    return { status: 'ok', years: [...set].sort() };
  },

  getHolidays: b => {
    const year = b.schoolYear || currentYear();
    const list = cachedRead('Holidays').filter(o => String(o.SchoolYear) === year)
      .map(o => ({ weekOf: o.WeekOf, session: o.Session || '', reason: o.Reason || '' }))
      .sort((x, y) => String(x.weekOf).localeCompare(String(y.weekOf)) || String(x.session).localeCompare(String(y.session)));
    return { status: 'ok', holidays: list };
  },

  saveHolidays: b => {
    const year = currentYear();
    const rows = (b.holidays || []).map(h => ({ SchoolYear: year, WeekOf: h.weekOf, Session: h.session || '', Reason: h.reason || '' }));
    upsertRows('Holidays', o => String(o.SchoolYear) === year, rows);
    return { status: 'ok', ok: true };
  },

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
    const saved = cachedRead('Users').find(u => String(u.Email).toLowerCase() === email);
    return { status: 'ok', user: saved || row };
  },

  saveGroupMembers: b => {
    (b.assignments || []).forEach(a => {
      const email = String(a.email || '').trim().toLowerCase();
      if (!email) return;
      upsertRows('GroupMembers', o => String(o.Email).toLowerCase() === email,
        (a.groups || []).map(g => ({ GroupName: g, Email: email })));
    });
    return { status: 'ok', ok: true };
  },

  startSchoolYear: b => {
    const oldYear = config().CurrentSchoolYear || currentYear();
    const [a, c] = oldYear.split('-');
    const newYear = (+a + 1) + '-' + (+c + 1);
    const order = cachedRead('Classes').map(cl => cl.ClassName);
    upsertRows('AcademicYear', o => String(o.SchoolYear) === oldYear,
      summaryRows(order, oldYear).map(r => ({ SchoolYear: oldYear, IdNumber: r.idNumber, ClassName: r.className,
        HK1Score: r.avgH1, HK2Score: r.avgH2, YearScore: r.avgYear, YearAttendant: r.attendancePct, Status: r.rating })));
    
    order.forEach(c => {
      const sheetName = getAttSheetName(c);
      if (ss().getSheetByName(sheetName)) upsertRows(sheetName, () => true, []);
    });
    
    ['TeacherAttendance', 'Holidays'].forEach(n => upsertRows(n, () => true, []));
    const st = cachedRead('Students').map(s => {
      if (String(s.Status).toLowerCase() !== 'hoạt động') return s;
      const i = order.indexOf(s.CurrentClass);
      return (i >= 0 && i < order.length - 1) ? { ...s, CurrentClass: order[i + 1] } : s;
    });
    upsertRows('Students', () => false, st);
    upsertRows('Config', o => o.Key === 'CurrentSchoolYear', [{ Key: 'CurrentSchoolYear', Value: newYear }]);
    if (b.attendanceStartDate) upsertRows('Config', o => o.Key === 'AttendanceStartDate', [{ Key: 'AttendanceStartDate', Value: b.attendanceStartDate }]);
    return { status: 'ok', newYear };
  }
};