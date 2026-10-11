// Text and date normalisation shared by the data modules.

// CCCD comparison key: a leading ' (Excel text marker) and leading zeros are ignored.
export const idKey = (idNumber) => String(idNumber ?? '').trim().replace(/^'+/, '').replace(/^0+/, '');

// First name = last word of the full name ("Nguyễn Thị An" -> "An").
export const firstName = (fullName) => String(fullName ?? '').trim().split(/\s+/).pop() || '';

// Phones: array or "a / b" text in, list of trimmed non-empty numbers out.
export function splitPhones(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split('/');
  return parts.map((p) => String(p).trim()).filter(Boolean);
}
// Stored form: numbers joined with " / "; null when there is none.
export const joinPhones = (value) => splitPhones(value).join(' / ') || null;

// Search rule (plan section 5): exact match; only case and spaces at the ends are ignored.
// NFC so that the same accented letter typed on different keyboards compares equal.
export const searchKey = (text) => String(text ?? '').normalize('NFC').trim().toLocaleLowerCase('vi');

export function matchesStudent(student, query) {
  const q = searchKey(query);
  if (!q) return false;
  return searchKey(student.fullName) === q
    || searchKey(`${student.saintName ?? ''} ${student.fullName}`) === q
    || (idKey(q) !== '' && idKey(q) === student.idKey);
}

export function matchesTeacher(user, query, { byEmail = false } = {}) {
  const q = searchKey(query);
  if (!q) return false;
  return searchKey(user.fullName) === q
    || searchKey(`${user.saintName ?? ''} ${user.fullName}`) === q
    || (byEmail && searchKey(user.email) === q);
}

// Dates are 'YYYY-MM-DD' strings, handled in UTC so the server time zone never shifts a day.
const DAY = 86400000;
const parse = (date) => new Date(`${date}T00:00:00Z`);
const format = (d) => d.toISOString().slice(0, 10);

export const isDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parse(date).getTime()) && format(parse(date)) === date;

// A date that is not a Sunday moves back to the Sunday before it.
export function toSunday(date) {
  const d = parse(date);
  return format(new Date(d.getTime() - d.getUTCDay() * DAY));
}

// The Sunday shown when the lessons page opens: today if Sunday, otherwise the coming Sunday.
export function upcomingSunday(date) {
  const d = parse(date);
  return format(new Date(d.getTime() + ((7 - d.getUTCDay()) % 7) * DAY));
}

// Every Sunday from `from` to `to`, both included.
export function sundaysBetween(from, to) {
  const out = [];
  const end = parse(to).getTime();
  for (let t = parse(upcomingSunday(from)).getTime(); t <= end; t += 7 * DAY) out.push(format(new Date(t)));
  return out;
}
