/* =====================================================================
   SỔ THIẾU NHI — academics/academics.js
   Enter scores (UC-C1), import scores (UC-C2), record lookup (UC-C3),
   summary and rating (UC-C4), awards (UC-C5).
   ===================================================================== */
'use strict';

import {
  initCommon, load, state, $, api, esc, toast, fillSel, fillClasses, setupTabs, sortStudents, exportExcel,
  isExec, canWriteClass, className, personName, fmt1,
} from '../shared/common.js';
import { RATING_LABEL } from '../shared/labels.js';
import { matchesStudent, idKey } from '../shared/search.js';
import { parseScore } from '../shared/scores.js';
import { printDocument } from '../shared/ui.js';

await initCommon();
await load('students', 'classes');

const FIELDS = ['quizS1', 'examS1', 'quizS2', 'examS2'];
const allClasses = state.classes.map((c) => ({ v: c.id, t: c.name }));
fillClasses('sc-class');
fillSel('sum-class', allClasses);
fillSel('aw-class', allClasses);

let years = [state.year];
try { years = (await api('getYearOptions')).years; } catch { /* the current year alone */ }
fillSel('sum-year', years.map((y) => ({ v: y })), state.year);

const percentCell = (v) => (v == null ? '—' : `${v}%`);
const ratingCell = (code) => esc(RATING_LABEL[code] ?? '—');
const blocked = () => toast('Trình duyệt chặn cửa sổ pop-up. Vui lòng cho phép pop-up cho trang này rồi thử lại.');

/* ---------- Tab 1: enter scores ---------- */
// What the server holds for the class on screen: studentId -> { quizS1, examS1, quizS2, examS2 } (null = blank).
let base = new Map();
const BLANK = Object.fromEntries(FIELDS.map((f) => [f, null]));
const inputsOf = (row) => [...row.querySelectorAll('.score-input')];

async function renderScores() {
  const classId = Number($('sc-class').value);
  if (!classId) return;
  let scores;
  try { scores = (await api('getScores', { classId })).scores; } catch (e) { return toast(e.message); }
  const editable = canWriteClass(classId);
  for (const id of ['sc-save', 'sc-file-label', 'sc-template']) $(id).style.display = editable ? '' : 'none';
  const students = sortStudents(state.students.filter((s) => s.classId === classId && s.status === 'ACTIVE'));
  base = new Map(students.map((s) => [s.id, { ...BLANK }]));
  for (const { studentId, ...values } of scores) if (base.has(studentId)) base.set(studentId, values);
  $('sc-tbody').innerHTML = students.length
    ? students.map((s, i) => `<tr data-id="${s.id}"><td class="p-2 border text-center">${i + 1}</td>`
      + `<td class="p-2 border text-center">${esc(s.idNumber)}</td><td class="p-2 border">${esc(personName(s))}</td>`
      // A text field, so that a decimal comma can be typed; 0 is shown as 0, blank as blank.
      + FIELDS.map((f) => `<td class="p-2 border text-center"><input type="text" inputmode="decimal" data-f="${f}" class="score-input w-16 text-center border p-1.5 rounded" value="${base.get(s.id)[f] ?? ''}"${editable ? '' : ' disabled'}></td>`).join('')
      + '</tr>').join('')
    : `<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có Thiếu nhi trong lớp ${esc(className(classId))}.</td></tr>`;
}

// Marks an invalid cell in red. Returns the parsed value (undefined when invalid).
function check(input) {
  const value = parseScore(input.value);
  input.classList.toggle('border-red-500', value === undefined);
  input.classList.toggle('bg-red-50', value === undefined);
  return value;
}

// Reads the table: { invalid: names of students with a bad cell, changed: students whose scores differ from the server }.
function readScores() {
  const invalid = [];
  const changed = [];
  for (const row of $('sc-tbody').querySelectorAll('tr[data-id]')) {
    const studentId = Number(row.dataset.id);
    const values = Object.fromEntries(inputsOf(row).map((input) => [input.dataset.f, check(input)]));
    if (Object.values(values).includes(undefined)) invalid.push(row.children[2].textContent);
    else if (FIELDS.some((f) => values[f] !== base.get(studentId)[f])) changed.push({ studentId, ...values });
  }
  return { invalid, changed };
}

async function saveScores() {
  const { invalid, changed } = readScores();
  // An invalid score blocks the save until it is corrected.
  if (invalid.length) return toast(`Điểm phải từ 0 đến 10 — kiểm tra lại: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}`);
  if (!changed.length) return toast('Không có thay đổi để lưu.');
  try {
    await api('saveScores', { classId: Number($('sc-class').value), scores: changed });
    for (const { studentId, ...values } of changed) base.set(studentId, values);
    toast(`Đã lưu điểm của ${changed.length} Thiếu nhi.`);
  } catch (e) { toast(e.message); }
}

/* ---------- Excel import of scores ---------- */
const COLUMNS = { quizS1: "Điểm 15' HK1", examS1: 'Kiểm tra HK1', quizS2: "Điểm 15' HK2", examS2: 'Kiểm tra HK2' };

function downloadTemplate() {
  const classId = Number($('sc-class').value);
  const students = sortStudents(state.students.filter((s) => s.classId === classId && s.status === 'ACTIVE'));
  const rows = [['Số CCCD', 'Tên thánh', 'Họ và tên', ...Object.values(COLUMNS)], ...students.map((s) => [s.idNumber, s.saintName ?? '', s.fullName, ...FIELDS.map((f) => base.get(s.id)?.[f] ?? '')])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // CCCD as text, so leading zeros survive.
  students.forEach((s, i) => { ws[`A${i + 2}`] = { t: 's', v: s.idNumber }; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Điểm');
  XLSX.writeFile(wb, `Khung_nhap_diem_${className(classId)}.xlsx`);
}

async function importScores() {
  const file = $('sc-file').files[0];
  $('sc-file').value = '';
  if (!file) return;
  let sheet;
  try {
    const wb = XLSX.read(await file.arrayBuffer());
    sheet = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch { return toast('Không đọc được file Excel.'); }

  const rowByKey = new Map([...$('sc-tbody').querySelectorAll('tr[data-id]')].map((row) => [idKey(row.children[1].textContent), row]));
  const fills = [];
  const invalid = [];
  let skipped = 0;
  for (const r of sheet) {
    const row = rowByKey.get(idKey(r['Số CCCD']));
    if (!row) { skipped += 1; continue; } // a CCCD that is not in this class
    const values = Object.fromEntries(FIELDS.map((f) => [f, parseScore(r[COLUMNS[f]])]));
    if (Object.values(values).includes(undefined)) invalid.push(row.children[2].textContent);
    else fills.push({ row, values });
  }
  // The same check as typing: one invalid value and nothing is imported.
  if (invalid.length) return toast(`Điểm phải từ 0 đến 10 — không nhập gì. Kiểm tra: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}`);
  if (!fills.length) return toast('Không có dòng nào khớp số CCCD của lớp này.');
  // A 0 in the file is kept as 0; a blank cell stays blank.
  for (const { row, values } of fills) for (const input of inputsOf(row)) input.value = values[input.dataset.f] ?? '';
  await saveScores();
  if (skipped) toast(`Đã nhập ${fills.length} dòng; bỏ qua ${skipped} dòng không thuộc lớp.`);
}

/* ---------- Tab 2: academic record (exact match, every match shown) ---------- */
const recordRow = (r) => `<tr><td class="p-2 border text-center">${esc(r.schoolYear)}</td><td class="p-2 border text-center">${esc(r.className)}</td>`
  + `<td class="p-2 border text-center">${fmt1(r.semester1Avg)}</td><td class="p-2 border text-center">${fmt1(r.semester2Avg)}</td>`
  + `<td class="p-2 border text-center font-bold">${fmt1(r.yearAvg)}</td><td class="p-2 border text-center">${percentCell(r.attendancePct)}</td>`
  + `<td class="p-2 border text-center">${ratingCell(r.rating)}</td></tr>`;

async function renderRecord() {
  const query = $('rec-query').value;
  const out = $('rec-out');
  if (!query.trim()) { out.innerHTML = '<p class="text-amber-600 font-medium">Nhập đúng họ tên (có dấu) hoặc số CCCD của Thiếu nhi.</p>'; return; }
  const hits = state.students.filter((s) => matchesStudent(s, query));
  if (!hits.length) { out.innerHTML = '<p class="text-amber-600 font-medium">Không tìm thấy Thiếu nhi nào khớp chính xác.</p>'; return; }

  const cards = await Promise.all(hits.map(async (s) => {
    let r;
    try { r = await api('getStudentRecord', { studentId: s.id }); } catch (e) { return `<div class="p-4 text-red-500">Lỗi tải dữ liệu của ${esc(s.fullName)}: ${esc(e.message)}</div>`; }
    const lines = [...(r.current ? [r.current] : []), ...r.history];
    const tableId = `rec-table-${s.id}`;
    const info = (label, value) => `<div><dt class="text-xs font-bold text-slate-500 uppercase">${label}</dt><dd class="font-semibold">${esc(value ?? '')}</dd></div>`;
    return '<div class="mb-8"><div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 flex justify-between items-start flex-wrap gap-4"><div>'
      + `<h3 class="text-lg font-extrabold text-blue-900">${esc(personName(r.student))}</h3>`
      + `<dl class="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm mt-2">${info('Số CCCD', r.student.idNumber)}${info('Lớp hiện tại', r.student.className)}${info('Năm nhập học', r.student.enrollYear)}</dl></div>`
      + `<button type="button" class="export-record bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm flex-shrink-0" data-table="${tableId}" data-name="${esc(s.fullName)}">⬇ Excel</button></div>`
      + `<div style="overflow-x:auto"><table id="${tableId}" class="w-full text-sm border-collapse min-w-[640px]"><thead><tr class="bg-blue-900 text-white text-xs uppercase font-bold text-center">`
      + ['Năm học', 'Lớp', 'ĐTB HK1', 'ĐTB HK2', 'ĐTB Năm', '% Chuyên Cần', 'Xếp loại'].map((h) => `<th class="p-3 border">${h}</th>`).join('')
      + `</tr></thead><tbody>${lines.length ? lines.map(recordRow).join('') : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có dữ liệu học bạ.</td></tr>'}</tbody></table></div></div>`;
  }));
  out.innerHTML = cards.join('<hr class="my-8 border-slate-300 border-dashed border-t-2" />');
}

/* ---------- Tab 3: summary and rating ---------- */
const report = (classId, schoolYear) => api('getClassReport', { classId, schoolYear }).then((r) => sortStudents(r.rows));

async function renderSummary() {
  // "Xếp Loại" is shown to every user.
  $('sum-head').innerHTML = ['STT', 'Số CCCD', 'Họ Tên', 'Lớp', 'ĐTB HK1', 'ĐTB HK2', 'ĐTB Năm', '% Chuyên Cần', 'Xếp Loại'].map((h) => `<th class="p-3">${h}</th>`).join('');
  let rows;
  try { rows = await report(Number($('sum-class').value), $('sum-year').value); } catch (e) { return toast(e.message); }
  $('sum-tbody').innerHTML = rows.length
    ? rows.map((x, i) => `<tr><td class="p-2 border text-center">${i + 1}</td><td class="p-2 border">${esc(x.idNumber)}</td>`
      + `<td class="p-2 border font-medium">${esc(personName(x))}</td><td class="p-2 border">${esc(x.className)}</td>`
      + `<td class="p-2 border text-center">${fmt1(x.semester1Avg)}</td><td class="p-2 border text-center">${fmt1(x.semester2Avg)}</td>`
      + `<td class="p-2 border text-center font-bold">${fmt1(x.yearAvg)}</td><td class="p-2 border text-center">${percentCell(x.attendancePct)}</td>`
      + `<td class="p-2 border text-center">${ratingCell(x.rating)}</td></tr>`).join('')
    : '<tr><td colspan="9" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
  $('sum-note').textContent = $('sum-year').value === state.year ? 'Năm học hiện tại: số liệu tính trực tiếp từ điểm và điểm danh.' : 'Năm học cũ: số liệu lấy từ học bạ đã lưu khi chuyển năm.';
}

// Print layout with signature lines: one class, or the whole parish (BQT ngành and above).
async function printRanking(wholeParish) {
  const schoolYear = $('sum-year').value;
  const classId = Number($('sum-class').value);
  let rows;
  try { rows = wholeParish ? (await api('getClassReport', { schoolYear })).rows : await report(classId, schoolYear); } catch (e) { return toast(e.message); }
  if (!rows.length) return toast('Không có dữ liệu để in.');
  const body = rows.map((x, i) => `<tr><td>${i + 1}</td>${wholeParish ? `<td>${esc(x.className)}</td>` : ''}<td>${esc(x.idNumber)}</td><td>${esc(personName(x))}</td>`
    + `<td>${fmt1(x.semester1Avg)}</td><td>${fmt1(x.semester2Avg)}</td><td><strong>${fmt1(x.yearAvg)}</strong></td><td>${percentCell(x.attendancePct)}</td><td><strong>${ratingCell(x.rating)}</strong></td></tr>`).join('');
  const head = ['STT', ...(wholeParish ? ['Lớp'] : []), 'Số CCCD', 'Họ và Tên', 'Đ. HK1', 'Đ. HK2', 'Cả Năm', 'Chuyên Cần', 'Xếp Loại'].map((h) => `<th>${h}</th>`).join('');
  const opened = printDocument({
    title: wholeParish ? 'BẢNG TỔNG KẾT VÀ XẾP LOẠI TOÀN ĐOÀN' : 'BẢNG TỔNG KẾT VÀ XẾP LOẠI HỌC TẬP',
    subtitle: `${wholeParish ? '' : `Lớp: <b>${esc(className(classId))}</b> &nbsp;|&nbsp; `}Năm học: <b>${esc(schoolYear)}</b>`,
    tableHtml: `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
    leftSignature: wholeParish ? 'Ban Điều Hành' : 'Giáo lý viên phụ trách',
    leftColumn: wholeParish ? 4 : 3,
  });
  if (!opened) blocked();
}

/* ---------- Tab 4: awards ---------- */
async function renderAwards() {
  let rows;
  try { rows = await report(Number($('aw-class').value), state.year); } catch (e) { return toast(e.message); }
  // Year average of at least 8 and attendance of at least 80 %.
  const awarded = rows.filter((x) => x.yearAvg !== null && x.yearAvg >= 8 && x.attendancePct >= 80);
  $('aw-tbody').innerHTML = awarded.length
    ? awarded.map((x, i) => `<tr><td class="p-2 border text-center">${i + 1}</td><td class="p-2 border">${esc(x.idNumber)}</td>`
      + `<td class="p-2 border font-medium">${esc(personName(x))}</td><td class="p-2 border">${esc(x.className)}</td>`
      + `<td class="p-2 border text-center font-bold">${fmt1(x.yearAvg)}</td><td class="p-2 border text-center">${percentCell(x.attendancePct)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="p-4 text-center text-slate-400">Chưa có Thiếu nhi đạt điều kiện khen thưởng.</td></tr>';
}

function printAwards() {
  const table = $('aw-table');
  if (!table.querySelector('tbody td:not([colspan])')) return toast('Chưa có dữ liệu để in.');
  const opened = printDocument({
    title: 'DANH SÁCH KHEN THƯỞNG',
    subtitle: `Lớp: <b>${esc(className($('aw-class').value))}</b> &nbsp;|&nbsp; Năm học: <b>${esc(state.year)}</b>`,
    tableHtml: table.outerHTML,
    leftSignature: 'Giáo lý viên phụ trách',
    leftColumn: 3,
  });
  if (!opened) blocked();
}

/* ---------- Events ---------- */
$('sc-class').addEventListener('change', renderScores);
$('sc-save').addEventListener('click', saveScores);
$('sc-template').addEventListener('click', (e) => { e.preventDefault(); downloadTemplate(); });
$('sc-file').addEventListener('change', importScores);
$('sc-tbody').addEventListener('input', (e) => { if (e.target.classList.contains('score-input')) check(e.target); });

$('rec-search').addEventListener('click', renderRecord);
$('rec-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') renderRecord(); });
$('rec-out').addEventListener('click', (e) => {
  const button = e.target.closest('.export-record');
  if (button) exportExcel(button.dataset.table, `Hoc_ba_${button.dataset.name}`);
});

$('sum-year').addEventListener('change', renderSummary);
$('sum-class').addEventListener('change', renderSummary);
$('sum-excel').addEventListener('click', () => exportExcel('sum-table', 'Tổng hợp & xếp loại'));
$('sum-print').addEventListener('click', () => printRanking(false));
$('sum-parish').addEventListener('click', () => (isExec() ? printRanking(true) : toast('Xếp loại toàn đoàn cần quyền BQT ngành.')));

$('aw-class').addEventListener('change', renderAwards);
$('aw-excel').addEventListener('click', () => exportExcel('aw-table', 'Danh sách khen thưởng'));
$('aw-print').addEventListener('click', printAwards);

/* ---------- Start ---------- */
const showTab = setupTabs({ 't-scores': renderScores, 't-summary': renderSummary, 't-awards': renderAwards });
showTab('t-scores');
