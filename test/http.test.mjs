import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testEnv, cookieFor } from './helpers/env.mjs';
import { createApp } from '../src/app.js';

const ADMIN = 'doruoora@gmail.com';
const TEACHER = 'teacher08@example.com'; // class 1
const SECTOR_ADMIN = 'teacher02@example.com'; // BQT ngành Ấu
const { app } = createApp();

// POST /api/<action> as `email`; returns [status, json].
async function call(env, email, action, body = {}) {
  const res = await app.request(`/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(email ? { Cookie: await cookieFor(env, email) } : {}) },
    body: JSON.stringify(body),
  }, env);
  return [res.status, await res.json(), res];
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const photo = async (env, email, method, id, body, query = '') => app.request(`/api/students/${id}/photo${query}`, { method, headers: { Cookie: await cookieFor(env, email) }, body }, env);

test('without a session every API call is 401', async () => {
  const env = await testEnv();
  const [status, json] = await call(env, null, 'getStudents');
  assert.deepEqual([status, json], [401, { status: 'error', message: 'Chưa đăng nhập.' }]);
});

test('getSession returns the scope without the auth version', async () => {
  const env = await testEnv();
  const [status, json] = await call(env, TEACHER, 'getSession');
  assert.equal(status, 200);
  assert.deepEqual(json.session, { userId: 13, email: TEACHER, fullName: json.session.fullName, saintName: json.session.saintName, tier: 'CLASS', classIds: [1], sectorGroupIds: [] });
});

test('a user whose groups changed is refused on the next call and the cookie is cleared', async () => {
  const env = await testEnv();
  const cookie = await cookieFor(env, TEACHER);
  await env.DB.prepare('UPDATE Users SET AuthVersion = AuthVersion + 1 WHERE Id = 13').run();
  const res = await app.request('/api/getStudents', { method: 'POST', headers: { Cookie: cookie } }, env);
  assert.equal(res.status, 401);
  assert.match(res.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('unknown actions are 404; actions above the tier of the user are 403', async () => {
  const env = await testEnv();
  assert.equal((await call(env, TEACHER, 'dropEverything'))[0], 404);
  assert.equal((await call(env, TEACHER, 'constructor'))[0], 404);
  for (const action of ['getDirectory', 'saveUser', 'saveConfig', 'saveHolidays', 'importStudents', 'startSchoolYear', 'importSheet', 'clearCache', 'saveClass', 'deleteClass', 'reorderClasses', 'saveGroup', 'deleteGroup']) {
    assert.equal((await call(env, TEACHER, action))[0], 403, action);
  }
  for (const action of ['getTeacherAttendance', 'saveTeacherAttendance', 'getTeacherAttendanceStats', 'searchTeachers', 'getTeacherAbsences']) {
    assert.equal((await call(env, TEACHER, action))[0], 403, action);
  }
});

test('a body that is not JSON is treated as empty, not as a crash', async () => {
  const env = await testEnv();
  const res = await app.request('/api/getClasses', { method: 'POST', headers: { Cookie: await cookieFor(env, TEACHER) }, body: '{oops' }, env);
  assert.equal(res.status, 200);
});

test('lists are served from KV and a save through the API shows at once', async () => {
  const env = await testEnv();
  assert.equal((await call(env, TEACHER, 'getStudents'))[1].students.length, 600);
  assert.equal((await call(env, TEACHER, 'getClasses'))[1].classes[0].name, 'Chiên Con');
  // a change behind the back of the API is not seen until the cache is rebuilt
  await env.DB.prepare("UPDATE Classes SET Name = 'Chiên Non' WHERE Id = 1").run();
  assert.equal((await call(env, TEACHER, 'getClasses'))[1].classes[0].name, 'Chiên Con');

  const [status, saved] = await call(env, TEACHER, 'saveStudent', { idNumber: '079399999999', fullName: 'Nguyễn Thị Mới', classId: '1', phones: ['0901'], siblingIds: [1] });
  assert.equal(status, 200);
  assert.deepEqual([saved.student.fullName, saved.student.siblingIds.includes(1), saved.affected.some((s) => s.id === 1)], ['Nguyễn Thị Mới', true, true]);
  assert.equal((await call(env, TEACHER, 'getStudents'))[1].students.length, 601);
  const classes = (await call(env, TEACHER, 'getClasses'))[1].classes;
  assert.deepEqual([classes[0].size, classes[0].name], [51, 'Chiên Non']);

  await env.DB.prepare("UPDATE Classes SET Name = 'Chiên Con' WHERE Id = 1").run();
  assert.equal((await call(env, ADMIN, 'clearCache'))[0], 200);
  assert.equal((await call(env, TEACHER, 'getClasses'))[1].classes[0].name, 'Chiên Con');
});

test('errors of the data layer keep their status and message', async () => {
  const env = await testEnv();
  const [status, json] = await call(env, TEACHER, 'saveStudent', { idNumber: '079399999999', fullName: 'X', classId: 2 });
  assert.deepEqual([status, json.status, json.message], [403, 'error', 'Lớp không nằm trong phạm vi của bạn.']);
  assert.equal((await call(env, TEACHER, 'saveStudent', { idNumber: '1', fullName: 'X', classId: 'abc' }))[0], 400);
});

test('attendance and scores go through with the scope of the session', async () => {
  const env = await testEnv();
  const marks = { SUNDAY_MASS: 1, CATECHISM: 1, ADORATION: 1, THURSDAY_MASS: 1 };
  assert.equal((await call(env, TEACHER, 'saveStudentAttendance', { classId: 1, weekOf: '2026-10-11', records: [{ studentId: 1, marks }] }))[0], 200);
  assert.equal((await call(env, TEACHER, 'saveStudentAttendance', { classId: 2, weekOf: '2026-10-11', records: [] }))[0], 403);
  const week = (await call(env, SECTOR_ADMIN, 'getStudentAttendance', { classId: 1, weekOf: '2026-10-11' }))[1];
  assert.deepEqual(week.records.find((r) => r.studentId === 1).marks, marks);
  assert.equal((await call(env, TEACHER, 'saveScores', { classId: 1, scores: [{ studentId: 1, quizS1: 11 }] }))[1].message, 'Điểm phải từ 0 đến 10');
  assert.equal((await call(env, TEACHER, 'getScores', { classId: 2 }))[1].scores.length, 50);
  assert.equal((await call(env, TEACHER, 'getAttendanceOverview', { period: 'YEAR' }))[1].classes.length, 12);
  assert.equal(typeof (await call(env, TEACHER, 'getStudentAttendanceStats', { classId: 1 }))[1].maxTotal, 'number');
  assert.equal((await call(env, TEACHER, 'getStudentAbsences', { studentId: 1 }))[1].student.id, 1);
  assert.equal((await call(env, TEACHER, 'getStudentRecord', { studentId: 51 }))[1].history.length, 1);
});

test('the whole-parish report needs BQT ngành; a class report is open', async () => {
  const env = await testEnv();
  assert.equal((await call(env, TEACHER, 'getClassReport', { classId: 2 }))[1].rows.length, 50);
  assert.equal((await call(env, TEACHER, 'getClassReport', {}))[0], 403);
  assert.equal((await call(env, SECTOR_ADMIN, 'getClassReport', {}))[1].rows.length, 600);
});

test('teacher attendance: own sectors only, and emails for Xứ đoàn only', async () => {
  const env = await testEnv();
  const sector = await env.DB.prepare("SELECT Id FROM Groups WHERE Name = 'Ngành Ấu'").first('Id');
  const other = await env.DB.prepare("SELECT Id FROM Groups WHERE Name = 'Ngành Thiếu'").first('Id');
  const [status, mine] = await call(env, SECTOR_ADMIN, 'getTeacherAttendance', { sectorGroupId: sector, weekOf: '2026-10-11' });
  assert.equal(status, 200);
  assert.equal(mine.teachers.length, 12);
  assert.ok(mine.teachers.every((t) => !('email' in t)));
  assert.equal((await call(env, SECTOR_ADMIN, 'getTeacherAttendance', { sectorGroupId: other, weekOf: '2026-10-11' }))[0], 403);
  assert.equal((await call(env, SECTOR_ADMIN, 'getTeacherAttendance', { sectorGroupId: 'ADMIN', weekOf: '2026-10-11' }))[0], 403);
  assert.equal((await call(env, SECTOR_ADMIN, 'saveTeacherAttendance', { sectorGroupId: other, weekOf: '2026-10-11', records: [] }))[0], 403);
  assert.equal((await call(env, SECTOR_ADMIN, 'getTeacherAttendanceStats', { sectorGroupId: other }))[0], 403);

  const all = (await call(env, ADMIN, 'getTeacherAttendance', { sectorGroupId: sector, weekOf: '2026-10-11' }))[1];
  assert.ok(all.teachers.every((t) => t.email));
  assert.equal((await call(env, ADMIN, 'getTeacherAttendance', { sectorGroupId: 'ADMIN', weekOf: '2026-10-11' }))[1].teachers.length, 5);
  assert.equal((await call(env, SECTOR_ADMIN, 'getTeacherAttendanceStats', { sectorGroupId: sector, classId: '2' }))[1].stats.length, 4);
  assert.deepEqual((await call(env, SECTOR_ADMIN, 'searchTeachers', { query: 'không có ai' }))[1].teachers, []);
});

test('admin actions refresh what they change', async () => {
  const env = await testEnv();
  const directory = (await call(env, ADMIN, 'getDirectory'))[1];
  assert.deepEqual([directory.users.length, directory.groups.length, directory.memberships.length], [60, 23, 60]);
  const [, saved] = await call(env, ADMIN, 'saveUser', { user: { email: 'new@example.com', fullName: 'Lê Thị Hoa' }, groupIds: [2] });
  assert.equal(saved.user.email, 'new@example.com');
  assert.equal((await call(env, ADMIN, 'getDirectory'))[1].users.length, 61);

  await call(env, ADMIN, 'getConfig');
  const config = (await call(env, ADMIN, 'saveConfig', { config: [{ key: 'CurrentSchoolYear', value: '2026-2027' }, { key: 'AttendanceStartDate', value: '2026-09-13' }] }))[1].config;
  assert.equal(config.length, 2);
  assert.deepEqual((await call(env, TEACHER, 'getConfig'))[1].config, config);

  await call(env, ADMIN, 'getHolidays');
  await call(env, ADMIN, 'saveHolidays', { holidays: [{ weekOf: '2026-10-04', session: 'CATECHISM', reason: 'Trung thu' }] });
  assert.deepEqual((await call(env, TEACHER, 'getHolidays'))[1].holidays, [{ weekOf: '2026-10-04', session: 'CATECHISM', reason: 'Trung thu' }]);
  assert.deepEqual((await call(env, TEACHER, 'getYearOptions'))[1].years, ['2025-2026', '2026-2027']);
  assert.equal((await call(env, TEACHER, 'getGroups'))[1].groups.length, 23);
});

test('the import is one request and refreshes the student list', async () => {
  const env = await testEnv();
  await call(env, ADMIN, 'getStudents');
  const [status, json] = await call(env, ADMIN, 'importStudents', { classId: 1, students: [{ idNumber: '079377777777', fullName: 'Lê Văn Mới' }, { idNumber: '', fullName: 'Bỏ qua' }] });
  assert.deepEqual([status, json.count], [200, 1]);
  assert.equal((await call(env, ADMIN, 'getStudents'))[1].students.length, 601);
});

test('the rollover answers with the new year and rebuilds every list', async () => {
  const env = await testEnv();
  await call(env, ADMIN, 'getConfig');
  await call(env, ADMIN, 'getStudents');
  const [status, json] = await call(env, ADMIN, 'startSchoolYear', { attendanceStartDate: '2027-09-05' });
  assert.deepEqual([status, json.newYear], [200, '2027-2028']);
  const config = Object.fromEntries((await call(env, TEACHER, 'getConfig'))[1].config.map((c) => [c.key, c.value]));
  assert.equal(config.CurrentSchoolYear, '2027-2028');
  assert.equal((await call(env, TEACHER, 'getStudents'))[1].students.find((s) => s.id === 1).classId, 2);
  assert.deepEqual((await call(env, TEACHER, 'getYearOptions'))[1].years, ['2025-2026', '2026-2027', '2027-2028']);
});

test('lessons: read by anyone, saved within scope, upload link needs a connected Drive', async () => {
  const env = await testEnv();
  assert.equal((await call(env, TEACHER, 'getLessons'))[1].lessons.length, 36);
  const [status, json] = await call(env, TEACHER, 'saveLesson', { weekOf: '2026-10-11', classId: 1, content: 'Bài 6', planFiles: [{ url: 'https://example.com/a', name: 'a', type: 'LINK' }] });
  assert.deepEqual([status, json.lesson.location, json.lesson.planFiles.length], [200, 'Trong lớp', 1]);
  assert.equal((await call(env, TEACHER, 'saveLesson', { weekOf: '2026-10-11', classId: 2, content: 'x' }))[0], 403);
  const [code, error] = await call(env, TEACHER, 'createUploadUrls', { weekOf: '2026-10-11', classId: 1, files: [{ slot: 'PLAN', filename: 'a.pdf' }] });
  assert.equal(code, 409);
  assert.match(error.message, /Google Drive chưa được kết nối/);
});

test('photos: an admin uploads, everyone signed in views and downloads, an admin removes', async () => {
  const env = await testEnv();
  assert.equal((await photo(env, TEACHER, 'GET', 1)).status, 404);
  assert.equal((await photo(env, TEACHER, 'PUT', 1, JPEG)).status, 403);
  assert.equal((await photo(env, TEACHER, 'DELETE', 1)).status, 403);

  const put = await photo(env, ADMIN, 'PUT', 1, JPEG);
  const { photoVersion } = await put.json();
  assert.equal(put.status, 200);
  assert.ok(photoVersion > 0);
  const listed = (await call(env, TEACHER, 'getStudents'))[1].students.find((s) => s.id === 1);
  assert.deepEqual([listed.hasPhoto, listed.photoVersion], [true, photoVersion]);

  const get = await photo(env, TEACHER, 'GET', 1, undefined, `?v=${photoVersion}`);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Content-Type'), 'image/jpeg');
  assert.match(get.headers.get('Cache-Control'), /private/);
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), JPEG);
  const download = await photo(env, TEACHER, 'GET', 1, undefined, '?download=1');
  assert.match(download.headers.get('Content-Disposition'), /^attachment; filename="079300000001\.jpg"; filename\*=UTF-8''079300000001_/);

  // replacing gives a new version, so the address changes
  const again = await (await photo(env, ADMIN, 'PUT', 1, JPEG)).json();
  assert.ok(again.photoVersion > photoVersion);

  assert.equal((await photo(env, ADMIN, 'DELETE', 1)).status, 200);
  assert.equal((await photo(env, TEACHER, 'GET', 1)).status, 404);
  assert.equal(env.PHOTOS.has('students/1'), false);
  assert.equal((await call(env, TEACHER, 'getStudents'))[1].students.find((s) => s.id === 1).hasPhoto, false);
});

test('photos live in D1 without the R2 binding; after a switch to R2 the old ones stay readable and new ones go to R2', async () => {
  const env = await testEnv();
  const r2 = env.PHOTOS;
  delete env.PHOTOS;
  const stored = () => env.DB.prepare('SELECT COUNT(*) AS n FROM StudentPhotos').first('n');

  assert.equal((await photo(env, ADMIN, 'PUT', 1, JPEG)).status, 200);
  assert.equal((await photo(env, ADMIN, 'PUT', 2, JPEG)).status, 200);
  assert.equal(await stored(), 2);
  const get = await photo(env, TEACHER, 'GET', 1);
  assert.deepEqual([get.status, get.headers.get('Content-Type')], [200, 'image/jpeg']);
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), JPEG);
  assert.equal((await photo(env, ADMIN, 'PUT', 1, JPEG)).status, 200); // replace keeps one row
  assert.equal(await stored(), 2);

  env.PHOTOS = r2; // the switch
  assert.deepEqual(new Uint8Array(await (await photo(env, TEACHER, 'GET', 2)).arrayBuffer()), JPEG);
  assert.equal((await photo(env, ADMIN, 'PUT', 1, JPEG)).status, 200);
  assert.deepEqual([r2.has('students/1'), await stored()], [true, 1]);
  assert.equal((await photo(env, TEACHER, 'GET', 1)).status, 200);
  assert.equal((await photo(env, ADMIN, 'DELETE', 2)).status, 200);
  assert.equal((await photo(env, ADMIN, 'DELETE', 1)).status, 200);
  assert.deepEqual([r2.has('students/1'), await stored()], [false, 0]);
  assert.equal((await photo(env, TEACHER, 'GET', 2)).status, 404);
});

test('photos: only JPEG or PNG up to 2 MB reach the bucket', async () => {
  const env = await testEnv();
  assert.equal((await photo(env, ADMIN, 'PUT', 1, new TextEncoder().encode('<svg onload=alert(1)>'))).status, 400);
  assert.equal((await photo(env, ADMIN, 'PUT', 1, new Uint8Array(0))).status, 400);
  const big = new Uint8Array(2 * 1024 * 1024 + 1);
  big.set(JPEG);
  assert.equal((await photo(env, ADMIN, 'PUT', 1, big)).status, 413);
  assert.equal((await photo(env, ADMIN, 'PUT', 9999, JPEG)).status, 404);
  assert.equal((await photo(env, ADMIN, 'PUT', 'abc', JPEG)).status, 404);
  assert.equal(env.PHOTOS.has('students/1'), false);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal((await photo(env, ADMIN, 'PUT', 1, png)).status, 200);
  assert.equal((await photo(env, TEACHER, 'GET', 1)).headers.get('Content-Type'), 'image/png');
});
