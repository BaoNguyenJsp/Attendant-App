import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1 } from './helpers/seeded.mjs';
import { AppError } from '../src/lib/errors.js';
import { loadSession } from '../src/lib/db/users.js';
import {
  getInventory, saveItem, deleteItem, moveItem, saveLocation, deleteLocation, phoneOf,
  createRequest, approveRequest, rejectRequest, returnRequest, setItemPhoto, removeItemPhoto, addRequestPhoto, removeRequestPhoto, checkRequestPhoto, purgeFinishedRequests,
} from '../src/lib/db/inventory.js';

const TODAY = '2026-11-09';
const NEXT_WEEK = '2026-11-16';
const status = (code) => (e) => e instanceof AppError && e.status === code;
const admin = (db) => loadSession(db, 'doruoora@gmail.com');
const teacher = (db) => loadSession(db, 'teacher08@example.com');
const itemOf = async (db, actor, id) => (await getInventory(db, actor)).items.find((i) => i.id === id);
const counts = async (db, actor, id) => { const i = await itemOf(db, actor, id); return [i.available, i.total]; };
const statusOf = async (db, actor, id) => (await getInventory(db, actor)).requests.find((r) => r.id === id).status;
const JPEG = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: 'image/jpeg' };

// A stand-in for Google Drive: remembers the folder path and file name of every upload.
function fakeDrive() {
  const uploads = [];
  return {
    uploads,
    folderFor: async (root, parts) => [root, ...parts].join('/'),
    upload: async ({ folderId, filename }) => { uploads.push(`${folderId}/${filename}`); return `file-${uploads.length}`; },
  };
}

const request = (lines, extra = {}) => ({ borrower: 'Nguyễn Văn A', phone: '0901 234 567', team: 'Ấu 1', dueDate: NEXT_WEEK, lines, ...extra });

test('item codes come from the kind; the start quantity is the first move; locations are picked from a list', async () => {
  const db = await seededD1();
  const a = await admin(db);
  const room = await saveLocation(db, { name: 'Phòng Học Vụ' });
  await assert.rejects(saveLocation(db, { name: 'phòng học vụ' }), status(409));
  const projector = await saveItem(db, a, { name: ' Máy chiếu ', kind: 'RETURNABLE', locationId: room, quantity: 2, code: 'IGNORED' });
  await saveItem(db, a, { name: 'Loa', kind: 'RETURNABLE' });
  const paper = await saveItem(db, a, { name: 'Giấy A4', kind: 'CONSUMABLE', quantity: 0 });
  const { items } = await getInventory(db, a);
  assert.deepEqual(items.map((i) => [i.code, i.name, i.location, i.available]), [
    ['HP-001', 'Giấy A4', null, 0], ['MT-002', 'Loa', null, 0], ['MT-001', 'Máy chiếu', 'Phòng Học Vụ', 2],
  ]);
  assert.deepEqual(await counts(db, a, projector), [2, 2]);
  assert.deepEqual(await counts(db, a, paper), [0, 0]);
  await assert.rejects(saveItem(db, a, { name: 'X', kind: 'OTHER' }), status(400));
  await assert.rejects(saveItem(db, a, { name: 'X', kind: 'RETURNABLE', locationId: 999 }), status(400));

  // Editing keeps the kind and the counts; deleting a location leaves its items without one.
  await saveItem(db, a, { id: projector, name: 'Máy chiếu cũ', kind: 'CONSUMABLE', quantity: 9, locationId: room });
  await deleteLocation(db, room);
  const item = await itemOf(db, a, projector);
  assert.deepEqual([item.name, item.kind, item.code, item.locationId, item.available], ['Máy chiếu cũ', 'RETURNABLE', 'MT-001', null, 2]);
});

test('keeper stock moves: IN and LOSS only, consumable total follows the highest level', async () => {
  const db = await seededD1();
  const a = await admin(db);
  const id = await saveItem(db, a, { name: 'Giấy A4', kind: 'CONSUMABLE', quantity: 10 });
  await moveItem(db, a, { itemId: id, type: 'IN', quantity: 20 });
  assert.deepEqual(await counts(db, a, id), [30, 30]);
  await moveItem(db, a, { itemId: id, type: 'LOSS', quantity: 5 });
  assert.deepEqual(await counts(db, a, id), [25, 30]);
  await assert.rejects(moveItem(db, a, { itemId: id, type: 'LOSS', quantity: 26 }), status(409));
  await assert.rejects(moveItem(db, a, { itemId: id, type: 'OUT', quantity: 1 }), status(400));
});

test('a request waits for approval; a lent item needs a hand-over photo, then a return photo', async () => {
  const db = await seededD1();
  const [a, t] = [await admin(db), await teacher(db)];
  const drive = fakeDrive();
  const projector = await saveItem(db, a, { name: 'Máy chiếu', kind: 'RETURNABLE', quantity: 3 });
  const paper = await saveItem(db, a, { name: 'Giấy A4', kind: 'CONSUMABLE', quantity: 10 });

  await assert.rejects(createRequest(db, t, request([{ itemId: projector, quantity: 4 }]), TODAY), status(409));
  await assert.rejects(createRequest(db, t, request([{ itemId: projector, quantity: 1 }], { dueDate: '' }), TODAY), status(400));
  await assert.rejects(createRequest(db, t, request([{ itemId: projector, quantity: 1 }], { phone: '123' }), TODAY), status(400));
  await assert.rejects(createRequest(db, t, request([]), TODAY), status(400));
  const id = await createRequest(db, t, request([{ itemId: projector, quantity: 2 }, { itemId: paper, quantity: 4 }]), TODAY);

  // Nothing leaves the shelf before approval.
  assert.deepEqual(await counts(db, a, projector), [3, 3]);
  const [mine] = (await getInventory(db, t)).requests;
  assert.deepEqual([mine.status, mine.phone, mine.team, mine.dueDate, mine.lines], ['PENDING', '0901234567', 'Ấu 1', NEXT_WEEK, [{ itemId: projector, quantity: 2 }, { itemId: paper, quantity: 4 }]]);

  await assert.rejects(approveRequest(db, a, id), status(400)); // no photo yet
  await assert.rejects(addRequestPhoto(db, drive, t, id, 'APPROVE', JPEG), status(403));
  await assert.rejects(addRequestPhoto(db, drive, t, id, 'RETURN', JPEG), status(409));
  const handOver = await addRequestPhoto(db, drive, a, id, 'APPROVE', JPEG);
  assert.match(drive.uploads[0], new RegExp(`^root/Warehouse/Phiếu mượn/YC-${id}/YC-${id}_APPROVE_.+\\.jpg$`));
  await approveRequest(db, a, id);
  await assert.rejects(approveRequest(db, a, id), status(409));
  assert.equal(await statusOf(db, t, id), 'ON_LOAN');
  assert.deepEqual(await counts(db, a, projector), [1, 3]);
  assert.deepEqual(await counts(db, a, paper), [6, 10]);

  await assert.rejects(returnRequest(db, t, id), status(400)); // no return photo yet
  await addRequestPhoto(db, drive, t, id, 'RETURN', JPEG);
  await returnRequest(db, t, id);
  await assert.rejects(returnRequest(db, t, id), status(409));
  assert.equal(await statusOf(db, t, id), 'CLOSED');
  assert.deepEqual(await counts(db, a, projector), [3, 3]);
  assert.deepEqual(await counts(db, a, paper), [6, 10]); // consumables do not come back

  await checkRequestPhoto(db, t, id, handOver);
});

test('consumables only: approved without a photo and closed at once; the stock is checked again at approval', async () => {
  const db = await seededD1();
  const [a, t] = [await admin(db), await teacher(db)];
  const paper = await saveItem(db, a, { name: 'Giấy A4', kind: 'CONSUMABLE', quantity: 5 });
  const first = await createRequest(db, t, request([{ itemId: paper, quantity: 3 }], { dueDate: '' }), TODAY);
  const second = await createRequest(db, t, request([{ itemId: paper, quantity: 3 }], { dueDate: '' }), TODAY);
  assert.equal((await getInventory(db, t)).requests.find((r) => r.id === first).dueDate, null);
  await approveRequest(db, a, first);
  assert.equal(await statusOf(db, a, first), 'CLOSED');
  await assert.rejects(approveRequest(db, a, second), status(409)); // only 2 left
  assert.equal(await statusOf(db, a, second), 'PENDING');
  assert.deepEqual(await counts(db, a, paper), [2, 5]);
});

test('a teacher sees and touches only their own requests; the owner may cancel while it waits', async () => {
  const db = await seededD1();
  const [a, t] = [await admin(db), await teacher(db)];
  const other = await loadSession(db, 'teacher02@example.com');
  const drive = fakeDrive();
  const loa = await saveItem(db, a, { name: 'Loa', kind: 'RETURNABLE', quantity: 2 });
  const theirs = await createRequest(db, other, request([{ itemId: loa, quantity: 1 }]), TODAY);
  const mine = await createRequest(db, t, request([{ itemId: loa, quantity: 1 }]), TODAY);
  const photo = await addRequestPhoto(db, drive, other, theirs, 'SUBMIT', JPEG);
  assert.deepEqual((await getInventory(db, t)).requests.map((r) => r.id), [mine]);
  assert.deepEqual((await getInventory(db, a)).requests.map((r) => r.id), [mine, theirs]);
  await assert.rejects(rejectRequest(db, t, theirs), status(403));
  await assert.rejects(addRequestPhoto(db, drive, t, theirs, 'SUBMIT', JPEG), status(403));
  await assert.rejects(checkRequestPhoto(db, t, theirs, photo), status(403));
  await rejectRequest(db, t, mine);
  assert.equal(await statusOf(db, t, mine), 'REJECTED');
  await approveRequest(db, a, theirs); // the photo sent with the request counts as the hand-over
});

test('item photo in Warehouse/<code>; the replaced one goes to the Drive trash; an item out on loan cannot be deleted', async () => {
  const db = await seededD1();
  const [a, t] = [await admin(db), await teacher(db)];
  const drive = fakeDrive();
  const id = await saveItem(db, a, { name: 'Loa', kind: 'RETURNABLE', quantity: 1 });
  await setItemPhoto(db, drive, a, id, JPEG);
  await setItemPhoto(db, drive, a, id, { ...JPEG, contentType: 'image/png' });
  assert.match(drive.uploads[1], /^root\/Warehouse\/MT-001\/MT-001_.+\.png$/);
  assert.equal((await itemOf(db, a, id)).photoFileId, 'file-2');
  await removeItemPhoto(db, a, id);
  assert.equal((await itemOf(db, a, id)).photoFileId, null);
  assert.deepEqual((await db.prepare('SELECT FileId FROM DriveTrash ORDER BY FileId').all()).results.map((r) => r.FileId), ['file-1', 'file-2']);

  const loan = await createRequest(db, t, request([{ itemId: id, quantity: 1 }]), TODAY);
  await assert.rejects(deleteItem(db, id), status(409));
  await rejectRequest(db, a, loan);
  await deleteItem(db, id);
  assert.deepEqual((await getInventory(db, a)).items, []);
});

test('the photo sent with a request is the hand-over photo; its owner may change it while it waits', async () => {
  const db = await seededD1();
  const [a, t] = [await admin(db), await teacher(db)];
  const drive = fakeDrive();
  const loa = await saveItem(db, a, { name: 'Loa', kind: 'RETURNABLE', quantity: 2 });
  const id = await createRequest(db, t, request([{ itemId: loa, quantity: 1 }]), TODAY);
  const first = await addRequestPhoto(db, drive, t, id, 'SUBMIT', JPEG);
  await removeRequestPhoto(db, t, id, first);
  await assert.rejects(removeRequestPhoto(db, t, id, first), status(404));
  await assert.rejects(approveRequest(db, a, id), status(400)); // no photo left
  const second = await addRequestPhoto(db, drive, t, id, 'SUBMIT', JPEG);
  const handOver = await addRequestPhoto(db, drive, a, id, 'APPROVE', JPEG);
  await assert.rejects(removeRequestPhoto(db, t, id, handOver), status(403));
  await approveRequest(db, a, id); // no new photo needed
  await assert.rejects(removeRequestPhoto(db, t, id, second), status(409)); // no longer waiting
  assert.deepEqual((await db.prepare('SELECT FileId FROM DriveTrash').all()).results.map((r) => r.FileId), [first]);
});

test('everyone sees who holds each item, without the phone number', async () => {
  const db = await seededD1();
  const [a, t] = [await admin(db), await teacher(db)];
  const loa = await saveItem(db, a, { name: 'Loa', kind: 'RETURNABLE', quantity: 3 });
  const id = await createRequest(db, a, request([{ itemId: loa, quantity: 2 }], { borrower: 'Trưởng B' }), TODAY);
  await addRequestPhoto(db, fakeDrive(), a, id, 'APPROVE', JPEG);
  await approveRequest(db, a, id);
  const { requests, loans } = await getInventory(db, t);
  assert.deepEqual(requests, []); // not their request
  assert.deepEqual(loans.map(({ since, ...l }) => l), [{ itemId: loa, requestId: id, borrower: 'Trưởng B', team: 'Ấu 1', quantity: 2, dueDate: NEXT_WEEK }]);
  assert.ok(loans[0].since);
});

test('the weekly job deletes requests finished more than a week ago, queues their photos and folder for the Drive trash', async () => {
  const db = await seededD1();
  const a = await admin(db);
  const drive = fakeDrive();
  const paper = await saveItem(db, a, { name: 'Giấy', kind: 'CONSUMABLE', quantity: 9 });
  const done = await createRequest(db, a, request([{ itemId: paper, quantity: 1 }]), TODAY);
  const photo = await addRequestPhoto(db, drive, a, done, 'SUBMIT', JPEG);
  await approveRequest(db, a, done); // consumables only: closed at once
  const waiting = await createRequest(db, a, request([{ itemId: paper, quantity: 1 }]), TODAY);
  await db.prepare('INSERT INTO DriveFolders (PathKey, FolderId) VALUES (?, ?), (?, ?)')
    .bind(`root/Warehouse/Phiếu mượn/YC-${done}`, 'folder-done', `root/Warehouse/Phiếu mượn/YC-${done}0`, 'folder-other').run();
  const later = (days) => new Date(Date.now() + days * 864e5);
  assert.equal(await purgeFinishedRequests(db, later(6)), 0);
  assert.equal(await purgeFinishedRequests(db, later(8)), 1);
  assert.deepEqual((await getInventory(db, a)).requests.map((r) => r.id), [waiting]);
  assert.deepEqual((await db.prepare('SELECT FileId FROM DriveTrash ORDER BY FileId').all()).results.map((r) => r.FileId), [photo, 'folder-done'].sort());
  assert.deepEqual((await db.prepare('SELECT FolderId FROM DriveFolders').all()).results.map((r) => r.FolderId), ['folder-other']);
  assert.deepEqual(await counts(db, a, paper), [8, 9]); // the stock stays as the one approval left it
  // A deleted number is never given again.
  assert.ok(await createRequest(db, a, request([{ itemId: paper, quantity: 1 }]), TODAY) > waiting);
});

test('phone numbers', () => {
  assert.equal(phoneOf('+84 901.234.567'), '0901234567');
  assert.equal(phoneOf('028 3823 4567'), '02838234567');
  assert.throws(() => phoneOf('0901'), status(400));
});
