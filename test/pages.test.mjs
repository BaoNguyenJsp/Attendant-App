// Static checks of the pages: no browser, so only what can be read from the files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as server from '../src/lib/text.js';
import * as page from '../public/shared/search.js';
import { SESSION_LABEL, MARK_LABEL, TIER_LABEL, STUDENT_STATUS_LABEL, USER_STATUS_LABEL, GENDER_LABEL, RATING_LABEL, ATTENDANCE_RATING_LABEL, SLOT_LABEL } from '../public/shared/labels.js';
import * as codes from '../src/lib/codes.js';

// [html, script, ...more scripts of the page]. A page is added here by the task that migrates it.
const PAGES = [
  ['public/index.html', 'public/index.js'],
  ['public/login/index.html', 'public/login/login.js'],
  ['public/students/index.html', 'public/students/students.js'],
  ['public/attendance/index.html', 'public/attendance/attendance.js', 'public/attendance/face-scan.js'],
];
const SHARED = ['public/shared/common.js', 'public/shared/labels.js', 'public/shared/search.js', 'public/shared/ui.js'];
const read = (path) => readFileSync(path, 'utf8');

function parses(path) {
  const copy = join(mkdtempSync(join(tmpdir(), 'page-')), 'module.mjs');
  writeFileSync(copy, read(path));
  execFileSync(process.execPath, ['--check', copy], { stdio: 'pipe' });
}
const exportsOf = (source) => new Set([
  ...[...source.matchAll(/export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  ...[...source.matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean)),
]);
const importsOf = (source) => [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)]
  .map((m) => ({ from: m[2], names: m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean) }));

for (const script of [...SHARED, ...PAGES.flatMap(([, ...scripts]) => scripts)]) {
  test(`${script} parses and imports only names that exist`, () => {
    parses(script);
    for (const { from, names } of importsOf(read(script))) {
      const target = join(dirname(script), from);
      assert.ok(existsSync(target), `${script}: ${from} does not exist`);
      const exported = exportsOf(read(target));
      for (const name of names) assert.ok(exported.has(name), `${script}: ${from} does not export ${name}`);
    }
  });
}

for (const [html, ...scripts] of PAGES) {
  test(`${html} has every element its scripts look up, and loads its script`, () => {
    const markup = read(html);
    const sources = scripts.map(read).join('\n');
    const ids = new Set([...`${markup}\n${sources}`.matchAll(/id="([^"${]+)"/g)].map((m) => m[1]));
    for (const [, id] of sources.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(id), `${html}: no element with id "${id}"`);
    assert.match(markup, new RegExp(`<script type="module" src="${scripts[0].split('/').pop()}"`));
    assert.match(markup, /<div id="shell"><\/div>|class="gate"/);
  });
}

test('no migrated page links to an old route or calls an old action', () => {
  const old = /\/(giangday|diemdanh|hocba|hocsinh|giaovien)\/|getSessionUser|getTeachers|saveStudentFull|getTeaching|searchStudentById/;
  for (const path of [...SHARED, ...PAGES.flat()]) assert.doesNotMatch(read(path), old, path);
});

test('the page search rule gives the same answer as the server rule', () => {
  const student = { fullName: 'Nguyễn Thị An', saintName: 'Maria', idNumber: '079300000001' };
  const queries = ['nguyễn thị an', ' NGUYỄN THỊ AN ', 'Maria Nguyễn Thị An', 'Nguyễn Thị An'.normalize('NFD'), '079300000001', "'79300000001", '79300000001',
    'An', 'Nguyễn Thị', 'Nguyen Thi An', 'Maria', '7930000000', '', '0', "'"];
  for (const q of queries) {
    assert.equal(page.matchesStudent(student, q), server.matchesStudent({ ...student, idKey: server.idKey(student.idNumber) }, q), `query "${q}"`);
  }
  assert.equal(page.matchesStudent({ fullName: 'A', saintName: null, idNumber: '000' }, '0'), false);
  const user = { fullName: 'Trần Văn Bình', saintName: 'Giuse', email: 'binh@example.com' };
  for (const q of ['trần văn bình', 'Giuse Trần Văn Bình', 'Bình', 'BINH@example.com', '']) {
    for (const byEmail of [false, true]) assert.equal(page.matchesPerson(user, q, { byEmail }), server.matchesTeacher(user, q, { byEmail }), `query "${q}" byEmail ${byEmail}`);
  }
});

test('every code has a label', () => {
  const labelled = (map, keys) => assert.deepEqual(Object.keys(map).map(String).sort(), keys.map(String).sort());
  labelled(SESSION_LABEL, Object.keys(codes.TEACHER_SESSIONS));
  labelled(MARK_LABEL, Object.values(codes.MARK));
  labelled(TIER_LABEL, Object.keys(codes.TIER_RANK));
  labelled(STUDENT_STATUS_LABEL, codes.STUDENT_STATUSES);
  labelled(USER_STATUS_LABEL, codes.USER_STATUSES);
  labelled(GENDER_LABEL, codes.GENDERS);
  labelled(SLOT_LABEL, codes.FILE_SLOTS);
  labelled(RATING_LABEL, ['EXCELLENT', 'GOOD', 'AVERAGE']);
  labelled(ATTENDANCE_RATING_LABEL, ['EXCELLENT', 'GOOD', 'FAIR', 'NEEDS_WORK']);
});
