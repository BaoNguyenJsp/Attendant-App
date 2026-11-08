import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { generate, toSql } from '../scripts/seed-demo.mjs';

const TODAY = '2026-10-11'; // 6 Sundays since 2026-09-06

async function seeded() {
  const db = createD1();
  await db.exec(toSql(generate({ today: TODAY })));
  return db;
}
const count = (db, sql) => db.prepare(sql).first('n');

test('same input gives the same SQL', () => {
  assert.equal(toSql(generate({ today: TODAY })), toSql(generate({ today: TODAY })));
});

test('loading twice leaves one copy', async () => {
  const db = await seeded();
  await db.exec(toSql(generate({ today: TODAY })));
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Students'), 600);
});

test('classes, groups and users of section 11', async () => {
  const db = await seeded();
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Classes'), 12);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Groups'), 23);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Users'), 60);
  const order = await db.prepare('SELECT Name FROM Classes ORDER BY SortOrder').all();
  assert.deepEqual(order.results.map((r) => r.Name), [
    'Chiên Con', 'Ấu 1', 'Ấu 2', 'Ấu 3', 'Thiếu 1', 'Thiếu 2', 'Thiếu 3', 'Nghĩa 1', 'Nghĩa 2', 'Nghĩa 3', 'Dự bị trưởng 1', 'Dự bị trưởng 2',
  ]);
  const tiers = await db.prepare('SELECT g.Type, COUNT(*) AS n FROM Memberships m JOIN Groups g ON g.Id = m.GroupId GROUP BY g.Type ORDER BY g.Type').all();
  assert.deepEqual(tiers.results, [{ Type: 'ADMIN', n: 5 }, { Type: 'CLASS', n: 48 }, { Type: 'SECTOR', n: 2 }, { Type: 'SECTOR_ADMIN', n: 5 }]);
  assert.equal(await count(db, 'SELECT COUNT(DISTINCT UserId) AS n FROM Memberships'), 60);
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM Users u JOIN Memberships m ON m.UserId = u.Id JOIN Groups g ON g.Id = m.GroupId WHERE u.Email = 'doruoora@gmail.com' AND g.Type = 'ADMIN'"), 1);
  // every class has 4 teachers; every sector admin group points to a sector
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM (SELECT gc.ClassId FROM GroupClasses gc JOIN Groups g ON g.Id = gc.GroupId AND g.Type = \'CLASS\' JOIN Memberships m ON m.GroupId = g.Id GROUP BY gc.ClassId HAVING COUNT(*) = 4)'), 12);
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM Groups a JOIN Groups s ON s.Id = a.SectorGroupId AND s.Type = 'SECTOR' WHERE a.Type = 'SECTOR_ADMIN'"), 5);
});

test('600 students, 50 per class, 25 girls and 25 boys, distinct CCCD', async () => {
  const db = await seeded();
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Students'), 600);
  assert.equal(await count(db, 'SELECT COUNT(DISTINCT IdKey) AS n FROM Students'), 600);
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM (SELECT ClassId FROM Students GROUP BY ClassId HAVING COUNT(*) = 50 AND SUM(Gender = 'F') = 25)"), 12);
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM Students WHERE length(IdNumber) <> 12 OR Status <> 'ACTIVE' OR PhotoVersion <> 0"), 0);
});

test('about 40 families, each with 2 or 3 students of different classes', async () => {
  const db = await seeded();
  const { results } = await db.prepare('SELECT COUNT(*) AS size, COUNT(DISTINCT s.ClassId) AS classes FROM SiblingMembers m JOIN Students s ON s.Id = m.StudentId GROUP BY m.FamilyId').all();
  assert.equal(results.length, 40);
  assert.ok(results.every((f) => f.size >= 2 && f.size <= 3 && f.classes === f.size));
});

test('past year: full record for 550 students, none for the first class, class = the one before', async () => {
  const db = await seeded();
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM AcademicYear WHERE SchoolYear = '2025-2026'"), 550);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM AcademicYear'), 550);
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM AcademicYear a JOIN Students s ON s.Id = a.StudentId JOIN Classes c ON c.Id = s.ClassId WHERE c.SortOrder = 1"), 0);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM AcademicYear a JOIN Students s ON s.Id = a.StudentId JOIN Classes now ON now.Id = s.ClassId JOIN Classes before ON before.SortOrder = now.SortOrder - 1 WHERE a.ClassName = before.Name'), 550);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM AcademicYear WHERE Semester1Avg IS NULL OR Semester2Avg IS NULL OR YearAvg IS NULL OR AttendancePct IS NULL OR Rating IS NULL'), 0);
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM AcademicYear WHERE Rating <> CASE WHEN YearAvg >= 8 THEN 'EXCELLENT' WHEN YearAvg >= 6.5 THEN 'GOOD' ELSE 'AVERAGE' END AND abs(YearAvg - 8) > 0.05 AND abs(YearAvg - 6.5) > 0.05"), 0);
  const one = await db.prepare("SELECT a.ClassName FROM AcademicYear a JOIN Students s ON s.Id = a.StudentId JOIN Classes c ON c.Id = s.ClassId WHERE c.Name = 'Ấu 1' LIMIT 1").first('ClassName');
  assert.equal(one, 'Chiên Con');
});

test('current year: attendance for each Sunday so far, no empty rows, HK1 scores only', async () => {
  const db = await seeded();
  assert.equal(await count(db, 'SELECT COUNT(DISTINCT WeekOf) AS n FROM Attendance'), 6);
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM Attendance WHERE strftime('%w', WeekOf) <> '0'"), 0);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Attendance WHERE SundayMass + Catechism + Adoration + ThursdayMass = 0'), 0);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM TeacherAttendance WHERE SundayMass + Catechism + Adoration + ThursdayMass + TeacherMeeting = 0'), 0);
  const rows = await count(db, 'SELECT COUNT(*) AS n FROM Attendance');
  assert.ok(rows > 600 * 6 * 0.85 && rows < 600 * 6 * 0.95, `attendance rows: ${rows}`);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Scores WHERE QuizS1 IS NOT NULL AND ExamS1 IS NOT NULL AND QuizS2 IS NULL AND ExamS2 IS NULL'), 600);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Lessons'), 36);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM Holidays'), 1);
  assert.equal(await db.prepare("SELECT Value FROM Config WHERE Key = 'CurrentSchoolYear'").first('Value'), '2026-2027');
});

test('toSql escapes quotes and writes NULL', () => {
  const sql = toSql({ Config: [{ Key: "a'b", Value: null }] });
  assert.match(sql, /INSERT INTO Config \(Key, Value\) VALUES\n\('a''b', NULL\);/);
});

test('before the first Sunday there is no attendance and no lesson', () => {
  const data = generate({ today: '2026-09-01' });
  assert.equal(data.Attendance.length, 0);
  assert.equal(data.Lessons.length, 0);
  assert.equal(data.Students.length, 600);
});
