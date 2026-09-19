/* =====================================================================
   SỔ THIẾU NHI — hocba/index.js
   ===================================================================== */
'use strict';

import { initCommon, $, api, esc, toast, setState, TSTUDENTS, TSCORES, TCLASSES, year, isExec, cur, fmt1, fillClasses, fillSel, exportExcel, sortStudents , toIsoDate } from '../shared/common.js';
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
fillClasses('nh-lop');
const allClassItems = TCLASSES.map(c => ({ v: c.ClassName || c.className }));
if ($('th-lop')) fillSel('th-lop', allClassItems);
if ($('kt-lop')) fillSel('kt-lop', allClassItems);
if ($('nh-year'))$('nh-year').textContent = year();

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
      className: x.className || x.ClassName || baseSt.CurrentClass || '',
      idNumber: id,
      fullName: x.fullName || x.FullName || baseSt.FullName,
      saintName: x.saintName || x.SaintName || baseSt.SaintName,
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
  const f = $('nh-file').files[0];$('nh-file').value = '';
  if (!f) return;
  let ws;
  try { const wb = XLSX.read(await f.arrayBuffer()); ws = wb.Sheets[wb.SheetNames[0]]; }
  catch (e) { return toast('Không đọc được file Excel.'); }
  const rows = XLSX.utils.sheet_to_json(ws, {header: 1, defval: ''});
  
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
  const q = $('hbt-id').value.trim().toLowerCase();
  if (!q) return toast('Vui lòng nhập tên, tên thánh hoặc CCCD');
  
  const hits = TSTUDENTS.filter(s => 
    (s.FullName && s.FullName.toLowerCase().includes(q)) || 
    (s.IdNumber && s.IdNumber.toLowerCase().includes(q)) || 
    (s.SaintName && s.SaintName.toLowerCase().includes(q))
  ).slice(0, 10);
  
  const out = $('hbt-out');
  
  if (hits.length === 0) {
    return out.innerHTML = '<div class="p-4 text-center text-amber-600 font-medium">Không tìm thấy Thiếu nhi nào phù hợp.</div>';
  }

  out.innerHTML = '<div class="p-4 text-center text-blue-600 font-medium animate-pulse">Đang tra cứu dữ liệu...</div>';

  try {
    const resultsHtml = await Promise.all(hits.map(async (st) => {
      let r;
      try {
        r = await api('getHocBa', { idNumber: st.IdNumber });
      } catch (e) {
        return `<div class="p-4 text-red-500">Lỗi tải dữ liệu cho ${esc(st.FullName)}: ${esc(e.message)}</div>`;
      }
      
      if (r.status === 'error') return `<div class="p-4 text-red-500">${esc(r.message)}</div>`;
      
      const fetchedSt = r.student || st;
      const records = r.history || [];
      if (r.currentRec) records.push(r.currentRec);
      
      records.sort((a, b) => String(b.SchoolYear).localeCompare(String(a.SchoolYear)));
      
      const safeId = esc(fetchedSt.IdNumber).replace(/[^a-zA-Z0-9]/g, '');
      const tableId = 'hbt-table-' + safeId;
      const displayFullName = esc((fetchedSt.SaintName ? fetchedSt.SaintName + ' ' : '') + fetchedSt.FullName);

      return `
        <div class="mb-8">
          <div class="bg-white p-5 rounded-lg border border-slate-200 shadow-sm mb-4 flex justify-between items-start flex-wrap gap-4">
            <div>
              <h3 class="text-lg font-bold text-blue-900 mb-2">${displayFullName}</h3>
              <div class="text-sm text-slate-700 grid grid-cols-2 md:grid-cols-4 gap-2">
                <p><b>CCCD:</b> ${esc(fetchedSt.IdNumber)}</p>
                <p><b>Lớp hiện tại:</b> ${esc(fetchedSt.CurrentClass)}</p>
                <p><b>Trạng thái:</b> ${esc(fetchedSt.Status)}</p>
                <p><b>Năm nhập học:</b> ${esc(fetchedSt.EnrollYear || '—')}</p>
              </div>
            </div>
            <button type="button" class="export-hbt-btn bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-sm flex-shrink-0" data-table="${tableId}" data-name="${esc(fetchedSt.FullName)}">
              ⬇ Xuất Excel
            </button>
          </div>
          
          <div class="tbl-scroll">
            <table id="${tableId}" class="w-full text-sm border-collapse bg-white">
              <thead>
                <tr class="bg-blue-900 text-white text-xs uppercase font-bold text-center">
                  <th class="p-3 border">Năm Học</th>
                  <th class="p-3 border">Lớp</th>
                  <th class="p-3 border">ĐTB HK1</th>
                  <th class="p-3 border">ĐTB HK2</th>
                  <th class="p-3 border">ĐTB Năm</th>
                  <th class="p-3 border">Chuyên Cần</th>
                  <th class="p-3 border">Xếp Loại</th>
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
        </div>
        <hr class="my-8 border-slate-300 border-dashed border-t-2" />
      `;
    }));
    
    out.innerHTML = resultsHtml.join('').replace(/(<hr[^>]*>)\s*$/, '');
    
  } catch (e) {
    out.innerHTML = `<div class="p-4 text-red-500 font-medium">Đã xảy ra lỗi: ${esc(e.message)}</div>`;
  }
}

/* ---------- Tổng Hợp & Khen Thưởng ---------- */
async function renderTongHop() {
  const yr = $('th-nam').value, cls =$('th-lop').value;
  const showRating = cur.tier === 'Lớp';
  const heads = ['STT', 'Số CCCD', 'Họ Tên', 'Lớp', 'ĐTB HK1', 'ĐTB HK2', 'ĐTB Năm', '% Chuyên Cần'].concat(showRating ? ['Xếp Loại'] : []);
  $('th-head').innerHTML = '<tr class="bg-slate-100">' + heads.map(h => '<th class="p-2 border text-left">' + h + '</th>').join('') + '</tr>';
  let r;
  try { r = await api('getSummary', {schoolYear: yr, className: cls}); }
  catch (e) { return toast(e.message); }
  
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
        const rt = x.rating !== undefined ? x.rating : (x.Status === 'Hoạt động' ? '' : x.Status);

        return '<tr><td class="p-2 border text-center">' + (i + 1) + '</td><td class="p-2 border">' + esc(id) + '</td>' +
          '<td class="p-2 border font-medium">' + esc(fullName) + '</td><td class="p-2 border">' + esc(cName) + '</td>' +
          '<td class="p-2 border text-center">' + fmt1(h1) + '</td><td class="p-2 border text-center">' + fmt1(h2) + '</td>' +
          '<td class="p-2 border text-center font-bold">' + fmt1(avg) + '</td>' +
          '<td class="p-2 border text-center">' + (cc == null || cc === '' ? '—' : cc + '%') + '</td>' +
          (showRating ? '<td class="p-2 border text-center">' + (rt ? esc(rt) : '—') + '</td>' : '') + '</tr>';
      }).join('')
    : '<tr><td colspan="' + heads.length + '" class="p-4 text-center text-slate-400">Chưa có dữ liệu.</td></tr>';
}

async function renderKT() {
  const yr = $('kt-nam').value, cls =$('kt-lop').value;
  let r;
  try { r = await api('getSummary', {schoolYear: yr, className: cls}); }
  catch (e) { return toast(e.message); }
  
  const rawRows = (r.summary || []).filter(x => {
      const avg = x.YearScore ?? x.avgYear;
      const cc = x.YearAttendant ?? x.pct ?? x.cc;
      
      return avg !== null && avg !== '' && +avg >= 8 && cc != null && +cc >= 80;
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

/* ---------- In Bảng Xếp Loại (Lớp / Toàn Đoàn) ---------- */
async function printRanking(isWholeDeanery = false) {
  if (isWholeDeanery && !isExec()) return toast('Chỉ Ban Điều Hành mới được in toàn đoàn.');

  const yr = $('th-nam').value || year();
  const cls = $('th-lop').value;

  if (!isWholeDeanery && !cls) return toast('Vui lòng chọn một lớp để in.');

  toast(`⏳ Đang tạo bảng xếp loại ${isWholeDeanery ? 'toàn đoàn' : 'lớp'}...`);

  let r;
  try {
    const payload = isWholeDeanery ? { schoolYear: yr, wholeDeanery: true } : { schoolYear: yr, className: cls };
    r = await api('getSummary', payload);
  } catch (e) {
    return toast(e.message);
  }

  const rawRows = r.summary || [];
  if (!rawRows.length) return toast('Không có dữ liệu để in.');

  const rows = sortSummaryRecords(rawRows);

  const printWindow = window.open('', '_blank');
  
  const docTitle = isWholeDeanery ? `Xếp Loại Toàn Đoàn - ${esc(yr)}` : `Bảng Xếp Loại - ${esc(cls)}`;
  const headerTitle = isWholeDeanery ? 'BẢNG TỔNG KẾT VÀ XẾP LOẠI TOÀN ĐOÀN' : 'BẢNG TỔNG KẾT VÀ XẾP LOẠI HỌC TẬP';
  const subHeader = isWholeDeanery ? `Năm học: <b>${esc(yr)}</b>` : `Lớp: <b>${esc(cls)}</b> &nbsp;|&nbsp; Năm học: <b>${esc(yr)}</b>`;

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${docTitle}</title>
      <style>
        body { font-family: 'Times New Roman', Times, serif; padding: 20px; color: #000; }
        .header { text-align: center; margin-bottom: 20px; }
        .header h2 { margin: 0; font-size: 20px; text-transform: uppercase; }
        .header h3 { margin: 5px 0 0 0; font-size: 16px; font-weight: normal; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; }
        th, td { border: 1px solid #000; padding: 6px 8px; text-align: center; }
        th { background-color: #f4f4f4; font-weight: bold; }
        td.left { text-align: left; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 15px; }
        .signature { text-align: center; width: 40%; }
        @media print {
          @page { size: A4 portrait; margin: 15mm; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h2>${headerTitle}</h2>
        <h3>${subHeader}</h3>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 5%">STT</th>
            ${isWholeDeanery ? '<th style="width: 10%">Lớp</th>' : ''}
            <th style="width: 15%">Số CCCD</th>
            <th style="width: 30%">Họ và Tên</th>
            <th style="width: 8%">Đ. HK1</th>
            <th style="width: 8%">Đ. HK2</th>
            <th style="width: 8%">Cả Năm</th>
            <th style="width: 8%">Chuyên Cần</th>
            <th style="width: 8%">Xếp Loại</th>
          </tr>
        </thead>
        <tbody>
  `;

  rows.forEach((x, i) => {
    const id = x.IdNumber || x.idNumber || '';
    const fullName = [x.SaintName || x.saintName, x.FullName || x.fullName].filter(Boolean).join(' ');
    const cName = x.CurrentClass || x.ClassName || x.className || '';

    const h1 = x.HK1Score ?? x.avgH1 ?? x.h1;
    const h2 = x.HK2Score ?? x.avgH2 ?? x.h2;
    const avg = x.YearScore ?? x.avgYear;
    const cc = x.YearAttendant ?? x.pct ?? x.cc;
    const rt = x.rating !== undefined ? x.rating : (x.Status === 'Hoạt động' ? '' : x.Status);

    html += `
      <tr>
        <td>${i + 1}</td>
        ${isWholeDeanery ? `<td>${esc(cName)}</td>` : ''}
        <td>${esc(id)}</td>
        <td class="left font-medium">${esc(fullName)}</td>
        <td>${h1 !== '' && h1 !== null ? fmt1(h1) : '—'}</td>
        <td>${h2 !== '' && h2 !== null ? fmt1(h2) : '—'}</td>
        <td><strong>${avg !== '' && avg !== null ? fmt1(avg) : '—'}</strong></td>
        <td>${cc !== '' && cc !== null ? cc + '%' : '—'}</td>
        <td><strong>${rt ? esc(rt) : '—'}</strong></td>
      </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <div class="footer">
        <div class="signature">
          <p><b>${isWholeDeanery ? 'Ban Điều Hành' : 'Giáo lý viên phụ trách'}</b></p>
          <br><br><br>
        </div>
        <div class="signature">
          <p><b>Xứ đoàn trưởng</b></p>
          <br><br><br>
        </div>
      </div>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);
}

/* ---------- Events ---------- */
$('nh-lop').addEventListener('change', async () => { tabCache['t-nhap'] = false; await renderNhap(); tabCache['t-nhap'] = true; });$('save-scores').addEventListener('click', saveScores);
$('nh-template').addEventListener('click', e => { e.preventDefault(); downloadTemplate(); });$('nh-file').addEventListener('change', importScores);

$('hbt-search').addEventListener('click', renderHBT);$('hbt-out').addEventListener('click', e => {
  const btn = e.target.closest('.export-hbt-btn');
  if (btn) {
    const tableId = btn.getAttribute('data-table');
    const studentName = btn.getAttribute('data-name');
    exportExcel(tableId, `Hoc_ba_${studentName}`);
  }
});

$('th-nam').addEventListener('change', async () => { tabCache['t-tonghop'] = false; await renderTongHop(); tabCache['t-tonghop'] = true; });
$('th-lop').addEventListener('change', async () => { tabCache['t-tonghop'] = false; await renderTongHop(); tabCache['t-tonghop'] = true; });$('th-excel').addEventListener('click', () => exportExcel('th-table', 'Tổng hợp & xếp loại'));
$('th-print').addEventListener('click', () => printRanking(false));

const btnToanDoan = $('th-toandoan');
if (btnToanDoan) btnToanDoan.addEventListener('click', () => printRanking(true));

$('kt-nam').addEventListener('change', async () => { tabCache['t-kt'] = false; await renderKT(); tabCache['t-kt'] = true; });
$('kt-lop').addEventListener('change', async () => { tabCache['t-kt'] = false; await renderKT(); tabCache['t-kt'] = true; });$('kt-excel').addEventListener('click', () => exportExcel('kt-table', 'Danh sách khen thưởng'));
$('kt-print').addEventListener('click', () => window.print());

/* Boot default active tab */
switchTab('t-nhap');