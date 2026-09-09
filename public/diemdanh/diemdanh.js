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
// Step 6: canvas overlay vẽ box khuôn mặt lên ảnh preview.
// HTML đã có sẵn <canvas id="fs-canvas" class="absolute top-0 left-0"> (đặt cùng container với <img id="fs-img">).
const fsCanvas = $('fs-canvas');
const fsCanvasCtx = fsCanvas ? fsCanvas.getContext('2d') : null;
let fsSelectedImage = null; // {src, source: 'file'|'url'}
// Step 4: detections trong ảnh lớp [{box, descriptor, studentId?, distance?}]
let fsDetections = [];
// Step 5: ngưỡng euclidean distance để tính là "cùng người".
// 0.5 = strict (ít false positive, có thể miss), 0.6 = loose (match nhiều hơn, có thể sai).
// 0.55 là balance tốt cho ảnh selfie CCCD vs ảnh lớp chụp nghiêng.
const MATCH_THRESHOLD = 0.55;

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

// Step 3+ Fix: Persistent descriptor cache (IndexedDB + memory fallback).
// Descriptor của 1 HS gần như bất biến → cache 1 lần dùng mãi → giảm ~95% request đến lh3.googleusercontent.com.
// Fallback về in-memory Map khi IndexedDB không khả dụng (iOS Safari Private Mode, quota, etc.).
const DESC_CACHE_KEY = 'face-ref-cache-v1';  // bump version khi đổi model để force rebuild
const DESC_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;  // 90 ngày
let memCache = null;  // lazy-init, cũng là fallback khi IndexedDB fail

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
  if (memCache) return memCache; // đã load rồi → trả luôn (không gọi IDB lần 2)
  try {
    const db = await openDescDB();
    return await new Promise((resolve) => {
      const tx = db.transaction('desc', 'readonly');
      const req = tx.objectStore('desc').get(DESC_CACHE_KEY);
      req.onsuccess = () => { db.close(); memCache = req.result || {}; resolve(memCache); };
      req.onerror = () => { db.close(); memCache = {}; resolve(memCache); };
    });
  } catch (e) {
    console.warn('[face-scan] IndexedDB unavailable, dùng memory cache:', e.message);
    memCache = {};
    return memCache;
  }
}

async function saveDescCache(cache) {
  // memCache đã được cập nhật từng phần trong buildReferenceDescriptors,
  // chỉ cần persist xuống IndexedDB 1 lần ở cuối.
  try {
    const db = await openDescDB();
    await new Promise((resolve) => {
      const tx = db.transaction('desc', 'readwrite');
      tx.objectStore('desc').put(cache, DESC_CACHE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    });
  } catch (e) {
    console.warn('[face-scan] save cache xuống IndexedDB fail (vẫn còn memory):', e.message);
  }
}

// Convert URL Drive bất kỳ sang CDN lh3.googleusercontent.com — bypass COEP/CORP của drive.google.com.
// drive.google.com/uc trả COEP: require-corp + CORP: same-site → Chrome chặn <img crossOrigin> embed.
// lh3.googleusercontent.com/d/ID cùng nguồn binary, không có COEP/CORP/CSP → embed OK + CORS pass.
// Hỗ trợ mọi format: /file/d/ID, /d/ID, ?id=ID, đã là lh3 thì giữ nguyên.
// ✅ Thêm =w320-h320 để lấy thumbnail resize từ Google CDN thay vì ảnh gốc (1-5MB).
//    Lý do: ảnh nhỏ (~10-30KB) ít bị Google rate-limit 429 hơn rất nhiều so với ảnh full-size.
//    320px là vừa đủ cho face-api tiny detector (inputSize: 320 đang dùng ở dòng 328).
function driveUrlToImageUrl(url) {
  if (!url) return url;
  const s = String(url);
  // Đã là lh3.googleusercontent.com → chỉ thêm size nếu chưa có
  if (s.includes('lh3.googleusercontent.com')) {
    if (!/=[swh]\d+/.test(s)) return s + '=w320-h320';
    return s;
  }
  // Trích fileId từ /file/d/ID hoặc /d/ID hoặc ?id=ID
  const m = s.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (!m) return s;
  return 'https://lh3.googleusercontent.com/d/' + m[1] + '=w320-h320';
}

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
  // Convert URL Drive → lh3 CDN để bypass COEP/CORP của drive.google.com
  const imgUrl = driveUrlToImageUrl(photoUrl);
  const { img } = await loadImageCORS(imgUrl);
  // Đợi model sẵn sàng — nếu user chưa mở modal, ref build chạy trước nhưng vẫn OK.
  await loadFaceApiModels();
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const det = await faceapi.detectSingleFace(img, opts).withFaceLandmarks().withFaceDescriptor();
  if (!det) return null;
  return det.descriptor;
}

async function buildReferenceDescriptors(students, onProgress) {
  if (refBuildInProgress) return;
  refBuildInProgress = true;

  // ✅ Fix #1: bỏ refDescriptors.clear() — chỉ dọn rác descriptor của HS không còn trong danh sách.
  // Trước đây clear() xóa sạch mỗi lần đổi lớp/tuần/buổi → build lại từ đầu → spam lh3 → 429.
  const currentIds = new Set(students.map(s => s.idNumber));
  for (const id of [...refDescriptors.keys()]) {
    if (!currentIds.has(id)) refDescriptors.delete(id);
  }

  // ✅ Fix #2: load descriptor cache từ IndexedDB (fallback memory).
  const cache = await loadDescCache();
  const now = Date.now();
  const list = students.filter(s => s.photo && s.photo.trim());
  const total = list.length;

  // Phase 1: nạp từ cache vào refDescriptors (không gọi mạng).
  // Cache entry hợp lệ khi: cùng photo URL + chưa hết hạn TTL.
  let fromCache = 0;
  for (const s of list) {
    if (refDescriptors.has(s.idNumber)) continue; // đã có sẵn (giữa các lần build)
    const c = cache[s.idNumber];
    if (c && c.photo === s.photo && (now - c.ts) < DESC_CACHE_TTL_MS) {
      refDescriptors.set(s.idNumber, {
        descriptor: new Float32Array(c.desc),
        studentName: s.fullName || s.name || s.idNumber
      });
      fromCache++;
    }
  }
  const needBuild = list.filter(s => !refDescriptors.has(s.idNumber));
  console.log('[face-scan] cache: ' + fromCache + '/' + total + ' từ cache, cần build ' + needBuild.length);

  let done = fromCache, ok = fromCache, failed = 0;

  // Phase 2: chỉ build cho HS chưa có trong cache.
  // ✅ Fix #3: exponential backoff (2s → 4s → 8s) + 3 retry cho 429.
  for (let i = 0; i < needBuild.length; i++) {
    const s = needBuild[i];
    let desc = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        desc = await computeReferenceDescriptor(s.photo);
        break; // success → thoát vòng retry
      } catch (e) {
        const is429 = /429|rate.?limit/i.test(e.message);
        if (is429 && attempt < 3) {
          const wait = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
          console.warn('[face-scan] 429 → retry ' + attempt + '/3 sau ' + wait + 'ms (' + s.idNumber + ')');
          await new Promise(r => setTimeout(r, wait));
        } else {
          console.warn('[face-scan] failed', s.idNumber, '→', e.message);
          break;
        }
      }
    }
    done++;
    if (desc) {
      refDescriptors.set(s.idNumber, {
        descriptor: desc,
        studentName: s.fullName || s.name || s.idNumber
      });
      // Ghi vào cache ngay từng HS (không đợi cuối vòng) → nếu user tắt tab giữa chừng vẫn giữ được.
      cache[s.idNumber] = { photo: s.photo, desc: Array.from(desc), ts: now };
      ok++;
    } else {
      failed++;
    }
    if (onProgress) onProgress({ done, total, ok, failed });
    // Delay 300ms giữa các ảnh để tránh Google rate-limit 429.
    if (i < needBuild.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Persist cache xuống IndexedDB 1 lần ở cuối (nếu có build mới).
  if (needBuild.length > 0) await saveDescCache(cache);

  refBuildInProgress = false;
  console.log('[face-scan] refs ready:', ok, '/', total, '(failed:', failed, ')');
  if (refDescriptors.size > 0) {
    const sampleId = refDescriptors.keys().next().value;
    const sample = refDescriptors.get(sampleId);
    console.log('[face-scan] sample:', sampleId, 'descriptor[0..4]=', Array.from(sample.descriptor.slice(0, 5)));
  }
  return { ok, total, failed };
}

/* ---------- Step 5: Apply match results vào bảng điểm danh ---------- */
// Nhận output của matchFaces() (cũ ở dòng 505) — {detections, results, error}.
// results[i] có {studentId, studentName, distance, status: 'matched'|'review'|'unknown', autoTick, ticked}.
// Chỉ auto-tick status='matched' (distance < 0.5). status='review' (0.5-0.65) chỉ log + toast để user tự confirm.
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

// Step 2: Core match — detect all faces in class photo, so khớp với ref descriptors.
// Pure function, không đụng DOM. Trả array kết quả để Step 5 render.
//
// Thuật toán:
// 1. detectAllFaces + landmarks + descriptors trên ảnh lớp.
//    ⚠ Ảnh lớp chứa nhiều mặt nhỏ (xa camera) → dùng inputSize lớn hơn ref để bớt miss.
//    Trước đây dùng 320 giống ref → miss nhiều mặt <80px → 0 detection → user thấy "AI không phát hiện".
//    Ref descriptor vẫn build ở 320 (ảnh chân dung 1 người to) — OK vì detection của face-api
//    dùng inputSize độc lập với descriptor (descriptor chỉ phụ thuộc landmark68 + recognition net).
//    Nên ta có thể detect ảnh lớp ở 608, vẫn so khớp với ref build ở 320.
// 2. Mỗi detection: tính Euclidean distance vs tất cả refs → lấy min
// 3. 1-to-1 greedy best-match: sort detection theo min distance, lần lượt khớp với ref tốt nhất
//    chưa bị ai "đòi". Tránh 2 detection khớp cùng 1 HS.
// 4. Threshold:
//    - distance < 0.5  → status='matched' (auto-tick Hiện diện)
//    - 0.5 ≤ d ≤ 0.65  → status='review'  (highlight vàng, cần confirm)
//    - d > 0.65        → status='unknown' (không match ai)
async function matchFaces(classImg, refs, opts = {}) {
  const THRESHOLD_MATCH = 0.5;
  const THRESHOLD_REVIEW = 0.65;

  if (!refs || refs.size === 0) {
    return { detections: [], results: [], error: 'Chưa có ảnh tham chiếu nào được nạp.' };
  }

  // Đảm bảo model đã load (idempotent — trả về ngay nếu đã ready)
  await loadFaceApiModels();

  // ✅ Ảnh lớp nhiều người, mặt nhỏ → inputSize 608 + scoreThreshold 0.3 để tăng recall.
  // Có thể tinh chỉnh qua opts nếu user cần. Ref descriptor vẫn build ở 320 (không liên quan).
  const detectorOpts = new faceapi.TinyFaceDetectorOptions({
    inputSize: opts.inputSize || 608,
    scoreThreshold: opts.scoreThreshold || 0.3
  });

  const detections = await faceapi
    .detectAllFaces(classImg, detectorOpts)
    .withFaceLandmarks()
    .withFaceDescriptors();

  // Tính khoảng cách: mỗi detection có 1 ref candidate tốt nhất (chưa khóa)
  // candidates = [{ detIdx, refId, distance }]
  const candidates = [];
  for (let i = 0; i < detections.length; i++) {
    const det = detections[i];
    for (const [refId, ref] of refs) {
      const d = faceapi.euclideanDistance(det.descriptor, ref.descriptor);
      candidates.push({ detIdx: i, refId, refName: ref.studentName, distance: d });
    }
  }

  // Sort tăng dần theo distance → lấy matching tốt nhất trước
  candidates.sort((a, b) => a.distance - b.distance);

  // Greedy 1-to-1: mỗi detection chỉ match 1 ref, mỗi ref chỉ bị match 1 detection
  const usedDets = new Set();
  const usedRefs = new Set();
  const detMatch = new Array(detections.length).fill(null); // {refId, refName, distance}

  for (const c of candidates) {
    if (usedDets.has(c.detIdx) || usedRefs.has(c.refId)) continue;
    usedDets.add(c.detIdx);
    usedRefs.add(c.refId);
    detMatch[c.detIdx] = { refId: c.refId, refName: c.refName, distance: c.distance };
  }

  // Build results: mỗi detection → 1 result
  const results = detections.map((det, i) => {
    const m = detMatch[i];
    const box = det.detection.box;
    let status, autoTick;
    if (!m) {
      status = 'unknown';
      autoTick = false;
    } else if (m.distance < THRESHOLD_MATCH) {
      status = 'matched';
      autoTick = true;
    } else if (m.distance <= THRESHOLD_REVIEW) {
      status = 'review';
      autoTick = false; // user phải confirm
    } else {
      status = 'unknown';
      autoTick = false;
    }
    return {
      idx: i,
      box: { x: box.x, y: box.y, width: box.width, height: box.height },
      studentId: m ? m.refId : null,
      studentName: m ? m.refName : null,
      distance: m ? m.distance : null,
      confidence: m ? Math.max(0, 1 - m.distance / THRESHOLD_REVIEW) : 0,
      status,
      autoTick,
      ticked: autoTick
    };
  });

  return { detections: detections.length, results, error: null };
}

// Step 3: Crop thumbnail khuôn mặt từ ảnh lớp theo box.
// Pure function — trả data URL string (image/jpeg).
// Pad box 20% để có margin quanh mặt; resize về size×size px.
function cropFaceThumbnail(classImg, box, size = 80, paddingPct = 0.2) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const padW = box.width * paddingPct;
  const padH = box.height * paddingPct;
  let sx = Math.max(0, box.x - padW);
  let sy = Math.max(0, box.y - padH);
  let sw = box.width + padW * 2;
  let sh = box.height + padH * 2;
  // Clip vào trong ảnh
  if (sx + sw > classImg.naturalWidth) sw = classImg.naturalWidth - sx;
  if (sy + sh > classImg.naturalHeight) sh = classImg.naturalHeight - sy;

  ctx.drawImage(classImg, sx, sy, sw, sh, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
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
  fsDetections = [];
  // Step 6: clear canvas overlay
  clearFsCanvas();
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
  // Step 6: clear overlay cũ khi đổi ảnh
  clearFsCanvas();
  fsImg.src = src;
  fsImg.onload = () => {
    fsPreviewWrap.style.display = 'block';
    fsEmpty.style.display = 'none';
    fsApply.disabled = false;
    $('fs-stats').textContent = 'Kích thước: ' + fsImg.naturalWidth + ' × ' + fsImg.naturalHeight + ' px';
    // Step 6: nếu trước đó đã có detections (user load ảnh mới sau khi scan ảnh cũ) → vẽ lại
    if (fsDetections.length) drawDetectionsOverlay(fsDetections);
  };
  fsImg.onerror = () => fsShowError('Không tải được ảnh. Kiểm tra link Drive đã share "Anyone with the link" chưa.');
}

/* ---- Step 6: Canvas overlay khoanh vùng mặt ---- */

// Bảng màu theo status (xanh lá = match chắc, vàng = cần xem, xám = không match)
// Stroke đậm để nổi trên ảnh sáng; label nền đặc + text trắng cho dễ đọc.
const FS_BOX_STYLES = {
  matched: { stroke: '#16a34a', fill: 'rgba(22,163,74,0.15)', labelBg: '#16a34a', icon: '✅' },
  review:  { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.15)', labelBg: '#f59e0b', icon: '❓' },
  unknown: { stroke: '#64748b', fill: 'rgba(100,116,139,0.10)', labelBg: '#475569', icon: '?' }
};

// Clear canvas (gọi khi reset, đổi ảnh, chưa có detection)
function clearFsCanvas() {
  if (!fsCanvas || !fsCanvasCtx) return;
  fsCanvasCtx.clearRect(0, 0, fsCanvas.width, fsCanvas.height);
}

// Đồng bộ size canvas với <img> đang hiển thị thật.
// ⚠ fs-img có CSS max-w-full max-h-[60vh] → display size KHÔNG bằng natural size.
// Canvas phải có width/height attribute = natural pixel (để nét), nhưng CSS width/height
// = display size (để vừa khung ảnh). Scale = display / natural để map box.
function syncFsCanvasSize() {
  if (!fsCanvas || !fsImg || !fsImg.naturalWidth) return null;
  const displayW = fsImg.clientWidth;
  const displayH = fsImg.clientHeight;
  if (!displayW || !displayH) return null;
  // DPR để vẽ sharp trên màn hình Retina (tránh bị mờ khi zoom)
  const dpr = window.devicePixelRatio || 1;
  fsCanvas.width = Math.round(displayW * dpr);
  fsCanvas.height = Math.round(displayH * dpr);
  fsCanvas.style.width = displayW + 'px';
  fsCanvas.style.height = displayH + 'px';
  return {
    scaleX: displayW / fsImg.naturalWidth,
    scaleY: displayH / fsImg.naturalHeight,
    dpr
  };
}

// Vẽ box + label lên canvas.
// `detections` = array {box:{x,y,width,height}, studentName, status, confidence} từ matchFaces().
function drawDetectionsOverlay(detections) {
  if (!fsCanvas || !fsCanvasCtx) return;
  clearFsCanvas();
  if (!detections || !detections.length) return;
  const size = syncFsCanvasSize();
  if (!size) return; // ảnh chưa render xong
  const { scale, dpr } = { scale: size.scaleX, dpr: size.dpr }; // dùng 1 hệ số (assume uniform)

  fsCanvasCtx.save();
  fsCanvasCtx.scale(dpr, dpr);

  detections.forEach(d => {
    const style = FS_BOX_STYLES[d.status] || FS_BOX_STYLES.unknown;
    const x = d.box.x * scale;
    const y = d.box.y * scale;
    const w = d.box.width * scale;
    const h = d.box.height * scale;

    // Fill nhẹ + stroke đậm bo góc
    fsCanvasCtx.fillStyle = style.fill;
    fsCanvasCtx.strokeStyle = style.stroke;
    fsCanvasCtx.lineWidth = 3;
    const r = Math.min(8, w / 4, h / 4);
    roundRect(fsCanvasCtx, x, y, w, h, r);
    fsCanvasCtx.fill();
    fsCanvasCtx.stroke();

    // Label ở top-left của box
    let label;
    if (d.status === 'matched') {
      label = style.icon + ' ' + (d.studentName || '?');
    } else if (d.status === 'review') {
      label = style.icon + ' ' + (d.studentName || '?') + ' (xem lại)';
    } else {
      label = 'Không rõ';
    }
    drawLabel(fsCanvasCtx, label, x, y, style.labelBg);
  });

  fsCanvasCtx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawLabel(ctx, text, x, y, bgColor) {
  ctx.font = 'bold 13px system-ui, -apple-system, "Segoe UI", sans-serif';
  const padding = 6;
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const textH = 18; // line-height xấp xỉ
  const labelH = textH + padding * 2;
  const labelW = textW + padding * 2;
  // Vẽ nền
  ctx.fillStyle = bgColor;
  roundRect(ctx, x, y - labelH, labelW, labelH, 4);
  ctx.fill();
  // Vẽ text (baseline nằm ở y - padding - 2 để canh giữa)
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padding, y - labelH / 2);
}

// Redraw khi user resize window (canvas scale thay đổi theo display size)
let fsResizeTimer = null;
window.addEventListener('resize', () => {
  if (!fsDetections.length) return;
  clearTimeout(fsResizeTimer);
  fsResizeTimer = setTimeout(() => drawDetectionsOverlay(fsDetections), 100);
});
function fsConvertDriveUrl(u) {
  // /file/d/ID/view hoặc /d/ID hoặc ?id=ID hoặc /open?id=ID → lh3 CDN (bypass COEP/CORP)
  // ✅ Thêm =w800 để lấy thumbnail cho ảnh lớp (vừa đủ detect nhiều mặt, tránh ảnh gốc quá nặng).
  const m = u.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/) || u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return 'https://lh3.googleusercontent.com/d/' + m[1] + '=w800';
  // Nếu đã là lh3 mà chưa có size thì thêm size lớn hơn (800 cho ảnh lớp)
  if (u.includes('lh3.googleusercontent.com') && !/=[swh]\d+/.test(u)) return u + '=w800';
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
  // Step 6: nếu button đang ở trạng thái "Đã xong" (post-match) → đóng modal thôi.
  if (fsApply.textContent.includes('Đã xong')) {
    fsClose();
    return;
  }
  if (!fsSelectedImage) return;
  fsError.classList.add('hidden');
  try {
    fsApply.disabled = true;
    fsApply.textContent = '⏳ Tải models...';
    await loadFaceApiModels();

    // Đợi reference descriptors sẵn sàng (chạy background ở renderDD).
    // Nếu chưa xong thì đợi thêm, tối đa 30s.
    fsApply.textContent = '⏳ Chờ ảnh tham chiếu...';
    const deadline = Date.now() + 30000;
    while (refBuildInProgress && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }

    // Step 4 + 5 (gộp): detect + match trong 1 lần gọi (matchFaces cũ ở dòng 505 làm cả 2).
    fsApply.textContent = '🔍 Phát hiện & so khớp...';
    const result = await matchFaces(fsImg, refDescriptors);
    if (result.error) {
      toast('⚠ ' + result.error);
      return;
    }
    const detections = result.detections;
    const results = result.results;
    console.log('[face-scan] Step 4 — detected', detections, 'faces; Step 5 — matched',
      results.filter(r => r.status === 'matched').length, '+ review',
      results.filter(r => r.status === 'review').length);

    if (detections === 0) {
      toast('⚠ Không phát hiện khuôn mặt nào trong ảnh. Thử ảnh khác rõ hơn.');
      return;
    }

    // Lưu detections để Step 6 (UI highlight) dùng sau này.
    fsDetections = results;

    // Apply vào bảng điểm danh.
    const { ticked, review, reviewList, skipped } = applyResultsToTable(result);
    if (ticked === 0 && review === 0) {
      // Vẫn vẽ overlay để user thấy AI detect được những ai (không match ai trong lớp)
      drawDetectionsOverlay(results);
      toast('⚠ Phát hiện ' + detections + ' mặt nhưng không khớp HS nào trong lớp.');
      return;
    }
    let summary = '✅ Tick ' + ticked + ' HS hiện diện';
    if (review > 0) summary += ' (có ' + review + ' cần xem lại: ' + reviewList.slice(0, 3).join(', ') + (reviewList.length > 3 ? '…' : '') + ')';
    if (skipped.length) summary += ' (bỏ qua ' + skipped.length + ' đã tick trước)';
    toast(summary);
    console.log('[face-scan] result:', { ticked, review, reviewList, skipped });

    // Step 6: Vẽ canvas overlay khoanh vùng mặt trên ảnh preview.
    // Đợi 1 tick để img.clientWidth cập nhật sau khi DOM paint xong.
    requestAnimationFrame(() => drawDetectionsOverlay(results));

    // Step 6: KHÔNG tự đóng modal — user cần xem overlay để verify AI đúng.
    // Đổi button text thành "✓ Đã xong & Đóng", user click mới đóng.
    fsApply.disabled = false;
    fsApply.textContent = '✓ Đã xong & Đóng';
  } catch (e) {
    console.error('[face-scan] error:', e);
    fsShowError(e.message);
  } finally {
    // KHÔNG reset button text ở đây nữa — nếu success thì text đã là "✓ Đã xong & Đóng".
    // Nếu error → text vẫn là "🤖 Quét & Gợi ý" từ lần trước hoặc lỗi ở try-catch trên. Reset nhẹ:
    if (fsApply.textContent.startsWith('⏳') || fsApply.textContent.startsWith('🔍')) {
      fsApply.disabled = false;
      fsApply.textContent = '🤖 Quét & Gợi ý';
    }
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
