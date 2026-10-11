// Scores, class report, academic record, year rollover (plan section 6.5, UC-M6).
import { all, now, insertMany } from './sql.js';
import { configMap } from './org.js';
import { presentTotals, percent } from './attendance.js';
import { fail } from '../errors.js';
import { requireClass } from '../access.js';
import { parseScore, yearResult } from '../codes.js';
import { isDate } from '../text.js';

const SCORE_COLUMNS = { quizS1: 'QuizS1', examS1: 'ExamS1', quizS2: 'QuizS2', examS2: 'ExamS2' };
const SCORE_SELECT = Object.entries(SCORE_COLUMNS).map(([key, column]) => `sc.${column} AS ${key}`).join(', ');
const PERSON = 's.Id AS studentId, s.IdNumber AS idNumber, s.SaintName AS saintName, s.FullName AS fullName, s.FirstName AS firstName, s.Gender AS gender';
const ARCHIVE = 'a.ClassName AS className, a.Semester1Avg AS semester1Avg, a.Semester2Avg AS semester2Avg, a.YearAvg AS yearAvg, a.AttendancePct AS attendancePct, a.Rating AS rating';

export const getScores = (db, { classId }) => all(db, `SELECT sc.StudentId AS studentId, ${SCORE_SELECT}
  FROM Scores sc JOIN Students s ON s.Id = sc.StudentId WHERE s.ClassId = ? AND s.Status = 'ACTIVE' ORDER BY sc.StudentId`, classId);

// `scores` holds only the students whose scores changed (D8). One invalid value refuses the whole save.
export async function saveScores(db, actor, { classId, scores }) {
  requireClass(actor, classId);
  const inClass = new Set((await all(db, "SELECT Id FROM Students WHERE ClassId = ? AND Status = 'ACTIVE'", classId)).map((r) => r.Id));
  const columns = Object.values(SCORE_COLUMNS);
  const statements = (scores ?? []).map((r) => {
    if (!inClass.has(r.studentId)) fail(400, 'Có Thiếu nhi không thuộc lớp này. Vui lòng tải lại trang.');
    const values = Object.keys(SCORE_COLUMNS).map((key) => parseScore(r[key]));
    if (values.includes(undefined)) fail(400, 'Điểm phải từ 0 đến 10');
    // A student whose four scores are blank has no row.
    if (values.every((v) => v === null)) return db.prepare('DELETE FROM Scores WHERE StudentId = ?').bind(r.studentId);
    return db.prepare(`INSERT INTO Scores (StudentId, ClassId, ${columns.join(', ')}, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (StudentId) DO UPDATE SET ClassId = excluded.ClassId, ${columns.map((c) => `${c} = excluded.${c}`).join(', ')}, UpdatedAt = ?, UpdatedBy = excluded.UpdatedBy`)
      .bind(r.studentId, classId, ...values, actor.userId, now());
  });
  if (statements.length) await db.batch(statements);
}

// Year result of the students matching `where`, from the raw scores and the attendance of this year.
async function liveRows(db, where, args, today) {
  const students = await all(db, `SELECT ${PERSON}, c.Name AS className, ${SCORE_SELECT}
    FROM Students s JOIN Classes c ON c.Id = s.ClassId LEFT JOIN Scores sc ON sc.StudentId = s.Id WHERE ${where} ORDER BY s.Id`, ...args);
  const { maxTotal, totals } = await presentTotals(db, today);
  return students.map(({ quizS1, examS1, quizS2, examS2, ...s }) => ({
    ...s,
    ...yearResult({ quizS1, examS1, quizS2, examS2 }),
    attendancePct: percent(totals.get(s.studentId) ?? 0, maxTotal),
  }));
}

export async function getClassReport(db, { schoolYear, classId, today }) {
  const current = (await configMap(db)).CurrentSchoolYear;
  if (!schoolYear || schoolYear === current) {
    return liveRows(db, `s.Status = 'ACTIVE'${classId ? ' AND s.ClassId = ?' : ''}`, classId ? [classId] : [], today);
  }
  // The archive keeps the class name of that year as text.
  const className = classId ? await db.prepare('SELECT Name FROM Classes WHERE Id = ?').bind(classId).first('Name') : null;
  if (classId && className === null) return [];
  return all(db, `SELECT ${PERSON}, ${ARCHIVE} FROM AcademicYear a JOIN Students s ON s.Id = a.StudentId
    WHERE a.SchoolYear = ?${className ? ' AND a.ClassName = ?' : ''} ORDER BY s.Id`, schoolYear, ...(className ? [className] : []));
}

export async function getStudentRecord(db, { studentId, today }) {
  const student = await db.prepare(`SELECT s.Id AS id, s.IdNumber AS idNumber, s.SaintName AS saintName, s.FullName AS fullName, s.EnrollYear AS enrollYear,
    s.Status AS status, c.Name AS className FROM Students s JOIN Classes c ON c.Id = s.ClassId WHERE s.Id = ?`).bind(studentId).first();
  if (!student) fail(404, 'Không tìm thấy Thiếu nhi.');
  const history = await all(db, `SELECT a.SchoolYear AS schoolYear, ${ARCHIVE} FROM AcademicYear a WHERE a.StudentId = ? ORDER BY a.SchoolYear DESC`, studentId);
  let current = null;
  if (student.status === 'ACTIVE') {
    const [live] = await liveRows(db, 's.Id = ?', [studentId], today);
    current = {
      schoolYear: (await configMap(db)).CurrentSchoolYear, className: live.className,
      semester1Avg: live.semester1Avg, semester2Avg: live.semester2Avg, yearAvg: live.yearAvg, attendancePct: live.attendancePct, rating: live.rating,
    };
  }
  return { student, history, current };
}

// UC-M6. Everything is one batch: if any statement fails, nothing changes and the rollover can be run again.
export async function startSchoolYear(db, { attendanceStartDate, today }, actorId) {
  if (!isDate(attendanceStartDate)) fail(400, 'Ngày bắt đầu điểm danh của năm học mới không hợp lệ.');
  const config = await configMap(db);
  const oldYear = config.CurrentSchoolYear;
  const [from, to] = oldYear.split('-').map(Number);
  const newYear = `${from + 1}-${to + 1}`;

  const results = (await liveRows(db, "s.Status = 'ACTIVE'", [], today)).map((r) => ({
    SchoolYear: oldYear, StudentId: r.studentId, ClassName: r.className,
    Semester1Avg: r.semester1Avg, Semester2Avg: r.semester2Avg, YearAvg: r.yearAvg, AttendancePct: r.attendancePct, Rating: r.rating,
  }));
  const classes = await all(db, 'SELECT Id FROM Classes ORDER BY SortOrder');
  const stamp = now();

  const statements = [
    // 1. archive (a leftover of an earlier attempt is replaced)
    db.prepare('DELETE FROM AcademicYear WHERE SchoolYear = ?').bind(oldYear),
    ...insertMany(db, 'AcademicYear', ['SchoolYear', 'StudentId', 'ClassName', 'Semester1Avg', 'Semester2Avg', 'YearAvg', 'AttendancePct', 'Rating'], results),
    // 2. clear the data of the year; lessons stay, they carry their school year
    ...['Attendance', 'Scores', 'TeacherAttendance', 'Holidays'].map((table) => db.prepare(`DELETE FROM ${table}`)),
  ];
  // 3. promote in place, from the top down so nobody moves twice; the last class stays where it is
  for (let i = classes.length - 2; i >= 0; i--) {
    statements.push(db.prepare("UPDATE Students SET ClassId = ?, UpdatedAt = ?, UpdatedBy = ? WHERE ClassId = ? AND Status = 'ACTIVE'").bind(classes[i + 1].Id, stamp, actorId, classes[i].Id));
  }
  // 4. move the year
  const changes = [['CurrentSchoolYear', newYear], ['AttendanceStartDate', attendanceStartDate]];
  for (const [key, value] of changes) {
    statements.push(db.prepare('INSERT INTO Config (Key, Value) VALUES (?, ?) ON CONFLICT (Key) DO UPDATE SET Value = excluded.Value').bind(key, value));
  }
  statements.push(...insertMany(db, 'ConfigHistory', ['Key', 'Value', 'Action', 'ChangedBy'],
    changes.map(([Key, Value]) => ({ Key, Value, Action: Key in config ? 'UPDATED' : 'ADDED', ChangedBy: actorId }))));

  await db.batch(statements);
  return { newYear };
}
