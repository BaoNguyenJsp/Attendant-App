/* =====================================================================
   SỔ THIẾU NHI — giangday/index.js
   Giảng dạy: thẻ lớp theo tuần + thống kê tần suất/lịch sử + modal upload.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TCLASSES, cur, USERS_ROWS, defaultWeek, normSunday, year } from '../shared/common.js';
import { userFull, fileLink } from '../shared/ui.js';

await initCommon();

let editingClass = null, editingRec = null, TEACHING_BY_CLASS = {};
// File giữ lại (URL đã lưu) vs file chờ upload, tách riêng theo cột GLV/TBM.
let planKeep = [], planAdd = [], revKeep = [], revAdd = [];
const FPLAN = 'GLV', FTBM = 'TBM';
// Lịch sử cập nhật: phân trang server-side (Drive lookup folder chỉ cho 1 trang).
const HIST_PAGE = 8; let histPage = 1;

// Badge trên thẻ lớp: text = đuôi file (PDF/DOCX…), hover = tên file thật.
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

// Tên GLV hiển thị = tên thánh trước họ tên, vd "Phaolô Nguyễn Văn A".
const glvLabel = em => {
  const e = String(em || '').toLowerCase();
  const u = USERS_ROWS.find(x => String(x.Email).toLowerCase() === e);
  const s = u ? String(u.SaintName || '').trim() : '';
  const f = userFull(em);
  return s ? s + ' ' + f : f;
};

async function renderCards() {
  if (!$('gd-week').value) $('gd-week').value = defaultWeek();
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

async function renderFreq() {
  let recs = [];
  try { recs = (await api('getTeaching', {schoolYear: year()})).records || []; }
  catch (e) { return toast(e.message); }
  const by = {};
  recs.forEach(r => by[r.TeacherEmail] = (by[r.TeacherEmail] || 0) + 1);
  const freq = Object.entries(by).sort((a, b) => b[1] - a[1]);
  $('gd-freq').innerHTML = freq.length
    ? freq.map(([em, cnt]) => '<li class="flex justify-between py-1"><span class="text-slate-600">' + esc(glvLabel(em)) + '</span><span class="freq-count">' + cnt + ' tuần</span></li>').join('')
    : '<p class="text-slate-400">Chưa có dữ liệu.</p>';
}

async function renderHist() {
  const cls = $('gd-cls').value;
  let j;
  try { j = await api('getTeaching', {schoolYear: year(), page: histPage, pageSize: HIST_PAGE, className: cls || undefined}); }
  catch (e) { return toast(e.message); }
  const hist = j.records || [], total = j.total || 0;
  $('gd-history').innerHTML = hist.length
    ? hist.map(r => '<tr>' +
      '<td>' + esc(r.WeekOf) + '</td><td>' + esc(r.ClassName) + '</td><td>' + esc(glvLabel(r.TeacherEmail)) + '</td>' +
      '<td class="max-w-xs truncate">' + esc(r.LessonContent || '') + '</td>' +
      '<td class="whitespace-nowrap">' +
        (r.LessonFolderUrl ? '<a class="file-badge" href="' + esc(r.LessonFolderUrl) + '" target="_blank" rel="noopener" title="Mở thư mục giáo án (GLV)">📁</a>' : '') +
        (r.RevisedFolderUrl ? '<a class="file-badge reviewed" href="' + esc(r.RevisedFolderUrl) + '" target="_blank" rel="noopener" title="Mở thư mục bản chỉnh sửa (TBM)">✏️</a>' : '') +
      '</td><td>' + esc(userFull(r.UpdatedBy)) + '</td></tr>').join('')
    : '<tr><td colspan="6" class="text-slate-400">Chưa có dữ liệu.</td></tr>';
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

/* ---------- Modal: giữ/xóa tệp GLV & TBM ---------- */
const splitUrls = s => String(s || '').split(',').map(x => x.trim()).filter(x => /^https?:\/\//i.test(x));
// File đã lưu = cặp {url, name}; LessonPlanNames/RevisedPlanNames lưu 1 tên/dòng theo thứ tự URL.
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
  const addChip = (f, list, i) => chip('<span class="chip-name">📎 ' + esc(f.name) + '</span>', list, 'add', i);
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

function readFile(file) {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => res({base64: String(rd.result).split(',')[1]});
    rd.onerror = () => rej(new Error('Đọc file thất bại.'));
    rd.readAsDataURL(file);
  });
}

async function saveTeaching() {
  const lesson = $('gd-lesson').value.trim();
  if (!lesson && !editingRec) return toast('Nhập nội dung bài học trước khi lưu.');
  const wk = $('gd-week').value;
  const upload = (list, kind) => Promise.all(list.map(f => readFile(f).then(({base64}) =>
    api('uploadFile', {schoolYear: year(), weekOf: wk, className: editingClass, kind, base64, mimeType: f.type || 'application/octet-stream', filename: f.name})
      .then(r => r.url))));
  const body = {
    schoolYear: year(), weekOf: wk, className: editingClass, lessonContent: lesson
  };
  try {
    const [up, ur] = [await upload(planAdd, FPLAN), await upload(revAdd, FTBM)];
    // URL cách nhau dấu phẩy; tên file ghi song song (1 tên/dòng) để UI hiển thị đúng từng link.
    body.lessonPlanUrl = planKeep.map(k => k.url).concat(up).join(',');
    body.lessonPlanNames = planKeep.map(k => k.name).concat(planAdd.map(f => f.name)).join('\n');
    body.revisedPlanUrl = revKeep.map(k => k.url).concat(ur).join(',');
    body.revisedPlanNames = revKeep.map(k => k.name).concat(revAdd.map(f => f.name)).join('\n');
    await api('saveTeaching', body);
    $('gd-modal').classList.remove('open');
    toast('Đã lưu giáo án.');
    renderCards(); renderFreq(); renderHist();
  } catch (e) { toast(e.message); }
}

/* ---------- Khởi tạo ---------- */
const [cl, te] = await Promise.all([api('getClasses'), api('getTeachers')]);
setState({TCLASSES: cl.classes || [], USERS_ROWS: te.users || [], GROUP_MEMBERS: te.members || [], GROUPS_LIST: te.groups || []});

const gdModal = $('gd-modal');
gdModal.addEventListener('click', e => {
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
gdModal.querySelector('.btn-cancel').addEventListener('click', () => gdModal.classList.remove('open'));
gdModal.querySelector('.btn-save').addEventListener('click', () => saveTeaching());
addFiles($('f-plan'), FPLAN);
addFiles($('f-rev'), FTBM);
$('gd-week').addEventListener('change', () => { normSunday($('gd-week')); renderCards(); });
$('cards').addEventListener('click', e => { const b = e.target.closest('.btn-update'); if (b) openModal(b.dataset.cls); });
$('gd-cls').innerHTML = '<option value="">Tất cả các lớp</option>' +
  TCLASSES.map(c => '<option value="' + esc(c.ClassName) + '">' + esc(c.ClassName) + '</option>').join('');
$('gd-cls').addEventListener('change', () => { histPage = 1; renderHist(); });
$('gd-pager').addEventListener('click', e => {
  const b = e.target.closest('.btn-page');
  if (!b || b.disabled) return;
  histPage += b.dataset.pg === 'next' ? 1 : -1;
  renderHist();
});

renderCards(); renderFreq(); renderHist();
