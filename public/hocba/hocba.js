/* =====================================================================
   SỔ THIẾU NHI — hocba/index.js
   Nhập điểm theo lớp/năm + trích lục học bạ + tổng hợp & xếp loại + khen thưởng.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TSTUDENTS, TSCORES, year, isExec, cur, fmt1, fillClasses, fillYearSelects, exportExcel } from '../shared/common.js';
import { searchCard, normSummary, activeStudents } from '../shared/ui.js';

await initCommon();

const SCORE_FIELDS = ['Quiz15_S1', 'Exam_S1', 'Quiz15_S2', 'Exam_S2'];
const FMAP = {'Quiz15_S1':'quiz15s1', 'Exam_S1':'exams1', 'Quiz15_S2':'quiz15s2', 'Exam_S2':'exams2'};

const [st, cl, sc] = await Promise.all([
  api('getStudents'), api('getClasses'),
  api('getScores', {schoolYear: year()})
]);
setState({TSTUDENTS: st.students || [], TCLASSES: cl.classes || [], TSCORES: sc.scores || []});
fillClasses('nh-lop', 'th-lop', 'kt-lop');
fillYearSelects('nh-nam', 'th-nam', 'kt-nam');

/* ---------- Nhập điểm ---------- */
async function renderNhap() {
  const yr = $('nh-nam').value, cls = $('nh-lop').value;
  const sts = activeStudents(cls);
  const scoreMap = {};
  if (yr === year()) {
    TSCORES.filter(s => s.SchoolYear === yr && s.ClassName === cls).forEach(s => scoreMap[s.IdNumber] = s);
  } else {
    try { const r = await api('getScores', {schoolYear: yr, className: cls}); (r.scores || []).forEach(s => scoreMap[s.IdNumber] = s); }
    catch (e) { return toast(e.message); }
  }
  const tb = $('nh-tbody');
  tb.innerHTML = sts.length
    ? sts.map((st, i) => {
        const sc = scoreMap[st.IdNumber] || {};
        return '<tr><td class="p-2 border text-center">' + (i + 1) + '</td>' +
          '<td class="p-2 border text-center">' + esc(st.IdNumber) + '</td>' +
          '<td class="p-2 border">' + esc(st.FullName) + '</td>' +
          SCORE_FIELDS.map(f => '<td class="p-2 border text-center"><input type="number" step="0.1" min="0" max="10" data-f="' + f + '" class="score-input w-16 text-center border p-1.5 rounded" value="' + (sc[f] == null ? '' : esc(sc[f])) + '"></td>').join('') +
          '</tr>';
      }).join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có học sinh trong lớp ' + esc(cls) + '.</td></tr>';
}
async function saveScores() {
  const yr = $('nh-nam').value, cls = $('nh-lop').value;
  const students = [];
  $('nh-tbody').querySelectorAll('tr').forEach(tr => {
    const id = tr.children[1].textContent.trim();
    if (!id) return;
    const o = {idNumber: id};
    tr.querySelectorAll('[data-f]').forEach(inp => { o[FMAP[inp.dataset.f]] = inp.value === '' ? '' : +inp.value; });
    students.push(o);
  });
  if (!students.length) return;
  try {
    const r = await api('saveScores', {schoolYear: yr, className: cls, students});
    if (yr === year()) setState({TSCORES: TSCORES.filter(s => !(s.SchoolYear === yr && s.ClassName === cls)).concat(r.students || [])});
  } catch (e) { return toast(e.message); }
  toast('Đã lưu điểm.');
  renderNhap();
}
async function addStudentRow() {
  const cls = $('nh-lop').value;
  const id = prompt('Số CCCD của thiếu nhi:');
  if (!id) return;
  const name = prompt('Họ và tên:');
  if (!name) return;
  try { const r = await api('saveStudent', {idNumber: id.trim(), fullName: name.trim(), className: cls, enrollYear: year()}); TSTUDENTS.push(r.student); }
  catch (e) { return toast(e.message); }
  toast('Đã thêm học sinh.');
  renderNhap();
}

/* ---------- Trích lục ---------- */
function renderHBT() { searchCard($('hbt-id').value.trim(), 'hbt-out'); }

/* ---------- Tổng hợp & khen thưởng ---------- */
async function renderTongHop() {
  const yr = $('th-nam').value, cls = $('th-lop').value;
  const showRating = cur.tier === 'Lớp';
  const heads = ['STT', 'Số CCCD', 'Họ Tên', 'Lớp', 'ĐTB HK1', 'ĐTB HK2', 'ĐTB Năm', '% Chuyên Cần'].concat(showRating ? ['Xếp Loại'] : []);
  $('th-head').innerHTML = '<tr class="bg-slate-100">' + heads.map(h => '<th class="p-2 border text-left">' + h + '</th>').join('') + '</tr>';
  let r;
  try { r = await api('getSummary', {schoolYear: yr, className: cls}); }
  catch (e) { return toast(e.message); }
  const rows = (r.summary || []).map(normSummary);
  $('th-tbody').innerHTML = rows.length
    ? rows.map((x, i) => '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border">' + esc(x.idNumber) + '</td>' +
        '<td class="p-2 border font-medium">' + esc(x.fullName) + '</td><td class="p-2 border">' + esc(x.className) + '</td>' +
        '<td class="p-2 border text-center">' + fmt1(x.h1) + '</td><td class="p-2 border text-center">' + fmt1(x.h2) + '</td>' +
        '<td class="p-2 border text-center font-bold">' + fmt1(x.avgYear) + '</td>' +
        '<td class="p-2 border text-center">' + (x.cc == null ? '—' : x.cc + '%') + '</td>' +
        (showRating ? '<td class="p-2 border text-center">' + (x.rating ? esc(x.rating) : '—') + '</td>' : '') + '</tr>').join('')
    : '<tr><td colspan="' + heads.length + '" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
  $('th-note').textContent = "ĐTB HK1 = (KT 15' + 2×KT HK1)/3 · ĐTB Năm = (HK1 + 2×HK2)/3 · Xếp loại: ≥8 Giỏi · ≥6.5 Tiên tiến · còn lại Trung bình";
}
async function toanDoan() {
  if (!isExec()) return;
  let r;
  try { r = await api('getSummary', {wholeDeanery: true}); }
  catch (e) { return toast(e.message); }
  const rows = (r.summary || []).map(normSummary).sort((a, b) => String(a.className).localeCompare(String(b.className)));
  const w = window.open('', '_blank');
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Xếp loại toàn đoàn ' + esc(year()) + '</title>' +
    '<style>body{font-family:Arial,sans-serif;padding:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.c{text-align:center}</style></head><body>' +
    '<h1>Xếp loại toàn đoàn — Năm học ' + esc(year()) + '</h1>' +
    '<table><thead><tr><th>STT</th><th>Lớp</th><th>Số CCCD</th><th>Họ Tên</th><th class="c">ĐTB HK1</th><th class="c">ĐTB HK2</th><th class="c">ĐTB Năm</th><th class="c">% Chuyên Cần</th><th>Xếp loại</th></tr></thead><tbody>' +
    rows.map((x, i) => '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(x.className) + '</td><td>' + esc(x.idNumber) + '</td><td>' + esc(x.fullName) + '</td><td class="c">' + fmt1(x.h1) + '</td><td class="c">' + fmt1(x.h2) + '</td><td class="c">' + fmt1(x.avgYear) + '</td><td class="c">' + (x.cc == null ? '—' : x.cc + '%') + '</td><td>' + (x.rating ? esc(x.rating) : '—') + '</td></tr>').join('') +
    '</tbody></table><script>window.print()<\/script></body></html>');
  w.document.close();
}
async function renderKT() {
  const yr = $('kt-nam').value, cls = $('kt-lop').value;
  let r;
  try { r = await api('getSummary', {schoolYear: yr, className: cls}); }
  catch (e) { return toast(e.message); }
  const rows = (r.summary || []).map(normSummary).filter(x => x.rating === 'Giỏi' && x.cc != null && +x.cc >= 80);
  $('kt-tbody').innerHTML = rows.length
    ? rows.map((x, i) => '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border">' + esc(x.idNumber) + '</td>' +
        '<td class="p-2 border font-medium">' + esc(x.fullName) + '</td><td class="p-2 border">' + esc(x.className) + '</td>' +
        '<td class="p-2 border text-center">' + fmt1(x.avgYear) + '</td><td class="p-2 border text-center">' + (x.cc == null ? '—' : x.cc + '%') + '</td>' +
        '<td class="p-2 border text-center text-pink-600 font-bold">🏆 Chiến sĩ của Chúa</td></tr>').join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có học sinh đạt chuẩn.</td></tr>';
}

/* ---------- Sự kiện ---------- */
$('nh-nam').addEventListener('change', renderNhap);
$('nh-lop').addEventListener('change', renderNhap);
$('add-student').addEventListener('click', addStudentRow);
$('save-scores').addEventListener('click', saveScores);
$('hbt-search').addEventListener('click', renderHBT);
$('th-nam').addEventListener('change', renderTongHop);
$('th-lop').addEventListener('change', renderTongHop);
$('th-excel').addEventListener('click', () => exportExcel('th-table', 'Tổng hợp & xếp loại'));
$('th-print').addEventListener('click', () => window.print());
$('th-toandoan').addEventListener('click', toanDoan);
$('kt-nam').addEventListener('change', renderKT);
$('kt-lop').addEventListener('change', renderKT);
$('kt-excel').addEventListener('click', () => exportExcel('kt-table', 'Danh sách khen thưởng'));
$('kt-print').addEventListener('click', () => window.print());

renderNhap(); renderTongHop(); renderKT();
