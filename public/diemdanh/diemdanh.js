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
  ddBase = (r.records || []).map(x => ({idNumber:x.idNumber, saintName:x.saintName || '', fullName:x.fullName, photo:x.photo || '', status:x.status || '', note:x.note || ''}));
  ddState = ddBase.map(x => ({...x}));
  renderDDTable();
  // Step 3: build reference descriptors trong background
  buildReferenceDescriptors(ddBase, updateRefBadge).catch(e => console.warn('[face-scan] build refs error:', e.message));
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
  if (!st) return out.innerHTML = '<p class="text-amber-600 font-medium">Không tìm thấy Thiếu nhi với số CCCD này.</p>';
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

/* ---------- Face Scan Modal (Step 1: UI skeleton, no detection yet) ---------- */
const fsModal = $('fs-modal');
const fsEmpty = $('fs-empty');
const fsPreviewWrap = $('fs-preview-wrap');
const fsImg = $('fs-img');
const fsError = $('fs-error');
const fsApply = $('fs-apply');
let fsSelectedImage = null; // {src, source: 'file'|'url'}

// Step 2: face-api.js model loader
const FACEAPI_MODEL_URL = '/models';
let fsModelsReady = false;
let fsModelsLoading = null;

async function loadFaceApiModels() {
  if (fsModelsReady) return true;
  if (fsModelsLoading) return fsModelsLoading;
  fsModelsLoading = (async () => {
    if (typeof faceapi === 'undefined') {
      throw new Error('face-api.js chưa load xong. Kiểm tra kết nối CDN.');
    }
    await faceapi.nets.tinyFaceDetector.loadFromUri(FACEAPI_MODEL_URL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(FACEAPI_MODEL_URL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(FACEAPI_MODEL_URL);
    fsModelsReady = true;
    console.log('[face-scan] models loaded:', { tiny: true, landmark68: true, recognition: true });
    return true;
  })();
  return fsModelsLoading;
}

// Step 3: Reference descriptor cache (idNumber → Float32Array(128))
const refDescriptors = new Map();
let refBuildInProgress = false;

async function loadImageCORS(url, timeoutMs = 10000) {
  // Try 1: <img crossOrigin="anonymous"> (clean canvas, descriptor chính xác nhất)
  try {
    const img = await loadImgElement(url, 'anonymous', timeoutMs);
    return { img, tainted: false };
  } catch (e1) {
    // Try 2: fetch → blob → objectURL (vẫn giữ crossOrigin="anonymous")
    try {
      const r = await fetchWithTimeout(url, timeoutMs);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      try {
        const img = await loadImgElement(objUrl, 'anonymous', timeoutMs);
        return { img, tainted: false };
      } finally {
        URL.revokeObjectURL(objUrl);
      }
    } catch (e2) {
      // Try 3: fallback no-cors (descriptor có thể kém chính xác do canvas tainted)
      try {
        const img = await loadImgElement(url, 'no-cors', timeoutMs);
        console.warn('[face-scan] using no-cors fallback for', url, '→', e2.message);
        return { img, tainted: true };
      } catch (e3) {
        throw new Error('Không tải được ảnh: ' + e3.message);
      }
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
  const { img } = await loadImageCORS(photoUrl);
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const det = await faceapi.detectSingleFace(img, opts).withFaceLandmarks().withFaceDescriptor();
  if (!det) return null;
  return det.descriptor;
}

async function buildReferenceDescriptors(students, onProgress) {
  if (refBuildInProgress) return;
  refBuildInProgress = true;
  refDescriptors.clear();
  const list = students.filter(s => s.photo && s.photo.trim());
  const total = list.length;
  let done = 0, ok = 0, failed = 0;
  const concurrency = 3;
  for (let i = 0; i < list.length; i += concurrency) {
    const chunk = list.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (s) => {
      try {
        const desc = await computeReferenceDescriptor(s.photo);
        if (desc) { refDescriptors.set(s.idNumber, desc); ok++; }
        else { failed++; console.warn('[face-scan] no face in', s.idNumber, s.photo); }
      } catch (e) {
        failed++;
        console.warn('[face-scan] failed', s.idNumber, '→', e.message);
      } finally {
        done++;
        if (onProgress) onProgress({ done, total, ok, failed });
      }
    }));
  }
  refBuildInProgress = false;
  console.log('[face-scan] refs ready:', ok, '/', total, '(failed:', failed, ')');
  if (refDescriptors.size > 0) {
    const sampleId = refDescriptors.keys().next().value;
    const sampleDesc = refDescriptors.get(sampleId);
    console.log('[face-scan] sample:', sampleId, 'descriptor[0..4]=', Array.from(sampleDesc.slice(0, 5)));
  }
  return { ok, total, failed };
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
  // Preload models in background khi user mở modal lần đầu
  if (!fsModelsReady && !fsModelsLoading) {
    loadFaceApiModels().catch(e => console.warn('[face-scan] preload failed:', e.message));
  }
}
function fsClose() { fsModal.style.display = 'none'; fsReset(); }
function fsReset() {
  fsSelectedImage = null;
  fsImg.removeAttribute('src');
  fsPreviewWrap.style.display = 'none';
  fsEmpty.style.display = 'block';
  fsApply.disabled = true;
  fsError.classList.add('hidden');
  fsError.textContent = '';
  const f = $('fs-file'); if (f) f.value = '';
  const u = $('fs-url'); if (u) u.value = '';
}
function fsShowError(msg) {
  fsError.classList.remove('hidden');
  fsError.textContent = '⚠ ' + msg;
}
function fsShowPreview(src, source) {
  fsSelectedImage = { src, source };
  fsImg.src = src;
  fsImg.onload = () => {
    fsPreviewWrap.style.display = 'block';
    fsEmpty.style.display = 'none';
    fsApply.disabled = false;
    $('fs-stats').textContent = 'Kích thước: ' + fsImg.naturalWidth + ' × ' + fsImg.naturalHeight + ' px';
  };
  fsImg.onerror = () => fsShowError('Không tải được ảnh. Kiểm tra link Drive đã share "Anyone with the link" chưa.');
}
function fsConvertDriveUrl(u) {
  // /file/d/ID/view → /uc?export=view&id=ID
  const m = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return 'https://drive.google.com/uc?export=view&id=' + m[1];
  // /open?id=ID → /uc?export=view&id=ID
  const m2 = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m2) return 'https://drive.google.com/uc?export=view&id=' + m2[1];
  return u;
}

$('dd-facescan').addEventListener('click', fsOpen);
$('fs-close').addEventListener('click', fsClose);
$('fs-cancel').addEventListener('click', fsClose);
fsModal.addEventListener('click', e => { if (e.target === fsModal) fsClose(); });
$('fs-file').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) return fsShowError('File không phải ảnh.');
  const reader = new FileReader();
  reader.onload = ev => fsShowPreview(ev.target.result, 'file');
  reader.onerror = () => fsShowError('Không đọc được file.');
  reader.readAsDataURL(file);
});
$('fs-load-url').addEventListener('click', () => {
  const raw = $('fs-url').value.trim();
  if (!raw) return fsShowError('Chưa nhập URL.');
  const url = fsConvertDriveUrl(raw);
  fsShowPreview(url, 'url');
});
$('fs-apply').addEventListener('click', async () => {
  if (!fsSelectedImage) return;
  // Step 2: chỉ test load models xong chưa.
  // Step 3+ sẽ compute reference descriptors; Step 5 sẽ detect ảnh lớp + match.
  try {
    fsApply.disabled = true;
    fsApply.textContent = '⏳ Đang tải models...';
    await loadFaceApiModels();
    // Test detect trên chính ảnh preview để confirm pipeline chạy
    const det = await faceapi.detectAllFaces(fsImg, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }));
    toast('Step 2 OK — models loaded. Phát hiện ' + det.length + ' mặt trong ảnh preview.');
    console.log('[face-scan] test detections:', det);
  } catch (e) {
    fsShowError(e.message);
  } finally {
    fsApply.disabled = false;
    fsApply.textContent = '🤖 Quét & Gợi ý';
  }
});
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
