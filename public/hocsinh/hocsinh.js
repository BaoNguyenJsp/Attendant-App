/* =====================================================================
   SỔ THIẾU NHI — hocsinh/index.js
   Danh sách đọc-only (Lớp > Giới tính Nữ trước), thêm/sửa qua modal.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, sortStudents, fillClasses, TSTUDENTS, TCLASSES, year } from '../shared/common.js';
import { badgeStatus } from '../shared/ui.js';

await initCommon();

const [st, cl] = await Promise.all([
  api('getStudents'),
  api('getClasses')
]);
setState({TSTUDENTS: st.students || [], TCLASSES: cl.classes || []});
fillClasses('hs-lop');

let editingId = null;

function renderHS() {
  const cls = $('hs-lop').value;
  const sts = sortStudents(TSTUDENTS.filter(s => s.CurrentClass === cls));
  $('hs-tbody').innerHTML = sts.length
    ? sts.map(st => '<tr data-id="' + esc(st.IdNumber) + '" class="cursor-pointer hover:bg-slate-50">' +
        '<td class="p-2 border text-center whitespace-nowrap">' + esc(st.IdNumber) + '</td>' +
        '<td class="p-2 border">' + esc(st.FullName) + '</td>' +
        '<td class="p-2 border text-center">' + esc(st.Gender || '') + '</td>' +
        '<td class="p-2 border text-center whitespace-nowrap">' + esc(st.DateOfBirth || '') + '</td>' +
        '<td class="p-2 border text-center whitespace-nowrap">' + esc(st.EnrollYear || '') + '</td>' +
        '<td class="p-2 border text-center">' + badgeStatus(st.Status) + '</td>' +
        '<td class="p-2 border">' + esc(st.Note || '') + '</td>' +
        '<td class="p-2 border text-center sticky-col"><button data-id="' + esc(st.IdNumber) + '" class="edit-student bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs px-4 py-2 rounded-lg whitespace-nowrap">Cập nhật</button></td>' +
        '</tr>').join('')
    : '<tr><td colspan="8" class="p-4 text-center text-slate-400">Chưa có Thiếu nhi trong lớp ' + esc(cls) + '.</td></tr>';
}

function openModal(id) {
  editingId = id || null;
  const st = editingId ? TSTUDENTS.find(s => s.IdNumber === editingId) : null;
  $('hs-m-title').textContent = st ? 'Cập nhật Thiếu nhi — ' + editingId : 'Thêm Thiếu nhi';
  $('m-cccd').value = st ? (st.IdNumber || '') : '';
  $('m-cccd').disabled = !!st;
  $('m-fullname').value = st ? (st.FullName || '') : '';
  $('m-saint').value = st ? (st.SaintName || '') : '';
  $('m-dob').value = st ? (st.DateOfBirth || '') : '';
  $('m-gender').value = st ? (st.Gender || '') : '';
  $('m-enroll').value = st ? (st.EnrollYear || '') : year();
  $('m-status').value = st ? (st.Status || 'Hoạt động') : 'Hoạt động';
  $('m-father').value = st ? (st.Father || '') : '';
  $('m-mother').value = st ? (st.Mother || '') : '';
  $('m-note').value = st ? (st.Note || '') : '';
  // Lớp mặc định = lớp đang lọc; chỉ đổi khi thêm/sửa cần chuyển lớp.
  const mcls = $('m-class');
  mcls.innerHTML = $('hs-lop').innerHTML;
  mcls.value = st ? (st.CurrentClass || $('hs-lop').value) : $('hs-lop').value;
  $('hs-modal').classList.add('open');
  $('m-fullname').focus();
}

function closeModal() { $('hs-modal').classList.remove('open'); editingId = null; }

async function saveModal() {
  const body = {
    idNumber: $('m-cccd').value.trim(),
    fullName: $('m-fullname').value.trim(),
    saintName: $('m-saint').value.trim(),
    dateOfBirth: $('m-dob').value,
    gender: $('m-gender').value,
    className: $('m-class').value,
    enrollYear: $('m-enroll').value.trim(),
    status: $('m-status').value,
    father: $('m-father').value.trim(),
    mother: $('m-mother').value.trim(),
    note: $('m-note').value.trim(),
  };
  if (!body.idNumber || !body.fullName || !body.className) return toast('Nhập Số CCCD, Họ và tên và chọn Lớp.');
  try {
    const r = await api('saveStudent', body);
    const idx = TSTUDENTS.findIndex(s => s.IdNumber === body.idNumber);
    if (idx >= 0) TSTUDENTS[idx] = r.student; else TSTUDENTS.push(r.student);
  } catch (e) { return toast(e.message); }
  closeModal();
  toast('Đã lưu.');
  renderHS();
}

$('hs-lop').addEventListener('change', renderHS);
$('add-student').addEventListener('click', () => openModal());
$('hs-tbody').addEventListener('click', e => {
  const btn = e.target.closest('.edit-student');
  if (btn) openModal(btn.dataset.id);
});
const m = $('hs-modal');
m.addEventListener('click', e => { if (e.target === m) closeModal(); });
m.querySelector('.btn-cancel').addEventListener('click', closeModal);
m.querySelector('.btn-save').addEventListener('click', saveModal);
m.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

renderHS();
