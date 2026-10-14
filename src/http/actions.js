// Every POST /api/<action>. An entry: { tier?: minimum tier, run(ctx, body): result }.
// ctx = { db, env, actor, today, lists, drive, origin }. The result is merged into { status: 'ok' }.
import { fail } from '../lib/errors.js';
import { requireTier, canManageSector, isAdmin } from '../lib/access.js';
import { saveConfig, saveHolidays, saveClass, deleteClass, reorderClasses, saveGroup, deleteGroup } from '../lib/db/org.js';
import { saveUser } from '../lib/db/users.js';
import { saveStudent, importStudents } from '../lib/db/students.js';
import {
  getStudentAttendance, saveStudentAttendance, getStudentAttendanceStats, getAttendanceOverview, getStudentAbsences,
  getTeacherAttendance, saveTeacherAttendance, getTeacherAttendanceStats, searchTeachers, getTeacherAbsences,
} from '../lib/db/attendance.js';
import { getScores, saveScores, getClassReport, getStudentRecord, startSchoolYear } from '../lib/db/academics.js';
import { getLessons, saveLesson, createUploadUrls } from '../lib/db/lessons.js';
import { importSheet } from '../lib/db/sheet-import.js';

// Ids arrive as numbers or as text from a <select>; anything else is a bad request.
function id(value, label = 'Mã') {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n)) fail(400, `${label} không hợp lệ.`);
  return n;
}
const optionalId = (value, label) => (value === undefined || value === null || value === '' ? null : id(value, label));

// R6: a sector the user manages, or the Xứ đoàn list for Xứ đoàn.
function sector(actor, value) {
  if (value === 'ADMIN') {
    requireTier(actor, 'ADMIN');
    return 'ADMIN';
  }
  const sectorGroupId = id(value, 'Ngành');
  if (!canManageSector(actor, sectorGroupId)) fail(403, 'Ngành không thuộc quyền quản lý của bạn.');
  return sectorGroupId;
}

const publicSession = ({ userId, email, fullName, saintName, tier, classIds, sectorGroupIds }) => ({ userId, email, fullName, saintName, tier, classIds, sectorGroupIds });
const list = (name, key = name) => ({ run: async ({ lists }) => ({ [key]: await lists.get(name) }) });

// Classes and groups (Xứ đoàn): every change rewrites the three lists that show them.
const manage = (change) => ({
  tier: 'ADMIN',
  run: async ({ db, lists }, b) => {
    await change(db, b);
    for (const name of ['classes', 'groups', 'directory']) await lists.refresh(name);
    return {};
  },
});

export const ACTIONS = {
  getSession: { run: ({ actor }) => ({ session: publicSession(actor) }) },

  /* ---------- cached lists ---------- */
  getStudents: list('students'),
  getClasses: list('classes'),
  getGroups: list('groups'),
  getConfig: list('config'),
  getHolidays: list('holidays'),
  getYearOptions: list('years'),
  getDirectory: { tier: 'ADMIN', run: ({ lists }) => lists.get('directory') },

  /* ---------- students ---------- */
  saveStudent: {
    run: async ({ db, actor, lists }, b) => {
      const saved = await saveStudent(db, actor, { ...b, id: optionalId(b.id), classId: id(b.classId, 'Lớp') });
      const students = await lists.refresh('students');
      await lists.refresh('classes'); // class sizes
      return { student: students.find((s) => s.id === saved.id), affected: students.filter((s) => saved.affectedIds.includes(s.id)) };
    },
  },
  importStudents: {
    tier: 'ADMIN',
    run: async ({ db, actor, lists }, b) => {
      const count = await importStudents(db, { classId: id(b.classId, 'Lớp'), students: b.students }, actor.userId);
      await lists.refresh('students');
      await lists.refresh('classes');
      return { count };
    },
  },
  getStudentAbsences: { run: ({ db, today }, b) => getStudentAbsences(db, { studentId: id(b.studentId), today }) },
  getStudentRecord: { run: ({ db, today }, b) => getStudentRecord(db, { studentId: id(b.studentId), today }) },

  /* ---------- student attendance ---------- */
  getStudentAttendance: { run: ({ db }, b) => getStudentAttendance(db, { classId: id(b.classId, 'Lớp'), weekOf: b.weekOf }) },
  saveStudentAttendance: {
    run: async ({ db, actor }, b) => {
      await saveStudentAttendance(db, actor, { classId: id(b.classId, 'Lớp'), weekOf: b.weekOf, records: b.records });
      return {};
    },
  },
  getStudentAttendanceStats: { run: ({ db, today }, b) => getStudentAttendanceStats(db, { classId: id(b.classId, 'Lớp'), today }) },
  getAttendanceOverview: { run: ({ db, today }, b) => getAttendanceOverview(db, { period: b.period, value: b.value, today }) },

  /* ---------- teachers (R6, R8) ---------- */
  getTeacherAttendance: {
    tier: 'SECTOR_ADMIN',
    run: async ({ db, actor }, b) => {
      const r = await getTeacherAttendance(db, { sectorGroupId: sector(actor, b.sectorGroupId), weekOf: b.weekOf });
      return isAdmin(actor) ? r : { ...r, teachers: r.teachers.map(({ email, ...t }) => t) };
    },
  },
  saveTeacherAttendance: {
    tier: 'SECTOR_ADMIN',
    run: async ({ db, actor }, b) => {
      await saveTeacherAttendance(db, { sectorGroupId: sector(actor, b.sectorGroupId), weekOf: b.weekOf, records: b.records }, actor.userId);
      return {};
    },
  },
  getTeacherAttendanceStats: {
    tier: 'SECTOR_ADMIN',
    run: ({ db, actor, today }, b) => getTeacherAttendanceStats(db, { sectorGroupId: sector(actor, b.sectorGroupId), classId: optionalId(b.classId, 'Lớp'), today }),
  },
  searchTeachers: { tier: 'SECTOR_ADMIN', run: async ({ db, actor }, b) => ({ teachers: await searchTeachers(db, actor, b.query) }) },
  getTeacherAbsences: { tier: 'SECTOR_ADMIN', run: ({ db, actor, today }, b) => getTeacherAbsences(db, actor, { userId: id(b.userId), today }) },

  /* ---------- academics ---------- */
  getScores: { run: async ({ db }, b) => ({ scores: await getScores(db, { classId: id(b.classId, 'Lớp') }) }) },
  saveScores: {
    run: async ({ db, actor }, b) => {
      await saveScores(db, actor, { classId: id(b.classId, 'Lớp'), scores: b.scores });
      return {};
    },
  },
  getClassReport: {
    run: async ({ db, actor, today }, b) => {
      const classId = optionalId(b.classId, 'Lớp');
      if (classId === null) requireTier(actor, 'SECTOR_ADMIN'); // R5: the whole parish
      return { rows: await getClassReport(db, { schoolYear: b.schoolYear, classId, today }) };
    },
  },

  /* ---------- lessons ---------- */
  getLessons: { run: async ({ db }, b) => ({ lessons: await getLessons(db, { schoolYear: b.schoolYear }) }) },
  saveLesson: { run: async ({ db, actor }, b) => ({ lesson: await saveLesson(db, actor, { ...b, classId: id(b.classId, 'Lớp') }) }) },
  createUploadUrls: {
    run: async ({ db, drive, actor, origin }, b) => ({
      uploadUrls: await createUploadUrls(db, drive, actor, { schoolYear: b.schoolYear, weekOf: b.weekOf, classId: id(b.classId, 'Lớp'), files: b.files, origin }),
    }),
  },

  /* ---------- admin (R7) ---------- */
  saveUser: {
    tier: 'ADMIN',
    run: async ({ db, actor, lists }, b) => {
      const user = await saveUser(db, { user: b.user, groupIds: b.groupIds }, actor.userId);
      await lists.refresh('directory');
      return { user };
    },
  },
  saveClass: manage((db, b) => saveClass(db, { id: optionalId(b.id), name: b.name, grade: b.grade })),
  deleteClass: manage((db, b) => deleteClass(db, id(b.id))),
  reorderClasses: manage((db, b) => reorderClasses(db, b.ids)),
  saveGroup: manage((db, b) => saveGroup(db, { id: optionalId(b.id), name: b.name, type: b.type, description: b.description, classIds: b.classIds, sectorGroupId: b.sectorGroupId })),
  deleteGroup: manage((db, b) => deleteGroup(db, id(b.id))),
  saveConfig: {
    tier: 'ADMIN',
    run: async ({ db, actor, lists }, b) => {
      await saveConfig(db, b.config, actor.userId);
      await lists.refresh('years'); // depends on CurrentSchoolYear
      return { config: await lists.refresh('config') };
    },
  },
  saveHolidays: {
    tier: 'ADMIN',
    run: async ({ db, lists }, b) => {
      await saveHolidays(db, b.holidays);
      return { holidays: await lists.refresh('holidays') };
    },
  },
  startSchoolYear: {
    tier: 'ADMIN',
    run: async ({ db, actor, today, lists }, b) => {
      const result = await startSchoolYear(db, { attendanceStartDate: b.attendanceStartDate, today }, actor.userId);
      await lists.rebuild();
      return result;
    },
  },
  // confirm false = report only; confirm true replaces all data of this database.
  importSheet: {
    tier: 'ADMIN',
    run: async ({ db, actor, lists }, b) => {
      const result = await importSheet(db, actor, { tabs: b.tabs, confirm: b.confirm === true });
      if (result.imported) await lists.rebuild();
      return result;
    },
  },
  clearCache: {
    tier: 'ADMIN',
    run: async ({ lists }) => {
      await lists.rebuild();
      return {};
    },
  },
};
