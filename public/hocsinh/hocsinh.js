/* =====================================================================
   SỔ THIẾU NHI — hocsinh/index.js
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, sortStudents, fillClasses, TSTUDENTS, TCLASSES, year, clearApiCache, fmtDate , toIsoDate } from '../shared/common.js';
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
    ? sts.map((st, i) => {
        // Safe string casting before split to prevent TypeError
        const siblingNames = String(st.Siblings || '').split(',')
          .map(id => id.trim())
          .filter(Boolean)
          .map(id => {
            const sib = TSTUDENTS.find(s => s.IdNumber === id);
            return sib ? `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs whitespace-nowrap">${esc(sib.FullName)} (${esc(sib.CurrentClass)})</span>` : esc(id);
          }).join(' ');

        return '<tr data-id="' + esc(st.IdNumber) + '" class="cursor-pointer hover:bg-slate-50 transition-colors bg-white" draggable="true">' +
          '<td class="p-2 border text-center text-slate-400 cursor-grab active:cursor-grabbing" title="Kéo thả để sắp xếp">☰</td>' +
          '<td class="p-2 border text-center whitespace-nowrap">' + esc(st.IdNumber) + '</td>' +
          '<td class="p-2 border font-medium">' + esc(st.FullName) + '</td>' +
          '<td class="p-2 border text-center">' + esc(st.Gender || '') + '</td>' +
          '<td class="p-2 border text-center whitespace-nowrap">' + esc(fmtDate(st.DateOfBirth) || '') + '</td>' +
          '<td class="p-2 border text-center">' + esc(st.EnrollYear || '') + '</td>' +
          '<td class="p-2 border text-center">' + badgeStatus(st.Status) + '</td>' +
          '<td class="p-2 border text-center">' + siblingNames + '</td>' +
          '<td class="p-2 border">' + esc(st.Note || '') + '</td>' +
          '<td class="p-2 border text-center sticky-col"><button data-id="' + esc(st.IdNumber) + '" class="edit-student bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs px-4 py-2 rounded-lg whitespace-nowrap">Cập nhật</button></td>' +
          '</tr>';
      }).join('')
    : '<tr><td colspan="10" class="p-4 text-center text-slate-400">Chưa có Thiếu nhi trong lớp ' + esc(cls) + '.</td></tr>';
}

/* ---------- Render Search Results ---------- */
function renderSearch() {
  const q = $('hs-search-input').value.toLowerCase().trim();
  const tbody = $('hs-search-tbody');
  
  if (!q) {
    tbody.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-400">Nhập tên, tên thánh hoặc CCCD để tìm kiếm...</td></tr>';
    return;
  }

  // Filter unconditionally across all TSTUDENTS
  const hits = TSTUDENTS.filter(s => 
    (s.FullName && s.FullName.toLowerCase().includes(q)) || 
    (s.IdNumber && s.IdNumber.includes(q)) || 
    (s.SaintName && s.SaintName.toLowerCase().includes(q))
  ).slice(0, 50); // Limit to 50 results for performance

  tbody.innerHTML = hits.length
    ? hits.map((st) => {
        const siblingNames = String(st.Siblings || '').split(',')
          .map(id => id.trim()).filter(Boolean)
          .map(id => {
            const sib = TSTUDENTS.find(s => s.IdNumber === id);
            return sib ? `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs whitespace-nowrap">${esc(sib.FullName)} (${esc(sib.CurrentClass)})</span>` : esc(id);
          }).join(' ');

        // Removed the cursor-pointer class and the edit button td
        return `<tr data-id="${esc(st.IdNumber)}" class="hover:bg-slate-50 transition-colors bg-white">
          <td class="p-2 border text-center font-bold text-blue-900">${esc(st.CurrentClass)}</td>
          <td class="p-2 border text-center whitespace-nowrap">${esc(st.IdNumber)}</td>
          <td class="p-2 border font-medium">${esc(st.FullName)}</td>
          <td class="p-2 border text-center">${esc(st.Gender || '')}</td>
          <td class="p-2 border text-center whitespace-nowrap">${esc(fmtDate(st.DateOfBirth) || '')}</td>
          <td class="p-2 border text-center">${esc(st.EnrollYear || '')}</td>
          <td class="p-2 border text-center">${badgeStatus(st.Status)}</td>
          <td class="p-2 border text-center">${siblingNames}</td>
          <td class="p-2 border">${esc(st.Note || '')}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="9" class="p-4 text-center text-slate-400">Không tìm thấy Thiếu nhi nào phù hợp.</td></tr>';
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
  e.preventDefault(); 
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
  
  orderedIds.forEach((id, idx) => {
    const s = TSTUDENTS.find(x => x.IdNumber === id);
    if (s) s.ListOrder = idx + 1;
  });
  
  toast('Đang lưu thứ tự...');
  try {
    await api('saveStudentOrder', { orderedIds });
    clearApiCache('getStudents'); 
    toast('Đã cập nhật thứ tự lớp.');
  } catch (e) {
    toast('Lỗi khi lưu thứ tự: ' + e.message);
  }
}

/* ---------- Sibling Search UI ---------- */
let selectedSiblings = [];

function renderSiblingTags() {
  const container = $('m-sibling-tags');
  if (!container) return;
  
  container.innerHTML = selectedSiblings.map(id => {
    const s = TSTUDENTS.find(x => x.IdNumber === id);
    const name = s ? s.FullName : id;
    return `
      <span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs flex items-center gap-1 font-semibold">
        ${esc(name)}
        <button type="button" class="remove-sibling text-blue-500 hover:text-blue-900 font-bold px-1" data-id="${id}">×</button>
      </span>`;
  }).join('');
  
  if ($('m-siblings')) $('m-siblings').value = selectedSiblings.join(',');
}

function setupSiblingSearch() {
  const searchInp = $('m-sibling-search');
  const drop = $('m-sibling-dropdown');
  const tagsContainer = $('m-sibling-tags');
  if (!searchInp || !drop || !tagsContainer) return;

  searchInp.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) { drop.classList.add('hidden'); return; }
    
    const hits = TSTUDENTS.filter(s => 
      s.IdNumber !== editingId && 
      !selectedSiblings.includes(s.IdNumber) &&
      (String(s.FullName).toLowerCase().includes(q) || String(s.IdNumber).includes(q))
    ).slice(0, 8);

    if (hits.length === 0) {
      drop.innerHTML = '<div class="p-2 text-sm text-slate-500 text-center">Không tìm thấy</div>';
    } else {
      drop.innerHTML = hits.map(s => `
        <div class="sibling-option p-2 hover:bg-blue-50 cursor-pointer border-b border-slate-100 last:border-0" data-id="${s.IdNumber}">
          <div class="text-sm font-bold text-blue-900">${esc(s.FullName)}</div>
          <div class="text-xs text-slate-500">${esc(s.IdNumber)} — ${esc(s.CurrentClass)}</div>
        </div>
      `).join('');
    }
    drop.classList.remove('hidden');
  });

  drop.addEventListener('click', e => {
    const item = e.target.closest('.sibling-option');
    if (item) {
      selectedSiblings.push(item.dataset.id);
      searchInp.value = '';
      drop.classList.add('hidden');
      renderSiblingTags();
      searchInp.focus();
    }
  });

  tagsContainer.addEventListener('click', e => {
    const btn = e.target.closest('.remove-sibling');
    if (btn) {
      selectedSiblings = selectedSiblings.filter(id => id !== btn.dataset.id);
      renderSiblingTags();
    }
  });

  document.addEventListener('click', e => {
    if (!searchInp.contains(e.target) && !drop.contains(e.target)) {
      drop.classList.add('hidden');
    }
  });
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
  $('m-dob').value = st ? toIsoDate(st.DateOfBirth) : '';
  $('m-gender').value = st ? (st.Gender || '') : '';
  $('m-enroll').value = st ? (st.EnrollYear || '') : year();
  $('m-status').value = st ? (st.Status || 'Hoạt động') : 'Hoạt động';
  $('m-father').value = st ? (st.Father || '') : '';
  $('m-mother').value = st ? (st.Mother || '') : '';
  $('m-siblings').value = st ? (st.Siblings || '') : ''; 
  $('m-note').value = st ? (st.Note || '') : '';

  // Safe string casting before split
  selectedSiblings = st && st.Siblings ? String(st.Siblings).split(',').map(s => s.trim()).filter(Boolean) : [];
  renderSiblingTags();
  if ($('m-sibling-search')) $('m-sibling-search').value = '';

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
    siblings: $('m-siblings').value.trim(),
    note: $('m-note').value.trim(),
  };

  if (!body.idNumber || !body.fullName || !body.className) {
    return toast('Nhập Số CCCD, Họ và tên và chọn Lớp.');
  }

  try {
    const r = await api('saveStudent', body);
    const idx = TSTUDENTS.findIndex(s => s.IdNumber === body.idNumber);
    if (idx >= 0) {
      r.student.ListOrder = TSTUDENTS[idx].ListOrder;
      TSTUDENTS[idx] = r.student;
    } else {
      TSTUDENTS.push(r.student);
    }
    
    clearApiCache('getStudents'); 
  } catch (e) { 
    return toast(e.message); 
  }

  closeModal();
  toast('Đã lưu.');
  renderHS();
  if ($('hs-search-input') && $('hs-search-input').value) renderSearch(); // <-- Refresh search results if active
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

// Add these to your Events section
$('hs-search-input').addEventListener('input', renderSearch);

$('hs-search-tbody').addEventListener('click', e => {
  const btn = e.target.closest('.edit-student');
  if (btn) openModal(btn.dataset.id);
});

/* Initial Boot */
setupSiblingSearch();
renderHS();