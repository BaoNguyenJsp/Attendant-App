/* =====================================================================
   SỔ THIẾU NHI — giangday/index.js
   Giảng dạy: thẻ lớp theo tuần + thống kê tần suất/lịch sử + modal upload.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TCLASSES, cur, defaultWeek, normSunday, year } from '../shared/common.js';
import { userFull, fileLink } from '../shared/ui.js';

await initCommon();

let editingClass = null, editingRec = null, TEACHING_BY_CLASS = {};

async function renderCards() {
  if (!$('gd-week').value) $('gd-week').value = defaultWeek();
  const wk = $('gd-week').value;
  let recs = [];
  try { recs = (await api('getTeaching', {schoolYear: year(), weekOf: wk})).records || []; }
  catch (e) { return toast(e.message); }
  const byClass = {}; recs.forEach(r => byClass[r.ClassName] = r);
  TEACHING_BY_CLASS = byClass;
  $('gd-summary').textContent = 'Tuần ' + wk + ' · ' + Object.keys(byClass).length + '/' + TCLASSES.length + ' lớp đã cập nhật';
  $('cards').innerHTML = TCLASSES.map(c => {
    const rec = byClass[c.ClassName];
    const meta = rec ? esc(userFull(rec.TeacherEmail)) + (rec.LessonContent ? ' · ' + esc(rec.LessonContent) : '') : 'Chưa có bài học tuần này.';
    return '<div class="card' + (rec ? ' updated' : '') + '">' +
      '<div class="card-head"><h3 class="font-bold">' + esc(c.ClassName) + '</h3>' +
      '<span class="status-badge' + (rec ? ' updated' : '') + '">' + (rec ? 'Đã cập nhật' : 'Chưa cập nhật') + '</span></div>' +
      '<div class="text-sm text-slate-600 mt-1">' + meta + '</div>' +
      '<div class="text-xs text-slate-500 mt-1">' + (rec ? fileLink(rec.LessonPlanUrl, false) + ' ' + fileLink(rec.RevisedPlanUrl, true) : '') + '</div>' +
      '<button class="btn-update" data-cls="' + esc(c.ClassName) + '">' + (rec ? '✏️ Cập nhật' : '＋ Cập nhật giảng dạy') + '</button>' +
      '</div>';
  }).join('');
}

async function renderGDStats() {
  let recs = [];
  try { recs = (await api('getTeaching', {schoolYear: year()})).records || []; }
  catch (e) { return toast(e.message); }
  const by = {};
  recs.forEach(r => by[r.TeacherEmail] = (by[r.TeacherEmail] || 0) + 1);
  const freq = Object.entries(by).sort((a, b) => b[1] - a[1]);
  $('gd-freq').innerHTML = freq.length
    ? freq.map(([em, cnt]) => '<div class="flex justify-between py-1"><span class="text-slate-600">' + esc(userFull(em)) + '</span><span class="freq-count">' + cnt + ' tuần</span></div>').join('')
    : '<p class="text-slate-400">Chưa có dữ liệu.</p>';
  const hist = recs.slice().sort((a, b) => String(b.WeekOf).localeCompare(String(a.WeekOf))).slice(0, 8);
  $('gd-history').innerHTML = hist.length
    ? '<table class="history-table"><thead><tr><th>Tuần</th><th>Lớp</th><th>Giáo lý viên</th><th>Bài học</th><th>Tệp</th></tr></thead><tbody>' +
      hist.map(r => '<tr><td>' + esc(r.WeekOf) + '</td><td>' + esc(r.ClassName) + '</td><td>' + esc(userFull(r.TeacherEmail)) + '</td><td class="max-w-xs truncate">' + esc(r.LessonContent || '') + '</td><td>' + fileLink(r.LessonPlanUrl, false) + ' ' + fileLink(r.RevisedPlanUrl, true) + '</td></tr>').join('') +
      '</tbody></table>'
    : '<p class="text-slate-400">Chưa có dữ liệu.</p>';
}

function openModal(cls) {
  editingClass = cls;
  editingRec = TEACHING_BY_CLASS[cls] || null;
  $('gd-modal-title').textContent = 'Giáo án — ' + cls;
  $('gd-teacher').value = cur.email;
  $('gd-lesson').value = editingRec ? (editingRec.LessonContent || '') : '';
  $('f-plan').value = ''; $('f-rev').value = '';
  $('gd-modal').classList.add('open');
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
  const body = {
    schoolYear: year(), weekOf: $('gd-week').value, className: editingClass, lessonContent: lesson,
    lessonPlanUrl: editingRec ? (editingRec.LessonPlanUrl || '') : '',
    revisedPlanUrl: editingRec ? (editingRec.RevisedPlanUrl || '') : ''
  };
  try {
    const fPlan = $('f-plan').files[0], fRev = $('f-rev').files[0];
    if (fPlan) body.lessonPlanUrl = (await api('uploadFile', {base64: (await readFile(fPlan)).base64, mimeType: fPlan.type || 'application/octet-stream', filename: fPlan.name, className: editingClass})).url;
    if (fRev) body.revisedPlanUrl = (await api('uploadFile', {base64: (await readFile(fRev)).base64, mimeType: fRev.type || 'application/octet-stream', filename: fRev.name, className: editingClass})).url;
    await api('saveTeaching', body);
    $('gd-modal').classList.remove('open');
    toast('Đã lưu giáo án.');
    renderCards(); renderGDStats();
  } catch (e) { toast(e.message); }
}

/* ---------- Khởi tạo ---------- */
const [cl, te] = await Promise.all([api('getClasses'), api('getTeachers')]);
setState({TCLASSES: cl.classes || [], USERS_ROWS: te.users || [], GROUP_MEMBERS: te.members || [], GROUPS_LIST: te.groups || []});

const gdModal = $('gd-modal');
gdModal.addEventListener('click', e => { if (e.target === gdModal) gdModal.classList.remove('open'); });
gdModal.querySelector('.btn-cancel').addEventListener('click', () => gdModal.classList.remove('open'));
gdModal.querySelector('.btn-save').addEventListener('click', () => saveTeaching());
$('gd-week').addEventListener('change', () => { normSunday($('gd-week')); renderCards(); });
$('cards').addEventListener('click', e => { const b = e.target.closest('.btn-update'); if (b) openModal(b.dataset.cls); });

renderCards(); renderGDStats();
