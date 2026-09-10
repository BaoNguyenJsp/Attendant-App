/* =====================================================================
   SỔ THIẾU NHI — hocba/index.js
   Nhập điểm theo lớp (năm hiện tại) + trích lục học bạ + tổng hợp & xếp loại + khen thưởng.
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TSTUDENTS, TSCORES, TCLASSES, year, isExec, cur, fmt1, fillClasses, fillSel, exportExcel } from '../shared/common.js';
import { searchCard, normSummary, activeStudents } from '../shared/ui.js';

await initCommon();

const SCORE_FIELDS = ['Quiz15_S1', 'Exam_S1', 'Quiz15_S2', 'Exam_S2'];
const FMAP = {'Quiz15_S1':'quiz15s1', 'Exam_S1':'exams1', 'Quiz15_S2':'quiz15s2', 'Exam_S2':'exams2'};

/* ---------- Tab Cache & Lazy Loading Engine ---------- */
const tabCache = {
  't-nhap': false,    // Updated key to match HTML data-tab="t-nhap"
  't-hbt': true,     // Manual search tab
  't-tonghop': false, // Updated key to match HTML data-tab="t-tonghop"
  't-kt': false      // Khen thưởng tab
};

function invalidateSummaryCache() {
  tabCache['t-tonghop'] = false;
  tabCache['t-kt'] = false;
}

async function switchTab(tabId) {
  // 1. Update UI pane display and button active states
  document.querySelectorAll('[data-pane]').forEach(pane => pane.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (targetPane) targetPane.style.display = 'block';
  if (targetBtn) targetBtn.classList.add('active');

  // 2. Fetch data only if tab is dirty or not loaded yet
  if (!tabCache[tabId]) {
    if (tabId === 't-nhap') await renderNhap();
    else if (tabId === 't-tonghop') await renderTongHop();
    else if (tabId === 't-kt') await renderKT();
    tabCache[tabId] = true;
  }
}

// Bind click events to tab navigation buttons
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
});

/* ---------- Data Initialization ---------- */
const [st, cl, sc] = await Promise.all([
  api('getStudents'), 
  api('getClasses'),
  api('getScores', {schoolYear: year()})
]);

setState({TSTUDENTS: st.students || [], TCLASSES: cl.classes || [], TSCORES: sc.scores || []});
fillClasses('nh-lop', 'th-lop', 'kt-lop');
if ($('nh-year')) $('nh-year').textContent = year();

// Populate school years
let years = [year()];
try { 
  const r = await api('getYearOptions'); 
  if (r.years && r.years.length) years = r.years; 
} catch (e) {}

if (!years.includes(year())) years = [year(), ...years];
fillSel('th-nam', years.map(y => ({v:y})), year());
fillSel('kt-nam', years.map(y => ({v:y})), year());

/* Sort helper for summary data */
const clsOrd = {}; 
TCLASSES.forEach((c, i) => clsOrd[c.ClassName] = i);
const keyId = s => String(s || '').replace(/^['0]+/, '');
const gMap = {};

TSTUDENTS.forEach(st => { 
  const g = String(st.Gender || '').normalize('NFC').trim().toLowerCase(); 
  gMap[keyId(st.IdNumber)] = g === 'nữ' ? 0 : g === 'nam' ? 1 : 2; 
});

const sumSort = (a, b) => (clsOrd[a.className] ?? 1e9) - (clsOrd[b.className] ?? 1e9)
  || (gMap[keyId(a.idNumber)] ?? 2) - (gMap[keyId(b.idNumber)] ?? 2)
  || String(a.fullName || '').localeCompare(String(b.fullName || ''), 'vi');

/* ---------- Nhập điểm ---------- */
async function renderNhap() {
  const cls = $('nh-lop').value;
  if (!cls) return;
  const sts = activeStudents(cls);
  const scoreMap = {};
  TSCORES.filter(s => s.SchoolYear === year() && s.ClassName === cls).forEach(s => scoreMap[s.IdNumber] = s);
  const tb = $('nh-tbody');
  if (!tb) return;
  
  tb.innerHTML = sts.length
    ? sts.map((st, i) => {
        const sc = scoreMap[st.IdNumber] || {};
        return '<tr><td class="p-2 border text-center">' + (i + 1) + '</td>' +
          '<td class="p-2 border text-center">' + esc(st.IdNumber) + '</td>' +
          '<td class="p-2 border">' + esc([st.SaintName, st.FullName].filter(Boolean).join(' ')) + '</td>' +
          SCORE_FIELDS.map(f => '<td class="p-2 border text-center"><input type="number" step="0.1" min="0" max="10" data-f="' + f + '" class="score-input w-16 text-center border p-1.5 rounded" value="' + (sc[f] == null ? '' : esc(sc[f])) + '"></td>').join('') +
          '</tr>';
      }).join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có Thiếu nhi trong lớp ' + esc(cls) + '.</td></tr>';
}

async function saveScores() {
  const cls = $('nh-lop').value;
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
    const r = await api('saveScores', {schoolYear: year(), className: cls, students});
    setState({TSCORES: TSCORES.filter(s => !(s.SchoolYear === year() && s.ClassName === cls)).concat(r.students || [])});
  } catch (e) { return toast(e.message); }
  toast('Đã lưu điểm.');
  invalidateSummaryCache();
  await renderNhap();
}

/* ---------- Excel Import ---------- */
function downloadTemplate() {
  const cls = $('nh-lop').value;
  const aoa = [['Số CCCD', 'Tên thánh', 'Họ và tên', "Điểm 15' HK1", 'Kiểm tra HK1', "Điểm 15' HK2", 'Kiểm tra HK2']];
  activeStudents(cls).forEach(s => aoa.push([s.IdNumber, s.SaintName || '', s.FullName, '', '', '', '']));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Điểm');
  XLSX.writeFile(wb, 'Khung_nhap_diem_' + cls + '.xlsx');
}

async function importScores() {
  const f = $('nh-file').files[0];
  $('nh-file').value = '';
  if (!f) return;
  let ws;
  try { const wb = XLSX.read(await f.arrayBuffer()); ws = wb.Sheets[wb.SheetNames[0]]; }
  catch (e) { return toast('Không đọc được file Excel.'); }
  const rows = XLSX.utils.sheet_to_json(ws, {header: 1, defval: ''});
  const keyOf = s => String(s || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
  const byId = {};
  $('nh-tbody').querySelectorAll('tr').forEach(tr => {
    const id = tr.children[1] ? tr.children[1].textContent.trim() : '';
    if (id) byId[keyOf(id)] = tr;
  });
  const errs = [], updates = []; let skipped = 0;
  rows.slice(1).forEach(r => {
    const tr = byId[keyOf(r[0])];
    if (!tr) { if (String(r[0] || '').trim()) skipped++; return; }
    const vals = SCORE_FIELDS.map((f, i) => String(r[i + 3] == null ? '' : r[i + 3]).trim());
    if (vals.some(v => v !== '' && (isNaN(+v) || +v < 0 || +v > 10))) {
      const who = tr.children[2] ? tr.children[2].textContent.trim() : tr.children[1].textContent.trim();
      errs.push(who);
    } else updates.push({tr, vals});
  });
  if (errs.length) return toast('Điểm không hợp lệ (0–10): ' + errs.slice(0, 3).join(', ') + (errs.length > 3 ? '…' : '') + '. Chưa lưu gì.');
  if (!updates.length) return toast(skipped ? 'Không có CCCD nào trong file thuộc lớp này.' : 'File không có dòng điểm nào.');
  updates.forEach(({tr, vals}) => tr.querySelectorAll('[data-f]').forEach((inp, i) => { inp.value = vals[i]; }));
  const msg = skipped ? ' — bỏ qua ' + skipped + ' CCCD không thuộc lớp.' : '';
  toast('Đã nhập ' + updates.length + ' Thiếu nhi' + msg);
  await saveScores();
}

/* ---------- Trích lục ---------- */
function renderHBT() { searchCard($('hbt-id').value.trim(), 'hbt-out'); }

/* ---------- Tổng hợp & Khen thưởng ---------- */
async function renderTongHop() {
  const yr = $('th-nam').value, cls = $('th-lop').value;
  const showRating = cur.tier === 'Lớp';
  const heads = ['STT', 'Số CCCD', 'Họ Tên', 'Lớp', 'ĐTB HK1', 'ĐTB HK2', 'ĐTB Năm', '% Chuyên Cần'].concat(showRating ? ['Xếp Loại'] : []);
  $('th-head').innerHTML = '<tr class="bg-slate-100">' + heads.map(h => '<th class="p-2 border text-left">' + h + '</th>').join('') + '</tr>';
  let r;
  try { r = await api('getSummary', {schoolYear: yr, className: cls}); }
  catch (e) { return toast(e.message); }
  const rows = (r.summary || []).map(normSummary).sort(sumSort);
  $('th-tbody').innerHTML = rows.length
    ? rows.map((x, i) => '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border">' + esc(x.idNumber) + '</td>' +
        '<td class="p-2 border font-medium">' + esc(x.fullName) + '</td><td class="p-2 border">' + esc(x.className) + '</td>' +
        '<td class="p-2 border text-center">' + fmt1(x.h1) + '</td><td class="p-2 border text-center">' + fmt1(x.h2) + '</td>' +
        '<td class="p-2 border text-center font-bold">' + fmt1(x.avgYear) + '</td>' +
        '<td class="p-2 border text-center">' + (x.cc == null ? '—' : x.cc + '%') + '</td>' +
        (showRating ? '<td class="p-2 border text-center">' + (x.rating ? esc(x.rating) : '—') + '</td>' : '') + '</tr>').join('')
    : '<tr><td colspan="' + heads.length + '" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}

async function toanDoan() {
  if (!isExec()) return;
  let r;
  try { r = await api('getSummary', {wholeDeanery: true}); }
  catch (e) { return toast(e.message); }
  const rows = (r.summary || []).map(normSummary).sort(sumSort);
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
  const rows = (r.summary || []).map(normSummary).filter(x => x.rating === 'Giỏi' && x.cc != null && +x.cc >= 80).sort(sumSort);
  $('kt-tbody').innerHTML = rows.length
    ? rows.map((x, i) => '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border">' + esc(x.idNumber) + '</td>' +
        '<td class="p-2 border font-medium">' + esc(x.fullName) + '</td><td class="p-2 border">' + esc(x.className) + '</td>' +
        '<td class="p-2 border text-center">' + fmt1(x.avgYear) + '</td><td class="p-2 border text-center">' + (x.cc == null ? '—' : x.cc + '%') + '</td>' +
        '<td class="p-2 border text-center text-pink-600 font-bold">Giỏi</td></tr>').join('')
    : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có Thiếu nhi đạt chuẩn.</td></tr>';
}

/* ---------- Events ---------- */
$('nh-lop').addEventListener('change', async () => { tabCache['t-nhap'] = false; await renderNhap(); tabCache['t-nhap'] = true; });
$('save-scores').addEventListener('click', saveScores);
$('nh-template').addEventListener('click', e => { e.preventDefault(); downloadTemplate(); });
$('nh-file').addEventListener('change', importScores);

$('hbt-search').addEventListener('click', renderHBT);

$('th-nam').addEventListener('change', async () => { tabCache['t-tonghop'] = false; await renderTongHop(); tabCache['t-tonghop'] = true; });
$('th-lop').addEventListener('change', async () => { tabCache['t-tonghop'] = false; await renderTongHop(); tabCache['t-tonghop'] = true; });
$('th-excel').addEventListener('click', () => exportExcel('th-table', 'Tổng hợp & xếp loại'));
$('th-print').addEventListener('click', () => window.print());

const btnToanDoan = $('th-toandoan');
if (btnToanDoan) btnToanDoan.addEventListener('click', toanDoan);

$('kt-nam').addEventListener('change', async () => { tabCache['t-kt'] = false; await renderKT(); tabCache['t-kt'] = true; });
$('kt-lop').addEventListener('change', async () => { tabCache['t-kt'] = false; await renderKT(); tabCache['t-kt'] = true; });
$('kt-excel').addEventListener('click', () => exportExcel('kt-table', 'Danh sách khen thưởng'));
$('kt-print').addEventListener('click', () => window.print());

/* Boot: Loads active default tab 't-nhap' strictly on initialization */
switchTab('t-nhap');