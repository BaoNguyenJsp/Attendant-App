/* =====================================================================
   SỔ THIẾU NHI — hocba/index.js
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TSTUDENTS, TSCORES, TCLASSES, year, isExec, cur, fmt1, fillClasses, fillSel, exportExcel, sortStudents } from '../shared/common.js';
import { normSummary, activeStudents } from '../shared/ui.js';

await initCommon();

const SCORE_FIELDS = ['Quiz15_S1', 'Exam_S1', 'Quiz15_S2', 'Exam_S2'];
const FMAP = {'Quiz15_S1':'quiz15s1', 'Exam_S1':'exams1', 'Quiz15_S2':'quiz15s2', 'Exam_S2':'exams2'};

const tabCache = {
  't-nhap': false,    
  't-hbt': true,     
  't-tonghop': false, 
  't-kt': false      
};

function invalidateSummaryCache() {
  tabCache['t-tonghop'] = false;
  tabCache['t-kt'] = false;
}

async function switchTab(tabId) {
  document.querySelectorAll('[data-pane]').forEach(pane => pane.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

  const targetPane = document.getElementById(tabId);
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (targetPane) targetPane.style.display = 'block';
  if (targetBtn) targetBtn.classList.add('active');

  if (!tabCache[tabId]) {
    if (tabId === 't-nhap') await renderNhap();
    else if (tabId === 't-tonghop') await renderTongHop();
    else if (tabId === 't-kt') await renderKT();
    tabCache[tabId] = true;
  }
}

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

let years = [year()];
try { 
  const r = await api('getYearOptions'); 
  if (r.years && r.years.length) years = r.years; 
} catch (e) {}

if (!years.includes(year())) years = [year(), ...years];
fillSel('th-nam', years.map(y => ({v:y})), year());
fillSel('kt-nam', years.map(y => ({v:y})), year());

/* ---------- Student Sorting Helper ---------- */
function sortSummaryRecords(records) {
  const mapped = records.map(x => {
    const id = x.idNumber || x.IdNumber;
    const baseSt = TSTUDENTS.find(s => s.IdNumber === id) || {};
    return {
      ...x,
      // Ensure lowerCamelCase properties are preserved for template rendering
      className: x.className || x.ClassName || baseSt.CurrentClass || '',
      idNumber: id,
      fullName: x.fullName || x.FullName || baseSt.FullName,
      saintName: x.saintName || x.SaintName || baseSt.SaintName,
      // Enforce PascalCase properties needed by `sortStudents` logic
      CurrentClass: x.className || x.ClassName || baseSt.CurrentClass || '',
      IdNumber: id,
      ListOrder: x.ListOrder ?? x.listOrder ?? baseSt.ListOrder,
      Gender: baseSt.Gender || baseSt.gender,
      FullName: x.fullName || x.FullName || baseSt.FullName,
      SaintName: x.saintName || x.SaintName || baseSt.SaintName
    };
  });
  
  const ordered = sortStudents(mapped);
  return ordered.map(o => mapped.find(x => (x.idNumber || x.IdNumber) === o.IdNumber) || o);
}

/* ---------- Nhập Điểm ---------- */
async function renderNhap() {
  const cls = $('nh-lop').value;
  if (!cls) return;
  const sts = sortStudents(activeStudents(cls));
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
    
    const updatedScores = (r.students || []).map(s => ({
      SchoolYear: year(),
      ClassName: cls,
      IdNumber: s.idNumber,
      Quiz15_S1: s.quiz15s1,
      Exam_S1: s.exams1,
      Quiz15_S2: s.quiz15s2,
      Exam_S2: s.exams2
    }));
    
    setState({TSCORES: TSCORES.filter(s => !(s.SchoolYear === year() && s.ClassName === cls)).concat(updatedScores)});
  } catch (e) { return toast(e.message); }
  
  toast('Đã lưu điểm.');
  invalidateSummaryCache();
  await renderNhap();
}

/* ---------- Excel Import ---------- */
function downloadTemplate() {
  const cls = $('nh-lop').value;
  const sortedSts = sortStudents(activeStudents(cls));
  const scoreMap = {};
  
  // Fetch existing scores so downloading and re-uploading doesn't wipe them
  TSCORES.filter(s => s.SchoolYear === year() && s.ClassName === cls).forEach(s => scoreMap[s.IdNumber] = s);
  
  const aoa = [['Số CCCD', 'Tên thánh', 'Họ và tên', "Điểm 15' HK1", 'Kiểm tra HK1', "Điểm 15' HK2", 'Kiểm tra HK2']];
  sortedSts.forEach(s => {
    const sc = scoreMap[s.IdNumber] || {};
    aoa.push([
      s.IdNumber, 
      s.SaintName || '', 
      s.FullName, 
      sc.Quiz15_S1 ?? '', 
      sc.Exam_S1 ?? '', 
      sc.Quiz15_S2 ?? '', 
      sc.Exam_S2 ?? ''
    ]);
  });
  
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
  
  // Safe extraction (allows alphanumeric IDs while ignoring Excel's leading zero removal)
  const keyOf = s => String(s || '').trim().replace(/^0+/, '').toLowerCase(); 
  const byId = {};
  
  $('nh-tbody').querySelectorAll('tr').forEach(tr => {
    const id = tr.children[1] ? tr.children[1].textContent.trim() : '';
    if (id) byId[keyOf(id)] = tr;
  });
  
  const errs = [], updates = []; let skipped = 0;
  rows.slice(1).forEach(r => {
    const tr = byId[keyOf(r[0])];
    if (!tr) { if (String(r[0] || '').trim()) skipped++; return; }
    
    // Replace comma with dot to support Vietnamese decimal formatting properly
    const vals = SCORE_FIELDS.map((f, i) => String(r[i + 3] == null ? '' : r[i + 3]).trim().replace(',', '.'));
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

/* ---------- TRÍCH LỤC HỌC BẠ CHUYÊN SÂU ---------- */
async function renderHBT() {
  const id = $('hbt-id').value.trim();
  if (!id) return toast('Vui lòng nhập số CCCD / Định danh');
  
  let r;
  try {
    r = await api('getHocBa', { idNumber: id });
  } catch (e) {
    return toast(e.message);
  }
  
  if (r.status === 'error') return toast(r.message);
  
  const st = r.student;
  if (!st) return toast('Không tìm thấy dữ liệu học sinh.');
  
  const records = r.history || [];
  if (r.currentRec) records.push(r.currentRec);
  
  records.sort((a, b) => String(b.SchoolYear).localeCompare(String(a.SchoolYear)));
  
  const out = $('hbt-out');
  out.innerHTML = `
    <div class="bg-white p-5 rounded-lg border border-slate-200 shadow-sm mb-4">
      <h3 class="text-lg font-bold text-blue-900 mb-2">${esc(st.SaintName || '')} ${esc(st.FullName)}</h3>
      <div class="text-sm text-slate-700 grid grid-cols-2 md:grid-cols-4 gap-2">
        <p><b>CCCD:</b> ${esc(st.IdNumber)}</p>
        <p><b>Lớp hiện tại:</b> ${esc(st.CurrentClass)}</p>
        <p><b>Trạng thái:</b> ${esc(st.Status)}</p>
        <p><b>Năm nhập học:</b> ${esc(st.EnrollYear || '—')}</p>
      </div>
    </div>
    
    <div class="tbl-scroll">
      <table class="w-full text-sm border-collapse bg-white">
        <thead>
          <tr class="bg-blue-900 text-white text-xs uppercase font-bold text-center">
            <th class="p-3">Năm Học</th>
            <th class="p-3">Lớp</th>
            <th class="p-3">ĐTB HK1</th>
            <th class="p-3">ĐTB HK2</th>
            <th class="p-3">ĐTB Năm</th>
            <th class="p-3">Chuyên Cần</th>
            <th class="p-3">Xếp Loại</th>
          </tr>
        </thead>
        <tbody>
          ${records.length ? records.map(x => `
            <tr>
              <td class="p-2 border text-center font-bold text-slate-700">${esc(x.SchoolYear)}</td>
              <td class="p-2 border text-center font-medium">${esc(x.ClassName)}</td>
              <td class="p-2 border text-center">${fmt1(x.HK1Score)}</td>
              <td class="p-2 border text-center">${fmt1(x.HK2Score)}</td>
              <td class="p-2 border text-center font-bold text-blue-800">${fmt1(x.YearScore)}</td>
              <td class="p-2 border text-center">${x.YearAttendant == null ? '—' : x.YearAttendant + '%'}</td>
              <td class="p-2 border text-center font-semibold ${x.Status === 'Giỏi' ? 'text-pink-600' : 'text-slate-700'}">${esc(x.Status || '—')}</td>
            </tr>
          `).join('') : '<tr><td colspan="7" class="p-4 text-center text-slate-400">Chưa có hồ sơ học tập.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

/* ---------- Tổng Hợp & Khen Thưởng ---------- */
async function renderTongHop() {
  const yr = $('th-nam').value, cls = $('th-lop').value;
  const showRating = cur.tier === 'Lớp';
  const heads = ['STT', 'Số CCCD', 'Họ Tên', 'Lớp', 'ĐTB HK1', 'ĐTB HK2', 'ĐTB Năm', '% Chuyên Cần'].concat(showRating ? ['Xếp Loại'] : []);
  $('th-head').innerHTML = '<tr class="bg-slate-100">' + heads.map(h => '<th class="p-2 border text-left">' + h + '</th>').join('') + '</tr>';
  let r;
  try { r = await api('getSummary', {schoolYear: yr, className: cls}); }
  catch (e) { return toast(e.message); }
  
  // BYPASS normSummary COMPLETELY - It is destroying the data keys
  const rows = sortSummaryRecords(r.summary || []);

  $('th-tbody').innerHTML = rows.length
    ? rows.map((x, i) => {
        const id = x.IdNumber || x.idNumber || '';
        const fullName = [x.SaintName || x.saintName, x.FullName || x.fullName].filter(Boolean).join(' ');
        const cName = x.CurrentClass || x.ClassName || x.className || '';

        const h1 = x.HK1Score ?? x.avgH1 ?? x.h1;
        const h2 = x.HK2Score ?? x.avgH2 ?? x.h2;
        const avg = x.YearScore ?? x.avgYear;
        const cc = x.YearAttendant ?? x.pct ?? x.cc;
        const rt = x.Status ?? x.rating;

        return '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border">' + esc(id) + '</td>' +
          '<td class="p-2 border font-medium">' + esc(fullName) + '</td><td class="p-2 border">' + esc(cName) + '</td>' +
          '<td class="p-2 border text-center">' + fmt1(h1) + '</td><td class="p-2 border text-center">' + fmt1(h2) + '</td>' +
          '<td class="p-2 border text-center font-bold">' + fmt1(avg) + '</td>' +
          '<td class="p-2 border text-center">' + (cc == null || cc === '' ? '—' : cc + '%') + '</td>' +
          (showRating ? '<td class="p-2 border text-center">' + (rt ? esc(rt) : '—') + '</td>' : '') + '</tr>';
      }).join('')
    : '<tr><td colspan="' + heads.length + '" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}

async function toanDoan() {
  if (!isExec()) return;
  let r;
  try { r = await api('getSummary', {schoolYear: year(), wholeDeanery: true}); }
  catch (e) { return toast(e.message); }
  
  // BYPASS normSummary COMPLETELY
  const rows = sortSummaryRecords(r.summary || []);
  
  const w = window.open('', '_blank');
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Xếp loại toàn đoàn ' + esc(year()) + '</title>' +
    '<style>body{font-family:Arial,sans-serif;padding:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.c{text-align:center}</style></head><body>' +
    '<h1>Xếp loại toàn đoàn — Năm học ' + esc(year()) + '</h1>' +
    '<table><thead><tr><th>STT</th><th>Lớp</th><th>Số CCCD</th><th>Họ Tên</th><th class="c">ĐTB HK1</th><th class="c">ĐTB HK2</th><th class="c">ĐTB Năm</th><th class="c">% Chuyên Cần</th><th>Xếp loại</th></tr></thead><tbody>' +
    rows.map((x, i) => {
        const id = x.IdNumber || x.idNumber || '';
        const fullName = [x.SaintName || x.saintName, x.FullName || x.fullName].filter(Boolean).join(' ');
        const cName = x.CurrentClass || x.ClassName || x.className || '';

        const h1 = x.HK1Score ?? x.avgH1 ?? x.h1;
        const h2 = x.HK2Score ?? x.avgH2 ?? x.h2;
        const avg = x.YearScore ?? x.avgYear;
        const cc = x.YearAttendant ?? x.pct ?? x.cc;
        const rt = x.Status ?? x.rating;

        return '<tr><td class="c">' + (i + 1) + '</td><td>' + esc(cName) + '</td><td>' + esc(id) + '</td><td>' + esc(fullName) + '</td><td class="c">' + fmt1(h1) + '</td><td class="c">' + fmt1(h2) + '</td><td class="c">' + fmt1(avg) + '</td><td class="c">' + (cc == null || cc === '' ? '—' : cc + '%') + '</td><td>' + (rt ? esc(rt) : '—') + '</td></tr>';
    }).join('') +
    '</tbody></table><script>window.print()<\/script></body></html>');
  w.document.close();
}

async function renderKT() {
  const yr = $('kt-nam').value, cls = $('kt-lop').value;
  let r;
  try { r = await api('getSummary', {schoolYear: yr, className: cls}); }
  catch (e) { return toast(e.message); }
  
  // BYPASS normSummary COMPLETELY
  const rawRows = (r.summary || []).filter(x => {
      const rt = x.Status ?? x.rating;
      const cc = x.YearAttendant ?? x.pct ?? x.cc;
      return rt === 'Giỏi' && cc != null && +cc >= 80;
  });
  const rows = sortSummaryRecords(rawRows);

  $('kt-tbody').innerHTML = rows.length
    ? rows.map((x, i) => {
        const id = x.IdNumber || x.idNumber || '';
        const fullName = [x.SaintName || x.saintName, x.FullName || x.fullName].filter(Boolean).join(' ');
        const cName = x.CurrentClass || x.ClassName || x.className || '';

        const avg = x.YearScore ?? x.avgYear;
        const cc = x.YearAttendant ?? x.pct ?? x.cc;

        return '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border">' + esc(id) + '</td>' +
          '<td class="p-2 border font-medium">' + esc(fullName) + '</td><td class="p-2 border">' + esc(cName) + '</td>' +
          '<td class="p-2 border text-center">' + fmt1(avg) + '</td><td class="p-2 border text-center">' + (cc == null || cc === '' ? '—' : cc + '%') + '</td>' +
          '<td class="p-2 border text-center text-pink-600 font-bold">Giỏi</td></tr>';
      }).join('')
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

/* Boot default active tab */
switchTab('t-nhap');