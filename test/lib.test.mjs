import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMark, parseScore, yearResult, attendanceRating, TIER_RANK } from '../src/lib/codes.js';
import {
  idKey, firstName, splitPhones, joinPhones, searchKey, matchesStudent, matchesTeacher,
  isDate, toSunday, upcomingSunday, sundaysBetween,
} from '../src/lib/text.js';
import { cached, refresh, rebuildAll } from '../src/lib/cache.js';
import { createKV } from './helpers/kv.mjs';

test('isMark accepts only the integers 0 to 3', () => {
  assert.deepEqual([0, 1, 2, 3, 4, -1, 1.5, '1', null].map(isMark), [true, true, true, true, false, false, false, false, false]);
});

test('parseScore: blank is null, 0 is kept, outside 0-10 is invalid', () => {
  assert.equal(parseScore(''), null);
  assert.equal(parseScore('  '), null);
  assert.equal(parseScore(null), null);
  assert.equal(parseScore(undefined), null);
  assert.equal(parseScore(0), 0);
  assert.equal(parseScore('0'), 0);
  assert.equal(parseScore('7,5'), 7.5);
  assert.equal(parseScore(10), 10);
  assert.equal(parseScore(10.5), undefined);
  assert.equal(parseScore(-1), undefined);
  assert.equal(parseScore('abc'), undefined);
  // values that Number() would silently turn into a score
  assert.equal(parseScore(true), undefined);
  assert.equal(parseScore([]), undefined);
  assert.equal(parseScore(NaN), undefined);
  assert.equal(parseScore(Infinity), undefined);
});

test('yearResult follows the formulas of section 6.5', () => {
  assert.deepEqual(yearResult({ quizS1: 8, examS1: 9, quizS2: 7, examS2: 8 }), { semester1Avg: 8.7, semester2Avg: 7.7, yearAvg: 8, rating: 'EXCELLENT' });
  // one semester only: the year average is that semester
  assert.deepEqual(yearResult({ quizS1: 6, examS1: 7, quizS2: null, examS2: null }), { semester1Avg: 6.7, semester2Avg: null, yearAvg: 6.7, rating: 'GOOD' });
  // a semester needs both scores
  assert.deepEqual(yearResult({ quizS1: 6, examS1: null, quizS2: null, examS2: null }), { semester1Avg: null, semester2Avg: null, yearAvg: null, rating: null });
  // 0 is a score and enters the average
  assert.deepEqual(yearResult({ quizS1: 0, examS1: 0, quizS2: null, examS2: null }), { semester1Avg: 0, semester2Avg: null, yearAvg: 0, rating: 'AVERAGE' });
});

test('attendanceRating thresholds', () => {
  assert.deepEqual([80, 79, 65, 64, 50, 49].map(attendanceRating), ['EXCELLENT', 'GOOD', 'GOOD', 'FAIR', 'FAIR', 'NEEDS_WORK']);
});

test('TIER_RANK orders the four group types', () => {
  assert.ok(TIER_RANK.CLASS < TIER_RANK.SECTOR && TIER_RANK.SECTOR < TIER_RANK.SECTOR_ADMIN && TIER_RANK.SECTOR_ADMIN < TIER_RANK.ADMIN);
});

test('idKey ignores a leading quote and leading zeros', () => {
  assert.equal(idKey("'079300000001"), '79300000001');
  assert.equal(idKey(' 079300000001 '), '79300000001');
  assert.equal(idKey(79300000001), '79300000001');
  assert.equal(idKey(''), '');
  assert.equal(idKey(null), '');
});

test('firstName is the last word', () => {
  assert.equal(firstName('  Nguyễn Thị  An '), 'An');
  assert.equal(firstName(''), '');
});

test('phones: split, trim, drop empties, join with " / "', () => {
  assert.deepEqual(splitPhones('0901234567/ 0912345678 /'), ['0901234567', '0912345678']);
  assert.deepEqual(splitPhones(['0901234567', ' ']), ['0901234567']);
  assert.equal(joinPhones('0901234567/0912345678'), '0901234567 / 0912345678');
  assert.equal(joinPhones(''), null);
  assert.equal(joinPhones(' / '), null);
  assert.equal(joinPhones(null), null);
});

test('searchKey ignores case, end spaces and accent encoding, nothing else', () => {
  assert.equal(searchKey('  NGUYỄN Thị An '), 'nguyễn thị an');
  assert.equal(searchKey('Nguyễn'.normalize('NFD')), searchKey('Nguyễn'.normalize('NFC')));
  assert.notEqual(searchKey('Nguyen'), searchKey('Nguyễn'));
});

test('matchesStudent: exact full name, saint + full name, or CCCD', () => {
  const s = { fullName: 'Nguyễn Thị An', saintName: 'Maria', idKey: '79300000001' };
  assert.equal(matchesStudent(s, 'nguyễn thị an'), true);
  assert.equal(matchesStudent(s, 'Maria Nguyễn Thị An'), true);
  assert.equal(matchesStudent(s, '079300000001'), true);
  assert.equal(matchesStudent(s, "'79300000001"), true);
  assert.equal(matchesStudent(s, 'An'), false);
  assert.equal(matchesStudent(s, 'Nguyễn Thị'), false);
  assert.equal(matchesStudent(s, 'Nguyen Thi An'), false);
  assert.equal(matchesStudent(s, '7930000000'), false);
  assert.equal(matchesStudent(s, ''), false);
  assert.equal(matchesStudent({ fullName: 'A', saintName: null, idKey: '' }, '0'), false);
});

test('matchesTeacher: email only when allowed', () => {
  const u = { fullName: 'Trần Văn Bình', saintName: 'Giuse', email: 'binh@example.com' };
  assert.equal(matchesTeacher(u, 'trần văn bình'), true);
  assert.equal(matchesTeacher(u, 'Giuse Trần Văn Bình'), true);
  assert.equal(matchesTeacher(u, 'Bình'), false);
  assert.equal(matchesTeacher(u, 'BINH@example.com'), false);
  assert.equal(matchesTeacher(u, 'BINH@example.com', { byEmail: true }), true);
});

test('isDate accepts only real YYYY-MM-DD dates', () => {
  assert.deepEqual(['2026-09-06', '2026-02-30', '2026-9-6', '', 'abc'].map(isDate), [true, false, false, false, false]);
});

test('toSunday moves back; upcomingSunday moves forward; a Sunday stays', () => {
  assert.equal(toSunday('2026-09-06'), '2026-09-06');
  assert.equal(toSunday('2026-09-09'), '2026-09-06');
  assert.equal(toSunday('2026-09-12'), '2026-09-06');
  assert.equal(upcomingSunday('2026-09-06'), '2026-09-06');
  assert.equal(upcomingSunday('2026-09-07'), '2026-09-13');
  assert.equal(toSunday('2027-01-01'), '2026-12-27');
  // callers check isDate first; a bad date must fail loudly, not become some other week
  assert.throws(() => toSunday('abc'), RangeError);
});

test('sundaysBetween includes both ends', () => {
  assert.deepEqual(sundaysBetween('2026-09-06', '2026-09-20'), ['2026-09-06', '2026-09-13', '2026-09-20']);
  assert.deepEqual(sundaysBetween('2026-09-07', '2026-09-19'), ['2026-09-13']);
  assert.deepEqual(sundaysBetween('2026-09-07', '2026-09-12'), []);
});

test('cached loads once, then serves from KV', async () => {
  const kv = createKV();
  let loads = 0;
  const load = async () => { loads += 1; return [{ id: 1 }]; };
  assert.deepEqual(await cached(kv, 'classes', load), [{ id: 1 }]);
  assert.deepEqual(await cached(kv, 'classes', load), [{ id: 1 }]);
  assert.equal(loads, 1);
});

test('cached keeps an empty list as a hit', async () => {
  const kv = createKV();
  let loads = 0;
  const load = async () => { loads += 1; return []; };
  await cached(kv, 'holidays', load);
  await cached(kv, 'holidays', load);
  assert.equal(loads, 1);
});

test('refresh overwrites the cached value', async () => {
  const kv = createKV();
  await cached(kv, 'classes', async () => ['old']);
  await refresh(kv, 'classes', async () => ['new']);
  assert.deepEqual(await cached(kv, 'classes', async () => ['never']), ['new']);
});

test('rebuildAll drops stale keys and rebuilds every list', async () => {
  const kv = createKV();
  await cached(kv, 'stale', async () => 1);
  await kv.put('other', 'kept');
  await rebuildAll(kv, { classes: async () => ['a'], config: async () => ({ k: 'v' }) });
  assert.equal(await kv.get('cache:stale'), null);
  assert.equal(await kv.get('other'), 'kept');
  assert.deepEqual(await kv.get('cache:classes', 'json'), ['a']);
  assert.deepEqual(await kv.get('cache:config', 'json'), { k: 'v' });
});
