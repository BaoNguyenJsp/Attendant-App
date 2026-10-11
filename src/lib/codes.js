// Codes stored in D1 and sent by the API. Vietnamese labels live in public/shared/labels.js.

export const MARK = { NONE: 0, PRESENT: 1, EXCUSED: 2, ABSENT: 3 };

// Session code -> column name in Attendance / TeacherAttendance.
export const STUDENT_SESSIONS = {
  SUNDAY_MASS: 'SundayMass',
  CATECHISM: 'Catechism',
  ADORATION: 'Adoration',
  THURSDAY_MASS: 'ThursdayMass',
};
export const TEACHER_SESSIONS = { ...STUDENT_SESSIONS, TEACHER_MEETING: 'TeacherMeeting' };

// Group type -> rank; a user's tier is the highest rank among their groups.
export const TIER_RANK = { CLASS: 1, SECTOR: 2, SECTOR_ADMIN: 3, ADMIN: 4 };

export const USER_STATUSES = ['ACTIVE', 'INACTIVE'];
export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'GRADUATED'];
export const GENDERS = ['F', 'M'];
export const FILE_SLOTS = ['PLAN', 'REVISED'];
export const FILE_TYPES = ['FILE', 'LINK'];
export const DEFAULT_LOCATION = 'Trong lớp';

export const isMark = (v) => Number.isInteger(v) && v >= 0 && v <= 3;

// Score rule (plan section 6.5): blank stays null, 0 is a real score, anything outside 0-10 is invalid.
// Returns null, a number, or undefined when invalid.
export function parseScore(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    v = v.trim().replace(',', '.');
    if (v === '') return null;
  } else if (typeof v !== 'number') {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : undefined;
}

const round1 = (n) => Math.round(n * 10) / 10;

export const semesterAvg = (quiz, exam) => (quiz === null || exam === null ? null : (quiz + 2 * exam) / 3);
export const yearAvg = (s1, s2) => (s1 !== null && s2 !== null ? (s1 + 2 * s2) / 3 : s1 ?? s2);
export const academicRating = (avg) => (avg === null ? null : avg >= 8 ? 'EXCELLENT' : avg >= 6.5 ? 'GOOD' : 'AVERAGE');
export const attendanceRating = (pct) => (pct >= 80 ? 'EXCELLENT' : pct >= 65 ? 'GOOD' : pct >= 50 ? 'FAIR' : 'NEEDS_WORK');

// One student's year result from the four raw scores. Averages are rounded to one decimal for display
// and storage; the year average and rating are computed from the unrounded semester averages.
export function yearResult({ quizS1, examS1, quizS2, examS2 }) {
  const s1 = semesterAvg(quizS1, examS1);
  const s2 = semesterAvg(quizS2, examS2);
  const year = yearAvg(s1, s2);
  return {
    semester1Avg: s1 === null ? null : round1(s1),
    semester2Avg: s2 === null ? null : round1(s2),
    yearAvg: year === null ? null : round1(year),
    rating: academicRating(year),
  };
}
