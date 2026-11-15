// Warehouse (Kho): locations, items, requests (phiếu mượn / xuất) with their approval and return.
// The stock changes only at approval and return, and when a keeper adds stock or writes some off; no history is kept.
// Keepers (BQT ngành / Xứ đoàn) manage locations, items and stock and approve requests. Everyone sends requests and
// gives items back, and sees only their own requests.
import { all, now, textOrNull } from './sql.js';
import { configMap } from './org.js';
import { fail } from '../errors.js';
import { atLeast } from '../access.js';
import { ITEM_KINDS, ITEM_CODE_PREFIX, PHOTO_STAGES } from '../codes.js';

export const KEEPER_TIER = 'SECTOR_ADMIN';
export const isKeeper = (actor) => atLeast(actor, KEEPER_TIER);

const MAX_QUANTITY = 100000;
const MAX_LINES = 50;
const MAX_PHOTOS = 10; // per request
// ponytail: the page gets the newest 500 requests in one go; add paging when a year holds more.
const REQUEST_LIMIT = 500;
const KEEP_DAYS = 7; // closed and rejected requests, then deleted
const nameOf = (actor) => [actor.saintName, actor.fullName].filter(Boolean).join(' ');
const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const fileStamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const extensionOf = (contentType) => (contentType === 'image/png' ? 'png' : 'jpg');

export function quantity(value, label = 'Số lượng', min = 1) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > MAX_QUANTITY) fail(400, `${label} không hợp lệ.`);
  return n;
}

// The CHECKs of Items refuse a count below zero; the whole batch is then rolled back,
// so two approvals taking the last unit at the same time cannot both succeed.
async function run(db, statements, duplicate = 'Mã vật phẩm đã tồn tại.') {
  try {
    return await db.batch(statements);
  } catch (e) {
    if (/CHECK constraint/i.test(e.message)) fail(409, 'Số lượng trong kho không đủ. Hãy tải lại trang để xem số mới nhất.');
    if (/UNIQUE/i.test(e.message)) fail(409, duplicate);
    throw e;
  }
}

async function itemOf(db, id) {
  const item = await db.prepare('SELECT Id, Code, Kind, PhotoFileId FROM Items WHERE Id = ?').bind(id).first();
  if (!item) fail(404, 'Không tìm thấy vật phẩm.');
  return item;
}

const trashRow = (db, fileId) => db.prepare('INSERT OR IGNORE INTO DriveTrash (FileId) VALUES (?)').bind(fileId);

// Everything the page shows. A keeper gets every request; anyone else only their own. Everyone sees who holds
// what (loans: borrower, team, how many, since when), without the phone number.
export async function getInventory(db, actor) {
  const mine = isKeeper(actor) ? null : actor.userId;
  const items = await all(db, `
    SELECT i.Id AS id, i.Code AS code, i.Name AS name, i.Kind AS kind, i.LocationId AS locationId, l.Name AS location,
           i.Note AS note, i.Total AS total, i.Available AS available, i.PhotoFileId AS photoFileId
    FROM Items i LEFT JOIN Locations l ON l.Id = i.LocationId ORDER BY i.Name`);
  const locations = await all(db, 'SELECT Id AS id, Name AS name FROM Locations ORDER BY Name');
  const requests = await all(db, `
    SELECT Id AS id, UserId AS userId, ByName AS byName, Borrower AS borrower, Phone AS phone, Team AS team, DueDate AS dueDate,
           Note AS note, Status AS status, CreatedAt AS createdAt, DecidedAt AS decidedAt, DecidedBy AS decidedBy,
           ReturnedAt AS returnedAt, ReturnedBy AS returnedBy
    FROM Requests WHERE ? IS NULL OR UserId = ? ORDER BY Id DESC LIMIT ?`, mine, mine, REQUEST_LIMIT);
  const lines = await all(db, `SELECT l.RequestId, l.ItemId AS itemId, l.Quantity AS quantity
    FROM RequestLines l JOIN Requests r ON r.Id = l.RequestId WHERE ? IS NULL OR r.UserId = ?`, mine, mine);
  const photos = await all(db, `SELECT p.RequestId, p.FileId AS fileId, p.Stage AS stage, p.At AS at, p.ByName AS byName
    FROM RequestPhotos p JOIN Requests r ON r.Id = p.RequestId WHERE ? IS NULL OR r.UserId = ? ORDER BY p.At`, mine, mine);
  const loans = await all(db, `
    SELECT l.ItemId AS itemId, r.Id AS requestId, r.Borrower AS borrower, r.Team AS team, l.Quantity AS quantity,
           r.DecidedAt AS since, r.DueDate AS dueDate
    FROM RequestLines l JOIN Requests r ON r.Id = l.RequestId JOIN Items i ON i.Id = l.ItemId
    WHERE r.Status = 'ON_LOAN' AND i.Kind = 'RETURNABLE' ORDER BY r.DecidedAt`);
  const myPhone = await db.prepare('SELECT Phone FROM Users WHERE Id = ?').bind(actor.userId).first('Phone');
  const of = (rows, id) => rows.filter((r) => r.RequestId === id).map(({ RequestId, ...r }) => r);
  return {
    items, locations, loans, myPhone: myPhone ?? '',
    requests: requests.map((r) => ({ ...r, lines: of(lines, r.id), photos: of(photos, r.id) })),
  };
}

/* ---------- locations ---------- */
export async function saveLocation(db, { id, name }) {
  name = String(name ?? '').normalize('NFC').trim();
  if (!name) fail(400, 'Nhập tên nơi để.');
  if (id && !(await db.prepare('SELECT 1 AS ok FROM Locations WHERE Id = ?').bind(id).first('ok'))) fail(404, 'Không tìm thấy nơi để.');
  const statement = id
    ? db.prepare('UPDATE Locations SET Name = ? WHERE Id = ?').bind(name, id)
    : db.prepare('INSERT INTO Locations (Name) VALUES (?)').bind(name);
  const [result] = await run(db, [statement], 'Nơi để này đã có.');
  return id ?? result.meta.last_row_id;
}

// The items kept there are left without a location (ON DELETE SET NULL).
export async function deleteLocation(db, id) {
  await db.prepare('DELETE FROM Locations WHERE Id = ?').bind(id).run();
}

async function locationIdOf(db, value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || !(await db.prepare('SELECT 1 AS ok FROM Locations WHERE Id = ?').bind(id).first('ok'))) fail(400, 'Nơi để không tồn tại.');
  return id;
}

/* ---------- items ---------- */
// MT-001, MT-002, … for returnable items; HP-001, … for consumables.
// ponytail: two keepers adding an item of the same kind in the same second get the same code; the second gets
// "Mã vật phẩm đã tồn tại" and saves again. Retry in a loop if that ever happens in practice.
async function nextCode(db, kind) {
  const prefix = `${ITEM_CODE_PREFIX[kind]}-`;
  const last = await db.prepare('SELECT MAX(CAST(SUBSTR(Code, ?) AS INTEGER)) AS n FROM Items WHERE SUBSTR(Code, 1, ?) = ?')
    .bind(prefix.length + 1, prefix.length, prefix).first('n');
  return prefix + String((last ?? 0) + 1).padStart(3, '0');
}

// New: the code comes from the kind; the starting quantity is both the total and what is available.
// Edit: name, location and note only; the kind is fixed because Total means something else for each kind.
export async function saveItem(db, actor, input) {
  const name = String(input.name ?? '').trim();
  if (!name) fail(400, 'Nhập tên vật phẩm.');
  const locationId = await locationIdOf(db, input.locationId);
  const note = textOrNull(input.note);
  if (input.id) {
    await itemOf(db, input.id);
    await db.prepare('UPDATE Items SET Name = ?, LocationId = ?, Note = ?, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?')
      .bind(name, locationId, note, now(), actor.userId, input.id).run();
    return input.id;
  }
  if (!ITEM_KINDS.includes(input.kind)) fail(400, 'Loại vật phẩm không hợp lệ.');
  const start = quantity(input.quantity ?? 0, 'Số lượng ban đầu', 0);
  const code = await nextCode(db, input.kind);
  const [created] = await run(db, [db.prepare('INSERT INTO Items (Code, Name, Kind, LocationId, Note, Total, Available, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(code, name, input.kind, locationId, note, start, start, actor.userId)]);
  return created.meta.last_row_id;
}

export async function deleteItem(db, id) {
  const item = await itemOf(db, id);
  const open = await db.prepare(`SELECT COUNT(*) AS n FROM RequestLines l JOIN Requests r ON r.Id = l.RequestId
    WHERE l.ItemId = ? AND r.Status IN ('PENDING', 'ON_LOAN')`).bind(id).first('n');
  if (open) fail(409, `Không xóa được: vật phẩm đang nằm trong ${open} phiếu chờ duyệt hoặc đang mượn.`);
  const statements = [db.prepare('DELETE FROM Items WHERE Id = ?').bind(id)]; // its lines in old requests go with it
  if (item.PhotoFileId) statements.push(trashRow(db, item.PhotoFileId));
  await db.batch(statements);
}

// IN: bought or given. A returnable gains units; a consumable refills and its Total follows the highest level.
// LOSS: broken or lost. A returnable owns fewer units; a consumable just has less left.
export async function moveItem(db, actor, { itemId, type, quantity: qty }) {
  await itemOf(db, itemId);
  qty = quantity(qty);
  // Plain ? only (the test stand-in cannot bind ?NNN): the quantity is bound once per ? in `sql`.
  const update = (sql) => db.prepare(`UPDATE Items SET ${sql}, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?`)
    .bind(...Array(sql.split('?').length - 1).fill(qty), now(), actor.userId, itemId);
  const change = {
    IN: "Available = Available + ?, Total = CASE Kind WHEN 'CONSUMABLE' THEN MAX(Total, Available + ?) ELSE Total + ? END",
    LOSS: "Available = Available - ?, Total = CASE Kind WHEN 'CONSUMABLE' THEN Total ELSE Total - ? END",
  }[type];
  if (!change) fail(400, 'Thao tác kho không hợp lệ.');
  await run(db, [update(change)]);
}

/* ---------- requests ---------- */
// Vietnamese numbers: spaces and dots dropped, +84 written as 0.
export function phoneOf(value) {
  const phone = String(value ?? '').replace(/[\s.()-]/g, '').replace(/^\+?84/, '0');
  if (!/^0\d{9,10}$/.test(phone)) fail(400, 'Số điện thoại không hợp lệ.');
  return phone;
}

// Anyone. The stock is only checked here, and taken at approval.
export async function createRequest(db, actor, input, today) {
  const borrower = String(input.borrower ?? '').trim();
  if (!borrower) fail(400, 'Nhập họ tên người nhận / mượn.');
  const phone = phoneOf(input.phone);
  const team = String(input.team ?? '').trim();
  if (!team) fail(400, 'Chọn đội nhóm / ban.');
  const wanted = new Map();
  for (const line of Array.isArray(input.lines) ? input.lines : []) {
    const itemId = Number(line?.itemId);
    if (!Number.isInteger(itemId)) fail(400, 'Vật phẩm không hợp lệ.');
    wanted.set(itemId, (wanted.get(itemId) ?? 0) + quantity(line.quantity));
  }
  if (!wanted.size) fail(400, 'Chọn ít nhất một vật phẩm.');
  if (wanted.size > MAX_LINES) fail(400, `Mỗi phiếu tối đa ${MAX_LINES} vật phẩm.`);
  const ids = [...wanted.keys()];
  const items = await all(db, `SELECT Id, Name, Kind, Available FROM Items WHERE Id IN (${ids.map(() => '?').join(', ')})`, ...ids);
  if (items.length !== ids.length) fail(400, 'Vật phẩm không tồn tại.');
  const short = items.find((i) => wanted.get(i.Id) > i.Available);
  if (short) fail(409, `${short.Name}: trong kho chỉ còn ${short.Available}.`);
  let dueDate = null;
  if (items.some((i) => i.Kind === 'RETURNABLE')) {
    dueDate = String(input.dueDate ?? '');
    if (!isIsoDate(dueDate) || dueDate < today) fail(400, 'Ngày hẹn trả không hợp lệ (bắt buộc với đồ mượn, từ hôm nay trở đi).');
  }
  // Same connection and transaction: last_insert_rowid() is the request just added
  // (RequestLines is WITHOUT ROWID, so its own inserts do not change it).
  const [created] = await db.batch([
    db.prepare('INSERT INTO Requests (UserId, ByName, Borrower, Phone, Team, DueDate, Note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(actor.userId, nameOf(actor), borrower, phone, team, dueDate, textOrNull(input.note)),
    db.prepare(`INSERT INTO RequestLines (RequestId, ItemId, Quantity)
      SELECT last_insert_rowid(), json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?)`).bind(JSON.stringify([...wanted])),
  ]);
  return created.meta.last_row_id;
}

async function requestOf(db, id) {
  const request = await db.prepare('SELECT Id, UserId, Borrower, Team, Status FROM Requests WHERE Id = ?').bind(id).first();
  if (!request) fail(404, 'Không tìm thấy phiếu.');
  request.lines = await all(db, 'SELECT l.ItemId, l.Quantity, i.Kind FROM RequestLines l JOIN Items i ON i.Id = l.ItemId WHERE l.RequestId = ?', id);
  return request;
}

function requireOwnerOrKeeper(actor, request) {
  if (!isKeeper(actor) && request.UserId !== actor.userId) fail(403, 'Phiếu này không phải của bạn.');
}

const photoCount = (db, id, stages) => db
  .prepare(`SELECT COUNT(*) AS n FROM RequestPhotos WHERE RequestId = ? AND Stage IN (${stages.map(() => '?').join(', ')})`)
  .bind(id, ...stages).first('n');

// Moves the stock of `lines` and the request from one status to the next in one batch. Every statement is guarded
// by the old status, so a second approval or return of the same request (two people at once) changes nothing.
async function settle(db, actor, request, { from, to, lines, sign, stamp }) {
  const guard = 'EXISTS (SELECT 1 FROM Requests WHERE Id = ? AND Status = ?)';
  const statements = lines.map((l) => db.prepare(`UPDATE Items SET Available = Available + ?, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ? AND ${guard}`)
    .bind(sign * l.Quantity, now(), actor.userId, l.ItemId, request.Id, from));
  statements.push(db.prepare(`UPDATE Requests SET Status = ?, ${stamp}At = ?, ${stamp}By = ? WHERE Id = ? AND Status = ?`)
    .bind(to, now(), nameOf(actor), request.Id, from));
  const results = await run(db, statements);
  if (!results.at(-1).meta.changes) fail(409, 'Phiếu này vừa được người khác xử lý. Hãy tải lại trang.');
}

// Keeper. Items to give back need a hand-over photo, sent with the request or added now; consumables do not.
export async function approveRequest(db, actor, id) {
  const request = await requestOf(db, id);
  if (request.Status !== 'PENDING') fail(409, 'Phiếu này đã được xử lý.');
  if (!request.lines.length) fail(409, 'Phiếu không còn vật phẩm nào.');
  const lending = request.lines.some((l) => l.Kind === 'RETURNABLE');
  if (lending && !(await photoCount(db, id, ['SUBMIT', 'APPROVE']))) fail(400, 'Cần ảnh bàn giao đồ mượn trước khi duyệt.');
  await settle(db, actor, request, {
    from: 'PENDING', to: lending ? 'ON_LOAN' : 'CLOSED', lines: request.lines, sign: -1, stamp: 'Decided',
  });
}

// A keeper refuses a request, or its owner cancels it, while it waits.
export async function rejectRequest(db, actor, id) {
  const request = await requestOf(db, id);
  requireOwnerOrKeeper(actor, request);
  const { meta } = await db.prepare("UPDATE Requests SET Status = 'REJECTED', DecidedAt = ?, DecidedBy = ? WHERE Id = ? AND Status = 'PENDING'")
    .bind(now(), nameOf(actor), id).run();
  if (!meta.changes) fail(409, 'Phiếu này đã được xử lý.');
}

// The owner or a keeper, with a photo of what came back. Everything returnable goes back on the shelf;
// a unit found broken is written off afterwards with LOSS.
export async function returnRequest(db, actor, id) {
  const request = await requestOf(db, id);
  requireOwnerOrKeeper(actor, request);
  if (request.Status !== 'ON_LOAN') fail(409, 'Phiếu này không có đồ đang mượn.');
  if (!(await photoCount(db, id, ['RETURN']))) fail(400, 'Cần ảnh trả đồ trước khi xác nhận trả.');
  await settle(db, actor, request, {
    from: 'ON_LOAN', to: 'CLOSED', lines: request.lines.filter((l) => l.Kind === 'RETURNABLE'), sign: 1, stamp: 'Returned',
  });
}

// Weekly job: requests closed or rejected more than KEEP_DAYS ago are deleted with their lines and photos. The photos
// and the request's Drive folder join the Drive trash queue, emptied right after.
export async function purgeFinishedRequests(db, at = new Date()) {
  const before = new Date(at.getTime() - KEEP_DAYS * 864e5).toISOString();
  const ids = (await all(db, `SELECT Id FROM Requests WHERE Status IN ('CLOSED', 'REJECTED') AND COALESCE(ReturnedAt, DecidedAt) < ?`, before))
    .map((r) => r.Id);
  if (!ids.length) return 0;
  const list = JSON.stringify(ids);
  const folder = "EXISTS (SELECT 1 FROM json_each(?) j WHERE DriveFolders.PathKey LIKE '%/Warehouse/Phiếu mượn/YC-' || j.value)";
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO DriveTrash (FileId) SELECT FileId FROM RequestPhotos WHERE RequestId IN (SELECT value FROM json_each(?))').bind(list),
    db.prepare(`INSERT OR IGNORE INTO DriveTrash (FileId) SELECT FolderId FROM DriveFolders WHERE ${folder}`).bind(list),
    db.prepare(`DELETE FROM DriveFolders WHERE ${folder}`).bind(list),
    db.prepare('DELETE FROM Requests WHERE Id IN (SELECT value FROM json_each(?))').bind(list),
  ]);
  return ids.length;
}

/* ---------- photos, in Google Drive under <DriveFolderId>/Warehouse ---------- */
const warehouseFolder = async (db, drive, parts) => drive.folderFor((await configMap(db)).DriveFolderId || 'root', ['Warehouse', ...parts]);

// Warehouse/<Code>/<Code>_<time>.jpg. The photo it replaces goes to the Drive trash with the weekly job.
export async function setItemPhoto(db, drive, actor, id, { bytes, contentType }) {
  const item = await itemOf(db, id);
  const folderId = await warehouseFolder(db, drive, [item.Code]);
  const fileId = await drive.upload({ folderId, filename: `${item.Code}_${fileStamp()}.${extensionOf(contentType)}`, contentType, bytes });
  const statements = [db.prepare('UPDATE Items SET PhotoFileId = ?, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?').bind(fileId, now(), actor.userId, id)];
  if (item.PhotoFileId) statements.push(trashRow(db, item.PhotoFileId));
  await db.batch(statements);
  return fileId;
}

export async function removeItemPhoto(db, actor, id) {
  const item = await itemOf(db, id);
  if (!item.PhotoFileId) return;
  await db.batch([
    db.prepare('UPDATE Items SET PhotoFileId = NULL, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?').bind(now(), actor.userId, id),
    trashRow(db, item.PhotoFileId),
  ]);
}

export async function itemPhotoId(db, id) {
  const fileId = await db.prepare('SELECT PhotoFileId FROM Items WHERE Id = ?').bind(id).first('PhotoFileId');
  if (!fileId) fail(404, 'Vật phẩm này chưa có ảnh.');
  return fileId;
}

// Who may add or remove a photo of a stage, and while the request is in which status.
// SUBMIT: the owner (or a keeper) while it waits. APPROVE: a keeper while it waits. RETURN: the owner or a keeper while it is out.
const STAGE_STATUS = { SUBMIT: 'PENDING', APPROVE: 'PENDING', RETURN: 'ON_LOAN' };
function requirePhotoEdit(actor, request, stage) {
  requireOwnerOrKeeper(actor, request);
  if (stage === 'APPROVE' && !isKeeper(actor)) fail(403, 'Bạn không có quyền thực hiện thao tác này.');
  if (request.Status !== STAGE_STATUS[stage]) fail(409, 'Không sửa được ảnh ở bước này của phiếu.');
}

// Warehouse/Phiếu mượn/YC-<Id>/.
export async function addRequestPhoto(db, drive, actor, id, stage, { bytes, contentType }) {
  if (!PHOTO_STAGES.includes(stage)) fail(400, 'Loại ảnh không hợp lệ.');
  const request = await requestOf(db, id);
  requirePhotoEdit(actor, request, stage);
  if ((await photoCount(db, id, PHOTO_STAGES)) >= MAX_PHOTOS) fail(400, `Mỗi phiếu tối đa ${MAX_PHOTOS} ảnh.`);
  const folderId = await warehouseFolder(db, drive, ['Phiếu mượn', `YC-${id}`]);
  const fileId = await drive.upload({ folderId, filename: `YC-${id}_${stage}_${fileStamp()}.${extensionOf(contentType)}`, contentType, bytes });
  await db.prepare('INSERT INTO RequestPhotos (FileId, RequestId, Stage, ByName) VALUES (?, ?, ?, ?)').bind(fileId, id, stage, nameOf(actor)).run();
  return fileId;
}

// Same rules as adding. The file goes to the Drive trash with the weekly job.
export async function removeRequestPhoto(db, actor, id, fileId) {
  const request = await requestOf(db, id);
  const stage = await db.prepare('SELECT Stage FROM RequestPhotos WHERE FileId = ? AND RequestId = ?').bind(fileId, id).first('Stage');
  if (!stage) fail(404, 'Không tìm thấy ảnh.');
  requirePhotoEdit(actor, request, stage);
  await db.batch([db.prepare('DELETE FROM RequestPhotos WHERE FileId = ?').bind(fileId), trashRow(db, fileId)]);
}

// The photo, if it belongs to the request and the request to the actor (or the actor is a keeper).
export async function checkRequestPhoto(db, actor, id, fileId) {
  const owner = await db.prepare('SELECT r.UserId FROM RequestPhotos p JOIN Requests r ON r.Id = p.RequestId WHERE p.FileId = ? AND p.RequestId = ?')
    .bind(fileId, id).first('UserId');
  if (owner === null) fail(404, 'Không tìm thấy ảnh.');
  if (!isKeeper(actor) && owner !== actor.userId) fail(403, 'Phiếu này không phải của bạn.');
}
