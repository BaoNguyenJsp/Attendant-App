/* =====================================================================
   SỔ THIẾU NHI — admin/index.js
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, year, isAdmin, SESSIONS, fillSel, normSunday, defaultWeek, clearApiCache , toIsoDate } from '../shared/common.js';
import { groupBadge } from '../shared/ui.js';

await initCommon();

const tabCache = {
  't-us': false,
  't-grp': false,
  't-cls': false,
  't-hol': false,
  't-cfg': false,
  't-year': true
};

let ALL_USERS = [], ALL_MEMBERS = [], ALL_GROUPS = [], HOLIDAYS = [];
let CONFIG = {};

async function switchTab(tabId) {
  document.querySelectorAll('[data-pane]').forEach(pane => pane.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (targetPane) targetPane.style.display = 'block';
  if (targetBtn) targetBtn.classList.add('active');

  if (!tabCache[tabId]) {
    if (tabId === 't-us') await renderUsers();
    else if (tabId === 't-grp') await renderGroups();
    else if (tabId === 't-cls') await renderClasses();
    else if (tabId === 't-hol') await renderHolidays();
    else if (tabId === 't-cfg') await renderConfig();
    tabCache[tabId] = true;
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

/* ---------- 0. Load Data ---------- */
async function loadTeacherData() {
  let r;
  try { r = await api('getTeachers'); }
  catch (e) { toast(e.message); return; }
  ALL_USERS = r.users || [];
  ALL_MEMBERS = r.members || [];
  ALL_GROUPS = r.groups || [];
}

async function loadConfig() {
  try {
    const r = await api('getConfig');
    CONFIG = r.config || {};
  } catch (e) { toast(e.message); }
}

/* ---------- 1. Quản lý Huynh Trưởng ---------- */
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
        
        // Render Group Name inside the badge (with colors based on Type)
        const badges = gs.map(g => {
          const cls = g.Type === 'Quản trị' ? 'bg-red-100 text-red-800' :
                      g.Type === 'Ngành' ? 'bg-green-100 text-green-800' :
                      g.Type === 'Quản trị ngành' ? 'bg-purple-100 text-purple-800' :
                      'bg-blue-100 text-blue-800'; // Default is Lớp
          return `<span class="inline-block px-2 py-0.5 mb-1 mr-1 rounded-full text-[11px] font-bold whitespace-nowrap ${cls}">${esc(g.GroupName)}</span>`;
        }).join('') || '<span class="text-slate-400">—</span>';

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

function openUsModal(emailRaw) {
  const targetEmail = String(emailRaw || '').trim().toLowerCase();
  const u = targetEmail ? ALL_USERS.find(x => String(x.Email).trim().toLowerCase() === targetEmail) : null;
  
  if ($('us-m-email')) {
    $('us-m-email').value = u ? u.Email : '';
    $('us-m-email').readOnly = !!u; // Khóa email nếu là cập nhật
    $('us-m-email').style.backgroundColor = u ? '#f1f5f9' : ''; 
  }
  
  if ($('us-m-saint')) $('us-m-saint').value = u ? (u.SaintName || '') : '';
  if ($('us-m-full')) $('us-m-full').value = u ? (u.FullName || '') : '';
  if ($('us-m-sdt')) $('us-m-sdt').value = u ? (u.SDT || '') : '';
  if ($('us-m-status')) $('us-m-status').value = u ? (u.Status || 'Hoạt động') : 'Hoạt động';

  let userGroups = [];
  if (u) {
    userGroups = ALL_MEMBERS
      .filter(m => String(m.Email).trim().toLowerCase() === String(u.Email).trim().toLowerCase())
      .map(m => m.GroupName);
  }
  
  let grpEl = $('us-m-groups');
  if (grpEl) {
    if (grpEl.tagName === 'INPUT') {
      const div = document.createElement('div');
      div.id = 'us-m-groups';
      div.className = 'flex flex-col gap-2 p-3 border border-slate-300 rounded-lg max-h-40 overflow-y-auto bg-slate-50';
      grpEl.parentNode.replaceChild(div, grpEl);
      grpEl = div;
    }
    
    grpEl.innerHTML = ALL_GROUPS.map(g => 
      `<label class="flex items-center gap-2 cursor-pointer">
         <input type="checkbox" value="${esc(g.GroupName)}" ${userGroups.includes(g.GroupName) ? 'checked' : ''} class="w-4 h-4"> 
         <span class="text-sm font-medium">${esc(g.GroupName)}</span>
       </label>`
    ).join('');
  }

  if ($('us-modal')) $('us-modal').classList.add('open');
}

const usModal = $('us-modal');
if (usModal) {
  usModal.querySelector('.btn-cancel').addEventListener('click', () => usModal.classList.remove('open'));
  usModal.querySelector('.btn-save').addEventListener('click', async () => {
    const email = $('us-m-email') ? $('us-m-email').value.trim() : '';
    if (!email) return toast('Vui lòng nhập Email.');
    
    const groups = $('us-m-groups') ? Array.from($('us-m-groups').querySelectorAll('input:checked')).map(cb => cb.value) : [];
    
    try {
      await api('saveUser', {
        user: { 
          email: email, 
          saintName: $('us-m-saint') ? $('us-m-saint').value.trim() : '', 
          fullName: $('us-m-full') ? $('us-m-full').value.trim() : '', 
          sdt: $('us-m-sdt') ? $('us-m-sdt').value.trim() : '', 
          status: $('us-m-status') ? $('us-m-status').value : 'Hoạt động' 
        }
      });
      await api('saveGroupMembers', { assignments: [{ email, groups }] });
      toast('Đã lưu thông tin Huynh trưởng.');
      usModal.classList.remove('open');
      
      // XÓA CACHE TẠI LOCALSTORAGE VÀ TẢI LẠI DỮ LIỆU TỪ SERVER
      clearApiCache('getTeachers');
      await loadTeacherData();

      tabCache['t-us'] = false;
      await renderUsers();
      tabCache['t-us'] = true;
    } catch (e) { toast(e.message); }
  });
}

const usTbody = $('us-tbody');
if (usTbody) {
  usTbody.addEventListener('click', e => {
    const btn = e.target.closest('.us-edit');
    if (btn) openUsModal(btn.dataset.email);
  });
}

const btnUsAdd = $('us-add');
if (btnUsAdd) {
  btnUsAdd.addEventListener('click', () => openUsModal('')); // Thêm mới
}

if ($('us-q')) {
  $('us-q').addEventListener('input', () => renderUsers());
}

/* ---------- 2. Quản lý Nhóm ---------- */
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

/* ---------- 3. Quản lý Lớp ---------- */
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

/* ---------- 4. Quản lý Nghỉ Lễ ---------- */
async function renderHolidays() {
  if (!Object.keys(CONFIG).length) await loadConfig();

  const holWeekInput = $('hol-week');
  if (holWeekInput) {
    if (!holWeekInput.value) holWeekInput.value = toIsoDate(defaultWeek());
    normSunday(holWeekInput);

    // Đảm bảo không cho phép chọn ngày trước AttendanceStartDate
    if (CONFIG.AttendanceStartDate) {
      holWeekInput.setAttribute('min', CONFIG.AttendanceStartDate);
    }
  }

  if ($('hol-session') && !$('hol-session').children.length) {
    fillSel('hol-session', SESSIONS.map(s => ({v:s})));
  }

  let r;
  try { r = await api('getHolidays'); }
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
    clearApiCache('getHolidays');
    tabCache['t-hol'] = false;
    await renderHolidays();
    tabCache['t-hol'] = true;
  } catch (e) { toast(e.message); }
}

if ($('hol-week')) {
  $('hol-week').addEventListener('change', () => normSunday($('hol-week')));
}

const btnHolAdd = $('hol-add');
if (btnHolAdd) {
  btnHolAdd.addEventListener('click', async () => {
    const weekOf = $('hol-week').value;
    if (!weekOf) return toast('Chọn ngày Chủ Nhật nghỉ lễ.');
    
    // Chặn người dùng gửi form nếu ngày vi phạm AttendanceStartDate
    if (CONFIG.AttendanceStartDate && weekOf < CONFIG.AttendanceStartDate) {
      return toast('Ngày nghỉ lễ không được trước ngày khai giảng (' + CONFIG.AttendanceStartDate + ').');
    }

    const session = $('hol-session').value;
    const reason = $('hol-reason').value.trim();

    // Kiểm tra trùng lặp: unique by weekOf + session
    const isDuplicate = HOLIDAYS.some(h => h.weekOf === weekOf && (h.session || '') === session);
    if (isDuplicate) {
      return toast('Lịch nghỉ cho buổi này trong tuần ' + weekOf + ' đã tồn tại.');
    }

    // Kiểm tra xung đột: nếu đã nghỉ "Cả tuần", không cho thêm buổi lẻ
    // Hoặc nếu đã có buổi lẻ, cảnh báo nếu muốn thêm "Cả tuần"
    const hasAllWeek = HOLIDAYS.some(h => h.weekOf === weekOf && !h.session);
    const hasSpecific = HOLIDAYS.some(h => h.weekOf === weekOf && h.session);

    if (session && hasAllWeek) {
      return toast('Ngày ' + weekOf + ' đã được thiết lập nghỉ cả tuần. Vui lòng xóa lịch nghỉ cả tuần trước khi thêm buổi lẻ.');
    }
    if (!session && hasSpecific) {
      return toast('Ngày ' + weekOf + ' đã có lịch nghỉ cho buổi cụ thể. Vui lòng xóa các buổi lẻ trước khi thiết lập nghỉ cả tuần.');
    }

    HOLIDAYS.push({
      weekOf: weekOf,
      session: session,
      reason: reason
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

/* ---------- 5. Chuyển Năm Học ---------- */
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
      clearApiCache();
      location.reload();
    } catch (e) { toast(e.message); }
  });
}

/* ---------- 6. Quản Lý Config ---------- */
async function renderConfig() {
  await loadConfig();
  const tb = $('cfg-tbody');
  if (!tb) return;

  const keys = Object.keys(CONFIG);
  tb.innerHTML = keys.length
    ? keys.map(k => renderConfigRow(k, CONFIG[k])).join('')
    : '<tr><td colspan="3" class="p-4 text-center text-slate-400">Chưa có cấu hình nào.</td></tr>';
}

function renderConfigRow(key = '', val = '') {
  const isDateKey = /date$/i.test(key.trim());
  const inputType = isDateKey ? 'date' : 'text';
  const valFormatted = isDateKey && val ? val.split('T')[0] : val; // Ensure yyyy-MM-dd for HTML date input

  return `
    <tr>
      <td class="p-2 border font-bold text-blue-900">
        <input type="text" class="cfg-key w-full border p-1.5 rounded font-mono text-sm bg-slate-50" value="${esc(key)}" readonly>
      </td>
      <td class="p-2 border">
        <input type="${inputType}" class="cfg-val w-full border p-1.5 rounded text-sm font-semibold" value="${esc(valFormatted)}">
      </td>
      <td class="p-2 border text-center">
        <button class="cfg-del text-red-600 font-bold hover:underline">Xóa</button>
      </td>
    </tr>
  `;
}

function addConfigRow() {
  const tb = $('cfg-tbody');
  if (!tb) return;
  
  if (tb.querySelector('td[colspan]')) tb.innerHTML = '';

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="p-2 border">
      <input type="text" class="cfg-key w-full border p-1.5 rounded font-mono text-sm" placeholder="vd: AttendanceStartDate">
    </td>
    <td class="p-2 border">
      <input type="text" class="cfg-val w-full border p-1.5 rounded text-sm" placeholder="vd: 2026-09-01">
    </td>
    <td class="p-2 border text-center">
      <button class="cfg-del text-red-600 font-bold hover:underline">Xóa</button>
    </td>
  `;

  // Dynamic listener: if user types a key ending in "Date", automatically switch value input to datepicker
  const keyInput = tr.querySelector('.cfg-key');
  const valInput = tr.querySelector('.cfg-val');
  
  keyInput.addEventListener('input', () => {
    const isDate = /date$/i.test(keyInput.value.trim());
    valInput.type = isDate ? 'date' : 'text';
  });

  tb.appendChild(tr);
}

async function saveConfigData() {
  const items = [];
  let isValid = true;

  document.querySelectorAll('#cfg-tbody tr').forEach(tr => {
    const keyInp = tr.querySelector('.cfg-key');
    const valInp = tr.querySelector('.cfg-val');
    if (!keyInp || !valInp) return;

    const k = keyInp.value.trim();
    const v = valInp.value.trim();

    if (!k) isValid = false;
    else items.push({ key: k, value: v });
  });

  if (!isValid) return toast('Tên Cấu hình (Key) không được để trống.');
  if (!items.length) return toast('Không có dữ liệu để lưu.');

  try {
    toast('⏳ Đang lưu cấu hình & làm mới bộ nhớ...');
    await api('saveConfig', { config: items });

    // 1. Wipe all localStorage items
    localStorage.clear();

    // 2. Clear frontend API cache
    clearApiCache();

    toast('Đã lưu cấu hình! Trang web sẽ tự làm mới...');
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    toast('Lỗi khi lưu: ' + e.message);
  }
}

// Bind Events for Config Tab
if ($('cfg-add-row')) $('cfg-add-row').addEventListener('click', addConfigRow);
if ($('cfg-save')) $('cfg-save').addEventListener('click', saveConfigData);

const cfgTbody = $('cfg-tbody');
if (cfgTbody) {
  cfgTbody.addEventListener('click', e => {
    const btn = e.target.closest('.cfg-del');
    if (btn) btn.closest('tr').remove();
  });
}

/* ---------- 7. Làm mới bộ nhớ đệm máy chủ ---------- */
const btnWarm = $('warm-cache');
if (btnWarm) {
  btnWarm.addEventListener('click', async () => {
    btnWarm.disabled = true;
    const old = btnWarm.textContent;
    btnWarm.textContent = '⏳';
    try {
      await api('warmCache');
      localStorage.clear();       // bỏ luôn cache phía trình duyệt để thấy dữ liệu mới
      toast('Đã làm mới bộ nhớ đệm.');
      location.reload();
    } catch (e) {
      toast(e.message);
      btnWarm.disabled = false;
      btnWarm.textContent = old;
    }
  });
}

/* Boot default active tab */
switchTab('t-us');