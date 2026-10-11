import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1 } from './helpers/seeded.mjs';
import { AppError } from '../src/lib/errors.js';
import { loadSession, isSessionValid, getDirectory, saveUser } from '../src/lib/db/users.js';

const status = (code) => (e) => e instanceof AppError && e.status === code;
const groupsOf = async (db, userId) => (await db.prepare('SELECT GroupId FROM Memberships WHERE UserId = ? ORDER BY GroupId').bind(userId).all()).results.map((r) => r.GroupId);

test('an admin session covers every class and every sector', async () => {
  const db = await seededD1();
  const s = await loadSession(db, 'DoRuoOra@gmail.com');
  assert.equal(s.userId, 1);
  assert.equal(s.tier, 'ADMIN');
  assert.equal(s.classIds.length, 12);
  assert.equal(s.sectorGroupIds.length, 5);
});

test('a class teacher has one class; a sector admin has the classes of the sector', async () => {
  const db = await seededD1();
  const teacher = await loadSession(db, 'teacher08@example.com');
  assert.deepEqual([teacher.tier, teacher.classIds, teacher.sectorGroupIds], ['CLASS', [1], []]);
  const sectorAdmin = await loadSession(db, 'teacher02@example.com');
  assert.equal(sectorAdmin.tier, 'SECTOR_ADMIN');
  assert.deepEqual(sectorAdmin.classIds, [2, 3, 4]);
  assert.equal(sectorAdmin.sectorGroupIds.length, 1);
  const sector = await loadSession(db, 'teacher06@example.com');
  assert.deepEqual([sector.tier, sector.classIds, sector.sectorGroupIds], ['SECTOR', [2, 3, 4], []]);
});

test('unknown and locked users are refused', async () => {
  const db = await seededD1();
  await assert.rejects(loadSession(db, 'nobody@example.com'), (e) => status(401)(e) && /chưa được cấp quyền/.test(e.message));
  await db.prepare("UPDATE Users SET Status = 'INACTIVE' WHERE Id = 13").run();
  await assert.rejects(loadSession(db, 'teacher08@example.com'), (e) => status(401)(e) && /đã bị khóa/.test(e.message));
});

test('editing name or phone keeps the session; groups, email or locking end it', async () => {
  const db = await seededD1();
  const user = { id: 13, email: 'teacher08@example.com', fullName: 'Trần Văn Mới', saintName: 'Giuse', phone: '0900000000', status: 'ACTIVE' };
  const groups = await groupsOf(db, 13);
  let session = await loadSession(db, user.email);

  const saved = await saveUser(db, { user, groupIds: groups }, 1);
  assert.deepEqual([saved.fullName, saved.firstName, saved.phone], ['Trần Văn Mới', 'Mới', '0900000000']);
  assert.equal(await isSessionValid(db, session), true);

  await saveUser(db, { user, groupIds: [...groups, 4] }, 1);
  assert.equal(await isSessionValid(db, session), false);
  assert.deepEqual(await groupsOf(db, 13), [...groups, 4].sort((a, b) => a - b));

  session = await loadSession(db, user.email);
  await saveUser(db, { user: { ...user, email: 'new@example.com' }, groupIds: [...groups, 4] }, 1);
  assert.equal(await isSessionValid(db, session), false);

  session = await loadSession(db, 'new@example.com');
  await saveUser(db, { user: { ...user, email: 'new@example.com', status: 'INACTIVE' }, groupIds: [...groups, 4] }, 1);
  assert.equal(await isSessionValid(db, session), false);
});

test('a deleted user has no valid session', async () => {
  const db = await seededD1();
  assert.equal(await isSessionValid(db, { userId: 9999, authVersion: 1 }), false);
});

test('saveUser creates a user with groups in one step and refuses a taken email', async () => {
  const db = await seededD1();
  const created = await saveUser(db, { user: { email: ' New.Teacher@Example.com ', fullName: 'Lê Thị Hoa' }, groupIds: [2] }, 1);
  assert.equal(created.email, 'new.teacher@example.com');
  assert.equal(created.status, 'ACTIVE');
  assert.deepEqual(await groupsOf(db, created.id), [2]);
  await assert.rejects(saveUser(db, { user: { email: 'TEACHER08@example.com', fullName: 'X' }, groupIds: [] }, 1), status(409));
  await assert.rejects(saveUser(db, { user: { id: created.id, email: 'teacher08@example.com', fullName: 'X' }, groupIds: [] }, 1), status(409));
  await assert.rejects(saveUser(db, { user: { email: 'not-an-email', fullName: 'X' }, groupIds: [] }, 1), status(400));
  await assert.rejects(saveUser(db, { user: { email: 'a@example.com', fullName: ' ' }, groupIds: [] }, 1), status(400));
  await assert.rejects(saveUser(db, { user: { email: 'a@example.com', fullName: 'X' }, groupIds: [999] }, 1), status(400));
  await assert.rejects(saveUser(db, { user: { id: 9999, email: 'a@example.com', fullName: 'X' }, groupIds: [] }, 1), status(404));
});

test('getDirectory lists users, groups and memberships', async () => {
  const db = await seededD1();
  const d = await getDirectory(db);
  assert.deepEqual([d.users.length, d.groups.length, d.memberships.length], [60, 23, 60]);
  assert.deepEqual(Object.keys(d.users[0]).sort(), ['email', 'firstName', 'fullName', 'id', 'phone', 'saintName', 'status']);
});
