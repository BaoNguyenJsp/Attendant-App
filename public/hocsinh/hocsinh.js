/* =====================================================================
   SỔ THIẾU NHI — hocsinh/index.js
   Thêm / sửa thiếu nhi theo lớp (admin mọi lớp · giáo viên lớp được phân công).
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TSTUDENTS, TCLASSES, year, fillClasses } from '../shared/common.js';

await initCommon();

const [st, cl] = await Promise.all([
  api('getStudents'),
  api('getClasses')
]);
setState({TSTUDENTS: st.students || [], TCLASSES: cl.classes || []});
fillClasses('hs-lop');

function renderHS() {
  const cls = $('hs-lop').value;
  const sts = TSTUDENTS.filter(s => s.CurrentClass === cls);
  $('hs-tbody').innerHTML = sts.length
    ? sts.map(st => '<tr data-id="' + esc(st.IdNumber) + '">' +
        '<td class="p-2 border text-center">' + esc(st.IdNumber) + '</td>' +
        '<td class="p-2 border"><input data-f="fullName" value="' + esc(st.FullName) + '" class="w-full border p-1.5 rounded text-sm"></td>' +
        '<td class="p-2 border text-center"><input data-f="dateOfBirth" type="date" value="' + esc(st.DateOfBirth || '') + '" class="border p-1.5 rounded text-sm"></td>' +
        '<td class="p-2 border text-center"><input data-f="enrollYear" value="' + esc(st.EnrollYear || '') + '" class="w-24 border p-1.5 rounded text-sm"></td>' +
        '<td class="p-2 border text-center"><select data-f="status" class="border p-1.5 rounded text-sm">' +
        ['Hoạt động', 'Tốt nghiệp', 'Ngưng hoạt động'].map(o => '<option' + (st.Status === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select></td>' +
        '<td class="p-2 border"><input data-f="note" value="' + esc(st.Note || '') + '" class="w-full border p-1.5 rounded text-sm"></td>' +
        '<td class="p-2 border text-center"><button data-id="' + esc(st.IdNumber) + '" class="save-student bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-lg">💾</button></td>' +
        '</tr>').join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có học sinh trong lớp ' + esc(cls) + '.</td></tr>';
}
async function saveStudentRow(id) {
  let tr = null;
  $('hs-tbody').querySelectorAll('tr').forEach(r => { if (r.dataset.id === id) tr = r; });
  if (!tr) return;
  const cls = $('hs-lop').value;
  const body = {idNumber: id, className: cls};
  tr.querySelectorAll('[data-f]').forEach(inp => { const v = inp.value.trim(); if (v !== '') body[inp.dataset.f] = v; });
  try {
    const r = await api('saveStudent', body);
    const idx = TSTUDENTS.findIndex(s => s.IdNumber === id);
    if (idx >= 0) TSTUDENTS[idx] = r.student; else TSTUDENTS.push(r.student);
  } catch (e) { return toast(e.message); }
  toast('Đã lưu.');
}
async function addStudent() {
  const cls = $('hs-lop').value;
  const id = prompt('Số CCCD:');
  if (!id) return;
  const name = prompt('Họ và tên:');
  if (!name) return;
  try { const r = await api('saveStudent', {idNumber: id.trim(), fullName: name.trim(), className: cls, enrollYear: year()}); TSTUDENTS.push(r.student); }
  catch (e) { return toast(e.message); }
  toast('Đã thêm học sinh.');
  renderHS();
}

$('hs-lop').addEventListener('change', renderHS);
$('add-student').addEventListener('click', addStudent);
$('hs-tbody').addEventListener('click', e => {
  const btn = e.target.closest('.save-student');
  if (btn) saveStudentRow(btn.dataset.id);
});

renderHS();
