// Users: login session, per-request check (R1), directory, save.
import { all, now, textOrNull } from './sql.js';
import { listGroups } from './org.js';
import { fail } from '../errors.js';
import { TIER_RANK, USER_STATUSES } from '../codes.js';
import { firstName } from '../text.js';

const USER_COLUMNS = 'Id AS id, Email AS email, SaintName AS saintName, FullName AS fullName, FirstName AS firstName, Status AS status, Phone AS phone';

// Tier and scope from the user's groups (plan section 4).
async function scopeOf(db, userId) {
  const groups = await all(db, 'SELECT g.Id, g.Type, g.SectorGroupId FROM Memberships m JOIN Groups g ON g.Id = m.GroupId WHERE m.UserId = ?', userId);
  let tier = null;
  for (const g of groups) if (TIER_RANK[g.Type] > (TIER_RANK[tier] ?? 0)) tier = g.Type;
  if (tier === 'ADMIN') {
    return {
      tier,
      classIds: (await all(db, 'SELECT Id FROM Classes ORDER BY SortOrder')).map((r) => r.Id),
      sectorGroupIds: (await all(db, "SELECT Id FROM Groups WHERE Type = 'SECTOR' ORDER BY Id")).map((r) => r.Id),
    };
  }
  // A sector admin group covers the classes of the sector it points to.
  const sources = groups.map((g) => (g.Type === 'SECTOR_ADMIN' ? g.SectorGroupId : g.Id)).filter(Boolean);
  const classIds = sources.length
    ? (await all(db, `SELECT DISTINCT gc.ClassId FROM GroupClasses gc JOIN Classes c ON c.Id = gc.ClassId WHERE gc.GroupId IN (${sources.map(() => '?').join(', ')}) ORDER BY c.SortOrder`, ...sources)).map((r) => r.ClassId)
    : [];
  return { tier, classIds, sectorGroupIds: groups.filter((g) => g.Type === 'SECTOR_ADMIN' && g.SectorGroupId).map((g) => g.SectorGroupId) };
}

export async function loadSession(db, email) {
  const address = String(email ?? '').trim();
  const u = await db.prepare('SELECT Id, Email, SaintName, FullName, Status, AuthVersion FROM Users WHERE Email = ?').bind(address).first();
  if (!u) fail(401, `Email ${address} chưa được cấp quyền. Liên hệ admin.`);
  if (u.Status !== 'ACTIVE') fail(401, 'Tài khoản đã bị khóa.');
  return { userId: u.Id, email: u.Email, fullName: u.FullName, saintName: u.SaintName, authVersion: u.AuthVersion, ...(await scopeOf(db, u.Id)) };
}

// R1: one lookup per request. False when the user was locked or their groups or email changed since login.
export async function isSessionValid(db, session) {
  const u = await db.prepare('SELECT Status, AuthVersion FROM Users WHERE Id = ?').bind(session.userId ?? null).first();
  return !!u && u.Status === 'ACTIVE' && u.AuthVersion === session.authVersion;
}

export async function getDirectory(db) {
  const users = await all(db, `SELECT ${USER_COLUMNS} FROM Users`);
  users.sort((a, b) => a.firstName.localeCompare(b.firstName, 'vi'));
  return { users, groups: await listGroups(db), memberships: await all(db, 'SELECT GroupId AS groupId, UserId AS userId FROM Memberships') };
}

// The user and their memberships are saved in one batch (UC-M1).
export async function saveUser(db, { user, groupIds }, actorId) {
  const id = user?.id ?? null;
  const email = String(user?.email ?? '').trim().toLowerCase();
  const fullName = String(user?.fullName ?? '').trim();
  const status = user?.status ?? 'ACTIVE';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email không hợp lệ.');
  if (!fullName) fail(400, 'Thiếu họ tên.');
  if (!USER_STATUSES.includes(status)) fail(400, 'Trạng thái không hợp lệ.');

  const wanted = [...new Set((groupIds ?? []).map(Number))].sort((a, b) => a - b);
  const known = new Set((await all(db, 'SELECT Id FROM Groups')).map((g) => g.Id));
  if (wanted.some((g) => !known.has(g))) fail(400, 'Nhóm không tồn tại.');

  const holder = await db.prepare('SELECT Id FROM Users WHERE Email = ?').bind(email).first('Id');
  if (holder !== null && holder !== id) fail(409, `Email ${email} đã thuộc về một Huynh trưởng khác.`);
  const old = id === null ? null : await db.prepare('SELECT Email, Status FROM Users WHERE Id = ?').bind(id).first();
  if (id !== null && !old) fail(404, 'Không tìm thấy Huynh trưởng.');

  const current = id === null ? [] : (await all(db, 'SELECT GroupId FROM Memberships WHERE UserId = ? ORDER BY GroupId', id)).map((m) => m.GroupId);
  const groupsChanged = current.join() !== wanted.join();
  // Only these three changes force a new sign-in (plan A1).
  const relogin = !!old && (groupsChanged || old.Email.toLowerCase() !== email || (status === 'INACTIVE' && old.Status !== 'INACTIVE'));

  const fields = [email, textOrNull(user.saintName), fullName, firstName(fullName), status, textOrNull(user.phone)];
  const statements = [id === null
    ? db.prepare('INSERT INTO Users (Email, SaintName, FullName, FirstName, Status, Phone, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(...fields, actorId)
    : db.prepare('UPDATE Users SET Email = ?, SaintName = ?, FullName = ?, FirstName = ?, Status = ?, Phone = ?, AuthVersion = AuthVersion + ?, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?')
      .bind(...fields, relogin ? 1 : 0, now(), actorId, id)];
  if (groupsChanged) {
    // A new user has no id yet inside the batch, so memberships find it by email.
    statements.push(db.prepare('DELETE FROM Memberships WHERE UserId = (SELECT Id FROM Users WHERE Email = ?)').bind(email));
    for (const g of wanted) statements.push(db.prepare('INSERT INTO Memberships (GroupId, UserId) VALUES (?, (SELECT Id FROM Users WHERE Email = ?))').bind(g, email));
  }
  await db.batch(statements);
  return db.prepare(`SELECT ${USER_COLUMNS} FROM Users WHERE Email = ?`).bind(email).first();
}

// The class groups of a sector, in the order of the tab Lớp: the only groups its BQT ngành may change.
const sectorClassGroups = (db, sectorGroupId) => all(db, `SELECT g.Id AS id, g.Name AS name FROM Groups g
  JOIN GroupClasses gc ON gc.GroupId = g.Id JOIN Classes c ON c.Id = gc.ClassId
  WHERE g.Type = 'CLASS' AND gc.ClassId IN (SELECT ClassId FROM GroupClasses WHERE GroupId = ?)
  GROUP BY g.Id ORDER BY MIN(c.SortOrder), g.Id`, sectorGroupId);

// The members of a sector's class groups, locked ones too; members of Xứ đoàn are left to the admin page.
export async function getSectorUsers(db, sectorGroupId) {
  const groups = await sectorClassGroups(db, sectorGroupId);
  if (!groups.length) return { users: [], groups };
  const ids = groups.map((g) => g.id);
  const marks = ids.map(() => '?').join(', ');
  const users = await all(db, `SELECT ${USER_COLUMNS} FROM Users WHERE Id IN (SELECT UserId FROM Memberships WHERE GroupId IN (${marks}))
    AND Id NOT IN (SELECT m.UserId FROM Memberships m JOIN Groups g ON g.Id = m.GroupId WHERE g.Type = 'ADMIN')`, ...ids);
  const memberships = await all(db, `SELECT GroupId, UserId FROM Memberships WHERE GroupId IN (${marks})`, ...ids);
  // By their first class (as on the statistics pages), then by first name; their groups in class order too.
  const rank = new Map(ids.map((id, i) => [id, i]));
  const listed = users.map((u) => ({ ...u, groupIds: memberships.filter((m) => m.UserId === u.id).map((m) => m.GroupId).sort((a, b) => rank.get(a) - rank.get(b)) }));
  listed.sort((a, b) => rank.get(a.groupIds[0]) - rank.get(b.groupIds[0]) || a.firstName.localeCompare(b.firstName, 'vi'));
  return { users: listed, groups };
}

// BQT ngành edits a member of the sector: never the email, and only the sector's class groups; other groups are kept.
export async function saveSectorUser(db, sectorGroupId, { user, groupIds }, actorId) {
  const { users, groups } = await getSectorUsers(db, sectorGroupId);
  const target = users.find((u) => u.id === user?.id);
  if (!target) fail(404, 'Không tìm thấy Huynh trưởng trong ngành này.');
  const inSector = new Set(groups.map((g) => g.id));
  const picked = [...new Set((groupIds ?? []).map(Number))];
  if (picked.some((g) => !inSector.has(g))) fail(400, 'Nhóm không thuộc ngành này.');
  if (!picked.length) fail(400, 'Chọn ít nhất một lớp trong ngành.');
  const others = (await all(db, 'SELECT GroupId FROM Memberships WHERE UserId = ?', target.id)).map((m) => m.GroupId).filter((g) => !inSector.has(g));
  return saveUser(db, { user: { ...user, id: target.id, email: target.email }, groupIds: [...others, ...picked] }, actorId);
}

// Memberships and teacher attendance go with the user (ON DELETE CASCADE); lessons keep their teacher, so such a user is locked instead.
export async function deleteUser(db, id, actorId) {
  if (id === actorId) fail(400, 'Không thể tự xóa tài khoản của mình.');
  const u = await db.prepare('SELECT (SELECT COUNT(*) FROM Users WHERE Id = ?) AS found, (SELECT COUNT(*) FROM Lessons WHERE TeacherId = ?) AS lessons').bind(id, id).first();
  if (!u.found) fail(404, 'Không tìm thấy Huynh trưởng.');
  if (u.lessons) fail(409, `Không xóa được: Huynh trưởng còn ${u.lessons} giáo án. Hãy chuyển sang "Ngưng hoạt động".`);
  await db.prepare('DELETE FROM Users WHERE Id = ?').bind(id).run();
}
