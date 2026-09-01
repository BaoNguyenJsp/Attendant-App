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
const fmtDate = d => Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd');
function rowObj(head, r) {
  const o = {};
  head.forEach((h, i) => o[h] = r[i]);
  if (o.WeekOf instanceof Date) o.WeekOf = fmtDate(o.WeekOf);
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

function cachedRead(name) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('tab_' + name);
  if (hit) return JSON.parse(hit);
  const data = readAll(name);
  cache.put('tab_' + name, JSON.stringify(data), CACHE_TTL);
  return data;
}
function bustCache(names) { CacheService.getScriptCache().removeAll(names.map(n => 'tab_' + n)); }

function appendRows(name, rows) {
  const sh = ss().getSheetByName(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length)
    .setValues(rows.map(r => head.map(h => r[h] !== undefined ? r[h] : '')));
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
  const scores = readAll('Scores').filter(r => r.SchoolYear === year && classNames.includes(r.ClassName));
  const att = readAll('Attendance').filter(r =>
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
    const year = b.schoolYear || currentYear();
    const recs = {};
    readAll('Attendance').forEach(r => {
      if (r.SchoolYear === year && r.WeekOf === b.weekOf && r.Session === b.session && r.ClassName === b.className)
        recs[r.IdNumber] = r;
    });
    return { status: 'ok',
      records: activeStudents(b.className).map(st => {
        const o = recs[st.IdNumber];
        return { idNumber: st.IdNumber, fullName: st.FullName,
          status: o ? o.AttendanceStatus : 'Hiện diện', note: (o && o.Note) || '' };
      }),
      isHolidayWeek: !!isHoliday(holidays(year), b.weekOf, b.session) };
  },

  saveAttendance: b => {
    const rows = (b.records || []).map(r => ({
      SchoolYear: b.schoolYear, WeekOf: b.weekOf, Session: b.session,
      IdNumber: r.idNumber, ClassName: b.className, AttendanceStatus: r.status, Note: r.note || '',
    }));
    upsertRows('Attendance',
      o => o.SchoolYear === b.schoolYear && o.WeekOf === b.weekOf &&
           o.Session === b.session && o.ClassName === b.className,
      rows);
    return { status: 'ok', records: rows };
  },

  /* ---- Chuyên cần theo buổi: tuần lấy từ dữ liệu Attendance, mẫu số theo từng lớp + buổi ---- */
  getClassAttendanceStats: b => {
    const year = b.schoolYear || currentYear();
    const classNames = b.className ? [b.className] : cachedRead('Classes').map(x => x.ClassName);
    const nghi = holidays(year);
    const att = readAll('Attendance').filter(r => r.SchoolYear === year && classNames.includes(r.ClassName));
    const by = {};
    att.forEach(r => (by[r.ClassName + '|' + r.Session] = by[r.ClassName + '|' + r.Session] || []).push(r));
    const stats = [];
    classNames.forEach(cls => {
      activeStudents(cls).forEach(st => {
        const row = { className: cls, idNumber: st.IdNumber, fullName: st.FullName };
        SESSIONS.forEach(ses => {
          const rows = (by[cls + '|' + ses] || [])
            .filter(r => r.IdNumber === st.IdNumber && !isHoliday(nghi, r.WeekOf, ses));
          row[ses] = rows.length
            ? Math.round(rows.filter(r => r.AttendanceStatus === 'Hiện diện').length / rows.length * 100) : null;
        });
        stats.push(row);
      });
    });
    return { status: 'ok', stats };
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
    const scores = readAll('Scores').filter(r =>
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
  searchByIdNumber: b => {
    const st = cachedRead('Students').find(s => s.IdNumber === b.idNumber);
    if (!st) return { status: 'ok', students: [], attendance: [], scores: [] };
    return { status: 'ok', students: [st],
      attendance: readAll('Attendance').filter(r => r.IdNumber === b.idNumber),
      scores: readAll('Scores').filter(r => r.IdNumber === b.idNumber) };
  },

  /* ---- Điểm danh giáo viên ---- */
  getTeacherAttendance: b => {
    const year = currentYear();
    const recs = {};
    readAll('TeacherAttendance').forEach(r => {
      if (r.SchoolYear === year && r.WeekOf === b.weekOf && r.Session === b.session)
        recs[String(r.TeacherEmail).toLowerCase()] = r;
    });
    return { status: 'ok',
      records: activeUsers().map(u => {
        const em = String(u.Email).toLowerCase();
        const o = recs[em];
        return { email: em, fullName: u.FullName || em,
          status: o ? o.Status : 'Hiện diện', note: (o && o.Note) || '' };
      }) };
  },

  // Ghi đè (SchoolYear, WeekOf, Session) chỉ cho đúng các email trong batch —
  // không chạm bản ghi giáo viên ngành khác (sửa bug Sample cũ).
  saveTeacherAttendance: b => {
    const year = currentYear();
    const emails = new Set((b.records || []).map(r => String(r.email).toLowerCase()));
    const rows = (b.records || []).map(r => ({
      SchoolYear: year, WeekOf: b.weekOf, Session: b.session,
      TeacherEmail: r.email, Status: r.status, Note: r.note || '',
    }));
    upsertRows('TeacherAttendance',
      o => o.SchoolYear === year && o.WeekOf === b.weekOf && o.Session === b.session &&
           emails.has(String(o.TeacherEmail).toLowerCase()),
      rows);
    return { status: 'ok', records: rows };
  },

  getTeacherStats: b => {
    const year = b.schoolYear || currentYear();
    const nghi = holidays(year);
    const tat = readAll('TeacherAttendance').filter(r =>
      r.SchoolYear === year && !isHoliday(nghi, r.WeekOf, r.Session));
    const total = {};
    tat.forEach(r => total[r.WeekOf + '|' + r.Session] = true);
    const n = Object.keys(total).length;
    const coBy = {}, lessonsBy = {};
    tat.forEach(r => {
      if (r.Status === 'Hiện diện') coBy[String(r.TeacherEmail).toLowerCase()] = (coBy[String(r.TeacherEmail).toLowerCase()] || 0) + 1;
    });
    readAll('Teaching').forEach(r => {
      if (r.SchoolYear === year) lessonsBy[String(r.TeacherEmail).toLowerCase()] = (lessonsBy[String(r.TeacherEmail).toLowerCase()] || 0) + 1;
    });
    return { status: 'ok', stats: activeUsers().map(u => {
      const em = String(u.Email).toLowerCase();
      return { email: em, fullName: u.FullName || em,
        lessons: lessonsBy[em] || 0, pct: n ? Math.round((coBy[em] || 0) / n * 100) : null };
    }) };
  },

  /* ---- Quản trị (Node đã chặn tier) ---- */
  getUsers: () => ({ status: 'ok', users: cachedRead('Users') }),
  saveUsers: b => {
    upsertRows('Users', () => true, b.users);
    return { status: 'ok' };
  },

  getGroups: () => ({ status: 'ok', groups: cachedRead('Groups') }),
  saveGroups: b => {
    upsertRows('Groups', () => true, b.groups);
    return { status: 'ok' };
  },

  getGroupMembers: () => ({ status: 'ok', members: cachedRead('GroupMembers') }),
  saveGroupMembers: b => {
    upsertRows('GroupMembers', () => true, b.members);
    return { status: 'ok' };
  },

  getHolidays: b => ({ status: 'ok', holidays:
    readAll('Holidays').filter(h => !b.schoolYear || String(h.SchoolYear || b.schoolYear) === b.schoolYear) }),
  saveHolidays: b => {
    upsertRows('Holidays', o => String(o.SchoolYear || '') === String(b.schoolYear || ''), b.holidays);
    return { status: 'ok' };
  },

  saveConfig: b => {
    upsertRows('Config', o => o.Key === b.key, [{ Key: b.key, Value: b.value }]);
    return { status: 'ok' };
  },

  /* ---- Trích lục học bạ các năm (ghi bởi startSchoolYear) ---- */
  getAcademicYear: b => ({ status: 'ok', records:
    readAll('AcademicYear').filter(r => !b.schoolYear || r.SchoolYear === b.schoolYear) }),

  /* ---- Đầu năm học (admin): tổng hợp năm cũ vào AcademicYear + lên lớp ---- */
  startSchoolYear: b => {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const oldYear = currentYear();
      if (!b.newYear || b.newYear === oldYear) return { status: 'error', message: 'Nhập năm học mới khác năm hiện tại.' };
      bustCache(['Students', 'Scores', 'Attendance', 'Config', 'AcademicYear']);
      const order = cachedRead('Classes').map(c => c.ClassName);
      const students = cachedRead('Students');

      // 1) Tổng hợp điểm + chuyên cần năm cũ vào AcademicYear (không phá dữ liệu)
      const ay = summaryRows(order, oldYear).map(r => ({
        SchoolYear: oldYear, IdNumber: r.idNumber, ClassName: r.className,
        YearScore: r.avgYear, YearAttendant: r.attendancePct, Status: r.rating,
      }));
      upsertRows('AcademicYear', o => o.SchoolYear === oldYear, ay);

      // 2) Lên lớp: chỉ Hoạt động; lớp cuối → Tốt nghiệp; giữ nguyên dòng khác (không xóa)
      const updated = students.map(s => {
        if (String(s.Status).toLowerCase() !== 'hoạt động') return s;
        const i = order.indexOf(s.CurrentClass);
        const next = (i >= 0 && i < order.length - 1) ? order[i + 1] : null;
        return Object.assign({}, s, { CurrentClass: next || s.CurrentClass, Status: next ? 'Hoạt động' : 'Tốt nghiệp' });
      });
      upsertRows('Students', () => false, updated);

      // 3) Đổi năm hiện tại
      upsertRows('Config', o => o.Key === 'CurrentSchoolYear', [{ Key: 'CurrentSchoolYear', Value: b.newYear }]);
      return { status: 'ok', message: 'Đã tổng hợp ' + oldYear + ' và lên lớp sang ' + b.newYear };
    } finally { lock.releaseLock(); }
  },
};

/* ponytail: readAll quét cả tab — đủ cho ~25k dòng/năm; đổi TextFinder theo tuần khi Attendance vượt vài trăm nghìn dòng. */
