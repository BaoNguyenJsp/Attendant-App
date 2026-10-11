import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1 } from './helpers/seeded.mjs';
import { createD1 } from './helpers/d1.mjs';
import { AppError } from '../src/lib/errors.js';
import { requireClass, requireTier, canManageSector } from '../src/lib/access.js';
import { insertMany } from '../src/lib/db/sql.js';
import { todayVN } from '../src/lib/text.js';
import { listClasses, listGroups, listConfig, saveConfig, listHolidays, saveHolidays, yearOptions } from '../src/lib/db/org.js';

const status = (code) => (e) => e instanceof AppError && e.status === code;

test('todayVN is the date in Vietnam, seven hours ahead of UTC', () => {
  assert.equal(todayVN(Date.UTC(2026, 9, 10, 16, 59)), '2026-10-10');
  assert.equal(todayVN(Date.UTC(2026, 9, 10, 17, 0)), '2026-10-11');
});

test('access checks follow tier and scope', () => {
  const teacher = { tier: 'CLASS', classIds: [1], sectorGroupIds: [] };
  const admin = { tier: 'ADMIN', classIds: [], sectorGroupIds: [] };
  requireClass(teacher, 1);
  assert.throws(() => requireClass(teacher, 2), status(403));
  requireClass(admin, 2);
  assert.throws(() => requireTier(teacher, 'SECTOR_ADMIN'), status(403));
  assert.throws(() => requireTier({ tier: null, classIds: [], sectorGroupIds: [] }, 'CLASS'), status(403));
  assert.equal(canManageSector({ tier: 'SECTOR_ADMIN', classIds: [], sectorGroupIds: [3] }, 3), true);
  assert.equal(canManageSector({ tier: 'SECTOR_ADMIN', classIds: [], sectorGroupIds: [3] }, 7), false);
});

test('insertMany keeps every statement under 100 parameters', async () => {
  const db = createD1();
  const rows = Array.from({ length: 120 }, (_, i) => ({ Id: i + 1, Name: `C${i + 1}`, SortOrder: i + 1 }));
  const statements = insertMany(db, 'Classes', ['Id', 'Name', 'SortOrder'], rows);
  assert.equal(statements.length, 4); // 33 rows of 3 columns per statement
  await db.batch(statements);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM Classes').first('n'), 120);
});

test('listClasses is in promotion order with the number of active students', async () => {
  const db = await seededD1();
  await db.prepare("UPDATE Students SET Status = 'INACTIVE' WHERE Id = 1").run();
  const classes = await listClasses(db);
  assert.equal(classes.length, 12);
  assert.deepEqual(classes[0], { id: 1, name: 'Chiên Con', grade: 'Chiên', sortOrder: 1, size: 49 });
});

test('listGroups gives the classes of a group and the sector of a sector admin group', async () => {
  const db = await seededD1();
  const groups = await listGroups(db);
  assert.equal(groups.length, 23);
  const sector = groups.find((g) => g.name === 'Ngành Ấu');
  assert.deepEqual(sector.classIds, [2, 3, 4]);
  assert.equal(groups.find((g) => g.name === 'BQT Ngành Ấu').sectorGroupId, sector.id);
});

test('saveConfig adds, changes and deletes, and records each in the history', async () => {
  const db = await seededD1();
  const before = await db.prepare('SELECT COUNT(*) AS n FROM ConfigHistory').first('n');
  const saved = await saveConfig(db, [
    { key: 'CurrentSchoolYear', value: '2026-2027' },
    { key: 'AttendanceStartDate', value: '2026-09-13' },
    { key: ' NewKey ', value: ' x ' },
  ], 1);
  assert.deepEqual(saved, [
    { key: 'AttendanceStartDate', value: '2026-09-13' },
    { key: 'CurrentSchoolYear', value: '2026-2027' },
    { key: 'NewKey', value: 'x' },
  ]);
  const history = await db.prepare('SELECT Key, Value, Action, ChangedBy FROM ConfigHistory WHERE Id > ? ORDER BY Key').bind(before).all();
  assert.deepEqual(history.results, [
    { Key: 'AttendanceStartDate', Value: '2026-09-13', Action: 'UPDATED', ChangedBy: 1 },
    { Key: 'DriveFolderId', Value: '', Action: 'DELETED', ChangedBy: 1 },
    { Key: 'NewKey', Value: 'x', Action: 'ADDED', ChangedBy: 1 },
  ]);
});

test('saveConfig protects CurrentSchoolYear and refuses bad input', async () => {
  const db = await seededD1();
  await assert.rejects(saveConfig(db, [{ key: 'AttendanceStartDate', value: '2026-09-06' }], 1), status(400));
  await assert.rejects(saveConfig(db, [{ key: 'CurrentSchoolYear', value: '' }], 1), status(400));
  await assert.rejects(saveConfig(db, [{ key: 'CurrentSchoolYear', value: '2026' }], 1), status(400));
  await assert.rejects(saveConfig(db, [{ key: 'CurrentSchoolYear', value: '2026-2027' }, { key: 'AttendanceStartDate', value: 'abc' }], 1), status(400));
  await assert.rejects(saveConfig(db, [{ key: 'CurrentSchoolYear', value: '2026-2027' }, { key: 'A', value: '1' }, { key: 'A', value: '2' }], 1), status(400));
  assert.equal((await listConfig(db)).length, 3);
});

test('saveHolidays replaces the list and enforces the rules of UC-M4', async () => {
  const db = await seededD1();
  const saved = await saveHolidays(db, [
    { weekOf: '2026-10-04', session: 'CATECHISM', reason: ' Trung thu ' },
    { weekOf: '2026-09-13', session: 'TEACHER_MEETING' },
  ]);
  assert.deepEqual(saved, [
    { weekOf: '2026-09-13', session: 'TEACHER_MEETING', reason: null },
    { weekOf: '2026-10-04', session: 'CATECHISM', reason: 'Trung thu' },
  ]);
  const one = { weekOf: '2026-10-04', session: 'CATECHISM' };
  await assert.rejects(saveHolidays(db, [{ ...one, weekOf: '2026-10-05' }]), status(400)); // not a Sunday
  await assert.rejects(saveHolidays(db, [{ ...one, weekOf: '2026-08-30' }]), status(400)); // before the start date
  await assert.rejects(saveHolidays(db, [{ ...one, session: '' }]), status(400)); // no whole-week holiday
  await assert.rejects(saveHolidays(db, [one, one]), status(400)); // duplicate
  assert.equal((await listHolidays(db)).length, 2);
});

test('yearOptions runs from the first archived year to the current one', async () => {
  const db = await seededD1();
  assert.deepEqual(await yearOptions(db), ['2025-2026', '2026-2027']);
  await db.exec('DELETE FROM AcademicYear');
  assert.deepEqual(await yearOptions(db), ['2026-2027']);
});
