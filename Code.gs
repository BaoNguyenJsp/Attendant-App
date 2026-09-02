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
 *   Users             Email | SaintName | FullName | Status
 *   Groups            GroupName | Type | Scope | Description
 *   GroupMembers      GroupName | Email
 *   Classes           ClassName | Grade
 *   Students          IdNumber | SaintName | FullName | DateOfBirth | Gender | Father | Mother | CurrentClass | EnrollYear | Status | Note
 *   Attendance        SchoolYear | WeekOf | Session | IdNumber | ClassName | AttendanceStatus | Note
 *   TeacherAttendance SchoolYear | WeekOf | Session | TeacherEmail | Status | Note
 *   Teaching          SchoolYear | WeekOf | ClassName | TeacherEmail | LessonContent | LessonPlanUrl | RevisedPlanUrl | UpdatedBy
 *   Scores            SchoolYear | IdNumber | ClassName | Quiz15_S1 | Exam_S1 | Quiz15_S2 | Exam_S2
 *   Config            Key | Value          (CurrentSchoolYear, DriveFolderId)
 *   Holidays          SchoolYear | WeekOf | Session | Reason   (Session rỗng = nghỉ cả tuần)
 *   AcademicYear      SchoolYear | IdNumber | ClassName | YearScore | YearAttendant | Status
 */

const TAB_HEADERS = {
  Users:             ['Email', 'SaintName', 'FullName', 'Status'],
  Groups:            ['GroupName', 'Type', 'Scope', 'Description'],
  GroupMembers:      ['GroupName', 'Email'],
  Classes:           ['ClassName', 'Grade'],
  Students:          ['IdNumber', 'SaintName', 'FullName', 'DateOfBirth', 'Gender', 'Father', 'Mother', 'CurrentClass', 'EnrollYear', 'Status', 'Note'],
  Attendance:        ['SchoolYear', 'WeekOf', 'Session', 'IdNumber', 'ClassName', 'AttendanceStatus', 'Note'],
  TeacherAttendance: ['SchoolYear', 'WeekOf', 'Session', 'TeacherEmail', 'Status', 'Note'],
  Teaching:          ['SchoolYear', 'WeekOf', 'ClassName', 'TeacherEmail', 'LessonContent', 'LessonPlanUrl', 'RevisedPlanUrl', 'UpdatedBy'],
  Scores:            ['SchoolYear', 'IdNumber', 'ClassName', 'Quiz15_S1', 'Exam_S1', 'Quiz15_S2', 'Exam_S2'],
  Config:            ['Key', 'Value'],
  Holidays:          ['SchoolYear', 'WeekOf', 'Session', 'Reason'],
  AcademicYear:      ['SchoolYear', 'IdNumber', 'ClassName', 'YearScore', 'YearAttendant', 'Status'],
};

const SESSIONS = ['Lễ Chúa Nhật', 'Học Giáo Lý', 'Chầu Thánh Thể', 'Lễ Thứ Năm'];
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

// Normalizes text to ensure students aren't accidentally filtered out
function activeStudents(className) {
  const targetClass = String(className).normalize('NFC').trim();
  return cachedRead('Students').filter(s => 
    String(s.CurrentClass).normalize('NFC').trim() === targetClass && 
    String(s.Status).normalize('NFC').trim().toLowerCase() === 'hoạt động'
  );
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

function readAll(name) {
  let sh = ss().getSheetByName(name);
  if (!sh) {
    const h = TAB_HEADERS[name];
    if (!h) throw new Error('Missing tab: ' + name);
    sh = ss().insertSheet(name);
    sh.getRange(1, 1, 1, h.length).setValues([h]);
  }
  const values = sh.getDataRange().getValues();
  const head = values.shift();
  return values.filter(r => String(r[0]) !== '').map(r => rowObj(head, r));
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
  let start = null, lastYmd = '';
  if (startYmd) {
    start = sundayOf(startYmd);
    const end = new Date(); end.setDate(end.getDate() - end.getDay());
    lastYmd = fmtDate(end);
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 7))
      SESSIONS.forEach(s => { if (!isHoliday(nghi, fmtDate(d), s)) max[s]++; });
  }
  return { start, lastYmd, max, nghi };
}

function activeStudents(className) {
  return cachedRead('Students').filter(s => s.CurrentClass === className && String(s.Status).toLowerCase() === 'hoạt động');
}
function activeUsers() {
  return cachedRead('Users').filter(u => String(u.Status).toLowerCase() === 'hoạt động');
}

/* ĐTB HK = (15' + 2·HK)/3 · ĐTB năm = (HK1 + 2·HK2)/3 · xếp loại ≥8 Giỏi · ≥6.5 Tiên tiến · còn lại Trung bình */
function dtbHK(q, e) { return (q !== '' && e !== '') ? (+q + 2 * +e) / 3 : null; }
function xepLoai(n) { return n >= 8 ? 'Giỏi' : n >= 6.5 ? 'Tiên tiến' : 'Trung bình'; }

// Tổng hợp điểm + chuyên cần cho một bộ lớp (dùng chung getSummary / startSchoolYear).
function summaryRows(classNames, year) {
  const nghi = holidays(year);
  const scores = cachedRead('Scores').filter(r => r.SchoolYear === year && classNames.includes(r.ClassName));
  const att = cachedRead('Attendance').filter(r =>
    r.SchoolYear === year && classNames.includes(r.ClassName) && !isHoliday(nghi, r.WeekOf, r.Session));
  const ccBy = {};
  att.forEach(r => {
    ccBy[r.IdNumber] = ccBy[r.IdNumber] || { co: 0, tong: 0 };
    ccBy[r.IdNumber].tong++;
    if (r.AttendanceStatus === 'Hiện diện') ccBy[r.IdNumber].co++;
  });
  const names = {};
  cachedRead('Students').forEach(st => names[st.IdNumber] = st.FullName);
  return scores.map(s => {
    const h1 = dtbHK(s.Quiz15_S1, s.Exam_S1), h2 = dtbHK(s.Quiz15_S2, s.Exam_S2);
    const nam = (h1 !== null && h2 !== null) ? (h1 + 2 * h2) / 3 : (h1 ?? h2);
    const cc = ccBy[s.IdNumber];
    const pct = cc && cc.tong ? Math.round(cc.co / cc.tong * 100) : null;
    return { idNumber: s.IdNumber, fullName: names[s.IdNumber] || '', className: s.ClassName,
      avgH1: h1, avgH2: h2, avgYear: nam, attendancePct: pct, rating: nam === null ? '' : xepLoai(nam) };
  });
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
      classes: cachedRead('Classes').map(c => c.ClassName), year: currentYear(),
    } };
  },

  /* ---- Danh mục ---- */
  getStudents: () => ({ status: 'ok', students: cachedRead('Students') }),
  getClasses:  () => ({ status: 'ok', classes: cachedRead('Classes') }),
  getTeachers: () => ({ status: 'ok', users: cachedRead('Users'), members: cachedRead('GroupMembers'), groups: cachedRead('Groups') }),
  getConfig:   () => ({ status: 'ok', config: config() }),

  saveClass: b => {
    upsertRows('Classes', o => o.ClassName === b.oldClassName, [{ ClassName: b.className, Grade: b.grade }]);
    return { status: 'ok' };
  },

  // Thêm/sửa học sinh — không bao giờ xóa dòng (lịch sử tra theo CCCD)
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
         đến Chủ Nhật vừa qua, trừ tuần nghỉ. Tử số = số buổi 'Hiện diện' của từng học sinh. ---- */
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
    const records = readAll('Teaching').filter(r =>
      r.SchoolYear === year && (!b.weekOf || r.WeekOf === b.weekOf));
    return { status: 'ok', records };
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
      TeacherEmail: b.teacherEmail || '', LessonContent: b.lessonContent || '',
      LessonPlanUrl: b.lessonPlanUrl || '', RevisedPlanUrl: b.revisedPlanUrl || '',
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

  // Upload giáo án lên Drive — sheet chỉ giữ link. File kế thừa quyền public (Viewer)
  // của folder DriveFolderId (chia sẻ "Anyone with link → Viewer" trong Drive UI) —
  // không gọi setSharing để tránh cần scope auth/drive đầy đủ.
  // ponytail: không dùng được nếu folder riêng tư; đổi lại setSharing khi có auth/drive.
  uploadFile: b => {
    const folderId = config().DriveFolderId || '';
    const blob = Utilities.newBlob(Utilities.base64Decode(b.base64), b.mimeType, b.filename);
    const file = (folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder()).createFile(blob);
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

  /* ---- Trích lục theo CCCD: mọi năm (giữ nguyên cả tuần nghỉ — tra lịch sử đầy đủ) ---- */
  // Trích lục theo CCCD. absences = mọi buổi không nghỉ trong cửa sổ chuyên cần (AttendanceStartDate → nay)
  // mà học sinh chưa ghi 'Hiện diện' — kể cả tuần chưa điểm danh (không có bản ghi) để tra đủ (FR-DD-17).
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
    return { status: 'ok', students: [st], attendance: att,
      scores: cachedRead('Scores').filter(r => String(r.IdNumber).replace(/^['0]+/, '').trim() === id), absences };
  },
}
/* ponytail: readAll quét cả tab — đủ cho ~25k dòng/năm; đổi TextFinder theo tuần khi Attendance vượt vài trăm nghìn dòng. */
