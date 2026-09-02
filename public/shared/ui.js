/* =====================================================================
   SỔ THIẾU NHI — shared/ui.js
   Helpers render/build dùng chung: công thức điểm, tra cứu người, badges,
   trích lục (điểm + điểm danh). common.js và ui.js import chéo nhau nhưng
   chỉ dùng bên trong thân hàm nên không có vòng lặp khởi tạo.
   ===================================================================== */
'use strict';

import {
  num, fmt1, esc, $, api,
  TSTUDENTS, USERS_ROWS, GROUP_MEMBERS, GROUPS_LIST, TCLASSES,
  RANK, TYPES, TYPE_LABEL, ADMIN, BQT
} from './common.js';

/* ---------- Công thức điểm ---------- */
export const dtbHK = (q, e) => { const a = num(q), b = num(e); return (a != null && b != null) ? (a + 2*b) / 3 : null; };
export const dtbNam = (h1, h2) => { const a = num(h1), b = num(h2); if (a != null && b != null) return (a + 2*b) / 3; if (a != null) return a; if (b != null) return b; return null; };
export const xepLoai = n => n == null ? '' : (n >= 8 ? 'Giỏi' : (n >= 6.5 ? 'Tiên tiến' : 'Trung bình'));
export function normSummary(r) {
  const h1 = num(r.avgH1), h2 = num(r.avgH2);
  const avgYear = num(r.avgYear) != null ? num(r.avgYear) : dtbNam(h1, h2);
  const cc = r.attendancePct != null && r.attendancePct !== '' ? +r.attendancePct : null;
  return {idNumber:r.idNumber, fullName:r.fullName, className:r.className, h1, h2, avgYear, cc, rating: r.rating || xepLoai(avgYear)};
}

/* ---------- Dữ liệu dùng chung ---------- */
export const userFull = em => {
  const e = String(em || '').toLowerCase();
  const u = USERS_ROWS.find(x => String(x.Email).toLowerCase() === e);
  return u ? (u.FullName || em || '—') : (em || '—');
};
export const teachersOf = grp => GROUP_MEMBERS.filter(m => m.GroupName === grp).map(m => String(m.Email).toLowerCase());
export const activeStudents = cls => TSTUDENTS.filter(s => s.CurrentClass === cls && String(s.Status || 'Hoạt động').toLowerCase().trim() === 'hoạt động');

export function badgeStatus(st) {
  const s = String(st || '').trim();
  const map = {
    'Hiện diện': 'bg-emerald-100 text-emerald-700',
    'Có phép': 'bg-amber-100 text-amber-700',
    'Vắng': 'bg-red-100 text-red-700',
    'Hoạt động': 'bg-blue-100 text-blue-700',
    'Tốt nghiệp': 'bg-slate-200 text-slate-600',
    'Ngưng hoạt động': 'bg-red-100 text-red-700'
  };
  const c = map[s] || 'bg-slate-100 text-slate-500';
  return '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ' + c + '">' + esc(s || '—') + '</span>';
}
export function fileLink(url, names, rev) {
  if (!url) return '';
  // Tên mỗi file lưu 1/dòng, song song với thứ tự URL; thiếu (dữ liệu cũ) → nhãn mặc định.
  const ns = String(names || '').split('\n');
  // Chỉ link http/https — chặn javascript:/data: URI lọt vào href (lưu qua saveTeaching).
  return String(url).split(',').map(x => x.trim()).filter(f => /^https?:\/\//i.test(f))
    .map((f, i) => '<a class="file-link' + (rev ? ' reviewed' : '') + '" href="' + esc(f) + '" target="_blank" rel="noopener">' +
      esc((ns[i] || '').trim() || (rev ? '✏️ Bản sửa' : '📄 Giáo án')) + '</a>').join(' ');
}
export function groupBadge(g) {
  const t = (g && (g.Type || g.type)) || '';
  return '<span class="badge ' + (TYPES[t] || 'b-class') + '">' + esc(TYPE_LABEL[t] || t || '—') + '</span>';
}
export function highestGroup(gs) {
  let best = null, rank = 0;
  (gs || []).forEach(g => { const r = RANK[g.Type || g.type] || 0; if (r > rank) { rank = r; best = g; } });
  return best;
}
export const highestType = gs => { const g = highestGroup(gs); return g ? (g.Type || g.type) : null; };
export function expandLocal(gs) {
  if (!gs || !gs.length) return [];
  if (gs.some(g => (g.Type || g.type) === ADMIN)) return TCLASSES.map(c => c.ClassName);
  const out = new Set();
  gs.forEach(g => {
    const t = g.Type || g.type, sc = String(g.Scope || g.scope || '');
    const cs = sc.split(',').map(x => x.trim()).filter(Boolean);
    if (t === 'Lớp') { if (sc) cs.forEach(c => out.add(c)); }
    else if (t === 'Ngành') cs.forEach(c => out.add(c));
    else if (t === BQT) {
      GROUPS_LIST.filter(gr => gr.Type === 'Ngành' && cs.includes(gr.GroupName))
        .forEach(gr => String(gr.Scope || '').split(',').map(x => x.trim()).filter(Boolean).forEach(c => out.add(c)));
    }
  });
  return [...out];
}
export const rankBadge = avg => avg == null ? '—' : (avg >= 85 ? '<span class="badge b-admin">Tốt</span>' : (avg >= 70 ? '<span class="badge b-sector">Khá</span>' : '<span class="badge b-class">Cần cải thiện</span>'));

/* ---------- Trích lục (dùng chung cho Điểm danh và Học bạ) ---------- */
export async function searchCard(id, outId) {
  const out = $(outId);
  if (!id) { out.innerHTML = ''; return; }
  let r;
  try { r = await api('searchByIdNumber', {idNumber: id}); }
  catch (e) { out.innerHTML = '<div class="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">' + esc(e.message) + '</div>'; return; }
  const st = (r.students || [])[0];
  if (!st) { out.innerHTML = '<div class="p-4 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm">Không tìm thấy thiếu nhi có Số CCCD này.</div>'; return; }
  out.innerHTML = '<div class="p-4 bg-slate-50 border border-slate-200 rounded-lg">' +
    '<div class="font-bold text-lg">' + esc(st.FullName) + ' ' + badgeStatus(st.Status) + '</div>' +
    '<div class="text-sm text-slate-600 mt-1">' + esc(st.IdNumber) + ' · ' + esc(st.CurrentClass || '') + (st.SaintName ? ' · ' + esc(st.SaintName) : '') + '</div>' +
    scoresBlock(r.scores) + attendanceBlock(r.attendance) + '</div>';
}
export function scoresBlock(scores) {
  const list = (scores || []).slice().sort((a, b) => String(b.SchoolYear).localeCompare(String(a.SchoolYear)));
  if (!list.length) return '';
  return '<h4 class="font-bold text-sm mt-3 mb-1">Điểm & Xếp loại theo năm</h4>' +
    '<table class="w-full text-sm border-collapse"><thead><tr class="bg-slate-100">' +
    ['Năm học', "15' HK1", 'KT HK1', "15' HK2", 'KT HK2', 'ĐTB Năm', 'Xếp loại'].map(h => '<th class="border p-1 text-left">' + h + '</th>').join('') +
    '</tr></thead><tbody>' + list.map(s => {
      const h1 = dtbHK(s.Quiz15_S1, s.Exam_S1), h2 = dtbHK(s.Quiz15_S2, s.Exam_S2), n = dtbNam(h1, h2);
      return '<tr><td class="border p-1">' + esc(s.SchoolYear) + '</td>' +
        '<td class="border p-1 text-center">' + fmt1(s.Quiz15_S1) + '</td><td class="border p-1 text-center">' + fmt1(s.Exam_S1) + '</td>' +
        '<td class="border p-1 text-center">' + fmt1(s.Quiz15_S2) + '</td><td class="border p-1 text-center">' + fmt1(s.Exam_S2) + '</td>' +
        '<td class="border p-1 text-center font-bold">' + fmt1(n) + '</td><td class="border p-1 text-center">' + (xepLoai(n) || '—') + '</td></tr>';
    }).join('') + '</tbody></table>';
}
export function attendanceBlock(list) {
  const arr = (list || []).slice().sort((a, b) => String(b.WeekOf).localeCompare(String(a.WeekOf)));
  if (!arr.length) return '';
  return '<h4 class="font-bold text-sm mt-3 mb-1">Lịch sử điểm danh</h4>' +
    '<table class="w-full text-sm border-collapse"><thead><tr class="bg-slate-100"><th class="border p-1 text-left">Năm</th><th class="border p-1 text-left">Tuần</th><th class="border p-1 text-left">Buổi</th><th class="border p-1 text-left">Trạng thái</th><th class="border p-1 text-left">Ghi chú</th></tr></thead><tbody>' +
    arr.map(a => '<tr><td class="border p-1">' + esc(a.SchoolYear) + '</td><td class="border p-1">' + esc(a.WeekOf) + '</td><td class="border p-1">' + esc(a.Session) + '</td><td class="border p-1">' + badgeStatus(a.AttendanceStatus) + '</td><td class="border p-1">' + esc(a.Note || '') + '</td></tr>').join('') +
    '</tbody></table>';
}
