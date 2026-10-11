// Classes, groups, configuration (with history), holidays.
import { all, insertMany } from './sql.js';
import { fail } from '../errors.js';
import { isDate, toSunday } from '../text.js';
import { TEACHER_SESSIONS } from '../codes.js';

export const listClasses = (db) => all(db, `
  SELECT c.Id AS id, c.Name AS name, c.Grade AS grade, c.SortOrder AS sortOrder,
         (SELECT COUNT(*) FROM Students s WHERE s.ClassId = c.Id AND s.Status = 'ACTIVE') AS size
  FROM Classes c ORDER BY c.SortOrder`);

export async function listGroups(db) {
  const groups = await all(db, 'SELECT Id AS id, Name AS name, Type AS type, SectorGroupId AS sectorGroupId, Description AS description FROM Groups ORDER BY Id');
  const links = await all(db, 'SELECT GroupId, ClassId FROM GroupClasses ORDER BY ClassId');
  return groups.map((g) => ({ ...g, classIds: links.filter((l) => l.GroupId === g.id).map((l) => l.ClassId) }));
}

export const listConfig = (db) => all(db, 'SELECT Key AS key, Value AS value FROM Config ORDER BY Key');

export async function configMap(db) {
  return Object.fromEntries((await listConfig(db)).map((c) => [c.key, c.value]));
}

// `items` is the full list: keys missing from it are deleted. Every change is appended to ConfigHistory.
export async function saveConfig(db, items, userId) {
  const next = new Map();
  for (const item of items ?? []) {
    const key = String(item.key ?? '').trim();
    if (!key) fail(400, 'Khóa cấu hình không được để trống.');
    if (next.has(key)) fail(400, `Khóa cấu hình bị trùng: ${key}`);
    next.set(key, String(item.value ?? '').trim());
  }
  if (!/^\d{4}-\d{4}$/.test(next.get('CurrentSchoolYear') ?? '')) fail(400, 'CurrentSchoolYear không được xóa và phải có dạng 2026-2027.');
  const start = next.get('AttendanceStartDate');
  if (start && !isDate(start)) fail(400, 'AttendanceStartDate phải là một ngày hợp lệ.');

  const old = await configMap(db);
  const statements = [];
  const history = [];
  for (const [key, value] of next) {
    if (old[key] === value) continue;
    history.push({ Key: key, Value: value, Action: key in old ? 'UPDATED' : 'ADDED', ChangedBy: userId });
    statements.push(db.prepare('INSERT INTO Config (Key, Value) VALUES (?, ?) ON CONFLICT (Key) DO UPDATE SET Value = excluded.Value').bind(key, value));
  }
  for (const key of Object.keys(old)) {
    if (next.has(key)) continue;
    history.push({ Key: key, Value: old[key], Action: 'DELETED', ChangedBy: userId });
    statements.push(db.prepare('DELETE FROM Config WHERE Key = ?').bind(key));
  }
  statements.push(...insertMany(db, 'ConfigHistory', ['Key', 'Value', 'Action', 'ChangedBy'], history));
  if (statements.length) await db.batch(statements);
  return listConfig(db);
}

export const listHolidays = (db) => all(db, 'SELECT WeekOf AS weekOf, Session AS session, Reason AS reason FROM Holidays ORDER BY WeekOf, Session');

// `holidays` is the full list. One holiday is one session of one week (UC-M4).
export async function saveHolidays(db, holidays) {
  const start = (await configMap(db)).AttendanceStartDate;
  const seen = new Set();
  const rows = [];
  for (const h of holidays ?? []) {
    if (!isDate(h.weekOf) || toSunday(h.weekOf) !== h.weekOf) fail(400, 'Tuần nghỉ phải là một ngày Chúa Nhật.');
    if (start && h.weekOf < start) fail(400, 'Tuần nghỉ không được trước ngày bắt đầu điểm danh.');
    if (!Object.hasOwn(TEACHER_SESSIONS, h.session)) fail(400, 'Buổi nghỉ không hợp lệ.');
    const key = `${h.weekOf}|${h.session}`;
    if (seen.has(key)) fail(400, 'Ngày nghỉ bị trùng (cùng tuần và cùng buổi).');
    seen.add(key);
    rows.push({ WeekOf: h.weekOf, Session: h.session, Reason: String(h.reason ?? '').trim() || null });
  }
  await db.batch([db.prepare('DELETE FROM Holidays'), ...insertMany(db, 'Holidays', ['WeekOf', 'Session', 'Reason'], rows)]);
  return listHolidays(db);
}

// School years that have data: from the first archived year to the current one.
export async function yearOptions(db) {
  const end = Number((await configMap(db)).CurrentSchoolYear.slice(0, 4));
  const first = await db.prepare('SELECT MIN(SchoolYear) AS y FROM AcademicYear').first('y');
  const start = first ? Math.min(Number(first.slice(0, 4)), end) : end;
  return Array.from({ length: end - start + 1 }, (_, i) => `${start + i}-${start + i + 1}`);
}
