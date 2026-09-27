// Self-check for the sibling-group logic in Code.gs. Run: node _sibling_check.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const body = `
const T = { SiblingGroups: [], Students: [] };
upsertRows = (name, pred, newRows) => {
  const key = name === 'Students' ? 'Students' : 'SiblingGroups';
  const rows = T[key];
  const matches = rows.filter(pred);
  if (matches.length === 1 && newRows.length === 1) rows[rows.indexOf(matches[0])] = { ...newRows[0] };
  else if (matches.length === 0 && newRows.length > 0) newRows.forEach(r => rows.push({ ...r }));
  else T[key] = rows.filter(r => !pred(r)).concat(newRows.map(r => ({ ...r })));
};
cachedRead = name => (T[name] || []).map(r => ({ ...r }));

const seed = ids => { T.SiblingGroups = []; T.Students = ids.map(i => ({ IdNumber: i, Siblings: '' })); };
const save = (id, ids) => setStudentGroup([id], syncSiblingGroup(id, ids));   // mirrors saveStudent
const rowSibs = id => (T.Students.find(s => s.IdNumber === id) || {}).Siblings;
const sibs = id => ACTIONS.getStudents().students.find(s => s.IdNumber === id).Siblings;

// A: new pair
seed(['A', 'B']); save('A', ['B']);
assert.equal(sibs('A'), 'B');
assert.equal(sibs('B'), 'A');
assert.equal(rowSibs('A'), rowSibs('B'), 'both store the same GroupID');

// B: joining an existing family
seed(['A', 'B', 'C']); save('A', ['B']); save('C', ['A']);
assert.equal(rowSibs('C'), rowSibs('A'), 'C shares the family GroupID');
assert.equal(sibs('C'), 'A,B');

// C: removing a sibling drops the group
save('C', ['B']);
assert.equal(sibs('C'), 'B');
assert.equal(sibs('A'), '');
assert.equal(rowSibs('A'), '');

// F: linking two families merges them under one GroupID
seed(['A', 'B', 'C', 'D']);
save('A', ['B']); save('C', ['D']); save('A', ['B', 'C']);
assert.equal(sibs('A'), 'B,C,D');
assert.equal(sibs('D'), 'A,B,C');
assert.equal(T.SiblingGroups.length, 1, 'merged into one group');

// D: clearing all siblings removes the group
seed(['A', 'B', 'C']); save('C', ['A', 'B']); save('C', []);
assert.equal(T.SiblingGroups.length, 0);
assert.equal(sibs('A'), '');

// Old comma-list format is not a valid GroupID -> no siblings
seed(['A']); T.Students[0].Siblings = '111,222';
assert.equal(sibs('A'), '');

// GroupID matching normalizes a leading '0'/quote, like every other id
seed(['A', 'B']);
T.SiblingGroups = [{ GroupID: '0xyz-1', Siblings: 'A,B' }];
T.Students[0].Siblings = "'0xyz-1";
T.Students[1].Siblings = '0xyz-1';
assert.equal(sibs('A'), 'B');
assert.equal(sibs('B'), 'A');

console.log('ALL SIBLING GROUP CHECKS PASSED');
`;

vm.runInNewContext(
  fs.readFileSync('./Code.gs', 'utf8') + body,
  { console, assert, Utilities: { getUuid: (() => { let n = 0; return () => 'g' + (++n); })() } }
);
