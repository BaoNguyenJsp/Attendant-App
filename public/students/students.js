/* =====================================================================
   SỔ THIẾU NHI — students/students.js
   Class list, add / edit form with siblings, Excel import, photo gallery,
   whole-parish search (UC-S1 to UC-S7).
   ===================================================================== */
'use strict';

import {
  initCommon, load, state, $, api, apiSend, esc, toast, fillSel, fillClasses, setupTabs, sortStudents,
  isAdmin, canWriteClass, className, personName, photoUrl, fmtDate, toIsoDate, vnTodayIso,
} from '../shared/common.js';
import { GENDER_LABEL, STUDENT_STATUS_LABEL } from '../shared/labels.js';
import { matchesStudent } from '../shared/search.js';
import { badge, STATUS_TONE } from '../shared/ui.js';

await initCommon();
await load('students', 'classes');

const byId = (id) => state.students.find((s) => s.id === Number(id));
const options = (labels) => Object.entries(labels).map(([v, t]) => ({ v, t }));

fillClasses('st-class', 'gallery-class');
fillSel('st-status', options(STUDENT_STATUS_LABEL), 'ACTIVE');
fillSel('m-gender', [{ v: '', t: '—' }, ...options(GENDER_LABEL)]);
fillSel('m-status', options(STUDENT_STATUS_LABEL));

/* ---------- Cells shared by the class list and the search ---------- */
const siblingCell = (s) => s.siblingIds.map(byId).filter(Boolean)
  .map((x) => `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs whitespace-nowrap">${esc(x.fullName)} (${esc(className(x.classId))})</span>`).join(' ');

// Each number on its own line with a copy button (UC-S1).
const phoneCell = (s) => s.phones
  .map((p) => `<span class="whitespace-nowrap">${esc(p)} <button type="button" class="copy-phone text-slate-400 hover:text-blue-700" data-phone="${esc(p)}" title="Sao chép số này">📋</button></span>`)
  .join('<br>');

const detailCells = (s) => `<td class="p-2 border text-center whitespace-nowrap">${esc(s.idNumber)}</td>`
  + `<td class="p-2 border font-medium">${esc(personName(s))}</td>`
  + `<td class="p-2 border text-center">${esc(GENDER_LABEL[s.gender] ?? '')}</td>`
  + `<td class="p-2 border text-center whitespace-nowrap">${esc(fmtDate(s.dateOfBirth))}</td>`
  + `<td class="p-2 border text-sm">${esc(s.father ?? '')}</td>`
  + `<td class="p-2 border text-sm">${esc(s.mother ?? '')}</td>`
  + `<td class="p-2 border text-center">${phoneCell(s)}</td>`
  + `<td class="p-2 border text-center">${esc(s.enrollYear ?? '')}</td>`
  + `<td class="p-2 border text-center">${siblingCell(s)}</td>`;

async function copyPhone(event) {
  const button = event.target.closest('.copy-phone');
  if (!button) return;
  try {
    await navigator.clipboard.writeText(button.dataset.phone);
    toast(`Đã sao chép ${button.dataset.phone}`);
  } catch {
    toast('Trình duyệt không cho phép sao chép.');
  }
}

/* ---------- Tab 1: class list ---------- */
function renderClass() {
  const classId = Number($('st-class').value);
  const status = $('st-status').value;
  const editable = canWriteClass(classId);
  $('st-add').style.display = editable ? '' : 'none';
  const rows = sortStudents(state.students.filter((s) => s.classId === classId && s.status === status));
  $('st-tbody').innerHTML = rows.length
    ? rows.map((s) => `<tr class="hover:bg-slate-50 transition-colors bg-white">${detailCells(s)}`
      + '<td class="p-2 border text-center sticky-col">'
      + (editable ? `<button data-id="${s.id}" class="edit-student bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs px-4 py-2 rounded-lg whitespace-nowrap">Cập nhật</button>` : '—')
      + '</td></tr>').join('')
    : `<tr><td colspan="10" class="p-4 text-center text-slate-400">Không có Thiếu nhi "${esc(STUDENT_STATUS_LABEL[status])}" trong lớp ${esc(className(classId))}.</td></tr>`;
}

/* ---------- Tab 3: whole-parish search (exact match, every match shown) ---------- */
function renderSearch() {
  const query = $('st-search').value;
  const body = $('st-search-tbody');
  if (!query.trim()) {
    body.innerHTML = '<tr><td colspan="12" class="p-4 text-center text-slate-400">Nhập đúng họ tên hoặc số CCCD để tìm kiếm...</td></tr>';
    return;
  }
  const hits = state.students.filter((s) => matchesStudent(s, query));
  body.innerHTML = hits.length
    ? hits.map((s) => '<tr class="hover:bg-slate-50 transition-colors bg-white">'
      // The photo is fetched only when the button is pressed, never while the list is drawn.
      + `<td class="p-2 border text-center">${s.hasPhoto ? `<button type="button" class="show-photo" data-id="${s.id}" title="Xem ảnh">📷</button>` : ''}</td>`
      + `<td class="p-2 border text-center font-bold text-blue-900">${esc(className(s.classId))}</td>`
      + `<td class="p-2 border text-center">${badge(STUDENT_STATUS_LABEL[s.status], STATUS_TONE[s.status])}</td>`
      + `${detailCells(s)}</tr>`).join('')
    : '<tr><td colspan="12" class="p-4 text-center text-slate-400">Không tìm thấy Thiếu nhi nào khớp chính xác.</td></tr>';
}

function showPhoto(id) {
  const s = byId(id);
  if (!s) return;
  $('photo-modal-title').textContent = personName(s);
  $('photo-modal-img').src = photoUrl(s);
  $('photo-modal').classList.add('open');
}

/* ---------- Tab 2: photo gallery ---------- */
function photoCard(s) {
  const name = personName(s);
  const caption = `<div class="text-xs font-bold text-center w-full truncate text-slate-800" title="${esc(name)}">${esc(name)}</div>`
    + `<div class="text-[10px] text-slate-500 text-center font-mono">${esc(s.idNumber)}</div>`;
  if (!s.hasPhoto) {
    const box = isAdmin()
      ? `<button type="button" class="photo-upload w-full aspect-square bg-slate-50 border-2 border-dashed border-slate-300 rounded-md mb-2 flex flex-col items-center justify-center hover:bg-blue-50 hover:border-blue-400 text-slate-400 transition-colors" data-id="${s.id}" title="Nhấn để tải ảnh lên"><span class="text-3xl mb-1">+</span><span class="text-[10px] font-medium">Tải ảnh</span></button>`
      : '<div class="w-full aspect-square bg-slate-50 border border-slate-200 rounded-md mb-2 flex items-center justify-center text-slate-300 text-[10px]">Chưa có ảnh</div>';
    return `<div class="border rounded-lg p-2 flex flex-col items-center bg-white shadow-sm">${box}${caption}</div>`;
  }
  const corner = 'absolute text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-md';
  // Remove and replace sit in opposite corners so one is not pressed for the other.
  const adminButtons = isAdmin()
    ? `<button type="button" class="photo-remove ${corner} -top-1 -right-1 bg-red-500 hover:bg-red-600" data-id="${s.id}" title="Xóa ảnh">✕</button>`
      + `<button type="button" class="photo-upload ${corner} -top-1 -left-1 bg-blue-600 hover:bg-blue-700" data-id="${s.id}" title="Thay ảnh khác">🔄</button>`
    : '';
  return '<div class="border rounded-lg p-2 flex flex-col items-center bg-white shadow-sm relative hover:border-blue-300 transition-colors">'
    + `<img src="${photoUrl(s)}" loading="lazy" decoding="async" alt="" class="w-full aspect-square object-cover rounded-md mb-2 bg-slate-100">`
    + adminButtons
    + `<a class="${corner} top-1/2 -right-1 bg-slate-600 hover:bg-slate-700 no-underline" href="${photoUrl(s)}&download=1" title="Tải ảnh về">⬇</a>`
    + `${caption}</div>`;
}

function renderGallery() {
  const classId = Number($('gallery-class').value);
  const rows = sortStudents(state.students.filter((s) => s.classId === classId && s.status === 'ACTIVE'));
  $('gallery-grid').innerHTML = rows.length
    ? rows.map(photoCard).join('')
    : `<div class="col-span-full text-center p-8 text-slate-400">Không có Thiếu nhi nào trong lớp ${esc(className(classId))}.</div>`;
}

// Centre crop to a square, 200 x 200, JPEG 85 % (about 15-30 KB): what the face scan needs.
function resizePhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 200, 200);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Không xử lý được ảnh.'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Tệp không phải là ảnh.')); };
    img.src = url;
  });
}

const setPhoto = (id, photoVersion) => {
  state.students = state.students.map((s) => (s.id === id ? { ...s, photoVersion, hasPhoto: photoVersion > 0 } : s));
  renderGallery();
};

// Upload and replace are the same: the new photo overwrites the old one in one step.
function pickPhoto(id) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png';
  input.onchange = async () => {
    if (!input.files[0]) return;
    toast('⏳ Đang tải ảnh lên...');
    try {
      const r = await apiSend('PUT', `/api/students/${id}/photo`, await resizePhoto(input.files[0]));
      setPhoto(id, r.photoVersion);
      toast('✅ Đã lưu ảnh.');
    } catch (e) { toast(`Lỗi: ${e.message}`); }
  };
  input.click();
}

async function removePhoto(id) {
  if (!confirm(`Xóa ảnh của ${personName(byId(id))}?`)) return;
  try {
    await apiSend('DELETE', `/api/students/${id}/photo`);
    setPhoto(id, 0);
    toast('✅ Đã xóa ảnh.');
  } catch (e) { toast(`Lỗi: ${e.message}`); }
}

/* ---------- Form: phones ---------- */
const phoneRow = (value = '') => `<div class="flex gap-2"><input type="text" class="m-phone flex-1" value="${esc(value)}" placeholder="Số điện thoại">`
  + '<button type="button" class="m-phone-remove px-2 text-slate-400 hover:text-red-600" title="Bỏ số này">✕</button></div>';

function setPhones(phones) {
  $('m-phones').innerHTML = (phones.length ? phones : ['']).map(phoneRow).join('');
}
const readPhones = () => [...$('m-phones').querySelectorAll('.m-phone')].map((input) => input.value.trim()).filter(Boolean);

/* ---------- Form: siblings ---------- */
let editingId = null;
let siblingIds = [];

function renderSiblingTags() {
  $('m-sibling-tags').innerHTML = siblingIds.map(byId).filter(Boolean).map((s) => '<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs flex items-center gap-1 font-semibold">'
    + `${esc(s.fullName)} (${esc(className(s.classId))})`
    + `<button type="button" class="remove-sibling text-blue-500 hover:text-blue-900 font-bold px-1" data-id="${s.id}">×</button></span>`).join('');
}

// Exact match (search rule); everyone who matches is offered.
function searchSiblings() {
  const query = $('m-sibling-search').value;
  const drop = $('m-sibling-dropdown');
  if (!query.trim()) { drop.classList.add('hidden'); return; }
  const hits = state.students.filter((s) => s.id !== editingId && !siblingIds.includes(s.id) && matchesStudent(s, query));
  drop.innerHTML = hits.length
    ? hits.map((s) => `<div class="sibling-option p-2 hover:bg-blue-50 cursor-pointer border-b border-slate-100 last:border-0" data-id="${s.id}">`
      + `<div class="text-sm font-bold text-blue-900">${esc(personName(s))}</div>`
      + `<div class="text-xs text-slate-500">${esc(s.idNumber)} — ${esc(className(s.classId))}</div></div>`).join('')
    : '<div class="p-2 text-sm text-slate-500 text-center">Không tìm thấy (cần nhập đúng họ tên hoặc số CCCD)</div>';
  drop.classList.remove('hidden');
}

/* ---------- Form: open, save ---------- */
function openForm(id) {
  const s = id ? byId(id) : null;
  editingId = s ? s.id : null;
  $('m-title').textContent = s ? `Cập nhật Thiếu nhi — ${s.fullName}` : 'Thêm Thiếu nhi';
  $('m-idnumber').value = s?.idNumber ?? '';
  $('m-fullname').value = s?.fullName ?? '';
  $('m-saint').value = s?.saintName ?? '';
  $('m-dob').value = s?.dateOfBirth ?? '';
  $('m-gender').value = s?.gender ?? '';
  $('m-enroll').value = s ? (s.enrollYear ?? '') : vnTodayIso().slice(0, 4);
  $('m-father').value = s?.father ?? '';
  $('m-mother').value = s?.mother ?? '';
  // Status is asked only for an existing student; a new one is always "Hoạt động".
  $('m-status-row').style.display = s ? '' : 'none';
  $('m-status').value = s?.status ?? 'ACTIVE';
  setPhones(s?.phones ?? []);
  siblingIds = s ? [...s.siblingIds] : [];
  renderSiblingTags();
  $('m-sibling-search').value = '';
  $('m-sibling-dropdown').classList.add('hidden');

  // Only Xứ đoàn moves a student to another class (R4): for others the field is shown but locked.
  const classes = s && !isAdmin() ? state.classes : (isAdmin() ? state.classes : state.classes.filter((c) => canWriteClass(c.id)));
  fillSel('m-class', classes.map((c) => ({ v: c.id, t: c.name })), s ? s.classId : Number($('st-class').value));
  $('m-class').disabled = !!s && !isAdmin();

  $('st-modal').classList.add('open');
  setTimeout(() => $('m-fullname').focus(), 50);
}

function closeForm() {
  $('st-modal').classList.remove('open');
  editingId = null;
}

async function saveForm() {
  const old = editingId ? byId(editingId) : null;
  const body = {
    idNumber: $('m-idnumber').value.trim(),
    fullName: $('m-fullname').value.trim(),
    saintName: $('m-saint').value.trim(),
    dateOfBirth: $('m-dob').value || null,
    gender: $('m-gender').value || null,
    classId: Number($('m-class').value),
    enrollYear: $('m-enroll').value.trim(),
    father: $('m-father').value.trim(),
    mother: $('m-mother').value.trim(),
    phones: readPhones(),
  };
  if (!body.idNumber || !body.fullName || !body.classId) return toast('Nhập Số CCCD, Họ và tên và chọn Lớp.');
  if (old) {
    body.id = old.id;
    body.status = $('m-status').value;
  }
  // Siblings are sent only when they changed, so an ordinary edit never touches the family.
  const before = old ? [...old.siblingIds].sort((a, b) => a - b).join() : '';
  if ([...siblingIds].sort((a, b) => a - b).join() !== before) body.siblingIds = siblingIds;

  let saved;
  try { saved = await api('saveStudent', body); } catch (e) { return toast(e.message); }
  const changed = new Map([saved.student, ...saved.affected].map((s) => [s.id, s]));
  state.students = state.students.map((s) => changed.get(s.id) ?? s);
  if (!old) state.students.push(saved.student);
  closeForm();
  toast('Đã lưu.');
  renderClass();
  renderSearch();
}

/* ---------- Excel import (Xứ đoàn) ---------- */
const TEMPLATE_HEADER = ['Số CCCD', 'Tên Thánh', 'Họ Và Tên', 'Giới Tính', 'Ngày Sinh', 'Cha', 'Mẹ', 'Số Điện Thoại'];

function downloadTemplate() {
  const rows = [TEMPLATE_HEADER, ['079212300101', 'Maria', 'Nguyễn Thị A', 'Nữ', '15/05/2015', 'Nguyễn Văn B', 'Trần Thị C', '0901234567 / 0912345678']];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'DanhSach');
  XLSX.writeFile(wb, 'Danh_sach_thieu_nhi_mau.xlsx');
}

const GENDER_CODE = { 'nữ': 'F', nu: 'F', f: 'F', nam: 'M', m: 'M' };

async function importFile() {
  const file = $('st-file').files[0];
  $('st-file').value = '';
  if (!file) return;
  const classId = Number($('st-class').value);
  let rows;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch { return toast('Không đọc được file Excel.'); }

  const students = [];
  for (const r of rows) {
    const idNumber = String(r['Số CCCD'] ?? '').replace(/^'+/, '').trim();
    const fullName = String(r['Họ Và Tên'] ?? r['Họ và tên'] ?? '').trim();
    if (!idNumber || !fullName) continue; // rows without CCCD and name are skipped
    const birth = r['Ngày Sinh'];
    const dateOfBirth = birth === '' ? null : toIsoDate(birth);
    if (dateOfBirth === '') return toast(`Ngày sinh không hợp lệ: ${fullName} (dùng dạng 15/05/2015).`);
    students.push({
      idNumber, fullName, dateOfBirth,
      saintName: String(r['Tên Thánh'] ?? '').trim(),
      gender: GENDER_CODE[String(r['Giới Tính'] ?? '').normalize('NFC').trim().toLowerCase()] ?? null,
      father: String(r['Cha'] ?? '').trim(),
      mother: String(r['Mẹ'] ?? '').trim(),
      phones: String(r['Số Điện Thoại'] ?? '').split('/').map((p) => p.trim()).filter(Boolean),
    });
  }
  if (!students.length) return toast('Không tìm thấy dòng dữ liệu hợp lệ (cần cột "Số CCCD" và "Họ Và Tên").');
  if (!confirm(`Nhập ${students.length} Thiếu nhi vào lớp ${className(classId)}?`)) return;

  try {
    const r = await api('importStudents', { classId, students });
    await load('students', 'classes');
    toast(`Đã lưu ${r.count} Thiếu nhi vào lớp ${className(classId)}.`);
    renderClass();
  } catch (e) { toast(`Lỗi: ${e.message}`); }
}

/* ---------- Events ---------- */
$('st-class').addEventListener('change', renderClass);
$('st-status').addEventListener('change', renderClass);
$('gallery-class').addEventListener('change', renderGallery);
$('st-search').addEventListener('input', renderSearch);
$('st-add').addEventListener('click', () => openForm());
$('st-template').addEventListener('click', downloadTemplate);
$('st-file').addEventListener('change', importFile);

$('st-tbody').addEventListener('click', (e) => {
  const edit = e.target.closest('.edit-student');
  if (edit) openForm(edit.dataset.id);
  copyPhone(e);
});
$('st-search-tbody').addEventListener('click', (e) => {
  const photo = e.target.closest('.show-photo');
  if (photo) showPhoto(photo.dataset.id);
  copyPhone(e);
});
$('gallery-grid').addEventListener('click', (e) => {
  const upload = e.target.closest('.photo-upload');
  const remove = e.target.closest('.photo-remove');
  if (upload) pickPhoto(Number(upload.dataset.id));
  else if (remove) removePhoto(Number(remove.dataset.id));
});

$('m-phone-add').addEventListener('click', () => $('m-phones').insertAdjacentHTML('beforeend', phoneRow()));
$('m-phones').addEventListener('click', (e) => {
  const remove = e.target.closest('.m-phone-remove');
  if (!remove) return;
  remove.parentElement.remove();
  if (!$('m-phones').children.length) setPhones([]);
});
$('m-sibling-search').addEventListener('input', searchSiblings);
$('m-sibling-dropdown').addEventListener('click', (e) => {
  const option = e.target.closest('.sibling-option');
  if (!option) return;
  siblingIds.push(Number(option.dataset.id));
  $('m-sibling-search').value = '';
  $('m-sibling-dropdown').classList.add('hidden');
  renderSiblingTags();
});
$('m-sibling-tags').addEventListener('click', (e) => {
  const remove = e.target.closest('.remove-sibling');
  if (!remove) return;
  siblingIds = siblingIds.filter((id) => id !== Number(remove.dataset.id));
  renderSiblingTags();
});

const formModal = $('st-modal');
formModal.addEventListener('click', (e) => { if (e.target === formModal) closeForm(); });
formModal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeForm(); });
formModal.querySelector('.btn-cancel').addEventListener('click', closeForm);
formModal.querySelector('.btn-save').addEventListener('click', saveForm);

const photoModal = $('photo-modal');
const closePhoto = () => photoModal.classList.remove('open');
photoModal.addEventListener('click', (e) => { if (e.target === photoModal) closePhoto(); });
photoModal.querySelector('.btn-cancel').addEventListener('click', closePhoto);

/* ---------- Start ---------- */
const showTab = setupTabs({ 't-class': renderClass, 't-gallery': renderGallery, 't-search': renderSearch });
showTab('t-class');
