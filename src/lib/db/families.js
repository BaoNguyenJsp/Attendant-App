// Sibling families (UC-S4). A member is a student ('s12') or a user ('u7'): students sit in SiblingMembers, users in
// SiblingUsers. A graduate's user takes the place of the student (SiblingUsers.StudentId), so the two count as one person.
// A family of one is not a family.
import { all } from './sql.js';
import { fail } from '../errors.js';

function parse(key) {
  const m = /^([su])(\d+)$/.exec(String(key));
  if (!m) fail(400, 'Anh chị em không hợp lệ.');
  return { kind: m[1], id: Number(m[2]) };
}

export async function listFamilies(db) {
  const students = await all(db, `
    SELECT 's' || m.StudentId AS key, m.FamilyId AS familyId, s.FullName AS name, s.ClassId AS classId, s.Status = 'ACTIVE' AS active
    FROM SiblingMembers m JOIN Students s ON s.Id = m.StudentId`);
  const users = await all(db, `
    SELECT 'u' || su.UserId AS key, su.FamilyId AS familyId, TRIM(COALESCE(u.SaintName, '') || ' ' || u.FullName) AS name, NULL AS classId,
           u.Status = 'ACTIVE' AS active, su.StudentId AS studentId
    FROM SiblingUsers su JOIN Users u ON u.Id = su.UserId`);
  return {
    members: [...students, ...users].filter((m) => m.familyId !== null)
      .map(({ studentId, ...m }) => ({ ...m, active: !!m.active, teacher: m.key[0] === 'u' })),
    // Student key -> user key of every graduate.
    graduates: Object.fromEntries(users.filter((u) => u.studentId !== null).map((u) => [`s${u.studentId}`, u.key])),
  };
}

export async function familyOf(db, key) {
  const { kind, id } = parse(key);
  const familyId = kind === 's'
    ? await db.prepare('SELECT FamilyId FROM SiblingMembers WHERE StudentId = ?').bind(id).first('FamilyId')
    : await db.prepare('SELECT FamilyId FROM SiblingUsers WHERE UserId = ?').bind(id).first('FamilyId');
  if (familyId === null) return { familyId, members: [] };
  const members = [
    ...(await all(db, 'SELECT StudentId FROM SiblingMembers WHERE FamilyId = ?', familyId)).map((r) => `s${r.StudentId}`),
    ...(await all(db, 'SELECT UserId FROM SiblingUsers WHERE FamilyId = ?', familyId)).map((r) => `u${r.UserId}`),
  ];
  return { familyId, members };
}

export const leave = (db, key) => {
  const { kind, id } = parse(key);
  return kind === 's'
    ? db.prepare('DELETE FROM SiblingMembers WHERE StudentId = ?').bind(id)
    : db.prepare('UPDATE SiblingUsers SET FamilyId = NULL WHERE UserId = ?').bind(id);
};

const join = (db, key, familyId) => {
  const { kind, id } = parse(key);
  return kind === 's'
    ? db.prepare('INSERT INTO SiblingMembers (StudentId, FamilyId) VALUES (?, ?)').bind(id, familyId)
    : db.prepare('INSERT INTO SiblingUsers (UserId, FamilyId) VALUES (?, ?) ON CONFLICT (UserId) DO UPDATE SET FamilyId = excluded.FamilyId').bind(id, familyId);
};

// After someone left: a family of fewer than two members ends; a user row that holds neither family nor graduate goes.
export function tidyFamily(db, familyId) {
  const size = '(SELECT COUNT(*) FROM SiblingMembers WHERE FamilyId = ?) + (SELECT COUNT(*) FROM SiblingUsers WHERE FamilyId = ?)';
  return [
    db.prepare(`DELETE FROM SiblingMembers WHERE FamilyId = ? AND ${size} < 2`).bind(familyId, familyId, familyId),
    db.prepare(`UPDATE SiblingUsers SET FamilyId = NULL WHERE FamilyId = ? AND ${size} < 2`).bind(familyId, familyId, familyId),
    db.prepare('DELETE FROM SiblingUsers WHERE FamilyId IS NULL AND StudentId IS NULL'),
  ];
}

// The statements that take one member out of their family.
export async function leaveFamily(db, key) {
  const { familyId } = await familyOf(db, key);
  return familyId === null ? [] : [leave(db, key), ...tidyFamily(db, familyId)];
}

// A graduate is named by their user.
async function canonical(db, key) {
  const { kind, id } = parse(key);
  if (kind === 's') {
    const userId = await db.prepare('SELECT UserId FROM SiblingUsers WHERE StudentId = ?').bind(id).first('UserId');
    if (userId !== null) return `u${userId}`;
  }
  return `${kind}${id}`;
}

async function exists(db, key) {
  const { kind, id } = parse(key);
  return !!(await db.prepare(`SELECT Id FROM ${kind === 's' ? 'Students' : 'Users'} WHERE Id = ?`).bind(id).first());
}

// `siblings` is the wanted list of siblings of `me` (keys). Members of my family that are not wanted leave on their own;
// a new sibling brings their whole family and the two families become one. With keepUsers (the student form) the users
// of my family stay whatever is sent: they are removed from the Huynh trưởng pages only.
export async function setFamily(db, me, siblings, { keepUsers = false } = {}) {
  me = await canonical(db, me);
  const wanted = new Set();
  for (const key of siblings ?? []) {
    const k = await canonical(db, key);
    if (k !== me) wanted.add(k);
  }
  const mine = await familyOf(db, me);
  if (keepUsers) for (const k of mine.members) if (k[0] === 'u' && k !== me) wanted.add(k);
  const involved = new Set([me, ...mine.members]);
  const members = new Set([me, ...mine.members.filter((k) => wanted.has(k))]);
  let familyId = mine.familyId;

  for (const key of wanted) {
    if (mine.members.includes(key)) continue;
    if (!(await exists(db, key))) fail(400, 'Anh chị em được chọn không tồn tại.');
    const theirs = await familyOf(db, key);
    for (const member of [key, ...theirs.members]) { members.add(member); involved.add(member); }
    familyId ??= theirs.familyId;
  }
  familyId ??= await db.prepare(`SELECT COALESCE(MAX(FamilyId), 0) + 1 AS n
    FROM (SELECT FamilyId FROM SiblingMembers UNION ALL SELECT FamilyId FROM SiblingUsers)`).first('n');

  await db.batch([
    ...[...involved].map((k) => leave(db, k)),
    ...[...members].map((k) => join(db, k, familyId)),
    ...tidyFamily(db, familyId),
  ]);
}
