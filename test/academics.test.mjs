import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1, TODAY } from './helpers/seeded.mjs';
import { AppError } from '../src/lib/errors.js';
import { loadSession } from '../src/lib/db/users.js';
import { getScores, saveScores, getClassReport, getStudentRecord, startSchoolYear } from '../src/lib/db/academics.js';

const status = (code) => (e) => e instanceof AppError && e.status === code;
const teacher = (db) => loadSession(db, 'teacher08@example.com'); // class 1
const count = (db, sql) => db.prepare(sql).first('n');
const blank = { quizS1: null, examS1: null, quizS2: null, examS2: null };

test('scores: 0 is kept, blank stays blank, only the students sent are written', async () => {
  const db = await seededD1();
  const before = await db.prepare('SELECT QuizS1 FROM Scores WHERE StudentId = 3').first('QuizS1');
  await saveScores(db, await teacher(db), { classId: 1, scores: [
    { studentId: 1, quizS1: 0, examS1: '7,5', quizS2: '', examS2: null },
    { studentId: 2, ...blank },
  ] });
  const scores = await getScores(db, { classId: 1 });
  assert.equal(scores.length, 49); // student 2 has no row any more
  assert.deepEqual(scores.find((s) => s.studentId === 1), { studentId: 1, quizS1: 0, examS1: 7.5, quizS2: null, examS2: null });
  assert.equal(scores.find((s) => s.studentId === 3).quizS1, before);
  assert.equal(await db.prepare('SELECT UpdatedBy FROM Scores WHERE StudentId = 1').first('UpdatedBy'), 13);
});

test('an invalid score refuses the whole save', async () => {
  const db = await seededD1();
  const t = await teacher(db);
  const old = await db.prepare('SELECT QuizS1 FROM Scores WHERE StudentId = 1').first('QuizS1');
  for (const bad of [10.5, -1, 'abc', true]) {
    await assert.rejects(saveScores(db, t, { classId: 1, scores: [{ studentId: 1, ...blank, quizS1: 9 }, { studentId: 2, ...blank, examS1: bad }] }),
      (e) => status(400)(e) && e.message === 'Điểm phải từ 0 đến 10');
  }
  assert.equal(await db.prepare('SELECT QuizS1 FROM Scores WHERE StudentId = 1').first('QuizS1'), old);
  await assert.rejects(saveScores(db, t, { classId: 2, scores: [] }), status(403));
  await assert.rejects(saveScores(db, t, { classId: 1, scores: [{ studentId: 51, ...blank, quizS1: 5 }] }), status(400));
});

test('the class report of the current year is computed live', async () => {
  const db = await seededD1();
  await saveScores(db, await teacher(db), { classId: 1, scores: [{ studentId: 1, quizS1: 8, examS1: 9, quizS2: 7, examS2: 8 }, { studentId: 2, ...blank }] });
  await db.exec("DELETE FROM Attendance; DELETE FROM Holidays; INSERT INTO Attendance (StudentId, WeekOf, ClassId, SundayMass, Catechism, Adoration, ThursdayMass) VALUES (1, '2026-09-06', 1, 1, 1, 1, 1);");
  await db.prepare("UPDATE Students SET Status = 'INACTIVE' WHERE Id = 3").run();

  const rows = await getClassReport(db, { classId: 1, today: TODAY });
  assert.equal(rows.length, 49);
  const one = rows.find((r) => r.studentId === 1);
  assert.deepEqual([one.className, one.semester1Avg, one.semester2Avg, one.yearAvg, one.attendancePct, one.rating], ['Chiên Con', 8.7, 7.7, 8, 17, 'EXCELLENT']); // 4 of 24
  const two = rows.find((r) => r.studentId === 2);
  assert.deepEqual([two.semester1Avg, two.yearAvg, two.attendancePct, two.rating], [null, null, 0, null]);
  assert.equal((await getClassReport(db, { today: TODAY })).length, 599);
  assert.equal((await getClassReport(db, { schoolYear: '2026-2027', classId: 1, today: TODAY })).length, 49);
});

test('a past year comes from the archive, by the class of that year', async () => {
  const db = await seededD1();
  const classId = await db.prepare("SELECT Id FROM Classes WHERE Name = 'Ấu 1'").first('Id');
  const rows = await getClassReport(db, { schoolYear: '2025-2026', classId, today: TODAY });
  assert.equal(rows.length, 50);
  assert.ok(rows.every((r) => r.className === 'Ấu 1' && r.yearAvg !== null && r.rating));
  assert.equal((await getClassReport(db, { schoolYear: '2025-2026', today: TODAY })).length, 550);
  assert.deepEqual(await getClassReport(db, { schoolYear: '2025-2026', classId: 999, today: TODAY }), []);
});

test('the record of a student has the past years and the live current year', async () => {
  const db = await seededD1();
  const r = await getStudentRecord(db, { studentId: 51, today: TODAY });
  assert.equal(r.student.className, 'Ấu 1');
  assert.equal(r.history.length, 1);
  assert.deepEqual([r.history[0].schoolYear, r.history[0].className], ['2025-2026', 'Chiên Con']);
  assert.deepEqual([r.current.schoolYear, r.current.className], ['2026-2027', 'Ấu 1']);
  assert.ok(r.current.semester1Avg !== null && r.current.semester2Avg === null);
  assert.deepEqual((await getStudentRecord(db, { studentId: 1, today: TODAY })).history, []);
  await db.prepare("UPDATE Students SET Status = 'GRADUATED' WHERE Id = 51").run();
  assert.equal((await getStudentRecord(db, { studentId: 51, today: TODAY })).current, null);
  await assert.rejects(getStudentRecord(db, { studentId: 9999, today: TODAY }), status(404));
});

test('the rollover archives, clears, promotes and moves the year in one step', async () => {
  const db = await seededD1();
  await db.prepare("UPDATE Students SET Status = 'INACTIVE' WHERE Id = 1").run();
  const expected = (await getClassReport(db, { classId: 2, today: TODAY })).find((r) => r.studentId === 51);
  // a leftover archive row of a failed earlier attempt must not block the retry
  await db.prepare("INSERT INTO AcademicYear (SchoolYear, StudentId, ClassName) VALUES ('2026-2027', 51, 'leftover')").run();

  assert.deepEqual(await startSchoolYear(db, { attendanceStartDate: '2027-09-05', today: TODAY }, 1), { newYear: '2027-2028' });

  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM AcademicYear WHERE SchoolYear = '2026-2027'"), 599); // active students only
  const archived = await db.prepare("SELECT ClassName, Semester1Avg, YearAvg, AttendancePct, Rating FROM AcademicYear WHERE SchoolYear = '2026-2027' AND StudentId = 51").first();
  assert.deepEqual(archived, { ClassName: 'Ấu 1', Semester1Avg: expected.semester1Avg, YearAvg: expected.yearAvg, AttendancePct: expected.attendancePct, Rating: expected.rating });
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM AcademicYear WHERE SchoolYear = '2025-2026'"), 550);
  assert.equal(await count(db, 'SELECT (SELECT COUNT(*) FROM Attendance) + (SELECT COUNT(*) FROM Scores) + (SELECT COUNT(*) FROM TeacherAttendance) + (SELECT COUNT(*) FROM Holidays) AS n'), 0);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Lessons'), 36);

  // in place: still 600 students; each active one moved up once; the last class keeps its own and takes the one below
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Students'), 600);
  const sizes = (await db.prepare('SELECT ClassId, COUNT(*) AS n FROM Students GROUP BY ClassId ORDER BY ClassId').all()).results;
  assert.deepEqual(sizes.map((r) => [r.ClassId, r.n]), [[1, 1], [2, 49], [3, 50], [4, 50], [5, 50], [6, 50], [7, 50], [8, 50], [9, 50], [10, 50], [11, 50], [12, 100]]);
  assert.equal(await db.prepare('SELECT ClassId FROM Students WHERE Id = 1').first('ClassId'), 1); // inactive: not moved
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM Students WHERE Status = 'GRADUATED'"), 0);

  const config = Object.fromEntries((await db.prepare('SELECT Key, Value FROM Config').all()).results.map((r) => [r.Key, r.Value]));
  assert.deepEqual([config.CurrentSchoolYear, config.AttendanceStartDate], ['2027-2028', '2027-09-05']);
  const history = (await db.prepare("SELECT Key, Value FROM ConfigHistory WHERE Action = 'UPDATED' ORDER BY Key").all()).results;
  assert.deepEqual(history, [{ Key: 'AttendanceStartDate', Value: '2027-09-05' }, { Key: 'CurrentSchoolYear', Value: '2027-2028' }]);
});

test('a refused rollover changes nothing', async () => {
  const db = await seededD1();
  await assert.rejects(startSchoolYear(db, { attendanceStartDate: '05/09/2027', today: TODAY }, 1), status(400));
  await assert.rejects(startSchoolYear(db, { today: TODAY }, 1), status(400));
  assert.equal(await db.prepare("SELECT Value FROM Config WHERE Key = 'CurrentSchoolYear'").first('Value'), '2026-2027');
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Scores'), 600);
});
