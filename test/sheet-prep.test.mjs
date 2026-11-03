import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mapSheet } from '../src/lib/db/sheet-import.js';

vm.runInThisContext(readFileSync(new URL('../tools/sheet-prep/prep.js', import.meta.url), 'utf8'));
const P = globalThis.SheetPrep;
const F = 'input.xlsx';

test('helpers', () => {
  assert.equal(P.key('  Dự  Bị Trưởng 1 '), 'dự bị trưởng 1');
  assert.equal(P.toIsoDate(46278), '2026-09-13');
  assert.equal(P.toIsoDate('13/09/2026'), '2026-09-13');
  assert.equal(P.toIsoDate('2026-09-13'), '2026-09-13');
  assert.equal(P.toIsoDate('x'), '');
  assert.equal(P.previousSunday('2026-09-13'), '2026-09-13');
  assert.equal(P.previousSunday('2026-09-16'), '2026-09-13');
  assert.equal(P.comingSunday('2026-09-16'), '2026-09-20');
  assert.equal(P.comingSunday('2026-08-30'), '2026-08-30');
  assert.equal(P.titleCase('NGUYỄN phạm  phương uyên'), 'Nguyễn Phạm Phương Uyên');
  assert.equal(P.upper('Gặp gỡ 1: phúc'), 'GẶP GỠ 1: PHÚC');
  assert.equal(P.idKey("'079309036244"), P.idKey(79309036244));
  assert.equal(P.pick({ 'Tên Lớp': 'A' }, ['tên lớp']), 'A');
  assert.throws(() => P.requireColumns([{ Ngay: 1 }], 'f.xlsx', [['Ngay'], ['Buoi']]), /f.xlsx: thiếu cột Buoi/);
});

test('addTeachers', () => {
  const tabs = {
    Users: [
      { Email: 'a@x.com', SaintName: 'Teresa', FullName: 'Nguyễn Phạm Phương Uyên', Status: 'Hoạt động' },
      { Email: 'htnh07@gmail.com', SaintName: '', FullName: 'Cũ', Status: 'Hoạt động' },
    ],
    Students: [{ SaintName: 'Martino' }],
    Groups: [{ GroupName: 'Ấu 1', Type: 'Lớp', Scope: '' }, { GroupName: 'Ban Quản Trị', Type: 'Quản trị', Scope: '' }],
  };
  const report = P.newReport();
  P.addTeachers(tabs, [
    { ID: 1, HoTen: 'Teresa Nguyễn Phạm Phương Uyên', TenLop: 'Ban Quản Trị', _row: 2 },
    { ID: 2, HoTen: 'MARTINO nguyễn thành công', TenLop: 'ấu 1', _row: 3 },
    { ID: 3, HoTen: 'Nguyễn Quốc Bảo', TenLop: 'Ngành Ấu', _row: 4 },
    { ID: 2, HoTen: 'MARTINO nguyễn thành công', TenLop: 'ấu 1', _row: 5 },
  ], report, F);
  assert.equal(tabs.Users.length, 4);
  assert.deepEqual(tabs.Users[2], { Email: 'htnh08@gmail.com', SaintName: 'Martino', FullName: 'Nguyễn Thành Công', Status: 'Hoạt động' });
  assert.equal(tabs.Users[3].Email, 'htnh09@gmail.com');
  assert.equal(tabs.Users[3].SaintName, '');
  assert.deepEqual(tabs.GroupMembers, [
    { GroupName: 'Ban Quản Trị', Email: 'a@x.com' },
    { GroupName: 'Ấu 1', Email: 'htnh08@gmail.com' },
  ]);
  assert.equal(report.skipped.length, 1);
  assert.equal(report.skipped[0].row, 4);
  assert.match(report.skipped[0].reason, /Ngành Ấu/);
});

const attendanceBase = () => ({
  Classes: [{ ClassName: 'Dự Bị Trưởng 2' }],
  Students: [{ IdNumber: '079309036244', CurrentClass: 'Dự Bị Trưởng 2' }],
  'Att_dự bị trưởng 2': [{ WeekOf: 46278, IdNumber: '079309036244', ClassName: 'Dự Bị Trưởng 2', LeChuaNhat_Status: '', HocGiaoLy_Status: '', ChauThanhThe_Status: '', LeThu5_Status: 'Vắng' }],
});

test('addStudentAttendance merges and dedupes', () => {
  const tabs = attendanceBase();
  const report = P.newReport();
  const row = { Ngay: '2026-09-16', Buoi: 'CN_Le', TenLop: 'dự bị trưởng 2', SoCCCD: 79309036244 };
  const written = P.addStudentAttendance(tabs, [
    { ...row, TrangThai: 'Vắng', _row: 2 },
    { ...row, TrangThai: 'Hiện diện', _row: 3 },
    { ...row, Buoi: 'CN_GiaoLy', TrangThai: 'Có phép', _row: 4 },
    { ...row, Buoi: 'CN_Chau', TrangThai: '', _row: 5 },
  ], report, F);
  assert.deepEqual(written, ['Att_dự bị trưởng 2']);
  assert.equal(Object.keys(tabs).filter((t) => t.startsWith('Att_')).length, 1);
  assert.deepEqual(tabs['Att_dự bị trưởng 2'], [{
    WeekOf: '2026-09-13', IdNumber: '079309036244', ClassName: 'Dự Bị Trưởng 2',
    LeChuaNhat_Status: 'Hiện diện', HocGiaoLy_Status: 'Có phép', ChauThanhThe_Status: '', LeThu5_Status: 'Vắng',
  }]);
  assert.deepEqual(report.duplicates, [{ file: F, row: 2, keptRow: 3 }]);
  assert.equal(report.added[0].action, 'replaced');
});

test('addStudentAttendance reports bad rows', () => {
  const tabs = attendanceBase();
  delete tabs['Att_dự bị trưởng 2'];
  const report = P.newReport();
  const ok = { Ngay: '2026-09-13', Buoi: 'CN_Le', TenLop: 'Dự Bị Trưởng 2', SoCCCD: '079309036244', TrangThai: 'Vắng' };
  const written = P.addStudentAttendance(tabs, [
    { ...ok, SoCCCD: '1', _row: 2 },
    { ...ok, TenLop: 'Lạ', _row: 3 },
    { ...ok, Buoi: 'X', _row: 4 },
    { ...ok, Ngay: 'abc', _row: 5 },
    { ...ok, Buoi: 'HopHuynhTruong', _row: 6 },
  ], report, F);
  assert.deepEqual(written, []);
  assert.deepEqual(report.skipped.map((s) => s.row), [2, 3, 4, 5, 6]);
});

test('addStudentAttendance long class name', () => {
  const name = 'Lớp Rất Dài Dài Dài Dài Dài 12';
  const tabs = { Classes: [{ ClassName: name }], Students: [{ IdNumber: '1', CurrentClass: name }] };
  const report = P.newReport();
  const written = P.addStudentAttendance(tabs, [{ Ngay: '2026-09-13', Buoi: 'CN_Le', TenLop: name, SoCCCD: '1', TrangThai: 'Vắng', _row: 2 }], report, F);
  assert.deepEqual(written, []);
  assert.equal(report.skipped.length, 1);
});

const nameUsers = [
  { Email: 'b@x.com', FullName: 'Nông Thị Thiên Trang' },
  { Email: 'c@x.com', FullName: 'Lê Thiên Trang' },
  { Email: 'n@x.com', FullName: 'Phạm Trúc Nhi' },
  { Email: 'l@x.com', FullName: 'Lý Nhi' },
];

test('candidatesFor', () => {
  assert.equal(P.candidatesFor(nameUsers, 'THIÊN TRANG').length, 2);
  assert.equal(P.candidatesFor(nameUsers, 'Trúc Nhi').length, 1);
  assert.equal(P.candidatesFor(nameUsers, 'Nhi').length, 2);
  assert.equal(P.candidatesFor(nameUsers, 'Nguyễn Văn Không').length, 0);
});

test('unresolvedNames', () => {
  const tabs = { Users: nameUsers };
  const out = P.unresolvedNames(tabs, [{ HoTen: 'THIÊN TRANG' }, { HoTen: 'thiên trang' }, { 'Giáo Lý Viên': 'Trúc Nhi' }, { HoTen: 'Không Có' }]);
  assert.deepEqual(out.map(({ name, count, candidates }) => [name, count, candidates.length]), [['THIÊN TRANG', 2, 2], ['Không Có', 1, 0]]);
});

test('addTeacherAttendance', () => {
  const tabs = { Users: nameUsers };
  const report = P.newReport();
  const choices = new Map([['thiên trang', 'b@x.com'], ['không có', null]]);
  P.addTeacherAttendance(tabs, [
    { Ngay: '2026-09-17', Buoi: 'HopHuynhTruong', TenLop: 'x', HoTen: 'THIÊN TRANG', TrangThai: 'Có phép', _row: 2 },
    { Ngay: '2026-09-13', Buoi: 'CN_Le', HoTen: 'Trúc Nhi', TrangThai: 'Hiện diện', _row: 3 },
    { Ngay: '2026-09-13', Buoi: 'CN_Le', HoTen: 'Không Có', TrangThai: 'Hiện diện', _row: 4 },
    { Ngay: '2026-09-13', Buoi: 'CN_HopHT', HoTen: 'Trúc Nhi', TrangThai: 'Vắng', _row: 5 },
  ], choices, report, F);
  assert.deepEqual(tabs.TeacherAttendance, [
    { WeekOf: '2026-09-13', TeacherEmail: 'b@x.com', LeChuaNhat_Status: '', HocGiaoLy_Status: '', ChauThanhThe_Status: '', LeThu5_Status: '', HopHuynhTruong_Status: 'Có phép' },
    { WeekOf: '2026-09-13', TeacherEmail: 'n@x.com', LeChuaNhat_Status: 'Hiện diện', HocGiaoLy_Status: '', ChauThanhThe_Status: '', LeThu5_Status: '', HopHuynhTruong_Status: 'Vắng' },
  ]);
  assert.deepEqual(report.skipped.map((s) => s.row), [4]);
  assert.deepEqual(report.names.map((n) => n.how), ['chosen', 'auto', 'skipped']);
});

test('addTeaching', () => {
  const tabs = {
    Config: [{ Key: 'CurrentSchoolYear', Value: '2026-2027' }],
    Users: [{ Email: 't@x.com', FullName: 'Nông Thị Thiên Trang' }],
    Classes: [{ ClassName: 'Dự Bị Trưởng 2' }],
  };
  const report = P.newReport();
  const row = { 'Tên Lớp': 'Dự Bị Trưởng 2', 'Giáo Lý Viên': 'NÔNG THỊ THIÊN TRANG', 'Giáo án duyệt': '' };
  P.addTeaching(tabs, [
    { ...row, 'Ngày Chủ Nhật': '2026-08-30', 'Nội dung bài học': 'a', 'Link Giáo Án': 'https://x.com/a', _row: 44 },
    { ...row, 'Ngày Chủ Nhật': '2026-08-29', 'Nội dung bài học': 'Gặp gỡ 1', 'Link Giáo Án': 'https://docs.google.com/document/d/AAA/edit\nhttps://x.com/b', _row: 46 },
  ], new Map(), report, F);
  assert.deepEqual(tabs.Teaching, [{
    SchoolYear: '2026-2027', WeekOf: '2026-08-30', ClassName: 'Dự Bị Trưởng 2', TeacherEmail: 't@x.com', UpdatedBy: '', LessonContent: 'GẶP GỠ 1',
    LessonPlanUrl: 'https://docs.google.com/document/d/AAA/edit,https://x.com/b', LessonPlanNames: 'Giáo án\nGiáo án', LessonPlanTypes: 'link,link',
    RevisedPlanUrl: '', RevisedPlanNames: '', RevisedPlanTypes: '',
  }]);
  assert.deepEqual(report.duplicates, [{ file: F, row: 44, keptRow: 46 }]);
  assert.throws(() => P.addTeaching({}, [], new Map(), P.newReport(), F), /CurrentSchoolYear/);
});

test('normalizeNames', () => {
  const tabs = { Users: [{ FullName: 'NGUYỄN văn a', SaintName: 'GIUSE' }], Students: [{ FullName: 'trần b', SaintName: '' }] };
  P.normalizeNames(tabs);
  assert.equal(tabs.Users[0].FullName, 'Nguyễn Văn A');
  assert.equal(tabs.Users[0].SaintName, 'Giuse');
  assert.equal(tabs.Students[0].FullName, 'Trần B');
  assert.equal(tabs.Students[0].SaintName, '');
});

test('reportSheets', () => {
  const report = P.newReport();
  report.skipped.push({ file: F, row: 2, reason: 'x' });
  const sheets = P.reportSheets(report);
  assert.deepEqual(Object.keys(sheets), ['Added', 'Skipped', 'Duplicates', 'NameChoices']);
  assert.deepEqual(sheets.Skipped, [{ File: F, Row: 2, Reason: 'x' }]);
});

test('prepared workbook imports cleanly', () => {
  const tabs = {
    Config: [{ Key: 'CurrentSchoolYear', Value: '2026-2027' }],
    Classes: [{ ClassName: 'Dự Bị Trưởng 2', Grade: '' }],
    Users: [{ Email: 'doruoora@gmail.com', SaintName: '', FullName: 'Hệ Thống', Status: 'Hoạt động', SDT: '' }],
    Groups: [{ GroupName: 'Xứ đoàn', Type: 'Quản trị', Scope: '' }, { GroupName: 'Lớp DBT 2', Type: 'Lớp', Scope: 'Dự Bị Trưởng 2' }],
    GroupMembers: [{ GroupName: 'Xứ đoàn', Email: 'doruoora@gmail.com' }],
    Students: [{ IdNumber: '079309036244', FullName: 'trần văn an', CurrentClass: 'Dự Bị Trưởng 2' }],
  };
  const report = P.newReport();
  P.addTeachers(tabs, [{ HoTen: 'Nông Thị Thiên Trang', TenLop: 'dự bị trưởng 2', _row: 2 }], report, F);
  P.addStudentAttendance(tabs, [{ Ngay: '2026-09-16', Buoi: 'CN_Le', TenLop: 'Dự Bị Trưởng 2', SoCCCD: '079309036244', TrangThai: 'Hiện diện', _row: 2 }], report, F);
  P.addTeacherAttendance(tabs, [{ Ngay: '2026-09-13', Buoi: 'HopHuynhTruong', HoTen: 'Thiên Trang', TrangThai: 'Có phép', _row: 2 }], new Map(), report, F);
  P.addTeaching(tabs, [{ 'Ngày Chủ Nhật': '2026-09-16', 'Tên Lớp': 'Dự Bị Trưởng 2', 'Giáo Lý Viên': 'THIÊN TRANG', 'Nội dung bài học': 'bài 1', 'Link Giáo Án': 'https://docs.google.com/document/d/AAA/edit', 'Giáo án duyệt': '', _row: 2 }], new Map(), report, F);
  P.normalizeNames(tabs);
  assert.deepEqual(report.skipped, []);
  const { data, skipped } = mapSheet(JSON.parse(JSON.stringify(tabs)));
  assert.deepEqual(skipped, []);
  assert.equal(data.Attendance.length, 1);
  assert.equal(data.TeacherAttendance.length, 1);
  assert.equal(data.Memberships.length, 2);
  assert.equal(data.Lessons.length, 1);
  assert.equal(data.Lessons[0].WeekOf, '2026-09-20');
  assert.equal(data.LessonFiles[0].Type, 'LINK');
  assert.equal(data.Students[0].FullName, 'Trần Văn An');
});

test('dropDuplicateStudents removes every copy, keeps their other rows', () => {
  const tabs = {
    Classes: [{ ClassName: 'Ấu 1' }],
    Students: [
      { IdNumber: '079309036244', FullName: 'A', CurrentClass: 'Ấu 1' },
      { IdNumber: 'B1', FullName: 'B', CurrentClass: 'Ấu 1' },
      { IdNumber: 79309036244, FullName: 'A2', CurrentClass: 'Ấu 1' },
    ],
  };
  const report = P.newReport();
  P.addStudentAttendance(tabs, [{ Ngay: '2026-09-13', Buoi: 'CN_Le', TenLop: 'Ấu 1', SoCCCD: '079309036244', TrangThai: 'Vắng', _row: 2 }], report, F);
  assert.deepEqual([...P.dropDuplicateStudents(tabs, report)], [2, 4]);
  assert.deepEqual(tabs.Students.map((s) => s.FullName), ['B']);
  assert.equal(tabs['Att_Ấu 1'].length, 1); // attendance of the dropped student is still written
  assert.deepEqual(report.skipped.map((s) => [s.file, s.row]), [['Students', 2], ['Students', 4]]);
});
