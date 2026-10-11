/* The score rule (plan section 6.5), page side: blank stays blank, 0 is a real score, anything outside 0-10 is invalid.
   Same rule as parseScore in src/lib/codes.js; test/pages.test.mjs keeps the two in step. */

// Returns null (blank), a number, or undefined (invalid).
export function parseScore(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 10 ? value : undefined;
  const text = String(value).trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 10 ? n : undefined;
}
