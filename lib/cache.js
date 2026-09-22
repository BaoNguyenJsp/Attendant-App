'use strict';

// Bộ nhớ đệm in-memory cho dữ liệu đọc từ Apps Script (bounded cardinality).
// Chỉ cache các read action có số lượng key hữu hạn — KHÔNG cache tra cứu theo
// từng thiếu nhi (getAcademicRecord, searchByIdNumber) hay getUploadUrl (đổi origin/filename).
const TTL_MS = 30 * 60 * 1000;

const CACHEABLE_ACTIONS = new Set([
  'getStudents', 'getClasses', 'getHolidays', 'getTeachers', 'getConfig', 'getYearOptions',
  'getScores', 'getTeaching', 'getAttendance', 'getClassAttendanceStats', 'getSummary',
  'getTeacherAttendance', 'getTeacherStats', 'getTeacherAbsences',
]);

// Write action -> danh sách cache key (theo action) cần xoá sau khi ghi thành công.
// getTeachers gộp users+groups+members nên mọi thay đổi nhóm đều xoá nó.
const CACHE_INVALIDATIONS = {
  saveStudent: ['getStudents'],
  importStudents: ['getStudents'],
  saveStudentOrder: ['getStudents'],
  saveClass: ['getClasses'],
  saveHolidays: ['getHolidays'],
  saveConfig: ['getConfig', 'getYearOptions'],
  startSchoolYear: ['getConfig', 'getYearOptions', 'getClasses', 'getStudents'],
  saveUsers: ['getTeachers'],
  saveUser: ['getTeachers'],
  saveGroups: ['getTeachers'],
  saveGroupMembers: ['getTeachers'],
  saveAttendance: ['getAttendance', 'getClassAttendanceStats', 'getSummary'],
  saveScores: ['getScores', 'getSummary'],
  saveTeaching: ['getTeaching'],
  saveTeacherAttendance: ['getTeacherAttendance', 'getTeacherStats'],
};

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

module.exports = { isCacheable, get, set, invalidate, clearAll, cacheKey, store };

/* ---------- Self-check ---------- */
if (require.main === module) {
  const assert = require('assert');

  // Key ổn định với thứ tự tham số khác nhau
  assert.strictEqual(
    cacheKey('getAttendance', { schoolYear: 'A', className: 'B' }),
    cacheKey('getAttendance', { className: 'B', schoolYear: 'A' })
  );
  // token/action không lọt vào key
  assert.strictEqual(cacheKey('getStudents', {}), 'getStudents|{}');

  set('getAttendance', { className: 'B', schoolYear: 'A' }, { records: [1] });
  assert.deepStrictEqual(get('getAttendance', { schoolYear: 'A', className: 'B' }), { records: [1] });

  set('getStudents', {}, { students: [1] });
  set('getSummary', { className: 'B' }, { summary: [] });
  invalidate('saveAttendance');
  assert.strictEqual(get('getStudents', {}).students.length, 1, 'other keys must survive');
  assert.strictEqual(get('getSummary', { className: 'B' }), null, 'related key invalidated');
  assert.strictEqual(get('getAttendance', { schoolYear: 'A', className: 'B' }), null);

  assert.strictEqual(isCacheable('getAcademicRecord'), false);
  assert.strictEqual(isCacheable('searchByIdNumber'), false);
  assert.strictEqual(isCacheable('getUploadUrl'), false);

  set('getStudents', {}, { students: [1] });
  clearAll();
  assert.strictEqual(store.size, 0, 'clearAll wipes the store');

  console.log('cache self-check OK');
}
