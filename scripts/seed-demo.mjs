// Demo data for an empty database (plan section 11). All people are invented.
//   node scripts/seed-demo.mjs [--today=YYYY-MM-DD]   -> writes seed.sql, prints row counts
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { firstName, idKey, sundaysBetween } from '../src/lib/text.js';
import { yearResult } from '../src/lib/codes.js';

const SCHOOL_YEAR = '2026-2027';
const PAST_YEAR = '2025-2026';
const START_DATE = '2026-09-06';
const ADMIN_EMAIL = 'doruoora@gmail.com';
const STUDENTS_PER_CLASS = 50;
const TEACHERS_PER_CLASS = 4;
const FAMILIES = 40;

// Promotion order = array order.
const SECTORS = [
  ['Chiên', ['Chiên Con']],
  ['Ấu', ['Ấu 1', 'Ấu 2', 'Ấu 3']],
  ['Thiếu', ['Thiếu 1', 'Thiếu 2', 'Thiếu 3']],
  ['Nghĩa', ['Nghĩa 1', 'Nghĩa 2', 'Nghĩa 3']],
  ['Dự bị trưởng', ['Dự bị trưởng 1', 'Dự bị trưởng 2']],
];
const SECTOR_TIER_SECTORS = ['Ấu', 'Thiếu']; // the two users of tier Ngành

const SURNAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Vũ', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Hồ', 'Ngô', 'Dương', 'Lý'];
const NAMES = {
  F: { middle: ['Thị', 'Ngọc', 'Thanh', 'Kim', 'Thu', 'Bảo'], first: ['An', 'Anh', 'Châu', 'Diệp', 'Hà', 'Hân', 'Hương', 'Lan', 'Linh', 'Mai', 'My', 'Ngân', 'Nhi', 'Oanh', 'Phương', 'Quỳnh', 'Thảo', 'Trang', 'Trâm', 'Vy', 'Yến'], saint: ['Maria', 'Anna', 'Têrêsa', 'Cêcilia', 'Lucia', 'Agnes', 'Rosa', 'Monica'] },
  M: { middle: ['Văn', 'Minh', 'Quốc', 'Đức', 'Gia', 'Hoàng'], first: ['Bảo', 'Bình', 'Cường', 'Dũng', 'Đạt', 'Hải', 'Hiếu', 'Hùng', 'Huy', 'Khang', 'Khoa', 'Long', 'Nam', 'Phúc', 'Quân', 'Sơn', 'Tâm', 'Thịnh', 'Trí', 'Tuấn', 'Vinh'], saint: ['Giuse', 'Phêrô', 'Phaolô', 'Gioan', 'Antôn', 'Đaminh', 'Micae', 'Vinh Sơn'] },
};

// mulberry32: small seeded generator, so every run gives the same data.
function makeRandom(seed) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min, max) => min + Math.floor(next() * (max - min + 1));
  return { next, int, pick: (list) => list[int(0, list.length - 1)] };
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

export function generate({ today }) {
  const rnd = makeRandom(20261011);
  const phone = () => `09${pad(rnd.int(0, 99999999), 8)}`;
  const person = (gender, surname = rnd.pick(SURNAMES)) => {
    const n = NAMES[gender];
    const fullName = `${surname} ${rnd.pick(n.middle)} ${rnd.pick(n.first)}`;
    return { saintName: rnd.pick(n.saint), fullName, firstName: firstName(fullName) };
  };

  // Classes and groups
  const Classes = [];
  const Groups = [];
  const GroupClasses = [];
  const group = (Name, Type, SectorGroupId = null) => {
    Groups.push({ Id: Groups.length + 1, Name, Type, SectorGroupId, Description: null });
    return Groups.length;
  };
  const classGroupId = {};  // class id -> CLASS group id
  const sectorGroupId = {}; // sector name -> SECTOR group id
  const sectorAdminGroupId = {};
  for (const [sector, names] of SECTORS) {
    sectorGroupId[sector] = group(`Ngành ${sector}`, 'SECTOR');
    for (const name of names) {
      const id = Classes.length + 1;
      Classes.push({ Id: id, Name: name, Grade: sector, SortOrder: id });
      classGroupId[id] = group(`Lớp ${name}`, 'CLASS');
      GroupClasses.push({ GroupId: classGroupId[id], ClassId: id }, { GroupId: sectorGroupId[sector], ClassId: id });
    }
  }
  for (const [sector] of SECTORS) sectorAdminGroupId[sector] = group(`BQT Ngành ${sector}`, 'SECTOR_ADMIN', sectorGroupId[sector]);
  const adminGroupId = group('Xứ đoàn', 'ADMIN');

  // Users: 5 admins, 5 sector admins, 2 sector users, 4 teachers per class
  const Users = [];
  const Memberships = [];
  const classTeacherIds = {}; // class id -> user ids
  let teacherNo = 0;
  const user = (groupId, email) => {
    const id = Users.length + 1;
    const p = person(id % 2 ? 'M' : 'F');
    Users.push({ Id: id, Email: email ?? `teacher${pad(++teacherNo)}@example.com`, SaintName: p.saintName, FullName: p.fullName, FirstName: p.firstName, Status: 'ACTIVE', Phone: phone(), AuthVersion: 1 });
    Memberships.push({ GroupId: groupId, UserId: id });
    return id;
  };
  user(adminGroupId, ADMIN_EMAIL);
  for (let i = 2; i <= 5; i++) user(adminGroupId, `admin${i}@example.com`);
  for (const [sector] of SECTORS) user(sectorAdminGroupId[sector]);
  for (const sector of SECTOR_TIER_SECTORS) user(sectorGroupId[sector]);
  for (const c of Classes) classTeacherIds[c.Id] = Array.from({ length: TEACHERS_PER_CLASS }, () => user(classGroupId[c.Id]));

  // Students: 25 girls then 25 boys per class
  const Students = [];
  const enrollBase = Number(SCHOOL_YEAR.slice(0, 4));
  Classes.forEach((c, classIndex) => {
    for (let i = 0; i < STUDENTS_PER_CLASS; i++) {
      const id = Students.length + 1;
      const gender = i < STUDENTS_PER_CLASS / 2 ? 'F' : 'M';
      const surname = rnd.pick(SURNAMES);
      const p = person(gender, surname);
      const idNumber = `079${300000000 + id}`;
      Students.push({
        Id: id, IdNumber: idNumber, IdKey: idKey(idNumber), SaintName: p.saintName, FullName: p.fullName, FirstName: p.firstName,
        DateOfBirth: `${enrollBase - 6 - classIndex}-${pad(rnd.int(1, 12))}-${pad(rnd.int(1, 28))}`,
        Gender: gender, Father: person('M', surname).fullName, Mother: person('F').fullName,
        Phone: rnd.next() < 0.3 ? `${phone()} / ${phone()}` : phone(),
        ClassId: c.Id, EnrollYear: enrollBase - classIndex, Status: 'ACTIVE', PhotoVersion: 0,
      });
    }
  });

  // Families: 2 or 3 students of different classes share surname, parents and phone
  const SiblingMembers = [];
  const taken = new Set();
  for (let family = 1; family <= FAMILIES; family++) {
    const classIds = new Set();
    const members = [];
    const size = rnd.int(2, 3);
    while (members.length < size) {
      const s = Students[rnd.int(0, Students.length - 1)];
      if (taken.has(s.Id) || classIds.has(s.ClassId)) continue;
      taken.add(s.Id);
      classIds.add(s.ClassId);
      members.push(s);
    }
    const surname = members[0].FullName.split(' ')[0];
    for (const s of members) {
      s.FullName = [surname, ...s.FullName.split(' ').slice(1)].join(' ');
      s.Father = members[0].Father;
      s.Mother = members[0].Mother;
      s.Phone = members[0].Phone;
      SiblingMembers.push({ StudentId: s.Id, FamilyId: family });
    }
  }

  // Past year: a full record for everyone except the first class, in the class before the current one
  const score = (min) => rnd.int(min * 2, 20) / 2; // steps of 0.5
  const AcademicYear = Students.filter((s) => s.ClassId > 1).map((s) => {
    const min = rnd.pick([4, 5, 6, 7]);
    const r = yearResult({ quizS1: score(min), examS1: score(min), quizS2: score(min), examS2: score(min) });
    return {
      SchoolYear: PAST_YEAR, StudentId: s.Id, ClassName: Classes[s.ClassId - 2].Name,
      Semester1Avg: r.semester1Avg, Semester2Avg: r.semester2Avg, YearAvg: r.yearAvg,
      AttendancePct: rnd.int(55, 100), Rating: r.rating,
    };
  });

  // Current year so far
  const weeks = sundaysBetween(START_DATE, today);
  const mark = () => { const x = rnd.next(); return x < 0.82 ? 1 : x < 0.92 ? 2 : 0; };
  const marks = (columns) => {
    const row = Object.fromEntries(columns.map((c) => [c, mark()]));
    if (columns.every((c) => row[c] === 0)) row[columns[0]] = 1; // an all-unmarked row is never stored
    return row;
  };
  const Attendance = [];
  const TeacherAttendance = [];
  for (const WeekOf of weeks) {
    for (const s of Students) {
      if (rnd.next() < 0.9) Attendance.push({ StudentId: s.Id, WeekOf, ClassId: s.ClassId, ...marks(['SundayMass', 'Catechism', 'Adoration', 'ThursdayMass']) });
    }
    for (const u of Users) {
      if (rnd.next() < 0.9) TeacherAttendance.push({ UserId: u.Id, WeekOf, ...marks(['SundayMass', 'Catechism', 'Adoration', 'ThursdayMass', 'TeacherMeeting']) });
    }
  }
  const Scores = Students.map((s) => ({ StudentId: s.Id, ClassId: s.ClassId, QuizS1: score(4), ExamS1: score(4), QuizS2: null, ExamS2: null }));
  const Holidays = [{ WeekOf: '2026-09-27', Session: 'THURSDAY_MASS', Reason: 'Nghỉ lễ' }];
  const Lessons = [];
  weeks.slice(0, 3).forEach((WeekOf, w) => {
    for (const c of Classes) {
      Lessons.push({ Id: Lessons.length + 1, SchoolYear: SCHOOL_YEAR, WeekOf, ClassId: c.Id, TeacherId: classTeacherIds[c.Id][0], Content: `Bài ${w + 1}`, Location: 'Trong lớp', UpdatedBy: classTeacherIds[c.Id][0] });
    }
  });

  const Config = [
    { Key: 'CurrentSchoolYear', Value: SCHOOL_YEAR },
    { Key: 'AttendanceStartDate', Value: START_DATE },
    { Key: 'DriveFolderId', Value: '' },
  ];
  const ConfigHistory = Config.map((c, i) => ({ Id: i + 1, Key: c.Key, Value: c.Value, Action: 'ADDED', ChangedBy: 1 }));

  // Insert order respects the foreign keys.
  return { Users, Classes, Groups, GroupClasses, Memberships, Config, ConfigHistory, Holidays, Students, SiblingMembers, Attendance, TeacherAttendance, Scores, AcademicYear, Lessons };
}

const literal = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// Plain statements only: `wrangler d1 execute --file` refuses BEGIN/COMMIT.
export function toSql(data) {
  const names = Object.keys(data);
  const lines = [
    ...['LessonFiles', 'DriveFolders', 'DriveTrash', ...[...names].reverse()].map((t) => `DELETE FROM ${t};`),
  ];
  for (const table of names) {
    const rows = data[table];
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    for (let i = 0; i < rows.length; i += 100) {
      const values = rows.slice(i, i + 100).map((r) => `(${columns.map((c) => literal(r[c])).join(', ')})`);
      lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values.join(',\n')};`);
    }
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv.find((a) => a.startsWith('--today='));
  const today = arg ? arg.slice(8) : new Date().toISOString().slice(0, 10);
  const data = generate({ today });
  writeFileSync(new URL('../seed.sql', import.meta.url), toSql(data));
  console.table(Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, rows.length])));
  console.log(`seed.sql written (data up to ${today})`);
}
