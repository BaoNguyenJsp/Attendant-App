// End-to-end check of a running `wrangler dev` with the demo data (workerd + local D1, KV, R2).
//   node scripts/smoke.mjs [base-url]
// Signs a session for the demo admin with SESSION_SECRET from .dev.vars; nothing leaves this machine.
// The last check runs the year rollover: load the demo data again afterwards (npm run db:local).
import { readFileSync } from 'node:fs';
import { makeSessionCookie } from '../src/session.js';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
// The secret the running Worker uses: SESSION_SECRET of the environment (when dev was started with --var), else .dev.vars.
const fromFile = () => readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '');
const secret = process.env.SESSION_SECRET || fromFile();
if (!secret) throw new Error('SESSION_SECRET is empty: fill it in .dev.vars, or start dev with --var SESSION_SECRET:<value> and set the same value in the environment');

// Sessions as loadSession would build them for the demo data.
const session = (userId, email, tier, classIds, sectorGroupIds) => ({ userId, email, fullName: 'Smoke', saintName: null, tier, classIds, sectorGroupIds, authVersion: 1 });
const cookieOf = async (s) => (await makeSessionCookie(s, secret)).split(';')[0];
const ADMIN = await cookieOf(session(1, 'doruoora@gmail.com', 'ADMIN', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [1, 3, 7, 11, 15]));
const TEACHER = await cookieOf(session(13, 'teacher08@example.com', 'CLASS', [1], []));

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
}
async function call(cookie, action, body = {}) {
  const res = await fetch(`${BASE}/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}
// Expects 200 and returns the body.
async function ok(name, cookie, action, body, test = () => true) {
  const { status, json } = await call(cookie, action, body);
  check(name, status === 200 && test(json), `HTTP ${status} ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}
async function refused(name, cookie, action, body, expected) {
  const { status, json } = await call(cookie, action, body);
  check(name, status === expected, `HTTP ${status} ${JSON.stringify(json).slice(0, 200)}`);
}

/* ---------- pages ---------- */
for (const path of ['/', '/login/', '/lessons/', '/attendance/', '/academics/', '/students/', '/teachers/', '/admin/', '/shared/common.js', '/attendance/face-scan.js', '/logo.png']) {
  const res = await fetch(BASE + path);
  check(`page ${path}`, res.status === 200, `HTTP ${res.status}`);
}
for (const path of ['/giangday/', '/diemdanh/', '/hocba/', '/hocsinh/', '/giaovien/', '/package.json', '/api/getStudents']) {
  const res = await fetch(BASE + path);
  check(`gone or closed ${path}`, res.status === 404 || res.status === 401, `HTTP ${res.status}`);
}

/* ---------- session and lists ---------- */
await refused('API without a session is 401', null, 'getStudents', {}, 401);
await ok('getSession', TEACHER, 'getSession', {}, (j) => j.session.tier === 'CLASS');
const { students } = await ok('getStudents: 600 from KV/D1', TEACHER, 'getStudents', {}, (j) => j.students.length === 600);
await ok('getClasses: 12 with sizes', TEACHER, 'getClasses', {}, (j) => j.classes.length === 12 && j.classes[0].size === 50);
await ok('getGroups: 23', TEACHER, 'getGroups', {}, (j) => j.groups.length === 23);
const config = await ok('getConfig', TEACHER, 'getConfig', {}, (j) => j.config.some((c) => c.key === 'CurrentSchoolYear'));
await ok('getYearOptions', TEACHER, 'getYearOptions', {}, (j) => j.years.length === 2);
await ok('getHolidays', TEACHER, 'getHolidays', {}, (j) => j.holidays.length === 1);
await refused('getDirectory is closed to a teacher', TEACHER, 'getDirectory', {}, 403);
await ok('getDirectory for Xứ đoàn', ADMIN, 'getDirectory', {}, (j) => j.users.length === 60 && j.memberships.length === 60);

/* ---------- students ---------- */
const first = students.find((s) => s.classId === 1);
const created = await ok('saveStudent creates with phones and a sibling', TEACHER, 'saveStudent',
  { idNumber: '079399999999', fullName: 'Nguyễn Thị Khói', classId: 1, phones: ['0901', '0902'], siblingIds: [first.id] },
  (j) => j.student.phones.length === 2 && j.student.siblingIds.includes(first.id));
await refused('a CCCD in use is refused', TEACHER, 'saveStudent', { idNumber: "'79399999999", fullName: 'Trùng', classId: 1 }, 409);
await refused('a class out of scope is refused', TEACHER, 'saveStudent', { idNumber: '079399999998', fullName: 'Ngoài lớp', classId: 2 }, 403);
await ok('importStudents (one row updated, one skipped)', ADMIN, 'importStudents',
  { classId: 1, students: [{ idNumber: '079399999999', fullName: 'Nguyễn Thị Khói Mới', phones: [] }, { idNumber: '', fullName: 'Bỏ qua' }] }, (j) => j.count === 1);
await ok('the list shows the import and keeps the phones', TEACHER, 'getStudents', {},
  (j) => j.students.length === 601 && j.students.find((s) => s.id === created.student.id).phones.length === 2);

/* ---------- photos (R2) ---------- */
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 64 }, (_, i) => i)]);
const photoUrl = `${BASE}/api/students/${first.id}/photo`;
const put = await fetch(photoUrl, { method: 'PUT', headers: { Cookie: ADMIN }, body: jpeg });
check('photo upload by Xứ đoàn', put.status === 200, `HTTP ${put.status}`);
check('photo upload refused for a teacher', (await fetch(photoUrl, { method: 'PUT', headers: { Cookie: TEACHER }, body: jpeg })).status === 403);
const got = await fetch(photoUrl, { headers: { Cookie: TEACHER } });
const bytes = new Uint8Array(await got.arrayBuffer());
check('photo comes back byte for byte', got.status === 200 && bytes.length === jpeg.length && bytes.every((b, i) => b === jpeg[i]), `HTTP ${got.status}, ${bytes.length} bytes`);
check('photo removed', (await fetch(photoUrl, { method: 'DELETE', headers: { Cookie: ADMIN } })).status === 200);
check('photo gone', (await fetch(photoUrl, { headers: { Cookie: TEACHER } })).status === 404);

/* ---------- attendance ---------- */
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const day = new Date(`${today}T00:00:00Z`);
const weekOf = new Date(day.getTime() - day.getUTCDay() * 86400000).toISOString().slice(0, 10);
const marks = { SUNDAY_MASS: 1, CATECHISM: 2, ADORATION: 0, THURSDAY_MASS: 1 };
await ok('saveStudentAttendance (changed row)', TEACHER, 'saveStudentAttendance', { classId: 1, weekOf, records: [{ studentId: first.id, marks }] });
await ok('getStudentAttendance returns it', TEACHER, 'getStudentAttendance', { classId: 1, weekOf }, (j) => JSON.stringify(j.records.find((r) => r.studentId === first.id)?.marks) === JSON.stringify(marks));
await ok('an all-unmarked row is deleted', TEACHER, 'saveStudentAttendance', { classId: 1, weekOf, records: [{ studentId: first.id, marks: {} }] });
await ok('… and no longer returned', TEACHER, 'getStudentAttendance', { classId: 1, weekOf }, (j) => !j.records.some((r) => r.studentId === first.id));
await refused('a non-Sunday is refused', TEACHER, 'saveStudentAttendance', { classId: 1, weekOf: '2026-09-07', records: [] }, 400);
await ok('getStudentAttendanceStats', TEACHER, 'getStudentAttendanceStats', { classId: 1 }, (j) => j.maxTotal > 0);
await ok('getAttendanceOverview (grouped query)', TEACHER, 'getAttendanceOverview', { period: 'YEAR' }, (j) => j.classes.length === 12 && j.totalStudents === 601);
await ok('getAttendanceOverview by month', TEACHER, 'getAttendanceOverview', { period: 'MONTH', value: 9 }, (j) => j.classes.length === 12);
await ok('getStudentAbsences', TEACHER, 'getStudentAbsences', { studentId: first.id }, (j) => Array.isArray(j.absences));

/* ---------- teachers ---------- */
const roster = await ok('getTeacherAttendance for a sector', ADMIN, 'getTeacherAttendance', { sectorGroupId: 3, weekOf }, (j) => j.teachers.length === 12 && j.teachers[0].email);
const teacherId = roster.teachers[0].userId;
await ok('saveTeacherAttendance', ADMIN, 'saveTeacherAttendance', { sectorGroupId: 3, weekOf, records: [{ userId: teacherId, marks: { TEACHER_MEETING: 1 } }] });
await ok('getTeacherAttendanceStats', ADMIN, 'getTeacherAttendanceStats', { sectorGroupId: 3 }, (j) => j.stats.length === 12);
await ok('the Xứ đoàn list', ADMIN, 'getTeacherAttendance', { sectorGroupId: 'ADMIN', weekOf }, (j) => j.teachers.length === 5);
await ok('searchTeachers (exact)', ADMIN, 'searchTeachers', { query: roster.teachers[0].fullName }, (j) => j.teachers.some((t) => t.userId === teacherId));
await ok('getTeacherAbsences', ADMIN, 'getTeacherAbsences', { userId: teacherId }, (j) => j.teacher.userId === teacherId);
await refused('teacher screens are closed to a class teacher', TEACHER, 'getTeacherAttendance', { sectorGroupId: 3, weekOf }, 403);

/* ---------- academics ---------- */
await ok('saveScores keeps 0 and blank apart', TEACHER, 'saveScores', { classId: 1, scores: [{ studentId: first.id, quizS1: 0, examS1: '7,5', quizS2: '', examS2: null }] });
await ok('getScores', TEACHER, 'getScores', { classId: 1 }, (j) => { const s = j.scores.find((x) => x.studentId === first.id); return s.quizS1 === 0 && s.examS1 === 7.5 && s.quizS2 === null; });
await refused('a score of 11 is refused', TEACHER, 'saveScores', { classId: 1, scores: [{ studentId: first.id, quizS1: 11 }] }, 400);
await ok('getClassReport (live)', TEACHER, 'getClassReport', { classId: 1 }, (j) => j.rows.length === 51 && j.rows.find((r) => r.studentId === first.id).semester1Avg === 5);
await ok('getClassReport (archive)', TEACHER, 'getClassReport', { classId: 2, schoolYear: '2025-2026' }, (j) => j.rows.length === 50);
await refused('the whole-parish report is closed to a class teacher', TEACHER, 'getClassReport', {}, 403);
await ok('getStudentRecord', TEACHER, 'getStudentRecord', { studentId: 51 }, (j) => j.history.length === 1 && j.current !== null);

/* ---------- lessons ---------- */
await ok('getLessons', TEACHER, 'getLessons', {}, (j) => j.lessons.length >= 36);
const link = { url: 'https://example.com/a,b', name: 'Tài liệu, có dấu phẩy.pdf', type: 'LINK' };
await ok('saveLesson with a link holding a comma', TEACHER, 'saveLesson', { weekOf, classId: 1, content: 'Bài kiểm tra khói', planFiles: [link], revisedFiles: [] },
  (j) => j.lesson.planFiles[0].url === link.url && j.lesson.location === 'Trong lớp');
await refused('an upload link needs a connected Drive', TEACHER, 'createUploadUrl', { weekOf, classId: 1, slot: 'PLAN', filename: 'a.pdf' }, 409);

/* ---------- admin ---------- */
const saved = await ok('saveUser with groups', ADMIN, 'saveUser', { user: { email: 'smoke@example.com', fullName: 'Lê Thị Khói' }, groupIds: [2] }, (j) => j.user.id > 60);
await refused('a taken email is refused', ADMIN, 'saveUser', { user: { email: 'SMOKE@example.com', fullName: 'X' }, groupIds: [] }, 409);
await ok('saveUser again (name only)', ADMIN, 'saveUser', { user: { ...saved.user, fullName: 'Lê Thị Khói Mới' }, groupIds: [2] }, (j) => j.user.firstName === 'Mới');
await ok('saveHolidays', ADMIN, 'saveHolidays', { holidays: [{ weekOf: '2026-09-27', session: 'THURSDAY_MASS', reason: 'Nghỉ lễ' }, { weekOf, session: 'TEACHER_MEETING', reason: 'Khói' }] }, (j) => j.holidays.length === 2);
await ok('saveConfig adds and keeps', ADMIN, 'saveConfig', { config: [...config.config, { key: 'SmokeKey', value: '1' }] }, (j) => j.config.some((c) => c.key === 'SmokeKey'));
await ok('saveConfig deletes', ADMIN, 'saveConfig', { config: config.config }, (j) => !j.config.some((c) => c.key === 'SmokeKey'));
await ok('clearCache rebuilds every list', ADMIN, 'clearCache', {});
await ok('lists after the rebuild', TEACHER, 'getStudents', {}, (j) => j.students.length === 601);

/* ---------- year rollover: the largest batch, on the D1 engine ---------- */
await refused('a rollover without a date is refused', ADMIN, 'startSchoolYear', {}, 400);
await ok('startSchoolYear', ADMIN, 'startSchoolYear', { attendanceStartDate: '2027-09-05' }, (j) => j.newYear === '2027-2028');
await ok('after the rollover: students moved up in place', TEACHER, 'getStudents', {}, (j) => j.students.length === 601 && j.students.find((s) => s.id === first.id).classId === 2);
await ok('after the rollover: the old year is in the archive', TEACHER, 'getClassReport', { classId: 1, schoolYear: '2026-2027' }, (j) => j.rows.length === 51);
await ok('after the rollover: the year moved', TEACHER, 'getYearOptions', {}, (j) => j.years.at(-1) === '2027-2028');

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed. Run `npm run db:local` to load the demo data again.');
process.exit(failed ? 1 : 0);
