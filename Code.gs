/**
 * SỔ THIẾU NHI — Apps Script dịch vụ lưu trữ (web app, chỉ doPost)
 * Hybrid 1-Week-Per-Row Attendance Support (12 Cols Student / 14 Cols Teacher)
 * PERFORMANCE OPTIMIZED: Hash Maps, Bounded Date-Stats, Non-blocking Drive Ops, Static Cache Bounding
 */

const TAB_HEADERS = {
  Users:             ['Email', 'SaintName', 'FullName', 'Status', 'Id', 'SDT'],
  Groups:            ['GroupName', 'Type', 'Scope', 'Description'],
  GroupMembers:      ['GroupName', 'Email'],
  Classes:           ['ClassName', 'Grade'],
  Students:          ['IdNumber', 'SaintName', 'FullName', 'DateOfBirth', 'Gender', 'Father', 'FatherNumber', 'Mother', 'MotherNumber', 'CurrentClass', 'EnrollYear', 'Status', 'Photo', 'Siblings', 'Note', 'ListOrder'],  
  Teaching:          ['SchoolYear', 'WeekOf', 'ClassName', 'TeacherEmail', 'LessonContent', 'LessonPlanUrl', 'LessonPlanNames', 'RevisedPlanUrl', 'RevisedPlanNames', 'UpdatedBy'],
  Scores:            ['SchoolYear', 'IdNumber', 'ClassName', 'Quiz15_S1', 'Exam_S1', 'Quiz15_S2', 'Exam_S2'],
  Config:            ['Key', 'Value'],
  Holidays:          ['SchoolYear', 'WeekOf', 'Session', 'Reason'],
  AcademicYear:      ['SchoolYear', 'IdNumber', 'ClassName', 'HK1Score', 'HK2Score', 'YearScore', 'YearAttendant', 'Status'],
  Attendance:        ['SchoolYear', 'WeekOf', 'IdNumber', 'ClassName', 'LeChuaNhat_Status', 'LeChuaNhat_Note', 'HocGiaoLy_Status', 'HocGiaoLy_Note', 'ChauThanhThe_Status', 'ChauThanhThe_Note', 'LeThu5_Status', 'LeThu5_Note'],
  TeacherAttendance: ['SchoolYear', 'WeekOf', 'TeacherEmail', 'ClassName', 'LeChuaNhat_Status', 'LeChuaNhat_Note', 'HocGiaoLy_Status', 'HocGiaoLy_Note', 'ChauThanhThe_Status', 'ChauThanhThe_Note', 'LeThu5_Status', 'LeThu5_Note', 'HopHuynhTruong_Status', 'HopHuynhTruong_Note']
};

const SHEETS = {
  ATTENDANCE: 'Attendance',
  STUDENTS: 'Students',
  CLASSES: 'Classes',
  CONFIG: 'Config',
  HOLIDAYS: 'Holidays'
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
const CACHE_TTL = 21600; // Maximized to 6 hours
const CHUNK = 90000;

let __ss = null;
function ss() {
  if (!__ss) {
    __ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  }
  return __ss;
}

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

/* ---------- Cache Warming (Background Trigger) ---------- */
function warmUpCache() {
  console.log("Starting full cache warmup...");
  const allSheets = ss().getSheets();
  
  allSheets.forEach(sh => {
    const sheetName = sh.getName();
    try {
      const data = readAll(sheetName); 
      const lock = LockService.getScriptLock();
      if (lock.tryLock(5000)) {
        writeCache(sheetName, data);
        lock.releaseLock();
        console.log(`Cached sheet: ${sheetName} (${data.length} rows)`);
      }
    } catch (e) {
      console.error(`Failed to cache sheet ${sheetName}:`, e);
    }
  });
}

/* ---------- Core Helpers ---------- */
function getSheet(name) { return ss().getSheetByName(name); }

const fmtDate = d => {
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
};

const normId = s => String(s ?? '').replace(/^['0]+/, '').trim();
const numId = v => { const n = +v; return Number.isFinite(n) ? n : 0; };
const normText = s => String(s ?? '').normalize('NFC').trim();

function parseIso(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  const parts = String(dateStr).split('-');
  if (parts.length === 3) return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0);
  return new Date(dateStr);
}

function toYmd(dateObj) {
  const d = parseIso(dateObj);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getAttSheetName(className) { return className ? ('Att_' + normText(className)) : 'Att_Chiên Con'; }

function genderRank(v) {
  const g = String(v ?? '').normalize('NFC').trim().toLowerCase();
  return g === 'nữ' ? 0 : g === 'nam' ? 1 : 2;
}

function activeStudents(className) {
  const targetClass = normText(className);
  return cachedRead('Students').filter(s => normText(s.CurrentClass) === targetClass && normText(s.Status).toLowerCase() === 'hoạt động')
    .sort((a, b) => genderRank(a.Gender) - genderRank(b.Gender));
}

function rowObj(head, r) {
  const o = {};
  head.forEach((h, i) => {
    let val = r[i];
    if (val instanceof Date) o[h] = fmtDate(val);
    else if (['IdNumber', 'SchoolYear', 'ClassName', 'TeacherEmail'].includes(h)) o[h] = String(val).trim(); 
    else if (typeof val === 'string') o[h] = val.trim(); 
    else o[h] = val;
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
      if (String(r[0]) !== '' && !String(r[ci] ?? '').trim()) sh.getRange(i + 2, ci + 1).setValue(next++);
    });
  } finally { lock.releaseLock(); }
  bustCache(['Users']);
}

function writeCache(name, data) {
  const cache = CacheService.getScriptCache();
  const s = JSON.stringify(data);
  const chunks = {};
  const maxChunks = Math.ceil(s.length / CHUNK);

  for (let i = 0; i < s.length; i += CHUNK) {
    chunks['tab_' + name + '_' + (i / CHUNK)] = s.slice(i, i + CHUNK);
  }
  chunks['tab_' + name + '_n'] = String(maxChunks);

  if (maxChunks > 0) cache.putAll(chunks, CACHE_TTL);
}

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
  writeCache(name, data);
  return data;
}

function bustCache(names) { 
  const cache = CacheService.getScriptCache();
  if (!names || names.length === 0) {
    const sheets = ss().getSheets();
    const allKeys = sheets.map(sh => 'tab_' + sh.getName() + '_n');
    cache.removeAll(allKeys);
  } else {
    cache.removeAll(names.map(n => 'tab_' + n + '_n')); 
  }
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
    
    let matchIdxs = [];
    for (let r = 1; r < values.length; r++) {
      const o = rowObj(head, values[r]);
      if (predicate(o)) matchIdxs.push(r);
    }

    let finalValues = [...values];

    if (matchIdxs.length === 1 && newRows && newRows.length === 1) {
      const targetRow = matchIdxs[0] + 1; 
      const payloadRow = head.map(h => newRows[0][h] !== undefined ? newRows[0][h] : '');
      sh.getRange(targetRow, 1, 1, head.length).setValues([payloadRow]);
      finalValues[matchIdxs[0]] = payloadRow;
    } else if (matchIdxs.length === 0 && newRows && newRows.length > 0) {
      const payload = newRows.map(r => head.map(h => r[h] !== undefined ? r[h] : ''));
      sh.getRange(sh.getLastRow() + 1, 1, payload.length, head.length).setValues(payload);
      finalValues.push(...payload);
    } else {
      const kept = [head];
      values.slice(1).forEach(r => {
        const o = rowObj(head, r);
        if (!predicate(o)) kept.push(r);
      });
      if (newRows && newRows.length > 0) {
        newRows.forEach(r => kept.push(head.map(h => r[h] !== undefined ? r[h] : '')));
      }
      const oldRows = values.length;
      sh.getRange(1, 1, kept.length, head.length).setValues(kept);
      if (oldRows > kept.length) sh.getRange(kept.length + 1, 1, oldRows - kept.length, head.length).clearContent();
      finalValues = kept;
    }
    
    finalValues.shift();
    writeCache(name, finalValues.map(r => rowObj(head, r)));

  } finally { lock.releaseLock(); }
}

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
      if (!isTarget && String(row[0]) !== '') keptRows.push(row);
    }

    const newStudents = b.students || [];
    newStudents.forEach(s => {
      const rowMap = {
        SchoolYear: b.schoolYear, IdNumber: s.idNumber, ClassName: b.className,
        Quiz15_S1: s.quiz15s1 || '', Exam_S1: s.exams1 || '', Quiz15_S2: s.quiz15s2 || '', Exam_S2: s.exams2 || ''
      };
      keptRows.push(head.map(h => rowMap[h] !== undefined ? rowMap[h] : ''));
    });

    const oldLength = values.length;
    sh.getRange(1, 1, keptRows.length, head.length).setValues(keptRows);
    if (oldLength > keptRows.length) sh.getRange(keptRows.length + 1, 1, oldLength - keptRows.length, head.length).clearContent();

    writeCache('Scores', keptRows.slice(1).map(r => rowObj(head, r)));
    return { status: 'ok', students: newStudents };
  } finally { lock.releaseLock(); }
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
function getOrCreateSubFolder(parentFolder, folderName) {
  if (!folderName) return parentFolder;
  const it = parentFolder.getFoldersByName(folderName);
  if (it.hasNext()) return it.next();
  return parentFolder.createFolder(folderName);
}

function teachFolder(year, weekOf, className, role) {
  const rootId = config().DriveFolderId;
  const root = rootId ? DriveApp.getFolderById(rootId) : DriveApp.getRootFolder();
  const yName = sanitize(year), cName = sanitize(className), wName = sanitize(weekOf), rName = sanitize(role);
  if (!yName || !cName || !wName || !rName) return root;

  const finalKey = 'tfolder_' + [yName, cName, wName, rName].join('_');
  const ps = PropertiesService.getScriptProperties();
  const cachedId = ps.getProperty(finalKey);
  if (cachedId) { try { return DriveApp.getFolderById(cachedId); } catch (e) {} }
  
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const cachedIdAfterLock = ps.getProperty(finalKey);
    if (cachedIdAfterLock) { try { return DriveApp.getFolderById(cachedIdAfterLock); } catch (e) {} }

    let cur = root;
    cur = getOrCreateSubFolder(cur, yName);
    cur = getOrCreateSubFolder(cur, cName);
    cur = getOrCreateSubFolder(cur, wName);
    cur = getOrCreateSubFolder(cur, rName);
    ps.setProperty(finalKey, cur.getId());
    return cur;
  } finally { lock.releaseLock(); }
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

function holidays() {
  const set = {};
  cachedRead('Holidays').forEach(h => {
    set[h.WeekOf + '|' + (h.Session || '')] = true;
  });
  return set;
}

const isHoliday = (set, weekOf, session) => set[weekOf + '|' + session] || set[weekOf + '|'];

function extractDriveFolderUrl(urlStr) {
  if (!urlStr) return '';
  const firstUrl = String(urlStr).split(',')[0].trim();
  const m = firstUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || firstUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? 'https://drive.google.com/file/d/' + m[1] + '/view' : firstUrl;
}

function activeUsers() { return cachedRead('Users').filter(u => String(u.Status).toLowerCase() === 'hoạt động'); }

function rosterFor(sector) {
  if (sector === XUDOAN) {
    const adminGroups = new Set();
    cachedRead('Groups').forEach(g => { if (g.Type === 'Quản trị') adminGroups.add(normText(g.GroupName)); });
    const activeMap = {};
    activeUsers().forEach(u => activeMap[String(u.Email).toLowerCase()] = u);
    const out = {};
    cachedRead('GroupMembers').forEach(m => {
      if (!adminGroups.has(normText(m.GroupName))) return;
      const u = activeMap[String(m.Email || '').toLowerCase()];
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
  const activeMap = {};
  activeUsers().forEach(u => activeMap[String(u.Email).toLowerCase()] = u);
  const out = {};
  cachedRead('GroupMembers').forEach(m => {
    const cls = clsOfGroup[normText(m.GroupName)];
    if (!cls || !sectorClasses.has(cls)) return;
    const u = activeMap[String(m.Email || '').toLowerCase()];
    if (u) out[String(u.Email).toLowerCase()] = { email: u.Email, fullName: u.FullName || '', saintName: u.SaintName || '', className: cls, id: numId(u.Id) };
  });
  return Object.values(out).sort((a, b) => (a.id - b.id) || String(a.fullName).localeCompare(String(a.fullName), 'vi'));
}

function dtbHK(q, e) { return (q == null || q === '' || e == null || e === '') ? null : (+q + 2 * +e) / 3; }
function xepLoai(n) { return n >= 8 ? 'Giỏi' : n >= 6.5 ? 'Tiên tiến' : 'Trung bình'; }

function getValidSessionsCount(startIso, endIso, holidaysList, sessionList = SESSIONS) {
  if (!startIso) return { max: {}, maxTotal: 0, holidayMap: {} };
  
  const start = parseIso(startIso);
  const end = endIso ? parseIso(endIso) : new Date();
  const today = new Date();
  
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const limitDate = today < end ? today : end;
  
  const holidayMap = {};
  (holidaysList || []).forEach(h => {
    const d = toYmd(h.WeekOf);
    if (!holidayMap[d]) holidayMap[d] = {};
    const sess = String(h.Session || '').trim();
    if (sess === '') holidayMap[d]['All'] = true;
    else holidayMap[d][sess] = true;
  });
  
  const max = {};
  sessionList.forEach(s => max[s] = 0);
  let maxTotal = 0;

  let d = new Date(start);
  while (d <= limitDate) {
    const currentYmd = toYmd(d);
    const hols = holidayMap[currentYmd] || {};
    if (!hols['All']) {
      sessionList.forEach(sess => {
        if (!hols[sess]) {
          max[sess]++;
          maxTotal++;
        }
      });
    }
    d.setDate(d.getDate() + 7);
  }
  return { max, maxTotal, holidayMap };
}

function getClassAttendanceStats(year, className, startDate) {
  const cfg = config();
  const startIso = startDate || cfg.AttendanceStartDate;
  const endIso = toYmd(new Date());
  const holList = cachedRead('Holidays') || [];
  const { max, maxTotal, holidayMap } = getValidSessionsCount(startIso, endIso, holList);

  const data = cachedRead(getAttSheetName(className));
  const todayYmd = toYmd(new Date());
  const startYmd = toYmd(parseIso(startIso));
  const stats = {};

  for (const row of data) {
    const rowYear = String(row.SchoolYear).trim();
    const rowWk = String(row.WeekOf).trim();
    const id = normId(row.IdNumber);

    if (rowYear !== String(year).trim() || rowWk > todayYmd || rowWk < startYmd) continue;

    if (!stats[id]) stats[id] = { 'Lễ Chúa Nhật': 0, 'Học Giáo Lý': 0, 'Chầu Thánh Thể': 0, 'Lễ Thứ Năm': 0, total: 0 };
    const hols = holidayMap[rowWk] || {};
    if (hols['All']) continue;

    SESSIONS.forEach(s => {
      if (hols[s]) return;
      const colInfo = SESSION_COL_MAP[s];
      if (colInfo) {
        const stVal = String(row[colInfo.status] || '').trim();
        if (stVal === 'Hiện diện' || stVal === 'Có mặt') {
          stats[id][s]++;
          stats[id].total++;
        }
      }
    });
  }
  return { status: 'ok', max, maxTotal, stats };
}

function getHocBaData(year, className) {
  const cfg = config();
  const holList = (cachedRead('Holidays') || []).filter(h => String(h.SchoolYear) === String(year));
  const startIso = cfg.AttendanceStartDate;
  const { max: maxPerSession, maxTotal: maxTotalOverall, holidayMap } = getValidSessionsCount(startIso, toYmd(new Date()), holList);

  const activeSts = activeStudents(className);
  const studentMap = {};
  activeSts.forEach(s => {
    const id = normId(s.IdNumber);
    studentMap[id] = {
      IdNumber: s.IdNumber, FullName: s.FullName, ClassName: className,
      sessions: { 'Lễ Chúa Nhật': 0, 'Học Giáo Lý': 0, 'Chầu Thánh Thể': 0, 'Lễ Thứ Năm': 0 },
      totalPresent: 0, maxPerSession: maxPerSession, maxTotalOverall: maxTotalOverall, pct: 0
    };
  });

  const data = cachedRead(getAttSheetName(className));
  const todayYmd = toYmd(new Date());
  const startYmd = toYmd(parseIso(startIso));

  for (const row of data) {
    const rowYear = String(row.SchoolYear).trim();
    const rowWk = String(row.WeekOf).trim();
    const id = normId(row.IdNumber);

    if (rowYear !== String(year).trim() || rowWk > todayYmd || rowWk < startYmd || !studentMap[id]) continue;
    
    const hols = holidayMap[rowWk] || {};
    if (hols['All']) continue;
    
    SESSIONS.forEach(sess => {
      if (hols[sess]) return;
      const colInfo = SESSION_COL_MAP[sess];
      if (colInfo) {
        const stVal = String(row[colInfo.status] || '').trim();
        if (stVal === 'Hiện diện' || stVal === 'Có mặt') {
          studentMap[id].sessions[sess]++;
          studentMap[id].totalPresent++;
        }
      }
    });
  }

  const hocBaList = Object.values(studentMap).map(student => {
    const pct = maxTotalOverall > 0 ? Math.round((student.totalPresent / maxTotalOverall) * 100) : 0;
    const sessionPct = {};
    SESSIONS.forEach(sess => {
      const maxForThisSession = maxPerSession[sess] || 0;
      sessionPct[sess] = maxForThisSession > 0 ? Math.round((student.sessions[sess] / maxForThisSession) * 100) : 0;
    });
    return { ...student, pct: pct, sessionPct: sessionPct };
  });

  return { status: 'ok', maxPerSession: maxPerSession, maxTotalOverall: maxTotalOverall, data: hocBaList };
}

function summaryRows(year, list) {
  const cfg = config();
  const startIso = cfg.AttendanceStartDate;
  
  const holList = (cachedRead('Holidays') || []).filter(h => String(h.SchoolYear) === String(year));
  const { maxTotal, holidayMap } = getValidSessionsCount(startIso, toYmd(new Date()), holList);

  const todayYmd = toYmd(new Date());
  const startYmd = toYmd(parseIso(startIso));
  const coBy = {};

  // OPTIMIZATION 2: Map Lookup for Scores O(1)
  const scoreMap = {};
  cachedRead('Scores').forEach(sc => { 
    if (String(sc.SchoolYear).trim() === String(year).trim()) {
      scoreMap[normId(sc.IdNumber)] = sc;
    }
  });

  const attDataCache = {};
  const getAttDataForClass = (clsName) => {
    const key = normText(clsName);
    if (attDataCache[key] !== undefined) return attDataCache[key];
    attDataCache[key] = cachedRead(getAttSheetName(clsName));
    return attDataCache[key];
  };

  const processedClasses = new Set();

  (list || []).forEach(st => {
    const cls = st.CurrentClass || st.className;
    
    if (!cls || processedClasses.has(cls)) return;
    processedClasses.add(cls);
    
    const data = getAttDataForClass(cls);
    if (!data || data.length === 0) return;

    for (const row of data) {
      const rowYear = String(row.SchoolYear).trim();
      const rowWk = String(row.WeekOf).trim();
      const id = normId(row.IdNumber);

      if (rowYear !== String(year).trim() || rowWk > todayYmd || rowWk < startYmd) continue;
      const hols = holidayMap[rowWk] || {};
      if (hols['All']) continue;

      SESSIONS.forEach(s => {
        if (hols[s]) return;
        const colInfo = SESSION_COL_MAP[s];
        if (colInfo) {
          const stVal = String(row[colInfo.status] || '').trim();
          if (stVal === 'Hiện diện' || stVal === 'Có mặt') coBy[id] = (coBy[id] || 0) + 1;
        }
      });
    }
  });

  return (list || []).map(s => {
    const id = normId(s.IdNumber || s.idNumber);
    const totalPresent = coBy[id] || 0;
    const pct = maxTotal ? Math.round((totalPresent / maxTotal) * 100) : 0;
    const sc = scoreMap[id] || {};
    const avgH1 = dtbHK(sc.Quiz15_S1, sc.Exam_S1);
    const avgH2 = dtbHK(sc.Quiz15_S2, sc.Exam_S2);

    let avgYear = null;
    if (avgH1 !== null && avgH2 !== null) avgYear = (avgH1 + 2 * avgH2) / 3;
    else if (avgH1 !== null) avgYear = avgH1;
    else if (avgH2 !== null) avgYear = avgH2;
    const rating = avgYear !== null ? xepLoai(avgYear) : '';

    return { 
      ...s, totalPresent, maxTotal, pct, 
      avgH1: avgH1 !== null ? Number(avgH1.toFixed(1)) : '', 
      avgH2: avgH2 !== null ? Number(avgH2.toFixed(1)) : '', 
      avgYear: avgYear !== null ? Number(avgYear.toFixed(1)) : '', 
      rating 
    };
  });
}

/* ---------- Background Cleanup Task ---------- */
function processPendingTrashFiles() {
  const ps = PropertiesService.getScriptProperties();
  const queue = JSON.parse(ps.getProperty('PENDING_TRASH_FILES') || '[]');
  if (!queue.length) return;

  console.log('Bắt đầu dọn dẹp ' + queue.length + ' file rác trong hàng đợi...');
  const remaining = [];

  queue.forEach(fileId => {
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
      console.log('Đã chuyển vào thùng rác file:', fileId);
    } catch (e) {
      console.error('Lỗi khi xóa file ' + fileId + ':', e.message);
      // Nếu lỗi tạm thời, giữ lại để thử lại lần sau
      if (!e.message.includes('File not found')) {
        remaining.push(fileId);
      }
    }
  });

  ps.setProperty('PENDING_TRASH_FILES', JSON.stringify(remaining));
}

/* ---------- ACTIONS ---------- */
const ACTIONS = {

  // OPTIMIZATION 2: O(1) Hash Map for User Lookup
  getUser: b => {
    const email = String(b.email || '').toLowerCase();
    const usersMap = {};
    cachedRead('Users').forEach(r => {
      usersMap[String(r.Email).toLowerCase()] = { 
        email, 
        fullName: r.FullName || email, 
        saintName: r.SaintName || '', 
        status: r.Status 
      };
    });
    
    const u = usersMap[email];
    if (!u) return { status: 'error', message: 'Email ' + email + ' chưa được cấp quyền. Liên hệ admin.' };
    if (String(u.status).toLowerCase() !== 'hoạt động') return { status: 'error', message: 'Tài khoản đã bị khóa.' };
    
    const byName = {};
    cachedRead('Groups').forEach(g => byName[g.GroupName] = { name: g.GroupName, type: g.Type, scope: g.Scope });
    const groups = [];
    cachedRead('GroupMembers').forEach(m => {
      if (String(m.Email).toLowerCase() === email && byName[m.GroupName]) groups.push(byName[m.GroupName]);
    });
    return { status: 'ok', session: { email: u.email, fullName: u.fullName, groups, classes: cachedRead('Classes').map(c => c.ClassName), catalog: Object.values(byName), year: currentYear() } };
  },

  getStudents: () => ({ status: 'ok', students: cachedRead('Students') }),
  getClasses:  () => ({ status: 'ok', classes: cachedRead('Classes') }),
  getTeachers: () => {
    if (ensureHeader('Users')) bustCache(['Users']);
    return { status: 'ok', users: cachedRead('Users').sort((a, b) => numId(a.Id) - numId(b.Id)), members: cachedRead('GroupMembers'), groups: cachedRead('Groups') };
  },
  getConfig:   () => ({ status: 'ok', config: config() }),

  saveConfig: b => {
    const configItems = b.config || [];
    if (!configItems.length) return { status: 'ok' };

    configItems.forEach(item => {
      const k = String(item.key).trim();
      const v = String(item.value).trim();
      upsertRows('Config', o => o.Key === k, [{ Key: k, Value: v }]);
    });

    __memoConfig = null;
    bustCache(['Config']);

    try { warmUpCache(); } catch (e) { console.error('Warmup trigger error:', e); }

    return { status: 'ok' };
  },

  getClassAttendanceStats: b => getClassAttendanceStats(b.year || b.schoolYear || currentYear(), b.className, b.startDate),
  getHocBaData: b => getHocBaData(b.year || currentYear(), b.className),
  summaryRows: b => ({ status: 'ok', data: summaryRows(b.year || currentYear(), b.list) }),

  saveClass: b => {
    upsertRows('Classes', o => o.ClassName === b.oldClassName, [{ ClassName: b.className, Grade: b.grade }]);
    return { status: 'ok' };
  },

  saveStudent: b => {
    const old = cachedRead('Students').find(s => normId(s.IdNumber) === normId(b.idNumber));
    const row = {
      IdNumber: b.idNumber, SaintName: b.saintName || '', FullName: b.fullName,
      DateOfBirth: b.dateOfBirth || '', Gender: b.gender || '', 
      Father: b.father || '', FatherNumber: b.fatherNumber || '',
      Mother: b.mother || '', MotherNumber: b.motherNumber || '',
      CurrentClass: b.className, EnrollYear: b.enrollYear || currentYear(), Status: b.status || 'Hoạt động', 
      Photo: b.photo !== undefined ? b.photo : (old ? (old.Photo || '') : ''), Note: b.note || '',
      Siblings: b.siblings || '',
      ListOrder: b.listOrder !== undefined ? b.listOrder : (old ? (old.ListOrder || '') : '')
    };
    upsertRows('Students', o => normId(o.IdNumber) === normId(b.idNumber), [row]);
    return { status: 'ok', student: row, idNumber: b.idNumber };
  },

  getAttendance: b => {
    const year = currentYear();
    const cls = String(b.className || '').trim();
    
    const sheetName = getAttSheetName(cls); 
    const data = cachedRead(sheetName) || [];
    const records = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (String(row.SchoolYear).trim() === year && String(row.ClassName).trim() === cls) {
        records.push({
          WeekOf: String(row.WeekOf).trim(),
          idNumber: String(row.IdNumber).trim(),
          sessions: {
            'Lễ Chúa Nhật':   { status: row.LeChuaNhat_Status || '', note: row.LeChuaNhat_Note || '' },
            'Học Giáo Lý':    { status: row.HocGiaoLy_Status || '', note: row.HocGiaoLy_Note || '' },
            'Chầu Thánh Thể': { status: row.ChauThanhThe_Status || '', note: row.ChauThanhThe_Note || '' },
            'Lễ Thứ Năm':     { status: row.LeThu5_Status || '', note: row.LeThu5_Note || '' }
          }
        });
      }
    }

    return { 
      status: 'ok', 
      records: records,
      holidays: holidays() 
    };
  },

  saveAttendance: b => {
    const year = currentYear();
    const cls = String(b.className || '').trim();
    
    const sheetName = getAttSheetName(cls);
    const rows = [];
    
    (b.records || []).forEach(r => {
      const s = r.sessions || {};
      rows.push({
        SchoolYear: year,
        WeekOf: b.weekOf,
        ClassName: cls,
        IdNumber: r.idNumber,
        LeChuaNhat_Status: s['Lễ Chúa Nhật']?.status || '',
        LeChuaNhat_Note: s['Lễ Chúa Nhật']?.note || '',
        HocGiaoLy_Status: s['Học Giáo Lý']?.status || '',
        HocGiaoLy_Note: s['Học Giáo Lý']?.note || '',
        ChauThanhThe_Status: s['Chầu Thánh Thể']?.status || '',
        ChauThanhThe_Note: s['Chầu Thánh Thể']?.note || '',
        LeThu5_Status: s['Lễ Thứ Năm']?.status || '',
        LeThu5_Note: s['Lễ Thứ Năm']?.note || ''
      });
    });

    upsertRows(sheetName, 
      o => String(o.SchoolYear) === year && String(o.WeekOf) === String(b.weekOf) && String(o.ClassName) === cls, 
      rows
    );

    return { status: 'ok', ok: true };
  },

  // OPTIMIZATION 2: O(1) Student Map Lookup
  searchByIdNumber: b => {
    const id = normId(b.idNumber);
    const studentsMap = {};
    cachedRead('Students').forEach(s => studentsMap[normId(s.IdNumber)] = s);
    
    const st = studentsMap[id];
    if (!st) return { status: 'ok', students: [], attendance: [], absences: [] };

    const cls = normText(st.CurrentClass);
    const data = cachedRead(getAttSheetName(cls)); 
    const absences = [];
    const todayYmd = toYmd(new Date());

    for (let i = 0; i < data.length; i++) {
      if (normId(data[i].IdNumber) === id) {
        const row = data[i];
        const weekYmd = String(row.WeekOf).trim();
        
        if (weekYmd <= todayYmd) {
          SESSIONS.forEach(s => {
            const colInfo = SESSION_COL_MAP[s];
            if (colInfo) {
              const stVal = String(row[colInfo.status] || '').trim();
              const normSt = stVal === 'Hiện diện' ? 'Hiện diện' : stVal === 'Có phép' ? 'Có phép' : 'Vắng';
              if (normSt !== 'Hiện diện') {
                absences.push({ WeekOf: weekYmd, Session: s, AttendanceStatus: normSt, Note: row[colInfo.note] || '' });
              }
            }
          });
        }
      }
    }

    return { status: 'ok', students: [st], absences };
  },

  getTeacherAttendance: b => {
    const year = currentYear();
    const sectorEmails = new Set(rosterFor(b.sector).map(u => u.email.toLowerCase()));
    
    const data = cachedRead('TeacherAttendance');
    const records = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (String(row.SchoolYear).trim() === year) {
        const email = String(row.TeacherEmail || '').toLowerCase().trim();
        
        if (sectorEmails.has(email)) {
          records.push({
            WeekOf: String(row.WeekOf).trim(),
            email: email,
            sessions: {
              'Lễ Chúa Nhật':    { status: row.LeChuaNhat_Status || '', note: row.LeChuaNhat_Note || '' },
              'Học Giáo Lý':     { status: row.HocGiaoLy_Status || '', note: row.HocGiaoLy_Note || '' },
              'Chầu Thánh Thể':  { status: row.ChauThanhThe_Status || '', note: row.ChauThanhThe_Note || '' },
              'Lễ Thứ Năm':      { status: row.LeThu5_Status || '', note: row.LeThu5_Note || '' },
              'Họp Huynh Trưởng':{ status: row.HopHuynhTruong_Status || '', note: row.HopHuynhTruong_Note || '' }
            }
          });
        }
      }
    }

    return { 
      status: 'ok', 
      records: records,
      holidays: holidays()
    };
  },

  saveTeacherAttendance: b => {
    const year = currentYear();
    const rows = [];
    const emailsToUpdate = new Set();
    
    (b.records || []).forEach(r => {
      const s = r.sessions || {};
      const email = String(r.email).toLowerCase();
      emailsToUpdate.add(email);

      rows.push({
        SchoolYear: year,
        WeekOf: b.weekOf,
        TeacherEmail: r.email,
        ClassName: r.className || '', 
        LeChuaNhat_Status: s['Lễ Chúa Nhật']?.status || '',
        LeChuaNhat_Note: s['Lễ Chúa Nhật']?.note || '',
        HocGiaoLy_Status: s['Học Giáo Lý']?.status || '',
        HocGiaoLy_Note: s['Học Giáo Lý']?.note || '',
        ChauThanhThe_Status: s['Chầu Thánh Thể']?.status || '',
        ChauThanhThe_Note: s['Chầu Thánh Thể']?.note || '',
        LeThu5_Status: s['Lễ Thứ Năm']?.status || '',
        LeThu5_Note: s['Lễ Thứ Năm']?.note || '',
        HopHuynhTruong_Status: s['Họp Huynh Trưởng']?.status || '',
        HopHuynhTruong_Note: s['Họp Huynh Trưởng']?.note || ''
      });
    });

    upsertRows('TeacherAttendance', 
      o => String(o.SchoolYear) === year && 
           String(o.WeekOf) === String(b.weekOf) && 
           emailsToUpdate.has(String(o.TeacherEmail).toLowerCase()), 
      rows
    );

    return { status: 'ok', ok: true };
  },

  getTeacherStats: b => {
    const year = currentYear();
    const cfg = config();
    const startIso = cfg.AttendanceStartDate;
    const holList = cachedRead('Holidays') || [];
    
    const { max: maxPerSession, maxTotal, holidayMap } = getValidSessionsCount(startIso, toYmd(new Date()), holList, TEACHER_SESSIONS);

    const roster = rosterFor(b.sector).filter(u => !b.className || normText(u.className) === normText(b.className));
    const emails = new Set(roster.map(u => u.email.toLowerCase()));
    
    const by = {};
    const data = cachedRead('TeacherAttendance');
    const todayYmd = toYmd(new Date());
    const startYmd = toYmd(parseIso(startIso));

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowYear = String(row.SchoolYear).trim();
      const rowWk = String(row.WeekOf).trim();
      const email = String(row.TeacherEmail || '').toLowerCase().trim();

      if (rowYear !== String(year).trim() || rowWk > todayYmd || rowWk < startYmd || !emails.has(email)) continue;

      const hols = holidayMap[rowWk] || {};
      if (hols['All']) continue;

      TEACHER_SESSIONS.forEach(s => {
        if (hols[s]) return;
        const colInfo = SESSION_COL_MAP[s];
        if (colInfo) {
          const stVal = String(row[colInfo.status] || '').trim();
          if (stVal === 'Hiện diện' || stVal === 'Có mặt') {
            const k = email + '|' + normText(s);
            by[k] = (by[k] || 0) + 1;
          }
        }
      });
    }

    const taughtCount = {};
    const teachingData = cachedRead('Teaching');
    for (let i = 0; i < teachingData.length; i++) {
      const r = teachingData[i];
      if (String(r.SchoolYear).trim() === year) {
        const email = String(r.TeacherEmail || '').toLowerCase().trim();
        if (emails.has(email)) {
          taughtCount[email] = (taughtCount[email] || 0) + 1;
        }
      }
    }

    const stats = roster.map(u => {
      const e = u.email.toLowerCase();
      const present = {};
      TEACHER_SESSIONS.forEach(s => present[s] = by[e + '|' + normText(s)] || 0);
      
      return { 
        id: u.id, 
        email: u.email, 
        fullName: u.fullName, 
        className: u.className, 
        taught: taughtCount[e] || 0,
        present 
      };
    });

    return { 
      status: 'ok', 
      max: maxPerSession, 
      maxTotal: maxTotal, 
      stats 
    };
  },

  // OPTIMIZATION 2: O(1) User Map Lookup
  getTeacherTrichLuc: b => {
    const year = b.schoolYear || currentYear();
    const email = String(b.teacherEmail || '').toLowerCase();
    
    const userMap = {};
    cachedRead('Users').forEach(x => userMap[String(x.Email).toLowerCase()] = x);
    const u = userMap[email];
    
    if (!u) return { status: 'ok', teacher: null, absences: [] };

    const absences = [];
    const data = cachedRead('TeacherAttendance');
    const todayYmd = toYmd(new Date());
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row.SchoolYear !== year) continue;
      const rowEmail = String(row.TeacherEmail || '').toLowerCase().trim();
      if (rowEmail === email) {
        const weekYmd = String(row.WeekOf).trim();
        if (weekYmd <= todayYmd) {
          TEACHER_SESSIONS.forEach(s => {
            const colInfo = SESSION_COL_MAP[s];
            if (colInfo) {
              const stVal = String(row[colInfo.status] || '').trim();
              const normSt = (stVal === 'Hiện diện' || stVal === 'Có mặt') ? 'Hiện diện' : (stVal === 'Có phép' || stVal === 'Vắng có phép') ? 'Có phép' : 'Vắng';
              if (normSt !== 'Hiện diện') {
                absences.push({ WeekOf: weekYmd, Session: s, Status: normSt, Note: row[colInfo.note] || '' });
              }
            }
          });
        }
      }
    }
    return { status: 'ok', teacher: { email: u.Email, fullName: u.FullName || '', saintName: u.SaintName || '' }, absences };
  },

  getTeaching: b => {
    const targetYear = String(b.schoolYear || currentYear()).trim();
    const allRows = cachedRead('Teaching');
    
    const records = [];
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (String(r.SchoolYear).trim() === targetYear) {
        records.push({
          SchoolYear: r.SchoolYear,
          WeekOf: String(r.WeekOf || '').trim(),
          ClassName: r.ClassName,
          TeacherEmail: r.TeacherEmail,
          LessonContent: r.LessonContent || '',
          LessonPlanUrl: r.LessonPlanUrl || '',
          LessonPlanNames: r.LessonPlanNames || (r.LessonPlanUrl ? 'Giáo án' : ''),
          RevisedPlanUrl: r.RevisedPlanUrl || '',
          RevisedPlanNames: r.RevisedPlanNames || (r.RevisedPlanUrl ? 'Bản chỉnh sửa' : ''),
          UpdatedBy: r.UpdatedBy || '',
          LessonFolderUrl: r.LessonPlanUrl ? extractDriveFolderUrl(r.LessonPlanUrl) : '',
          RevisedFolderUrl: r.RevisedPlanUrl ? extractDriveFolderUrl(r.RevisedPlanUrl) : ''
        });
      }
    }

    records.sort((a, b) => String(b.WeekOf).localeCompare(String(a.WeekOf)));
    return { status: 'ok', records: records, total: records.length };
  },

  // OPTIMIZATION 3: Non-blocking Drive operations in saveTeaching
  saveTeaching: b => {
  const old = cachedRead('Teaching').find(o =>
    o.SchoolYear === b.schoolYear && o.WeekOf === b.weekOf && o.ClassName === b.className);
  
  if (old) {
    const keep = new Set([...driveFileIds(b.lessonPlanUrl), ...driveFileIds(b.revisedPlanUrl)]);
    const toDelete = [...driveFileIds(old.LessonPlanUrl), ...driveFileIds(old.RevisedPlanUrl)]
      .filter(id => !keep.has(id));
    
    // Đẩy ID file rác vào hàng đợi PropertyService thay vì xóa trực tiếp
    if (toDelete.length > 0) {
      const ps = PropertiesService.getScriptProperties();
      const currentQueue = JSON.parse(ps.getProperty('PENDING_TRASH_FILES') || '[]');
      const updatedQueue = [...new Set([...currentQueue, ...toDelete])];
      ps.setProperty('PENDING_TRASH_FILES', JSON.stringify(updatedQueue));
    }
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

  getUploadUrl: b => {
    const folder = teachFolder(b.schoolYear, b.weekOf, b.className, b.kind === 'TBM' ? 'TBM' : 'GLV');
    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    const payload = { name: b.filename, parents: [folder.getId()] };
    const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
    if (b.origin) headers['Origin'] = b.origin;

    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      headers: headers,
      muteHttpExceptions: true
    });

    if (res.getResponseCode() !== 200) return { status: 'error', message: res.getContentText() };
    const hdrs = res.getHeaders();
    return { status: 'ok', uploadUrl: hdrs['Location'] || hdrs['location'] };
  },

  uploadFile: b => {
    const blob = Utilities.newBlob(Utilities.base64Decode(b.base64), b.mimeType, b.filename);
    let folder;
    
    if (b.isPhoto) {
      const folderId = String(config().PhotoFolder || '').trim();
      if (!folderId) return { status: 'error', message: 'Chưa cấu hình Key "PhotoFolder" trong tab Config.' };
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch(e) {
        return { status: 'error', message: 'ID PhotoFolder không hợp lệ hoặc bị từ chối truy cập.' };
      }
    } else {
      folder = teachFolder(b.schoolYear, b.weekOf, b.className, b.kind === 'TBM' ? 'TBM' : 'GLV');
    }

    const same = folder.getFilesByName(b.filename);
    while (same.hasNext()) same.next().setTrashed(true);
    
    const file = folder.createFile(blob);
    
    if (b.isPhoto) {
      const displayUrl = 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w500';
      return { status: 'ok', url: displayUrl, driveUrl: file.getUrl() };
    } else {
      return { status: 'ok', url: file.getUrl() };
    }
  },

  getScores: b => {
    const year = b.schoolYear || currentYear();
    const scores = cachedRead('Scores').filter(r =>
      r.SchoolYear === year && (!b.className || r.ClassName === b.className));
    return { status: 'ok', scores };
  },

  saveScores: b => saveScoresOptimized(b),

  getSummary: b => {
    const targetYear = String(b.schoolYear || currentYear()).trim();
    
    if (targetYear !== String(currentYear()).trim()) {
      const allSts = {};
      cachedRead('Students').forEach(s => allSts[normId(s.IdNumber)] = s);

      const history = cachedRead('AcademicYear').filter(r =>
        String(r.SchoolYear).trim() === targetYear && 
        (!b.className || normText(r.ClassName) === normText(b.className))
      ).map(r => {
        const st = allSts[normId(r.IdNumber)] || {};
        return {
          ...st,                     
          IdNumber: r.IdNumber,
          SaintName: st.SaintName || '',
          FullName: st.FullName || '',
          CurrentClass: r.ClassName, 
          ClassName: r.ClassName,
          avgH1: r.HK1Score,         
          avgH2: r.HK2Score,
          avgYear: r.YearScore,
          pct: r.YearAttendant,
          rating: r.Status           
        };
      });
      return { status: 'ok', summary: history };
    }
    
    const activeSts = cachedRead('Students').filter(s => 
      (!b.className || normText(s.CurrentClass) === normText(b.className)) && 
      normText(s.Status).toLowerCase() === 'hoạt động'
    );
    return { status: 'ok', summary: summaryRows(targetYear, activeSts) };
  },

  // OPTIMIZATION 2: O(1) Student Map Lookup
  getHocBa: b => {
    const id = normId(b.idNumber);
    const studentMap = {};
    cachedRead('Students').forEach(s => studentMap[normId(s.IdNumber)] = s);
    const st = studentMap[id];
    
    if (!st) return { status: 'error', message: 'Không tìm thấy Thiếu nhi với CCCD này.' };

    const history = cachedRead('AcademicYear').filter(r => normId(r.IdNumber) === id).map(r => ({
      SchoolYear: r.SchoolYear, ClassName: r.ClassName, HK1Score: r.HK1Score, HK2Score: r.HK2Score,
      YearScore: r.YearScore, YearAttendant: r.YearAttendant, Status: r.Status
    }));

    const currentYr = currentYear();
    let currentRec = null;
    if (st.CurrentClass && normText(st.Status).toLowerCase() === 'hoạt động') {
      const summary = summaryRows(currentYr, [st]);
      const stSum = summary.find(x => normId(x.IdNumber || x.idNumber) === id);
      if (stSum) {
        currentRec = {
          SchoolYear: currentYr, ClassName: st.CurrentClass, HK1Score: stSum.avgH1, HK2Score: stSum.avgH2,
          YearScore: stSum.avgYear, YearAttendant: stSum.pct, Status: stSum.rating
        };
      }
    }
    return { status: 'ok', student: st, history, currentRec };
  },

  getYearOptions: () => {
    const set = new Set([currentYear()]);
    ['AcademicYear', 'Scores'].forEach(t => cachedRead(t).forEach(r => { if (r.SchoolYear) set.add(String(r.SchoolYear).trim()); }));
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
      Email: email, SaintName: String(b.user.saintName || '').trim(), FullName: String(b.user.fullName || '').trim(),
      SDT: String(b.user.sdt || '').trim(), Status: b.user.status || (old && old.Status) || 'Hoạt động', Id: (old && old.Id) ?? '',
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
    const activeSts = cachedRead('Students').filter(s => String(s.Status).toLowerCase() === 'hoạt động');
    
    upsertRows('AcademicYear', o => String(o.SchoolYear) === oldYear,
      summaryRows(oldYear, activeSts).map(r => ({ 
        SchoolYear: oldYear, IdNumber: r.IdNumber || r.idNumber, ClassName: r.CurrentClass || r.className,
        HK1Score: r.avgH1 || '', HK2Score: r.avgH2 || '', YearScore: r.avgYear || '', YearAttendant: r.pct, Status: r.rating || '' 
      }))
    );
    
    const classes = cachedRead('Classes').map(cl => cl.ClassName);
    classes.forEach(c => {
      const sheetName = getAttSheetName(c);
      if (ss().getSheetByName(sheetName)) upsertRows(sheetName, () => true, []);
    });
    
    ['TeacherAttendance', 'Holidays'].forEach(n => upsertRows(n, () => true, []));
    
    const st = cachedRead('Students').map(s => {
      if (String(s.Status).toLowerCase() !== 'hoạt động') return s;
      const i = classes.indexOf(s.CurrentClass);
      return (i >= 0 && i < classes.length - 1) ? { ...s, CurrentClass: classes[i + 1] } : s;
    });
    upsertRows('Students', () => false, st);
    upsertRows('Config', o => o.Key === 'CurrentSchoolYear', [{ Key: 'CurrentSchoolYear', Value: newYear }]);
    if (b.attendanceStartDate) upsertRows('Config', o => o.Key === 'AttendanceStartDate', [{ Key: 'AttendanceStartDate', Value: b.attendanceStartDate }]);
    return { status: 'ok', newYear };
  },

  saveStudentOrder: b => {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      let sh = ss().getSheetByName('Students');
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      const idIdx = head.indexOf('IdNumber');
      const orderIdx = head.indexOf('ListOrder');
      
      if (orderIdx < 0) {
        sh.insertColumns(head.length + 1);
        sh.getRange(1, head.length + 1).setValue('ListOrder');
        bustCache(['Students']);
        return ACTIONS.saveStudentOrder(b);
      }
      
      const data = sh.getDataRange().getValues();
      const orderMap = {};
      (b.orderedIds || []).forEach((id, idx) => orderMap[normId(id)] = idx + 1);
      
      let changed = false;
      let minModifiedIdx = -1;
      let maxModifiedIdx = -1;

      for (let i = 1; i < data.length; i++) {
        const id = normId(data[i][idIdx]);
        if (orderMap[id] !== undefined) {
          if (data[i][orderIdx] !== orderMap[id]) {
            data[i][orderIdx] = orderMap[id];
            changed = true;
            if (minModifiedIdx === -1 || i < minModifiedIdx) minModifiedIdx = i;
            if (maxModifiedIdx === -1 || i > maxModifiedIdx) maxModifiedIdx = i;
          }
        }
      }
      
      if (changed) {
        if (minModifiedIdx !== -1) {
          const numRows = maxModifiedIdx - minModifiedIdx + 1;
          const chunk = data.slice(minModifiedIdx, maxModifiedIdx + 1);
          sh.getRange(minModifiedIdx + 1, 1, numRows, data[0].length).setValues(chunk);
        }
        writeCache('Students', data.slice(1).map(r => rowObj(head, r))); 
      }
      return { status: 'ok' };
    } finally { lock.releaseLock(); }
  },

  importStudents: b => {
    const rows = b.students || [];
    if (!rows.length) return { status: 'ok', count: 0 };
    
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = ss().getSheetByName('Students');
      const data = sh.getDataRange().getValues();
      const head = data[0];
      
      const idIdx = head.indexOf('IdNumber');
      const existingMap = {};
      
      for (let r = 1; r < data.length; r++) {
        existingMap[normId(data[r][idIdx])] = r;
      }

      let modified = false;
      rows.forEach(s => {
        const id = normId(s.idNumber);
        const oldRowIdx = existingMap[id];
        const oldData = oldRowIdx ? rowObj(head, data[oldRowIdx]) : null;
        
        const newRowObj = {
          IdNumber: s.idNumber,
          SaintName: s.saintName || '',
          FullName: s.fullName || '',
          DateOfBirth: s.dateOfBirth || '',
          Gender: s.gender || '',
          Father: s.father || '',
          FatherNumber: s.fatherNumber || '',
          Mother: s.mother || '',
          MotherNumber: s.motherNumber || '',
          CurrentClass: s.className,
          EnrollYear: s.enrollYear || currentYear(),
          Status: s.status || 'Hoạt động',
          Photo: s.photo !== undefined ? s.photo : (oldData ? (oldData.Photo || '') : ''),
          Note: s.note || '',
          Siblings: s.siblings || '',
          ListOrder: s.listOrder !== undefined ? s.listOrder : (oldData ? (oldData.ListOrder || '') : '')
        };
        
        const rowArr = head.map(h => newRowObj[h] !== undefined ? newRowObj[h] : '');
        
        if (oldRowIdx) {
          data[oldRowIdx] = rowArr;
        } else {
          data.push(rowArr);
          existingMap[id] = data.length - 1; 
        }
        modified = true;
      });

      if (modified) {
        sh.getRange(1, 1, data.length, head.length).setValues(data);
        writeCache('Students', data.slice(1).map(r => rowObj(head, r)));
      }
      return { status: 'ok', count: rows.length };
    } finally { lock.releaseLock(); }
  },
};