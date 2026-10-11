/* The search rule of every search box (plan section 5), page side.
   Same rule as src/lib/text.js on the server; test/pages.test.mjs keeps the two in step. */

// CCCD comparison key: a leading ' and leading zeros are ignored.
export const idKey = (idNumber) => String(idNumber ?? '').trim().replace(/^'+/, '').replace(/^0+/, '');

// Only case, spaces at the ends and the accent encoding are ignored. Accents must be typed.
export const searchKey = (text) => String(text ?? '').normalize('NFC').trim().toLocaleLowerCase('vi');

const matchesName = (person, q) => searchKey(person.fullName) === q || searchKey(`${person.saintName ?? ''} ${person.fullName}`) === q;

// Exact match on the full name, the saint name + full name, or the CCCD.
export function matchesStudent(student, query) {
  const q = searchKey(query);
  if (!q) return false;
  return matchesName(student, q) || (idKey(q) !== '' && idKey(q) === idKey(student.idNumber));
}

// Exact match on the full name, the saint name + full name, or (when allowed) the email.
export function matchesPerson(person, query, { byEmail = false } = {}) {
  const q = searchKey(query);
  if (!q) return false;
  return matchesName(person, q) || (byEmail && searchKey(person.email) === q);
}
