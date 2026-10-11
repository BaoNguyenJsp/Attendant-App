// Attendance of students and teachers: week view, save of changed rows, statistics, overview, absences.
import { all, now } from './sql.js';
import { configMap, listHolidays, listClasses } from './org.js';
import { fail } from '../errors.js';
import { requireClass, isAdmin } from '../access.js';
import { MARK, STUDENT_SESSIONS, TEACHER_SESSIONS, isMark, attendanceRating } from '../codes.js';
import { isDate, toSunday, sundaysBetween, matchesTeacher } from '../text.js';

export function requireWeek(weekOf) {
  if (!isDate(weekOf) || toSunday(weekOf) !== weekOf) fail(400, 'Tuần phải là một ngày Chúa Nhật.');
}

export const percent = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

// Sessions that could be attended: one per week and session type, minus the holidays of that session.
export function possibleSessions(weeks, holidays, sessions) {
  const off = new Set(holidays.map((h) => `${h.weekOf}|${h.session}`));
  const max = {};
  let maxTotal = 0;
  for (const code of Object.keys(sessions)) {
    max[code] = weeks.filter((w) => !off.has(`${w}|${code}`)).length;
    maxTotal += max[code];
  }
  return { max, maxTotal };
}

// The Sundays of this school year so far.
async function yearWeeks(db, today) {
  const start = (await configMap(db)).AttendanceStartDate;
  return start && isDate(start) ? sundaysBetween(start, today) : [];
}

const marksOf = (row, sessions) => Object.fromEntries(Object.entries(sessions).map(([code, column]) => [code, row[column]]));

// Marks of a request in column order; a session that is not sent is unmarked.
function readMarks(marks, sessions) {
  return Object.keys(sessions).map((code) => {
    const mark = marks?.[code] ?? MARK.NONE;
    if (!isMark(mark)) fail(400, 'Dấu điểm danh không hợp lệ.');
    return mark;
  });
}

// One changed row: upsert, or delete when every session is unmarked (D5).
function markStatement(db, table, key, id, weekOf, sessions, marks, extra, userId) {
  if (marks.every((m) => m === MARK.NONE)) return db.prepare(`DELETE FROM ${table} WHERE ${key} = ? AND WeekOf = ?`).bind(id, weekOf);
  const columns = [key, 'WeekOf', ...Object.keys(extra), ...Object.values(sessions), 'UpdatedBy'];
  const updates = columns.slice(2).map((c) => `${c} = excluded.${c}`).join(', ');
  return db
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT (${key}, WeekOf) DO UPDATE SET ${updates}, UpdatedAt = ?`)
    .bind(id, weekOf, ...Object.values(extra), ...marks, userId, now());
}

// SELECT list counting present marks per session, leaving out sessions that are holidays. Codes are constants, not input.
const presentSums = (sessions) => Object.entries(sessions).map(([code, column]) => `
  SUM(CASE WHEN a.${column} = 1 AND NOT EXISTS (SELECT 1 FROM Holidays h WHERE h.WeekOf = a.WeekOf AND h.Session = '${code}') THEN 1 ELSE 0 END) AS ${code}`).join(',');

const sumCodes = (row, sessions) => Object.keys(sessions).reduce((n, code) => n + (row[code] ?? 0), 0);

// Absences of one person: every session of the year so far that is not a holiday and not marked present.
function absencesOf(weeks, holidays, sessions, rows) {
  const off = new Set(holidays.map((h) => `${h.weekOf}|${h.session}`));
  const byWeek = new Map(rows.map((r) => [r.WeekOf, r]));
  const out = [];
  for (const weekOf of weeks) {
    for (const [session, column] of Object.entries(sessions)) {
      if (off.has(`${weekOf}|${session}`)) continue;
      const mark = byWeek.get(weekOf)?.[column] ?? MARK.NONE;
      // Unmarked counts as absent, the same rule as the statistics.
      if (mark !== MARK.PRESENT) out.push({ weekOf, session, mark: mark === MARK.EXCUSED ? MARK.EXCUSED : MARK.ABSENT });
    }
  }
  return out;
}

/* ---------- Students ---------- */

export async function getStudentAttendance(db, { classId, weekOf }) {
  requireWeek(weekOf);
  const rows = await all(db, `SELECT a.* FROM Attendance a JOIN Students s ON s.Id = a.StudentId
    WHERE s.ClassId = ? AND s.Status = 'ACTIVE' AND a.WeekOf = ? ORDER BY a.StudentId`, classId, weekOf);
  return {
    records: rows.map((r) => ({ studentId: r.StudentId, marks: marksOf(r, STUDENT_SESSIONS) })),
    holidays: (await listHolidays(db)).filter((h) => h.weekOf === weekOf),
  };
}

// `records` holds only the students whose marks changed, each with the four sessions of the week (D8).
export async function saveStudentAttendance(db, actor, { classId, weekOf, records }) {
  requireWeek(weekOf);
  requireClass(actor, classId);
  const inClass = new Set((await all(db, "SELECT Id FROM Students WHERE ClassId = ? AND Status = 'ACTIVE'", classId)).map((r) => r.Id));
  const statements = (records ?? []).map((r) => {
    if (!inClass.has(r.studentId)) fail(400, 'Có Thiếu nhi không thuộc lớp này. Vui lòng tải lại trang.');
    return markStatement(db, 'Attendance', 'StudentId', r.studentId, weekOf, STUDENT_SESSIONS, readMarks(r.marks, STUDENT_SESSIONS), { ClassId: classId }, actor.userId);
  });
  if (statements.length) await db.batch(statements);
}

export async function getStudentAttendanceStats(db, { classId, today }) {
  const weeks = await yearWeeks(db, today);
  const { max, maxTotal } = possibleSessions(weeks, await listHolidays(db), STUDENT_SESSIONS);
  const stats = {};
  if (weeks.length) {
    const rows = await all(db, `SELECT a.StudentId AS id, ${presentSums(STUDENT_SESSIONS)} FROM Attendance a JOIN Students s ON s.Id = a.StudentId
      WHERE s.ClassId = ? AND s.Status = 'ACTIVE' AND a.WeekOf BETWEEN ? AND ? GROUP BY a.StudentId`, classId, weeks[0], weeks.at(-1));
    for (const { id, ...present } of rows) stats[id] = { ...present, total: sumCodes(present, STUDENT_SESSIONS) };
  }
  return { max, maxTotal, stats };
}

// Present sessions of every student this year, for the academic reports.
export async function presentTotals(db, today) {
  const weeks = await yearWeeks(db, today);
  const { maxTotal } = possibleSessions(weeks, await listHolidays(db), STUDENT_SESSIONS);
  const rows = weeks.length
    ? await all(db, `SELECT a.StudentId AS id, ${presentSums(STUDENT_SESSIONS)} FROM Attendance a WHERE a.WeekOf BETWEEN ? AND ? GROUP BY a.StudentId`, weeks[0], weeks.at(-1))
    : [];
  return { maxTotal, totals: new Map(rows.map((r) => [r.id, sumCodes(r, STUDENT_SESSIONS)])) };
}

// UC-T5: the database counts the present marks per class; the Worker only divides.
export async function getAttendanceOverview(db, { period = 'YEAR', value, today }) {
  const n = Number(value);
  let months = null;
  if (period === 'QUARTER' && Number.isInteger(n) && n >= 1 && n <= 4) months = [n * 3 - 2, n * 3 - 1, n * 3];
  else if (period === 'MONTH' && Number.isInteger(n) && n >= 1 && n <= 12) months = [n];
  else if (period !== 'YEAR') fail(400, 'Bộ lọc thời gian không hợp lệ.');

  let weeks = await yearWeeks(db, today);
  if (months) weeks = weeks.filter((w) => months.includes(Number(w.slice(5, 7))));
  const { max, maxTotal } = possibleSessions(weeks, await listHolidays(db), STUDENT_SESSIONS);
  const rows = weeks.length
    ? await all(db, `SELECT s.ClassId AS classId, ${presentSums(STUDENT_SESSIONS)} FROM Attendance a JOIN Students s ON s.Id = a.StudentId
        WHERE s.Status = 'ACTIVE' AND a.WeekOf IN (${weeks.map(() => '?').join(', ')}) GROUP BY s.ClassId`, ...weeks)
    : [];
  const present = new Map(rows.map((r) => [r.classId, r]));
  const codes = Object.keys(STUDENT_SESSIONS);

  const classes = (await listClasses(db)).filter((c) => c.size > 0).map((c) => {
    const p = present.get(c.id) ?? {};
    const pctTotal = percent(sumCodes(p, STUDENT_SESSIONS), maxTotal * c.size);
    return {
      classId: c.id, name: c.name, size: c.size,
      pct: Object.fromEntries(codes.map((code) => [code, percent(p[code] ?? 0, max[code] * c.size)])),
      pctTotal, rating: attendanceRating(pctTotal),
    };
  });
  const totalStudents = classes.reduce((sum, c) => sum + c.size, 0);
  const whole = (code) => percent(rows.reduce((sum, r) => sum + r[code], 0), max[code] * totalStudents);
  return { totalStudents, sundayMassPct: whole('SUNDAY_MASS'), thursdayMassPct: whole('THURSDAY_MASS'), classes };
}

export async function getStudentAbsences(db, { studentId, today }) {
  const student = await db.prepare(`SELECT s.Id AS id, s.IdNumber AS idNumber, s.SaintName AS saintName, s.FullName AS fullName, s.ClassId AS classId, c.Name AS className, s.Status AS status
    FROM Students s JOIN Classes c ON c.Id = s.ClassId WHERE s.Id = ?`).bind(studentId).first();
  if (!student) fail(404, 'Không tìm thấy Thiếu nhi.');
  const rows = await all(db, 'SELECT * FROM Attendance WHERE StudentId = ?', studentId);
  return { student, absences: absencesOf(await yearWeeks(db, today), await listHolidays(db), STUDENT_SESSIONS, rows) };
}

/* ---------- Teachers ---------- */

const byClassThenName = (a, b) => a.sortOrder - b.sortOrder || a.firstName.localeCompare(b.firstName, 'vi');
const PERSON = 'u.Id AS userId, u.Email AS email, u.SaintName AS saintName, u.FullName AS fullName, u.FirstName AS firstName';

// UC-H1: a sector lists the active teachers of its classes, except members of Xứ đoàn; 'ADMIN' lists those members.
export async function teacherRoster(db, sectorGroupId) {
  const rows = sectorGroupId === 'ADMIN'
    ? await all(db, `SELECT DISTINCT ${PERSON}, NULL AS classId, NULL AS className, 0 AS sortOrder
        FROM Users u JOIN Memberships m ON m.UserId = u.Id JOIN Groups g ON g.Id = m.GroupId AND g.Type = 'ADMIN' WHERE u.Status = 'ACTIVE'`)
    : await all(db, `SELECT ${PERSON}, c.Id AS classId, c.Name AS className, MIN(c.SortOrder) AS sortOrder
        FROM Users u JOIN Memberships m ON m.UserId = u.Id JOIN Groups g ON g.Id = m.GroupId AND g.Type = 'CLASS'
        JOIN GroupClasses gc ON gc.GroupId = g.Id JOIN GroupClasses sc ON sc.ClassId = gc.ClassId AND sc.GroupId = ?
        JOIN Classes c ON c.Id = gc.ClassId
        WHERE u.Status = 'ACTIVE' AND NOT EXISTS (
          SELECT 1 FROM Memberships am JOIN Groups ag ON ag.Id = am.GroupId AND ag.Type = 'ADMIN' WHERE am.UserId = u.Id)
        GROUP BY u.Id`, sectorGroupId);
  return rows.sort(byClassThenName).map(({ sortOrder, ...teacher }) => teacher);
}

export async function getTeacherAttendance(db, { sectorGroupId, weekOf }) {
  requireWeek(weekOf);
  const teachers = await teacherRoster(db, sectorGroupId);
  const listed = new Set(teachers.map((t) => t.userId));
  const rows = (await all(db, 'SELECT * FROM TeacherAttendance WHERE WeekOf = ? ORDER BY UserId', weekOf)).filter((r) => listed.has(r.UserId));
  return {
    teachers,
    records: rows.map((r) => ({ userId: r.UserId, marks: marksOf(r, TEACHER_SESSIONS) })),
    holidays: (await listHolidays(db)).filter((h) => h.weekOf === weekOf),
  };
}

export async function saveTeacherAttendance(db, { sectorGroupId, weekOf, records }, actorId) {
  requireWeek(weekOf);
  const listed = new Set((await teacherRoster(db, sectorGroupId)).map((t) => t.userId));
  const statements = (records ?? []).map((r) => {
    if (!listed.has(r.userId)) fail(400, 'Có Huynh trưởng không thuộc danh sách này. Vui lòng tải lại trang.');
    return markStatement(db, 'TeacherAttendance', 'UserId', r.userId, weekOf, TEACHER_SESSIONS, readMarks(r.marks, TEACHER_SESSIONS), {}, actorId);
  });
  if (statements.length) await db.batch(statements);
}

export async function getTeacherAttendanceStats(db, { sectorGroupId, classId, today }) {
  const weeks = await yearWeeks(db, today);
  const { max, maxTotal } = possibleSessions(weeks, await listHolidays(db), TEACHER_SESSIONS);
  const teachers = (await teacherRoster(db, sectorGroupId)).filter((t) => !classId || t.classId === classId);
  const rows = weeks.length
    ? await all(db, `SELECT a.UserId AS id, ${presentSums(TEACHER_SESSIONS)} FROM TeacherAttendance a WHERE a.WeekOf BETWEEN ? AND ? GROUP BY a.UserId`, weeks[0], weeks.at(-1))
    : [];
  const present = new Map(rows.map(({ id, ...counts }) => [id, counts]));
  const taught = new Map((await all(db, 'SELECT TeacherId AS id, COUNT(*) AS n FROM Lessons WHERE SchoolYear = ? GROUP BY TeacherId', (await configMap(db)).CurrentSchoolYear)).map((r) => [r.id, r.n]));
  const zero = Object.fromEntries(Object.keys(TEACHER_SESSIONS).map((code) => [code, 0]));
  return {
    max, maxTotal,
    stats: teachers.map((t) => ({ userId: t.userId, fullName: t.fullName, saintName: t.saintName, className: t.className, taught: taught.get(t.userId) ?? 0, present: present.get(t.userId) ?? zero })),
  };
}

// The teachers a user may look up: those of the sectors they manage, plus the Xứ đoàn list for Xứ đoàn (R6).
async function visibleTeachers(db, actor) {
  const seen = new Map();
  for (const list of [...actor.sectorGroupIds, ...(isAdmin(actor) ? ['ADMIN'] : [])]) {
    for (const t of await teacherRoster(db, list)) if (!seen.has(t.userId)) seen.set(t.userId, t);
  }
  return [...seen.values()];
}

// R8: names only; the email is used for matching (Xứ đoàn) but never returned here.
const publicTeacher = ({ userId, fullName, saintName, className }) => ({ userId, fullName, saintName, className });

export async function searchTeachers(db, actor, query) {
  return (await visibleTeachers(db, actor)).filter((t) => matchesTeacher(t, query, { byEmail: isAdmin(actor) })).map(publicTeacher);
}

export async function getTeacherAbsences(db, actor, { userId, today }) {
  const teacher = (await visibleTeachers(db, actor)).find((t) => t.userId === userId);
  if (!teacher) fail(404, 'Không tìm thấy Huynh trưởng trong các ngành bạn quản lý.');
  const rows = await all(db, 'SELECT * FROM TeacherAttendance WHERE UserId = ?', userId);
  return { teacher: publicTeacher(teacher), absences: absencesOf(await yearWeeks(db, today), await listHolidays(db), TEACHER_SESSIONS, rows) };
}
