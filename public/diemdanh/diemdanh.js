/* =====================================================================
   SỔ THIẾU NHI — diemdanh/index.js
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, SESSIONS, TCLASSES, TSTUDENTS, year, defaultWeek, normSunday, fillClasses, fillSessions, exportExcel, sortStudents } from '../shared/common.js';
import { rankBadge } from '../shared/ui.js';

await initCommon();

const [cl, st] = await Promise.all([
  api('getClasses'),
  api('getStudents')
]);

setState({ 
  TCLASSES: Array.isArray(cl?.classes) ? cl.classes : [], 
  TSTUDENTS: Array.isArray(st?.students) ? st.students : [] 
});
fillClasses('dd-lop', 'tk-lop');
fillSessions('dd-buoi');

let weekCache = [];
let currentSession = '';
let ddBase = [], ddState = [];

const tabCache = {
  't-dd': false,
  't-tl': true,
  't-tk': false,
  't-toandoan': false
};

function invalidateStatsCache() {
  tabCache['t-tk'] = false;
  tabCache['t-toandoan'] = false;
}

async function switchTab(tabId) {
  document.querySelectorAll('[data-pane]').forEach(pane => pane.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (targetPane) targetPane.style.display = 'block';
  if (targetBtn) targetBtn.classList.add('active');

  if (!tabCache[tabId]) {
    if (tabId === 't-dd') await renderDD();
    else if (tabId === 't-tk') await renderTK();
    else if (tabId === 't-toandoan') await renderToanDoan();
    tabCache[tabId] = true;
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

/* ---------- Điểm Danh ---------- */
async function renderDD() {
  if (!$('dd-week').value) $('dd-week').value = defaultWeek();
  normSunday($('dd-week'));
  
  const cls = $('dd-lop').value;
  if (!cls) return toast('Chọn lớp.');
  let r;
  try { 
    r = await api('getAttendance', {
      schoolYear: year(), 
      weekOf: $('dd-week').value, 
      className: cls
    }); 
  } catch (e) { return toast(e.message); }

  const note = $('dd-holiday-note');
  if (r?.isHolidayWeek) { 
    note.style.display = 'block'; 
    note.textContent = '⚠ Tuần này là ngày nghỉ đã khai báo trong mục Quản trị.'; 
  } else note.style.display = 'none';

  // Inject ListOrder and Gender from TSTUDENTS so sortStudents has the necessary data
  const rawRecords = Array.isArray(r?.recordsByStudent) ? r.recordsByStudent : (Array.isArray(r?.records) ? r.records : []);
  const orderedList = sortStudents(rawRecords.map(x => {
    const baseSt = (Array.isArray(TSTUDENTS) ? TSTUDENTS : []).find(s => s.IdNumber === x.idNumber) || {};
    return { 
      ...x, 
      CurrentClass: cls, 
      IdNumber: x.idNumber,
      ListOrder: baseSt.ListOrder,
      Gender: baseSt.Gender
    };
  }));
  
  weekCache = orderedList.map(o => rawRecords.find(r => r.idNumber === o.idNumber) || o);
  currentSession = $('dd-buoi').value;
  renderSessionFromCache();
}

function syncStateToCache() {
  if (!currentSession) return;
  weekCache.forEach(student => {
    const uiRec = ddState.find(s => s.idNumber === student.idNumber);
    if (uiRec) {
      if (!student.sessions) student.sessions = {};
      student.sessions[currentSession] = { status: uiRec.status, note: uiRec.note };
    }
  });
}

function renderSessionFromCache() {
  ddBase = weekCache.map(x => {
    const sData = (x.sessions && x.sessions[currentSession]) || {};
    let rawSt = sData.status || '';
    let st = (rawSt === 'Hiện diện' || rawSt === 'Có phép' || rawSt === 'Có mặt' || rawSt === 'Vắng có phép') ? (rawSt === 'Có mặt' ? 'Hiện diện' : rawSt === 'Vắng có phép' ? 'Có phép' : rawSt) : '';
    return {
      idNumber: x.idNumber,
      saintName: x.saintName || '',
      fullName: x.fullName,
      status: st,
      note: sData.note || ''
    };
  });

  ddState = ddBase.map(x => ({...x}));
  renderDDTable();
  markDirty();
}

function renderDDTable() {
  const tb = $('dd-tbody');
  tb.innerHTML = ddState.map((s, i) => {
    const present = s.status === 'Hiện diện';
    const permission = s.status === 'Có phép';
    return '<tr data-i="' + i + '">' +
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
  
  if (which === 'present') {
    s.status = s.status === 'Hiện diện' ? '' : 'Hiện diện';
  } else if (which === 'permission') {
    s.status = s.status === 'Có phép' ? '' : 'Có phép';
  }
  
  renderDDTable();
  markDirty();
}

function noteInput(i) {
  const row = $('dd-tbody').querySelector('tr[data-i="' + i + '"]');
  if (row) ddState[i].note = row.querySelector('input[type="text"]').value || '';
  markDirty();
}

function markAllPresent() { 
  ddState.forEach(s => s.status = 'Hiện diện'); 
  renderDDTable(); 
  markDirty(); 
}

function markDirty() {
  const a = JSON.stringify(ddState.map(x => ({...x}))), b = JSON.stringify(ddBase.map(x => ({...x})));
  $('dd-dirty').textContent = a !== b ? '⚠ Có thay đổi chưa lưu' : '';
  $('dd-dirty').style.display = a !== b ? 'inline-block' : 'none';
}

function calcDD() {
  const total = ddState.length;
  const present = ddState.filter(s => s.status === 'Hiện diện').length;
  const perm = ddState.filter(s => s.status === 'Có phép').length;
  $('dd-summary').textContent = 'Sĩ số ' + total + ' · Hiện diện ' + present + ' · Có phép ' + perm + ' · Vắng ' + (total - present - perm);
}

async function saveAttendance() {
  normSunday($('dd-week'));
  syncStateToCache();

  const body = {
    schoolYear: year(), 
    weekOf: $('dd-week').value, 
    className: $('dd-lop').value,
    records: weekCache
  };

  try { 
    await api('saveAttendance', body); 
  } catch (e) { 
    return toast(e.message); 
  }

  ddBase = ddState.map(x => ({...x}));
  markDirty();
  toast('Đã lưu điểm danh cho cả tuần.');
  invalidateStatsCache();
}

/* ---------- Trích Lục ---------- */
async function renderTL() {
  const id = $('tl-id').value.trim();
  const out = $('tl-out');
  if (!id) return out.innerHTML = '<p class="text-amber-600 font-medium">Nhập Mã số Thiếu nhi.</p>';
  let r;
  try { r = await api('searchByIdNumber', {idNumber: id}); }
  catch (e) { return out.innerHTML = '<p class="text-amber-600 font-medium">' + esc(e.message) + '</p>'; }
  const stList = Array.isArray(r?.students) ? r.students : [];
  const st = stList[0];
  if (!st) return out.innerHTML = '<p class="text-amber-600 font-medium">Không tìm thấy Thiếu nhi này.</p>';
  const absList = Array.isArray(r?.absences) ? r.absences : [];
  const abs = absList.slice().sort((a, b) => String(a.WeekOf || '').localeCompare(String(b.WeekOf || '')));
  out.innerHTML =
    '<div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">' +
      '<h3 class="text-lg font-extrabold text-blue-900">' + esc((st.SaintName ? st.SaintName + ' ' : '') + st.FullName) + '</h3>' +
      '<dl class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm mt-2">' +
        '<div><dt class="text-xs font-bold text-slate-500 uppercase">Mã Số</dt><dd class="font-semibold">' + esc(st.IdNumber) + '</dd></div>' +
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

/* ---------- Thống Kê ---------- */

// Cap percentage at 100% and handle missing/zero values safely
const pct = (p, m) => {
  const v = Number(p || 0), max = Number(m || 0);
  if (!max || max <= 0 || v <= 0) return '0%';
  return Math.min(100, Math.round((v / max) * 100)) + '%';
};

async function renderTK() {
  const cls = $('tk-lop').value;
  if (!cls) return;
  
  let r;
  try { 
    r = await api('getClassAttendanceStats', { 
      schoolYear: year(), 
      className: cls
    }); 
  } catch (e) { 
    return toast(e.message); 
  }
  
  const statsObj = r?.stats || {};
  const backendMaxObj = r?.max || {};
  const sessions = Array.isArray(SESSIONS) ? SESSIONS : [];

  const maxObj = {};
  sessions.forEach(sess => {
    maxObj[sess] = Number(backendMaxObj[sess] || 0);
  });

  // Strict backend maxTotal based on AttendanceStartDate -> Now
  const maxTotal = Number(r?.maxTotal || 0);

  const classStudents = (Array.isArray(TSTUDENTS) ? TSTUDENTS : [])
    .filter(s => s.CurrentClass === cls && s.Status !== 'Nghỉ');

  const mapped = classStudents.map(s => {
    const id = String(s.IdNumber || s.idNumber || '');
    const sStat = statsObj[id] || {};
    
    return {
      ...s,
      idNumber: id,
      fullName: s.FullName || s.fullName || '',
      saintName: s.SaintName || s.saintName || '',
      stat: sStat,
      totalPresent: Math.min(Number(sStat.total || 0), maxTotal)
    };
  });

  const rows = sortStudents(mapped);
  
  $('tk-tbody').innerHTML = rows.length
    ? rows.map((x, i) => {
        const sStat = x.stat || {};
        
        const sessionCells = sessions.map(sess => {
          const val = Number(sStat[sess] || 0);
          const maxVal = Number(maxObj[sess] || 0);
          return '<td class="p-2 border text-center">' + pct(val, maxVal) + '</td>';
        }).join('');

        return '<tr>' +
          '<td class="p-2 border text-center">' + (i + 1) + '</td>' +
          '<td class="p-2 border font-medium">' + esc([x.saintName, x.fullName].filter(Boolean).join(' ')) + '</td>' +
          sessionCells +
          '<td class="p-2 border text-center font-bold">' + pct(x.totalPresent, maxTotal) + '</td>' +
          '</tr>';
      }).join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}

/* ---------- Thống Kê Toàn Đoàn ---------- */
async function renderToanDoan() {
  const tb = $('td-tbody');
  if (!tb) {
    toast('Lỗi giao diện: Không tìm thấy bảng Toàn Đoàn (td-tbody).');
    return;
  }
  
  tb.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-500 font-medium animate-pulse">⏳ Đang tổng hợp dữ liệu toàn đoàn...</td></tr>';

  // Lấy danh sách lớp và toàn bộ học sinh đang hoạt động
  const classes = TCLASSES.map(c => c.ClassName || c.className).filter(Boolean);
  const allActive = TSTUDENTS.filter(s => String(s.Status).toLowerCase() !== 'nghỉ');

  const rows = [];
  let grandTotal = 0;
  let totalCN = 0, maxTotalCN = 0;
  let totalT5 = 0, maxTotalT5 = 0;

  for (const cls of classes) {
    const classSts = allActive.filter(s => (s.CurrentClass || s.className) === cls);
    const siso = classSts.length;
    if (siso === 0) continue;

    grandTotal += siso;

    let statsRes;
    try {
      statsRes = await api('getClassAttendanceStats', { schoolYear: year(), className: cls });
    } catch (e) { 
      continue; 
    }

    const statsObj = statsRes?.stats || {};
    const backendMax = statsRes?.max || {};
    const maxTotal = Number(statsRes?.maxTotal || 0);

    const maxCn = Number(backendMax['Lễ Chúa Nhật'] || 0);
    const maxGl = Number(backendMax['Học Giáo Lý'] || 0);
    const maxCtt = Number(backendMax['Chầu Thánh Thể'] || 0);
    const maxT5 = Number(backendMax['Lễ Thứ Năm'] || 0);

    maxTotalCN += maxCn * siso;
    maxTotalT5 += maxT5 * siso;

    let c_cn = 0, c_gl = 0, c_ctt = 0, c_t5 = 0, c_total = 0;

    classSts.forEach(s => {
      const id = String(s.IdNumber || s.idNumber || '').trim();
      const st = statsObj[id] || {};
      
      c_cn += Number(st['Lễ Chúa Nhật'] || 0);
      c_gl += Number(st['Học Giáo Lý'] || 0);
      c_ctt += Number(st['Chầu Thánh Thể'] || 0);
      c_t5 += Number(st['Lễ Thứ Năm'] || 0);
      c_total += Math.min(Number(st.total || 0), maxTotal); 
      
      totalCN += Number(st['Lễ Chúa Nhật'] || 0);
      totalT5 += Number(st['Lễ Thứ Năm'] || 0);
    });

    const pctClass = maxTotal > 0 ? Math.round((c_total / (maxTotal * siso)) * 100) : 0;
    const pctCn = maxCn > 0 ? Math.round((c_cn / (maxCn * siso)) * 100) : 0;
    const pctGl = maxGl > 0 ? Math.round((c_gl / (maxGl * siso)) * 100) : 0;
    const pctCtt = maxCtt > 0 ? Math.round((c_ctt / (maxCtt * siso)) * 100) : 0;
    const pctT5 = maxT5 > 0 ? Math.round((c_t5 / (maxT5 * siso)) * 100) : 0;

    let rating = '';
    if (pctClass >= 80) rating = 'Xuất sắc';
    else if (pctClass >= 65) rating = 'Tốt';
    else if (pctClass >= 50) rating = 'Khá';
    else rating = 'Cần cố gắng';

    rows.push({
      cls, siso, pctCn, pctGl, pctCtt, pctT5, pctClass, rating
    });
  }

  if (rows.length === 0) {
    tb.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
    return;
  }

  // Cập nhật bảng
  tb.innerHTML = rows.map(r => `
    <tr>
      <td class="p-3 border font-extrabold text-center text-blue-900">${esc(r.cls)}</td>
      <td class="p-3 border text-center font-bold">${r.siso}</td>
      <td class="p-3 border text-center">${r.pctCn}%</td>
      <td class="p-3 border text-center">${r.pctGl}%</td>
      <td class="p-3 border text-center">${r.pctCtt}%</td>
      <td class="p-3 border text-center">${r.pctT5}%</td>
      <td class="p-3 border text-center font-bold text-emerald-700">${r.pctClass}%</td>
      <td class="p-3 border text-center font-semibold ${r.pctClass >= 80 ? 'text-pink-600' : 'text-slate-700'}">${r.rating}</td>
    </tr>
  `).join('');

  // Tính toán Tỉ lệ tổng quan
  const pctGrandCn = maxTotalCN > 0 ? Math.round((totalCN / maxTotalCN) * 100) : 0;
  const pctGrandT5 = maxTotalT5 > 0 ? Math.round((totalT5 / maxTotalT5) * 100) : 0;

  // Cập nhật 3 Cards phía trên một cách linh hoạt (tìm các thẻ chứa dấu "—" hoặc phần trăm hiện tại)
  const updateCardVal = (titleFragment, newVal) => {
    document.querySelectorAll('#t-toandoan div').forEach(div => {
      if (div.textContent.toUpperCase().includes(titleFragment)) {
         const valNodes = Array.from(div.querySelectorAll('*')).filter(el => 
           el.textContent.trim() === '—' || /^[0-9]+%?$/.test(el.textContent.trim())
         );
         if (valNodes.length > 0) {
           valNodes[valNodes.length - 1].textContent = newVal;
         }
      }
    });
  };

  if ($('td-siso')) $('td-siso').textContent = grandTotal;
  else updateCardVal('TỔNG THIẾU NHI', grandTotal);

  if ($('td-cn')) $('td-cn').textContent = pctGrandCn + '%';
  else updateCardVal('HIỆN DIỆN CHÚA NHẬT', pctGrandCn + '%');

  if ($('td-t5')) $('td-t5').textContent = pctGrandT5 + '%';
  else updateCardVal('HIỆN DIỆN THỨ NĂM', pctGrandT5 + '%');
}

/* ---------- Event Listeners ---------- */
$('dd-lop').addEventListener('change', async () => { tabCache['t-dd'] = false; await renderDD(); tabCache['t-dd'] = true; });
$('dd-week').addEventListener('change', async () => { normSunday($('dd-week')); tabCache['t-dd'] = false; await renderDD(); tabCache['t-dd'] = true; });

$('dd-buoi').addEventListener('change', () => {
  syncStateToCache();
  currentSession = $('dd-buoi').value;
  renderSessionFromCache();
});

$('dd-markall').addEventListener('click', markAllPresent);
$('dd-refresh').addEventListener('click', async () => { tabCache['t-dd'] = false; await renderDD(); tabCache['t-dd'] = true; });
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

$('tk-lop').addEventListener('change', async () => { tabCache['t-tk'] = false; await renderTK(); tabCache['t-tk'] = true; });
$('tk-excel').addEventListener('click', () => exportExcel('tk-table', 'Thống kê chuyên cần lớp'));
$('tk-print').addEventListener('click', () => window.print());

$('td-excel').addEventListener('click', () => exportExcel('td-table', 'Thống kê toàn đoàn'));
$('td-print').addEventListener('click', () => window.print());

/* Boot */
switchTab('t-dd');