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

  const rawRecords = Array.isArray(r?.recordsByStudent) ? r.recordsByStudent : (Array.isArray(r?.records) ? r.records : []);
  const orderedList = sortStudents(rawRecords.map(x => {
    const baseSt = (Array.isArray(TSTUDENTS) ? TSTUDENTS : []).find(s => s.IdNumber === x.idNumber) || {};
    return {
      ...x,
      CurrentClass: cls,
      IdNumber: x.idNumber,
      ListOrder: baseSt.ListOrder,
      Gender: baseSt.Gender,
      photo: x.photo || baseSt.Photo || ''
    };
  }));

  weekCache = orderedList.map(o => {
    const rec = rawRecords.find(r => r.idNumber === o.idNumber) || o;
    return { ...rec, photo: o.photo };
  });

  currentSession = $('dd-buoi').value;
  renderSessionFromCache();

  // Face Scan Step: build reference descriptors in the background
  if (typeof buildReferenceDescriptors === 'function') {
    buildReferenceDescriptors(weekCache, updateRefBadge).catch(e => console.warn('[face-scan] build refs error:', e.message));
  }
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
      photo: x.photo || '',
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

/* ---------- Face Scan Modal ---------- */
const fsModal = $('fs-modal');
const fsEmpty = $('fs-empty');
const fsPreviewWrap = $('fs-preview-wrap');
const fsImg = $('fs-img');
const fsError = $('fs-error');
const fsApply = $('fs-apply');
const fsCanvas = $('fs-canvas');
const fsCanvasCtx = fsCanvas ? fsCanvas.getContext('2d') : null;

// Hỗ trợ upload tối đa 2 ảnh cùng lúc để tăng số HS được nhận diện (2 góc chụp khác nhau).
// fsSelectedImages = [{src, source}, ...] tối đa 2 phần tử.
// fsDetectionsPerImg = [[results ảnh 1], [results ảnh 2]] tương ứng từng ảnh.
// Khi scan: detect + match trên từng ảnh, gộp match vào table (union - HS match ở bất kỳ ảnh nào đều tick).
let fsSelectedImages = [];   // tối đa 3 ảnh
let fsCurrentImgIdx = 0;     // tab đang xem
let fsDetectionsPerImg = []; // detections cho từng ảnh
const MATCH_THRESHOLD = 0.55;
const MAX_FS_IMAGES = 3;

const FACEAPI_MODEL_URL = '/models';
let fsModelsReady = false;
let fsModelsLoading = null;

async function loadFaceApiModels() {
  if (fsModelsReady) return true;
  if (fsModelsLoading) return fsModelsLoading;
  fsModelsLoading = (async () => {
    if (typeof faceapi === 'undefined') throw new Error('face-api.js chưa load xong. Kiểm tra kết nối CDN.');
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODEL_URL);
    fsModelsReady = true;
    return true;
  })();
  return fsModelsLoading;
}

const refDescriptors = new Map();
let refBuildInProgress = false;
const DESC_CACHE_KEY = 'face-ref-cache-v1';
const DESC_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
let memCache = null;

function openDescDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open('face-scan-db', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('desc');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadDescCache() {
  if (memCache) return memCache;
  try {
    const db = await openDescDB();
    return await new Promise((resolve) => {
      const tx = db.transaction('desc', 'readonly');
      const req = tx.objectStore('desc').get(DESC_CACHE_KEY);
      req.onsuccess = () => { db.close(); memCache = req.result || {}; resolve(memCache); };
      req.onerror = () => { db.close(); memCache = {}; resolve(memCache); };
    });
  } catch (e) {
    memCache = {};
    return memCache;
  }
}

async function saveDescCache(cache) {
  try {
    const db = await openDescDB();
    await new Promise((resolve) => {
      const tx = db.transaction('desc', 'readwrite');
      tx.objectStore('desc').put(cache, DESC_CACHE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch (e) {}
}

function driveUrlToImageUrl(url) {
  if (!url) return url;
  const s = String(url);
  if (s.includes('lh3.googleusercontent.com')) return !/=[swh]\d+/.test(s) ? s + '=w320-h320' : s;
  const m = s.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!m) return s;
  return 'https://lh3.googleusercontent.com/d/' + m[1] + '=w320-h320';
}

async function loadImageCORS(url, timeoutMs = 10000) {
  try {
    const img = await loadImgElement(url, 'anonymous', timeoutMs);
    return { img, tainted: false };
  } catch (e1) {
    try {
      const r = await fetchWithTimeout(url, timeoutMs);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      try {
        const img = await loadImgElement(objUrl, 'anonymous', timeoutMs);
        return { img, tainted: false };
      } finally { URL.revokeObjectURL(objUrl); }
    } catch (e2) {
      try {
        const img = await loadImgElement(url, 'no-cors', timeoutMs);
        return { img, tainted: true };
      } catch (e3) { throw new Error('Không tải được ảnh: ' + e3.message); }
    }
  }
}

function loadImgElement(url, crossOrigin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin === 'anonymous') img.crossOrigin = 'anonymous';
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout ' + timeoutMs + 'ms')); } }, timeoutMs);
    img.onload = () => { if (!done) { done = true; clearTimeout(t); resolve(img); } };
    img.onerror = () => { if (!done) { done = true; clearTimeout(t); reject(new Error('img load error')); } };
    img.src = url;
  });
}

function fetchWithTimeout(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    fetch(url, { signal: c.signal, mode: 'cors' })
      .then(r => { clearTimeout(t); resolve(r); })
      .catch(e => { clearTimeout(t); reject(e); });
  });
}

async function computeReferenceDescriptor(photoUrl) {
  const imgUrl = driveUrlToImageUrl(photoUrl);
  const { img } = await loadImageCORS(imgUrl);
  await loadFaceApiModels();
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const det = await faceapi.detectSingleFace(img, opts).withFaceLandmarks().withFaceDescriptor();
  return det ? det.descriptor : null;
}

async function buildReferenceDescriptors(students, onProgress) {
  if (refBuildInProgress) return;
  refBuildInProgress = true;

  const currentIds = new Set(students.map(s => s.idNumber));
  for (const id of [...refDescriptors.keys()]) {
    if (!currentIds.has(id)) refDescriptors.delete(id);
  }

  const cache = await loadDescCache();
  const now = Date.now();
  const list = students.filter(s => s.photo && s.photo.trim());
  const total = list.length;

  let fromCache = 0;
  for (const s of list) {
    if (refDescriptors.has(s.idNumber)) continue;
    const c = cache[s.idNumber];
    if (c && c.photo === s.photo && (now - c.ts) < DESC_CACHE_TTL_MS) {
      refDescriptors.set(s.idNumber, { descriptor: new Float32Array(c.desc), studentName: s.fullName || s.idNumber });
      fromCache++;
    }
  }

  const needBuild = list.filter(s => !refDescriptors.has(s.idNumber));
  let done = fromCache, ok = fromCache, failed = 0;

  for (let i = 0; i < needBuild.length; i++) {
    const s = needBuild[i];
    let desc = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { desc = await computeReferenceDescriptor(s.photo); break; }
      catch (e) {
        if (/429|rate.?limit/i.test(e.message) && attempt < 3) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
        } else break;
      }
    }
    done++;
    if (desc) {
      refDescriptors.set(s.idNumber, { descriptor: desc, studentName: s.fullName || s.idNumber });
      cache[s.idNumber] = { photo: s.photo, desc: Array.from(desc), ts: now };
      ok++;
    } else failed++;

    if (onProgress) onProgress({ done, total, ok, failed });
    if (i < needBuild.length - 1) await new Promise(r => setTimeout(r, 300));
  }

  if (needBuild.length > 0) await saveDescCache(cache);
  refBuildInProgress = false;
  return { ok, total, failed };
}

function applyResultsToTable(matchResult) {
  if (!matchResult || !matchResult.results) return { ticked: 0, review: 0, skipped: [] };
  let ticked = 0, review = 0;
  const reviewList = [], skipped = [];
  for (const r of matchResult.results) {
    if (r.status === 'matched' && r.studentId) {
      const idx = ddState.findIndex(s => s.idNumber === r.studentId);
      if (idx === -1) continue;
      if (ddState[idx].status === 'Hiện diện' || ddState[idx].status === 'Có phép') {
        skipped.push(r.studentName + ' (đã tick: ' + ddState[idx].status + ')');
        continue;
      }
      ddState[idx].status = 'Hiện diện';
      ticked++;
    } else if (r.status === 'review' && r.studentId) {
      review++;
      reviewList.push(r.studentName + ' (d=' + r.distance.toFixed(2) + ')');
    }
  }
  renderDDTable();
  markDirty();
  return { ticked, review, reviewList, skipped };
}

function calculateIoU(box1, box2) {
  const x1 = Math.max(box1.x, box2.x), y1 = Math.max(box1.y, box2.y);
  const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
  const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = (box1.width * box1.height) + (box2.width * box2.height) - intersection;
  return union > 0 ? intersection / union : 0;
}

function applyNMS(detections, iouThreshold = 0.4) {
  if (detections.length === 0) return [];
  const sorted = detections.map((det, idx) => ({ det, idx, score: det.detection.score })).sort((a, b) => b.score - a.score);
  const keep = [], suppressed = new Set();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    keep.push(sorted[i].det);
    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;
      if (calculateIoU(sorted[i].det.detection.box, sorted[j].det.detection.box) > iouThreshold) suppressed.add(j);
    }
  }
  return keep;
}

async function matchFaces(classImg, refs, opts = {}) {
  const THRESHOLD_MATCH = 0.5, THRESHOLD_REVIEW = 0.65;
  if (!refs || refs.size === 0) return { detections: [], results: [], error: 'Chưa có ảnh tham chiếu nào được nạp.' };

  await loadFaceApiModels();
  const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: opts.inputSize || 832, scoreThreshold: opts.scoreThreshold || 0.06 });
  const detections = await faceapi.detectAllFaces(classImg, detectorOpts).withFaceLandmarks().withFaceDescriptors();
  const filteredDetections = applyNMS(detections, 0.4);

  const candidates = [];
  for (let i = 0; i < filteredDetections.length; i++) {
    for (const [refId, ref] of refs) {
      candidates.push({ detIdx: i, refId, refName: ref.studentName, distance: faceapi.euclideanDistance(filteredDetections[i].descriptor, ref.descriptor) });
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const usedDets = new Set(), usedRefs = new Set(), detMatch = new Array(filteredDetections.length).fill(null);

  for (const c of candidates) {
    if (usedDets.has(c.detIdx) || usedRefs.has(c.refId)) continue;
    usedDets.add(c.detIdx); usedRefs.add(c.refId);
    detMatch[c.detIdx] = { refId: c.refId, refName: c.refName, distance: c.distance };
  }

  const results = filteredDetections.map((det, i) => {
    const m = detMatch[i], box = det.detection.box;
    let status = 'unknown', autoTick = false;
    if (m) {
      if (m.distance < THRESHOLD_MATCH) { status = 'matched'; autoTick = true; }
      else if (m.distance <= THRESHOLD_REVIEW) { status = 'review'; }
    }
    return {
      idx: i, box: { x: box.x, y: box.y, width: box.width, height: box.height },
      studentId: m ? m.refId : null, studentName: m ? m.refName : null,
      distance: m ? m.distance : null, confidence: m ? Math.max(0, 1 - m.distance / THRESHOLD_REVIEW) : 0,
      status, autoTick, ticked: autoTick
    };
  });

  return { detections: filteredDetections.length, results, error: null };
}

function updateRefBadge(state) {
  const el = $('fs-status');
  if (!el) return;
  if (state.total === 0) { el.textContent = ''; el.className = ''; return; }
  if (state.done < state.total) {
    el.textContent = `⏳ ${state.done}/${state.total}`;
    el.className = 'ml-2 text-xs font-bold text-blue-600';
  } else {
    if (state.failed === 0) { el.textContent = `✓ ${state.ok}/${state.total}`; el.className = 'ml-2 text-xs font-bold text-emerald-600'; }
    else { el.textContent = `⚠ ${state.ok}/${state.total} (${state.failed} lỗi)`; el.className = 'ml-2 text-xs font-bold text-amber-600'; }
  }
}

function fsOpen() {
  fsModal.style.display = 'flex';
  fsReset();
  if (!fsModelsReady && !fsModelsLoading) loadFaceApiModels().catch(e => console.warn('[face-scan] preload failed:', e.message));
}
function fsClose() { fsModal.style.display = 'none'; fsReset(); }
function fsReset() {
  fsSelectedImages = [];
  fsCurrentImgIdx = 0;
  fsDetectionsPerImg = [];
  clearFsCanvas();
  fsImg.removeAttribute('src');
  fsPreviewWrap.style.display = 'none';
  fsEmpty.style.display = 'block';
  fsApply.disabled = true;
  fsError.classList.add('hidden');
  fsError.textContent = '';
  const f = $('fs-file'); if (f) f.value = '';
  const fAdd = $('fs-file-add'); if (fAdd) fAdd.value = '';
  const u = $('fs-urls'); if (u) u.value = '';
  updateFsTabsUI();
}
function fsShowError(msg) { fsError.classList.remove('hidden'); fsError.textContent = '⚠ ' + msg; }
/**
 * Thêm 1 ảnh vào list (tối đa MAX_FS_IMAGES).
 * Nếu đã đầy → thay thế ảnh hiện tại (đang xem).
 * @param {string} src - URL/dataURL
 * @param {'file'|'url'} source
 */
function fsAddImage(src, source) {
  if (fsSelectedImages.length < MAX_FS_IMAGES) {
    fsSelectedImages.push({ src, source });
    fsDetectionsPerImg.push([]);
    fsCurrentImgIdx = fsSelectedImages.length - 1;
  } else {
    // Đã đầy → thay thế ảnh hiện tại
    fsSelectedImages[fsCurrentImgIdx] = { src, source };
    fsDetectionsPerImg[fsCurrentImgIdx] = [];
  }
  fsApply.disabled = false;
  fsApply.textContent = '🤖 Quét & Gợi ý';
  loadImgIntoSlot(fsCurrentImgIdx);
}

/**
 * Load ảnh tại index `idx` vào <img> + sync canvas.
 */
function loadImgIntoSlot(idx) {
  if (idx < 0 || idx >= fsSelectedImages.length) return;
  fsCurrentImgIdx = idx;
  const img = fsSelectedImages[idx];
  clearFsCanvas();
  fsImg.src = img.src;
  fsImg.onload = () => {
    fsPreviewWrap.style.display = 'block'; fsEmpty.style.display = 'none';
    fsApply.disabled = false;
    fsApply.textContent = '🤖 Quét & Gợi ý';
    $('fs-stats').textContent = 'Kích thước: ' + fsImg.naturalWidth + ' × ' + fsImg.naturalHeight + ' px';
    updateFsTabsUI();
    const dets = fsDetectionsPerImg[idx] || [];
    if (dets.length) requestAnimationFrame(() => drawDetectionsOverlay(dets));
  };
  fsImg.onerror = () => fsShowError('Không tải được ảnh. Kiểm tra link Drive đã share "Anyone with the link" chưa.');
}

/**
 * Render tabs động theo số ảnh đã load.
 */
function updateFsTabsUI() {
  const tabsContainer = $('fs-tabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';
  fsSelectedImages.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className = 'fs-tab-btn px-4 py-2 font-bold text-sm border-b-2 whitespace-nowrap ' +
      (i === fsCurrentImgIdx
        ? 'border-blue-600 text-blue-700'
        : 'border-transparent text-slate-500 hover:text-slate-700');
    btn.dataset.tab = i;
    btn.textContent = '📷 Ảnh ' + (i + 1);
    btn.addEventListener('click', () => fsSwitchToImg(i));
    tabsContainer.appendChild(btn);
  });
  // Ẩn nút "Thêm ảnh" khi đã đủ MAX_FS_IMAGES, hiện khi chưa đủ
  const addLabel = $('fs-file-add-label');
  if (addLabel) {
    if (fsSelectedImages.length >= MAX_FS_IMAGES) {
      addLabel.classList.add('hidden');
    } else {
      addLabel.classList.remove('hidden');
    }
  }
}

/**
 * Switch sang ảnh khác (khi user click tab).
 */
function fsSwitchToImg(idx) {
  if (idx < 0 || idx >= fsSelectedImages.length) return;
  loadImgIntoSlot(idx);
}

/**
 * Xoá ảnh hiện tại khỏi list.
 */
function fsRemoveCurrentImg() {
  if (fsSelectedImages.length === 0) return;
  fsSelectedImages.splice(fsCurrentImgIdx, 1);
  fsDetectionsPerImg.splice(fsCurrentImgIdx, 1);
  // Điều chỉnh current index
  if (fsCurrentImgIdx >= fsSelectedImages.length) fsCurrentImgIdx = Math.max(0, fsSelectedImages.length - 1);
  // Nếu không còn ảnh nào → reset về trạng thái empty
  if (fsSelectedImages.length === 0) {
    clearFsCanvas();
    fsImg.removeAttribute('src');
    fsPreviewWrap.style.display = 'none';
    fsEmpty.style.display = 'block';
    fsApply.disabled = true;
    fsApply.textContent = '🤖 Quét & Gợi ý';
    updateFsTabsUI();
    return;
  }
  // Còn ảnh → load ảnh tại current index
  loadImgIntoSlot(fsCurrentImgIdx);
}

const FS_BOX_STYLES = {
  matched: { stroke: '#16a34a', fill: 'rgba(22,163,74,0.15)', labelBg: '#16a34a', icon: '✅' },
  review:  { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.15)', labelBg: '#f59e0b', icon: '❓' },
  unknown: { stroke: '#64748b', fill: 'rgba(100,116,139,0.10)', labelBg: '#475569', icon: '?' }
};

function clearFsCanvas() { if (fsCanvas && fsCanvasCtx) fsCanvasCtx.clearRect(0, 0, fsCanvas.width, fsCanvas.height); }

function syncFsCanvasSize() {
  if (!fsCanvas || !fsImg || !fsImg.naturalWidth) return null;
  const displayW = fsImg.clientWidth, displayH = fsImg.clientHeight;
  if (!displayW || !displayH) return null;
  const dpr = window.devicePixelRatio || 1;
  fsCanvas.width = Math.round(displayW * dpr); fsCanvas.height = Math.round(displayH * dpr);
  fsCanvas.style.width = displayW + 'px'; fsCanvas.style.height = displayH + 'px';
  return { scaleX: displayW / fsImg.naturalWidth, scaleY: displayH / fsImg.naturalHeight, dpr };
}

function drawDetectionsOverlay(detections) {
  if (!fsCanvas || !fsCanvasCtx) return;
  clearFsCanvas();
  if (!detections || !detections.length) return;
  const size = syncFsCanvasSize();
  if (!size) return;
  const { scaleX: scale, dpr } = size;

  fsCanvasCtx.save();
  fsCanvasCtx.scale(dpr, dpr);

  detections.forEach(d => {
    const style = FS_BOX_STYLES[d.status] || FS_BOX_STYLES.unknown;
    const x = d.box.x * scale, y = d.box.y * scale, w = d.box.width * scale, h = d.box.height * scale;
    fsCanvasCtx.fillStyle = style.fill; fsCanvasCtx.strokeStyle = style.stroke; fsCanvasCtx.lineWidth = 3;
    const r = Math.min(8, w / 4, h / 4);
    roundRect(fsCanvasCtx, x, y, w, h, r);
    fsCanvasCtx.fill(); fsCanvasCtx.stroke();
    const label = d.status === 'matched' ? style.icon + ' ' + (d.studentName || '?') : (d.status === 'review' ? style.icon + ' ' + (d.studentName || '?') + ' (xem lại)' : 'Không rõ');
    drawLabel(fsCanvasCtx, label, x, y, style.labelBg);
  });
  fsCanvasCtx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function drawLabel(ctx, text, x, y, bgColor) {
  ctx.font = 'bold 13px system-ui, -apple-system, "Segoe UI", sans-serif';
  const padding = 6, textW = ctx.measureText(text).width, textH = 18, labelH = textH + padding * 2, labelW = textW + padding * 2;
  ctx.fillStyle = bgColor; roundRect(ctx, x, y - labelH, labelW, labelH, 4); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + padding, y - labelH / 2);
}

let fsResizeTimer = null;
window.addEventListener('resize', () => {
  const dets = fsDetectionsPerImg[fsCurrentImgIdx] || [];
  if (!dets.length) return;
  clearTimeout(fsResizeTimer);
  fsResizeTimer = setTimeout(() => drawDetectionsOverlay(dets), 100);
});

function fsConvertDriveUrl(u) {
  const m = u.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/) || u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return 'https://lh3.googleusercontent.com/d/' + m[1] + '=w2000';
  if (u.includes('lh3.googleusercontent.com') && !/=[swh]\d+/.test(u)) return u + '=w2000';
  return u;
}

$('dd-facescan')?.addEventListener('click', fsOpen);
$('fs-close')?.addEventListener('click', fsClose);
$('fs-cancel')?.addEventListener('click', fsClose);
fsModal?.addEventListener('click', e => { if (e.target === fsModal) fsClose(); });

$('fs-file')?.addEventListener('change', e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const valid = files.filter(f => f.type.startsWith('image/'));
  if (!valid.length) return fsShowError('File không phải ảnh.');
  // Load từng file: ưu tiên thêm vào slot trống, nếu đầy thì thay thế slot hiện tại.
  // Giới hạn tổng số ảnh = MAX_FS_IMAGES (không load quá).
  const remaining = MAX_FS_IMAGES - fsSelectedImages.length;
  if (remaining <= 0) {
    // Đã đầy → chỉ thay ảnh đang xem
    toast('⚠ Đã đủ ' + MAX_FS_IMAGES + ' ảnh. File mới sẽ thay thế ảnh đang xem.');
    loadFileIntoSlot(valid[0], fsCurrentImgIdx);
  } else {
    const toLoad = valid.slice(0, remaining);
    if (valid.length > remaining) toast('⚠ Chỉ load ' + remaining + ' ảnh đầu (tối đa ' + MAX_FS_IMAGES + ').');
    toLoad.forEach((f, idx) => {
      // Tìm slot trống tiếp theo
      const slotIdx = fsSelectedImages.length + idx;
      loadFileIntoSlot(f, slotIdx);
    });
  }
});

$('fs-file-add')?.addEventListener('change', e => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const valid = files.filter(f => f.type.startsWith('image/'));
  if (!valid.length) return fsShowError('File không phải ảnh.');
  const remaining = MAX_FS_IMAGES - fsSelectedImages.length;
  if (remaining <= 0) {
    toast('⚠ Đã đủ ' + MAX_FS_IMAGES + ' ảnh. File mới sẽ thay thế ảnh đang xem.');
    loadFileIntoSlot(valid[0], fsCurrentImgIdx);
  } else {
    const toLoad = valid.slice(0, remaining);
    if (valid.length > remaining) toast('⚠ Chỉ load ' + remaining + ' ảnh đầu (tối đa ' + MAX_FS_IMAGES + ').');
    toLoad.forEach((f, idx) => {
      const slotIdx = fsSelectedImages.length + idx;
      loadFileIntoSlot(f, slotIdx);
    });
  }
});

/**
 * Load 1 file vào slot cụ thể (dùng cả cho initial + thêm ảnh).
 */
function loadFileIntoSlot(file, slotIdx) {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    if (slotIdx < fsSelectedImages.length) {
      // Slot đã tồn tại → thay thế
      fsSelectedImages[slotIdx] = { src: ev.target.result, source: 'file' };
      fsDetectionsPerImg[slotIdx] = [];
      loadImgIntoSlot(slotIdx);
    } else {
      // Slot mới → push
      fsAddImage(ev.target.result, 'file');
    }
  };
  reader.onerror = () => fsShowError('Không đọc được file.');
  reader.readAsDataURL(file);
}

$('fs-load-urls')?.addEventListener('click', () => {
  const raw = $('fs-urls').value.trim();
  if (!raw) return fsShowError('Chưa nhập URL.');
  // Tách theo dòng, lọc rỗng
  const urls = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!urls.length) return fsShowError('Chưa nhập URL hợp lệ.');
  const remaining = MAX_FS_IMAGES - fsSelectedImages.length;
  if (remaining <= 0) {
    toast('⚠ Đã đủ ' + MAX_FS_IMAGES + ' ảnh. URL mới sẽ thay thế ảnh đang xem.');
    fsAddImage(fsConvertDriveUrl(urls[0]), 'url');
  } else {
    const toLoad = urls.slice(0, remaining);
    if (urls.length > remaining) toast('⚠ Chỉ load ' + remaining + ' URL đầu (tối đa ' + MAX_FS_IMAGES + ').');
    toLoad.forEach((u, idx) => {
      const slotIdx = fsSelectedImages.length + idx;
      const url = fsConvertDriveUrl(u);
      if (slotIdx < fsSelectedImages.length) {
        fsSelectedImages[slotIdx] = { src: url, source: 'url' };
        fsDetectionsPerImg[slotIdx] = [];
        loadImgIntoSlot(slotIdx);
      } else {
        fsAddImage(url, 'url');
      }
    });
  }
});

$('fs-remove-img')?.addEventListener('click', () => {
  fsRemoveCurrentImg();
});

$('fs-apply')?.addEventListener('click', async () => {
  if (fsApply.textContent.includes('Đã xong')) return fsClose();
  if (!fsSelectedImages.length) return;
  fsError.classList.add('hidden');
  try {
    fsApply.disabled = true;
    fsApply.textContent = '⏳ Tải models...';
    await loadFaceApiModels();
    fsApply.textContent = '⏳ Chờ ảnh tham chiếu...';
    const deadline = Date.now() + 30000;
    while (refBuildInProgress && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));

    // ✅ Scan từng ảnh (tối đa MAX_FS_IMAGES=3), gộp kết quả match (union).
    const totalImgs = fsSelectedImages.length;
    let totalDetections = 0;
    let allResults = []; // gộp tất cả results từ mọi ảnh
    for (let i = 0; i < totalImgs; i++) {
      fsApply.textContent = '🔍 Phát hiện ảnh ' + (i + 1) + '/' + totalImgs + '...';
      // Switch sang ảnh i để fsImg load
      fsCurrentImgIdx = i;
      clearFsCanvas();
      fsImg.src = fsSelectedImages[i].src;
      // Đợi ảnh load xong (có thể đã cache nên dùng promise wrap)
      await new Promise((resolve) => {
        if (fsImg.complete && fsImg.naturalWidth) return resolve();
        fsImg.onload = resolve;
        fsImg.onerror = resolve; // fail cũng continue
      });
      // Đợi 1 frame để canvas size sync đúng
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const result = await matchFaces(fsImg, refDescriptors);
      if (result.error) {
        toast('⚠ Ảnh ' + (i + 1) + ': ' + result.error);
        fsDetectionsPerImg[i] = [];
        continue;
      }
      fsDetectionsPerImg[i] = result.results;
      totalDetections += result.detections;
      allResults = allResults.concat(result.results);
    }

    if (totalDetections === 0) {
      toast('⚠ Không phát hiện khuôn mặt nào trong cả ' + totalImgs + ' ảnh. Thử ảnh khác rõ hơn.');
      // Vẫn show overlay cho ảnh hiện tại (rỗng)
      fsSwitchToImg(0);
      return;
    }

    // Gộp tất cả results → apply vào table (union: HS match ở bất kỳ ảnh nào đều tick).
    // Lưu ý: applyResultsToTable đã skip HS đã tick "Hiện diện"/"Có phép" → không trùng.
    const mergedResult = { results: allResults, detections: totalDetections };
    const { ticked, review, reviewList, skipped } = applyResultsToTable(mergedResult);

    // Vẽ overlay của ảnh hiện tại (ảnh 1 hoặc ảnh user đang xem)
    const prevIdx = fsCurrentImgIdx;
    fsCurrentImgIdx = 0;
    fsSwitchToImg(0);
    // Sau khi switch sang ảnh 1 xong → cũng giữ currentImg ở đầu để user thấy ảnh 1 trước

    fsApply.disabled = false;
    fsApply.textContent = '✓ Đã xong & Đóng';

    let summary;
    if (totalImgs === 1) {
      summary = '✅ Tick ' + ticked + ' HS hiện diện';
    } else {
      summary = '✅ Tick ' + ticked + ' HS hiện diện (gộp từ ' + totalImgs + ' ảnh)';
    }
    if (review > 0) summary += ' (có ' + review + ' cần xem lại: ' + reviewList.slice(0, 3).join(', ') + (reviewList.length > 3 ? '…' : '') + ')';
    if (skipped.length) summary += ' (bỏ qua ' + skipped.length + ' đã tick trước)';
    toast(summary);
  } catch (e) {
    fsShowError(e.message);
  } finally {
    if (fsApply.textContent.startsWith('⏳') || fsApply.textContent.startsWith('🔍')) {
      fsApply.disabled = false;
      fsApply.textContent = '🤖 Quét & Gợi ý';
    }
  }
});

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