import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1, TODAY } from './helpers/seeded.mjs';
import { AppError } from '../src/lib/errors.js';
import { loadSession } from '../src/lib/db/users.js';
import {
  possibleSessions, percent, getStudentAttendance, saveStudentAttendance, getStudentAttendanceStats, getAttendanceOverview,
  getStudentAbsences, teacherRoster, getTeacherAttendance, saveTeacherAttendance, getTeacherAttendanceStats, searchTeachers, getTeacherAbsences,
} from '../src/lib/db/attendance.js';
import { STUDENT_SESSIONS } from '../src/lib/codes.js';

const status = (code) => (e) => e instanceof AppError && e.status === code;
const WEEK = '2026-09-06';
const present = { SUNDAY_MASS: 1, CATECHISM: 1, ADORATION: 1, THURSDAY_MASS: 1 };
const none = { SUNDAY_MASS: 0, CATECHISM: 0, ADORATION: 0, THURSDAY_MASS: 0 };
const admin = (db) => loadSession(db, 'doruoora@gmail.com');
const teacher = (db) => loadSession(db, 'teacher08@example.com'); // class 1

// Demo data without marks and holidays, so each test states its own.
async function emptyYear() {
  const db = await seededD1();
  await db.exec('DELETE FROM Attendance; DELETE FROM TeacherAttendance; DELETE FROM Holidays;');
  return db;
}
const rowsOf = async (db, week = WEEK) => (await db.prepare('SELECT StudentId, SundayMass, Catechism, Adoration, ThursdayMass, UpdatedBy FROM Attendance WHERE WeekOf = ? ORDER BY StudentId').bind(week).all()).results;

test('possibleSessions takes one per week and session, minus holidays', () => {
  const weeks = ['2026-09-06', '2026-09-13', '2026-09-20'];
  const holidays = [{ weekOf: '2026-09-13', session: 'ADORATION' }, { weekOf: '2025-01-05', session: 'CATECHISM' }];
  assert.deepEqual(possibleSessions(weeks, holidays, STUDENT_SESSIONS), { max: { SUNDAY_MASS: 3, CATECHISM: 3, ADORATION: 2, THURSDAY_MASS: 3 }, maxTotal: 11 });
});

test('percent rounds, caps at 100 and is 0 when nothing is possible', () => {
  assert.deepEqual([percent(1, 3), percent(5, 4), percent(3, 0), percent(0, 5)], [33, 100, 0, 0]);
});

test('saving writes only the students sent; an all-unmarked student has no row', async () => {
  const db = await emptyYear();
  const t = await teacher(db);
  await saveStudentAttendance(db, t, { classId: 1, weekOf: WEEK, records: [{ studentId: 1, marks: present }, { studentId: 2, marks: { ...none, CATECHISM: 2 } }] });
  // a second save by another teacher for other students leaves the first rows alone
  await saveStudentAttendance(db, await admin(db), { classId: 1, weekOf: WEEK, records: [{ studentId: 3, marks: { SUNDAY_MASS: 1 } }] });
  assert.deepEqual(await rowsOf(db), [
    { StudentId: 1, SundayMass: 1, Catechism: 1, Adoration: 1, ThursdayMass: 1, UpdatedBy: 13 },
    { StudentId: 2, SundayMass: 0, Catechism: 2, Adoration: 0, ThursdayMass: 0, UpdatedBy: 13 },
    { StudentId: 3, SundayMass: 1, Catechism: 0, Adoration: 0, ThursdayMass: 0, UpdatedBy: 1 },
  ]);
  // ticked -> unticked removes the row; a changed mark updates it
  await saveStudentAttendance(db, t, { classId: 1, weekOf: WEEK, records: [{ studentId: 1, marks: none }, { studentId: 2, marks: present }] });
  assert.deepEqual((await rowsOf(db)).map((r) => [r.StudentId, r.Catechism]), [[2, 1], [3, 0]]);

  const read = await getStudentAttendance(db, { classId: 1, weekOf: WEEK });
  assert.deepEqual(read.records, [{ studentId: 2, marks: present }, { studentId: 3, marks: { ...none, SUNDAY_MASS: 1 } }]);
});

test('saving is refused for a non-Sunday, a class out of scope, a foreign student or a bad mark', async () => {
  const db = await emptyYear();
  const t = await teacher(db);
  const one = [{ studentId: 1, marks: present }];
  await assert.rejects(saveStudentAttendance(db, t, { classId: 1, weekOf: '2026-09-07', records: one }), status(400));
  await assert.rejects(saveStudentAttendance(db, t, { classId: 2, weekOf: WEEK, records: [{ studentId: 51, marks: present }] }), status(403));
  await assert.rejects(saveStudentAttendance(db, t, { classId: 1, weekOf: WEEK, records: [{ studentId: 51, marks: present }] }), status(400));
  await assert.rejects(saveStudentAttendance(db, t, { classId: 1, weekOf: WEEK, records: [...one, { studentId: 2, marks: { SUNDAY_MASS: 4 } }] }), status(400));
  await assert.rejects(saveStudentAttendance(db, t, { classId: 1, weekOf: WEEK, records: [{ studentId: 1, marks: { SUNDAY_MASS: '1' } }] }), status(400));
  assert.deepEqual(await rowsOf(db), []);
});

test('the week view carries the holidays of that week only', async () => {
  const db = await seededD1();
  assert.deepEqual((await getStudentAttendance(db, { classId: 1, weekOf: '2026-09-27' })).holidays, [{ weekOf: '2026-09-27', session: 'THURSDAY_MASS', reason: 'Nghỉ lễ' }]);
  assert.deepEqual((await getStudentAttendance(db, { classId: 1, weekOf: WEEK })).holidays, []);
  await assert.rejects(getStudentAttendance(db, { classId: 1, weekOf: 'abc' }), status(400));
});

test('class statistics count present marks, skip holiday sessions and follow a moved student', async () => {
  const db = await emptyYear();
  const a = await admin(db);
  await db.prepare("INSERT INTO Holidays (WeekOf, Session) VALUES ('2026-09-13', 'THURSDAY_MASS')").run();
  await saveStudentAttendance(db, a, { classId: 1, weekOf: '2026-09-06', records: [{ studentId: 1, marks: present }, { studentId: 2, marks: { ...none, SUNDAY_MASS: 2 } }] });
  await saveStudentAttendance(db, a, { classId: 1, weekOf: '2026-09-13', records: [{ studentId: 1, marks: present }] }); // Thursday is a holiday: not counted
  await saveStudentAttendance(db, a, { classId: 1, weekOf: '2026-10-18', records: [{ studentId: 1, marks: present }] }); // after today: not counted

  const stats = await getStudentAttendanceStats(db, { classId: 1, today: TODAY });
  assert.deepEqual(stats.max, { SUNDAY_MASS: 6, CATECHISM: 6, ADORATION: 6, THURSDAY_MASS: 5 });
  assert.equal(stats.maxTotal, 23);
  assert.deepEqual(stats.stats[1], { SUNDAY_MASS: 2, CATECHISM: 2, ADORATION: 2, THURSDAY_MASS: 1, total: 7 });
  assert.deepEqual(stats.stats[2], { SUNDAY_MASS: 0, CATECHISM: 0, ADORATION: 0, THURSDAY_MASS: 0, total: 0 });

  // student 1 moves to class 2: the marks follow
  await db.prepare('UPDATE Students SET ClassId = 2 WHERE Id = 1').run();
  assert.equal((await getStudentAttendanceStats(db, { classId: 1, today: TODAY })).stats[1], undefined);
  assert.equal((await getStudentAttendanceStats(db, { classId: 2, today: TODAY })).stats[1].total, 7);
});

test('the overview gives one line per class from one grouped count', async () => {
  const db = await emptyYear();
  const a = await admin(db);
  const everyone = Array.from({ length: 50 }, (_, i) => ({ studentId: i + 1, marks: { ...none, SUNDAY_MASS: 1 } }));
  await saveStudentAttendance(db, a, { classId: 1, weekOf: '2026-09-06', records: everyone });
  await saveStudentAttendance(db, a, { classId: 1, weekOf: '2026-10-04', records: everyone.slice(0, 25) });

  const year = await getAttendanceOverview(db, { period: 'YEAR', today: TODAY });
  assert.equal(year.totalStudents, 600);
  assert.equal(year.classes.length, 12);
  // class 1: 75 present Sunday Masses of 6 weeks x 50 students
  assert.deepEqual(year.classes[0], { classId: 1, name: 'Chiên Con', size: 50, pct: { SUNDAY_MASS: 25, CATECHISM: 0, ADORATION: 0, THURSDAY_MASS: 0 }, pctTotal: 6, rating: 'NEEDS_WORK' });
  assert.equal(year.sundayMassPct, 2); // 75 of 6 x 600
  assert.equal(year.thursdayMassPct, 0);

  // September has 4 Sundays: 50 of 4 x 50
  assert.equal((await getAttendanceOverview(db, { period: 'MONTH', value: 9, today: TODAY })).classes[0].pct.SUNDAY_MASS, 25);
  // October so far has 2 Sundays: 25 of 2 x 50
  assert.equal((await getAttendanceOverview(db, { period: 'MONTH', value: 10, today: TODAY })).classes[0].pct.SUNDAY_MASS, 25);
  assert.equal((await getAttendanceOverview(db, { period: 'QUARTER', value: 4, today: TODAY })).classes[0].pct.SUNDAY_MASS, 25);
  // a quarter with no week so far
  assert.equal((await getAttendanceOverview(db, { period: 'QUARTER', value: 1, today: TODAY })).classes[0].pctTotal, 0);
  await assert.rejects(getAttendanceOverview(db, { period: 'MONTH', value: 13, today: TODAY }), status(400));
  await assert.rejects(getAttendanceOverview(db, { period: 'WEEK', today: TODAY }), status(400));

  // classes without active students are left out
  await db.prepare("UPDATE Students SET Status = 'INACTIVE' WHERE ClassId = 12").run();
  assert.equal((await getAttendanceOverview(db, { period: 'YEAR', today: TODAY })).classes.length, 11);
});

test('absences list every session not present, unmarked weeks included, holidays skipped', async () => {
  const db = await emptyYear();
  const a = await admin(db);
  await db.prepare("INSERT INTO Holidays (WeekOf, Session) VALUES ('2026-09-13', 'ADORATION')").run();
  for (const weekOf of ['2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11']) {
    await saveStudentAttendance(db, a, { classId: 1, weekOf, records: [{ studentId: 1, marks: present }] });
  }
  await saveStudentAttendance(db, a, { classId: 1, weekOf: '2026-09-20', records: [{ studentId: 1, marks: { ...present, CATECHISM: 2, THURSDAY_MASS: 3 } }] });

  const r = await getStudentAbsences(db, { studentId: 1, today: TODAY });
  assert.equal(r.student.className, 'Chiên Con');
  assert.deepEqual(r.absences, [
    // 2026-09-06 has no row: all four sessions count as absent
    { weekOf: '2026-09-06', session: 'SUNDAY_MASS', mark: 3 },
    { weekOf: '2026-09-06', session: 'CATECHISM', mark: 3 },
    { weekOf: '2026-09-06', session: 'ADORATION', mark: 3 },
    { weekOf: '2026-09-06', session: 'THURSDAY_MASS', mark: 3 },
    { weekOf: '2026-09-20', session: 'CATECHISM', mark: 2 },
    { weekOf: '2026-09-20', session: 'THURSDAY_MASS', mark: 3 },
  ]);
  await assert.rejects(getStudentAbsences(db, { studentId: 9999, today: TODAY }), status(404));
});

test('a sector lists its class teachers without Xứ đoàn members; Xứ đoàn has its own list', async () => {
  const db = await seededD1();
  const sector = (await db.prepare("SELECT Id FROM Groups WHERE Name = 'Ngành Ấu'").first('Id'));
  const roster = await teacherRoster(db, sector);
  assert.equal(roster.length, 12);
  assert.deepEqual([...new Set(roster.map((t) => t.className))], ['Ấu 1', 'Ấu 2', 'Ấu 3']);
  const inClass = roster.filter((t) => t.className === 'Ấu 1').map((t) => t.firstName);
  assert.deepEqual(inClass, [...inClass].sort((x, y) => x.localeCompare(y, 'vi')));

  // an admin who also teaches a class of the sector is listed under Xứ đoàn only
  const classGroup = await db.prepare("SELECT Id FROM Groups WHERE Name = 'Lớp Ấu 1'").first('Id');
  await db.prepare('INSERT INTO Memberships (GroupId, UserId) VALUES (?, 1)').bind(classGroup).run();
  assert.equal((await teacherRoster(db, sector)).length, 12);
  const admins = await teacherRoster(db, 'ADMIN');
  assert.equal(admins.length, 5);
  assert.ok(admins.every((t) => t.className === null));

  // a locked teacher leaves the list
  await db.prepare("UPDATE Users SET Status = 'INACTIVE' WHERE Id = ?").bind(roster[0].userId).run();
  assert.equal((await teacherRoster(db, sector)).length, 11);
});

test('teacher attendance: changed rows only, five sessions, roster checked', async () => {
  const db = await emptyYear();
  const sector = await db.prepare("SELECT Id FROM Groups WHERE Name = 'Ngành Ấu'").first('Id');
  const [first, second] = await teacherRoster(db, sector);
  const five = { ...present, TEACHER_MEETING: 1 };
  await saveTeacherAttendance(db, { sectorGroupId: sector, weekOf: WEEK, records: [{ userId: first.userId, marks: five }, { userId: second.userId, marks: { TEACHER_MEETING: 2 } }] }, 1);
  await saveTeacherAttendance(db, { sectorGroupId: sector, weekOf: WEEK, records: [{ userId: second.userId, marks: {} }] }, 1);

  const read = await getTeacherAttendance(db, { sectorGroupId: sector, weekOf: WEEK });
  assert.equal(read.teachers.length, 12);
  assert.deepEqual(read.records, [{ userId: first.userId, marks: five }]);
  await assert.rejects(saveTeacherAttendance(db, { sectorGroupId: sector, weekOf: WEEK, records: [{ userId: 1, marks: five }] }, 1), status(400));
  await assert.rejects(saveTeacherAttendance(db, { sectorGroupId: sector, weekOf: '2026-09-07', records: [] }, 1), status(400));

  const stats = await getTeacherAttendanceStats(db, { sectorGroupId: sector, today: TODAY });
  assert.equal(stats.maxTotal, 30);
  const mine = stats.stats.find((s) => s.userId === first.userId);
  assert.deepEqual(mine.present, { SUNDAY_MASS: 1, CATECHISM: 1, ADORATION: 1, THURSDAY_MASS: 1, TEACHER_MEETING: 1 });
  assert.equal(mine.taught, await db.prepare("SELECT COUNT(*) AS n FROM Lessons WHERE TeacherId = ? AND SchoolYear = '2026-2027'").bind(first.userId).first('n'));
  assert.ok(!('email' in mine));
  assert.equal((await getTeacherAttendanceStats(db, { sectorGroupId: sector, classId: first.classId, today: TODAY })).stats.length, 4);
});

test('teacher search is exact and limited to the sectors of the user; only Xứ đoàn searches by email', async () => {
  const db = await emptyYear();
  const sectorAdmin = await loadSession(db, 'teacher02@example.com'); // BQT ngành Ấu
  const a = await admin(db);
  const mine = (await teacherRoster(db, sectorAdmin.sectorGroupIds[0]))[0];
  const theirs = (await teacherRoster(db, await db.prepare("SELECT Id FROM Groups WHERE Name = 'Ngành Thiếu'").first('Id')))[0];
  // unique names so the search result is predictable
  await db.prepare("UPDATE Users SET FullName = 'Trần Văn Riêng', FirstName = 'Riêng' WHERE Id = ?").bind(mine.userId).run();
  await db.prepare("UPDATE Users SET FullName = 'Lê Thị Khác', FirstName = 'Khác' WHERE Id = ?").bind(theirs.userId).run();

  assert.deepEqual((await searchTeachers(db, sectorAdmin, ' trần văn riêng ')).map((t) => t.userId), [mine.userId]);
  assert.deepEqual(await searchTeachers(db, sectorAdmin, 'Riêng'), []);
  assert.deepEqual(await searchTeachers(db, sectorAdmin, 'Lê Thị Khác'), []);
  assert.deepEqual(await searchTeachers(db, sectorAdmin, mine.email), []);
  assert.deepEqual((await searchTeachers(db, a, mine.email)).map((t) => t.userId), [mine.userId]);
  assert.deepEqual((await searchTeachers(db, a, 'Lê Thị Khác')).map((t) => t.userId), [theirs.userId]);
  assert.ok(!('email' in (await searchTeachers(db, a, mine.email))[0]));

  const five = { ...present, TEACHER_MEETING: 1 };
  for (const weekOf of ['2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11']) {
    await saveTeacherAttendance(db, { sectorGroupId: sectorAdmin.sectorGroupIds[0], weekOf, records: [{ userId: mine.userId, marks: five }] }, 1);
  }
  const r = await getTeacherAbsences(db, sectorAdmin, { userId: mine.userId, today: TODAY });
  assert.equal(r.teacher.fullName, 'Trần Văn Riêng');
  assert.deepEqual(r.absences.map((x) => [x.weekOf, x.session, x.mark]), [
    ['2026-09-06', 'SUNDAY_MASS', 3], ['2026-09-06', 'CATECHISM', 3], ['2026-09-06', 'ADORATION', 3], ['2026-09-06', 'THURSDAY_MASS', 3], ['2026-09-06', 'TEACHER_MEETING', 3],
  ]);
  await assert.rejects(getTeacherAbsences(db, sectorAdmin, { userId: theirs.userId, today: TODAY }), status(404));
});
