/* =====================================================================
   SỔ THIẾU NHI — admin/index.js
   Quản trị hệ thống: Huynh trưởng, Nhóm, Lớp, Nghỉ lễ & Chuyển năm học.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, year, isAdmin, SESSIONS, fillSel, normSunday, defaultWeek } from '../shared/common.js';
import { groupBadge } from '../shared/ui.js';

await initCommon();

/* ---------- Tab Cache & Lazy Loading Engine ---------- */
const tabCache = {
  't-us': false,   // Huynh trưởng (Default active tab)
  't-grp': false,  // Nhóm
  't-cls': false,  // Lớp
  't-hol': false,  // Nghỉ lễ
  't-year': true   // Chuyển năm học (Manual trigger view)
};

let ALL_USERS = [], ALL_MEMBERS = [], ALL_GROUPS = [], HOLIDAYS = [];

async function switchTab(tabId) {
  // 1. Toggle visibility of panes and tab button active states
  document.querySelectorAll('[data-pane]').forEach(pane => pane.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (targetPane) targetPane.style.display = 'block';
  if (targetBtn) targetBtn.classList.add('active');

  // 2. Fetch data only if tab is dirty or not loaded yet
  if (!tabCache[tabId]) {
    if (tabId === 't-us') await renderUsers();
    else if (tabId === 't-grp') await renderGroups();
    else if (tabId === 't-cls') await renderClasses();
    else if (tabId === 't-hol') await renderHolidays();
    tabCache[tabId] = true;
  }
}

// Bind click events to tab navigation buttons
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

/* ---------- 1. Quản lý Huynh Trưởng (t-us) ---------- */
async function loadTeacherData() {
  let r;
  try { r = await api('getTeachers'); }
  catch (e) { toast(e.message); return; }
  ALL_USERS = r.users || [];
  ALL_MEMBERS = r.members || [];
  ALL_GROUPS = r.groups || [];
}

async function renderUsers() {
  if (!ALL_USERS.length) await loadTeacherData();
  const q = ($('us-q') ? $('us-q').value : '').trim().toLowerCase();
  
  const memberGroupsMap = new Map();
  ALL_MEMBERS.forEach(m => {
    const email = String(m.Email || '').toLowerCase();
    if (!memberGroupsMap.has(email)) memberGroupsMap.set(email, []);
    const g = ALL_GROUPS.find(x => x.GroupName === m.GroupName);
    memberGroupsMap.get(email).push(g || { GroupName: m.GroupName });
  });

  const filtered = ALL_USERS.filter(u => 
    !q || String(u.FullName || '').toLowerCase().includes(q) || String(u.Email || '').toLowerCase().includes(q)
  );

  const tb = $('us-tbody');
  if (!tb) return;

  tb.innerHTML = filtered.length
    ? filtered.map(u => {
        const uEmail = String(u.Email || '').toLowerCase();
        const gs = memberGroupsMap.get(uEmail) || [];
        const badges = gs.map(g => groupBadge(g)).join(' ') || '<span class="text-slate-400">—</span>';
        return '<tr>' +
          '<td class="p-2 border text-center">' + esc(u.Id || '—') + '</td>' +
          '<td class="p-2 border text-xs">' + esc(u.Email) + '</td>' +
          '<td class="p-2 border font-medium">' + esc([u.SaintName, u.FullName].filter(Boolean).join(' ')) + '</td>' +
          '<td class="p-2 border text-center">' + esc(u.SDT || '—') + '</td>' +
          '<td class="p-2 border">' + badges + '</td>' +
          '<td class="p-2 border text-center">' + esc(u.Status) + '</td>' +
          '<td class="p-2 border text-center"><button data-email="' + esc(u.Email) + '" class="us-edit bg-blue-900 hover:bg-blue-800 text-white text-xs px-3 py-1.5 rounded-lg font-bold">Cập nhật</button></td>' +
        '</tr>';
      }).join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Không tìm thấy Huynh trưởng khớp yêu cầu.</td></tr>';
}

/* ---------- 2. Quản lý Nhóm (t-grp) ---------- */
async function renderGroups() {
  if (!ALL_GROUPS.length) await loadTeacherData();
  const tb = $('grp-tbody');
  if (!tb) return;

  tb.innerHTML = ALL_GROUPS.length
    ? ALL_GROUPS.map(g => '<tr>' +
        '<td class="p-2 border font-bold">' + esc(g.GroupName) + '</td>' +
        '<td class="p-2 border text-center">' + groupBadge(g) + '</td>' +
        '<td class="p-2 border">' + esc(g.Scope || '—') + '</td>' +
      '</tr>').join('')
    : '<tr><td colspan="3" class="p-4 text-center text-slate-400">Chưa có nhóm nào được thiết lập.</td></tr>';
}

/* ---------- 3. Quản lý Lớp (t-cls) ---------- */
async function renderClasses() {
  let cl, st;
  try {
    [cl, st] = await Promise.all([api('getClasses'), api('getStudents')]);
  } catch (e) { return toast(e.message); }

  const classes = cl.classes || [];
  const students = st.students || [];

  const sizeMap = {};
  students.forEach(s => {
    if (String(s.Status || '').toLowerCase().trim() === 'hoạt động') {
      sizeMap[s.CurrentClass] = (sizeMap[s.CurrentClass] || 0) + 1;
    }
  });

  const tb = $('cls-tbody');
  if (!tb) return;

  tb.innerHTML = classes.length
    ? classes.map((c, i) => '<tr>' +
        '<td class="p-2 border text-center">' + (i + 1) + '</td>' +
        '<td class="p-2 border font-bold">' + esc(c.ClassName) + '</td>' +
        '<td class="p-2 border text-center">' + esc(c.Grade || '—') + '</td>' +
        '<td class="p-2 border text-center font-bold text-blue-900">' + (sizeMap[c.ClassName] || 0) + '</td>' +
      '</tr>').join('')
    : '<tr><td colspan="4" class="p-4 text-center text-slate-400">Chưa có danh sách lớp.</td></tr>';
}

/* ---------- 4. Quản lý Nghỉ Lễ (t-hol) ---------- */
async function renderHolidays() {
  if ($('hol-session') && !$('hol-session').children.length) {
    fillSel('hol-session', [{v:'', t:'Cả tuần'}].concat(SESSIONS.map(s => ({v:s}))));
  }
  if ($('hol-week') && !$('hol-week').value) {
    $('hol-week').value = defaultWeek();
  }

  let r;
  try { r = await api('getHolidays', { schoolYear: year() }); }
  catch (e) { return toast(e.message); }

  HOLIDAYS = r.holidays || [];
  const tb = $('hol-tbody');
  if (!tb) return;

  tb.innerHTML = HOLIDAYS.length
    ? HOLIDAYS.map((h, i) => '<tr>' +
        '<td class="p-2 border font-semibold text-center">' + esc(h.weekOf) + '</td>' +
        '<td class="p-2 border text-center">' + esc(h.session || 'Cả tuần') + '</td>' +
        '<td class="p-2 border">' + esc(h.reason || '—') + '</td>' +
        '<td class="p-2 border text-center"><button data-i="' + i + '" class="hol-del text-red-600 font-bold hover:underline">Xóa</button></td>' +
      '</tr>').join('')
    : '<tr><td colspan="4" class="p-4 text-center text-slate-400">Chưa khai báo tuần nghỉ lễ trong năm học này.</td></tr>';
}

async function saveHolidayList() {
  try {
    await api('saveHolidays', { holidays: HOLIDAYS });
    toast('Đã cập nhật danh sách nghỉ lễ.');
    tabCache['t-hol'] = false;
    await renderHolidays();
    tabCache['t-hol'] = true;
  } catch (e) { toast(e.message); }
}

/* ---------- Events & Modals ---------- */
if ($('us-q')) {
  $('us-q').addEventListener('input', () => renderUsers());
}

if ($('hol-week')) {
  $('hol-week').addEventListener('change', () => normSunday($('hol-week')));
}

const btnHolAdd = $('hol-add');
if (btnHolAdd) {
  btnHolAdd.addEventListener('click', async () => {
    const weekOf = $('hol-week').value;
    if (!weekOf) return toast('Chọn ngày Chủ Nhật nghỉ lễ.');
    HOLIDAYS.push({
      weekOf: weekOf,
      session: $('hol-session').value,
      reason: $('hol-reason').value.trim()
    });
    $('hol-reason').value = '';
    await saveHolidayList();
  });
}

const holTbody = $('hol-tbody');
if (holTbody) {
  holTbody.addEventListener('click', async e => {
    const btn = e.target.closest('.hol-del');
    if (!btn) return;
    HOLIDAYS.splice(+btn.dataset.i, 1);
    await saveHolidayList();
  });
}

/* Modal Chuyển Năm */
const btnYearOpen = $('year-open');
if (btnYearOpen) {
  btnYearOpen.addEventListener('click', () => {
    const [a, c] = year().split('-').map(Number);
    if ($('yr-old')) $('yr-old').textContent = year();
    if ($('yr-new')) $('yr-new').textContent = (a + 1) + '-' + (c + 1);
    if ($('year-modal')) $('year-modal').classList.add('open');
  });
}

const yearModal = $('year-modal');
if (yearModal) {
  yearModal.querySelector('.btn-cancel').addEventListener('click', () => yearModal.classList.remove('open'));
  yearModal.querySelector('.btn-save').addEventListener('click', async () => {
    const startDate = $('sy-start').value;
    if (!startDate) return toast('Chọn ngày bắt đầu năm học mới.');
    try {
      await api('startSchoolYear', { attendanceStartDate: startDate });
      toast('Đã chuyển sang năm học mới.');
      location.reload();
    } catch (e) { toast(e.message); }
  });
}

/* Boot: Loads active default tab 't-us' strictly on initialization */
switchTab('t-us');