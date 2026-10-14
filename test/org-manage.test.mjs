import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1 } from './helpers/seeded.mjs';
import { AppError } from '../src/lib/errors.js';
import { listClasses, listGroups, saveClass, deleteClass, reorderClasses, saveGroup, deleteGroup } from '../src/lib/db/org.js';

const status = (code) => (e) => e instanceof AppError && e.status === code;
const classId = async (db, name) => (await listClasses(db)).find((c) => c.name === name)?.id;
const group = async (db, name) => (await listGroups(db)).find((g) => g.name === name);
// AuthVersion of the members of a group: it goes up when their sessions must end.
const versions = async (db, groupName) => (await db.prepare('SELECT u.AuthVersion AS v FROM Users u JOIN Memberships m ON m.UserId = u.Id JOIN Groups g ON g.Id = m.GroupId WHERE g.Name = ? ORDER BY u.Id').bind(groupName).all()).results.map((r) => r.v);

test('classes: add goes last, rename, reorder, delete only when empty', async () => {
  const db = await seededD1();
  await saveClass(db, { name: '  Vào Đời ', grade: 'Hiệp sĩ' });
  const added = (await listClasses(db)).at(-1);
  assert.deepEqual([added.name, added.grade, added.sortOrder, added.size], ['Vào Đời', 'Hiệp sĩ', 13, 0]);
  await assert.rejects(saveClass(db, { name: 'Ấu 1' }), status(409));
  await assert.rejects(saveClass(db, { name: ' ' }), status(400));
  await assert.rejects(saveClass(db, { id: 999, name: 'Không Có' }), status(404));

  await saveClass(db, { id: added.id, name: 'Hiệp Sĩ 1', grade: '' });
  await saveClass(db, { id: added.id, name: 'Hiệp Sĩ 1', grade: '' }); // its own name is not a duplicate
  assert.deepEqual((await listClasses(db)).at(-1).grade, null);

  const ids = (await listClasses(db)).map((c) => c.id);
  await assert.rejects(reorderClasses(db, ids.slice(1)), status(400));
  await assert.rejects(reorderClasses(db, [...ids.slice(1), 999]), status(400));
  await reorderClasses(db, [added.id, ...ids.slice(0, -1)]);
  assert.deepEqual((await listClasses(db)).map((c) => c.id), [added.id, ...ids.slice(0, -1)]);

  await assert.rejects(deleteClass(db, await classId(db, 'Ấu 1')), (e) => status(409)(e) && /lớp còn 50 Thiếu nhi/.test(e.message));
  await assert.rejects(deleteClass(db, 999), status(404));
  await deleteClass(db, added.id);
  assert.equal(await classId(db, 'Hiệp Sĩ 1'), undefined);
});

test('groups: each type covers what it should, the type never changes', async () => {
  const db = await seededD1();
  const [au1, au2] = [await classId(db, 'Ấu 1'), await classId(db, 'Ấu 2')];
  await saveGroup(db, { name: 'Ngành Mới', type: 'SECTOR', description: 'thử', classIds: [au2, au1, au1] });
  const sector = await group(db, 'Ngành Mới');
  assert.deepEqual([sector.type, sector.classIds, sector.description], ['SECTOR', [au1, au2], 'thử']);

  await assert.rejects(saveGroup(db, { name: 'Lớp Đôi', type: 'CLASS', classIds: [au1, au2] }), status(400));
  await assert.rejects(saveGroup(db, { name: 'Lớp Ma', type: 'CLASS', classIds: [999] }), status(400));
  await assert.rejects(saveGroup(db, { name: 'BQT Mới', type: 'SECTOR_ADMIN', sectorGroupId: (await group(db, 'Lớp Ấu 1')).id }), status(400));
  await assert.rejects(saveGroup(db, { name: 'Lạ', type: 'OWNER' }), status(400));
  await assert.rejects(saveGroup(db, { name: 'Ngành Ấu', type: 'SECTOR' }), status(409));

  await saveGroup(db, { name: 'BQT Mới', type: 'SECTOR_ADMIN', sectorGroupId: sector.id, classIds: [au1] });
  assert.deepEqual([(await group(db, 'BQT Mới')).sectorGroupId, (await group(db, 'BQT Mới')).classIds], [sector.id, []]);

  await saveGroup(db, { id: sector.id, name: 'Ngành Mới 2', type: 'ADMIN', classIds: [au1] });
  const renamed = await group(db, 'Ngành Mới 2');
  assert.deepEqual([renamed.id, renamed.type, renamed.classIds], [sector.id, 'SECTOR', [au1]]);
});

test('a change of scope ends the sessions of the members and of their sector admins; a rename does not', async () => {
  const db = await seededD1();
  const sector = await group(db, 'Ngành Ấu');
  await saveGroup(db, { id: sector.id, name: 'Ngành Ấu Nhi', description: 'đổi tên', classIds: sector.classIds });
  assert.deepEqual([await versions(db, 'Ngành Ấu Nhi'), await versions(db, 'BQT Ngành Ấu')], [[1], [1]]);

  await saveGroup(db, { id: sector.id, name: 'Ngành Ấu Nhi', classIds: sector.classIds.slice(1) });
  assert.deepEqual([await versions(db, 'Ngành Ấu Nhi'), await versions(db, 'BQT Ngành Ấu')], [[2], [2]]);
  assert.deepEqual([await versions(db, 'Lớp Ấu 1'), await versions(db, 'BQT Ngành Thiếu')], [[1, 1, 1, 1], [1]]);

  // a class that leaves takes its group links with it
  await saveClass(db, { name: 'Tạm' });
  const temp = await classId(db, 'Tạm');
  await saveGroup(db, { id: sector.id, name: 'Ngành Ấu Nhi', classIds: [...sector.classIds, temp] });
  await deleteClass(db, temp);
  assert.deepEqual(await versions(db, 'Ngành Ấu Nhi'), [4]);
  assert.deepEqual((await group(db, 'Ngành Ấu Nhi')).classIds, sector.classIds);
});

test('a group is deleted only when nobody is in it and nothing points to it', async () => {
  const db = await seededD1();
  await assert.rejects(deleteGroup(db, (await group(db, 'Lớp Ấu 1')).id), (e) => status(409)(e) && /còn 4 Huynh trưởng/.test(e.message));
  await assert.rejects(deleteGroup(db, 999), status(404));
  await db.exec("DELETE FROM Memberships WHERE GroupId IN (SELECT Id FROM Groups WHERE Name IN ('Ngành Chiên', 'Xứ đoàn'))");
  await assert.rejects(deleteGroup(db, (await group(db, 'Ngành Chiên')).id), (e) => status(409)(e) && /BQT ngành/.test(e.message));
  await assert.rejects(deleteGroup(db, (await group(db, 'Xứ đoàn')).id), (e) => status(409)(e) && /cuối cùng/.test(e.message));

  await saveGroup(db, { name: 'Nhóm Thừa', type: 'CLASS', classIds: [await classId(db, 'Ấu 1')] });
  await deleteGroup(db, (await group(db, 'Nhóm Thừa')).id);
  assert.equal(await group(db, 'Nhóm Thừa'), undefined);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM GroupClasses').first('n'), 24);
});
