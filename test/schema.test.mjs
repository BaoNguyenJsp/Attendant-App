import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';

const TABLES = [
  'AcademicYear', 'Attendance', 'Classes', 'Config', 'ConfigHistory', 'DriveFolders', 'DriveTrash',
  'GroupClasses', 'Groups', 'Holidays', 'LessonFiles', 'Lessons', 'Memberships', 'Scores', 'Secrets',
  'SiblingMembers', 'Students', 'TeacherAttendance', 'Users',
];

async function seedOneStudent(db) {
  await db.batch([
    db.prepare("INSERT INTO Classes (Id, Name, SortOrder) VALUES (1, 'Chiên Con', 1)"),
    db.prepare("INSERT INTO Students (Id, IdNumber, IdKey, FullName, FirstName, ClassId) VALUES (1, '079300000001', '79300000001', 'Nguyễn Thị An', 'An', 1)"),
  ]);
}

test('schema creates every table of section 5', async () => {
  const db = createD1();
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
  assert.deepEqual(results.map((r) => r.name), TABLES);
});

test('student defaults: ACTIVE, no photo', async () => {
  const db = createD1();
  await seedOneStudent(db);
  const row = await db.prepare('SELECT Status, PhotoVersion FROM Students WHERE Id = ?').bind(1).first();
  assert.deepEqual(row, { Status: 'ACTIVE', PhotoVersion: 0 });
});

test('a second student with the same IdKey is refused', async () => {
  const db = createD1();
  await seedOneStudent(db);
  await assert.rejects(
    db.prepare("INSERT INTO Students (IdNumber, IdKey, FullName, FirstName, ClassId) VALUES ('79300000001', '79300000001', 'Trần Văn B', 'B', 1)").run(),
    /UNIQUE/,
  );
});

test('user email is unique ignoring case', async () => {
  const db = createD1();
  await db.prepare("INSERT INTO Users (Email, FullName, FirstName) VALUES ('a@example.com', 'A', 'A')").run();
  await assert.rejects(
    db.prepare("INSERT INTO Users (Email, FullName, FirstName) VALUES ('A@Example.com', 'B', 'B')").run(),
    /UNIQUE/,
  );
});

test('attendance mark outside 0-3 is refused', async () => {
  const db = createD1();
  await seedOneStudent(db);
  await assert.rejects(
    db.prepare("INSERT INTO Attendance (StudentId, WeekOf, ClassId, SundayMass) VALUES (1, '2026-09-06', 1, 4)").run(),
    /CHECK/,
  );
});

test('score outside 0-10 is refused; 0 and NULL are kept apart', async () => {
  const db = createD1();
  await seedOneStudent(db);
  await assert.rejects(db.prepare('INSERT INTO Scores (StudentId, ClassId, QuizS1) VALUES (1, 1, 10.5)').run(), /CHECK/);
  await db.prepare('INSERT INTO Scores (StudentId, ClassId, QuizS1) VALUES (1, 1, 0)').run();
  const row = await db.prepare('SELECT QuizS1, ExamS1 FROM Scores WHERE StudentId = 1').first();
  assert.deepEqual(row, { QuizS1: 0, ExamS1: null });
});

test('a holiday needs a session code; whole-week rows do not exist', async () => {
  const db = createD1();
  await assert.rejects(db.prepare("INSERT INTO Holidays (WeekOf, Session) VALUES ('2026-09-27', '')").run(), /CHECK/);
});

test('lesson location defaults to Trong lớp', async () => {
  const db = createD1();
  await seedOneStudent(db);
  await db.prepare("INSERT INTO Users (Id, Email, FullName, FirstName) VALUES (1, 'a@example.com', 'A', 'A')").run();
  await db.prepare("INSERT INTO Lessons (SchoolYear, WeekOf, ClassId, TeacherId) VALUES ('2026-2027', '2026-09-06', 1, 1)").run();
  assert.equal(await db.prepare('SELECT Location FROM Lessons').first('Location'), 'Trong lớp');
});

test('batch is all or nothing', async () => {
  const db = createD1();
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO Classes (Id, Name, SortOrder) VALUES (1, 'Ấu 1', 1)"),
    db.prepare("INSERT INTO Classes (Id, Name, SortOrder) VALUES (2, 'Ấu 1', 2)"),
  ]));
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM Classes').first('n'), 0);
});

test('deleting a student removes their attendance, scores and family link', async () => {
  const db = createD1();
  await seedOneStudent(db);
  await db.batch([
    db.prepare("INSERT INTO Attendance (StudentId, WeekOf, ClassId, SundayMass) VALUES (1, '2026-09-06', 1, 1)"),
    db.prepare('INSERT INTO Scores (StudentId, ClassId) VALUES (1, 1)'),
    db.prepare('INSERT INTO SiblingMembers (StudentId, FamilyId) VALUES (1, 1)'),
  ]);
  await db.prepare('DELETE FROM Students WHERE Id = 1').run();
  const n = await db.prepare('SELECT (SELECT COUNT(*) FROM Attendance) + (SELECT COUNT(*) FROM Scores) + (SELECT COUNT(*) FROM SiblingMembers) AS n').first('n');
  assert.equal(n, 0);
});
