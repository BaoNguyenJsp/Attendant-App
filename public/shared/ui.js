/* =====================================================================
   SỔ THIẾU NHI — shared/ui.js
   Helpers render/build dùng chung: công thức điểm, tra cứu người, badges,
   trích lục (điểm). common.js và ui.js import chéo nhau nhưng
   chỉ dùng bên trong thân hàm nên không có vòng lặp khởi tạo.
   ===================================================================== */
'use strict';

import {
  num, fmt1, esc, $, api, sortStudents,
  TSTUDENTS, USERS_ROWS, GROUP_MEMBERS, GROUPS_LIST, TCLASSES,
  RANK, TYPES, TYPE_LABEL, ADMIN, BQT
} from './common.js';

/* ---------- Pre-Indexed Caches for Fast Lookups ---------- */
let userEmailMap = null;
let groupMembersMap = null;

function ensureUserMap() {
  if (!userEmailMap || userEmailMap.size !== USERS_ROWS.length) {
    userEmailMap = new Map();
    USERS_ROWS.forEach(u => {
      if (u.Email) userEmailMap.set(String(u.Email).toLowerCase(), u.FullName || u.Email);
    });
  }
}

function ensureGroupMembersMap() {
  if (!groupMembersMap) {
    groupMembersMap = new Map();
    GROUP_MEMBERS.forEach(m => {
      const grp = m.GroupName;
      if (!groupMembersMap.has(grp)) groupMembersMap.set(grp, []);
      if (m.Email) groupMembersMap.get(grp).push(String(m.Email).toLowerCase());
    });
  }
}

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
  if (!em) return '—';
  ensureUserMap();
  const e = String(em).toLowerCase();
  return userEmailMap.get(e) || em || '—';
};

export const teachersOf = grp => {
  ensureGroupMembersMap();
  return groupMembersMap.get(grp) || [];
};

export function activeStudents(className) {
  const targetClass = String(className || '').normalize('NFC').trim();
  const filtered = TSTUDENTS.filter(s => 
    String(s.CurrentClass || '').normalize('NFC').trim() === targetClass && 
    String(s.Status || '').toLowerCase().trim() === 'hoạt động'
  );
  
  // Force all pages to use the custom ListOrder sequence
  return sortStudents(filtered);
}

const STATUS_MAP = {
  'Hiện diện': 'bg-emerald-100 text-emerald-700',
  'Có phép': 'bg-amber-100 text-amber-700',
  'Vắng': 'bg-red-100 text-red-700',
  'Hoạt động': 'bg-blue-100 text-blue-700',
  'Tốt nghiệp': 'bg-slate-200 text-slate-600',
  'Ngưng hoạt động': 'bg-red-100 text-red-700'
};

export function badgeStatus(st) {
  const s = String(st || '').trim();
  const c = STATUS_MAP[s] || 'bg-slate-100 text-slate-500';
  return '<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ' + c + '">' + esc(s || '—') + '</span>';
}

export function fileLink(url, names, rev) {
  if (!url) return '';
  const ns = String(names || '').split('\n');
  const urls = String(url).split(',');
  const result = [];

  for (let i = 0; i < urls.length; i++) {
    const f = urls[i].trim();
    if (/^https?:\/\//i.test(f)) {
      const name = (ns[i] || '').trim();
      const label = name || (rev ? '✏️ Bản sửa' : '📄 Giáo án');
      result.push('<a class="file-link' + (rev ? ' reviewed' : '') + '" href="' + esc(f) + '" target="_blank" rel="noopener">' + esc(label) + '</a>');
    }
  }
  return result.join(' ');
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
    if (t === 'Lớp' || t === 'Ngành') cs.forEach(c => out.add(c));
    else if (t === BQT) {
      GROUPS_LIST.filter(gr => gr.Type === 'Ngành' && cs.includes(gr.GroupName))
        .forEach(gr => String(gr.Scope || '').split(',').map(x => x.trim()).filter(Boolean).forEach(c => out.add(c)));
    }
  });
  return [...out];
}

export const rankBadge = avg => avg == null ? '—' : (avg >= 85 ? '<span class="badge b-admin">Tốt</span>' : (avg >= 70 ? '<span class="badge b-sector">Khá</span>' : '<span class="badge b-class">Cần cải thiện</span>'));

/* ---------- Trích lục ---------- */
export async function searchCard(id, outId) {
  const out = $(outId);
  if (!id) { out.innerHTML = ''; return; }
  let r;
  try { r = await api('searchByIdNumber', {idNumber: id}); }
  catch (e) { out.innerHTML = '<div class="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">' + esc(e.message) + '</div>'; return; }
  const st = (r.students || [])[0];
  if (!st) { out.innerHTML = '<div class="p-4 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-sm">Không tìm thấy thiếu nhi có Số CCCD này.</div>'; return; }
  out.innerHTML = '<div class="p-4 bg-slate-50 border border-slate-200 rounded-lg">' +
    '<div class="font-bold text-lg">' + esc([st.SaintName, st.FullName].filter(Boolean).join(' ')) + ' ' + badgeStatus(st.Status) + '</div>' +
    '<div class="text-sm text-slate-600 mt-1">' + esc(st.IdNumber) + ' · ' + esc(st.CurrentClass || '') + '</div>' +
    (r.academic ? academicBlock(r.academic) : scoresBlock(r.scores)) + '</div>';
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

export function academicBlock(rows) {
  const list = (rows || []).slice().sort((a, b) => String(b.SchoolYear).localeCompare(String(a.SchoolYear)));
  if (!list.length) return '';
  return '<h4 class="font-bold text-sm mt-3 mb-1">Học bạ theo năm</h4>' +
    '<table class="w-full text-sm border-collapse"><thead><tr class="bg-slate-100">' +
    ['Năm học', 'Lớp', 'ĐTB HK1', 'ĐTB HK2', 'ĐTB Năm', '% Chuyên Cần', 'Xếp loại'].map(h => '<th class="border p-1 text-left">' + h + '</th>').join('') +
    '</tr></thead><tbody>' + list.map(x => {
      const s = normSummary(x);
      return '<tr><td class="border p-1">' + esc(x.SchoolYear) + '</td><td class="border p-1">' + esc(s.className) + '</td>' +
        '<td class="border p-1 text-center">' + fmt1(s.h1) + '</td><td class="border p-1 text-center">' + fmt1(s.h2) + '</td>' +
        '<td class="border p-1 text-center font-bold">' + fmt1(s.avgYear) + '</td>' +
        '<td class="border p-1 text-center">' + (s.cc == null ? '—' : s.cc + '%') + '</td>' +
        '<td class="border p-1 text-center">' + esc(s.rating || '—') + '</td></tr>';
    }).join('') + '</tbody></table>';
}