/* =====================================================================
   SỔ THIẾU NHI — lessons/lessons.js
   Weekly board (UC-L1), lesson form with files and links (UC-L2 to L4),
   statistics by class (UC-L5).
   ===================================================================== */
'use strict';

import {
  initCommon, load, state, $, api, esc, toast, setupTabs,
  canWriteClass, className, personName, upcomingSunday, snapToSunday, fmtDate,
} from '../shared/common.js';

await initCommon();
await load('classes');

const MAX_UPLOADS = 3; // uploaded files per slot; links are not limited
const MAX_BYTES = 10 * 1024 * 1024;
const PAGE_SIZE = 8;

let lessons = []; // every lesson of the current school year, newest week first
let historyPage = 1;
let saving = false;
let editing = null; // { classId, lesson } while the form is open
let editingLink = null; // { slot, i } while one entry is being renamed
// Per slot: `kept` are saved entries and links, `queued` are File objects waiting to be uploaded on save.
const slots = {
  PLAN: { kept: [], queued: [], listId: 'plan-list', inputId: 'file-plan' },
  REVISED: { kept: [], queued: [], listId: 'revised-list', inputId: 'file-revised' },
};

async function loadLessons() {
  try {
    lessons = (await api('getLessons', { schoolYear: state.year })).lessons;
  } catch (e) {
    lessons = [];
    toast(`Lỗi khi tải dữ liệu giảng dạy: ${e.message}`);
  }
}

const extensionOf = (name) => (String(name ?? '').match(/\.([a-z0-9]{1,6})$/i)?.[1] ?? '').toLowerCase();
const stripExtension = (name) => String(name ?? '').replace(/\.[a-z0-9]{1,6}$/i, '');

const fileBadges = (files, revised) => files
  .map((f) => `<a class="file-badge${revised ? ' reviewed' : ''}" href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.name || (revised ? 'Bản sửa' : 'Giáo án'))}">${esc(extensionOf(f.name).toUpperCase() || 'Url')}</a>`)
  .join(' ');

/* ---------- Tab 1: weekly board ---------- */
function renderCards() {
  snapToSunday($('ls-week'));
  const weekOf = $('ls-week').value;
  const byClass = new Map(lessons.filter((l) => l.weekOf === weekOf).map((l) => [l.classId, l]));
  $('ls-summary').textContent = `${byClass.size}/${state.classes.length} lớp đã cập nhật`;
  const group = (label, value, style = '') => `<div class="info-group"><div class="info-label"${style}>${label}</div><div class="info-value">${value}</div></div>`;
  const none = (text) => `<span style="color:#aaa;">${text}</span>`;
  $('ls-cards').innerHTML = state.classes.map((c) => {
    const l = byClass.get(c.id);
    return `<div class="card${l ? ' updated' : ''}"><div>`
      + `<h3><b>${esc(c.name)}</b>${l ? '<span class="status-badge updated">Đã cập nhật</span>' : '<span class="status-badge">Chưa nhập</span>'}</h3>`
      + group('Giáo lý viên:', `<strong>${l ? esc(l.teacherName) : 'Chưa phân công'}</strong>`)
      + group('Địa điểm:', l ? esc(l.location) : '—')
      + group('Nội dung bài học:', l && l.content ? esc(l.content) : 'Chưa có nội dung')
      + group('Giáo án (GLV):', l && l.planFiles.length ? fileBadges(l.planFiles, false) : none('Chưa đính kèm'))
      + group('Giáo án đã chỉnh sửa (TBM):', l && l.revisedFiles.length ? fileBadges(l.revisedFiles, true) : none('Chưa có bản chỉnh sửa'), ' style="color:#8e44ad;"')
      + '</div>'
      // Reading is open to everyone; the button is only for users with the class in scope.
      + (canWriteClass(c.id) ? `<button class="btn-update" data-class="${c.id}">Cập nhật bài học</button>` : '')
      + '</div>';
  }).join('');
}

/* ---------- Tab 2: statistics by class ---------- */
const filtered = () => {
  const classId = Number($('ls-class').value);
  return classId ? lessons.filter((l) => l.classId === classId) : lessons;
};

function renderFrequency() {
  const weeks = new Map();
  for (const l of filtered()) weeks.set(l.teacherId, { name: l.teacherName, count: (weeks.get(l.teacherId)?.count ?? 0) + 1 });
  const list = [...weeks.values()].sort((a, b) => b.count - a.count);
  $('ls-freq').innerHTML = list.length
    ? list.map((t) => `<li class="flex justify-between py-1"><span class="text-slate-600">${esc(t.name)}</span><span class="freq-count">${t.count} tuần</span></li>`).join('')
    : '<p class="text-slate-400">Chưa có dữ liệu.</p>';
}

function renderHistory() {
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  historyPage = Math.min(historyPage, pages);
  const from = (historyPage - 1) * PAGE_SIZE;
  const rows = list.slice(from, from + PAGE_SIZE);
  $('ls-total').textContent = `Tổng số buổi đã cập nhật: ${list.length}`;
  $('ls-history').innerHTML = rows.length
    ? rows.map((l) => `<tr><td>${esc(fmtDate(l.weekOf))}</td><td>${esc(className(l.classId))}</td><td>${esc(l.teacherName)}</td>`
      + `<td>${esc(l.location)}</td><td class="max-w-xs truncate">${esc(l.content)}</td><td>${esc(l.updatedByName ?? '')}</td>`
      // A LINK entry has no file to download, so the row leads back to its week instead of to files.
      + `<td class="whitespace-nowrap text-center"><button type="button" class="view-week file-badge" data-week="${esc(l.weekOf)}" title="Xem mọi bài học và tài liệu của tuần này">Xem tuần</button></td></tr>`).join('')
    : '<tr><td colspan="7" class="text-slate-400 text-center py-4">Chưa có dữ liệu.</td></tr>';
  $('ls-pager').innerHTML = `<span class="page-info">${list.length ? `${from + 1}–${from + rows.length} / ${list.length} dòng` : ''}</span>`
    + '<span class="flex gap-2">'
    + `<button class="btn-page" data-page="-1"${historyPage <= 1 ? ' disabled' : ''}>‹ Trước</button>`
    + `<button class="btn-page" data-page="1"${historyPage >= pages ? ' disabled' : ''}>Sau ›</button></span>`;
}

function renderStats() {
  renderFrequency();
  renderHistory();
}

/* ---------- Form: file cards ---------- */
const formatSize = (bytes) => {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / 1024 ** i).toFixed(1))} ${units[i]}`;
};

const ICONS = { doc: ['icon-docx', 'W'], docx: ['icon-docx', 'W'], ppt: ['icon-pptx', 'P'], pptx: ['icon-pptx', 'P'], pdf: ['icon-pdf', 'P'], mp4: ['icon-mp4', '▶'] };

// One entry of a slot. `saved` entries can be renamed; queued files show their upload state.
function fileCard(entry, slot, i, saved) {
  const [iconClass, iconLabel] = ICONS[extensionOf(entry.name)] ?? ['icon-default', extensionOf(entry.name) ? '📄' : '🔗'];
  const icon = `<div class="file-icon ${iconClass}">${iconLabel}</div>`;
  const size = formatSize(entry.size);
  let meta;
  if (entry.uploading) meta = `<span class="text-blue-600 font-medium animate-pulse">Đang upload (${size})</span>`;
  else if (!saved) meta = `${size ? `${size} • ` : ''}<span class="text-amber-600 font-medium">⏳ Chờ upload</span>`;
  else meta = `${size ? `${size} • ` : ''}<span class="text-emerald-600 font-semibold">✓ Đã thêm</span>`;
  return '<div class="file-card">'
    + (saved ? `<a class="file-icon-link" href="${esc(entry.url)}" target="_blank" rel="noopener" title="Mở">${icon}</a>` : icon)
    + '<div class="file-info">'
    + (saved
      ? `<button type="button" class="file-name file-name-edit" data-slot="${slot}" data-i="${i}" title="Bấm để đổi tên / chọn loại">${esc(entry.name)}</button>`
      : `<div class="file-name" title="${esc(entry.name)}">${esc(entry.name)}</div>`)
    + `<div class="file-meta">${meta}</div></div>`
    + `<button type="button" class="btn-remove-file" data-slot="${slot}" data-group="${saved ? 'kept' : 'queued'}" data-i="${i}" title="Gỡ bỏ">✕</button></div>`;
}

const LINK_TYPES = { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', mp4: 'Video' };

function editCard(entry, slot, i) {
  const ext = extensionOf(entry.name);
  const type = Object.hasOwn(LINK_TYPES, ext) ? ext : '';
  const base = type ? stripExtension(entry.name) : entry.name;
  return '<div class="file-card editing"><div class="file-info">'
    + `<input class="edit-name" value="${esc(base)}" placeholder="Tên hiển thị">`
    + `<select class="edit-type"><option value=""${type ? '' : ' selected'}>Khác</option>`
    + Object.entries(LINK_TYPES).map(([v, label]) => `<option value="${v}"${type === v ? ' selected' : ''}>${label}</option>`).join('')
    + '</select></div>'
    + `<button type="button" class="btn-edit-save" data-slot="${slot}" data-i="${i}" title="Lưu">✓</button>`
    + '<button type="button" class="btn-edit-cancel" title="Hủy">✕</button></div>';
}

function renderFiles() {
  for (const [slot, s] of Object.entries(slots)) {
    $(s.listId).innerHTML = [
      ...s.kept.map((entry, i) => (editingLink && editingLink.slot === slot && editingLink.i === i ? editCard(entry, slot, i) : fileCard(entry, slot, i, true))),
      ...s.queued.map((file, i) => fileCard(file, slot, i, false)),
    ].join('');
  }
}

function queueFiles(files, slot) {
  const s = slots[slot];
  for (const file of files) {
    if (s.kept.filter((k) => k.type === 'FILE').length + s.queued.length >= MAX_UPLOADS) {
      toast(`Chỉ được phép tối đa ${MAX_UPLOADS} file cho phần này.`);
      break;
    }
    if (file.size > MAX_BYTES) {
      toast(`File "${file.name}" vượt quá kích thước tối đa ${MAX_BYTES / 1024 / 1024}MB.`);
      continue;
    }
    s.queued.push(file);
  }
  renderFiles();
}

/* ---------- Form: links ---------- */
const YOUTUBE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;
// Addresses that can be recognised as a document from the address alone.
const KNOWN = [
  [/^https?:\/\/docs\.google\.com\/document\/d\//i, 'Google Tài liệu.docx'],
  [/^https?:\/\/docs\.google\.com\/spreadsheets\/d\//i, 'Google Trang tính.xlsx'],
  [/^https?:\/\/docs\.google\.com\/presentation\/d\//i, 'Google Trình chiếu.pptx'],
  [/^https?:\/\/drive\.google\.com\/drive\/folders\//i, 'Thư mục Drive'],
  [/^https?:\/\/drive\.google\.com\/file\/d\//i, 'Tài liệu Drive'],
];

// A first name for a link, guessed from the address; the user can rename it.
function guessName(url) {
  if (YOUTUBE.test(url)) return 'Video YouTube.mp4';
  for (const [pattern, name] of KNOWN) if (pattern.test(url)) return name;
  let last = '';
  try { last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); } catch { last = ''; }
  return extensionOf(last) ? last : 'Tài liệu';
}

// YouTube gives the real title through oEmbed.
async function fetchTitle(entry) {
  if (!YOUTUBE.test(entry.url)) return;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(entry.url)}`);
    if (!res.ok) return;
    const title = String((await res.json()).title ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
    if (title) { entry.name = `${title}.mp4`; renderFiles(); }
  } catch { /* keep the guessed name */ }
}

function addLink(slot, input) {
  const url = input.value.trim();
  if (!/^https?:\/\//i.test(url)) return toast('URL không hợp lệ (phải bắt đầu bằng http).');
  const entry = { url, name: guessName(url), type: 'LINK', driveFileId: null };
  slots[slot].kept.push(entry);
  input.value = '';
  renderFiles();
  fetchTitle(entry);
}

/* ---------- Form: open, upload, save ---------- */
function openForm(classId) {
  const weekOf = $('ls-week').value;
  const lesson = lessons.find((l) => l.weekOf === weekOf && l.classId === classId) ?? null;
  editing = { classId, lesson };
  editingLink = null;
  $('ls-modal-title').textContent = `Giáo án — ${className(classId)} — ${fmtDate(weekOf)}`;
  // The teacher of a lesson is whoever saves it first.
  $('ls-teacher').value = lesson ? lesson.teacherName : personName(state.session);
  $('ls-location').value = lesson ? lesson.location : 'Trong lớp';
  $('ls-content').value = lesson ? lesson.content : '';
  slots.PLAN.kept = lesson ? lesson.planFiles.map((f) => ({ ...f })) : [];
  slots.REVISED.kept = lesson ? lesson.revisedFiles.map((f) => ({ ...f })) : [];
  for (const s of Object.values(slots)) { s.queued = []; $(s.inputId).value = ''; }
  renderFiles();
  $('ls-modal').classList.add('open');
}

// The files go straight from the browser to Google Drive; the server only hands out the upload links.
async function uploadOne(file, uploadUrl) {
  const res = await fetch(uploadUrl, { method: 'PUT', mode: 'cors', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!res.ok) throw new Error('Upload trực tiếp thất bại');
  const { id } = await res.json();
  return { url: `https://drive.google.com/file/d/${id}/view`, name: file.name, type: 'FILE', driveFileId: id, size: file.size };
}

// One request per save gets the links of every queued file: the server checks or creates the Drive folders once.
// Uploads run three at a time. A file that fails stays queued, so pressing save again continues with the rest.
async function uploadQueued() {
  const queued = Object.entries(slots).flatMap(([slot, s]) => s.queued.map((file) => ({ slot, file })));
  if (!queued.length) return;
  const { uploadUrls } = await api('createUploadUrls', {
    schoolYear: state.year, weekOf: $('ls-week').value, classId: editing.classId,
    files: queued.map(({ slot, file }) => ({ slot, filename: file.name })),
  });
  let failed = 0;
  for (let i = 0; i < queued.length; i += 3) {
    const batch = queued.slice(i, i + 3);
    batch.forEach(({ file }) => { file.uploading = true; });
    renderFiles();
    await Promise.all(batch.map(async ({ slot, file }, j) => {
      const s = slots[slot];
      try {
        const entry = await uploadOne(file, uploadUrls[i + j]);
        s.queued.splice(s.queued.indexOf(file), 1);
        s.kept.push(entry);
      } catch {
        file.uploading = false;
        failed += 1;
      }
      renderFiles();
    }));
  }
  if (failed) throw new Error(`Có ${failed} file tải lên thất bại. Vui lòng thử bấm lưu lại để tải tiếp.`);
}

const sendable = (entries) => entries.map(({ url, name, type, driveFileId }) => ({ url, name, type, driveFileId }));

async function saveForm() {
  if (saving) return;
  const content = $('ls-content').value.trim();
  if (!content && !editing.lesson) return toast('Nhập nội dung bài học trước khi lưu.');
  const button = $('ls-modal').querySelector('.btn-save');
  const label = button.innerHTML;
  saving = true;
  button.disabled = true;
  button.textContent = '⏳ Đang xử lý...';
  try {
    await uploadQueued();
    const { lesson } = await api('saveLesson', {
      schoolYear: state.year, weekOf: $('ls-week').value, classId: editing.classId, content,
      location: $('ls-location').value.trim(),
      planFiles: sendable(slots.PLAN.kept), revisedFiles: sendable(slots.REVISED.kept),
    });
    lessons = [lesson, ...lessons.filter((l) => l.id !== lesson.id)].sort((a, b) => b.weekOf.localeCompare(a.weekOf) || a.classId - b.classId);
    $('ls-modal').classList.remove('open');
    toast('Đã lưu giáo án.');
    renderCards();
  } catch (e) {
    toast(e.message);
  } finally {
    saving = false;
    button.disabled = false;
    button.innerHTML = label;
  }
}

/* ---------- Events ---------- */
const modal = $('ls-modal');
const closeForm = () => { if (!saving) modal.classList.remove('open'); };

modal.addEventListener('click', (e) => {
  if (saving) return;
  if (e.target === modal) return closeForm();

  const remove = e.target.closest('.btn-remove-file');
  if (remove) {
    slots[remove.dataset.slot][remove.dataset.group].splice(Number(remove.dataset.i), 1);
    editingLink = null;
    return renderFiles();
  }
  const rename = e.target.closest('.file-name-edit');
  if (rename) {
    editingLink = { slot: rename.dataset.slot, i: Number(rename.dataset.i) };
    renderFiles();
    const input = modal.querySelector('.edit-name');
    if (input) { input.focus(); input.select(); }
    return;
  }
  const done = e.target.closest('.btn-edit-save');
  if (done) {
    const card = done.closest('.file-card');
    const entry = slots[done.dataset.slot].kept[Number(done.dataset.i)];
    const base = card.querySelector('.edit-name').value.trim() || stripExtension(entry.name);
    const type = card.querySelector('.edit-type').value;
    entry.name = type ? `${stripExtension(base)}.${type}` : base;
    editingLink = null;
    return renderFiles();
  }
  if (e.target.closest('.btn-edit-cancel')) {
    editingLink = null;
    renderFiles();
  }
});
modal.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('edit-name')) {
    e.preventDefault();
    e.target.closest('.file-card').querySelector('.btn-edit-save').click();
  }
});
modal.querySelectorAll('.btn-cancel').forEach((button) => button.addEventListener('click', closeForm));
modal.querySelector('.btn-save').addEventListener('click', saveForm);

for (const [slot, s] of Object.entries(slots)) {
  const input = $(s.inputId);
  const section = input.closest('.upload-section');
  const dropzone = input.closest('.dropzone');
  input.addEventListener('change', () => { queueFiles([...input.files], slot); input.value = ''; });
  for (const name of ['dragenter', 'dragover', 'dragleave', 'drop']) {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.toggle('bg-blue-50/40', name === 'dragenter' || name === 'dragover');
      if (name === 'drop' && e.dataTransfer?.files.length) queueFiles([...e.dataTransfer.files], slot);
    });
  }
  const linkRow = section.querySelector('.link-add-row');
  const linkInput = linkRow.querySelector('[data-f="url"]');
  linkRow.querySelector('.btn-link-add').addEventListener('click', () => addLink(slot, linkInput));
  linkRow.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addLink(slot, linkInput); } });
}

$('ls-week').addEventListener('change', renderCards);
$('ls-cards').addEventListener('click', (e) => {
  const button = e.target.closest('.btn-update');
  if (button) openForm(Number(button.dataset.class));
});
$('ls-class').addEventListener('change', () => { historyPage = 1; renderStats(); });
$('ls-pager').addEventListener('click', (e) => {
  const button = e.target.closest('.btn-page');
  if (!button || button.disabled) return;
  historyPage += Number(button.dataset.page);
  renderHistory();
});

/* ---------- Start ---------- */
$('ls-class').innerHTML = `<option value="">Tất cả các lớp</option>${state.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}`;
// The board opens on today when today is a Sunday, otherwise on the coming Sunday.
$('ls-week').value = upcomingSunday();
await loadLessons();
const showTab = setupTabs({ 't-week': renderCards, 't-stats': renderStats });
showTab('t-week');

// "Xem tuần" in the history: back to the weekly board on that week.
$('ls-history').addEventListener('click', (e) => {
  const button = e.target.closest('.view-week');
  if (!button) return;
  $('ls-week').value = button.dataset.week;
  showTab('t-week');
});
