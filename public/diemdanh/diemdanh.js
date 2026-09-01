/* =====================================================================
   SỔ THIẾU NHI — diemdanh/index.js
   Điểm danh theo (Lớp, Tuần, Buổi) + trích lục CCCD + thống kê lớp/toàn đoàn.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, SESSIONS, TCLASSES, year, defaultWeek, normSunday, fmt1, isExec, fillClasses, fillSessions, exportExcel } from '../shared/common.js';
import { searchCard, rankBadge } from '../shared/ui.js';

await initCommon();

const { classes } = await api('getClasses');
setState({TCLASSES: classes || []});
fillClasses('dd-lop', 'tk-lop');
fillSessions('dd-buoi');

let ddBase = [], ddState = [];

async function renderDD() {
  if (!$('dd-week').value) $('dd-week').value = defaultWeek();
  const cls = $('dd-lop').value;
  if (!cls) return toast('Chọn lớp.');
  let r;
  try { r = await api('getAttendance', {schoolYear: year(), weekOf: $('dd-week').value, session: $('dd-buoi').value, className: cls}); }
  catch (e) { return toast(e.message); }
  const note = $('dd-holiday-note');
  if (r.isHolidayWeek) { note.style.display = 'block'; note.textContent = '⚠ Tuần này là ngày nghỉ đã khai báo trong mục Quản trị.'; }
  else note.style.display = 'none';
  ddBase = (r.records || []).map(x => ({idNumber:x.idNumber, fullName:x.fullName, status:x.status || 'Hiện diện', note:x.note || ''}));
  ddState = ddBase.map(x => ({...x}));
  renderDDTable();
}
function renderDDTable() {
  const tb = $('dd-tbody');
  tb.innerHTML = ddState.map((s, i) => {
    const present = s.status === 'Hiện diện', permission = s.status === 'Có phép';
    return '<tr data-i="' + i + '" class="' + (present || permission ? '' : 'bg-red-50') + '">' +
      '<td class="p-2 border text-center">' + (i + 1) + '</td>' +
      '<td class="p-2 border">' + esc(s.fullName) + '</td>' +
      '<td class="p-2 border text-center"><input type="checkbox" class="attendance-checkbox" data-i="' + i + '" data-which="present" ' + (present ? 'checked' : '') + '></td>' +
      '<td class="p-2 border text-center"><input type="checkbox" class="attendance-checkbox" data-i="' + i + '" data-which="permission" ' + (permission ? 'checked' : '') + '></td>' +
      '<td class="p-2 border"><input type="text" data-i="' + i + '" class="w-full border p-1.5 rounded text-sm" value="' + esc(s.note) + '" placeholder="Ghi chú…"></td>' +
      '</tr>';
  }).join('');
  calcDD();
}
function handleCheck(i, which) {
  const row = $('dd-tbody').querySelector('tr[data-i="' + i + '"]');
  if (row) ddState[i].note = row.querySelector('input[type="text"]').value || '';
  const s = ddState[i];
  s.status = which === 'present' ? (s.status === 'Hiện diện' ? 'Vắng' : 'Hiện diện') : (s.status === 'Có phép' ? 'Vắng' : 'Có phép');
  renderDDTable();
  markDirty();
}
function noteInput(i) {
  const row = $('dd-tbody').querySelector('tr[data-i="' + i + '"]');
  if (row) ddState[i].note = row.querySelector('input[type="text"]').value || '';
  markDirty();
}
function markAllPresent() { ddState.forEach(s => s.status = 'Hiện diện'); renderDDTable(); markDirty(); }
function markDirty() {
  const a = JSON.stringify(ddState.map(x => ({...x}))), b = JSON.stringify(ddBase.map(x => ({...x})));
  $('dd-dirty').textContent = a !== b ? '⚠ Có thay đổi chưa lưu' : '';
}
function calcDD() {
  const total = ddState.length, present = ddState.filter(s => s.status === 'Hiện diện').length, perm = ddState.filter(s => s.status === 'Có phép').length;
  $('dd-summary').textContent = 'Sĩ số ' + total + ' · Có mặt ' + present + ' · Có phép ' + perm + ' · Vắng ' + (total - present - perm);
}
async function saveAttendance() {
  const body = {schoolYear: year(), weekOf: $('dd-week').value, session: $('dd-buoi').value, className: $('dd-lop').value,
    records: ddState.map(x => ({idNumber:x.idNumber, status:x.status || 'Vắng', note:x.note || ''}))};
  try { await api('saveAttendance', body); }
  catch (e) { return toast(e.message); }
  ddBase = ddState.map(x => ({...x}));
  markDirty();
  toast('Đã lưu điểm danh.');
  renderTK(); renderToanDoan();
}

/* ---------- Trích lục ---------- */
function renderTL() { searchCard($('tl-id').value.trim(), 'tl-out'); }

/* ---------- Thống kê điểm danh ---------- */
const avgOf = x => { const vs = SESSIONS.map(s => x[s]).filter(v => v != null && v !== '').map(Number); return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null; };
async function renderTK() {
  const cls = $('tk-lop').value;
  if (!cls) return;
  let r;
  try { r = await api('getClassAttendanceStats', {schoolYear: year(), className: cls}); }
  catch (e) { return toast(e.message); }
  const rows = r.stats || [];
  $('tk-tbody').innerHTML = rows.length
    ? rows.map((x, i) => '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border font-medium">' + esc(x.fullName) + '</td>' +
        SESSIONS.map(s => '<td class="p-2 border text-center">' + (x[s] == null ? '—' : x[s] + '%') + '</td>').join('') +
        '<td class="p-2 border text-center font-bold">' + fmt1(avgOf(x)) + '</td></tr>').join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}
async function renderToanDoan() {
  if (!isExec()) return;
  let r;
  try { r = await api('getClassAttendanceStats', {wholeDeanery: true}); }
  catch (e) { return toast(e.message); }
  const rows = r.stats || [];
  const byClass = {};
  rows.forEach(x => { (byClass[x.className] = byClass[x.className] || []).push(x); });
  let body = '';
  TCLASSES.forEach(c => {
    const list = byClass[c.ClassName] || [];
    list.forEach((x, i) => {
      const avg = avgOf(x);
      body += '<tr>' + (i === 0 ? '<td class="p-2 border text-center font-bold" rowspan="' + (list.length || 1) + '">' + esc(c.ClassName) + '</td>' : '') +
        '<td class="p-2 border">' + esc(x.fullName) + '</td>' +
        SESSIONS.map(s => '<td class="p-2 border text-center">' + (x[s] == null ? '—' : x[s] + '%') + '</td>').join('') +
        '<td class="p-2 border text-center font-bold">' + fmt1(avg) + '</td>' +
        '<td class="p-2 border text-center">' + rankBadge(avg) + '</td></tr>';
    });
  });
  $('td-tbody').innerHTML = body || '<tr><td colspan="8" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
  const colAvg = key => { const vs = rows.map(x => x[key]).filter(v => v != null && v !== '').map(Number); return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null; };
  const avgs = rows.map(avgOf).filter(v => v != null);
  $('td-total').textContent = avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) + '%' : '—';
  $('td-sun').textContent = colAvg(SESSIONS[0]) == null ? '—' : colAvg(SESSIONS[0]) + '%';
  $('td-thu').textContent = colAvg(SESSIONS[3]) == null ? '—' : colAvg(SESSIONS[3]) + '%';
}

/* ---------- Sự kiện ---------- */
$('dd-lop').addEventListener('change', renderDD);
$('dd-week').addEventListener('change', () => { normSunday($('dd-week')); renderDD(); });
$('dd-buoi').addEventListener('change', renderDD);
$('dd-markall').addEventListener('click', markAllPresent);
$('dd-refresh').addEventListener('click', renderDD);
$('dd-save').addEventListener('click', saveAttendance);
$('dd-tbody').addEventListener('change', e => {
  const cb = e.target.closest('.attendance-checkbox');
  if (cb) handleCheck(+cb.dataset.i, cb.dataset.which);
});
$('dd-tbody').addEventListener('input', e => {
  const inp = e.target.closest('input[data-i]');
  if (inp) noteInput(+inp.dataset.i);
});
$('tl-search').addEventListener('click', renderTL);
$('tk-lop').addEventListener('change', renderTK);
$('tk-excel').addEventListener('click', () => exportExcel('tk-table', 'Thống kê chuyên cần lớp'));
$('tk-print').addEventListener('click', () => window.print());
$('td-excel').addEventListener('click', () => exportExcel('td-table', 'Thống kê toàn đoàn'));
$('td-print').addEventListener('click', () => window.print());

renderDD(); renderTK(); renderToanDoan();
