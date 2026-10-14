import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1 } from './helpers/seeded.mjs';
import { AppError } from '../src/lib/errors.js';
import { loadSession } from '../src/lib/db/users.js';
import { makeDrive, NOT_CONNECTED } from '../src/lib/drive.js';
import { getLessons, saveLesson, createUploadUrls, emptyDriveTrash } from '../src/lib/db/lessons.js';

const status = (code) => (e) => e instanceof AppError && e.status === code;
const WEEK = '2026-10-11'; // no lesson yet in the demo data
const teacher = (db) => loadSession(db, 'teacher08@example.com'); // user 13, class 1
const file = (n) => ({ url: `https://drive.google.com/file/d/F${n}/view`, name: `bai ${n}.pdf`, type: 'FILE', driveFileId: `F${n}` });
const link = (url, name = 'Tài liệu') => ({ url, name, type: 'LINK' });
const trashQueue = async (db) => (await db.prepare('SELECT FileId FROM DriveTrash ORDER BY FileId').all()).results.map((r) => r.FileId);

// A stand-in for Google: records calls, creates folder ids on demand.
function fakeGoogle() {
  const calls = [];
  const gone = new Set(); // folder ids deleted in Drive
  let folders = 0;
  const fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const json = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'token-1' });
    if (u.includes('/upload/drive/v3/files')) return json({}, { Location: 'https://upload.example/session-1' });
    if (init.method === 'PATCH') return u.endsWith('/missing') ? new Response('', { status: 404 }) : u.endsWith('/broken') ? new Response('', { status: 500 }) : json({});
    if (init.method === 'POST') return json({ id: `folder-${++folders}` });
    if (gone.has(u.match(/\/files\/([^?]+)\?fields=trashed/)?.[1])) return new Response('', { status: 404 });
    return json({ files: [] });
  };
  return { fetch, calls, gone };
}

async function connected(db, google = fakeGoogle()) {
  await db.prepare("INSERT INTO Secrets (Key, Value) VALUES ('DriveRefreshToken', 'refresh-1')").run();
  return { google, drive: makeDrive({ db, clientId: 'id', clientSecret: 'secret', fetch: google.fetch }) };
}

test('getLessons returns the lessons of one school year with teacher names', async () => {
  const db = await seededD1();
  const lessons = await getLessons(db, {});
  assert.equal(lessons.length, 36);
  const user = await db.prepare('SELECT SaintName, FullName FROM Users WHERE Id = ?').bind(lessons[0].teacherId).first();
  assert.equal(lessons[0].teacherName, `${user.SaintName} ${user.FullName}`);
  assert.deepEqual([lessons[0].location, lessons[0].planFiles, lessons[0].revisedFiles], ['Trong lớp', [], []]);
  assert.deepEqual(await getLessons(db, { schoolYear: '2025-2026' }), []);
});

test('a new lesson needs content, gets the default location and keeps its files in order', async () => {
  const db = await seededD1();
  const t = await teacher(db);
  await assert.rejects(saveLesson(db, t, { weekOf: WEEK, classId: 1, content: ' ' }), status(400));
  const saved = await saveLesson(db, t, {
    weekOf: WEEK, classId: 1, content: ' Bài 6 ', location: '',
    planFiles: [file(1), link('https://example.com/a,b?x=1', 'Tên, có dấu phẩy.pdf')],
    revisedFiles: [link('https://youtu.be/abcdef')],
  });
  assert.deepEqual([saved.schoolYear, saved.content, saved.location, saved.teacherId], ['2026-2027', 'Bài 6', 'Trong lớp', 13]);
  assert.deepEqual(saved.planFiles, [file(1), { url: 'https://example.com/a,b?x=1', name: 'Tên, có dấu phẩy.pdf', type: 'LINK', driveFileId: null }]);
  assert.deepEqual(saved.revisedFiles, [{ url: 'https://youtu.be/abcdef', name: 'Tài liệu', type: 'LINK', driveFileId: null }]);
});

test('a later saver is recorded as updater; the first saver stays the teacher', async () => {
  const db = await seededD1();
  await saveLesson(db, await teacher(db), { weekOf: WEEK, classId: 1, content: 'Bài 6' });
  const admin = await loadSession(db, 'doruoora@gmail.com');
  const saved = await saveLesson(db, admin, { weekOf: WEEK, classId: 1, content: '', location: 'Nhà thờ' });
  assert.deepEqual([saved.teacherId, saved.content, saved.location, saved.updatedByName], [13, '', 'Nhà thờ', admin.fullName]);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM Lessons WHERE WeekOf = ? AND ClassId = 1').bind(WEEK).first('n'), 1);
});

test('only removed uploaded files go to the Drive trash queue', async () => {
  const db = await seededD1();
  const t = await teacher(db);
  await saveLesson(db, t, { weekOf: WEEK, classId: 1, content: 'Bài 6', planFiles: [file(1), file(2), link('https://drive.google.com/file/d/OTHER/view')], revisedFiles: [file(3)] });
  await saveLesson(db, t, { weekOf: WEEK, classId: 1, content: 'Bài 6', planFiles: [file(2)], revisedFiles: [] });
  assert.deepEqual(await trashQueue(db), ['F1', 'F3']);
  // a file moved to the other slot is kept
  await saveLesson(db, t, { weekOf: WEEK, classId: 1, content: 'Bài 6', planFiles: [], revisedFiles: [file(2)] });
  assert.deepEqual(await trashQueue(db), ['F1', 'F3']);
});

test('lesson rules: scope, Sunday, three uploaded files per slot, links start with http', async () => {
  const db = await seededD1();
  const t = await teacher(db);
  const base = { weekOf: WEEK, classId: 1, content: 'Bài 6' };
  await assert.rejects(saveLesson(db, t, { ...base, classId: 2 }), status(403));
  await assert.rejects(saveLesson(db, t, { ...base, weekOf: '2026-10-12' }), status(400));
  await assert.rejects(saveLesson(db, t, { ...base, planFiles: [file(1), file(2), file(3), file(4)] }), status(400));
  await assert.rejects(saveLesson(db, t, { ...base, planFiles: [link('ftp://example.com/a')] }), status(400));
  await assert.rejects(saveLesson(db, t, { ...base, planFiles: [{ ...file(1), driveFileId: '' }] }), status(400));
  await assert.rejects(saveLesson(db, t, { ...base, planFiles: [{ ...file(1), type: 'OTHER' }] }), status(400));
  // any number of links is fine
  const many = Array.from({ length: 6 }, (_, i) => link(`https://example.com/${i}`));
  assert.equal((await saveLesson(db, t, { ...base, planFiles: [file(1), file(2), file(3), ...many] })).planFiles.length, 9);
});

test('an upload link needs the class in scope and a connected Drive', async () => {
  const db = await seededD1();
  const t = await teacher(db);
  const request = { weekOf: WEEK, classId: 1, files: [{ slot: 'PLAN', filename: 'bai:6.pdf' }], origin: 'https://app.example' };
  const offline = makeDrive({ db, clientId: 'id', clientSecret: 'secret', fetch: fakeGoogle().fetch });
  await assert.rejects(createUploadUrls(db, offline, t, request), (e) => status(409)(e) && e.message === NOT_CONNECTED);

  const { google, drive } = await connected(db);
  await assert.rejects(createUploadUrls(db, drive, t, { ...request, classId: 2 }), status(403));
  await assert.rejects(createUploadUrls(db, drive, t, { ...request, files: [{ slot: 'GLV', filename: 'a.pdf' }] }), status(400));
  await assert.rejects(createUploadUrls(db, drive, t, { ...request, files: [{ slot: 'PLAN', filename: ' ' }] }), status(400));

  assert.deepEqual(await createUploadUrls(db, drive, t, request), ['https://upload.example/session-1']);
  const folders = (await db.prepare('SELECT PathKey FROM DriveFolders ORDER BY PathKey').all()).results.map((r) => r.PathKey);
  assert.deepEqual(folders, ['root/2026-2027', 'root/2026-2027/Chiên Con', 'root/2026-2027/Chiên Con/2026-10-11', 'root/2026-2027/Chiên Con/2026-10-11/PLAN']);
  const upload = google.calls.find((c) => c.url.includes('/upload/'));
  assert.deepEqual(JSON.parse(upload.body), { name: 'bai_6.pdf', parents: ['folder-4'] });
  assert.equal(upload.headers.Origin, 'https://app.example');
  assert.equal(upload.headers.Authorization, 'Bearer token-1');

  // a second save reuses the remembered folders and the token: three files of one slot = one folder check, three sessions
  const before = google.calls.length;
  const three = ['a.pdf', 'b.pdf', 'c.pdf'].map((filename) => ({ slot: 'PLAN', filename }));
  assert.equal((await createUploadUrls(db, drive, t, { ...request, files: three })).length, 3);
  assert.equal(google.calls.length, before + 4);
  await assert.rejects(createUploadUrls(db, drive, t, { ...request, files: [] }), status(400));

  // the class folder was deleted in Drive: it and the folders below it are created again, the year folder is kept
  for (const id of ['folder-2', 'folder-3', 'folder-4']) google.gone.add(id);
  await createUploadUrls(db, drive, t, request);
  assert.deepEqual(JSON.parse(google.calls.at(-1).body).parents, ['folder-7']);
  const ids = (await db.prepare('SELECT FolderId FROM DriveFolders ORDER BY PathKey').all()).results.map((r) => r.FolderId);
  assert.deepEqual(ids, ['folder-1', 'folder-5', 'folder-6', 'folder-7']);
});

test('the trash job trashes queued files and keeps the ones that failed', async () => {
  const db = await seededD1();
  await db.exec("INSERT INTO DriveTrash (FileId) VALUES ('ok'), ('missing'), ('broken')");
  const { google, drive } = await connected(db);
  assert.equal(await emptyDriveTrash(db, drive), 2); // a file that is already gone counts as done
  assert.deepEqual(await trashQueue(db), ['broken']);
  assert.equal(google.calls.filter((c) => c.method === 'PATCH').length, 3);
});
