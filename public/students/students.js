/* =====================================================================
   SỔ THIẾU NHI — students/students.js
   Class list, add / edit form with siblings, Excel import, photo gallery,
   whole-parish search (UC-S1 to UC-S7).
   ===================================================================== */
'use strict';

import {
  initCommon, load, state, $, api, apiSend, esc, toast, fillSel, fillClasses, setupTabs, sortStudents,
  isAdmin, canWriteClass, className, personName, photoUrl, fmtDate, toIsoDate,
} from '../shared/common.js';
import { GENDER_LABEL, STUDENT_STATUS_LABEL } from '../shared/labels.js';
import { matchesStudent } from '../shared/search.js';
import { badge, STATUS_TONE, cropPhoto, editIcon, deleteIcon } from '../shared/ui.js';
import { siblingCell, siblingEditor } from '../shared/siblings.js';

await initCommon();
await load('students', 'classes', 'families');

const byId = (id) => state.students.find((s) => s.id === Number(id));
const options = (labels) => Object.entries(labels).map(([v, t]) => ({ v, t }));

fillClasses('st-class', 'gallery-class');
fillSel('st-status', options(STUDENT_STATUS_LABEL), 'ACTIVE');
fillSel('m-gender', [{ v: '', t: '—' }, ...options(GENDER_LABEL)]);

/* ---------- Cells shared by the class list and the search ---------- */
// Each number on its own line with a copy button (UC-S1).
const phoneCell = (s) => s.phones
  .map((p) => `<span class="whitespace-nowrap">${esc(p)} <button type="button" class="copy-phone text-slate-400 hover:text-blue-700" data-phone="${esc(p)}" title="Sao chép số này">📋</button></span>`)
  .join('<br>');

const detailCells = (s) => `<td class="p-2 border text-center whitespace-nowrap">${esc(s.idNumber)}</td>`
  + `<td class="p-2 border font-medium whitespace-nowrap">${esc(personName(s))}</td>`
  + `<td class="p-2 border text-center">${esc(GENDER_LABEL[s.gender] ?? '')}</td>`
  + `<td class="p-2 border text-center whitespace-nowrap">${esc(fmtDate(s.dateOfBirth))}</td>`
  + `<td class="p-2 border text-sm">${esc(s.father ?? '')}</td>`
  + `<td class="p-2 border text-sm">${esc(s.mother ?? '')}</td>`
  + `<td class="p-2 border text-sm">${esc(s.address ?? '')}</td>`
  + `<td class="p-2 border text-center">${phoneCell(s)}</td>`
  + `<td class="p-2 border text-center">${siblingCell(`s${s.id}`)}</td>`;

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
  const rows = sortStudents(state.students.filter((s) => s.classId === classId && s.status === status));
  // Xứ đoàn and the class's own teachers add, import and edit here; for others the buttons and the column are not drawn.
  const canEdit = canWriteClass(classId);
  document.querySelectorAll('.class-write').forEach((el) => el.classList.toggle('hidden', !canEdit));
  $('st-tbody').innerHTML = rows.length
    ? rows.map((s) => `<tr class="hover:bg-slate-50 transition-colors bg-white">${detailCells(s)}`
      + (canEdit ? `<td class="p-2 border text-center whitespace-nowrap sticky-col">${editIcon('edit-student', s.id)}${deleteIcon('delete-student', s.id)}</td>` : '')
      + '</tr>').join('')
    : `<tr><td colspan="10" class="p-4 text-center text-slate-400">Không có Thiếu nhi "${esc(STUDENT_STATUS_LABEL[status])}" trong lớp ${esc(className(classId))}.</td></tr>`;
}

/* ---------- Tab 3: whole-parish search (part of the name or exact CCCD, every match shown) ---------- */
function renderSearch() {
  const query = $('st-search').value;
  const body = $('st-search-tbody');
  if (!query.trim()) {
    body.innerHTML = '<tr><td colspan="12" class="p-4 text-center text-slate-400">Nhập họ tên (một phần, có dấu) hoặc số CCCD để tìm kiếm...</td></tr>';
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
    : '<tr><td colspan="12" class="p-4 text-center text-slate-400">Không tìm thấy Thiếu nhi nào khớp.</td></tr>';
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
    const box = canWriteClass(s.classId)
      ? `<button type="button" class="photo-upload w-full aspect-[3/4] bg-slate-50 border-2 border-dashed border-slate-300 rounded-md mb-2 flex flex-col items-center justify-center hover:bg-blue-50 hover:border-blue-400 text-slate-400 transition-colors" data-id="${s.id}" title="Nhấn để tải ảnh lên"><span class="text-3xl mb-1">+</span><span class="text-[10px] font-medium">Tải ảnh</span></button>`
      : '<div class="w-full aspect-[3/4] bg-slate-50 border border-slate-200 rounded-md mb-2 flex items-center justify-center text-slate-300 text-[10px]">Chưa có ảnh</div>';
    return `<div class="border rounded-lg p-2 flex flex-col items-center bg-white shadow-sm">${box}${caption}</div>`;
  }
  const corner = 'absolute text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-md';
  // To replace a photo: remove it, then upload the new one.
  const photoButtons = canWriteClass(s.classId)
    ? `<button type="button" class="photo-remove ${corner} -top-1 -right-1 bg-red-500 hover:bg-red-600" data-id="${s.id}" title="Xóa ảnh">✕</button>`
    : '';
  return '<div class="border rounded-lg p-2 flex flex-col items-center bg-white shadow-sm relative hover:border-blue-300 transition-colors">'
    + `<img src="${photoUrl(s)}" loading="lazy" decoding="async" alt="" class="w-full aspect-[3/4] object-cover rounded-md mb-2 bg-slate-100">`
    + photoButtons
    + `${caption}</div>`;
}

function renderGallery() {
  const classId = Number($('gallery-class').value);
  const rows = sortStudents(state.students.filter((s) => s.classId === classId && s.status === 'ACTIVE'));
  $('gallery-grid').innerHTML = rows.length
    ? rows.map(photoCard).join('')
    : `<div class="col-span-full text-center p-8 text-slate-400">Không có Thiếu nhi nào trong lớp ${esc(className(classId))}.</div>`;
}

// Centre crop to 3:4 (ID photo shape), 210 x 280, JPEG 85 % (about 25-40 KB): enough for the face scan and
// small enough for the D1 storage limit. Old square photos are shown cropped the same way until replaced.
const resizePhoto = (file) => cropPhoto(file, 210, 280);

const setPhoto = (id, photoVersion) => {
  state.students = state.students.map((s) => (s.id === id ? { ...s, photoVersion, hasPhoto: photoVersion > 0 } : s));
  renderGallery();
};

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

/* ---------- Form: siblings (Huynh trưởng are added and removed from their own page) ---------- */
let editingId = null;
const siblings = siblingEditor('m', () => [], { lockTeachers: true });

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
  $('m-father').value = s?.father ?? '';
  $('m-mother').value = s?.mother ?? '';
  $('m-address').value = s?.address ?? '';
  // Status is asked only for an existing student; a new one is always "Hoạt động".
  $('m-status-row').style.display = s ? '' : 'none';
  // Only Xứ đoàn graduates, and only from the last class; a graduate who became a Huynh trưởng keeps the status for good.
  const lastClass = state.classes.at(-1)?.id;
  const statuses = options(STUDENT_STATUS_LABEL).filter(({ v }) => v !== 'GRADUATED' || s?.status === 'GRADUATED' || (isAdmin() && s?.classId === lastClass));
  fillSel('m-status', statuses, s?.status ?? 'ACTIVE');
  $('m-status').disabled = !!(s && state.families.graduates[`s${s.id}`]);
  setPhones(s?.phones ?? []);
  siblings.open(s ? `s${s.id}` : null);

  fillSel('m-class', state.classes.map((c) => ({ v: c.id, t: c.name })), s ? s.classId : Number($('st-class').value));
  $('m-class').disabled = !isAdmin(); // only Xứ đoàn picks or changes the class; a teacher adds to the class in view

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
    father: $('m-father').value.trim(),
    mother: $('m-mother').value.trim(),
    address: $('m-address').value.trim(),
    phones: readPhones(),
  };
  if (!body.idNumber || !body.fullName || !body.classId) return toast('Nhập Số CCCD, Họ và tên và chọn Lớp.');
  if (old) {
    body.id = old.id;
    body.status = $('m-status').value;
    if (body.status === 'GRADUATED' && old.status !== 'GRADUATED'
      && !confirm(`${personName(old)} tốt nghiệp: một Huynh trưởng mới (Hoạt động, lớp Chiên Con) được tạo với email tạm và thay Thiếu nhi trong nhóm anh chị em. Xứ đoàn cập nhật email thật để đăng nhập được. Không đổi lại trạng thái được.`)) return;
    if (body.status === 'INACTIVE' && old.status !== 'INACTIVE' && siblings.count()
      && !confirm(`${personName(old)} ngưng hoạt động sẽ rời nhóm anh chị em. Tiếp tục?`)) return;
  }
  body.siblings = siblings.changed();

  let saved;
  try { saved = await api('saveStudent', body); } catch (e) { return toast(e.message); }
  state.students = old ? state.students.map((s) => (s.id === saved.student.id ? saved.student : s)) : [...state.students, saved.student];
  state.families = saved.families;
  closeForm();
  toast('Đã lưu.');
  renderClass();
  renderSearch();
}

// Attendance, scores and photo go with the student; "Ngưng hoạt động" keeps them.
async function deleteStudent(id) {
  const s = byId(id);
  if (!s || !confirm(`Xóa vĩnh viễn ${personName(s)}? Điểm danh, điểm và ảnh của Thiếu nhi này cũng bị xóa. Không thể hoàn tác.\nNếu chỉ nghỉ học, hãy chuyển sang "Ngưng hoạt động".`)) return;
  try {
    await api('deleteStudent', { id: s.id });
    await load('students', 'classes', 'families'); // siblings of the student change too
  } catch (e) { return toast(e.message); }
  toast('Đã xóa.');
  renderClass();
  renderSearch();
}

/* ---------- Excel import (Xứ đoàn and the class's teachers) ---------- */
const TEMPLATE_HEADER = ['Số CCCD', 'Tên Thánh', 'Họ Và Tên', 'Giới Tính', 'Ngày Sinh', 'Cha', 'Mẹ', 'Địa Chỉ', 'Số Điện Thoại'];

function downloadTemplate() {
  const rows = [TEMPLATE_HEADER, ['079212300101', 'Maria', 'Nguyễn Thị A', 'Nữ', '15/05/2015', 'Nguyễn Văn B', 'Trần Thị C', '123 Lê Lợi, P. Bến Thành, Q.1', '0901234567 / 0912345678']];
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
      address: String(r['Địa Chỉ'] ?? '').trim(),
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
  const remove = e.target.closest('.delete-student');
  if (remove) deleteStudent(remove.dataset.id);
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
