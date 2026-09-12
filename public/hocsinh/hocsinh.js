/* =====================================================================
   SỔ THIẾU NHI — hocsinh/index.js
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, sortStudents, fillClasses, TSTUDENTS, TCLASSES, year, clearApiCache } from '../shared/common.js';
import { badgeStatus } from '../shared/ui.js';

await initCommon();

/* ---------- Initial Data Load ---------- */
const [st, cl] = await Promise.all([
  api('getStudents'),
  api('getClasses')
]);

setState({TSTUDENTS: st.students || [], TCLASSES: cl.classes || []});
fillClasses('hs-lop');

let editingId = null;
let draggingRow = null;

/* ---------- Render Roster ---------- */
function renderHS() {
  const cls = $('hs-lop').value;
  const sts = sortStudents(TSTUDENTS.filter(s => s.CurrentClass === cls));
  $('hs-tbody').innerHTML = sts.length
    ? sts.map((st, i) => '<tr data-id="' + esc(st.IdNumber) + '" class="cursor-pointer hover:bg-slate-50 transition-colors bg-white" draggable="true">' +
        '<td class="p-2 border text-center text-slate-400 cursor-grab active:cursor-grabbing" title="Kéo thả để sắp xếp">☰</td>' +
        '<td class="p-2 border text-center whitespace-nowrap">' + esc(st.IdNumber) + '</td>' +
        '<td class="p-2 border font-medium">' + esc(st.FullName) + '</td>' +
        '<td class="p-2 border text-center">' + esc(st.Gender || '') + '</td>' +
        '<td class="p-2 border text-center whitespace-nowrap">' + esc(st.DateOfBirth || '') + '</td>' +
        '<td class="p-2 border text-center whitespace-nowrap">' + esc(st.EnrollYear || '') + '</td>' +
        '<td class="p-2 border text-center">' + badgeStatus(st.Status) + '</td>' +
        '<td class="p-2 border">' + esc(st.Note || '') + '</td>' +
        '<td class="p-2 border text-center sticky-col"><button data-id="' + esc(st.IdNumber) + '" class="edit-student bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs px-4 py-2 rounded-lg whitespace-nowrap">Cập nhật</button></td>' +
        '</tr>').join('')
    : '<tr><td colspan="9" class="p-4 text-center text-slate-400">Chưa có Thiếu nhi trong lớp ' + esc(cls) + '.</td></tr>';
}

/* ---------- Drag & Drop Reordering ---------- */
const tbody = $('hs-tbody');

tbody.addEventListener('dragstart', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  draggingRow = tr;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', tr.dataset.id);
  setTimeout(() => tr.classList.add('opacity-50', 'bg-blue-50'), 0);
});

tbody.addEventListener('dragover', e => {
  e.preventDefault(); // Necessary to allow dropping
  const tr = e.target.closest('tr');
  if (!tr || tr === draggingRow) return;
  
  const bounding = tr.getBoundingClientRect();
  const offset = bounding.y + (bounding.height / 2);
  if (e.clientY - offset > 0) {
    tr.after(draggingRow);
  } else {
    tr.before(draggingRow);
  }
});

tbody.addEventListener('dragend', async () => {
  if (draggingRow) {
    draggingRow.classList.remove('opacity-50', 'bg-blue-50');
    draggingRow = null;
    await saveNewOrder();
  }
});

async function saveNewOrder() {
  const rows = Array.from(tbody.querySelectorAll('tr[data-id]'));
  if (!rows.length) return;
  
  const orderedIds = rows.map(tr => tr.dataset.id);
  
  // Update local state immediately
  orderedIds.forEach((id, idx) => {
    const s = TSTUDENTS.find(x => x.IdNumber === id);
    if (s) s.ListOrder = idx + 1;
  });
  
  toast('Đang lưu thứ tự...');
  try {
    await api('saveStudentOrder', { orderedIds });
    
    // Clear student cache so other tabs fetch updated ListOrder immediately
    clearApiCache('getStudents'); 
    
    toast('Đã cập nhật thứ tự lớp.');
  } catch (e) {
    toast('Lỗi khi lưu thứ tự: ' + e.message);
  }
}

/* ---------- Modal Controls ---------- */
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

  const mcls = $('m-class');
  mcls.innerHTML = $('hs-lop').innerHTML;
  mcls.value = st ? (st.CurrentClass || $('hs-lop').value) : $('hs-lop').value;
  $('hs-modal').classList.add('open');
  $('m-fullname').focus();
}

function closeModal() { 
  $('hs-modal').classList.remove('open'); 
  editingId = null; 
}

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

  if (!body.idNumber || !body.fullName || !body.className) {
    return toast('Nhập Số CCCD, Họ và tên và chọn Lớp.');
  }

  try {
    const r = await api('saveStudent', body);
    const idx = TSTUDENTS.findIndex(s => s.IdNumber === body.idNumber);
    if (idx >= 0) {
      // Preserve ListOrder during update
      r.student.ListOrder = TSTUDENTS[idx].ListOrder;
      TSTUDENTS[idx] = r.student;
    } else {
      TSTUDENTS.push(r.student);
    }
    
    clearApiCache('getStudents'); // Refresh cache on edits too
  } catch (e) { 
    return toast(e.message); 
  }

  closeModal();
  toast('Đã lưu.');
  renderHS();
}

/* ---------- Events ---------- */
$('hs-lop').addEventListener('change', renderHS);
$('add-student').addEventListener('click', () => openModal());

tbody.addEventListener('click', e => {
  const btn = e.target.closest('.edit-student');
  if (btn) openModal(btn.dataset.id);
});

const m = $('hs-modal');
m.addEventListener('click', e => { if (e.target === m) closeModal(); });
m.querySelector('.btn-cancel').addEventListener('click', closeModal);
m.querySelector('.btn-save').addEventListener('click', saveModal);
m.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* Initial Boot */
renderHS();