import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededD1 } from './helpers/seeded.mjs';
import { AppError } from '../src/lib/errors.js';
import { loadSession, isSessionValid } from '../src/lib/db/users.js';
import { mapSheet, importSheet } from '../src/lib/db/sheet-import.js';

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
const ADMIN = { email: 'doruoora@gmail.com' };

// A small copy of the old sheet, with the mistakes a real one has.
const tabs = () => ({
  Classes: [{ ClassName: 'Ấu 1', Grade: 'Ấu' }, { ClassName: 'Ấu 2', Grade: 'Ấu' }],
  Users: [
    { Email: 'Doruoora@Gmail.com', SaintName: 'Giuse', FullName: 'Nguyễn Văn Bảo', Status: 'Hoạt động', SDT: 912345678 },
    { Email: 'co@example.com', SaintName: '', FullName: 'Trần Thị Cô', Status: 'Hoạt động', SDT: '' },
    { Email: 'nghi@example.com', SaintName: '', FullName: 'Lê Văn Nghỉ', Status: 'Khóa', SDT: '' },
    { Email: 'khong-phai-email', FullName: 'Sai Email', Status: 'Hoạt động' },
  ],
  Groups: [
    { GroupName: 'Xứ đoàn', Type: 'Quản trị', Scope: '', Description: '' },
    { GroupName: 'Ngành Ấu', Type: 'Ngành', Scope: 'Ấu 1, Ấu 2', Description: '' },
    { GroupName: 'BQT Ấu', Type: 'Quản trị ngành', Scope: 'Ngành Ấu', Description: '' },
    { GroupName: 'Ấu 1', Type: 'Lớp', Scope: '', Description: '' },
    { GroupName: 'Lạ', Type: 'Khác', Scope: '', Description: '' },
  ],
  GroupMembers: [
    { GroupName: 'Xứ đoàn', Email: 'doruoora@gmail.com' },
    { GroupName: 'Ấu 1', Email: 'co@example.com' },
    { GroupName: 'Ấu 1', Email: 'ai-do@example.com' },
  ],
  Config: [{ Key: 'CurrentSchoolYear', Value: '2025-2026' }, { Key: 'AttendanceStartDate', Value: 45907 }, { Key: 'PhotoFolder', Value: 'abc' }],
  Holidays: [{ WeekOf: '2025-09-14', Session: 'Lễ Thứ 5', Reason: 'Nghỉ' }, { WeekOf: '21/09/2025', Session: '', Reason: 'Bão' }],
  Students: [
    { IdNumber: "'079300000001", SaintName: 'Maria', FullName: 'Nguyễn Thị An', DateOfBirth: 42005, Gender: 'Nữ', Father: 'Cha', Mother: 'Mẹ', PhoneNumber: '0901 / 0902', CurrentClass: 'Ấu 1', EnrollYear: 2024, Photo: 'https://drive.google.com/x' },
    { IdNumber: 79300000002, SaintName: '', FullName: 'Trần Văn Bình', DateOfBirth: '', Gender: 'Nam', Father: '', Mother: '', PhoneNumber: '', CurrentClass: 'Ấu 2', EnrollYear: '', Photo: '' },
    { IdNumber: '079300000003', FullName: 'Không Lớp', CurrentClass: 'Thiếu 9' },
  ],
  SiblingGroups: [{ SiblingGroup: 'x1', Siblings: '079300000001, 79300000002, 999' }],
  'Att_Ấu 1': [
    { WeekOf: 45914, IdNumber: '79300000001', ClassName: 'Ấu 1', LeChuaNhat_Status: 'Hiện diện', HocGiaoLy_Status: 'Có phép', ChauThanhThe_Status: 'Vắng', LeThu5_Status: '' },
    { WeekOf: '2025-09-17', IdNumber: '079300000001', ClassName: 'Ấu 1', LeChuaNhat_Status: '', HocGiaoLy_Status: '', ChauThanhThe_Status: '', LeThu5_Status: 'Có mặt' }, // a Wednesday: same week
    { WeekOf: '2025-09-21', IdNumber: '079300000001', ClassName: 'Ấu 1', LeChuaNhat_Status: '', HocGiaoLy_Status: '', ChauThanhThe_Status: '', LeThu5_Status: '' },
    { WeekOf: '2025-09-14', IdNumber: '555', ClassName: 'Ấu 1', LeChuaNhat_Status: 'Hiện diện' },
  ],
  TeacherAttendance: [{ WeekOf: '2025-09-14', TeacherEmail: 'CO@example.com', ClassName: 'Ấu 1', LeChuaNhat_Status: 'Hiện diện', HopHuynhTruong_Status: 'Có phép' }],
  Scores: [
    { IdNumber: '079300000001', ClassName: 'Ấu 1', Quiz15_S1: 0, Exam_S1: '7,5', Quiz15_S2: '', Exam_S2: '' },
    { IdNumber: '079300000002', ClassName: 'Ấu 2', Quiz15_S1: 11, Exam_S1: '', Quiz15_S2: '', Exam_S2: '' },
  ],
  AcademicYear: [{ SchoolYear: '2024-2025', IdNumber: '079300000001', ClassName: 'Chiên Con', HK1Score: 8.2, HK2Score: '', YearScore: 8.2, YearAttendant: 91, Status: 'Giỏi' }],
  Teaching: [{
    Id: 'a', SchoolYear: '2025-2026', WeekOf: '2025-09-14', ClassName: 'Ấu 1', TeacherEmail: 'co@example.com', LessonContent: 'Bài 1',
    LessonPlanUrl: 'https://drive.google.com/file/d/FILE_1/view,https://example.com/a', LessonPlanNames: 'Giáo án, bản 1.docx\nTrang web', LessonPlanTypes: 'file,link',
    RevisedPlanUrl: '', RevisedPlanNames: '', RevisedPlanTypes: '', UpdatedBy: 'co@example.com',
  }],
});

test('the old sheet is mapped to the new tables and bad rows are reported', () => {
  const { data, skipped } = mapSheet(tabs());
  assert.deepEqual(data.Users.map((u) => [u.Email, u.Status, u.Phone, u.FirstName]), [['doruoora@gmail.com', 'ACTIVE', '912345678', 'Bảo'], ['co@example.com', 'ACTIVE', null, 'Cô'], ['nghi@example.com', 'INACTIVE', null, 'Nghỉ']]);
  assert.deepEqual(data.Groups.map((g) => [g.Type, g.SectorGroupId]), [['ADMIN', null], ['SECTOR', null], ['SECTOR_ADMIN', 2], ['CLASS', null]]);
  assert.deepEqual(data.GroupClasses, [{ GroupId: 2, ClassId: 1 }, { GroupId: 2, ClassId: 2 }, { GroupId: 4, ClassId: 1 }]);
  assert.deepEqual(data.Memberships, [{ GroupId: 1, UserId: 1 }, { GroupId: 4, UserId: 2 }]);
  assert.deepEqual(data.Config, [{ Key: 'CurrentSchoolYear', Value: '2025-2026' }, { Key: 'AttendanceStartDate', Value: '2025-09-07' }]);
  assert.equal(data.Holidays.length, 6); // one session, then a whole week = five sessions
  assert.deepEqual(data.Holidays[0], { WeekOf: '2025-09-14', Session: 'THURSDAY_MASS', Reason: 'Nghỉ' });
  assert.deepEqual(data.Students.map((s) => [s.IdNumber, s.IdKey, s.DateOfBirth, s.Gender, s.Phone, s.ClassId, s.EnrollYear]),
    [['079300000001', '79300000001', '2015-01-01', 'F', '0901 / 0902', 1, 2024], ['79300000002', '79300000002', null, 'M', null, 2, null]]);
  assert.deepEqual(data.SiblingMembers, [{ StudentId: 1, FamilyId: 1 }, { StudentId: 2, FamilyId: 1 }]);
  assert.deepEqual(data.Attendance, [{ StudentId: 1, ClassId: 1, WeekOf: '2025-09-14', SundayMass: 1, Catechism: 2, Adoration: 3, ThursdayMass: 1 }]);
  assert.deepEqual(data.TeacherAttendance, [{ UserId: 2, WeekOf: '2025-09-14', SundayMass: 1, Catechism: 0, Adoration: 0, ThursdayMass: 0, TeacherMeeting: 2 }]);
  assert.deepEqual(data.Scores, [{ StudentId: 1, ClassId: 1, QuizS1: 0, ExamS1: 7.5, QuizS2: null, ExamS2: null }]);
  assert.deepEqual(data.AcademicYear, [{ SchoolYear: '2024-2025', StudentId: 1, ClassName: 'Chiên Con', Semester1Avg: 8.2, Semester2Avg: null, YearAvg: 8.2, AttendancePct: 91, Rating: 'EXCELLENT' }]);
  assert.deepEqual(data.Lessons, [{ Id: 1, SchoolYear: '2025-2026', WeekOf: '2025-09-14', ClassId: 1, TeacherId: 2, Content: 'Bài 1', UpdatedBy: 2 }]);
  assert.deepEqual(data.LessonFiles, [
    { LessonId: 1, Slot: 'PLAN', Position: 0, Url: 'https://drive.google.com/file/d/FILE_1/view', Name: 'Giáo án, bản 1.docx', Type: 'FILE', DriveFileId: 'FILE_1' },
    { LessonId: 1, Slot: 'PLAN', Position: 1, Url: 'https://example.com/a', Name: 'Trang web', Type: 'LINK', DriveFileId: null },
  ]);
  assert.deepEqual(skipped.map((s) => [s.tab, s.row]), [['Users', 5], ['Groups', 6], ['GroupMembers', 4], ['Students', 4], ['Att_Ấu 1', 5], ['Scores', 3]]);
});

test('without confirm nothing is written; with confirm the import replaces everything and ends old sessions', async () => {
  const db = await seededD1();
  await db.prepare("INSERT INTO Secrets (Key, Value) VALUES ('drive', 'token')").run();
  const oldSession = await loadSession(db, ADMIN.email);

  const preview = await importSheet(db, ADMIN, { tabs: tabs() });
  assert.equal(preview.imported, false);
  assert.deepEqual([preview.counts.Students, preview.counts.Attendance, preview.skipped.length], [2, 1, 6]);
  assert.equal(await count(db, 'Students'), 600);

  const done = await importSheet(db, ADMIN, { tabs: tabs(), confirm: true });
  assert.equal(done.imported, true);
  for (const [table, rows] of Object.entries(done.counts)) assert.equal(await count(db, table), rows, table);
  assert.equal(await count(db, 'ConfigHistory'), 2);
  assert.equal(await count(db, 'Secrets'), 1); // the Drive connection stays
  assert.equal(await isSessionValid(db, oldSession), false);
  const session = await loadSession(db, ADMIN.email);
  assert.deepEqual([session.tier, session.classIds], ['ADMIN', [1, 2]]);
  assert.deepEqual((await loadSession(db, 'co@example.com')).classIds, [1]);
});

test('an import that would lock the admin out, or that fails half way, changes nothing', async () => {
  const db = await seededD1();
  const refused = (e) => e instanceof AppError && e.status === 400;
  await assert.rejects(importSheet(db, { email: 'co@example.com' }, { tabs: tabs(), confirm: true }), refused);
  await assert.rejects(importSheet(db, ADMIN, { tabs: { ...tabs(), Config: [] }, confirm: true }), refused);
  await assert.rejects(importSheet(db, ADMIN, { tabs: {}, confirm: true }), refused);

  await db.exec('CREATE TRIGGER stop BEFORE INSERT ON Lessons BEGIN SELECT RAISE(ABORT, \'stop\'); END');
  await assert.rejects(importSheet(db, ADMIN, { tabs: tabs(), confirm: true }));
  assert.equal(await count(db, 'Students'), 600);
  assert.equal(await count(db, 'Users'), 60);
});
