/* =====================================================================
   SỔ THIẾU NHI — hocsinh/index.js
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, sortStudents, fillClasses, TSTUDENTS, TCLASSES, year, fmtDate, toIsoDate } from '../shared/common.js';

await initCommon();

/* ---------- Initial Data Load ---------- */
const [st, cl] = await Promise.all([
  api('getStudents'),
  api('getClasses')
]);

setState({TSTUDENTS: st.students || [], TCLASSES: cl.classes || []});
fillClasses('hs-lop');
if ($('gallery-lop')) fillClasses('gallery-lop');

let editingId = null;

/* ---------- Tab Management ---------- */
const tabCache = {
  't-class': false, 
  't-gallery': false, 
  't-search': true
};

async function switchTab(tabId) {
  document.querySelectorAll('[data-pane]').forEach(pane => pane.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (targetPane) targetPane.style.display = 'block';
  if (targetBtn) targetBtn.classList.add('active');

  if (!tabCache[tabId]) {
    if (tabId === 't-class') renderHS();
    else if (tabId === 't-gallery') await renderGallery();
    tabCache[tabId] = true;
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

/* ---------- Render Roster (Danh sách) ---------- */
function renderHS() {
  const cls = $('hs-lop').value;
  const sts = sortStudents(TSTUDENTS.filter(s => s.CurrentClass === cls));
  
  $('hs-tbody').innerHTML = sts.length
    ? sts.map((st, i) => {
        const siblingNames = String(st.SiblingGroup || '').split(/[.,\s]+/)
          .map(id => id.trim())
          .filter(Boolean)
          .map(id => {
            const sib = TSTUDENTS.find(s => s.IdNumber === id);
            return sib ? `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs whitespace-nowrap">${esc(sib.FullName)} (${esc(sib.CurrentClass)})</span>` : esc(id);
          }).join(' ');

        return '<tr data-id="' + esc(st.IdNumber) + '" class="hover:bg-slate-50 transition-colors bg-white">' +
          '<td class="p-2 border text-center whitespace-nowrap">' + esc(st.IdNumber) + '</td>' +
          '<td class="p-2 border font-medium">' + esc([st.SaintName, st.FullName].filter(Boolean).join(' ')) + '</td>' +
          '<td class="p-2 border text-center">' + esc(st.Gender || '') + '</td>' +
          '<td class="p-2 border text-center whitespace-nowrap">' + esc(fmtDate(st.DateOfBirth) || '') + '</td>' +
          '<td class="p-2 border text-sm">' + esc(st.Father || '') + '</td>' +
          '<td class="p-2 border text-sm">' + esc(st.Mother || '') + '</td>' +
          '<td class="p-2 border text-center">' + esc(st.PhoneNumber || '') + '</td>' +
          '<td class="p-2 border text-center">' + esc(st.EnrollYear || '') + '</td>' +
          '<td class="p-2 border text-center">' + siblingNames + '</td>' +
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
    tbody.innerHTML = '<tr><td colspan="10" class="p-4 text-center text-slate-400">Nhập tên, tên thánh hoặc CCCD để tìm kiếm...</td></tr>';
    return;
  }

  const hits = TSTUDENTS.filter(s => 
    (s.FullName && s.FullName.toLowerCase().includes(q)) || 
    (s.IdNumber && s.IdNumber.includes(q)) || 
    (s.SaintName && s.SaintName.toLowerCase().includes(q))
  ).slice(0, 50);

  tbody.innerHTML = hits.length
    ? hits.map((st) => {
        const siblingNames = String(st.SiblingGroup || '').split(/[.,\s]+/)
          .map(id => id.trim()).filter(Boolean)
          .map(id => {
            const sib = TSTUDENTS.find(s => s.IdNumber === id);
            return sib ? `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs whitespace-nowrap">${esc(sib.FullName)} (${esc(sib.CurrentClass)})</span>` : esc(id);
          }).join(' ');

        return `<tr data-id="${esc(st.IdNumber)}" class="hover:bg-slate-50 transition-colors bg-white">
          <td class="p-2 border text-center font-bold text-blue-900">${esc(st.CurrentClass)}</td>
          <td class="p-2 border text-center whitespace-nowrap">${esc(st.IdNumber)}</td>
          <td class="p-2 border font-medium">${esc([st.SaintName, st.FullName].filter(Boolean).join(' '))}</td>
          <td class="p-2 border text-center">${esc(st.Gender || '')}</td>
          <td class="p-2 border text-center whitespace-nowrap">${esc(fmtDate(st.DateOfBirth) || '')}</td>
          <td class="p-2 border text-sm">${esc(st.Father || '')}</td>
          <td class="p-2 border text-sm">${esc(st.Mother || '')}</td>
          <td class="p-2 border text-center">${esc(st.PhoneNumber || '')}</td>
          <td class="p-2 border text-center">${esc(st.EnrollYear || '')}</td>
          <td class="p-2 border text-center">${siblingNames}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="10" class="p-4 text-center text-slate-400">Không tìm thấy Thiếu nhi nào phù hợp.</td></tr>';
}

/* ---------- Thư Viện Ảnh (Gallery) ---------- */
async function renderGallery() {
  const cls = $('gallery-lop') ? $('gallery-lop').value :$('hs-lop').value;
  if (!cls) return;

  const classStudents = sortStudents(TSTUDENTS.filter(s => s.CurrentClass === cls));
  const grid = $('gallery-grid');
  if (!grid) return;

  if (!classStudents.length) {
    grid.innerHTML = `<div class="col-span-full text-center p-8 text-slate-400">Không có Thiếu nhi nào trong lớp ${esc(cls)}.</div>`;
    return;
  }

  grid.innerHTML = '';

  const BATCH_SIZE = 6;
  for (let i = 0; i < classStudents.length; i += BATCH_SIZE) {
    const batch = classStudents.slice(i, i + BATCH_SIZE);
    
    const batchHtml = batch.map(st => {
      const fullName = [st.SaintName, st.FullName].filter(Boolean).join(' ');
      if (st.Photo) {
        return `
          <div class="border rounded-lg p-2 flex flex-col items-center bg-white shadow-sm relative group hover:border-blue-300 transition-colors">
            <img src="${st.Photo}" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="w-full aspect-[3/4] object-cover rounded-md mb-2 bg-slate-100">
            <button class="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-md hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity" onclick="removePhoto('${st.IdNumber}')" title="Xóa ảnh">✕</button>
            <div class="text-xs font-bold text-center w-full truncate text-slate-800" title="${esc(fullName)}">${esc(fullName)}</div>
            <div class="text-[10px] text-slate-500 text-center font-mono">${esc(st.IdNumber)}</div>
          </div>`;
      } else {
        return `
          <div class="border rounded-lg p-2 flex flex-col items-center bg-white shadow-sm">
            <div class="w-full aspect-[3/4] bg-slate-50 border-2 border-dashed border-slate-300 rounded-md mb-2 flex flex-col items-center justify-center cursor-pointer hover:bg-blue-50 hover:border-blue-400 text-slate-400 transition-colors" onclick="triggerPhotoUpload('${st.IdNumber}')" title="Nhấn để tải ảnh lên">
              <span class="text-3xl mb-1">+</span>
              <span class="text-[10px] font-medium">Tải ảnh</span>
            </div>
            <div class="text-xs font-bold text-center w-full truncate text-slate-800" title="${esc(fullName)}">${esc(fullName)}</div>
            <div class="text-[10px] text-slate-500 text-center font-mono">${esc(st.IdNumber)}</div>
          </div>`;
      }
    }).join('');

    grid.insertAdjacentHTML('beforeend', batchHtml);
    if (i + BATCH_SIZE < classStudents.length) {
      await new Promise(r => setTimeout(r, 150));
    }
  }
}

/* ---------- Ảnh Thiếu Nhi ---------- */
window.triggerPhotoUpload = function(idNumber) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = (e) => handlePhotoUpload(idNumber, e.target.files[0]);
  inp.click();
};

// Center-crop to square → scale to 200×200 → JPEG 85% for face-scan storage (~15-30KB).
function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 200;
      canvas.getContext('2d').drawImage(
        img,
        (img.width - side) / 2, (img.height - side) / 2, side, side,
        0, 0, 200, 200
      );
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function handlePhotoUpload(idNumber, file) {
  if (!file) return;
  const st = TSTUDENTS.find(s => s.IdNumber === idNumber);
  if (!st) return;

  toast('⏳ Đang tải ảnh lên (có thể mất vài giây)...');

  try {
    const dataUrl = await resizePhoto(file);
    const base64 = dataUrl.split(',')[1];
    const saint = (st.SaintName || '').trim();
    const full = (st.FullName || '').trim();
    const filename = `${idNumber}_${saint ? saint + ' ' : ''}${full}.jpg`.trim();

    const res = await api('uploadFile', { isPhoto: true, filename, mimeType: 'image/jpeg', base64 });
    if (res.status === 'error') return toast(res.message);

    st.Photo = res.url;
    await savePhotoData(st);
    toast('✅ Đã tải ảnh lên thành công.');
    refreshActiveTabs();
    if ($('hs-photo-preview')) $('hs-photo-preview').src = res.url;
    if ($('hs-photo-remove')) $('hs-photo-remove').style.display = 'block';
  } catch (err) { toast('Lỗi: ' + err.message); }
}

window.removePhoto = async function(idNumber) {
  if (!confirm('Bạn có chắc muốn xóa ảnh của Thiếu nhi này?')) return;
  const st = TSTUDENTS.find(s => s.IdNumber === idNumber);
  if (!st) return;
  
  toast('⏳ Đang xóa ảnh...');
  st.Photo = '';
  
  try {
    await savePhotoData(st);
    toast('✅ Đã xóa ảnh.');
    
    refreshActiveTabs();
    if ($('hs-photo-preview'))$('hs-photo-preview').src = ''; 
    if ($('hs-photo-remove'))$('hs-photo-remove').style.display = 'none';
  } catch (e) { toast('Lỗi: ' + e.message); }
};

async function savePhotoData(st) {
  await api('saveStudentPhoto', { idNumber: st.IdNumber, photo: st.Photo });
  setState({ TSTUDENTS: TSTUDENTS.map(s => s.IdNumber === st.IdNumber ? { ...s, Photo: st.Photo } : s) });
}

function refreshActiveTabs() {
  renderHS();
  renderGallery();
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
  
  if ($('m-siblings'))$('m-siblings').value = selectedSiblings.join(',');
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
  $('m-enroll').value = st ? (st.EnrollYear || '') : String(new Date().getFullYear());
  $('m-father').value = st ? (st.Father || '') : '';
  $('m-mother').value = st ? (st.Mother || '') : '';
  if ($('m-phonenumber')) $('m-phonenumber').value = st ? (st.PhoneNumber || '') : '';
  $('m-siblings').value = st ? (st.SiblingGroup || '') : '';

  if ($('hs-photo-preview')) {
    const photoUrl = st ? (st.Photo || '') : '';
    $('hs-photo-preview').src = photoUrl;
    if ($('hs-photo-remove'))$('hs-photo-remove').style.display = photoUrl ? 'block' : 'none';
  }

  selectedSiblings = st && st.SiblingGroup ? String(st.SiblingGroup).split(/[.,\s]+/).map(s => s.trim()).filter(Boolean) : [];
  renderSiblingTags();
  if ($('m-sibling-search'))$('m-sibling-search').value = '';

  const mcls = $('m-class');
  mcls.innerHTML = $('hs-lop').innerHTML;
  mcls.value = st ? (st.CurrentClass || $('hs-lop').value) :$('hs-lop').value;
  $('hs-modal').classList.add('open');
  
  setTimeout(() => { if ($('m-fullname'))$('m-fullname').focus(); }, 50);
}

function closeModal() { 
  $('hs-modal').classList.remove('open'); 
  editingId = null; 
}

async function saveModal() {
  const siblings = $('m-siblings').value.split(/[.,\s]+/).filter(Boolean).sort().join(',');
  const body = {
    idNumber: $('m-cccd').value.trim(),
    fullName: $('m-fullname').value.trim(),
    saintName: $('m-saint').value.trim(),
    dateOfBirth: $('m-dob').value,
    gender: $('m-gender').value,
    className: $('m-class').value,
    enrollYear: $('m-enroll').value.trim(),
    father: $('m-father').value.trim(),
    mother: $('m-mother').value.trim(),
    phoneNumber: $('m-phonenumber') ? $('m-phonenumber').value.trim() : '',
  };

  if (!body.idNumber || !body.fullName || !body.className) {
    return toast('Nhập Số CCCD, Họ và tên và chọn Lớp.');
  }

  try {
    const prevSt = TSTUDENTS.find(s => s.IdNumber === body.idNumber);
    const prevSiblings = (prevSt?.SiblingGroup || '').split(',').filter(Boolean).sort().join(',');
    body.photo = prevSt?.Photo || '';
    if (siblings !== prevSiblings) body.siblings = siblings;

    const r = await api('saveStudentFull', body);
    const student = r.student;
    let list = TSTUDENTS.map(s => s.IdNumber === student.IdNumber ? student : s);
    if (!list.find(s => s.IdNumber === student.IdNumber)) list.push(student);
    if (r.affected) list = list.map(s => r.affected.find(a => a.IdNumber === s.IdNumber) || s);
    setState({ TSTUDENTS: list });
  } catch (e) {
    return toast(e.message);
  }

  closeModal();
  toast('Đã lưu.');

  refreshActiveTabs();
  if ($('hs-search-input') && $('hs-search-input').value) renderSearch();
}

/* ---------- Excel Import & Template ---------- */
function downloadTemplate() {
  const cls = $('hs-lop').value;
  const aoa = [
    ['Số CCCD', 'Tên Thánh', 'Họ Và Tên', 'Giới Tính', 'Ngày Sinh', 'Lớp', 'Năm Nhập Học', 'Cha', 'Mẹ', 'Số Điện Thoại'],
    ['079212300101', 'Maria', 'Nguyễn Thị A', 'Nữ', '2010-05-15', cls || 'Chiên Con', year(), 'Nguyễn Văn B', 'Trần Thị C', '0901234567'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'DanhSach');
  XLSX.writeFile(wb, 'Danh_sach_thieu_nhi_' + (cls || 'mau') + '.xlsx');
}

async function importStudents() {
  const f = $('hs-file').files[0];$('hs-file').value = '';
  if (!f) return;
  
  let ws;
  try { 
    const wb = XLSX.read(await f.arrayBuffer()); 
    ws = wb.Sheets[wb.SheetNames[0]]; 
  } catch (e) { return toast('Không đọc được file Excel.'); }
  
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (rows.length === 0) return toast('File không có dữ liệu.');
  
  const students = [];
  rows.forEach(r => {
    const rawId = r['Số CCCD'] || r['CCCD'] || r['IdNumber'] || '';
    const rawName = r['Họ Và Tên'] || r['Họ tên'] || r['Họ và tên'] || '';
    
    const id = String(rawId).replace(/^[']+/, '').trim();
    const fullName = String(rawName).trim();
    
    if (!id || !fullName) return;
    
    students.push({
      idNumber: id,
      saintName: String(r['Tên Thánh'] || '').trim(),
      fullName: fullName,
      gender: String(r['Giới Tính'] || '').trim(),
      dateOfBirth: String(r['Ngày Sinh'] || '').trim(),
      className: String(r['Lớp'] || $('hs-lop').value).trim(),
      enrollYear: String(r['Năm Nhập Học'] || '').trim(),
      father: String(r['Cha'] || '').trim(),
      mother: String(r['Mẹ'] || '').trim(),
      phoneNumber: String(r['Số Điện Thoại'] || r['SĐT'] || '').trim(),
    });
  });
  
  if (!students.length) return toast('Không tìm thấy dòng dữ liệu hợp lệ (Cần cột "Số CCCD" và "Họ Và Tên").');
  
  toast('⏳ Đang nhập ' + students.length + ' Thiếu nhi...');
  
  try {
    const res = await api('importStudents', { students });
    toast('Đã lưu ' + res.count + ' Thiếu nhi.');
    
    const st = await api('getStudents');
    setState({TSTUDENTS: st.students || []});
    
    refreshActiveTabs();
    if ($('hs-search-input') &&$('hs-search-input').value) renderSearch(); 
  } catch (e) {
    toast('Lỗi: ' + e.message);
  }
}

/* ---------- Events ---------- */
$('hs-lop').addEventListener('change', () => { 
  tabCache['t-class'] = true; 
  renderHS();
});

if ($('gallery-lop')) {$('gallery-lop').addEventListener('change', () => {
    tabCache['t-gallery'] = true;
    renderGallery();
  });
}

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

if ($('hs-photo-btn')) {$('hs-photo-btn').addEventListener('click', () => {
    if (editingId) triggerPhotoUpload(editingId);
    else toast('Vui lòng lưu hồ sơ mới trước khi tải ảnh lên.');
  });
}
if ($('hs-photo-remove')) {$('hs-photo-remove').addEventListener('click', () => {
    if (editingId) removePhoto(editingId);
  });
}

$('hs-search-input').addEventListener('input', renderSearch);

$('hs-search-tbody').addEventListener('click', e => {
  const btn = e.target.closest('.edit-student');
  if (btn) openModal(btn.dataset.id);
});

if ($('hs-template-link'))$('hs-template-link').addEventListener('click', downloadTemplate);
if ($('hs-file'))$('hs-file').addEventListener('change', importStudents);

/* Initial Boot */
setupSiblingSearch();
switchTab('t-class');