/* =====================================================================
   SỔ THIẾU NHI — giaovien/index.js
   Điểm danh Huynh trưởng theo (Ngành, Tuần, Buổi 5 buổi) + trích lục tên/email
   + thống kê theo Ngành/Lớp (mọi buổi + Họp Huynh Trưởng + Tỉ lệ hiện diện).
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, SESSIONS, cur, year, defaultWeek, normSunday, isExec, isAdmin, fillSel, exportExcel } from '../shared/common.js';

await initCommon();

const TSESS = [...SESSIONS, 'Họp Huynh Trưởng'];

const XUDOAN = '__Xudoan__';

const { users = [], groups = [] } = await api('getTeachers');
const USERS = users;
const NGANH = groups.filter(g => g.Type === 'Ngành');

let gvddBase = [], gvddState = [];

/* ---------- Selects: Ngành (admin: mọi Ngành + Xứ đoàn; BQT: ngành mình) ---------- */
function fillNganh(id) {
  const opts = isAdmin()
    ? NGANH.map(g => ({v:g.GroupName, t:g.GroupName})).concat([{v:XUDOAN, t:'Xứ đoàn'}])
    : (cur.sectors || []).map(s => ({v:s, t:s}));
  fillSel(id, opts);
  if ($(id).options.length) $(id).selectedIndex = 0;
}
function fillLop() {
  const g = $('gvtk-nganh').value;
  const grp = NGANH.find(x => x.GroupName === g);
  const cls = grp ? String(grp.Scope || '').split(',').map(s => s.trim()).filter(Boolean) : [];
  fillSel('gvtk-lop', [{v:'', t:'Tất cả'}].concat(cls.map(c => ({v:c}))));
}

/* ---------- Điểm danh Huynh trưởng ---------- */
async function renderGVDD() {
  if (!isExec()) return;
  if (!$('gvdd-week').value) $('gvdd-week').value = defaultWeek();
  const body = {sector: $('gvdd-nganh').value, weekOf: $('gvdd-week').value, session: $('gvdd-session').value};
  let r;
  try { r = await api('getTeacherAttendance', body); }
  catch (e) { return toast(e.message); }
  const note = $('gvdd-holiday-note');
  if (r.isHolidayWeek) { note.style.display = 'block'; note.textContent = '⚠ Tuần này là ngày nghỉ đã khai báo trong mục Quản trị.'; }
  else note.style.display = 'none';
  gvddBase = (r.roster || []).map(x => ({id:x.id, email:x.email, fullName:x.fullName, saintName:x.saintName || '', className:x.className || '', status:x.status || '', note:x.note || ''}));
  gvddState = gvddBase.map(x => ({...x}));
  renderGVDDTable();
}
function renderGVDDTable() {
  const tb = $('gvdd-tbody');
  tb.innerHTML = gvddState.length
    ? gvddState.map((s, i) => {
        const present = s.status === 'Hiện diện', permission = s.status === 'Có phép';
        return '<tr data-i="' + i + '" class="' + (s.status === 'Vắng' ? 'bg-red-50' : '') + '">' +
          '<td class="p-2 border text-center">' + esc(s.id) + '</td>' +
          '<td class="p-2 border text-xs">' + esc(s.email) + '</td>' +
          '<td class="p-2 border font-medium">' + esc([s.saintName, s.fullName].filter(Boolean).join(' ')) + '</td>' +
          '<td class="p-2 border text-center">' + esc(s.className) + '</td>' +
          '<td class="p-2 border text-center"><input type="checkbox" class="attendance-checkbox" data-i="' + i + '" data-which="present" ' + (present ? 'checked' : '') + '></td>' +
          '<td class="p-2 border text-center"><input type="checkbox" class="attendance-checkbox" data-i="' + i + '" data-which="permission" ' + (permission ? 'checked' : '') + '></td>' +
          '<td class="p-2 border"><input type="text" data-i="' + i + '" class="w-full border p-1.5 rounded text-sm" value="' + esc(s.note) + '" placeholder="Ghi chú…"></td>' +
          '</tr>';
      }).join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có Huynh trưởng trong phạm vi này.</td></tr>';
  calcGVDD();
}
function handleTCheck(i, which) {
  const row = $('gvdd-tbody').querySelector('tr[data-i="' + i + '"]');
  if (row) gvddState[i].note = row.querySelector('input[type="text"]').value || '';
  const s = gvddState[i];
  s.status = which === 'present' ? (s.status === 'Hiện diện' ? 'Vắng' : 'Hiện diện') : (s.status === 'Có phép' ? 'Vắng' : 'Có phép');
  renderGVDDTable();
  markDirtyGVDD();
}
function noteTInput(i) {
  const row = $('gvdd-tbody').querySelector('tr[data-i="' + i + '"]');
  if (row) gvddState[i].note = row.querySelector('input[type="text"]').value || '';
  markDirtyGVDD();
}
function markAllGVDD() {
  gvddState.forEach(s => s.status = 'Hiện diện');
  renderGVDDTable();
  markDirtyGVDD();
}
function markDirtyGVDD() {
  const a = JSON.stringify(gvddState.map(x => ({...x}))), b = JSON.stringify(gvddBase.map(x => ({...x})));
  $('gvdd-dirty').style.display = a !== b ? 'inline-block' : 'none';
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
  markDirtyGVDD();
  toast('Đã lưu điểm danh Huynh trưởng.');
  renderGVTK();
}

/* ---------- Trích lục (không có CCCD → tra theo tên/email) ---------- */
async function showTrich(u) {
  const out = $('gvtrich-out');
  out.innerHTML = '<p class="text-slate-500 text-sm">Đang tra cứu…</p>';
  let r;
  try { r = await api('getTeacherTrichLuc', {teacherEmail: u.Email}); }
  catch (e) { return out.innerHTML = '<p class="text-amber-600 font-medium">' + esc(e.message) + '</p>'; }
  if (!r.teacher) return out.innerHTML = '<p class="text-amber-600 font-medium">Không tìm thấy tài khoản Huynh trưởng này.</p>';
  const t = r.teacher, abs = (r.absences || []).sort((a, b) => String(a.WeekOf).localeCompare(String(b.WeekOf)));
  out.innerHTML =
    '<div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">' +
      '<h3 class="text-lg font-extrabold text-blue-900">' + esc([t.saintName, t.fullName].filter(Boolean).join(' ')) + '</h3>' +
      '<dl class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm mt-2">' +
        '<div><dt class="text-xs font-bold text-slate-500 uppercase">Email</dt><dd class="font-semibold">' + esc(t.email) + '</dd></div>' +
        '<div><dt class="text-xs font-bold text-slate-500 uppercase">Năm học</dt><dd class="font-semibold">' + esc(year()) + '</dd></div>' +
      '</dl></div>' +
    '<div style="overflow-x:auto"><table class="w-full text-sm border-collapse min-w-[560px]" id="gvtrich-table">' +
      '<thead><tr class="bg-blue-900 text-white text-xs uppercase font-bold text-center">' +
        '<th class="p-3">Tuần</th><th class="p-3">Buổi</th><th class="p-3">Tình trạng</th><th class="p-3">Ghi chú</th></tr></thead>' +
      '<tbody>' + (abs.length ? abs.map(a => '<tr>' +
        '<td class="p-2 border text-center">' + esc(a.WeekOf) + '</td>' +
        '<td class="p-2 border text-center">' + esc(a.Session) + '</td>' +
        '<td class="p-2 border text-center">' + esc(a.Status || 'Vắng') + '</td>' +
        '<td class="p-2 border">' + esc(a.Note) + '</td></tr>').join('')
        : '<tr><td colspan="4" class="p-4 text-center text-slate-400">Không có buổi vắng trong năm học này.</td></tr>') + '</tbody></table></div>';
}
async function renderTrich() {
  const q = $('gvtrich-q').value.trim().toLowerCase();
  const out = $('gvtrich-out');
  if (!q) return out.innerHTML = '<p class="text-amber-600 font-medium">Nhập tên hoặc email Huynh trưởng.</p>';
  const hits = USERS.filter(u => String(u.FullName || '').toLowerCase().includes(q) || String(u.Email || '').toLowerCase().includes(q));
  if (!hits.length) return out.innerHTML = '<p class="text-amber-600 font-medium">Không tìm thấy Huynh trưởng nào.</p>';
  if (hits.length === 1) return showTrich(hits[0]);
  out.innerHTML = '<p class="text-sm text-slate-500 mb-2">Có ' + hits.length + ' Huynh trưởng khớp, chọn một:</p>' +
    hits.map(u => '<button type="button" class="trich-pick block w-full text-left border bg-white hover:bg-blue-50 rounded-lg px-4 py-2.5 mb-2" data-email="' + esc(u.Email) + '">' +
      '<span class="font-semibold">' + esc(u.FullName) + '</span> <span class="text-xs text-slate-400">' + esc(u.Email) + '</span></button>').join('');
}

/* ---------- Thống kê ---------- */
const pct = (p, m) => m ? Math.round(p / m * 100) + '%' : '—';
async function renderGVTK() {
  if (!isExec()) return;
  const lop = $('gvtk-lop').value;
  let r;
  try { r = await api('getTeacherStats', {sector: $('gvtk-nganh').value, className: lop || undefined}); }
  catch (e) { return toast(e.message); }
  const rows = r.stats || [], max = r.max || {}, maxTotal = r.maxTotal || 0;
  $('gvtk-tbody').innerHTML = rows.length
    ? rows.map((x, i) => {
        const sum = TSESS.reduce((a, s) => a + (x.present[s] || 0), 0);
        return '<tr><td class="p-2 border text-center">' + esc(x.id) + '</td>' +
          '<td class="p-2 border font-medium">' + esc(x.fullName) + '</td>' +
          '<td class="p-2 border text-xs">' + esc(x.email) + '</td>' +
          '<td class="p-2 border text-center">' + esc(x.className) + '</td>' +
          '<td class="p-2 border text-center">' + (x.taught || 0) + '</td>' +
          TSESS.map(s => '<td class="p-2 border text-center">' + pct(x.present[s] || 0, max[s] || 0) + '</td>').join('') +
          '<td class="p-2 border text-center font-bold">' + pct(sum, maxTotal) + '</td></tr>';
      }).join('')
    : '<tr><td colspan="11" class="p-4 text-center text-slate-400">Chưa có Huynh trưởng trong phạm vi này.</td></tr>';
}

/* ---------- Sự kiện ---------- */
$('gvdd-nganh').addEventListener('change', renderGVDD);
$('gvdd-week').addEventListener('change', () => { normSunday($('gvdd-week')); renderGVDD(); });
$('gvdd-session').addEventListener('change', renderGVDD);
$('gvdd-refresh').addEventListener('click', renderGVDD);
$('gvdd-markall').addEventListener('click', markAllGVDD);
$('gvdd-save').addEventListener('click', saveGVDD);
$('gvdd-tbody').addEventListener('change', e => {
  const cb = e.target.closest('.attendance-checkbox');
  if (cb) handleTCheck(+cb.dataset.i, cb.dataset.which);
});
$('gvdd-tbody').addEventListener('input', e => {
  const inp = e.target.closest('input[data-i]');
  if (inp) noteTInput(+inp.dataset.i);
});
$('gvtrich-q').addEventListener('keydown', e => { if (e.key === 'Enter') renderTrich(); });
$('gvtrich-search').addEventListener('click', renderTrich);
$('gvtrich-out').addEventListener('click', e => {
  const b = e.target.closest('.trich-pick');
  if (!b) return;
  const u = USERS.find(x => String(x.Email).toLowerCase() === String(b.dataset.email).toLowerCase());
  if (u) showTrich(u);
});
$('gvtk-nganh').addEventListener('change', () => { fillLop(); renderGVTK(); });
$('gvtk-lop').addEventListener('change', renderGVTK);
$('gvtk-excel').addEventListener('click', () => exportExcel('gvtk-table', 'Thống kê Huynh trưởng'));
$('gvtk-print').addEventListener('click', () => window.print());

/* ---------- Khởi động ---------- */
fillNganh('gvdd-nganh');
fillNganh('gvtk-nganh');
fillSel('gvdd-session', TSESS.map(s => ({v:s})));
fillLop();
$('gvdd-week').value = defaultWeek();
renderGVDD(); renderGVTK();
