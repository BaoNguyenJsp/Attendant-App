// Students: list, save (UC-S2, S3), siblings (UC-S4), Excel import (UC-S5), photo mark (UC-S6).
import { all, now, textOrNull } from './sql.js';
import { fail } from '../errors.js';
import { requireClass, isAdmin } from '../access.js';
import { idKey, firstName, splitPhones, joinPhones, isDate, todayVN } from '../text.js';
import { STUDENT_STATUSES, GENDERS } from '../codes.js';

const thisYear = () => Number(todayVN().slice(0, 4));

export async function listStudents(db) {
  const rows = await all(db, `
    SELECT s.Id AS id, s.IdNumber AS idNumber, s.SaintName AS saintName, s.FullName AS fullName, s.FirstName AS firstName,
           s.DateOfBirth AS dateOfBirth, s.Gender AS gender, s.Father AS father, s.Mother AS mother, s.Phone AS phone,
           s.ClassId AS classId, s.EnrollYear AS enrollYear, s.Status AS status, s.PhotoVersion AS photoVersion, m.FamilyId AS familyId
    FROM Students s LEFT JOIN SiblingMembers m ON m.StudentId = s.Id ORDER BY s.Id`);
  const families = new Map();
  for (const r of rows) if (r.familyId !== null) families.set(r.familyId, [...(families.get(r.familyId) ?? []), r.id]);
  return rows.map(({ phone, familyId, ...s }) => ({
    ...s,
    phones: splitPhones(phone),
    hasPhoto: s.photoVersion > 0,
    siblingIds: familyId === null ? [] : families.get(familyId).filter((id) => id !== s.id),
  }));
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
    saintName: textOrNull(input.saintName), father: textOrNull(input.father), mother: textOrNull(input.mother),
    phone: joinPhones(input.phones),
  };
}

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
  const blankYear = input.enrollYear === undefined || input.enrollYear === null || input.enrollYear === '';
  const enrollYear = blankYear ? (old ? old.EnrollYear : year) : Number(input.enrollYear);
  if (enrollYear !== null && !(Number.isInteger(enrollYear) && enrollYear >= 1900 && enrollYear <= 2100)) fail(400, 'Năm nhập học không hợp lệ.');

  const holder = await db.prepare('SELECT s.Id, s.FullName, c.Name FROM Students s JOIN Classes c ON c.Id = s.ClassId WHERE s.IdKey = ?').bind(f.key).first();
  if (holder && holder.Id !== id) fail(409, `Số CCCD này đã thuộc về ${holder.FullName} (${holder.Name})`);

  const values = [f.idNumber, f.key, f.saintName, f.fullName, firstName(f.fullName), f.dateOfBirth, f.gender, f.father, f.mother, f.phone, classId, enrollYear, status];
  let studentId = id;
  if (old) {
    await db.prepare(`UPDATE Students SET IdNumber = ?, IdKey = ?, SaintName = ?, FullName = ?, FirstName = ?, DateOfBirth = ?, Gender = ?, Father = ?, Mother = ?,
      Phone = ?, ClassId = ?, EnrollYear = ?, Status = ?, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?`).bind(...values, now(), actor.userId, id).run();
  } else {
    const r = await db.prepare(`INSERT INTO Students (IdNumber, IdKey, SaintName, FullName, FirstName, DateOfBirth, Gender, Father, Mother, Phone, ClassId, EnrollYear, Status, UpdatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...values, actor.userId).run();
    studentId = r.meta.last_row_id;
  }
  // ponytail: the student row and the family rows are two writes; a failure between them leaves the student saved without the new siblings. One batch if that ever shows.
  const affectedIds = input.siblingIds === undefined ? [studentId] : await setSiblings(db, studentId, input.siblingIds);
  return { id: studentId, affectedIds };
}

const familyOf = async (db, studentId) => {
  const familyId = await db.prepare('SELECT FamilyId FROM SiblingMembers WHERE StudentId = ?').bind(studentId).first('FamilyId');
  const members = familyId === null ? [] : (await all(db, 'SELECT StudentId FROM SiblingMembers WHERE FamilyId = ?', familyId)).map((r) => r.StudentId);
  return { familyId, members };
};

// `siblingIds` is the wanted list of siblings of `me`. Returns the ids of every student whose family changed.
async function setSiblings(db, me, siblingIds) {
  const wanted = new Set((siblingIds ?? []).map(Number).filter((id) => id !== me));
  const mine = await familyOf(db, me);
  const involved = new Set([me, ...mine.members]);
  // Members of my family that are still wanted stay; the others leave on their own.
  const members = new Set([me, ...mine.members.filter((id) => wanted.has(id))]);
  let familyId = mine.familyId;

  for (const id of wanted) {
    if (mine.members.includes(id)) continue;
    if (!(await db.prepare('SELECT Id FROM Students WHERE Id = ?').bind(id).first())) fail(400, 'Anh chị em được chọn không tồn tại.');
    // A new sibling brings their whole family: the two families become one.
    const theirs = await familyOf(db, id);
    for (const member of [id, ...theirs.members]) { members.add(member); involved.add(member); }
    familyId ??= theirs.familyId;
  }
  familyId ??= await db.prepare('SELECT COALESCE(MAX(FamilyId), 0) + 1 AS n FROM SiblingMembers').first('n');

  const statements = [...involved].map((id) => db.prepare('DELETE FROM SiblingMembers WHERE StudentId = ?').bind(id));
  // A family of one is not a family.
  if (members.size > 1) for (const id of members) statements.push(db.prepare('INSERT INTO SiblingMembers (StudentId, FamilyId) VALUES (?, ?)').bind(id, familyId));
  await db.batch(statements);
  return [...involved];
}

// One request, any number of rows, all or nothing. Rows without CCCD or full name are skipped. Returns the number of rows written.
export async function importStudents(db, { classId, students }, actorId, { year = thisYear() } = {}) {
  await requireClassExists(db, Number(classId));
  const statements = [];
  for (const input of students ?? []) {
    if (!idKey(input.idNumber) || !String(input.fullName ?? '').trim()) continue;
    const f = readFields(input);
    // An existing student keeps enroll year, status, photo and siblings; a blank phone keeps the stored phone.
    statements.push(db.prepare(`
      INSERT INTO Students (IdNumber, IdKey, SaintName, FullName, FirstName, DateOfBirth, Gender, Father, Mother, Phone, ClassId, EnrollYear, UpdatedBy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (IdKey) DO UPDATE SET SaintName = excluded.SaintName, FullName = excluded.FullName, FirstName = excluded.FirstName,
        DateOfBirth = excluded.DateOfBirth, Gender = excluded.Gender, Father = excluded.Father, Mother = excluded.Mother,
        Phone = COALESCE(excluded.Phone, Students.Phone), ClassId = excluded.ClassId, UpdatedAt = ?, UpdatedBy = excluded.UpdatedBy`)
      .bind(f.idNumber, f.key, f.saintName, f.fullName, firstName(f.fullName), f.dateOfBirth, f.gender, f.father, f.mother, f.phone, Number(classId), year, actorId, now()));
  }
  if (statements.length) await db.batch(statements);
  return statements.length;
}
