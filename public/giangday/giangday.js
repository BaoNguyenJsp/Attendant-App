/* =====================================================================
   SỔ THIẾU NHI — giangday/index.js (Client-Side Memory Cache Architecture)
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TCLASSES, cur, USERS_ROWS, defaultWeek, normSunday, year, fmtDate } from '../shared/common.js';
import { userFull, fileLink } from '../shared/ui.js';

await initCommon();

let editingClass = null, editingRec = null, TEACHING_BY_CLASS = {};
let planKeep = [], planAdd = [], revKeep = [], revAdd = [];
const FPLAN = 'GLV', FTBM = 'TBM';
const HIST_PAGE = 8; let histPage = 1;
let isSaving = false;

// Validation Constants
const MAX_FILE_COUNT = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB Limit

// Global memory cache for current school year teaching records
let ALL_TEACHING_RECORDS = [];

const badgeLinks = (url, names, rev) => {
  const ns = String(names || '').split('\n');
  return String(url || '').split(',').map(x => x.trim()).filter(f => /^https?:\/\//i.test(f))
    .map((f, i) => {
      const name = (ns[i] || '').trim();
      const m = name.match(/\.([a-z0-9]{1,6})$/i);
      const label = m ? m[1].toUpperCase() : 'Url';
      return '<a class="file-badge' + (rev ? ' reviewed' : '') + '" href="' + esc(f) + '" target="_blank" rel="noopener" title="' +
        esc(name || (rev ? 'Bản sửa' : 'Giáo án')) + '">' + label + '</a>';
    }).join(' ');
};

const glvLabel = em => {
  const e = String(em || '').toLowerCase();
  const u = USERS_ROWS.find(x => String(x.Email).toLowerCase() === e);
  const s = u ? String(u.SaintName || '').trim() : '';
  const f = userFull(em);
  return s ? s + ' ' + f : f;
};

const fmtSize = bytes => {
  if (!bytes) return '';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/* ---------- Fetch All Records Once ---------- */
async function loadAllTeachingData(force = false) {
  if (ALL_TEACHING_RECORDS.length > 0 && !force) return ALL_TEACHING_RECORDS;
  try {
    const res = await api('getTeaching', { schoolYear: year() });
    ALL_TEACHING_RECORDS = res.records || [];
  } catch (e) {
    toast('Lỗi khi tải dữ liệu giảng dạy: ' + e.message);
    ALL_TEACHING_RECORDS = [];
  }
  return ALL_TEACHING_RECORDS;
}

/* ---------- Cards (Active Week Only - Client Filtered) ---------- */
function renderCards() {
  const weekInp = $('gd-week');
  if (!weekInp.value) weekInp.value = defaultWeek();
  normSunday(weekInp);
  
  const wk = weekInp.value;
  const weekRecords = ALL_TEACHING_RECORDS.filter(r => String(r.WeekOf).trim() === wk);
  
  const byClass = {}; 
  weekRecords.forEach(r => byClass[r.ClassName] = r);
  TEACHING_BY_CLASS = byClass;
  
  $('gd-summary').textContent = Object.keys(byClass).length + '/' + TCLASSES.length + ' lớp đã cập nhật';
  $('cards').innerHTML = TCLASSES.map(c => {
    const rec = byClass[c.ClassName];
    const badge = rec ? '<span class="status-badge updated">Đã cập nhật</span>' : '<span class="status-badge">Chưa nhập</span>';
    const gv = rec && rec.TeacherEmail ? '<strong>' + esc(glvLabel(rec.TeacherEmail)) + '</strong>' : '<strong>Chưa phân công</strong>';
    const lesson = rec && rec.LessonContent ? esc(rec.LessonContent) : 'Chưa có nội dung';
    const plan = rec && rec.LessonPlanUrl ? badgeLinks(rec.LessonPlanUrl, rec.LessonPlanNames, false) : '<span style="color:#aaa;">Chưa đính kèm</span>';
    const rev = rec && rec.RevisedPlanUrl ? badgeLinks(rec.RevisedPlanUrl, rec.RevisedPlanNames, true) : '<span style="color:#aaa;">Chưa có bản chỉnh sửa</span>';
    
    return '<div class="card' + (rec ? ' updated' : '') + '">' +
      '<div>' +
      '<h3><b>' + esc(c.ClassName) + '</b>' + badge + '</h3>' +
      '<div class="info-group"><div class="info-label">Giáo lý viên:</div><div class="info-value">' + gv + '</div></div>' +
      '<div class="info-group"><div class="info-label">Nội dung bài học:</div><div class="info-value">' + lesson + '</div></div>' +
      '<div class="info-group"><div class="info-label">Giáo án (GLV):</div><div class="info-value">' + plan + '</div></div>' +
      '<div class="info-group"><div class="info-label" style="color:#8e44ad;">Giáo án đã chỉnh sửa (TBM):</div><div class="info-value">' + rev + '</div></div>' +
      '</div>' +
      '<button class="btn-update" data-cls="' + esc(c.ClassName) + '">Cập nhật bài học</button>' +
      '</div>';
  }).join('');
}

/* ---------- Frequency (Client Filtered) ---------- */
function renderFreq() {
  const cls = $('gd-cls').value;
  const filtered = cls 
    ? ALL_TEACHING_RECORDS.filter(r => r.ClassName === cls)
    : ALL_TEACHING_RECORDS;
    
  const by = {};
  filtered.forEach(r => { if (r.TeacherEmail) by[r.TeacherEmail] = (by[r.TeacherEmail] || 0) + 1; });
  const freq = Object.entries(by).sort((a, b) => b[1] - a[1]);
  
  $('gd-freq').innerHTML = freq.length
    ? freq.map(([em, cnt]) => '<li class="flex justify-between py-1"><span class="text-slate-600">' + esc(glvLabel(em)) + '</span><span class="freq-count">' + cnt + ' tuần</span></li>').join('')
    : '<p class="text-slate-400">Chưa có dữ liệu.</p>';
}

/* ---------- History (Client Filtered & Paginated) ---------- */
function renderHist() {
  const cls = $('gd-cls').value;
  const filtered = cls 
    ? ALL_TEACHING_RECORDS.filter(r => r.ClassName === cls)
    : ALL_TEACHING_RECORDS;
    
  const total = filtered.length;
  const totalBadge = $('gd-total-updates');
  if (totalBadge) totalBadge.textContent = 'Tổng số buổi đã cập nhật: ' + total;

  const startIdx = (histPage - 1) * HIST_PAGE;
  const pageRecords = filtered.slice(startIdx, startIdx + HIST_PAGE);

  $('gd-history').innerHTML = pageRecords.length
    ? pageRecords.map(r => '<tr>' +
      '<td>' + esc(fmtDate(r.WeekOf)) + '</td>' +
      '<td>' + esc(r.ClassName) + '</td>' +
      '<td>' + esc(glvLabel(r.TeacherEmail)) + '</td>' +
      '<td class="max-w-xs truncate">' + esc(r.LessonContent || '') + '</td>' +
      '<td class="whitespace-nowrap text-center">' +
        (r.LessonFolderUrl ? '<a class="file-badge" href="' + esc(r.LessonFolderUrl) + '" target="_blank" rel="noopener" title="Mở thư mục giáo án (GLV)">📁</a>' : '—') +
      '</td>' +
      '<td class="whitespace-nowrap text-center">' +
        (r.RevisedFolderUrl ? '<a class="file-badge reviewed" href="' + esc(r.RevisedFolderUrl) + '" target="_blank" rel="noopener" title="Mở thư mục bản chỉnh sửa (TBM)">✏️</a>' : '—') +
      '</td>' +
      '<td>' + esc(userFull(r.UpdatedBy)) + '</td>' +
      '</tr>').join('')
    : '<tr><td colspan="7" class="text-slate-400 text-center py-4">Chưa có dữ liệu.</td></tr>';
    
  renderPager(total, histPage);
}

function renderPager(total, page) {
  const pages = Math.max(1, Math.ceil(total / HIST_PAGE));
  const from = total ? (page - 1) * HIST_PAGE + 1 : 0;
  const to = Math.min(total, page * HIST_PAGE);
  $('gd-pager').innerHTML =
    '<span class="page-info">' + (total ? from + '–' + to + ' / ' + total + ' dòng' : '') + '</span>' +
    '<span class="flex gap-2">' +
    '<button class="btn-page" data-pg="prev"' + (page <= 1 ? ' disabled' : '') + '>‹ Trước</button>' +
    '<button class="btn-page" data-pg="next"' + (page >= pages ? ' disabled' : '') + '>Sau ›</button>' +
    '</span>';
}

/* ---------- Modals & Files ---------- */
const splitUrls = s => String(s || '').split(',').map(x => x.trim()).filter(x => /^https?:\/\//i.test(x));
const splitNames = s => String(s || '').split('\n');
const linkList = (urls, names) => {
  const n = splitNames(names);
  return splitUrls(urls).map((f, i) => ({ url: f, name: n[i] || '' }));
};

function openModal(cls) {
  editingClass = cls;
  editingRec = TEACHING_BY_CLASS[cls] || null;
  editingLink = null;
  $('gd-modal-title').textContent = 'Giáo án — ' + cls;
  $('gd-teacher').value = editingRec && editingRec.TeacherEmail ? glvLabel(editingRec.TeacherEmail) : glvLabel(cur.email);
  $('gd-lesson').value = editingRec ? (editingRec.LessonContent || '') : '';
  planKeep = linkList(editingRec && editingRec.LessonPlanUrl, editingRec && editingRec.LessonPlanNames);
  revKeep = linkList(editingRec && editingRec.RevisedPlanUrl, editingRec && editingRec.RevisedPlanNames);
  planAdd = []; revAdd = [];
  $('f-plan').value = '';$('f-rev').value = '';
  renderLists();
  $('gd-modal').classList.add('open');
}

function renderFileCard(name, url, isUploading, size, listKind, groupKind, index, isReviewed) {
  const ext = (name || '').split('.').pop().toLowerCase();
  
  let iconClass = 'icon-default';
  let iconLabel = '📄';

  if (['doc', 'docx'].includes(ext)) { iconClass = 'icon-docx'; iconLabel = 'W'; }
  else if (['ppt', 'pptx'].includes(ext)) { iconClass = 'icon-pptx'; iconLabel = 'P'; }
  else if (ext === 'pdf') { iconClass = 'icon-pdf'; iconLabel = 'P'; }
  else if (ext === 'mp4') { iconClass = 'icon-mp4'; iconLabel = '▶'; }
  else if (!/\.[a-z0-9]{1,6}$/i.test(name || '')) { iconLabel = '🔗'; }

  const editable = groupKind === 'keep';
  const nameHtml = editable
    ? `<button type="button" class="file-name file-name-edit" data-list="${listKind}" data-i="${index}" title="Bấm để đổi tên / chọn loại">${esc(name)}</button>`
    : url
      ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="file-name hover:underline" title="${esc(name)}">${esc(name)}</a>`
      : `<div class="file-name" title="${esc(name)}">${esc(name)}</div>`;

  const iconInner = `<div class="file-icon ${iconClass}">${iconLabel}</div>`;
  const iconHtml = editable && url
    ? `<a class="file-icon-link" href="${esc(url)}" target="_blank" rel="noopener" title="Mở link">${iconInner}</a>`
    : iconInner;

  // Status indicator logic:
  // 1. Actively uploading -> Spinner + "Đang upload"
  // 2. Local file pending save -> "⏳ Chờ upload" (No checkmark)
  // 3. Finished / Saved on Drive -> "✓ Đã thêm"
  let metaHtml = '';
  if (isUploading) {
    metaHtml = `<span class="text-blue-600 font-medium animate-pulse flex items-center gap-1">
         <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
         Đang upload (${fmtSize(size)})
       </span>`;
  } else if (!url) {
    metaHtml = `${fmtSize(size) ? fmtSize(size) + ' • ' : ''}<span class="text-amber-600 font-medium">⏳ Chờ upload</span>`;
  } else {
    metaHtml = `${fmtSize(size) ? fmtSize(size) + ' • ' : ''}<span class="text-emerald-600 font-semibold">✓ Đã thêm</span>`;
  }

  return `
    <div class="file-card">
      ${iconHtml}
      <div class="file-info">
        ${nameHtml}
        <div class="file-meta">${metaHtml}</div>
      </div>
      <button type="button" class="btn-remove-file chip-rm" data-list="${listKind}" data-grp="${groupKind}" data-i="${index}" title="Gỡ bỏ">✕</button>
    </div>
  `;
}

function renderLists() {
  const keepCard = (k, i, listKind, rev) => (editingLink && editingLink.list === listKind && editingLink.i === i)
    ? renderEditCard(k, i, listKind)
    : renderFileCard(k.name, k.url, false, k.size, listKind, 'keep', i, rev);

  $('plan-list').innerHTML = [
    ...planKeep.map((k, i) => keepCard(k, i, FPLAN, false)),
    ...planAdd.map((f, i) => renderFileCard(f.name, null, f.isUploading, f.size, FPLAN, 'add', i, false))
  ].join('');

  $('rev-list').innerHTML = [
    ...revKeep.map((k, i) => keepCard(k, i, FTBM, true)),
    ...revAdd.map((f, i) => renderFileCard(f.name, null, f.isUploading, f.size, FTBM, 'add', i, true))
  ].join('');
}

function processIncomingFiles(files, kind) {
  const isPlan = kind === FPLAN;
  const currentKeep = isPlan ? planKeep : revKeep;
  const currentAdd = isPlan ? planAdd : revAdd;

  for (const f of files) {
    if (currentKeep.length + currentAdd.length >= MAX_FILE_COUNT) {
      toast(`Chỉ được phép tối đa ${MAX_FILE_COUNT} file cho phần này.`);
      break;
    }

    if (f.size > MAX_FILE_SIZE) {
      toast(`File "${f.name}" vượt quá kích thước tối đa ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
      continue;
    }

    currentAdd.push(f);
  }
  renderLists();
}

function attachFileHandlers(input, dropzone, kind) {
  input.addEventListener('change', () => {
    processIncomingFiles([...input.files], kind);
    input.value = '';
  });

  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('border-blue-500', 'bg-blue-50/40');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, e => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('border-blue-500', 'bg-blue-50/40');
    }, false);
  });

  dropzone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      processIncomingFiles([...dt.files], kind);
    }
  });
}

const LINK_TYPES = ['pdf', 'docx', 'pptx', 'mp4'];
const extOf = s => { const m = String(s || '').match(/\.([a-z0-9]{1,6})$/i); return m ? m[1].toLowerCase() : ''; };
const stripExt = s => s.replace(/\.[a-z0-9]{1,6}$/i, '');

const YT_URL = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;

// Host/path nhận diện được ngay là file (không xem được header vì CORS chặn).
const KNOWN_FILES = [
  [/^https?:\/\/docs\.google\.com\/document\/d\//i, 'Google Tài liệu.docx'],
  [/^https?:\/\/docs\.google\.com\/spreadsheets\/d\//i, 'Google Trang tính.xlsx'],
  [/^https?:\/\/docs\.google\.com\/presentation\/d\//i, 'Google Trình chiếu.pptx'],
  [/^https?:\/\/drive\.google\.com\/drive\/folders\//i, 'Thư mục Drive'],
  [/^https?:\/\/drive\.google\.com\/file\/d\//i, 'Tài liệu Drive'],
];

// Tên suy ra từ chính URL — hiện ngay, không gọi mạng. Không đọc được Content-Type
// / Content-Disposition của link ngoài (CORS), nên đây chỉ là nhận dạng theo mẫu.
function inferLink(url) {
  if (YT_URL.test(url)) return { name: 'Video YouTube.mp4' };
  for (const [re, name] of KNOWN_FILES) if (re.test(url)) return { name };
  let base = '';
  try { base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); } catch { base = ''; }
  return { name: /\.[a-z0-9]{1,6}$/i.test(base) ? base : 'Tài liệu' };
}

// YouTube: lấy tiêu đề thật qua oEmbed (cho phép CORS). Link khác giữ tên suy từ
// URL — người dùng bấm vào tên để tự sửa.
async function enrichLink(item) {
  if (!YT_URL.test(item.url)) return;
  try {
    const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(item.url));
    if (!r.ok) return;
    const j = await r.json();
    const title = String(j && j.title || '').replace(/[\r\n,]+/g, ' ').trim().slice(0, 120);
    if (title) { item.name = title + '.mp4'; renderLists(); }
  } catch { /* giữ tên mặc định */ }
}

// Chỉnh sửa inline 1 link đã thêm: { list, i }
let editingLink = null;
const listId = kind => kind === FPLAN ? 'plan-list' : 'rev-list';

function renderEditCard(item, i, listKind) {
  const ext = extOf(item.name);
  const t = LINK_TYPES.includes(ext) ? ext : '';
  const base = t ? item.name.slice(0, -(t.length + 1)) : item.name;
  const opt = (v, label) => `<option value="${v}"${t === v ? ' selected' : ''}>${label}</option>`;
  return `
    <div class="file-card editing">
      <div class="file-info">
        <input class="edit-name" data-list="${listKind}" data-i="${i}" value="${esc(base)}" placeholder="Tên hiển thị">
        <select class="edit-type" data-list="${listKind}" data-i="${i}">
          <option value=""${t ? '' : ' selected'}>Khác</option>
          ${opt('pdf', 'PDF')}${opt('docx', 'Word')}${opt('pptx', 'PowerPoint')}${opt('mp4', 'Video')}
        </select>
      </div>
      <button type="button" class="btn-edit-save" data-list="${listKind}" data-i="${i}" title="Lưu">✓</button>
      <button type="button" class="btn-edit-cancel" title="Hủy">✕</button>
    </div>`;
}

function attachLinkAdder(section, kind) {
  const row = section && section.querySelector('.link-add-row');
  if (!row) return;
  const urlI = row.querySelector('[data-f="url"]');

  const add = () => {
    const url = urlI.value.trim();
    if (!/^https?:\/\//i.test(url)) return toast('URL không hợp lệ (phải bắt đầu bằng http).');
    if (url.includes(',')) return toast('URL không được chứa dấu phẩy.');

    const isPlan = kind === FPLAN;
    const keep = isPlan ? planKeep : revKeep;
    const pending = isPlan ? planAdd : revAdd;
    if (keep.length + pending.length >= MAX_FILE_COUNT) return toast(`Chỉ được phép tối đa ${MAX_FILE_COUNT} file cho phần này.`);

    const item = { url, ...inferLink(url) };
    keep.push(item);
    urlI.value = '';
    renderLists();
    enrichLink(item);
  };

  row.querySelector('.btn-link-add').addEventListener('click', add);
  row.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
}

async function uploadFileDirect(f, wk, cls, kind) {
  const r = await api('getUploadUrl', { 
    schoolYear: year(), 
    weekOf: wk, 
    className: cls, 
    kind, 
    filename: f.name,
    origin: window.location.origin 
  });
  if (r.status !== 'ok') throw new Error(r.message);
  
  const res = await fetch(r.uploadUrl, {
    method: 'PUT',
    mode: 'cors',
    headers: { 'Content-Type': f.type || 'application/octet-stream' },
    body: f
  });
  
  if (!res.ok) throw new Error('Upload trực tiếp thất bại');
  const data = await res.json();
  return 'https://drive.google.com/file/d/' + data.id + '/view';
}

async function uploadBatched(list, keepList, kind, wk, cls, batchSize = 3) {
  let failedCount = 0;
  const filesToUpload = [...list]; 
  
  for (let i = 0; i < filesToUpload.length; i += batchSize) {
    const chunk = filesToUpload.slice(i, i + batchSize);
    
    chunk.forEach(f => f.isUploading = true);
    renderLists();

    await Promise.all(chunk.map(async f => {
      try {
        const driveUrl = await uploadFileDirect(f, wk, cls, kind);
        const idx = list.indexOf(f);
        if (idx > -1) list.splice(idx, 1);
        keepList.push({ url: driveUrl, name: f.name, size: f.size });
      } catch (e) {
        f.isUploading = false;
        failedCount++;
      } finally {
        renderLists();
      }
    }));
  }
  
  if (failedCount > 0) {
    throw new Error(`Có ${failedCount} file tải lên thất bại. Vui lòng thử bấm lưu lại để tải tiếp.`);
  }
}

async function saveTeaching() {
  if (isSaving) return;
  
  const lesson = $('gd-lesson').value.trim();
  if (!lesson && !editingRec) return toast('Nhập nội dung bài học trước khi lưu.');
  
  const wk = $('gd-week').value;
  const btn = document.querySelector('.btn-save');
  const ogText = btn.textContent;
  
  isSaving = true;
  btn.disabled = true;
  btn.textContent = '⏳ Đang xử lý...';

  try {
    await uploadBatched(planAdd, planKeep, FPLAN, wk, editingClass, 3);
    await uploadBatched(revAdd, revKeep, FTBM, wk, editingClass, 3);

    const body = {
      schoolYear: year(), weekOf: wk, className: editingClass, lessonContent: lesson,
      lessonPlanUrl: planKeep.map(k => k.url).join(','),
      lessonPlanNames: planKeep.map(k => k.name).join('\n'),
      revisedPlanUrl: revKeep.map(k => k.url).join(','),
      revisedPlanNames: revKeep.map(k => k.name).join('\n')
    };

    await api('saveTeaching', body);
    $('gd-modal').classList.remove('open');
    toast('Đã lưu giáo án.');

    await loadAllTeachingData(true);
    renderCards();
    renderFreq();
    renderHist();
  } catch (e) { 
    toast(e.message); 
  } finally {
    isSaving = false;
    btn.disabled = false;
    btn.textContent = ogText;
  }
}

/* ---------- Boot ---------- */
const [cl, te] = await Promise.all([api('getClasses'), api('getTeachers')]);
setState({ TCLASSES: cl.classes || [], USERS_ROWS: te.users || [], GROUP_MEMBERS: te.members || [], GROUPS_LIST: te.groups || [] });

const gdModal = $('gd-modal');
gdModal.addEventListener('click', e => {
  if (isSaving) return;
  if (e.target === gdModal) return gdModal.classList.remove('open');

  const rm = e.target.closest('.chip-rm');
  if (rm) {
    const arr = rm.dataset.grp === 'keep'
      ? (rm.dataset.list === FPLAN ? planKeep : revKeep)
      : (rm.dataset.list === FPLAN ? planAdd : revAdd);
    arr.splice(+rm.dataset.i, 1);
    if (editingLink && editingLink.list === rm.dataset.list && editingLink.i === +rm.dataset.i) editingLink = null;
    return renderLists();
  }

  const nameBtn = e.target.closest('.file-name-edit');
  if (nameBtn) {
    editingLink = { list: nameBtn.dataset.list, i: +nameBtn.dataset.i };
    renderLists();
    const inp = $('plan-list').querySelector('.edit-name') || $('rev-list').querySelector('.edit-name');
    if (inp) { inp.focus(); inp.select(); }
    return;
  }

  const save = e.target.closest('.btn-edit-save');
  if (save) {
    const card = save.closest('.file-card');
    const name = card.querySelector('.edit-name').value.trim();
    const type = card.querySelector('.edit-type').value;
    const arr = save.dataset.list === FPLAN ? planKeep : revKeep;
    const item = arr[+save.dataset.i];
    const base = name || stripExt(item.name);
    item.name = type ? stripExt(base) + '.' + type : base;
    editingLink = null;
    return renderLists();
  }

  if (e.target.closest('.btn-edit-cancel')) {
    editingLink = null;
    renderLists();
  }
});

gdModal.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList.contains('edit-name')) {
    e.preventDefault();
    e.target.closest('.file-card').querySelector('.btn-edit-save')?.click();
  }
});

gdModal.querySelector('.btn-cancel').addEventListener('click', () => { if (!isSaving) gdModal.classList.remove('open'); });
gdModal.querySelector('.btn-save').addEventListener('click', () => saveTeaching());

attachFileHandlers($('f-plan'),$('f-plan')?.closest('.dropzone'), FPLAN);
attachFileHandlers($('f-rev'),$('f-rev')?.closest('.dropzone'), FTBM);
attachLinkAdder($('f-plan')?.closest('.upload-section'), FPLAN);
attachLinkAdder($('f-rev')?.closest('.upload-section'), FTBM);

$('gd-week').addEventListener('change', () => { normSunday($('gd-week')); renderCards(); });$('cards').addEventListener('click', e => { const b = e.target.closest('.btn-update'); if (b) openModal(b.dataset.cls); });

$('gd-cls').innerHTML = '<option value="">Tất cả các lớp</option>' +
  TCLASSES.map(c => '<option value="' + esc(c.ClassName) + '">' + esc(c.ClassName) + '</option>').join('');

$('gd-cls').addEventListener('change', () => { 
  histPage = 1; 
  renderHist(); 
  renderFreq();
});

$('gd-pager').addEventListener('click', e => {
  const b = e.target.closest('.btn-page');
  if (!b || b.disabled) return;
  histPage += b.dataset.pg === 'next' ? 1 : -1;
  renderHist();
});

// Initial boot: fetch once, then render all client views instantly
await loadAllTeachingData();
renderCards();
renderFreq();
renderHist();