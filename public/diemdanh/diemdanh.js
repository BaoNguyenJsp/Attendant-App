/* =====================================================================
   SỔ THIẾU NHI — diemdanh/index.js
   Điểm danh theo (Lớp, Tuần, Buổi) + trích lục CCCD + thống kê lớp/toàn đoàn.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, SESSIONS, TCLASSES, year, defaultWeek, normSunday, fillClasses, fillSessions, exportExcel } from '../shared/common.js';
import { rankBadge } from '../shared/ui.js';

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
  ddBase = (r.records || []).map(x => ({idNumber:x.idNumber, saintName:x.saintName || '', fullName:x.fullName, status:x.status || '', note:x.note || ''}));
  ddState = ddBase.map(x => ({...x}));
  renderDDTable();
}
function renderDDTable() {
  const tb = $('dd-tbody');
  tb.innerHTML = ddState.map((s, i) => {
    const present = s.status === 'Hiện diện', permission = s.status === 'Có phép';
    return '<tr data-i="' + i + '" class="' + (s.status === 'Vắng' ? 'bg-red-50' : '') + '">' +
      '<td class="p-2 border text-center">' + (i + 1) + '</td>' +
      '<td class="p-2 border">' + esc(s.idNumber) + '</td>' +
      '<td class="p-2 border">' + esc(s.saintName) + '</td>' +
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
    records: ddState.map(x => ({idNumber:x.idNumber, status:x.status || '', note:x.note || ''}))};
  try { await api('saveAttendance', body); }
  catch (e) { return toast(e.message); }
  ddBase = ddState.map(x => ({...x}));
  markDirty();
  toast('Đã lưu điểm danh.');
  renderTK(); renderToanDoan();
}

/* ---------- Trích lục ---------- */
async function renderTL() {
  const id = $('tl-id').value.trim();
  const out = $('tl-out');
  if (!id) return out.innerHTML = '<p class="text-amber-600 font-medium">Nhập số CCCD.</p>';
  let r;
  try { r = await api('searchByIdNumber', {idNumber: id}); }
  catch (e) { return out.innerHTML = '<p class="text-amber-600 font-medium">' + esc(e.message) + '</p>'; }
  const st = (r.students || [])[0];
  if (!st) return out.innerHTML = '<p class="text-amber-600 font-medium">Không tìm thấy học sinh với số CCCD này.</p>';
  const abs = (r.absences || []).sort((a, b) => String(a.WeekOf).localeCompare(String(b.WeekOf)));
  out.innerHTML =
    '<div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">' +
      '<h3 class="text-lg font-extrabold text-blue-900">' + esc((st.SaintName ? st.SaintName + ' ' : '') + st.FullName) + '</h3>' +
      '<dl class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm mt-2">' +
        '<div><dt class="text-xs font-bold text-slate-500 uppercase">Số CCCD</dt><dd class="font-semibold">' + esc(st.IdNumber) + '</dd></div>' +
        '<div><dt class="text-xs font-bold text-slate-500 uppercase">Tình trạng</dt><dd class="font-semibold">' + esc(st.Status) + '</dd></div>' +
        '<div><dt class="text-xs font-bold text-slate-500 uppercase">Lớp</dt><dd class="font-semibold">' + esc(st.CurrentClass) + '</dd></div>' +
      '</dl></div>' +
    '<div style="overflow-x:auto"><table class="w-full text-sm border-collapse min-w-[560px]" id="tl-table">' +
      '<thead><tr class="bg-blue-900 text-white text-xs uppercase font-bold text-center">' +
        '<th class="p-3">Tuần</th><th class="p-3">Buổi</th><th class="p-3">Tình trạng</th><th class="p-3">Ghi chú</th></tr></thead>' +
      '<tbody>' + (abs.length ? abs.map(a => '<tr>' +
        '<td class="p-2 border text-center">' + esc(a.WeekOf) + '</td>' +
        '<td class="p-2 border text-center">' + esc(a.Session) + '</td>' +
        '<td class="p-2 border text-center">' + esc(a.AttendanceStatus || 'Vắng') + '</td>' +
        '<td class="p-2 border">' + esc(a.Note) + '</td></tr>').join('')
        : '<tr><td colspan="4" class="p-4 text-center text-slate-400">Không có buổi vắng trong năm học này.</td></tr>') + '</tbody></table></div>';
}

/* ---------- Thống kê điểm danh ---------- */
const pct = (p, m) => m ? Math.round(p / m * 100) + '%' : '—';
async function renderTK() {
  const cls = $('tk-lop').value;
  if (!cls) return;
  let r;
  try { r = await api('getClassAttendanceStats', {schoolYear: year(), className: cls}); }
  catch (e) { return toast(e.message); }
  const rows = r.stats || [], max = r.max || {}, maxTotal = r.maxTotal || 0;
  $('tk-tbody').innerHTML = rows.length
    ? rows.map((x, i) => {
        const sum = SESSIONS.reduce((a, s) => a + (x.present[s] || 0), 0);
        return '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border font-medium">' + esc(x.fullName) + '</td>' +
          SESSIONS.map(s => '<td class="p-2 border text-center">' + pct(x.present[s] || 0, max[s] || 0) + '</td>').join('') +
          '<td class="p-2 border text-center font-bold">' + pct(sum, maxTotal) + '</td></tr>';
      }).join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}
async function renderToanDoan() {
  let r;
  try { r = await api('getClassAttendanceStats', {wholeDeanery: true}); }
  catch (e) { return toast(e.message); }
  const rows = r.stats || [], max = r.max || {}, maxTotal = r.maxTotal || 0;
  const byClass = {};
  rows.forEach(x => { (byClass[x.className] = byClass[x.className] || []).push(x); });
  const presentSum = (list, s) => list.reduce((a, x) => a + (x.present[s] || 0), 0);
  let body = '';
  TCLASSES.forEach(c => {
    const list = byClass[c.ClassName] || [];
    if (!list.length) return;
    const sess = SESSIONS.map(s => presentSum(list, s));
    const total = sess.reduce((a, b) => a + b, 0), size = list.length, overall = maxTotal * size;
    body += '<tr>' +
      '<td class="p-2 border text-center font-bold">' + esc(c.ClassName) + '</td>' +
      '<td class="p-2 border text-center">' + size + '</td>' +
      SESSIONS.map((s, i) => '<td class="p-2 border text-center">' + pct(sess[i], (max[s] || 0) * size) + '</td>').join('') +
      '<td class="p-2 border text-center font-bold">' + pct(total, overall) + '</td>' +
      // ponytail: Xếp loại tạm = rankBadge theo tỉ lệ chung lớp (≥85 Tốt, ≥70 Khá). Logic thật ghi sau (req 10).
      '<td class="p-2 border text-center">' + rankBadge(overall ? Math.round(total / overall * 100) : null) + '</td></tr>';
  });
  $('td-tbody').innerHTML = body || '<tr><td colspan="8" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
  const n = rows.length, sun = presentSum(rows, SESSIONS[0]), thu = presentSum(rows, SESSIONS[3]);
  $('td-total').textContent = n;
  $('td-sun').textContent = pct(sun, (max[SESSIONS[0]] || 0) * n);
  $('td-thu').textContent = pct(thu, (max[SESSIONS[3]] || 0) * n);
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
$('tl-excel').addEventListener('click', () => exportExcel('tl-table', 'Trích lục CCCD'));
$('tk-lop').addEventListener('change', renderTK);
$('tk-excel').addEventListener('click', () => exportExcel('tk-table', 'Thống kê chuyên cần lớp'));
$('tk-print').addEventListener('click', () => window.print());
$('td-excel').addEventListener('click', () => exportExcel('td-table', 'Thống kê toàn đoàn'));
$('td-print').addEventListener('click', () => window.print());

renderDD(); renderTK(); renderToanDoan();
