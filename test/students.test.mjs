import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1 } from './helpers/seeded.mjs';
import { AppError } from '../src/lib/errors.js';
import { loadSession } from '../src/lib/db/users.js';
import { listStudents, saveStudent, importStudents, deleteStudent, getStudent, setPhotoVersion } from '../src/lib/db/students.js';

const status = (code) => (e) => e instanceof AppError && e.status === code;
const admin = (db) => loadSession(db, 'doruoora@gmail.com');
const teacher = (db) => loadSession(db, 'teacher08@example.com'); // class 1 only
const row = (db, id) => db.prepare('SELECT * FROM Students WHERE Id = ?').bind(id).first();
const family = async (db, id) => (await listStudents(db)).find((s) => s.id === id).siblingIds.sort((a, b) => a - b);
const fresh = { idNumber: '079399999999', fullName: 'Nguyễn Thị Mới', classId: 1 };

async function noFamilies(db) {
  await db.exec('DELETE FROM SiblingMembers');
  return db;
}

test('listStudents gives phones as a list and siblings by id', async () => {
  const db = await seededD1();
  const students = await listStudents(db);
  assert.equal(students.length, 600);
  assert.ok(students.every((s) => Array.isArray(s.phones) && s.phones.length >= 1 && s.hasPhoto === false));
  const withSiblings = students.filter((s) => s.siblingIds.length);
  assert.equal(withSiblings.length, 99);
  const one = withSiblings[0];
  assert.ok(one.siblingIds.every((id) => students.find((s) => s.id === id).siblingIds.includes(one.id)));
});

test('a teacher adds a student to their class; the student is active whatever is sent', async () => {
  const db = await seededD1();
  const { id } = await saveStudent(db, await teacher(db), { ...fresh, status: 'GRADUATED', phones: ['0901', ' ', '0902'] }, { year: 2026 });
  const s = await row(db, id);
  assert.deepEqual([s.IdKey, s.FirstName, s.Status, s.Phone, s.EnrollYear, s.UpdatedBy], ['79399999999', 'Mới', 'ACTIVE', '0901 / 0902', 2026, 13]);
});

test('a teacher cannot add to or edit a class outside their scope', async () => {
  const db = await seededD1();
  await assert.rejects(saveStudent(db, await teacher(db), { ...fresh, classId: 2 }), status(403));
  const other = await row(db, 51); // class 2
  await assert.rejects(saveStudent(db, await teacher(db), { id: 51, idNumber: other.IdNumber, fullName: 'X', classId: 2 }), status(403));
  // naming their own class in the request does not help: the stored class decides
  await assert.rejects(saveStudent(db, await teacher(db), { id: 51, idNumber: other.IdNumber, fullName: 'X', classId: 1 }), status(403));
});

test('a CCCD already in use is refused with the holder name and class', async () => {
  const db = await seededD1();
  const holder = await row(db, 51);
  const sameKey = `'${holder.IdNumber.replace(/^0+/, '')}`;
  await assert.rejects(saveStudent(db, await admin(db), { ...fresh, idNumber: sameKey }), (e) => status(409)(e) && e.message === `Số CCCD này đã thuộc về ${holder.FullName} (Ấu 1)`);
  await assert.rejects(saveStudent(db, await admin(db), { id: 1, idNumber: holder.IdNumber, fullName: 'X', classId: 1 }), status(409));
});

test('a CCCD with an empty key is refused', async () => {
  const db = await seededD1();
  for (const idNumber of ['000', "'", ' ', null]) await assert.rejects(saveStudent(db, await admin(db), { ...fresh, idNumber }), status(400));
});

test('required fields and codes are checked', async () => {
  const db = await seededD1();
  const a = await admin(db);
  await assert.rejects(saveStudent(db, a, { ...fresh, fullName: ' ' }), status(400));
  await assert.rejects(saveStudent(db, a, { ...fresh, classId: 99 }), status(400));
  await assert.rejects(saveStudent(db, a, { ...fresh, gender: 'X' }), status(400));
  await assert.rejects(saveStudent(db, a, { ...fresh, dateOfBirth: '2020-02-30' }), status(400));
  await assert.rejects(saveStudent(db, a, { ...fresh, enrollYear: 'abc' }), status(400));
  await assert.rejects(saveStudent(db, a, { id: 1, idNumber: '079300000001', fullName: 'X', classId: 1, status: 'GONE' }), status(400));
  await assert.rejects(saveStudent(db, a, { id: 9999, ...fresh }), status(404));
});

test('editing: the CCCD can be corrected, the status set, and only an admin moves the class', async () => {
  const db = await seededD1();
  const before = await row(db, 1);
  const input = { id: 1, idNumber: '079388888888', fullName: before.FullName, classId: 1, status: 'INACTIVE', gender: 'F', dateOfBirth: '2020-05-06' };
  await saveStudent(db, await teacher(db), input);
  const after = await row(db, 1);
  assert.deepEqual([after.IdNumber, after.IdKey, after.Status, after.EnrollYear, after.DateOfBirth], ['079388888888', '79388888888', 'INACTIVE', before.EnrollYear, '2020-05-06']);
  await assert.rejects(saveStudent(db, await teacher(db), { ...input, classId: 2 }), (e) => status(403)(e) && /Xứ đoàn/.test(e.message));
  await saveStudent(db, await admin(db), { ...input, classId: 2 });
  assert.equal((await row(db, 1)).ClassId, 2);
});

test('siblings: adding merges families, removing takes one out, a family of one disappears', async () => {
  const db = await noFamilies(await seededD1());
  const a = await admin(db);
  const save = (id, siblingIds) => saveStudent(db, a, { id, idNumber: `0793${String(id).padStart(8, '0')}`, fullName: `Học Sinh ${id}`, classId: Math.ceil(id / 50), siblingIds });

  const first = await save(1, [51]);
  assert.deepEqual(first.affectedIds.sort((x, y) => x - y), [1, 51]);
  await save(101, [151]);
  // 1 adds 101: the two families become one
  const merged = await save(1, [51, 101]);
  assert.deepEqual(merged.affectedIds.sort((x, y) => x - y), [1, 51, 101, 151]);
  assert.deepEqual(await family(db, 151), [1, 51, 101]);
  assert.equal(await db.prepare('SELECT COUNT(DISTINCT FamilyId) AS n FROM SiblingMembers').first('n'), 1);

  // 1 removes 51: only 51 leaves
  await save(1, [101, 151]);
  assert.deepEqual(await family(db, 51), []);
  assert.deepEqual(await family(db, 101), [1, 151]);

  // without siblingIds the family is not touched
  await saveStudent(db, a, { id: 1, idNumber: '079300000001', fullName: 'Học Sinh 1', classId: 1 });
  assert.deepEqual(await family(db, 1), [101, 151]);

  // removing everyone leaves no row for anybody
  await save(101, []);
  await save(1, []);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM SiblingMembers').first('n'), 0);
  await assert.rejects(save(1, [9999]), status(400));
});

test('import: updates by CCCD into the selected class, creates the rest, keeps what the file does not hold', async () => {
  const db = await seededD1();
  const existing = await row(db, 51); // class 2, to be pulled into class 1
  const count = await importStudents(db, await admin(db), {
    classId: 1,
    students: [
      { idNumber: `'${existing.IdNumber}`, fullName: 'Tên Đã Sửa', gender: 'M', phones: [] },
      { idNumber: '079377777777', fullName: 'Lê Văn Mới', saintName: 'Giuse', gender: 'M', dateOfBirth: '2019-01-02', phones: ['0911', '0922'] },
      { idNumber: '', fullName: 'Thiếu CCCD' },
      { idNumber: '079366666666', fullName: ' ' },
    ],
  }, { year: 2030 });
  assert.equal(count, 2);
  const updated = await row(db, 51);
  assert.deepEqual([updated.FullName, updated.FirstName, updated.ClassId, updated.Phone, updated.EnrollYear, updated.Status, updated.IdNumber],
    ['Tên Đã Sửa', 'Sửa', 1, existing.Phone, existing.EnrollYear, 'ACTIVE', existing.IdNumber]);
  const created = await db.prepare("SELECT * FROM Students WHERE IdKey = '79377777777'").first();
  assert.deepEqual([created.ClassId, created.EnrollYear, created.Status, created.Phone, created.UpdatedBy], [1, 2030, 'ACTIVE', '0911 / 0922', 1]);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM Students').first('n'), 601);
});

test('import refuses a file with a bad date or gender and changes nothing', async () => {
  const db = await seededD1();
  const good = { idNumber: '079377777777', fullName: 'Lê Văn Mới' };
  await assert.rejects(importStudents(db, await admin(db), { classId: 1, students: [good, { ...good, idNumber: '079377777778', dateOfBirth: '31/12/2019' }] }), status(400));
  await assert.rejects(importStudents(db, await admin(db), { classId: 1, students: [{ ...good, gender: 'Nam' }] }), status(400));
  await assert.rejects(importStudents(db, await admin(db), { classId: 99, students: [good] }), status(400));
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM Students').first('n'), 600);
});

test('photo version marks whether a student has a photo', async () => {
  const db = await seededD1();
  await setPhotoVersion(db, 1, 1760000000, 1);
  assert.deepEqual(await getStudent(db, 1), { id: 1, idNumber: '079300000001', fullName: (await row(db, 1)).FullName, classId: 1, photoVersion: 1760000000 });
  assert.equal((await listStudents(db)).find((s) => s.id === 1).hasPhoto, true);
  await setPhotoVersion(db, 1, 0, 1);
  assert.equal((await getStudent(db, 1)).photoVersion, 0);
  assert.equal(await getStudent(db, 9999), null);
  await assert.rejects(setPhotoVersion(db, 9999, 1, 1), status(404));
});

test('a teacher imports into their own class only, and cannot pull a student from another class', async () => {
  const db = await seededD1();
  const t = await teacher(db);
  const good = { idNumber: '079377777777', fullName: 'Lê Văn Mới' };
  await assert.rejects(importStudents(db, t, { classId: 2, students: [good] }), status(403));
  const other = await row(db, 51); // class 2
  await assert.rejects(importStudents(db, t, { classId: 1, students: [good, { idNumber: other.IdNumber, fullName: 'X' }] }), status(403));
  assert.equal((await row(db, 51)).ClassId, 2);
  const mine = await row(db, 1); // class 1
  assert.equal(await importStudents(db, t, { classId: 1, students: [good, { idNumber: mine.IdNumber, fullName: 'Tên Mới' }] }), 2);
  assert.equal((await row(db, 1)).FullName, 'Tên Mới');
});

test('deleting a student: their class only, attendance goes with them, a family of two ends', async () => {
  const db = await noFamilies(await seededD1());
  const s1 = await row(db, 1);
  await saveStudent(db, await admin(db), { id: 1, idNumber: s1.IdNumber, fullName: s1.FullName, classId: 1, siblingIds: [2] });
  await db.prepare("INSERT OR REPLACE INTO Attendance (StudentId, ClassId, WeekOf, SundayMass) VALUES (1, 1, '2026-09-06', 1)").run();
  await assert.rejects(deleteStudent(db, await teacher(db), 51), status(403)); // class 2
  await assert.rejects(deleteStudent(db, await teacher(db), 9999), status(404));
  await deleteStudent(db, await teacher(db), 1);
  assert.equal(await row(db, 1), null);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM Attendance WHERE StudentId = 1').first('n'), 0);
  assert.deepEqual(await family(db, 2), []);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM SiblingMembers').first('n'), 0);
});

test('address: saved by the form, listed, and kept by an import row that leaves it blank', async () => {
  const db = await seededD1();
  const { id } = await saveStudent(db, await admin(db), { ...fresh, address: ' 12 Lê Lợi, Q.1 ' });
  assert.equal((await listStudents(db)).find((s) => s.id === id).address, '12 Lê Lợi, Q.1');
  await importStudents(db, await admin(db), { classId: 1, students: [{ ...fresh, address: '' }] });
  assert.equal((await row(db, id)).Address, '12 Lê Lợi, Q.1');
  await importStudents(db, await admin(db), { classId: 1, students: [{ ...fresh, address: '34 Hai Bà Trưng' }] });
  assert.equal((await row(db, id)).Address, '34 Hai Bà Trưng');
  await saveStudent(db, await admin(db), { ...fresh, id, address: '' });
  assert.equal((await row(db, id)).Address, null);
});
