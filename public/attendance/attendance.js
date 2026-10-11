/* =====================================================================
   SỔ THIẾU NHI — attendance/attendance.js
   Take attendance (UC-T1), absence lookup (UC-T3), class statistics (UC-T4),
   whole-parish overview (UC-T5). The face scan (UC-T2) is in face-scan.js.
   ===================================================================== */
'use strict';

import {
  initCommon, load, state, $, api, esc, toast, fillSel, fillClasses, setupTabs, sortStudents, exportExcel,
  SESSIONS, MARK, canWriteClass, className, personName, photoUrl, snapToSunday, pct,
} from '../shared/common.js';
import { SESSION_LABEL, ATTENDANCE_RATING_LABEL } from '../shared/labels.js';
import { matchesStudent } from '../shared/search.js';
import { absenceTable } from '../shared/ui.js';
import { initFaceScan, buildReferenceDescriptors, updateRefBadge } from './face-scan.js';

await initCommon();
await load('students', 'classes');

fillClasses('att-class');
fillSel('att-session', SESSIONS.map((code) => ({ v: code, t: SESSION_LABEL[code] })));
fillSel('stats-class', state.classes.map((c) => ({ v: c.id, t: c.name })));

const activeOf = (classId) => sortStudents(state.students.filter((s) => s.classId === classId && s.status === 'ACTIVE'));

/* ---------- Tab 1: take attendance ---------- */
// One row per student of the class: `base` is what the server holds, `marks` what the screen shows, for the four sessions.
let rows = [];
let holidays = [];
let shown = { classId: 0, weekOf: '' };

const BLANK = Object.fromEntries(SESSIONS.map((code) => [code, MARK.NONE]));
const session = () => $('att-session').value;
const isDirty = (row) => SESSIONS.some((code) => row.marks[code] !== row.base[code]);
const dirtyRows = () => rows.filter(isDirty);

async function loadWeek() {
  snapToSunday($('att-week'));
  const classId = Number($('att-class').value);
  const weekOf = $('att-week').value;
  if (!classId) return;
  let r;
  try { r = await api('getStudentAttendance', { classId, weekOf }); } catch (e) { return toast(e.message); }
  const saved = new Map(r.records.map((x) => [x.studentId, x.marks]));
  holidays = r.holidays;
  rows = activeOf(classId).map((student) => {
    const marks = { ...BLANK, ...(saved.get(student.id) ?? {}) };
    return { student, base: { ...marks }, marks };
  });
  shown = { classId, weekOf };
  // Viewing is open to everyone; the buttons that change marks need the class in scope.
  for (const id of ['att-save', 'att-markall', 'att-facescan']) $(id).style.display = canWriteClass(classId) ? '' : 'none';
  renderWeek();
  // Reference faces for the scan are prepared in the background.
  const people = rows.map(({ student }) => ({ key: String(student.id), photo: student.hasPhoto ? photoUrl(student) : '', fullName: student.fullName }));
  buildReferenceDescriptors(people, updateRefBadge).catch((e) => console.warn('[face-scan]', e.message));
}

function renderWeek() {
  const code = session();
  const editable = canWriteClass(shown.classId);
  const note = $('att-holiday-note');
  const off = holidays.find((h) => h.session === code);
  note.style.display = off ? 'block' : 'none';
  note.textContent = off ? `⚠ Buổi này được nghỉ phép${off.reason ? ` (${off.reason})` : ''}.` : '';

  const box = (i, which, checked) => `<td class="p-2 border text-center"><input type="checkbox" class="attendance-checkbox" data-i="${i}" data-which="${which}"${checked ? ' checked' : ''}${editable ? '' : ' disabled'}></td>`;
  $('att-tbody').innerHTML = rows.map(({ student, marks }, i) => `<tr><td class="p-2 border text-center">${i + 1}</td>`
    + `<td class="p-2 border">${esc(student.idNumber)}</td>`
    + `<td class="p-2 border">${esc(student.saintName ?? '')}</td>`
    + `<td class="p-2 border">${esc(student.fullName)}</td>`
    + box(i, MARK.PRESENT, marks[code] === MARK.PRESENT)
    + box(i, MARK.EXCUSED, marks[code] === MARK.EXCUSED)
    + '</tr>').join('') || '<tr><td colspan="6" class="p-4 text-center text-slate-400">Lớp chưa có Thiếu nhi.</td></tr>';

  const present = rows.filter((r) => r.marks[code] === MARK.PRESENT).length;
  const excused = rows.filter((r) => r.marks[code] === MARK.EXCUSED).length;
  $('att-summary').textContent = `Sĩ số ${rows.length} · Hiện diện ${present} · Có phép ${excused} · Vắng ${rows.length - present - excused}`;
  $('att-dirty').style.display = dirtyRows().length ? 'inline-block' : 'none';
}

// Hiện diện and Có phép exclude each other; unticking both leaves the student unmarked.
function toggle(i, mark) {
  const row = rows[i];
  row.marks[session()] = row.marks[session()] === mark ? MARK.NONE : mark;
  renderWeek();
}

function markAllPresent() {
  rows.forEach((row) => { row.marks[session()] = MARK.PRESENT; });
  renderWeek();
}

// Only the students whose marks changed since loading are sent, each with the four sessions of the week.
async function saveWeek() {
  const changed = dirtyRows();
  if (!changed.length) return toast('Không có thay đổi để lưu.');
  const button = $('att-save');
  button.disabled = true;
  try {
    await api('saveStudentAttendance', { ...shown, records: changed.map((row) => ({ studentId: row.student.id, marks: row.marks })) });
    changed.forEach((row) => { row.base = { ...row.marks }; });
    renderWeek();
    toast(`Đã lưu điểm danh của ${changed.length} Thiếu nhi.`);
  } catch (e) {
    toast(e.message);
  } finally {
    button.disabled = false;
  }
}

// Changing class or week drops unsaved ticks, so ask first.
async function changeWeek() {
  if (dirtyRows().length && !confirm('Có thay đổi chưa lưu. Bỏ các thay đổi này?')) {
    $('att-class').value = shown.classId;
    $('att-week').value = shown.weekOf;
    return;
  }
  await loadWeek();
}

initFaceScan({
  markOf: (key) => rows.find((r) => String(r.student.id) === key)?.marks[session()],
  markPresent: (key) => { rows.find((r) => String(r.student.id) === key).marks[session()] = MARK.PRESENT; },
  refresh: renderWeek,
});

/* ---------- Tab 2: absence lookup (exact match, every match shown) ---------- */
async function renderAbsences() {
  const query = $('abs-query').value;
  const out = $('abs-out');
  if (!query.trim()) { out.innerHTML = '<p class="text-amber-600 font-medium">Nhập đúng họ tên (có dấu) hoặc số CCCD của Thiếu nhi.</p>'; return; }
  const hits = state.students.filter((s) => matchesStudent(s, query));
  if (!hits.length) { out.innerHTML = '<p class="text-amber-600 font-medium">Không tìm thấy Thiếu nhi nào khớp chính xác.</p>'; return; }

  const cards = await Promise.all(hits.map(async (s) => {
    let r;
    try { r = await api('getStudentAbsences', { studentId: s.id }); } catch (e) { return `<div class="p-4 text-red-500">Lỗi tải dữ liệu của ${esc(s.fullName)}: ${esc(e.message)}</div>`; }
    const tableId = `abs-table-${s.id}`;
    return '<div class="mb-8"><div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 flex justify-between items-start flex-wrap gap-4"><div>'
      + `<h3 class="text-lg font-extrabold text-blue-900">${esc(personName(r.student))}</h3>`
      + '<dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mt-2">'
      + `<div><dt class="text-xs font-bold text-slate-500 uppercase">Số CCCD</dt><dd class="font-semibold">${esc(r.student.idNumber)}</dd></div>`
      + `<div><dt class="text-xs font-bold text-slate-500 uppercase">Lớp</dt><dd class="font-semibold">${esc(r.student.className)}</dd></div>`
      + '</dl></div>'
      + `<button type="button" class="export-absences bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm flex-shrink-0" data-table="${tableId}" data-name="${esc(s.fullName)}">⬇ Excel</button>`
      + `</div>${absenceTable(tableId, r.absences)}</div>`;
  }));
  out.innerHTML = cards.join('<hr class="my-8 border-slate-300 border-dashed border-t-2" />');
}

/* ---------- Tab 3: class statistics ---------- */
async function renderStats() {
  const classId = Number($('stats-class').value);
  if (!classId) return;
  let r;
  try { r = await api('getStudentAttendanceStats', { classId }); } catch (e) { return toast(e.message); }
  const students = activeOf(classId);
  $('stats-tbody').innerHTML = students.length
    ? students.map((s, i) => {
      const present = r.stats[s.id] ?? {};
      return `<tr><td class="p-2 border text-center">${i + 1}</td><td class="p-2 border font-medium">${esc(personName(s))}</td>`
        + SESSIONS.map((code) => `<td class="p-2 border text-center">${pct(present[code] ?? 0, r.max[code])}%</td>`).join('')
        + `<td class="p-2 border text-center font-bold">${pct(present.total ?? 0, r.maxTotal)}%</td></tr>`;
    }).join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}

/* ---------- Tab 4: whole parish (counted by the server in one query) ---------- */
async function renderOverview() {
  const period = $('ov-period').value.toUpperCase();
  $('ov-wrap-quarter').style.display = period === 'QUARTER' ? 'block' : 'none';
  $('ov-wrap-month').style.display = period === 'MONTH' ? 'block' : 'none';
  const value = period === 'QUARTER' ? Number($('ov-quarter').value) : period === 'MONTH' ? Number($('ov-month').value) : undefined;
  let r;
  try { r = await api('getAttendanceOverview', { period, value }); } catch (e) { return toast(e.message); }
  $('ov-total').textContent = r.totalStudents;
  $('ov-sunday').textContent = `${r.sundayMassPct}%`;
  $('ov-thursday').textContent = `${r.thursdayMassPct}%`;
  $('ov-tbody').innerHTML = r.classes.length
    ? r.classes.map((c) => `<tr><td class="p-3 border font-extrabold text-center text-blue-900">${esc(c.name)}</td>`
      + `<td class="p-3 border text-center font-bold">${c.size}</td>`
      + SESSIONS.map((code) => `<td class="p-3 border text-center">${c.pct[code]}%</td>`).join('')
      + `<td class="p-3 border text-center font-bold text-emerald-700">${c.pctTotal}%</td>`
      + `<td class="p-3 border text-center font-semibold ${c.rating === 'EXCELLENT' ? 'text-pink-600' : 'text-slate-700'}">${esc(ATTENDANCE_RATING_LABEL[c.rating])}</td></tr>`).join('')
    : '<tr><td colspan="8" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}

/* ---------- Print ---------- */
function printTable(tableId, title, subtitle, leftSignature) {
  const table = $(tableId);
  if (!table.querySelector('tbody td:not([colspan])')) return toast('Chưa có dữ liệu để in.');
  const win = window.open('', '_blank');
  if (!win) return toast('Trình duyệt chặn cửa sổ pop-up. Vui lòng cho phép pop-up cho trang này rồi thử lại.');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
    body{font-family:'Times New Roman',Times,serif;padding:20px;color:#000}
    .header{text-align:center;margin-bottom:20px}
    .header h2{margin:0;font-size:20px;text-transform:uppercase}
    .header h3{margin:5px 0 0;font-size:16px;font-weight:normal}
    table{width:100%;border-collapse:collapse;margin-top:15px;font-size:13px}
    th,td{border:1px solid #000;padding:6px;text-align:center}
    th{background:#f4f4f4;font-weight:bold}
    td:nth-child(2){text-align:left}
    .footer{margin-top:40px;display:flex;justify-content:space-between;font-size:15px}
    .signature{text-align:center;width:40%}
    @media print{@page{size:A4 landscape;margin:15mm}}
  </style></head><body>
    <div class="header"><h2>${esc(title)}</h2><h3>${subtitle}Năm học: <b>${esc(state.year)}</b></h3></div>
    ${table.outerHTML}
    <div class="footer">
      <div class="signature"><p><b>${esc(leftSignature)}</b></p><br><br><br></div>
      <div class="signature"><p><b>Xứ đoàn trưởng</b></p><br><br><br></div>
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 250);
}

/* ---------- Events ---------- */
$('att-class').addEventListener('change', changeWeek);
$('att-week').addEventListener('change', changeWeek);
// Switching the session keeps what was ticked for the other sessions: all four live in `rows`.
$('att-session').addEventListener('change', renderWeek);
$('att-markall').addEventListener('click', markAllPresent);
$('att-save').addEventListener('click', saveWeek);
$('att-refresh').addEventListener('click', async () => { await loadWeek(); toast('Đã làm mới dữ liệu từ máy chủ.'); });
$('att-tbody').addEventListener('change', (e) => {
  const box = e.target.closest('.attendance-checkbox');
  if (box) toggle(Number(box.dataset.i), Number(box.dataset.which));
});
window.addEventListener('beforeunload', (e) => { if (dirtyRows().length) e.preventDefault(); });

$('abs-search').addEventListener('click', renderAbsences);
$('abs-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderAbsences(); });
$('abs-out').addEventListener('click', (e) => {
  const button = e.target.closest('.export-absences');
  if (button) exportExcel(button.dataset.table, `Trich_luc_${button.dataset.name}`);
});

$('stats-class').addEventListener('change', renderStats);
$('stats-excel').addEventListener('click', () => exportExcel('stats-table', 'Thống kê chuyên cần lớp'));
$('stats-print').addEventListener('click', () => printTable('stats-table', 'BẢNG THỐNG KÊ CHUYÊN CẦN THIẾU NHI', `Lớp: <b>${esc(className($('stats-class').value))}</b> &nbsp;|&nbsp; `, 'Giáo lý viên phụ trách'));

for (const id of ['ov-period', 'ov-quarter', 'ov-month']) $(id).addEventListener('change', renderOverview);
$('ov-excel').addEventListener('click', () => exportExcel('ov-table', 'Thống kê toàn đoàn'));
$('ov-print').addEventListener('click', () => printTable('ov-table', 'BẢNG THỐNG KÊ CHUYÊN CẦN TOÀN ĐOÀN', '', 'Ban Điều Hành'));

/* ---------- Start ---------- */
const showTab = setupTabs({ 't-stats': renderStats, 't-overview': renderOverview });
showTab('t-attendance');
await loadWeek();
