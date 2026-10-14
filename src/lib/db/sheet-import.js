// One-time load of the old Google Sheet (downloaded as .xlsx) into D1. It replaces all data.
// The browser sends { tab name: rows } with raw cell values; column names are those of TAB_HEADERS in Code.gs.
import { insertJson } from './sql.js';
import { fail } from '../errors.js';
import { parseScore } from '../codes.js';
import { idKey, firstName, joinPhones, isDate, toSunday } from '../text.js';

const text = (v) => String(v ?? '').normalize('NFC').trim();
const lower = (v) => text(v).toLocaleLowerCase('vi');
const orNull = (v) => text(v) || null;
const list = (v, separator = ',') => String(v ?? '').split(separator).map(text);

// A date cell arrives as an Excel day number; a text cell as 'YYYY-MM-DD' or 'DD/MM/YYYY'.
function toDate(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : '';
  const s = text(v);
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : s.slice(0, 10);
  return isDate(iso) ? iso : '';
}
const toWeek = (v) => { const d = toDate(v); return d && toSunday(d); };

function number(v) {
  const n = typeof v === 'number' ? v : parseFloat(text(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const integer = (v) => { const n = number(v); return n === null ? null : Math.round(n); };

// The old pages count anything that is not present or excused as absent.
function mark(v) {
  const s = lower(v);
  return !s ? 0 : s === 'hiện diện' || s === 'có mặt' ? 1 : s === 'có phép' || s === 'vắng có phép' ? 2 : 3;
}

const GROUP_TYPE = { 'lớp': 'CLASS', 'ngành': 'SECTOR', 'quản trị ngành': 'SECTOR_ADMIN', 'quản trị': 'ADMIN' };
const SESSION = { 'lễ chúa nhật': 'SUNDAY_MASS', 'học giáo lý': 'CATECHISM', 'chầu thánh thể': 'ADORATION', 'lễ thứ năm': 'THURSDAY_MASS', 'lễ thứ 5': 'THURSDAY_MASS', 'họp huynh trưởng': 'TEACHER_MEETING' };
const RATING = { 'giỏi': 'EXCELLENT', 'tiên tiến': 'GOOD', 'trung bình': 'AVERAGE' };
const MARK_COLUMNS = { SundayMass: 'LeChuaNhat_Status', Catechism: 'HocGiaoLy_Status', Adoration: 'ChauThanhThe_Status', ThursdayMass: 'LeThu5_Status', TeacherMeeting: 'HopHuynhTruong_Status' };
const STUDENT_MARKS = ['SundayMass', 'Catechism', 'Adoration', 'ThursdayMass'];
const TEACHER_MARKS = [...STUDENT_MARKS, 'TeacherMeeting'];
const DROPPED_CONFIG = ['PhotoFolder']; // photos live in R2 now

// Tabs in, rows per table out (insert order respects the foreign keys). Nothing is written.
// skipped = [{ tab, row (line in the sheet), reason }].
export function mapSheet(tabs) {
  const skipped = [];
  // _row is the line in the sheet when the browser sent it (blank lines are not sent).
  const rows = (tab) => (Array.isArray(tabs?.[tab]) ? tabs[tab] : []).map((r, i) => [r ?? {}, r?._row ?? i + 2]);
  const skip = (tab, row, reason) => { skipped.push({ tab, row, reason }); };

  const Classes = [];
  const classIdOf = new Map();
  for (const [r, n] of rows('Classes')) {
    const name = text(r.ClassName);
    if (!name) continue;
    if (classIdOf.has(name)) { skip('Classes', n, `Lớp ${name} bị trùng`); continue; }
    const Id = Classes.length + 1;
    Classes.push({ Id, Name: name, Grade: orNull(r.Grade), SortOrder: Id });
    classIdOf.set(name, Id);
  }

  const Users = [];
  const userIdOf = new Map();
  for (const [r, n] of rows('Users')) {
    const email = lower(r.Email);
    const fullName = text(r.FullName);
    if (!email && !fullName) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { skip('Users', n, `Email không hợp lệ: ${email}`); continue; }
    if (!fullName) { skip('Users', n, `${email}: thiếu họ tên`); continue; }
    if (userIdOf.has(email)) { skip('Users', n, `Email ${email} bị trùng`); continue; }
    const Id = Users.length + 1;
    const status = lower(r.Status);
    Users.push({ Id, Email: email, SaintName: orNull(r.SaintName), FullName: fullName, FirstName: firstName(fullName), Status: status === 'hoạt động' || status === 'active' ? 'ACTIVE' : 'INACTIVE', Phone: orNull(r.SDT) });
    userIdOf.set(email, Id);
  }

  const Groups = [];
  const GroupClasses = [];
  const groupOf = new Map(); // name -> { Id, Type, scope }
  for (const [r, n] of rows('Groups')) {
    const name = text(r.GroupName);
    if (!name) continue;
    const Type = GROUP_TYPE[lower(r.Type)];
    if (!Type) { skip('Groups', n, `Nhóm ${name}: loại không rõ "${text(r.Type)}"`); continue; }
    if (groupOf.has(name)) { skip('Groups', n, `Nhóm ${name} bị trùng`); continue; }
    const Id = Groups.length + 1;
    Groups.push({ Id, Name: name, Type, SectorGroupId: null, Description: orNull(r.Description) });
    groupOf.set(name, { Id, Type, scope: text(r.Scope), line: n });
  }
  for (const [name, g] of groupOf) {
    if (g.Type === 'SECTOR_ADMIN') {
      const sector = groupOf.get(g.scope);
      if (sector?.Type === 'SECTOR') Groups[g.Id - 1].SectorGroupId = sector.Id;
      else skip('Groups', g.line, `Nhóm ${name}: Scope "${g.scope}" không phải tên một nhóm Ngành, nhóm chưa có ngành phụ trách`);
    } else if (g.Type !== 'ADMIN') {
      const names = g.Type === 'CLASS' ? [g.scope || name] : list(g.scope).filter(Boolean);
      for (const className of new Set(names)) {
        if (classIdOf.has(className)) GroupClasses.push({ GroupId: g.Id, ClassId: classIdOf.get(className) });
        else skip('Groups', g.line, `Nhóm ${name}: không có lớp ${className}`);
      }
    }
  }

  const Memberships = [];
  const memberKeys = new Set();
  for (const [r, n] of rows('GroupMembers')) {
    const group = groupOf.get(text(r.GroupName));
    const UserId = userIdOf.get(lower(r.Email));
    if (!text(r.GroupName) && !text(r.Email)) continue;
    if (!group || !UserId) { skip('GroupMembers', n, `Không có ${group ? `người dùng ${lower(r.Email)}` : `nhóm ${text(r.GroupName)}`}`); continue; }
    if (memberKeys.has(`${group.Id}|${UserId}`)) continue;
    memberKeys.add(`${group.Id}|${UserId}`);
    Memberships.push({ GroupId: group.Id, UserId });
  }

  const Config = [];
  for (const [r] of rows('Config')) {
    const Key = text(r.Key);
    if (!Key || DROPPED_CONFIG.includes(Key) || Config.some((c) => c.Key === Key)) continue;
    Config.push({ Key, Value: /Date$/.test(Key) ? toDate(r.Value) || text(r.Value) : text(r.Value) });
  }

  // A row without a session closed the whole week; the new app stores one row per session.
  const Holidays = [];
  const holidayKeys = new Set();
  for (const [r, n] of rows('Holidays')) {
    if (!text(r.WeekOf) && !text(r.Session)) continue;
    const WeekOf = toWeek(r.WeekOf);
    const sessions = text(r.Session) ? [SESSION[lower(r.Session)]] : [...new Set(Object.values(SESSION))];
    if (!WeekOf || !sessions[0]) { skip('Holidays', n, `Tuần hoặc buổi không hợp lệ: ${text(r.WeekOf)} / ${text(r.Session)}`); continue; }
    for (const Session of sessions) {
      if (holidayKeys.has(`${WeekOf}|${Session}`)) continue;
      holidayKeys.add(`${WeekOf}|${Session}`);
      Holidays.push({ WeekOf, Session, Reason: orNull(r.Reason) });
    }
  }

  const Students = [];
  const studentOf = new Map(); // id key -> student row
  for (const [r, n] of rows('Students')) {
    const IdNumber = text(r.IdNumber).replace(/^'+/, '');
    const fullName = text(r.FullName);
    if (!IdNumber && !fullName) continue;
    const key = idKey(IdNumber);
    const ClassId = classIdOf.get(text(r.CurrentClass));
    const problem = !key ? 'thiếu CCCD' : !fullName ? 'thiếu họ tên' : studentOf.has(key) ? 'CCCD bị trùng' : !ClassId ? `không có lớp "${text(r.CurrentClass)}"` : '';
    if (problem) { skip('Students', n, `${IdNumber} ${fullName}: ${problem}`); continue; }
    const gender = lower(r.Gender);
    const student = {
      Id: Students.length + 1, IdNumber, IdKey: key, SaintName: orNull(r.SaintName), FullName: fullName, FirstName: firstName(fullName),
      DateOfBirth: toDate(r.DateOfBirth) || null, Gender: gender === 'nữ' ? 'F' : gender === 'nam' ? 'M' : null,
      Father: orNull(r.Father), Mother: orNull(r.Mother), Phone: joinPhones(r.PhoneNumber), ClassId, EnrollYear: integer(r.EnrollYear),
    };
    Students.push(student);
    studentOf.set(key, student);
  }
  const student = (idNumber) => studentOf.get(idKey(text(idNumber)));

  const SiblingMembers = [];
  const inFamily = new Set();
  rows('SiblingGroups').forEach(([r], i) => {
    const members = [...new Set(String(r.Siblings ?? '').split(/[.,\s]+/).map((id) => student(id)?.Id).filter(Boolean))].filter((id) => !inFamily.has(id));
    if (members.length < 2) return;
    for (const StudentId of members) {
      inFamily.add(StudentId);
      SiblingMembers.push({ StudentId, FamilyId: i + 1 });
    }
  });

  // Attendance: the old sheet has one tab per class (Att_<class>); a later row of the same week adds its marks.
  function marksOf(tab, columns, ownerOf) {
    const byKey = new Map();
    for (const [r, n] of rows(tab)) {
      if (!text(r.WeekOf) && !ownerOf.label(r)) continue;
      const WeekOf = toWeek(r.WeekOf);
      const owner = ownerOf.find(r);
      if (!WeekOf || !owner) { skip(tab, n, WeekOf ? `Không có ${ownerOf.label(r)}` : `Tuần không hợp lệ: ${text(r.WeekOf)}`); continue; }
      const key = `${owner.Id}|${WeekOf}`;
      const row = byKey.get(key) ?? { ...ownerOf.row(owner, r), WeekOf, ...Object.fromEntries(columns.map((c) => [c, 0])) };
      for (const c of columns) row[c] = mark(r[MARK_COLUMNS[c]]) || row[c];
      byKey.set(key, row);
    }
    return [...byKey.values()].filter((row) => columns.some((c) => row[c])); // an all-unmarked row is never stored
  }
  const attendanceKeys = new Set();
  const Attendance = Object.keys(tabs ?? {}).filter((tab) => tab === 'Attendance' || tab.startsWith('Att_')).flatMap((tab) => marksOf(tab, STUDENT_MARKS, {
    label: (r) => text(r.IdNumber) && `thiếu nhi ${text(r.IdNumber)}`,
    find: (r) => student(r.IdNumber),
    row: (s, r) => ({ StudentId: s.Id, ClassId: classIdOf.get(text(r.ClassName)) ?? s.ClassId }),
  })).filter((row) => { // the same student and week in two tabs: the first tab wins
    const key = `${row.StudentId}|${row.WeekOf}`;
    return !attendanceKeys.has(key) && attendanceKeys.add(key);
  });
  const TeacherAttendance = marksOf('TeacherAttendance', TEACHER_MARKS, {
    label: (r) => text(r.TeacherEmail) && `người dùng ${lower(r.TeacherEmail)}`,
    find: (r) => (userIdOf.has(lower(r.TeacherEmail)) ? { Id: userIdOf.get(lower(r.TeacherEmail)) } : null),
    row: (u) => ({ UserId: u.Id }),
  });

  const Scores = [];
  const scored = new Set();
  for (const [r, n] of rows('Scores')) {
    if (!text(r.IdNumber)) continue;
    const s = student(r.IdNumber);
    if (!s || scored.has(s.Id)) { skip('Scores', n, s ? `Thiếu nhi ${s.IdNumber} có hai dòng điểm` : `Không có thiếu nhi ${text(r.IdNumber)}`); continue; }
    const values = { QuizS1: parseScore(r.Quiz15_S1), ExamS1: parseScore(r.Exam_S1), QuizS2: parseScore(r.Quiz15_S2), ExamS2: parseScore(r.Exam_S2) };
    if (Object.values(values).includes(undefined)) { skip('Scores', n, `Thiếu nhi ${s.IdNumber}: điểm phải từ 0 đến 10`); continue; }
    if (Object.values(values).every((v) => v === null)) continue;
    scored.add(s.Id);
    Scores.push({ StudentId: s.Id, ClassId: classIdOf.get(text(r.ClassName)) ?? s.ClassId, ...values });
  }

  const AcademicYear = [];
  const recordKeys = new Set();
  for (const [r, n] of rows('AcademicYear')) {
    if (!text(r.IdNumber)) continue;
    const s = student(r.IdNumber);
    const SchoolYear = text(r.SchoolYear);
    const key = `${SchoolYear}|${s?.Id}`;
    const problem = !s ? `không có thiếu nhi ${text(r.IdNumber)}` : !SchoolYear || !text(r.ClassName) ? 'thiếu năm học hoặc lớp' : recordKeys.has(key) ? `hai dòng của năm ${SchoolYear}` : '';
    if (problem) { skip('AcademicYear', n, `${text(r.IdNumber)}: ${problem}`); continue; }
    recordKeys.add(key);
    AcademicYear.push({
      SchoolYear, StudentId: s.Id, ClassName: text(r.ClassName), Semester1Avg: number(r.HK1Score), Semester2Avg: number(r.HK2Score), YearAvg: number(r.YearScore),
      AttendancePct: integer(r.YearAttendant), Rating: RATING[lower(r.Status)] ?? null,
    });
  }

  // Teaching: urls and types are comma lists, names a line list, all in the same order.
  const Lessons = [];
  const LessonFiles = [];
  const lessonKeys = new Set();
  for (const [r, n] of rows('Teaching')) {
    if (!text(r.WeekOf) && !text(r.ClassName)) continue;
    const SchoolYear = text(r.SchoolYear);
    const WeekOf = toWeek(r.WeekOf);
    const ClassId = classIdOf.get(text(r.ClassName));
    const UpdatedBy = userIdOf.get(lower(r.UpdatedBy)) ?? null;
    const TeacherId = userIdOf.get(lower(r.TeacherEmail)) ?? UpdatedBy;
    const key = `${SchoolYear}|${WeekOf}|${ClassId}`;
    const problem = !SchoolYear || !WeekOf ? 'thiếu năm học hoặc tuần' : !ClassId ? `không có lớp "${text(r.ClassName)}"` : !TeacherId ? `không có người dùng ${lower(r.TeacherEmail)}` : lessonKeys.has(key) ? 'trùng năm học, tuần và lớp' : '';
    if (problem) { skip('Teaching', n, problem); continue; }
    lessonKeys.add(key);
    const Id = Lessons.length + 1;
    Lessons.push({ Id, SchoolYear, WeekOf, ClassId, TeacherId, Content: text(r.LessonContent), UpdatedBy });
    for (const [Slot, prefix] of [['PLAN', 'LessonPlan'], ['REVISED', 'RevisedPlan']]) {
      const names = list(r[`${prefix}Names`], '\n');
      const types = list(r[`${prefix}Types`]);
      let Position = 0;
      list(r[`${prefix}Url`]).forEach((Url, i) => {
        if (!Url) return;
        // An uploaded file needs its Drive id; without one it is kept as a plain link.
        const DriveFileId = types[i] === 'link' ? null : (Url.match(/\/d\/([\w-]+)/) ?? Url.match(/[?&]id=([\w-]+)/))?.[1] ?? null;
        LessonFiles.push({ LessonId: Id, Slot, Position: Position++, Url, Name: names[i] ?? '', Type: DriveFileId ? 'FILE' : 'LINK', DriveFileId });
      });
    }
  }

  return { data: { Users, Classes, Groups, GroupClasses, Memberships, Config, Holidays, Students, SiblingMembers, Attendance, TeacherAttendance, Scores, AcademicYear, Lessons, LessonFiles }, skipped };
}

// confirm false: report only. confirm true: one batch replaces every table; if a statement fails nothing changes.
// The Drive connection (Secrets, DriveFolders, DriveTrash) is kept.
export async function importSheet(db, actor, { tabs, confirm = false }) {
  const { data, skipped } = mapSheet(tabs);
  const counts = Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length]));
  if (!data.Users.length || !data.Classes.length) fail(400, 'Tệp không có tab Users hoặc Classes của Google Sheet cũ.');
  if (!data.Config.some((c) => c.Key === 'CurrentSchoolYear' && c.Value)) fail(400, 'Tab Config thiếu CurrentSchoolYear.');
  // Whoever runs the import must still be Xứ đoàn afterwards, or nobody could open this page again.
  const me = data.Users.find((u) => u.Email === actor.email.toLowerCase() && u.Status === 'ACTIVE');
  const adminGroups = new Set(data.Groups.filter((g) => g.Type === 'ADMIN').map((g) => g.Id));
  if (!me || !data.Memberships.some((m) => m.UserId === me.Id && adminGroups.has(m.GroupId))) {
    fail(400, `Email ${actor.email} không thuộc nhóm Quản trị (đang Hoạt động) trong tệp. Hãy thêm vào tab Users và GroupMembers rồi thử lại.`);
  }
  if (!confirm) return { counts, skipped, imported: false };

  // Ids change, so every session of before the import must end: no old AuthVersion may match a new user.
  const authVersion = ((await db.prepare('SELECT MAX(AuthVersion) AS v FROM Users').first('v')) ?? 0) + 1;
  for (const u of data.Users) u.AuthVersion = authVersion;
  const full = { ...data, ConfigHistory: data.Config.map((c) => ({ Key: c.Key, Value: c.Value, Action: 'ADDED', ChangedBy: me.Id })) };
  const tables = Object.keys(full);
  await db.batch([
    ...['LessonFiles', 'Lessons', 'AcademicYear', 'Scores', 'TeacherAttendance', 'Attendance', 'SiblingMembers', 'Students', 'Holidays', 'ConfigHistory', 'Config', 'Memberships', 'GroupClasses', 'Groups', 'Classes', 'Users']
      .map((table) => db.prepare(`DELETE FROM ${table}`)),
    ...tables.filter((table) => full[table].length).flatMap((table) => insertJson(db, table, Object.keys(full[table][0]), full[table])),
  ]);
  return { counts, skipped, imported: true };
}
