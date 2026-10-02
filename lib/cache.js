'use strict';

// Bộ nhớ đệm in-memory cho dữ liệu đọc từ Apps Script (bounded cardinality).
// Chỉ cache các read action có số lượng key hữu hạn — KHÔNG cache tra cứu theo
// từng thiếu nhi (getStudentRecord, searchStudentById) hay getUploadUrl (đổi origin/filename).
const TTL_MS = 30 * 60 * 1000;

const CACHEABLE_ACTIONS = new Set([
  'getStudents', 'getClasses', 'getHolidays', 'getTeachers', 'getConfig', 'getYearOptions',
  'getStudentScores', 'getTeaching', 'getStudentAttendance', 'getClassAttendanceStats', 'getClassReport',
  'getTeacherAttendance', 'getTeacherStats', 'getTeacherAbsences',
  'searchStudentById',
]);

// Write action -> danh sách cache key (theo action) cần xoá sau khi ghi thành công.
// getTeachers gộp users+groups+members nên mọi thay đổi nhóm đều xoá nó.
const CACHE_INVALIDATIONS = {
  saveStudentPhoto: ['getStudents', 'searchStudentById'],
  saveStudentFull: ['getStudents', 'searchStudentById'],
  importStudents: ['getStudents', 'searchStudentById'],
  saveClass: ['getClasses'],
  saveHolidays: ['getHolidays'],
  saveConfig: ['getConfig', 'getYearOptions'],
  startSchoolYear: ['getConfig', 'getYearOptions', 'getClasses', 'getStudents'],
  saveUsers: ['getTeachers'],
  saveUser: ['getTeachers'],
  saveGroups: ['getTeachers'],
  saveGroupMembers: ['getTeachers'],
  saveStudentAttendance: ['getStudentAttendance', 'getClassAttendanceStats', 'getClassReport', 'searchStudentById'],
  saveStudentScores: ['getStudentScores', 'getClassReport', 'searchStudentById'],
  saveTeaching: ['getTeaching'],
  saveTeacherAttendance: ['getTeacherAttendance', 'getTeacherStats'],
};

// Write action = action that mutates a sheet (và do đó xoá cache). Mọi action
// khác là đọc. Dùng để xếp hàng ghi: GAS tự khoá tuần tự nên ghi phải hạn chế
// chạy song song, còn đọc thì không.
const WRITE_ACTIONS = new Set(Object.keys(CACHE_INVALIDATIONS));
const isWrite = (action) => WRITE_ACTIONS.has(action);

const store = new Map();

// Key = action + params (đã sắp xếp) để {a,b} và {b,a} cho cùng một key.
function cacheKey(action, body) {
  const params = { ...(body || {}) };
  delete params.token;
  delete params.action;
  const keys = Object.keys(params).sort();
  return action + '|' + JSON.stringify(params, keys);
}

function isCacheable(action) {
  return CACHEABLE_ACTIONS.has(action);
}

function get(action, body) {
  const key = cacheKey(action, body);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

function set(action, body, data) {
  store.set(cacheKey(action, body), { data, ts: Date.now() });
}

function invalidate(action) {
  const targets = CACHE_INVALIDATIONS[action];
  if (!targets) return;
  for (const key of store.keys()) {
    if (targets.includes(key.slice(0, key.indexOf('|')))) store.delete(key);
  }
}

function clearAll() {
  store.clear();
}

module.exports = { isCacheable, isWrite, get, set, invalidate, clearAll, cacheKey, store };

/* ---------- Self-check ---------- */
if (require.main === module) {
  const assert = require('assert');

  // Key ổn định với thứ tự tham số khác nhau
  assert.strictEqual(
    cacheKey('getTeaching', { schoolYear: 'A', className: 'B' }),
    cacheKey('getTeaching', { className: 'B', schoolYear: 'A' })
  );
  // token/action không lọt vào key
  assert.strictEqual(cacheKey('getStudents', {}), 'getStudents|{}');

  set('getStudentAttendance', { className: 'B' }, { records: [1] });
  assert.deepStrictEqual(get('getStudentAttendance', { className: 'B' }), { records: [1] });

  set('getStudents', {}, { students: [1] });
  set('getClassReport', { className: 'B' }, { summary: [] });
  set('searchStudentById', { idNumber: 'X' }, { students: [] });
  invalidate('saveStudentAttendance');
  assert.strictEqual(get('getStudents', {}).students.length, 1, 'other keys must survive');
  assert.strictEqual(get('getClassReport', { className: 'B' }), null, 'related key invalidated');
  assert.strictEqual(get('getStudentAttendance', { className: 'B' }), null);
  assert.strictEqual(get('searchStudentById', { idNumber: 'X' }), null, 'searchStudentById invalidated by saveStudentAttendance');

  assert.strictEqual(isCacheable('getStudentRecord'), false);
  assert.strictEqual(isCacheable('searchStudentById'), true);
  assert.strictEqual(isCacheable('getUploadUrl'), false);

  set('getStudents', {}, { students: [1] });
  clearAll();
  assert.strictEqual(store.size, 0, 'clearAll wipes the store');

  console.log('cache self-check OK');
}
