/* =====================================================================
   SỔ THIẾU NHI — shared/sort.js
   A click on a column header sorts the rows of every table, except <table data-nosort>.
   ===================================================================== */
'use strict';

// The key a cell text sorts by: a dd/mm/yyyy date as YYYY-MM-DD, a number (7,5 or 92%) as a number, else the text.
export function sortKey(text) {
  const raw = String(text ?? '').trim();
  const date = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (date) return `${date[3]}-${date[2]}-${date[1]}`;
  return /^-?\d+([.,]\d+)?%?$/.test(raw) ? Number(raw.replace(',', '.').replace('%', '')) : raw;
}

// A cell sorts by what its input holds, else by its text.
function sortValue(cell) {
  const input = cell?.querySelector('input, select');
  return sortKey(input ? (input.type === 'checkbox' ? (input.checked ? '1' : '0') : input.value) : cell?.textContent);
}

export function compareValues(a, b) {
  if (a === '' || b === '') return (a === '') - (b === ''); // blanks last
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'vi', { numeric: true });
}

// The column a header cell covers, counting the rowspan and colspan of the cells before it.
function columnOf(th) {
  const grid = [];
  [...th.closest('thead').rows].forEach((row, r) => {
    let c = 0;
    for (const cell of row.cells) {
      while (grid[r]?.[c]) c++;
      for (let i = 0; i < cell.rowSpan; i++) for (let j = 0; j < cell.colSpan; j++) (grid[r + i] ??= [])[c + j] = cell;
      c += cell.colSpan;
    }
  });
  return grid.map((row) => row.indexOf(th)).find((c) => c >= 0);
}

function sortRows(table) {
  const { sortCol, sortDir } = table.dataset;
  for (const tbody of table.tBodies) {
    const rows = [...tbody.rows];
    if (rows.some((row) => row.cells.length === 1 && row.cells[0].colSpan > 1)) continue; // the "no data" row
    const sign = sortDir === 'desc' ? -1 : 1;
    rows.map((row) => [row, sortValue(row.cells[sortCol])])
      .sort(([, a], [, b]) => (a === '' || b === '' ? compareValues(a, b) : sign * compareValues(a, b)))
      .forEach(([row]) => tbody.append(row));
  }
}

export function sortableTables() {
  // Keeps a sorted table sorted when a page renders its rows again; paused while sorting so its own moves are not seen.
  const observer = new MutationObserver((changes) => {
    const tables = new Set(changes.map((m) => m.target.closest?.('table[data-sort-col]')).filter(Boolean));
    observer.disconnect();
    tables.forEach(sortRows);
    observer.observe(document.body, { childList: true, subtree: true });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', (e) => {
    const th = e.target.closest('thead th');
    const table = th?.closest('table');
    if (!th || th.colSpan > 1 || !th.textContent.trim() || table.hasAttribute('data-nosort') || e.target.closest('input, button, select')) return;
    const col = String(columnOf(th));
    table.dataset.sortDir = table.dataset.sortCol === col && table.dataset.sortDir === 'asc' ? 'desc' : 'asc';
    table.dataset.sortCol = col;
    table.querySelectorAll('thead th[data-sort]').forEach((x) => x.removeAttribute('data-sort'));
    th.dataset.sort = table.dataset.sortDir;
    observer.disconnect();
    sortRows(table);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
