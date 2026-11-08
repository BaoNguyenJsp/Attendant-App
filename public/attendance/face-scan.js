/* =====================================================================
   SỔ THIẾU NHI — attendance/face-scan.js
   Face-scan suggestion (UC-T2): faces in up to 3 class photos are matched in the
   browser with the stored student photos; matched students are ticked present.
   Nothing is saved here.
   ===================================================================== */
'use strict';

import { $, toast } from '../shared/common.js';

// The attendance table of the page: { markOf(key), markPresent(key), refresh() }. key = student id as text.
let table = null;
export function initFaceScan(adapter) { table = adapter; }

/* ---------- Face Scan Modal ---------- */
const fsModal = $('fs-modal');
const fsEmpty = $('fs-empty');
const fsPreviewWrap = $('fs-preview-wrap');
const fsImg = $('fs-img');
const fsError = $('fs-error');
const fsApply = $('fs-apply');
const fsCanvas = $('fs-canvas');
const fsCanvasCtx = fsCanvas ? fsCanvas.getContext('2d') : null;

let fsSelectedImages = [];
let fsCurrentImgIdx = 0;
let fsDetectionsPerImg = [];
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
let globalPauseUntil = 0;
const DESC_CACHE_KEY = 'face-ref-cache-v2';
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

async function loadImageCORS(url, timeoutMs = 15000) {
  // img.src first — lh3.googleusercontent.com rate-limits fetch far more aggressively
  try {
    const img = await loadImgElement(url, 'anonymous', timeoutMs);
    return { img, tainted: false };
  } catch (e1) {
    try {
      const r = await fetchWithTimeout(url, timeoutMs);
      if (!r.ok) throw new Error('HTTP ' + r.status); // surfaces 429 to retry loop
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      try {
        const img = await loadImgElement(objUrl, 'anonymous', timeoutMs);
        return { img, tainted: false };
      } finally { URL.revokeObjectURL(objUrl); }
    } catch (e2) {
      if (/429|rate.?limit/i.test(e2.message)) throw e2;
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
  const { img } = await loadImageCORS(photoUrl);
  await loadFaceApiModels();
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const det = await faceapi.detectSingleFace(img, opts).withFaceLandmarks().withFaceDescriptor();
  return det ? det.descriptor : null;
}

async function buildReferenceDescriptors(students, onProgress) {
  if (refBuildInProgress) return;
  refBuildInProgress = true;

  const currentIds = new Set(students.map(s => s.key));
  for (const id of [...refDescriptors.keys()]) {
    if (!currentIds.has(id)) refDescriptors.delete(id);
  }

  const cache = await loadDescCache();
  const now = Date.now();
  const list = students.filter(s => s.photo && s.photo.trim());
  const total = list.length;
  console.log(`[FaceScan] Tổng học sinh: ${students.length}, có ảnh: ${total}, không có ảnh: ${students.length - total}`);

  let fromCache = 0;
  for (const s of list) {
    if (refDescriptors.has(s.key)) continue;
    const c = cache[s.key];
    if (c && c.photo === s.photo && (now - c.ts) < DESC_CACHE_TTL_MS) {
      refDescriptors.set(s.key, { descriptor: new Float32Array(c.desc), studentName: s.fullName || s.key });
      fromCache++;
    }
  }

  const needBuild = list.filter(s => !refDescriptors.has(s.key));
  console.log(`[FaceScan] Từ cache: ${fromCache}, cần tải mới: ${needBuild.length}`);
  let done = fromCache, ok = fromCache, failed = 0;

  for (let i = 0; i < needBuild.length; i++) {
    const wait = globalPauseUntil - Date.now();
    if (wait > 0) {
      console.log(`[FaceScan] Rate limit pause ${Math.ceil(wait/1000)}s...`);
      await new Promise(r => setTimeout(r, wait));
    }

    const s = needBuild[i];
    let desc = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try { desc = await computeReferenceDescriptor(s.photo); break; }
      catch (e) {
        if (/429|rate.?limit/i.test(e.message) && attempt < 5) {
          const pause = 15000 * Math.pow(2, attempt - 1); // 15s, 30s, 60s, 120s
          globalPauseUntil = Date.now() + pause;
          console.log(`[FaceScan] 429 — global pause ${pause/1000}s`);
          await new Promise(r => setTimeout(r, pause));
        } else break;
      }
    }
    done++;
    if (desc) {
      refDescriptors.set(s.key, { descriptor: desc, studentName: s.fullName || s.key });
      cache[s.key] = { photo: s.photo, desc: Array.from(desc), ts: now };
      ok++;
    } else failed++;

    if (onProgress) onProgress({ done, total, ok, failed });
  }

  if (needBuild.length > 0) await saveDescCache(cache);
  refBuildInProgress = false;
  return { ok, total, failed };
}

function applyResultsToTable(matchResult) {
  if (!matchResult || !matchResult.results) return { ticked: 0, review: 0, reviewList: [], skipped: [] };
  let ticked = 0, review = 0;
  const reviewList = [], skipped = [];
  for (const r of matchResult.results) {
    if (r.status === 'matched' && r.studentId) {
      const mark = table.markOf(r.studentId);
      if (mark === undefined) continue;
      // A student who already has a mark is never changed by the scan.
      if (mark !== 0) { skipped.push(r.studentName + ' (đã điểm danh)'); continue; }
      table.markPresent(r.studentId);
      ticked++;
    } else if (r.status === 'review' && r.studentId) {
      review++;
      reviewList.push(r.studentName + ' (d=' + r.distance.toFixed(2) + ')');
    }
  }
  table.refresh();
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

function fsAddImage(src, source) {
  if (fsSelectedImages.length < MAX_FS_IMAGES) {
    fsSelectedImages.push({ src, source });
    fsDetectionsPerImg.push([]);
    fsCurrentImgIdx = fsSelectedImages.length - 1;
  } else {
    fsSelectedImages[fsCurrentImgIdx] = { src, source };
    fsDetectionsPerImg[fsCurrentImgIdx] = [];
  }
  fsApply.disabled = false;
  fsApply.textContent = '🤖 Quét & Gợi ý';
  loadImgIntoSlot(fsCurrentImgIdx);
}

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

  const addLabel = $('fs-file-add-label');
  if (addLabel) {
    if (fsSelectedImages.length >= MAX_FS_IMAGES) {
      addLabel.classList.add('hidden');
    } else {
      addLabel.classList.remove('hidden');
    }
  }
}

function fsSwitchToImg(idx) {
  if (idx < 0 || idx >= fsSelectedImages.length) return;
  loadImgIntoSlot(idx);
}

function fsRemoveCurrentImg() {
  if (fsSelectedImages.length === 0) return;
  fsSelectedImages.splice(fsCurrentImgIdx, 1);
  fsDetectionsPerImg.splice(fsCurrentImgIdx, 1);

  if (fsCurrentImgIdx >= fsSelectedImages.length) fsCurrentImgIdx = Math.max(0, fsSelectedImages.length - 1);

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

$('att-facescan')?.addEventListener('click', fsOpen);
$('fs-close')?.addEventListener('click', fsClose);
$('fs-cancel')?.addEventListener('click', fsClose);
fsModal?.addEventListener('click', e => { if (e.target === fsModal) fsClose(); });

$('fs-file')?.addEventListener('change', e => {
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

function loadFileIntoSlot(file, slotIdx) {
  if (!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    if (slotIdx < fsSelectedImages.length) {
      fsSelectedImages[slotIdx] = { src: ev.target.result, source: 'file' };
      fsDetectionsPerImg[slotIdx] = [];
      loadImgIntoSlot(slotIdx);
    } else {
      fsAddImage(ev.target.result, 'file');
    }
  };
  reader.onerror = () => fsShowError('Không đọc được file.');
  reader.readAsDataURL(file);
}

$('fs-load-urls')?.addEventListener('click', () => {
  const raw = $('fs-urls').value.trim();
  if (!raw) return fsShowError('Chưa nhập URL.');
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

    const totalImgs = fsSelectedImages.length;
    let totalDetections = 0;
    let allResults = [];
    for (let i = 0; i < totalImgs; i++) {
      fsApply.textContent = '🔍 Phát hiện ảnh ' + (i + 1) + '/' + totalImgs + '...';
      fsCurrentImgIdx = i;
      clearFsCanvas();
      fsImg.src = fsSelectedImages[i].src;

      await new Promise((resolve) => {
        if (fsImg.complete && fsImg.naturalWidth) return resolve();
        fsImg.onload = resolve;
        fsImg.onerror = resolve;
      });

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
      fsSwitchToImg(0);
      return;
    }

    const mergedResult = { results: allResults, detections: totalDetections };
    const { ticked, review, reviewList, skipped } = applyResultsToTable(mergedResult);

    fsCurrentImgIdx = 0;
    fsSwitchToImg(0);

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

export { buildReferenceDescriptors, updateRefBadge };
