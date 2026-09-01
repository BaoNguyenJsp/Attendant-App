/* =====================================================================
   SỔ THIẾU NHI — shared/common.js
   Hằng số, trạng thái chung, helpers, api(), shell(), initCommon().
   ===================================================================== */
'use strict';

import { groupBadge, highestType } from './ui.js';

/* ---------- Hằng số ---------- */
export const SESSIONS = ['Lễ Chúa Nhật', 'Học Giáo Lý', 'Chầu Thánh Thể', 'Lễ Thứ Năm'];
export const TYPES = {'Lớp':'b-class', 'Ngành':'b-sector', 'Quản trị ngành':'b-exec', 'Quản trị':'b-admin'};
export const TYPE_LABEL = {'Lớp':'Lớp', 'Ngành':'Ngành', 'Quản trị ngành':'BQT ngành', 'Quản trị':'Xứ đoàn'};
export const ADMIN = 'Quản trị';
export const BQT = 'Quản trị ngành';
export const RANK = {'Lớp':1, 'Ngành':2, 'Quản trị ngành':3, 'Quản trị':4};
export const SCORE_FIELDS = ['Quiz15_S1', 'Exam_S1', 'Quiz15_S2', 'Exam_S2'];
export const FMAP = {'Quiz15_S1':'quiz15s1', 'Exam_S1':'exams1', 'Quiz15_S2':'quiz15s2', 'Exam_S2':'exams2'};
export const SCORE_LABEL = {'Quiz15_S1':"15' HK1", 'Exam_S1':'KT HK1', 'Quiz15_S2':"15' HK2", 'Exam_S2':'KT HK2'};

/* ---------- Trạng thái chung ---------- */
export let cur = null;            // session: {email, fullName, groups, scope, tier, sectors}
export let YEAR = '2026-2027';
export let TSTUDENTS = [], TCLASSES = [], THOLIDAYS = [], TSCORES = [];
export let USERS_ROWS = [], GROUPS_LIST = [], GROUP_MEMBERS = [];

// Importers of `export let` bindings can't reassign them → route reassignment here.
export function setState(patch) {
  if (patch.cur !== undefined) cur = patch.cur;
  if (patch.YEAR !== undefined) YEAR = patch.YEAR;
  if (patch.TSTUDENTS !== undefined) TSTUDENTS = patch.TSTUDENTS;
  if (patch.TCLASSES !== undefined) TCLASSES = patch.TCLASSES;
  if (patch.THOLIDAYS !== undefined) THOLIDAYS = patch.THOLIDAYS;
  if (patch.TSCORES !== undefined) TSCORES = patch.TSCORES;
  if (patch.USERS_ROWS !== undefined) USERS_ROWS = patch.USERS_ROWS;
  if (patch.GROUPS_LIST !== undefined) GROUPS_LIST = patch.GROUPS_LIST;
  if (patch.GROUP_MEMBERS !== undefined) GROUP_MEMBERS = patch.GROUP_MEMBERS;
}

/* ---------- Accessors ---------- */
export const year = () => YEAR;
export const isExec = () => !!cur && (cur.tier === BQT || cur.tier === ADMIN);
export const isAdmin = () => !!cur && cur.tier === ADMIN;

/* ---------- Core helpers ---------- */
export const $ = id => document.getElementById(id);
export function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
export function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
let __tt;
export function toast(m) { const t = $('toastbox'); if (!t) return; t.textContent = m; t.style.display = 'block'; clearTimeout(__tt); __tt = setTimeout(() => t.style.display = 'none', 5000); }

export const fmtDate = d => { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()); };
export const parseLocal = s => { if (!s) return null; const a = String(s).split('-').map(Number); return a.length === 3 ? new Date(a[0], a[1]-1, a[2]) : null; };
export function defaultWeek() { const d = new Date(); const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const diff = x.getDay() === 0 ? 0 : 7 - x.getDay(); x.setDate(x.getDate() + diff); return fmtDate(x); }
export function normSunday(input) { if (!input.value) return; const [y, m, dd] = input.value.split('-').map(Number); const x = new Date(y, m-1, dd); const diff = x.getDay() === 0 ? 0 : 7 - x.getDay(); x.setDate(x.getDate() + diff); input.value = fmtDate(x); }

export const fmt1 = v => v == null || v === '' ? '—' : (Math.round(+v*100)/100).toLocaleString('vi-VN');
export const num = v => { if (v == null || v === '') return null; const n = +v; return isNaN(n) ? null : n; };

/* ---------- Loading overlay (theo số request đang chờ) ---------- */
let pendingApi = 0, overlay = null;
function makeOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = '<div class="loading-box"><div class="loading-spinner"></div><div class="loading-text">Đang tải…</div></div>';
  document.body.appendChild(overlay);
}
function showLoading() {
  if (!document.body.dataset.role) return;              // trang login tự báo trạng thái riêng
  makeOverlay();
  overlay.classList.add('active');
}
function hideLoading() {
  // setTimeout 0: chờ các microtask render sau await chạy xong rồi mới ẩn (không để hở trang nửa render)
  setTimeout(() => {
    if (pendingApi <= 0) {
      if (overlay) overlay.classList.remove('active');
      document.body.classList.add('ready');             // hiện trang chỉ khi đã render xong toàn bộ
    }
  }, 0);
}
// Hiện overlay ngay từ đầu (trước request đầu tiên) để không lộ khoảng trống khi trang chưa sẵn sàng.
if (document.body && document.body.dataset.role) { makeOverlay(); overlay.classList.add('active'); }

/* ---------- API ---------- */
export async function api(action, body) {
  pendingApi++;
  showLoading();
  try {
    let r;
    try { r = await fetch('/api/' + action, {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(body || {})}); }
    catch (e) { throw new Error('Mất kết nối máy chủ.'); }
    let j;
    try { j = await r.json(); }
    catch (e) { throw new Error('Máy chủ trả về lỗi (HTTP ' + r.status + '). Vui lòng thử lại.'); }
    if (!r.ok || j.status === 'error') throw new Error(j.message || 'Lỗi máy chủ');
    return j;
  } finally {
    pendingApi--;
    hideLoading();
  }
}

export function fillSel(selId, items, value) {
  const s = $(selId); if (!s) return;
  s.innerHTML = items.map(it => '<option value="' + esc(it.v) + '">' + esc(it.t || it.v) + '</option>').join('');
  if (value !== undefined) s.value = value;
}
export function fillYears(selId, curY) {
  const base = parseInt(String(curY).slice(0, 4), 10) || 2026;
  const years = [base-1, base, base+1].map(b => b + '-' + (b+1));
  fillSel(selId, years.map(y => ({v:y})));
  $(selId).value = curY;
}
export function exportExcel(tableId, filename) {
  const t = $(tableId); if (!t) return;
  const wb = XLSX.utils.table_to_book(t, {sheet:'Sheet1'});
  XLSX.writeFile(wb, filename + '.xlsx');
}
export function setVis(sel, on) {
  document.querySelectorAll(sel).forEach(el => el.style.display = on ? (el.tagName === 'BUTTON' ? 'inline-block' : 'block') : 'none');
}

/* ---------- Tab ---------- */
export function tab(btn) {
  const host = btn.closest('.bg-white.rounded-t-xl');
  if (!host) return;
  host.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  const panes = host.parentElement.querySelectorAll('[data-pane]');
  panes.forEach(el => el.style.display = el.id === btn.dataset.tab ? 'block' : 'none');
}

/* ---------- Selects theo scope / năm học ---------- */
export function scopeClasses() { return cur.scope && cur.scope.length ? cur.scope : TCLASSES.map(c => c.ClassName); }
export function scopeSectors() { return isAdmin() ? GROUPS_LIST.filter(g => g.Type === 'Ngành').map(g => g.GroupName) : (cur.sectors || []); }
export function fillClasses(...ids) { const cs = scopeClasses(); ids.forEach(id => fillSel(id, cs.map(c => ({v:c})))); }
export function fillSessions(...ids) { ids.forEach(id => fillSel(id, SESSIONS.map(s => ({v:s})))); }
export function fillSectors(...ids) { const ss = scopeSectors(); ids.forEach(id => fillSel(id, ss.map(s => ({v:s})))); }
export function fillYearSelects(...ids) { ids.forEach(id => fillYears(id, YEAR)); }

/* ---------- Shell (header + year bar + toast) ---------- */
function scopeText() {
  const hi = highestType(cur.groups);
  if (!cur.scope || !cur.scope.length) return '';
  if (hi === ADMIN) return 'Toàn đoàn · Xứ đoàn';
  const cls = cur.scope.join(', ');
  return hi === BQT ? 'Toàn đoàn ngành: ' + cls : 'Phạm vi: ' + cls;
}

function shell() {
  const b = document.body;
  let html = '<div class="max-w-7xl mx-auto px-4 pt-6">' +
    '<header class="bg-gradient-to-r from-blue-900 to-indigo-800 text-white p-6 rounded-xl shadow-lg flex justify-between items-center flex-wrap gap-4">' +
    '<div><h1 class="text-2xl font-extrabold">' + esc(b.dataset.title || '') + '</h1>' +
    (b.dataset.sub ? '<p class="text-blue-200 text-sm mt-1">' + esc(b.dataset.sub) + '</p>' : '') + '</div>' +
    '<div style="text-align:right"><span class="badge b-admin" data-user></span><br>' +
    (b.dataset.back
      ? '<a href="/" class="mt-2 inline-block bg-white text-blue-900 hover:bg-blue-50 font-bold text-sm px-4 py-2 rounded-lg">← Trang chính</a>'
      : '<a href="/auth/logout" class="mt-2 inline-block bg-white text-blue-900 hover:bg-blue-50 font-bold text-sm px-4 py-2 rounded-lg">🔒 Đăng xuất</a>') +
    '</div></header>';
  if (b.dataset.yearbar) {
    html += '<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mt-6 flex flex-wrap items-center gap-4">' +
      '<b class="text-sm">Năm học:</b>' +
      '<select id="year-sel" style="width:auto" class="border p-2 rounded-lg font-semibold"></select>' +
      '<span class="text-sm text-slate-600" id="scope-line"></span>' +
      '<span style="margin-left:auto;display:flex;gap:.5rem;flex-wrap:wrap">' +
      '<a class="exec-only bg-indigo-100 hover:bg-indigo-200 text-indigo-900 font-bold text-sm px-4 py-2 rounded-lg" href="/giaovien/">🧑‍🏫 Giáo viên</a>' +
      '<a class="admin-only bg-pink-100 hover:bg-pink-200 text-pink-900 font-bold text-sm px-4 py-2 rounded-lg" href="/admin/">⚙ Quản trị</a>' +
      '</span></div>';
  }
  html += '<div id="toastbox" style="position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:.6rem 1.1rem;border-radius:8px;font-size:.85rem;display:none;max-width:80%;z-index:200"></div></div>';
  $('shell').innerHTML = html;
}

function scopeUserBadge() {
  const hi = highestType(cur.groups);
  const name = cur.fullName || cur.email;
  document.querySelectorAll('[data-user]').forEach(el => { el.innerHTML = esc(name) + ' ' + groupBadge({Type: hi}); });
}

/* ---------- Đổi năm học (chỉ launcher) ---------- */
export async function setYearSel(v) {
  const ysel = $('year-sel');
  if (!isAdmin()) { if (ysel) ysel.value = YEAR; return toast('Chỉ Quản trị được đổi năm học.'); }
  try { await api('saveConfig', {key: 'CurrentSchoolYear', value: v}); YEAR = v; }
  catch (e) { if (ysel) ysel.value = YEAR; return toast(e.message); }
  toast('Đã đổi năm học.');
}

/* ---------- Boot chung cho mọi trang đã đăng nhập ---------- */
// Trang không đăng nhập được → bật sang login. Đã đăng nhập không đủ quyền → về launcher.
export async function initCommon() {
  const q = new URLSearchParams(location.search);
  if (q.get('login') === 'denied') return location.replace('/login/?login=denied');
  if (q.get('login') === 'error') return location.replace('/login/?login=error&msg=' + encodeURIComponent(q.get('msg') || ''));
  try { cur = (await api('getUser')).session; }
  catch (e) { return location.replace('/login/?login=error&msg=' + encodeURIComponent(e.message)); }
  try { YEAR = ((await api('getConfig')).config || {}).CurrentSchoolYear || YEAR; }
  catch (e) { return location.replace('/login/?login=error&msg=' + encodeURIComponent(e.message)); }

  const role = document.body.dataset.role;
  if (role === 'admin' && !isAdmin()) return location.replace('/');
  if (role === 'exec' && !isExec()) return location.replace('/');

  shell();
  const ysel = $('year-sel');
  if (ysel) { fillYears('year-sel', YEAR); ysel.addEventListener('change', () => setYearSel(ysel.value)); }
  const sl = $('scope-line');
  if (sl) sl.textContent = scopeText();
  scopeUserBadge();
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => tab(b)));
  setVis('.exec-only', isExec());
  setVis('.admin-only', isAdmin());
}

/* ---------- Báo lỗi toàn cục ---------- */
window.addEventListener('error', e => toast('Lỗi: ' + (e.message || 'unknown')));
window.addEventListener('unhandledrejection', e => { const m = e.reason && e.reason.message ? e.reason.message : String(e.reason); toast('Lỗi: ' + m); });
