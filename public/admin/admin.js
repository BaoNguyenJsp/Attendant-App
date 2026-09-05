/* =====================================================================
   SỔ THIẾU NHI — admin/index.js
   Huynh trưởng · Nhóm · Lớp · Nghỉ lễ · Chuyển năm.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, SESSIONS, TYPES, TCLASSES, THOLIDAYS, USERS_ROWS, GROUPS_LIST, GROUP_MEMBERS, year, normSunday, defaultWeek, fillSel } from '../shared/common.js';
import { groupBadge, badgeStatus, activeStudents } from '../shared/ui.js';

await initCommon();

const emLower = e => String(e == null ? '' : e).trim().toLowerCase();
const fullName = u => [u.SaintName, u.FullName].filter(Boolean).join(' ');
// Bỏ dấu (NFD tách + \p{M}) + đ→d → gõ "nguyen van a" hay "đức" vẫn khớp "Nguyễn Văn A"/"Đức".
const viKey = s => String(s == null ? '' : s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd');
const hay = u => viKey([u.SaintName, u.FullName].filter(Boolean).join(' ') + ' ' + u.Email + ' ' + u.SDT);
const chip = g => '<span class="badge ' + (TYPES[g.Type] || 'b-class') + '">' + esc(g.GroupName || '') + '</span>';
const userGroups = em => {
  const e = emLower(em);
  return GROUPS_LIST.filter(g => GROUP_MEMBERS.some(m => m.GroupName === g.GroupName && emLower(m.Email) === e));
};
const groupNames = em => userGroups(em).map(g => g.GroupName);

async function hydrate() {
  const te = await api('getTeachers');
  const [st, cl, hol] = await Promise.all([api('getStudents'), api('getClasses'), api('getHolidays')]);
  setState({TSTUDENTS: st.students || [], TCLASSES: cl.classes || [], THOLIDAYS: hol.holidays || [],
    USERS_ROWS: te.users || [], GROUP_MEMBERS: te.members || [], GROUPS_LIST: te.groups || []});
}
await hydrate();

/* ---------- Huynh trưởng ---------- */
function renderUs() {
  const q = viKey($('us-q').value);
  const rows = USERS_ROWS.filter(u => !q || hay(u).includes(q));
  $('us-tbody').innerHTML = rows.length
    ? rows.map(u => '<tr><td class="p-2 border text-center">' + esc(u.Id) + '</td>' +
        '<td class="p-2 border text-xs">' + esc(u.Email) + '</td>' +
        '<td class="p-2 border font-medium">' + esc(fullName(u)) + '</td>' +
        '<td class="p-2 border text-center">' + esc(u.SDT || '') + '</td>' +
        '<td class="p-2 border">' + (userGroups(u.Email).map(chip).join('') || '<span class="text-slate-400">—</span>') + '</td>' +
        '<td class="p-2 border text-center">' + badgeStatus(u.Status) + '</td>' +
        '<td class="p-2 border text-center whitespace-nowrap">' +
          '<button data-email="' + esc(u.Email) + '" class="edit-user bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs px-3 py-1.5 rounded-lg">✏️ Sửa</button></td></tr>').join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Không có người dùng khớp.</td></tr>';
}

/* ---------- Nhóm ---------- */
function renderGroups() {
  $('grp-tbody').innerHTML = GROUPS_LIST.map(g => '<tr><td class="p-2 border font-medium">' + esc(g.GroupName) + '</td>' +
    '<td class="p-2 border">' + groupBadge(g) + '</td><td class="p-2 border text-xs">' + esc(g.Scope || '') + '</td></tr>').join('');
}

/* ---------- Lớp ---------- */
function renderCls() {
  $('cls-tbody').innerHTML = TCLASSES.map((c, i) => '<tr><td class="p-2 border text-center">' + (i + 1) + '</td>' +
    '<td class="p-2 border font-medium">' + esc(c.ClassName) + '</td>' +
    '<td class="p-2 border">' + esc(c.Grade || '') + '</td><td class="p-2 border text-center">' + activeStudents(c.ClassName).length + '</td></tr>').join('');
}

/* ---------- Nghỉ lễ ---------- */
const holLabel = s => s || '— Cả tuần —';
function renderHolidays() {
  const list = THOLIDAYS.sort((a, b) => String(a.weekOf).localeCompare(String(b.weekOf)) || String(a.session).localeCompare(String(b.session)));
  $('hol-tbody').innerHTML = list.length
    ? list.map((h, i) => '<tr><td class="p-2 border">' + esc(h.weekOf) + '</td>' +
        '<td class="p-2 border text-center">' + esc(holLabel(h.session)) + '</td>' +
        '<td class="p-2 border">' + esc(h.reason) + '</td>' +
        '<td class="p-2 border text-center"><button data-i="' + i + '" class="hol-del bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg">🗑</button></td></tr>').join('')
    : '<tr><td colspan="4" class="p-4 text-center text-slate-400">Chưa có ngày nghỉ cho năm hiện tại.</td></tr>';
}
async function addHoliday() {
  const wk = $('hol-week').value;
  if (!wk) return toast('Chọn tuần (Chủ Nhật) cho ngày nghỉ.');
  const reason = $('hol-reason').value.trim();
  if (!reason) return toast('Nhập lý do nghỉ.');
  const ses = $('hol-session').value;
  if (THOLIDAYS.some(h => h.weekOf === wk && (h.session || '') === ses)) return toast('Ngày nghỉ tuần này đã có.');
  const next = THOLIDAYS.concat([{weekOf: wk, session: ses, reason}]);
  try { await api('saveHolidays', {holidays: next}); setState({THOLIDAYS: next}); }
  catch (e) { return toast(e.message); }
  $('hol-reason').value = '';
  renderHolidays();
  toast('Đã thêm ngày nghỉ.');
}
async function delHoliday(i) {
  const h = THOLIDAYS[i];
  if (!h) return;
  if (!confirm('Xóa ngày nghỉ ' + holLabel(h.session) + ' tuần ' + h.weekOf + '?')) return;
  const next = THOLIDAYS.filter((_, j) => j !== i);
  try { await api('saveHolidays', {holidays: next}); setState({THOLIDAYS: next}); }
  catch (e) { return toast(e.message); }
  renderHolidays();
  toast('Đã xóa ngày nghỉ.');
}

/* ---------- User modal ---------- */
function groupCbs(email) {
  const sel = new Set(groupNames(email));
  $('us-m-groups').innerHTML = GROUPS_LIST.length
    ? GROUPS_LIST.map(g => '<label class="flex items-center gap-2 text-sm rounded px-2 py-1 cursor-pointer hover:bg-slate-100">' +
        '<input type="checkbox" class="us-g-cb" value="' + esc(g.GroupName) + '"' + (sel.has(g.GroupName) ? ' checked' : '') + '>' +
        esc(g.GroupName) + '</label>').join('')
    : '<span class="text-xs text-slate-400">Chưa có nhóm nào trong Groups.</span>';
}
function openUser(email) {
  const u = email ? USERS_ROWS.find(x => emLower(x.Email) === emLower(email)) : null;
  $('us-m-title').textContent = u ? 'Cập Nhật Huynh trưởng / Người Dùng' : 'Thêm Huynh trưởng / Người Dùng';
  $('us-m-email').disabled = !!u;
  $('us-m-email').value = u ? u.Email : '';
  $('us-m-saint').value = u ? (u.SaintName || '') : '';
  $('us-m-full').value = u ? (u.FullName || '') : '';
  $('us-m-sdt').value = u ? (u.SDT || '') : '';
  $('us-m-status').value = u ? (u.Status || 'Hoạt động') : 'Hoạt động';
  groupCbs(email);
  $('us-modal').classList.add('open');
  $('us-m-email').focus();
}
function closeUser() { $('us-modal').classList.remove('open'); }
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
async function saveUserModal() {
  const email = emLower($('us-m-email').value);
  if (!email) return toast('Nhập Email Google.');
  if (!$('us-m-full').value.trim()) return toast('Nhập Họ và tên.');
  const user = {email, saintName: $('us-m-saint').value.trim(), fullName: $('us-m-full').value.trim(),
    sdt: $('us-m-sdt').value.trim(), status: $('us-m-status').value};
  let saved;
  try { saved = (await api('saveUser', {user})).user; }
  catch (e) { return toast(e.message); }
  const i = USERS_ROWS.findIndex(u => emLower(u.Email) === email);
  if (i >= 0) USERS_ROWS[i] = saved; else USERS_ROWS.push(saved);
  const groups = [...document.querySelectorAll('#us-m-groups .us-g-cb:checked')].map(cb => cb.value);
  if (!sameSet(groupNames(email), groups)) {
    try {
      await api('saveGroupMembers', {assignments: [{email, groups}]});
      setState({GROUP_MEMBERS: GROUP_MEMBERS.filter(m => emLower(m.Email) !== email)
        .concat(groups.map(g => ({GroupName: g, Email: email})))});
    }
    catch (e) { toast('Đã lưu hồ sơ, nhưng lỗi khi lưu nhóm: ' + e.message); }
  }
  closeUser();
  renderUs();
  toast('Đã lưu.');
}

/* ---------- Chuyển năm ---------- */
const nextYear = y => { const [a, b] = String(y).split('-'); return (+a + 1) + '-' + (+b + 1); };
function openYear() {
  $('yr-old').textContent = year();
  $('yr-new').textContent = nextYear(year());
  $('sy-start').value = '';
  $('year-modal').classList.add('open');
}
function closeYear() { $('year-modal').classList.remove('open'); }
async function confirmYear() {
  const start = $('sy-start').value;
  if (!start) return toast('Chọn ngày bắt đầu năm học mới (Chủ Nhật).');
  const nw = nextYear(year());
  if (!confirm('Chuyển sang năm học ' + nw + '?\n\n' +
    '① Chốt điểm + chuyên cần năm ' + year() + ' vào AcademicYear (học bạ).\n' +
    '② Xóa sạch Attendance, TeacherAttendance, Holidays.\n' +
    '③ Thiếu nhi đang Hoạt động tự lên lớp kế tiếp; lớp cuối giữ nguyên.\n' +
    '\nHành động phá hủy — không thể hoàn tác.')) return;
  try { await api('startSchoolYear', {attendanceStartDate: start}); }
  catch (e) { return toast(e.message); }
  closeYear();
  setState({YEAR: nw});
  await hydrate();
  renderAll();
  toast('Đã chuyển sang năm học ' + nw + '.');
}

/* ---------- Sự kiện ---------- */
$('us-q').addEventListener('input', renderUs);
$('us-add').addEventListener('click', () => openUser());
$('us-tbody').addEventListener('click', e => {
  const b = e.target.closest('.edit-user');
  if (b) openUser(b.dataset.email);
});
$('hol-week').addEventListener('change', () => normSunday($('hol-week')));
$('hol-add').addEventListener('click', addHoliday);
$('hol-tbody').addEventListener('click', e => {
  const b = e.target.closest('.hol-del');
  if (b) delHoliday(+b.dataset.i);
});
$('year-open').addEventListener('click', openYear);

const um = $('us-modal');
um.addEventListener('click', e => { if (e.target === um) closeUser(); });
um.querySelector('.btn-cancel').addEventListener('click', closeUser);
um.querySelector('.btn-save').addEventListener('click', saveUserModal);
um.addEventListener('keydown', e => { if (e.key === 'Escape') closeUser(); });

const ym = $('year-modal');
ym.addEventListener('click', e => { if (e.target === ym) closeYear(); });
ym.querySelector('.btn-cancel').addEventListener('click', closeYear);
$('sy-confirm').addEventListener('click', confirmYear);
ym.addEventListener('keydown', e => { if (e.key === 'Escape') closeYear(); });

function renderAll() { renderUs(); renderGroups(); renderCls(); renderHolidays(); }

/* ---------- Khởi động ---------- */
fillSel('hol-session', [{v: '', t: '— Cả tuần —'}].concat(SESSIONS.map(s => ({v: s}))));
$('hol-week').value = defaultWeek();
renderAll();
