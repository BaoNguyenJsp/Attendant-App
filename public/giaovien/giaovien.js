/* =====================================================================
   SỔ THIẾU NHI — giaovien/index.js
   Điểm danh giáo viên theo ngành + thống kê (BCH ngành / Xứ đoàn).
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, year, defaultWeek, normSunday, isExec, fillSessions, fillSectors, exportExcel } from '../shared/common.js';
import { teachersOf } from '../shared/ui.js';

await initCommon();

fillSessions('gvdd-session');
fillSectors('gvdd-nganh', 'gvtk-nhom');

let gvddBase = [], gvddState = [];

/* ---------- Điểm danh giáo viên ---------- */
async function renderGVDD() {
  if (!isExec()) return;
  const ng = $('gvdd-nganh').value;
  if (!ng) return;
  if (!$('gvdd-week').value) $('gvdd-week').value = defaultWeek();
  const emails = teachersOf(ng);
  let r;
  try { r = await api('getTeacherAttendance', {sector: ng, weekOf: $('gvdd-week').value, session: $('gvdd-session').value}); }
  catch (e) { return toast(e.message); }
  const recs = (r.records || []).filter(x => emails.includes(x.email));
  gvddBase = recs.map(x => ({email:x.email, fullName:x.fullName, status:x.status || 'Hiện diện', note:x.note || ''}));
  gvddState = gvddBase.map(x => ({...x}));
  renderGVDDTable();
}
function renderGVDDTable() {
  $('gvdd-tbody').innerHTML = gvddState.map((s, i) => {
    const present = s.status === 'Hiện diện', permission = s.status === 'Có phép';
    return '<tr data-i="' + i + '" class="' + (present || permission ? '' : 'bg-red-50') + '">' +
      '<td class="p-2 border text-center">' + (i + 1) + '</td>' +
      '<td class="p-2 border text-xs">' + esc(s.email) + '</td>' +
      '<td class="p-2 border font-medium">' + esc(s.fullName) + '</td>' +
      '<td class="p-2 border text-center"><input type="checkbox" class="attendance-checkbox" data-i="' + i + '" data-which="present" ' + (present ? 'checked' : '') + '></td>' +
      '<td class="p-2 border text-center"><input type="checkbox" class="attendance-checkbox" data-i="' + i + '" data-which="permission" ' + (permission ? 'checked' : '') + '></td>' +
      '<td class="p-2 border"><input type="text" data-i="' + i + '" class="w-full border p-1.5 rounded text-sm" value="' + esc(s.note) + '" placeholder="Ghi chú…"></td>' +
      '</tr>';
  }).join('');
  calcGVDD();
}
function handleTCheck(i, which) {
  const row = $('gvdd-tbody').querySelector('tr[data-i="' + i + '"]');
  if (row) gvddState[i].note = row.querySelector('input[type="text"]').value || '';
  const s = gvddState[i];
  s.status = which === 'present' ? (s.status === 'Hiện diện' ? 'Vắng' : 'Hiện diện') : (s.status === 'Có phép' ? 'Vắng' : 'Có phép');
  renderGVDDTable();
}
function noteTInput(i) {
  const row = $('gvdd-tbody').querySelector('tr[data-i="' + i + '"]');
  if (row) gvddState[i].note = row.querySelector('input[type="text"]').value || '';
}
function calcGVDD() {
  const total = gvddState.length, present = gvddState.filter(s => s.status === 'Hiện diện').length, perm = gvddState.filter(s => s.status === 'Có phép').length;
  $('gvdd-summary').textContent = 'Sĩ số ' + total + ' · Có mặt ' + present + ' · Có phép ' + perm + ' · Vắng ' + (total - present - perm);
}
async function saveGVDD() {
  const body = {sector: $('gvdd-nganh').value, weekOf: $('gvdd-week').value, session: $('gvdd-session').value,
    records: gvddState.map(x => ({email:x.email, status:x.status || 'Vắng', note:x.note || ''}))};
  try { await api('saveTeacherAttendance', body); }
  catch (e) { return toast(e.message); }
  gvddBase = gvddState.map(x => ({...x}));
  toast('Đã lưu điểm danh giáo viên.');
  renderGVTK();
}

/* ---------- Thống kê ---------- */
async function renderGVTK() {
  if (!isExec()) return;
  const ng = $('gvtk-nhom').value;
  if (!ng) return;
  const emails = teachersOf(ng);
  let r;
  try { r = await api('getTeacherStats', {sector: ng, schoolYear: year()}); }
  catch (e) { return toast(e.message); }
  const stats = (r.stats || []).filter(x => emails.includes(x.email)).sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)));
  $('gvtk-tbody').innerHTML = stats.length
    ? stats.map(x => '<tr><td class="p-2 border"><div class="font-medium">' + esc(x.fullName) + '</div><div class="text-xs text-slate-400">' + esc(x.email) + '</div></td>' +
        '<td class="p-2 border text-center">' + (x.lessons == null ? '0' : x.lessons) + '</td>' +
        '<td class="p-2 border text-center">' + (x.pct == null ? '—' : Math.round(+x.pct) + '%') + '</td></tr>').join('')
    : '<tr><td colspan="3" class="p-4 text-center text-slate-400">Không có giáo viên trong nhóm này.</td></tr>';
}

/* ---------- Sự kiện ---------- */
$('gvdd-nganh').addEventListener('change', renderGVDD);
$('gvdd-week').addEventListener('change', () => { normSunday($('gvdd-week')); renderGVDD(); });
$('gvdd-session').addEventListener('change', renderGVDD);
$('gvdd-save').addEventListener('click', saveGVDD);
$('gvdd-tbody').addEventListener('change', e => {
  const cb = e.target.closest('.attendance-checkbox');
  if (cb) handleTCheck(+cb.dataset.i, cb.dataset.which);
});
$('gvdd-tbody').addEventListener('input', e => {
  const inp = e.target.closest('input[data-i]');
  if (inp) noteTInput(+inp.dataset.i);
});
$('gvtk-nhom').addEventListener('change', renderGVTK);
$('gvtk-excel').addEventListener('click', () => exportExcel('gvtk-table', 'Thống kê giáo viên'));

renderGVDD(); renderGVTK();
