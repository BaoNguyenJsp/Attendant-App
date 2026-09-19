/* =====================================================================
   SỔ THIẾU NHI — giaovien/index.js (Teacher Management)
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, SESSIONS, cur, year, defaultWeek, normSunday, isExec, isAdmin, fillSel, exportExcel , toIsoDate } from '../shared/common.js';

await initCommon();

const TSESS = [...SESSIONS, 'Họp Huynh Trưởng'];
const XUDOAN = '__Xudoan__';

const { users = [], groups = [] } = await api('getTeachers');
const USERS = users;
const NGANH = groups.filter(g => g.Type === 'Ngành');

let weekCache = [];
let currentSession = '';
let gvddBase = [], gvddState = [];
let TEACHER_ATT_CACHE = {};

/* ---------- Fixed Tab Cache Map ---------- */
const tabCache = {
  't-gvdd': false,   
  't-gvtrich': true, 
  't-gvtk': false    
};

function invalidateStatsCache() {
  tabCache['t-gvtk'] = false;
}

async function switchTab(tabId) {
  document.querySelectorAll('[data-pane]').forEach(pane => pane.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (targetPane) targetPane.style.display = 'block';
  if (targetBtn) targetBtn.classList.add('active');

  if (!tabCache[tabId]) {
    if (tabId === 't-gvdd') await renderGVDD();
    else if (tabId === 't-gvtk') await renderGVTK();
    tabCache[tabId] = true;
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

/* ---------- Selects ---------- */
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

async function loadTeacherAttendance(sector, force = false) {
  if (TEACHER_ATT_CACHE[sector] && !force) return;
  
  const r = await api('getTeacherAttendance', { sector: sector });
  TEACHER_ATT_CACHE[sector] = {
    records: r.records || [],
    holidays: r.holidays || {}
  };
}

/* ---------- Điểm danh Huynh trưởng ---------- */
async function renderGVDD() {
  if (!isExec()) return;
  if (!$('gvdd-week').value) $('gvdd-week').value = defaultWeek();
  normSunday($('gvdd-week'));

  const sector = $('gvdd-nganh').value;
  const wk = $('gvdd-week').value;
  currentSession = $('gvdd-session').value;

  try {
    // Fetch ONLY the selected sector
    await loadTeacherAttendance(sector);
  } catch (e) { return toast(e.message); }

  const cacheData = TEACHER_ATT_CACHE[sector];

  const isHolidayWeek = !!cacheData.holidays[wk + '|' + currentSession] || !!cacheData.holidays[wk + '|'];
  const note = $('gvdd-holiday-note');
  if (isHolidayWeek) { note.style.display = 'block'; note.textContent = '⚠ Tuần này là ngày nghỉ đã khai báo trong mục Quản trị.'; }
  else note.style.display = 'none';

  // Instant local filtering
  const weekRecsMap = {};
  cacheData.records.forEach(r => {
    if (String(r.WeekOf).trim() === wk) {
      weekRecsMap[r.email] = r;
    }
  });

  // Rebuild roster locally based on selected Sector
  const adminGroups = new Set();
  const sectorClasses = new Set();
  
  groups.forEach(g => {
    if (g.Type === 'Quản trị') adminGroups.add(g.GroupName);
    if (g.Type === 'Ngành' && (sector === '' || g.GroupName === sector)) {
      String(g.Scope || '').split(',').forEach(c => sectorClasses.add(c.trim()));
    }
  });
  
  const clsOfGroup = {};
  groups.forEach(g => { if (g.Type === 'Lớp') clsOfGroup[g.GroupName] = g.Scope || g.GroupName; });

  const activeUsersMap = {};
  USERS.filter(u => String(u.Status).toLowerCase() === 'hoạt động').forEach(u => activeUsersMap[u.Email.toLowerCase()] = u);

  const localRoster = {};
  const groupMembers = (await api('getTeachers')).members || [];
  
  groupMembers.forEach(m => {
    const email = String(m.Email || '').toLowerCase();
    const u = activeUsersMap[email];
    if (!u) return;

    if (sector === XUDOAN) {
      if (adminGroups.has(m.GroupName)) {
        localRoster[email] = { id: u.Id, email: u.Email, fullName: u.FullName, saintName: u.SaintName, className: '' };
      }
    } else {
      const cls = clsOfGroup[m.GroupName];
      if (cls && sectorClasses.has(cls)) {
        localRoster[email] = { id: u.Id, email: u.Email, fullName: u.FullName, saintName: u.SaintName, className: cls };
      }
    }
  });

  const rosterArr = Object.values(localRoster).sort((a, b) => (Number(a.id) - Number(b.id)) || a.fullName.localeCompare(b.fullName, 'vi'));

  weekCache = rosterArr.map(u => {
    const existing = weekRecsMap[u.email.toLowerCase()] || {};
    return { ...u, sessions: existing.sessions || {} };
  });

  renderSessionFromCache();
}

function syncStateToCache() {
  if (!currentSession) return;
  weekCache.forEach(u => {
    const uiRec = gvddState.find(s => s.email === u.email);
    if (uiRec) {
      if (!u.sessions) u.sessions = {};
      u.sessions[currentSession] = { status: uiRec.status, note: uiRec.note };
    }
  });
}

function renderSessionFromCache() {
  gvddBase = weekCache.map(x => {
    const sData = (x.sessions && x.sessions[currentSession]) || {};
    let rawSt = sData.status || '';
    let st = (rawSt === 'Hiện diện' || rawSt === 'Có phép' || rawSt === 'Có mặt' || rawSt === 'Vắng có phép') ? (rawSt === 'Có mặt' ? 'Hiện diện' : rawSt === 'Vắng có phép' ? 'Có phép' : rawSt) : '';
    
    return {
      id: x.id, 
      email: x.email, 
      fullName: x.fullName, 
      saintName: x.saintName || '', 
      className: x.className || '', 
      status: st, 
      note: sData.note || ''
    };
  });

  gvddState = gvddBase.map(x => ({...x}));
  renderGVDDTable();
  markDirtyGVDD();
}

function renderGVDDTable() {
  const tb = $('gvdd-tbody');
  tb.innerHTML = gvddState.length
    ? gvddState.map((s, i) => {
        const present = s.status === 'Hiện diện';
        const permission = s.status === 'Có phép';
        return '<tr data-i="' + i + '">' +
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
  
  if (which === 'present') {
    s.status = s.status === 'Hiện diện' ? '' : 'Hiện diện';
  } else if (which === 'permission') {
    s.status = s.status === 'Có phép' ? '' : 'Có phép';
  }

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
  const total = gvddState.length;
  const present = gvddState.filter(s => s.status === 'Hiện diện').length;
  const perm = gvddState.filter(s => s.status === 'Có phép').length;
  $('gvdd-summary').textContent = 'Sĩ số ' + total + ' · Hiện diện ' + present + ' · Có phép ' + perm + ' · Vắng ' + (total - present - perm);
}

async function saveGVDD() {
  normSunday($('gvdd-week'));
  syncStateToCache(); 

  const sector = $('gvdd-nganh').value;
  const body = {
    sector: sector, 
    weekOf: $('gvdd-week').value, 
    records: weekCache 
  };

  try { await api('saveTeacherAttendance', body); }
  catch (e) { return toast(e.message); }

  gvddBase = gvddState.map(x => ({...x}));
  markDirtyGVDD();
  toast('Đã lưu điểm danh Huynh trưởng cho cả tuần.');
  
  // Reload the cache instantly for THIS sector
  await loadTeacherAttendance(sector, true);
  
  invalidateStatsCache();
}

/* ---------- Trích lục ---------- */
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

/* ---------- In Bảng Thống Kê Huynh Trưởng ---------- */
async function printTeacherStats() {
  const sector = $('gvtk-nganh').value;
  const cls = $('gvtk-lop').value;
  
  toast('⏳ Đang tạo bảng thống kê...');
  
  let r;
  try { 
    r = await api('getTeacherStats', {sector: sector, className: cls || undefined}); 
  } catch (e) { 
    return toast(e.message); 
  }
  
  const rows = r.stats || [];
  const max = r.max || {};
  const maxTotal = r.maxTotal || 0;
  
  if (!rows.length) return toast('Không có dữ liệu để in.');
  
  const sectorName = sector === XUDOAN ? 'Xứ đoàn' : (sector || 'Toàn đoàn');
  const docTitle = `Thống kê HT - ${esc(sectorName)}`;
  const subHeader = `Phân đoàn/Ngành: <b>${esc(sectorName)}</b> &nbsp;|&nbsp; Lớp: <b>${esc(cls || 'Tất cả')}</b> &nbsp;|&nbsp; Năm học: <b>${esc(year())}</b>`;

  const printWindow = window.open('', '_blank');
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${docTitle}</title>
      <style>
        body { font-family: 'Times New Roman', Times, serif; padding: 20px; color: #000; }
        .header { text-align: center; margin-bottom: 20px; }
        .header h2 { margin: 0; font-size: 20px; text-transform: uppercase; }
        .header h3 { margin: 5px 0 0 0; font-size: 16px; font-weight: normal; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
        th, td { border: 1px solid #000; padding: 6px; text-align: center; }
        th { background-color: #f4f4f4; font-weight: bold; }
        td.left { text-align: left; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 15px; }
        .signature { text-align: center; width: 40%; }
        @media print {
          /* Dùng Landscape vì bảng giáo viên có nhiều cột */
          @page { size: A4 landscape; margin: 15mm; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>BẢNG THỐNG KÊ CHUYÊN CẦN HUYNH TRƯỞNG</h2>
        <h3>${subHeader}</h3>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 4%">STT</th>
            <th style="width: 8%">Mã Số</th>
            <th style="width: 18%">Họ và Tên</th>
            <th style="width: 15%">Email</th>
            <th style="width: 8%">Lớp</th>
            <th style="width: 7%">Buổi dạy</th>
            ${TSESS.map(s => `<th>${s}</th>`).join('')}
            <th style="width: 7%">Tổng %</th>
          </tr>
        </thead>
        <tbody>
  `;

  rows.forEach((x, i) => {
    const sum = TSESS.reduce((a, s) => a + (x.present[s] || 0), 0);
    
    html += `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(x.id)}</td>
        <td class="left font-medium">${esc(x.fullName)}</td>
        <td class="left">${esc(x.email)}</td>
        <td>${esc(x.className)}</td>
        <td>${x.taught || 0}</td>
        ${TSESS.map(s => `<td>${pct(x.present[s] || 0, max[s] || 0)}</td>`).join('')}
        <td><strong>${pct(sum, maxTotal)}</strong></td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <div class="footer">
        <div class="signature">
          <p><b>Trưởng phân đoàn / Khối trưởng</b></p>
          <br><br><br>
        </div>
        <div class="signature">
          <p><b>Xứ đoàn trưởng</b></p>
          <br><br><br>
        </div>
      </div>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  
  // Chờ HTML load xong cấu trúc trước khi gọi lệnh In
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
}

/* ---------- Events ---------- */
$('gvdd-nganh').addEventListener('change', async () => { tabCache['t-gvdd'] = false; await renderGVDD(); tabCache['t-gvdd'] = true; });
$('gvdd-week').addEventListener('change', async () => { normSunday($('gvdd-week')); tabCache['t-gvdd'] = false; await renderGVDD(); tabCache['t-gvdd'] = true; });

// SWITCH SESSION INSTANTLY (Syncs current screen, then loads new session without API call)
$('gvdd-session').addEventListener('change', () => { 
  syncStateToCache();
  currentSession = $('gvdd-session').value;
  renderSessionFromCache(); 
});

$('gvdd-refresh').addEventListener('click', async () => { 
  tabCache['t-gvdd'] = false; 
  await loadTeacherAttendance($('gvdd-nganh').value, true); // Force fetch from server
  await renderGVDD(); 
  tabCache['t-gvdd'] = true; 
  toast('Đã làm mới dữ liệu từ máy chủ.');
});
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

$('gvtk-nganh').addEventListener('change', async () => { fillLop(); tabCache['t-gvtk'] = false; await renderGVTK(); tabCache['t-gvtk'] = true; });
$('gvtk-lop').addEventListener('change', async () => { tabCache['t-gvtk'] = false; await renderGVTK(); tabCache['t-gvtk'] = true; });
$('gvtk-excel').addEventListener('click', () => exportExcel('gvtk-table', 'Thống kê Huynh trưởng'));
$('gvtk-print').addEventListener('click', printTeacherStats);

/* ---------- Boot ---------- */
fillNganh('gvdd-nganh');
fillNganh('gvtk-nganh');
fillSel('gvdd-session', TSESS.map(s => ({v:s})));
fillLop();
$('gvdd-week').value = defaultWeek();

switchTab('t-gvdd');