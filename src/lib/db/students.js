// Students: list, save (UC-S2, S3), siblings (UC-S4, see families.js), Excel import (UC-S5), photo mark (UC-S6).
import { all, now, textOrNull } from './sql.js';
import { fail } from '../errors.js';
import { requireClass, isAdmin } from '../access.js';
import { idKey, firstName, splitPhones, joinPhones, isDate, todayVN } from '../text.js';
import { STUDENT_STATUSES, GENDERS } from '../codes.js';
import { familyOf, leave, leaveFamily, setFamily, tidyFamily } from './families.js';

const thisYear = () => Number(todayVN().slice(0, 4));

export async function listStudents(db) {
  const rows = await all(db, `
    SELECT Id AS id, IdNumber AS idNumber, SaintName AS saintName, FullName AS fullName, FirstName AS firstName,
           DateOfBirth AS dateOfBirth, Gender AS gender, Father AS father, Mother AS mother, Address AS address, Phone AS phone,
           ClassId AS classId, EnrollYear AS enrollYear, Status AS status, PhotoVersion AS photoVersion
    FROM Students ORDER BY Id`);
  return rows.map(({ phone, ...s }) => ({ ...s, phones: splitPhones(phone), hasPhoto: s.photoVersion > 0 }));
}

export const getStudent = (db, id) => db
  .prepare('SELECT Id AS id, IdNumber AS idNumber, FullName AS fullName, ClassId AS classId, PhotoVersion AS photoVersion FROM Students WHERE Id = ?')
  .bind(id).first();

export async function setPhotoVersion(db, id, version, actorId) {
  const r = await db.prepare('UPDATE Students SET PhotoVersion = ?, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?').bind(version, now(), actorId, id).run();
  if (!r.meta.changes) fail(404, 'Không tìm thấy Thiếu nhi.');
}

// The fields of one student as typed or imported, validated and normalised.
function readFields(input) {
  const idNumber = String(input.idNumber ?? '').trim().replace(/^'+/, '');
  const fullName = String(input.fullName ?? '').trim();
  const gender = input.gender || null;
  const dateOfBirth = input.dateOfBirth || null;
  if (!idKey(idNumber)) fail(400, 'Số CCCD không hợp lệ.');
  if (!fullName) fail(400, 'Thiếu họ tên.');
  if (gender !== null && !GENDERS.includes(gender)) fail(400, `Giới tính không hợp lệ: ${fullName}`);
  if (dateOfBirth !== null && !isDate(dateOfBirth)) fail(400, `Ngày sinh không hợp lệ: ${fullName}`);
  return {
    idNumber, key: idKey(idNumber), fullName, gender, dateOfBirth,
    saintName: textOrNull(input.saintName), father: textOrNull(input.father), mother: textOrNull(input.mother), address: textOrNull(input.address),
    phone: joinPhones(input.phones),
  };
}

// A graduate becomes an active user in the class group of this class. The placeholder email (.invalid) can never sign in
// with Google, so the account is safe until Xứ đoàn sets the real email.
const GRADUATE_CLASS = 'Chiên Con';

async function requireClassExists(db, classId) {
  if (!(await db.prepare('SELECT Id FROM Classes WHERE Id = ?').bind(classId).first())) fail(400, 'Lớp không tồn tại.');
}

export async function saveStudent(db, actor, input, { year = thisYear() } = {}) {
  const id = input.id ?? null;
  const old = id === null ? null : await db.prepare('SELECT ClassId, Status, EnrollYear FROM Students WHERE Id = ?').bind(id).first();
  if (id !== null && !old) fail(404, 'Không tìm thấy Thiếu nhi.');
  const f = readFields(input);
  const classId = Number(input.classId);
  await requireClassExists(db, classId);

  // R3: the right comes from the class stored for the student, not from the class named in the request.
  requireClass(actor, old ? old.ClassId : classId);
  if (old && classId !== old.ClassId && !isAdmin(actor)) fail(403, 'Chỉ Xứ đoàn được chuyển Thiếu nhi sang lớp khác.');

  const status = old ? (input.status ?? old.Status) : 'ACTIVE';
  if (!STUDENT_STATUSES.includes(status)) fail(400, 'Trạng thái không hợp lệ.');
  // A graduate who became a user keeps the status for good.
  if (old?.Status === 'GRADUATED' && status !== 'GRADUATED' && await db.prepare('SELECT 1 FROM SiblingUsers WHERE StudentId = ?').bind(id).first()) {
    fail(400, 'Thiếu nhi đã tốt nghiệp thành Huynh trưởng, không đổi được trạng thái.');
  }
  const graduating = !!old && status === 'GRADUATED' && old.Status !== 'GRADUATED';
  if (graduating) {
    if (!isAdmin(actor)) fail(403, 'Chỉ Xứ đoàn được cho Thiếu nhi tốt nghiệp.');
    const lastClass = await db.prepare('SELECT Id, Name FROM Classes ORDER BY SortOrder DESC LIMIT 1').first();
    if (classId !== lastClass.Id) fail(400, `Chỉ Thiếu nhi lớp ${lastClass.Name} được tốt nghiệp.`);
  }
  const leaving = !!old && status === 'INACTIVE' && old.Status !== 'INACTIVE';
  const blankYear = input.enrollYear === undefined || input.enrollYear === null || input.enrollYear === '';
  const enrollYear = blankYear ? (old ? old.EnrollYear : year) : Number(input.enrollYear);
  if (enrollYear !== null && !(Number.isInteger(enrollYear) && enrollYear >= 1900 && enrollYear <= 2100)) fail(400, 'Năm nhập học không hợp lệ.');

  const holder = await db.prepare('SELECT s.Id, s.FullName, c.Name FROM Students s JOIN Classes c ON c.Id = s.ClassId WHERE s.IdKey = ?').bind(f.key).first();
  if (holder && holder.Id !== id) fail(409, `Số CCCD này đã thuộc về ${holder.FullName} (${holder.Name})`);

  const values = [f.idNumber, f.key, f.saintName, f.fullName, firstName(f.fullName), f.dateOfBirth, f.gender, f.father, f.mother, f.address, f.phone, classId, enrollYear, status];
  let studentId = id;
  if (old) {
    const update = db.prepare(`UPDATE Students SET IdNumber = ?, IdKey = ?, SaintName = ?, FullName = ?, FirstName = ?, DateOfBirth = ?, Gender = ?, Father = ?, Mother = ?,
      Address = ?, Phone = ?, ClassId = ?, EnrollYear = ?, Status = ?, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?`).bind(...values, now(), actor.userId, id);
    // Ngưng hoạt động takes the student out of their sibling family; a graduate's new user takes their place in it.
    if (leaving || graduating) {
      await db.batch([update, ...(leaving ? await leaveFamily(db, `s${id}`) : await graduate(db, actor, id, f))]);
      return { id, graduated: graduating };
    }
    await update.run();
  } else {
    const r = await db.prepare(`INSERT INTO Students (IdNumber, IdKey, SaintName, FullName, FirstName, DateOfBirth, Gender, Father, Mother, Address, Phone, ClassId, EnrollYear, Status, UpdatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...values, actor.userId).run();
    studentId = r.meta.last_row_id;
  }
  // ponytail: the student row and the family rows are two writes; a failure between them leaves the student saved without the new siblings. One batch if that ever shows.
  if (input.siblings !== undefined) await setFamily(db, `s${studentId}`, input.siblings, { keepUsers: true });
  return { id: studentId, graduated: false };
}

// A new user with the student's name, ACTIVE with a placeholder email, in the class group of GRADUATE_CLASS; the user
// takes the student's place in the sibling family. The user id is not known inside the batch, so it is found by email.
async function graduate(db, actor, studentId, f) {
  const groupId = await db.prepare(`SELECT g.Id FROM Groups g JOIN GroupClasses gc ON gc.GroupId = g.Id JOIN Classes c ON c.Id = gc.ClassId
    WHERE g.Type = 'CLASS' AND c.Name = ? ORDER BY g.Id`).bind(GRADUATE_CLASS).first('Id');
  if (groupId === null) fail(400, `Không tìm thấy nhóm của lớp ${GRADUATE_CLASS}.`);
  const { familyId } = await familyOf(db, `s${studentId}`);
  const email = `graduate-${studentId}-${crypto.randomUUID().slice(0, 8)}@pending.invalid`;
  const userId = '(SELECT Id FROM Users WHERE Email = ?)';
  return [
    db.prepare('INSERT INTO Users (Email, SaintName, FullName, FirstName, UpdatedBy) VALUES (?, ?, ?, ?, ?)')
      .bind(email, f.saintName, f.fullName, firstName(f.fullName), actor.userId),
    db.prepare(`INSERT INTO Memberships (GroupId, UserId) VALUES (?, ${userId})`).bind(groupId, email),
    leave(db, `s${studentId}`),
    db.prepare(`INSERT INTO SiblingUsers (UserId, StudentId, FamilyId) VALUES (${userId}, ?, ?)`).bind(email, studentId, familyId),
  ];
}

// One request, any number of rows, all or nothing. Rows without CCCD or full name are skipped. Returns the number of rows written.
export async function importStudents(db, actor, { classId, students }, { year = thisYear() } = {}) {
  await requireClassExists(db, Number(classId));
  requireClass(actor, Number(classId));
  // A teacher's file must not pull a student out of another class (same rule as saveStudent).
  const elsewhere = isAdmin(actor) ? new Map() : new Map((await all(db,
    'SELECT s.IdKey, s.FullName, c.Name FROM Students s JOIN Classes c ON c.Id = s.ClassId WHERE s.ClassId <> ?', Number(classId)))
    .map((r) => [r.IdKey, r]));
  const statements = [];
  for (const input of students ?? []) {
    if (!idKey(input.idNumber) || !String(input.fullName ?? '').trim()) continue;
    const f = readFields(input);
    const holder = elsewhere.get(f.key);
    if (holder) fail(403, `Số CCCD ${f.idNumber} đã thuộc về ${holder.FullName} (${holder.Name}). Chỉ Xứ đoàn được chuyển Thiếu nhi sang lớp khác.`);
    // An existing student keeps enroll year, status, photo and siblings; a blank phone or address keeps the stored one.
    statements.push(db.prepare(`
      INSERT INTO Students (IdNumber, IdKey, SaintName, FullName, FirstName, DateOfBirth, Gender, Father, Mother, Address, Phone, ClassId, EnrollYear, UpdatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (IdKey) DO UPDATE SET SaintName = excluded.SaintName, FullName = excluded.FullName, FirstName = excluded.FirstName,
        DateOfBirth = excluded.DateOfBirth, Gender = excluded.Gender, Father = excluded.Father, Mother = excluded.Mother,
        Address = COALESCE(excluded.Address, Students.Address), Phone = COALESCE(excluded.Phone, Students.Phone), ClassId = excluded.ClassId, UpdatedAt = ?, UpdatedBy = excluded.UpdatedBy`)
      .bind(f.idNumber, f.key, f.saintName, f.fullName, firstName(f.fullName), f.dateOfBirth, f.gender, f.father, f.mother, f.address, f.phone, Number(classId), year, actor.userId, now()));
  }
  if (statements.length) await db.batch(statements);
  return statements.length;
}

// Attendance, scores, photo row and family row go with the student (ON DELETE CASCADE).
export async function deleteStudent(db, actor, id) {
  const classId = await db.prepare('SELECT ClassId FROM Students WHERE Id = ?').bind(id).first('ClassId');
  if (classId === null) fail(404, 'Không tìm thấy Thiếu nhi.');
  requireClass(actor, classId);
  // A graduate's user stays in the family (SiblingUsers.StudentId is set to NULL); tidyFamily(NULL) only drops empty user rows.
  const { familyId } = await familyOf(db, `s${id}`);
  await db.batch([db.prepare('DELETE FROM Students WHERE Id = ?').bind(id), ...tidyFamily(db, familyId)]);
}
