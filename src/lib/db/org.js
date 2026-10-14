// Classes, groups, configuration (with history), holidays.
import { all, insertMany } from './sql.js';
import { fail } from '../errors.js';
import { isDate, toSunday } from '../text.js';
import { TEACHER_SESSIONS, TIER_RANK } from '../codes.js';

export const listClasses = (db) => all(db, `
  SELECT c.Id AS id, c.Name AS name, c.Grade AS grade, c.SortOrder AS sortOrder,
         (SELECT COUNT(*) FROM Students s WHERE s.ClassId = c.Id AND s.Status = 'ACTIVE') AS size
  FROM Classes c ORDER BY c.SortOrder`);

export async function listGroups(db) {
  const groups = await all(db, 'SELECT Id AS id, Name AS name, Type AS type, SectorGroupId AS sectorGroupId, Description AS description FROM Groups ORDER BY Id');
  const links = await all(db, 'SELECT GroupId, ClassId FROM GroupClasses ORDER BY ClassId');
  return groups.map((g) => ({ ...g, classIds: links.filter((l) => l.GroupId === g.id).map((l) => l.ClassId) }));
}

/* ---------- Managing classes and groups (Xứ đoàn) ---------- */
const cleanName = (value, label) => {
  const name = String(value ?? '').normalize('NFC').trim();
  if (!name) fail(400, `Thiếu ${label}.`);
  return name;
};
const idList = (value) => [...new Set((Array.isArray(value) ? value : []).map(Number))];

// A session carries the class list of its user, so a change of scope must end the sessions of the members:
// of the group itself and of the sector admin groups that point to it. `groupIdsSql` selects the group ids.
const endSessions = (db, groupIdsSql, ...args) => db.prepare(`
  UPDATE Users SET AuthVersion = AuthVersion + 1 WHERE Id IN (
    SELECT m.UserId FROM Memberships m JOIN Groups g ON g.Id = m.GroupId
    WHERE g.Id IN (${groupIdsSql}) OR g.SectorGroupId IN (${groupIdsSql}))`).bind(...args, ...args);

// A new class goes last in the order (the order is the promotion order of the year rollover).
export async function saveClass(db, { id = null, name, grade }) {
  const className = cleanName(name, 'tên lớp');
  const holder = await db.prepare('SELECT Id FROM Classes WHERE Name = ?').bind(className).first('Id');
  if (holder !== null && holder !== id) fail(409, `Đã có lớp ${className}.`);
  const khoi = String(grade ?? '').trim() || null;
  if (id === null) {
    await db.prepare('INSERT INTO Classes (Name, Grade, SortOrder) VALUES (?, ?, (SELECT COALESCE(MAX(SortOrder), 0) + 1 FROM Classes))').bind(className, khoi).run();
  } else {
    const r = await db.prepare('UPDATE Classes SET Name = ?, Grade = ? WHERE Id = ?').bind(className, khoi, id).run();
    if (!r.meta.changes) fail(404, 'Không tìm thấy lớp.');
  }
}

// Only a class without any data can go; its links to groups go with it.
export async function deleteClass(db, id) {
  const used = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM Students WHERE ClassId = ?) AS students, (SELECT COUNT(*) FROM Attendance WHERE ClassId = ?) AS attendance,
    (SELECT COUNT(*) FROM Scores WHERE ClassId = ?) AS scores, (SELECT COUNT(*) FROM Lessons WHERE ClassId = ?) AS lessons,
    (SELECT COUNT(*) FROM Classes WHERE Id = ?) AS found`).bind(id, id, id, id, id).first();
  if (!used.found) fail(404, 'Không tìm thấy lớp.');
  const blocks = [[used.students, 'Thiếu nhi'], [used.attendance, 'dòng điểm danh'], [used.scores, 'dòng điểm'], [used.lessons, 'giáo án']]
    .filter(([n]) => n).map(([n, label]) => `${n} ${label}`);
  if (blocks.length) fail(409, `Không xóa được: lớp còn ${blocks.join(', ')}.`);
  await db.batch([
    endSessions(db, 'SELECT GroupId FROM GroupClasses WHERE ClassId = ?', id),
    db.prepare('DELETE FROM GroupClasses WHERE ClassId = ?').bind(id),
    db.prepare('DELETE FROM Classes WHERE Id = ?').bind(id),
  ]);
}

// `ids` is every class id in the new order.
export async function reorderClasses(db, ids) {
  const next = idList(ids);
  const current = (await all(db, 'SELECT Id FROM Classes')).map((c) => c.Id);
  if (next.length !== current.length || current.some((id) => !next.includes(id))) fail(400, 'Thứ tự lớp không hợp lệ.');
  await db.batch(next.map((id, i) => db.prepare('UPDATE Classes SET SortOrder = ? WHERE Id = ?').bind(i + 1, id)));
}

// What a group covers depends on its type: CLASS one class, SECTOR several, SECTOR_ADMIN one sector group, ADMIN everything.
// The type is chosen when the group is created and never changes: it would change the rights of every member.
export async function saveGroup(db, { id = null, name, type, description, classIds, sectorGroupId }) {
  const groupName = cleanName(name, 'tên nhóm');
  const old = id === null ? null : await db.prepare('SELECT Type, SectorGroupId FROM Groups WHERE Id = ?').bind(id).first();
  if (id !== null && !old) fail(404, 'Không tìm thấy nhóm.');
  const groupType = old ? old.Type : type;
  if (!Object.hasOwn(TIER_RANK, groupType ?? '')) fail(400, 'Loại nhóm không hợp lệ.');
  const holder = await db.prepare('SELECT Id FROM Groups WHERE Name = ?').bind(groupName).first('Id');
  if (holder !== null && holder !== id) fail(409, `Đã có nhóm ${groupName}.`);

  const classes = groupType === 'CLASS' || groupType === 'SECTOR' ? idList(classIds).sort((a, b) => a - b) : [];
  if (groupType === 'CLASS' && classes.length !== 1) fail(400, 'Nhóm Lớp phải phụ trách đúng một lớp.');
  const known = new Set((await all(db, 'SELECT Id FROM Classes')).map((c) => c.Id));
  if (classes.some((c) => !known.has(c))) fail(400, 'Lớp không tồn tại.');
  const sector = groupType === 'SECTOR_ADMIN' ? Number(sectorGroupId) : null;
  if (sector !== null && !(await db.prepare("SELECT Id FROM Groups WHERE Id = ? AND Type = 'SECTOR'").bind(sector).first())) fail(400, 'Nhóm BQT ngành phải chọn một nhóm Ngành.');

  const before = old ? (await all(db, 'SELECT ClassId FROM GroupClasses WHERE GroupId = ? ORDER BY ClassId', id)).map((r) => r.ClassId) : [];
  const scopeChanged = !!old && (before.join() !== classes.join() || old.SectorGroupId !== sector);
  const fields = [groupName, sector, String(description ?? '').trim() || null];
  const statements = [old
    ? db.prepare('UPDATE Groups SET Name = ?, SectorGroupId = ?, Description = ? WHERE Id = ?').bind(...fields, id)
    : db.prepare('INSERT INTO Groups (Name, SectorGroupId, Description, Type) VALUES (?, ?, ?, ?)').bind(...fields, groupType)];
  if (scopeChanged) statements.push(endSessions(db, '?', id));
  if (!old || before.join() !== classes.join()) {
    // A new group has no id yet inside the batch, so its links find it by name.
    statements.push(db.prepare('DELETE FROM GroupClasses WHERE GroupId = (SELECT Id FROM Groups WHERE Name = ?)').bind(groupName));
    for (const c of classes) statements.push(db.prepare('INSERT INTO GroupClasses (GroupId, ClassId) VALUES ((SELECT Id FROM Groups WHERE Name = ?), ?)').bind(groupName, c));
  }
  await db.batch(statements);
}

export async function deleteGroup(db, id) {
  const g = await db.prepare(`SELECT Type,
    (SELECT COUNT(*) FROM Memberships WHERE GroupId = ?) AS members, (SELECT COUNT(*) FROM Groups WHERE SectorGroupId = ?) AS admins,
    (SELECT COUNT(*) FROM Groups WHERE Type = 'ADMIN') AS adminGroups FROM Groups WHERE Id = ?`).bind(id, id, id).first();
  if (!g) fail(404, 'Không tìm thấy nhóm.');
  if (g.members) fail(409, `Không xóa được: nhóm còn ${g.members} Huynh trưởng. Hãy bỏ họ khỏi nhóm trước.`);
  if (g.admins) fail(409, 'Không xóa được: có nhóm BQT ngành đang phụ trách ngành này.');
  if (g.Type === 'ADMIN' && g.adminGroups === 1) fail(409, 'Không xóa được nhóm Xứ đoàn cuối cùng.');
  await db.prepare('DELETE FROM Groups WHERE Id = ?').bind(id).run(); // its class links go with it (ON DELETE CASCADE)
}

export const listConfig =(db) => all(db, 'SELECT Key AS key, Value AS value FROM Config ORDER BY Key');

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
