/* =====================================================================
   SỔ THIẾU NHI — giangday/index.js
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TCLASSES, cur, USERS_ROWS, defaultWeek, normSunday, year } from '../shared/common.js';
import { userFull, fileLink } from '../shared/ui.js';

await initCommon();

let editingClass = null, editingRec = null, TEACHING_BY_CLASS = {};
let planKeep = [], planAdd = [], revKeep = [], revAdd = [];
const FPLAN = 'GLV', FTBM = 'TBM';
const HIST_PAGE = 8; let histPage = 1;
let isSaving = false;

const sectionCache = {
  freqLoaded: false,
  histLoaded: false
};

const badgeLinks = (url, names, rev) => {
  const ns = String(names || '').split('\n');
  return String(url || '').split(',').map(x => x.trim()).filter(f => /^https?:\/\//i.test(f))
    .map((f, i) => {
      const name = (ns[i] || '').trim();
      const ext = String(name).split('.').pop() || '';
      const label = /^[a-z0-9]{1,6}$/i.test(ext) ? ext.toUpperCase() : (rev ? '✏️' : '📄');
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

/* ---------- Cards (Active Week Only) ---------- */
async function renderCards() {
  if (!$('gd-week').value) {
    const d = new Date();
    d.setDate(d.getDate() + (d.getDay() === 0 ? 0 : 7 - d.getDay()));
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    $('gd-week').value = `${y}-${m}-${day}`;
  }
  
  normSunday($('gd-week'));
  
  const wk = $('gd-week').value;
  let recs = [];
  try { recs = (await api('getTeaching', {schoolYear: year(), weekOf: wk})).records || []; }
  catch (e) { return toast(e.message); }
  
  const byClass = {}; recs.forEach(r => byClass[r.ClassName] = r);
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

/* ---------- Frequency ---------- */
async function renderFreq(force = false) {
  if (sectionCache.freqLoaded && !force) return;
  const cls = $('gd-cls').value;
  let recs = [];
  try { recs = (await api('getTeaching', {schoolYear: year(), className: cls || undefined})).records || []; }
  catch (e) { return toast(e.message); }
  const by = {};
  recs.forEach(r => by[r.TeacherEmail] = (by[r.TeacherEmail] || 0) + 1);
  const freq = Object.entries(by).sort((a, b) => b[1] - a[1]);
  $('gd-freq').innerHTML = freq.length
    ? freq.map(([em, cnt]) => '<li class="flex justify-between py-1"><span class="text-slate-600">' + esc(glvLabel(em)) + '</span><span class="freq-count">' + cnt + ' tuần</span></li>').join('')
    : '<p class="text-slate-400">Chưa có dữ liệu.</p>';
  sectionCache.freqLoaded = true;
}

/* ---------- History ---------- */
async function renderHist(force = false) {
  if (sectionCache.histLoaded && !force) return;
  const cls = $('gd-cls').value;
  let j;
  try { j = await api('getTeaching', {schoolYear: year(), page: histPage, pageSize: HIST_PAGE, className: cls || undefined}); }
  catch (e) { return toast(e.message); }
  const hist = j.records || [], total = j.total || 0;
  
  // UPDATE BADGE DYNAMICALLY
  const totalBadge = $('gd-total-updates');
  if (totalBadge) totalBadge.textContent = 'Tổng số buổi đã cập nhật: ' + total;

  $('gd-history').innerHTML = hist.length
    ? hist.map(r => '<tr>' +
      '<td>' + esc(r.WeekOf) + '</td>' + // 1. Ngày dạy
      '<td>' + esc(r.ClassName) + '</td>' + // 2. Lớp
      '<td>' + esc(glvLabel(r.TeacherEmail)) + '</td>' + // 3. Giáo lý viên
      '<td class="max-w-xs truncate">' + esc(r.LessonContent || '') + '</td>' + // 4. Bài học
      '<td class="whitespace-nowrap text-center">' +
        (r.LessonFolderUrl ? '<a class="file-badge" href="' + esc(r.LessonFolderUrl) + '" target="_blank" rel="noopener" title="Mở thư mục giáo án (GLV)">📁</a>' : '') +
      '</td>' + // 5. Giáo án
      '<td class="whitespace-nowrap text-center">' +
        (r.RevisedFolderUrl ? '<a class="file-badge reviewed" href="' + esc(r.RevisedFolderUrl) + '" target="_blank" rel="noopener" title="Mở thư mục bản chỉnh sửa (TBM)">✏️</a>' : '') +
      '</td>' + // 6. Bản chỉnh sửa
      '<td>' + esc(userFull(r.UpdatedBy)) + '</td>' + // 7. Người cập nhật
      '</tr>').join('')
    : '<tr><td colspan="7" class="text-slate-400 text-center py-4">Chưa có dữ liệu.</td></tr>';
  renderPager(total, histPage);
  sectionCache.histLoaded = true;
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
  return splitUrls(urls).map((f, i) => ({url: f, name: n[i] || ''}));
};

function openModal(cls) {
  editingClass = cls;
  editingRec = TEACHING_BY_CLASS[cls] || null;
  $('gd-modal-title').textContent = 'Giáo án — ' + cls;
  $('gd-teacher').value = editingRec && editingRec.TeacherEmail ? glvLabel(editingRec.TeacherEmail) : glvLabel(cur.email);
  $('gd-lesson').value = editingRec ? (editingRec.LessonContent || '') : '';
  planKeep = linkList(editingRec && editingRec.LessonPlanUrl, editingRec && editingRec.LessonPlanNames);
  revKeep = linkList(editingRec && editingRec.RevisedPlanUrl, editingRec && editingRec.RevisedPlanNames);
  planAdd = []; revAdd = [];
  $('f-plan').value = ''; $('f-rev').value = '';
  renderLists();
  $('gd-modal').classList.add('open');
}

const chip = (inner, list, grp, i) => '<div class="file-chip">' + inner +
  '<button type="button" class="chip-rm" data-list="' + list + '" data-grp="' + grp + '" data-i="' + i + '" title="Gỡ bỏ">✕</button></div>';

function renderLists() {
  const addChip = (f, list, i) => chip('<span class="chip-name">⏳ ' + esc(f.name) + '</span>', list, 'add', i);
  $('plan-list').innerHTML = planKeep.map((k, i) => chip(fileLink(k.url, k.name, false), FPLAN, 'keep', i)).join('') +
    planAdd.map((f, i) => addChip(f, FPLAN, i)).join('');
  $('rev-list').innerHTML = revKeep.map((k, i) => chip(fileLink(k.url, k.name, true), FTBM, 'keep', i)).join('') +
    revAdd.map((f, i) => addChip(f, FTBM, i)).join('');
}

function addFiles(input, kind) {
  input.addEventListener('change', () => {
    const list = kind === FPLAN ? planAdd : revAdd;
    [...input.files].forEach(f => list.push(f));
    input.value = '';
    renderLists();
  });
}

/* Direct-to-Drive Upload for ALL files */
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

/* Batched Concurrent Uploader */
async function uploadBatched(list, keepList, kind, wk, cls, batchSize = 3) {
  let failedCount = 0;
  const filesToUpload = [...list]; 
  
  for (let i = 0; i < filesToUpload.length; i += batchSize) {
    const chunk = filesToUpload.slice(i, i + batchSize);
    
    await Promise.all(chunk.map(async f => {
      try {
        const driveUrl = await uploadFileDirect(f, wk, cls, kind);
        
        const idx = list.indexOf(f);
        if (idx > -1) list.splice(idx, 1);
        
        keepList.push({ url: driveUrl, name: f.name });
        renderLists();
      } catch (e) {
        failedCount++;
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
    
    sectionCache.freqLoaded = false;
    sectionCache.histLoaded = false;

    await renderCards();
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
setState({TCLASSES: cl.classes || [], USERS_ROWS: te.users || [], GROUP_MEMBERS: te.members || [], GROUPS_LIST: te.groups || []});

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
    renderLists();
  }
});
gdModal.querySelector('.btn-cancel').addEventListener('click', () => { if (!isSaving) gdModal.classList.remove('open'); });
gdModal.querySelector('.btn-save').addEventListener('click', () => saveTeaching());
addFiles($('f-plan'), FPLAN);
addFiles($('f-rev'), FTBM);

$('gd-week').addEventListener('change', () => { normSunday($('gd-week')); renderCards(); });
$('cards').addEventListener('click', e => { const b = e.target.closest('.btn-update'); if (b) openModal(b.dataset.cls); });

$('gd-cls').innerHTML = '<option value="">Tất cả các lớp</option>' +
  TCLASSES.map(c => '<option value="' + esc(c.ClassName) + '">' + esc(c.ClassName) + '</option>').join('');

$('gd-cls').addEventListener('change', () => { 
  histPage = 1; 
  renderHist(true); 
  renderFreq(true); // <-- This forces the left card to re-render when changing classes
});

$('gd-pager').addEventListener('click', e => {
  const b = e.target.closest('.btn-page');
  if (!b || b.disabled) return;
  histPage += b.dataset.pg === 'next' ? 1 : -1;
  renderHist(true);
});

// IntersectionObserver to fetch sub-views only when visible
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      if (entry.target.id === 'gd-freq') renderFreq();
      if (entry.target.id === 'gd-history') renderHist();
    }
  });
}, { threshold: 0.1 });

if ($('gd-freq')) observer.observe($('gd-freq'));
if ($('gd-history')) observer.observe($('gd-history'));

await renderCards();