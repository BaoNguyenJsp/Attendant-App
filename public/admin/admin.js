/* =====================================================================
   SỔ THIẾU NHI — admin/index.js
   Giáo viên · Nhóm · Phân công · Lớp · Nghỉ lễ · Quyền truy cập · Chuyển năm.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, SESSIONS, TSTUDENTS, TCLASSES, THOLIDAYS, USERS_ROWS, GROUPS_LIST, GROUP_MEMBERS, year, normSunday, isAdmin, fillSel, fillYears, fillYearSelects } from '../shared/common.js';
import { groupBadge, badgeStatus, userFull, activeStudents, expandLocal, highestGroup } from '../shared/ui.js';

await initCommon();

const te = await api('getTeachers');
const [st, cl, hol] = await Promise.all([
  api('getStudents'),
  api('getClasses'),
  api('getHolidays', {schoolYear: year()})
]);
setState({TSTUDENTS: st.students || [], TCLASSES: cl.classes || [], THOLIDAYS: hol.holidays || [],
  USERS_ROWS: te.users || [], GROUP_MEMBERS: te.members || [], GROUPS_LIST: te.groups || []});
fillYearSelects('hol-nam');
fillSel('hol-session', [{v:'', t:'— Cả tuần —'}].concat(SESSIONS.map(s => ({v:s}))));

async function hydrate() {
  const te2 = await api('getTeachers');
  const [st2, cl2, hol2] = await Promise.all([
    api('getStudents'), api('getClasses'), api('getHolidays', {schoolYear: year()})
  ]);
  setState({TSTUDENTS: st2.students || [], TCLASSES: cl2.classes || [], THOLIDAYS: hol2.holidays || [],
    USERS_ROWS: te2.users || [], GROUP_MEMBERS: te2.members || [], GROUPS_LIST: te2.groups || []});
}

/* ---------- Giáo viên (users) ---------- */
function renderUs() {
  if (!isAdmin()) return;
  $('us-tbody').innerHTML = USERS_ROWS.map(u => {
    const groups = GROUP_MEMBERS.filter(m => String(m.Email).toLowerCase() === String(u.Email).toLowerCase())
      .map(m => GROUPS_LIST.find(g => g.GroupName === m.GroupName)).filter(Boolean);
    const locked = u.Status !== 'Hoạt động';
    return '<tr><td class="p-2 border">' + esc(u.Email) + '</td><td class="p-2 border font-medium">' + esc(u.FullName || '') + '</td>' +
      '<td class="p-2 border">' + (groups.map(groupBadge).join('') || '<span class="text-slate-400">—</span>') + '</td>' +
      '<td class="p-2 border text-center">' + badgeStatus(u.Status) + '</td>' +
      '<td class="p-2 border text-center">' + (locked
        ? '<button data-email="' + esc(u.Email) + '" data-activate="1" class="block-user bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg">✓ Mở khóa</button>'
        : '<button data-email="' + esc(u.Email) + '" data-activate="0" class="block-user bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg">🔒 Khóa</button>') + '</td></tr>';
  }).join('');
}
async function toggleBlock(email, activate) {
  if (!isAdmin()) return;
  const next = USERS_ROWS.map(u => String(u.Email).toLowerCase() === String(email).toLowerCase()
    ? Object.assign({}, u, {Status: activate ? 'Hoạt động' : 'Ngưng hoạt động'}) : u);
  try { await api('saveUsers', {users: next}); setState({USERS_ROWS: next}); }
  catch (e) { return toast(e.message); }
  toast(activate ? 'Đã mở khóa.' : 'Đã khóa.');
  renderUs(); renderPerm();
}
async function addUser() {
  if (!isAdmin()) return;
  const email = prompt('Email Google:');
  if (!email) return;
  const name = prompt('Họ và tên:');
  if (!name) return;
  const next = USERS_ROWS.concat([{Email: email.trim(), SaintName: '', FullName: name.trim(), Status: 'Hoạt động'}]);
  try { await api('saveUsers', {users: next}); setState({USERS_ROWS: next}); }
  catch (e) { return toast(e.message); }
  toast('Đã thêm người dùng.');
  renderUs();
}

/* ---------- Nhóm ---------- */
function renderGroups() {
  if (!isAdmin()) return;
  $('grp-tbody').innerHTML = GROUPS_LIST.map(g => '<tr><td class="p-2 border font-medium">' + esc(g.GroupName) + '</td>' +
    '<td class="p-2 border">' + groupBadge(g) + '</td><td class="p-2 border text-xs">' + esc(g.Scope || '') + '</td></tr>').join('');
}

/* ---------- Phân công ---------- */
let ASG_VIEW = [];
function renderAsg() {
  if (!isAdmin()) return;
  fillSel('asg-group', GROUPS_LIST.map(g => ({v:g.GroupName})));
  fillSel('asg-user', USERS_ROWS.filter(u => u.Status === 'Hoạt động').map(u => ({v:u.Email})));
  ASG_VIEW = GROUP_MEMBERS.filter(m => m.GroupName === $('asg-group').value);
  $('asg-tbody').innerHTML = ASG_VIEW.length
    ? ASG_VIEW.map((m, i) => '<tr><td class="p-2 border font-medium">' + esc(userFull(m.Email)) + '</td>' +
        '<td class="p-2 border text-xs">' + esc(m.Email) + '</td>' +
        '<td class="p-2 border text-center"><button data-i="' + i + '" class="del-member bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-3 py-1.5 rounded-lg">🗑</button></td></tr>').join('')
    : '<tr><td colspan="3" class="p-4 text-center text-slate-400">Chưa có thành viên.</td></tr>';
}
async function addMember() {
  if (!isAdmin()) return;
  const g = $('asg-group').value, em = String($('asg-user').value || '').toLowerCase();
  if (!g || !em) return toast('Chọn nhóm và giáo viên.');
  if (GROUP_MEMBERS.some(m => m.GroupName === g && String(m.Email).toLowerCase() === em)) return toast('Đã có trong nhóm này.');
  const next = GROUP_MEMBERS.concat([{GroupName: g, Email: em}]);
  try { await api('saveGroupMembers', {members: next}); setState({GROUP_MEMBERS: next}); }
  catch (e) { return toast(e.message); }
  toast('Đã thêm.');
  renderAsg(); renderUs(); renderPerm();
}
async function delMember(i) {
  if (!isAdmin()) return;
  const m = ASG_VIEW[i]; if (!m) return;
  const next = GROUP_MEMBERS.filter(x => !(x.GroupName === m.GroupName && String(x.Email).toLowerCase() === String(m.Email).toLowerCase()));
  try { await api('saveGroupMembers', {members: next}); setState({GROUP_MEMBERS: next}); }
  catch (e) { return toast(e.message); }
  toast('Đã xóa.');
  renderAsg(); renderUs(); renderPerm();
}

/* ---------- Lớp ---------- */
function renderCls() {
  if (!isAdmin()) return;
  $('cls-tbody').innerHTML = TCLASSES.map((c, i) => {
    const n = activeStudents(c.ClassName).length;
    return '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border font-medium">' + esc(c.ClassName) + '</td>' +
      '<td class="p-2 border">' + esc(c.Grade || '') + '</td><td class="p-2 border text-center">' + n + '</td></tr>';
  }).join('');
}

/* ---------- Nghỉ lễ ---------- */
function renderHolidays() {
  if (!isAdmin()) return;
  const nam = $('hol-nam').value;
  const list = THOLIDAYS.filter(h => String(h.SchoolYear) === nam).sort((a, b) => String(a.WeekOf).localeCompare(String(b.WeekOf)));
  $('hol-tbody').innerHTML = list.length
    ? list.map(h => '<tr><td class="p-2 border">' + esc(h.WeekOf) + '</td><td class="p-2 border">' + esc(h.Session || '— Cả tuần —') + '</td><td class="p-2 border">' + esc(h.Reason || '') + '</td></tr>').join('')
    : '<tr><td colspan="3" class="p-4 text-center text-slate-400">Chưa có ngày nghỉ cho năm ' + esc(nam) + '.</td></tr>';
}
async function addHoliday() {
  if (!isAdmin()) return;
  const nam = $('hol-nam').value, wk = $('hol-week').value;
  if (!wk) return toast('Chọn tuần (Chủ Nhật) cho ngày nghỉ.');
  const ses = $('hol-session').value;
  const reason = prompt('Lý do nghỉ (ví dụ: Mùa Chay):');
  if (!reason) return;
  if (THOLIDAYS.some(h => h.SchoolYear === nam && h.WeekOf === wk && (h.Session || '') === ses)) return toast('Ngày nghỉ này đã tồn tại.');
  const next = THOLIDAYS.concat([{SchoolYear: nam, WeekOf: wk, Session: ses, Reason: reason.trim()}]);
  try { await api('saveHolidays', {schoolYear: nam, holidays: next.filter(h => String(h.SchoolYear) === nam)}); setState({THOLIDAYS: next}); }
  catch (e) { return toast(e.message); }
  toast('Đã thêm ngày nghỉ.');
  renderHolidays();
}
async function delHoliday() {
  if (!isAdmin()) return;
  const nam = $('hol-nam').value, wk = $('hol-week').value, ses = $('hol-session').value;
  if (!wk) return toast('Chọn tuần cần xóa.');
  if (!confirm('Xóa ngày nghỉ tuần ' + wk + '?')) return;
  const next = THOLIDAYS.filter(h => !(String(h.SchoolYear) === nam && h.WeekOf === wk && (h.Session || '') === ses));
  try { await api('saveHolidays', {schoolYear: nam, holidays: next.filter(h => String(h.SchoolYear) === nam)}); setState({THOLIDAYS: next}); }
  catch (e) { return toast(e.message); }
  toast('Đã xóa.');
  renderHolidays();
}

/* ---------- Quyền truy cập ---------- */
function renderPerm() {
  if (!isAdmin()) return;
  const groups = GROUPS_LIST;
  $('perm-head').innerHTML = '<tr class="bg-blue-900 text-white text-xs uppercase font-bold text-center"><th class="p-3">Giáo viên</th><th class="p-3">Cấp</th><th class="p-3">Phạm vi</th>' +
    groups.map(g => '<th class="p-3">' + esc(g.GroupName) + '</th>').join('') + '</tr>';
  $('perm-body').innerHTML = USERS_ROWS.map(u => {
    const em = String(u.Email).toLowerCase();
    const gs = groups.filter(g => GROUP_MEMBERS.some(m => m.GroupName === g.GroupName && String(m.Email).toLowerCase() === em));
    const scope = expandLocal(gs);
    const hi = highestGroup(gs);
    return '<tr><td class="p-2 border"><div class="font-medium">' + esc(u.FullName || u.Email) + '</div><div class="text-xs text-slate-400">' + esc(u.Email) + '</div></td>' +
      '<td class="p-2 border text-center">' + (hi ? groupBadge(hi) : '<span class="text-slate-400">—</span>') + '</td>' +
      '<td class="p-2 border text-xs">' + (scope.length ? esc(scope.join(', ')) : '<span class="text-slate-400">—</span>') + '</td>' +
      groups.map(g => '<td class="p-2 border text-center">' + (GROUP_MEMBERS.some(m => m.GroupName === g.GroupName && String(m.Email).toLowerCase() === em) ? '<span class="text-emerald-600 font-bold">✓</span>' : '<span class="text-slate-300">·</span>') + '</td>').join('') + '</tr>';
  }).join('');
}

/* ---------- Chuyển năm ---------- */
async function startYear() {
  if (!isAdmin()) return;
  const next = prompt('Năm học mới (dạng YYYY-YYYY), ví dụ 2027-2028:');
  if (!next) return;
  if (!/^\d{4}-\d{4}$/.test(next.trim())) return toast('Định dạng năm phải là YYYY-YYYY.');
  if (!confirm('Chuyển sang ' + next.trim() + '?\n- Chốt học bạ năm ' + year() + '\n- Thăng lớp (lớp cuối → Tốt nghiệp)\nHành động không thể hoàn tác.')) return;
  try { await api('startSchoolYear', {newYear: next.trim()}); }
  catch (e) { return toast(e.message); }
  toast('Đã chuyển năm học.');
  setState({YEAR: next.trim()});
  await hydrate();
  fillYearSelects('hol-nam');
  renderAsg(); renderUs(); renderGroups(); renderCls(); renderHolidays(); renderPerm();
}

/* ---------- Sự kiện ---------- */
$('us-add').addEventListener('click', addUser);
$('us-tbody').addEventListener('click', e => {
  const btn = e.target.closest('.block-user');
  if (btn) toggleBlock(btn.dataset.email, btn.dataset.activate === '1');
});
$('asg-group').addEventListener('change', renderAsg);
$('asg-add').addEventListener('click', addMember);
$('asg-tbody').addEventListener('click', e => {
  const btn = e.target.closest('.del-member');
  if (btn) delMember(+btn.dataset.i);
});
$('hol-nam').addEventListener('change', renderHolidays);
$('hol-week').addEventListener('change', () => normSunday($('hol-week')));
$('hol-add').addEventListener('click', addHoliday);
$('hol-del').addEventListener('click', delHoliday);
$('year-start').addEventListener('click', startYear);

renderAsg(); renderUs(); renderGroups(); renderCls(); renderHolidays(); renderPerm();
