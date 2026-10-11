/* =====================================================================
   SỔ THIẾU NHI — teachers/teachers.js
   Teacher attendance (UC-H1), absence lookup (UC-H2), statistics (UC-H3).
   For BQT ngành (their sectors) and Xứ đoàn (every sector and the Xứ đoàn list).
   ===================================================================== */
'use strict';

import {
  initCommon, load, state, $, api, esc, toast, fillSel, setupTabs, exportExcel,
  TEACHER_SESSIONS, MARK, isAdmin, personName, snapToSunday, pct,
} from '../shared/common.js';
import { SESSION_LABEL } from '../shared/labels.js';
import { absenceTable, printDocument } from '../shared/ui.js';

await initCommon();
await load('classes', 'groups');

// The lists a user may open: the sectors they manage; Xứ đoàn also gets the entry "Xứ đoàn".
const sectors = state.groups.filter((g) => g.type === 'SECTOR' && state.session.sectorGroupIds.includes(g.id));
const lists = [...sectors.map((g) => ({ v: g.id, t: g.name })), ...(isAdmin() ? [{ v: 'ADMIN', t: 'Xứ đoàn' }] : [])];
fillSel('ta-sector', lists);
fillSel('ts-sector', lists);
fillSel('ta-session', TEACHER_SESSIONS.map((code) => ({ v: code, t: SESSION_LABEL[code] })));

const listOf = (selectId) => ($(selectId).value === 'ADMIN' ? 'ADMIN' : Number($(selectId).value));

/* ---------- Tab 1: attendance ---------- */
// One row per teacher: `base` is what the server holds, `marks` what the screen shows, for the five sessions.
let rows = [];
let holidays = [];
let shown = { sectorGroupId: 0, weekOf: '' };

const BLANK = Object.fromEntries(TEACHER_SESSIONS.map((code) => [code, MARK.NONE]));
const session = () => $('ta-session').value;
const dirtyRows = () => rows.filter((row) => TEACHER_SESSIONS.some((code) => row.marks[code] !== row.base[code]));

// The list of teachers comes with the attendance; the page never loads the directory (R8).
async function loadWeek() {
  snapToSunday($('ta-week'));
  const sectorGroupId = listOf('ta-sector');
  const weekOf = $('ta-week').value;
  if (!sectorGroupId) return;
  let r;
  try { r = await api('getTeacherAttendance', { sectorGroupId, weekOf }); } catch (e) { return toast(e.message); }
  const saved = new Map(r.records.map((x) => [x.userId, x.marks]));
  holidays = r.holidays;
  rows = r.teachers.map((teacher) => {
    const marks = { ...BLANK, ...(saved.get(teacher.userId) ?? {}) };
    return { teacher, base: { ...marks }, marks };
  });
  shown = { sectorGroupId, weekOf };
  renderWeek();
}

function renderWeek() {
  const code = session();
  const note = $('ta-holiday-note');
  const off = holidays.find((h) => h.session === code);
  note.style.display = off ? 'block' : 'none';
  note.textContent = off ? `⚠ Buổi này được nghỉ phép${off.reason ? ` (${off.reason})` : ''}.` : '';

  const box = (i, which, checked) => `<td class="p-2 border text-center"><input type="checkbox" class="attendance-checkbox" data-i="${i}" data-which="${which}"${checked ? ' checked' : ''}></td>`;
  $('ta-tbody').innerHTML = rows.map(({ teacher, marks }, i) => '<tr>'
    + (isAdmin() ? `<td class="p-2 border">${esc(teacher.email ?? '')}</td>` : '')
    + `<td class="p-2 border font-medium">${esc(personName(teacher))}</td>`
    + `<td class="p-2 border text-center">${esc(teacher.className ?? 'Xứ đoàn')}</td>`
    + box(i, MARK.PRESENT, marks[code] === MARK.PRESENT)
    + box(i, MARK.EXCUSED, marks[code] === MARK.EXCUSED)
    + '</tr>').join('') || '<tr><td colspan="5" class="p-4 text-center text-slate-400">Chưa có Huynh trưởng trong danh sách này.</td></tr>';

  const present = rows.filter((r) => r.marks[code] === MARK.PRESENT).length;
  const excused = rows.filter((r) => r.marks[code] === MARK.EXCUSED).length;
  $('ta-summary').textContent = `Tổng ${rows.length} · Hiện diện ${present} · Có phép ${excused} · Vắng ${rows.length - present - excused}`;
  $('ta-dirty').style.display = dirtyRows().length ? 'inline-block' : 'none';
}

function toggle(i, mark) {
  const row = rows[i];
  row.marks[session()] = row.marks[session()] === mark ? MARK.NONE : mark;
  renderWeek();
}

// Only the teachers whose marks changed are sent, each with the five sessions of the week.
async function saveWeek() {
  const changed = dirtyRows();
  if (!changed.length) return toast('Không có thay đổi để lưu.');
  const button = $('ta-save');
  button.disabled = true;
  try {
    await api('saveTeacherAttendance', { ...shown, records: changed.map((row) => ({ userId: row.teacher.userId, marks: row.marks })) });
    changed.forEach((row) => { row.base = { ...row.marks }; });
    renderWeek();
    toast(`Đã lưu điểm danh của ${changed.length} Huynh trưởng.`);
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
  }
}

async function changeWeek() {
  if (dirtyRows().length && !confirm('Có thay đổi chưa lưu. Bỏ các thay đổi này?')) {
    $('ta-sector').value = shown.sectorGroupId;
    $('ta-week').value = shown.weekOf;
    return;
  }
  await loadWeek();
}

/* ---------- Tab 2: absence lookup (exact match; every match shown) ---------- */
async function renderAbsences() {
  const query = $('tabs-query').value;
  const out = $('tabs-out');
  if (!query.trim()) { out.innerHTML = '<p class="text-amber-600 font-medium">Nhập đúng họ tên (có dấu) của Huynh trưởng.</p>'; return; }
  let teachers;
  try { teachers = (await api('searchTeachers', { query })).teachers; } catch (e) { return toast(e.message); }
  if (!teachers.length) { out.innerHTML = '<p class="text-amber-600 font-medium">Không tìm thấy Huynh trưởng nào khớp chính xác trong các ngành bạn quản lý.</p>'; return; }

  const cards = await Promise.all(teachers.map(async (t) => {
    let r;
    try { r = await api('getTeacherAbsences', { userId: t.userId }); } catch (e) { return `<div class="p-4 text-red-500">Lỗi tải dữ liệu của ${esc(t.fullName)}: ${esc(e.message)}</div>`; }
    const tableId = `tabs-table-${t.userId}`;
    return '<div class="mb-8"><div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 flex justify-between items-start flex-wrap gap-4"><div>'
      + `<h3 class="text-lg font-extrabold text-blue-900">${esc(personName(r.teacher))}</h3>`
      + `<div class="text-sm text-slate-600 mt-1">${esc(r.teacher.className ?? 'Xứ đoàn')}</div></div>`
      + `<button type="button" class="export-absences bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm flex-shrink-0" data-table="${tableId}" data-name="${esc(t.fullName)}">⬇ Excel</button>`
      + `</div>${absenceTable(tableId, r.absences)}</div>`;
  }));
  out.innerHTML = cards.join('<hr class="my-8 border-slate-300 border-dashed border-t-2" />');
}

/* ---------- Tab 3: statistics ---------- */
// The class filter offers the classes of the chosen sector.
function fillStatsClasses() {
  const sector = sectors.find((g) => g.id === listOf('ts-sector'));
  const classes = sector ? state.classes.filter((c) => sector.classIds.includes(c.id)) : [];
  fillSel('ts-class', [{ v: '', t: 'Tất cả các lớp' }, ...classes.map((c) => ({ v: c.id, t: c.name }))]);
}

async function renderStats() {
  const sectorGroupId = listOf('ts-sector');
  if (!sectorGroupId) return;
  let r;
  try { r = await api('getTeacherAttendanceStats', { sectorGroupId, classId: $('ts-class').value || undefined }); } catch (e) { return toast(e.message); }
  $('ts-tbody').innerHTML = r.stats.length
    ? r.stats.map((t) => {
      const total = TEACHER_SESSIONS.reduce((sum, code) => sum + t.present[code], 0);
      return `<tr><td class="p-2 border font-medium">${esc(personName(t))}</td><td class="p-2 border text-center">${esc(t.className ?? 'Xứ đoàn')}</td>`
        + `<td class="p-2 border text-center">${t.taught}</td>`
        + TEACHER_SESSIONS.map((code) => `<td class="p-2 border text-center">${pct(t.present[code], r.max[code])}%</td>`).join('')
        + `<td class="p-2 border text-center font-bold">${pct(total, r.maxTotal)}%</td></tr>`;
    }).join('')
    : '<tr><td colspan="9" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}

function printStats() {
  const table = $('ts-table');
  if (!table.querySelector('tbody td:not([colspan])')) return toast('Chưa có dữ liệu để in.');
  const list = $('ts-sector').selectedOptions[0]?.textContent ?? '';
  const opened = printDocument({
    title: 'BẢNG THỐNG KÊ CHUYÊN CẦN HUYNH TRƯỞNG',
    subtitle: `${esc(list)} &nbsp;|&nbsp; Năm học: <b>${esc(state.year)}</b>`,
    tableHtml: table.outerHTML,
    leftSignature: 'Ban Quản Trị Ngành',
    landscape: true,
    leftColumn: 1,
  });
  if (!opened) toast('Trình duyệt chặn cửa sổ pop-up. Vui lòng cho phép pop-up cho trang này rồi thử lại.');
}

/* ---------- Events ---------- */
$('ta-sector').addEventListener('change', changeWeek);
$('ta-week').addEventListener('change', changeWeek);
$('ta-session').addEventListener('change', renderWeek);
$('ta-markall').addEventListener('click', () => { rows.forEach((row) => { row.marks[session()] = MARK.PRESENT; }); renderWeek(); });
$('ta-save').addEventListener('click', saveWeek);
$('ta-refresh').addEventListener('click', async () => { await loadWeek(); toast('Đã làm mới dữ liệu từ máy chủ.'); });
$('ta-tbody').addEventListener('change', (e) => {
  const box = e.target.closest('.attendance-checkbox');
  if (box) toggle(Number(box.dataset.i), Number(box.dataset.which));
});
window.addEventListener('beforeunload', (e) => { if (dirtyRows().length) e.preventDefault(); });

$('tabs-search').addEventListener('click', renderAbsences);
$('tabs-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderAbsences(); });
$('tabs-out').addEventListener('click', (e) => {
  const button = e.target.closest('.export-absences');
  if (button) exportExcel(button.dataset.table, `Trich_luc_${button.dataset.name}`);
});

$('ts-sector').addEventListener('change', () => { fillStatsClasses(); renderStats(); });
$('ts-class').addEventListener('change', renderStats);
$('ts-excel').addEventListener('click', () => exportExcel('ts-table', 'Thống kê Huynh trưởng'));
$('ts-print').addEventListener('click', printStats);

/* ---------- Start ---------- */
fillStatsClasses();
const showTab = setupTabs({ 't-stats': renderStats });
showTab('t-attendance');
await loadWeek();
