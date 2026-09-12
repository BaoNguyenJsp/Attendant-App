/* =====================================================================
   SỔ THIẾU NHI — shared/common.js
   Hằng số, trạng thái chung, helpers, api(), shell(), initCommon().
   ===================================================================== */
'use strict';

import { highestType } from './ui.js';

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
export let cur = null;
export let YEAR = '2026-2027';
export let TSTUDENTS = [], TCLASSES = [], THOLIDAYS = [], TSCORES = [];
export let USERS_ROWS = [], GROUPS_LIST = [], GROUP_MEMBERS = [];

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

export function esc(s) { 
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;'); 
}

export function q(s) { 
  return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; 
}

let __tt;
export function toast(m) { 
  const t = $('toastbox'); 
  if (!t) return; 
  t.textContent = m; 
  t.style.display = 'block'; 
  clearTimeout(__tt); 
  __tt = setTimeout(() => t.style.display = 'none', 5000); 
}

export const fmtDate = d => { 
  const p = n => String(n).padStart(2, '0'); 
  return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()); 
};

export const parseLocal = s => { 
  if (!s) return null; 
  const a = String(s).split('-').map(Number); 
  return a.length === 3 ? new Date(a[0], a[1]-1, a[2]) : null; 
};

export function defaultWeek() { 
  const d = new Date(); 
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); 
  x.setDate(x.getDate() - x.getDay()); 
  return fmtDate(x); 
}

export function normSunday(input) { 
  if (!input.value) return; 
  const [y, m, dd] = input.value.split('-').map(Number); 
  const x = new Date(y, m-1, dd); 
  x.setDate(x.getDate() - x.getDay()); 
  input.value = fmtDate(x); 
}

export const fmt1 = v => v == null || v === '' ? '—' : (Math.round(+v*100)/100).toLocaleString('vi-VN');
export const num = v => { if (v == null || v === '') return null; const n = +v; return isNaN(n) ? null : n; };

/* ---------- Loading Overlay ---------- */
let pendingApi = 0, overlay = null;

function makeOverlay() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.innerHTML = '<div class="loading-box"><div class="loading-spinner"></div><div class="loading-text">Đang tải…</div></div>';
  document.body.appendChild(overlay);
}

function showLoading() {
  if (!document.body.dataset.role) return;
  makeOverlay();
  overlay.classList.add('active');
}

function hideLoading() {
  setTimeout(() => {
    if (pendingApi <= 0) {
      if (overlay) overlay.classList.remove('active');
      document.body.classList.add('ready');
    }
  }, 0);
}

if (document.body && document.body.dataset.role) { 
  makeOverlay(); 
  overlay.classList.add('active'); 
}

/* ---------- Advanced Persistent TTL Cache Engine ---------- */
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 mins
const CACHEABLE_ACTIONS = new Set(['getConfig', 'getClasses', 'getStudents', 'getTeachers']);

const CACHE_INVALIDATIONS = {
  'saveConfig': ['getConfig'],
  'startSchoolYear': ['getConfig', 'getClasses', 'getStudents'],
  'saveClass': ['getClasses'],
  'saveStudent': ['getStudents'],
  'saveUser': ['getTeachers'],
  'saveGroupMembers': ['getTeachers']
};

export function clearApiCache(action) {
  if (action) {
    localStorage.removeItem('api_cache_' + action);
  } else {
    CACHEABLE_ACTIONS.forEach(act => localStorage.removeItem('api_cache_' + act));
  }
}

function getStoredCache(action) {
  const cacheKey = 'api_cache_' + action;
  const itemStr = localStorage.getItem(cacheKey);
  if (!itemStr) return null;

  try {
    const item = JSON.parse(itemStr);
    const now = Date.now();
    if (item.timestamp && (now - item.timestamp < CACHE_TTL_MS)) {
      return item.data;
    }
  } catch (e) {
    localStorage.removeItem(cacheKey);
  }
  return null;
}

function setStoredCache(action, data) {
  const cacheKey = 'api_cache_' + action;
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      data: data
    }));
  } catch (e) {
    console.warn('localStorage quota exceeded');
  }
}

/* ---------- Enhanced API Dispatcher with Auto-Retry Interceptor ---------- */
export async function api(action, body, retries = 3, delayMs = 1500) {
  const isCacheable = CACHEABLE_ACTIONS.has(action) && (!body || Object.keys(body).length === 0);

  if (isCacheable) {
    const cachedData = getStoredCache(action);
    if (cachedData) {
      return JSON.parse(JSON.stringify(cachedData));
    }
  }

  if (CACHE_INVALIDATIONS[action]) {
    CACHE_INVALIDATIONS[action].forEach(act => clearApiCache(act));
  }

  pendingApi++;
  showLoading();
  
  try {
    let lastError = null;

    // Retry Loop Interceptor
    for (let attempt = 1; attempt <= retries; attempt++) {
      try { 
        const r = await fetch('/api/' + action, {
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          credentials: 'same-origin', 
          body: JSON.stringify(body || {})
        }); 
        
        let j;
        try { 
          j = await r.json(); 
        } catch (e) { 
          throw new Error('Máy chủ trả về lỗi (HTTP ' + r.status + ').'); 
        }
        
        if (!r.ok || j.status === 'error') { 
          const e = new Error(j.message || 'Lỗi máy chủ'); 
          e.status = r.status; 
          throw e; 
        }
        
        if (isCacheable) {
          setStoredCache(action, j);
        }

        return j; // Success! Return data immediately and break the loop.

      } catch (e) { 
        lastError = e;
        
        // If this is not the last attempt, wait and retry
        if (attempt < retries) {
          console.warn(`[API] '${action}' failed (Attempt ${attempt}/${retries}). Retrying in ${delayMs}ms... Error: ${e.message}`);
          await new Promise(resolve => setTimeout(resolve, delayMs)); // Wait before retrying
        }
      }
    }

    // If loop finishes and all retries failed, throw the final error to the UI
    throw lastError || new Error('Mất kết nối máy chủ.'); 
    
  } finally {
    pendingApi--;
    hideLoading();
  }
}

/* ---------- Sắp xếp Roster ---------- */
const gRank = v => { 
  const g = String(v || '').normalize('NFC').trim().toLowerCase(); 
  return g === 'nữ' ? 0 : g === 'nam' ? 1 : 2; 
};

export function sortStudents(rows) {
  const cm = {};
  TCLASSES.forEach((c, i) => cm[c.ClassName] = i);
  
  return rows.slice().sort((a, b) => {
    // 1. Sort by Class
    const clsA = a.CurrentClass || a.className || '';
    const clsB = b.CurrentClass || b.className || '';
    const ca = cm[clsA] != null ? cm[clsA] : 1e9;
    const cb = cm[clsB] != null ? cm[clsB] : 1e9;
    if (ca !== cb) return ca - cb;
    
    // 2. Extract ListOrder safely (handling casing & strings)
    const valA = a.ListOrder ?? a.listOrder ?? a.listorder;
    const valB = b.ListOrder ?? b.listOrder ?? b.listorder;
    const oa = (valA !== null && valA !== '' && !isNaN(+valA)) ? +valA : 1e9;
    const ob = (valB !== null && valB !== '' && !isNaN(+valB)) ? +valB : 1e9;

    // 3. Primary Sort: Manual ListOrder
    if (oa !== ob) return oa - ob;

    // 4. Fallback Sort: Gender -> Alphabetical
    const ga = gRank(a.Gender || a.gender), gb = gRank(b.Gender || b.gender);
    if (ga !== gb) return ga - gb;
    const nameA = String(a.FullName || a.fullName || '');
    const nameB = String(b.FullName || b.fullName || '');
    return nameA.localeCompare(nameB, 'vi');
  });
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

export function tab(btn) {
  const host = btn.closest('.bg-white.rounded-t-xl');
  if (!host) return;
  host.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
  const panes = host.parentElement.querySelectorAll('[data-pane]');
  panes.forEach(el => el.style.display = el.id === btn.dataset.tab ? 'block' : 'none');
}

export function scopeClasses() { return cur.scope && cur.scope.length ? cur.scope : TCLASSES.map(c => c.ClassName); }
export function scopeSectors() { return isAdmin() ? GROUPS_LIST.filter(g => g.Type === 'Ngành').map(g => g.GroupName) : (cur.sectors || []); }
export function fillClasses(...ids) { const cs = scopeClasses(); ids.forEach(id => fillSel(id, cs.map(c => ({v:c})))); }
export function fillSessions(...ids) { ids.forEach(id => fillSel(id, SESSIONS.map(s => ({v:s})))); }
export function fillSectors(...ids) { const ss = scopeSectors(); ids.forEach(id => fillSel(id, ss.map(s => ({v:s})))); }
export function fillYearSelects(...ids) { ids.forEach(id => fillYears(id, YEAR)); }

function scopeText() {
  const hi = highestType(cur.groups);
  if (!cur.scope || !cur.scope.length) return '';
  if (hi === ADMIN) return 'Toàn đoàn · Xứ đoàn';
  const cls = cur.scope.join(', ');
  return hi === BQT ? 'Toàn đoàn ngành: ' + cls : 'Phạm vi: ' + cls;
}

const NAV = [
  ['/giangday/', '📕 Giảng dạy', ''],
  ['/diemdanh/', '✅ Chuyên cần', ''],
  ['/hocba/', '🎓 Học tập', ''],
  ['/hocsinh/', '👥 Thiếu nhi', ''],
  ['/giaovien/', '🧑‍🏫 Huynh trưởng', 'exec-only'],
  ['/admin/', '⚙ Quản trị', 'admin-only'],
];

function shell() {
  const b = document.body;
  const links = NAV.map(n => '<a class="nav-link' + (n[2] ? ' ' + n[2] : '') + '" href="' + n[0] + '">' + n[1] + '</a>').join('');
  const logout = '<a class="nav-logout" href="/auth/logout">🔒 Đăng xuất</a>';
  const brand = '<a href="/" class="flex items-center gap-2.5 no-underline">' +
    '<label for="menu-toggle" class="menu-hamburger md:hidden" aria-label="Mở menu">☰</label>' +
    '<img src="../../logo.png" alt="TNTT Nghĩa Hòa" class="h-9 w-9 rounded-lg">' +
    '<span class="text-blue-900 font-extrabold text-sm sm:text-base leading-tight">Quản lý học vụ TNTT Nghĩa Hòa</span></a>';
  let html = '<input type="checkbox" id="menu-toggle" class="menu-toggle">' +
    '<nav class="sticky top-0 z-40 bg-white/95 backdrop-blur shadow-sm border-b border-slate-200">' +
    '<div class="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">' + brand +
    '<div class="hidden md:flex items-center gap-1">' + links + logout + '</div>' +
    '</div></nav>' +
    '<label for="menu-toggle" class="menu-backdrop" aria-hidden="true"></label>' +
    '<aside class="menu-drawer">' +
    '<div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">' + brand +
    '<label for="menu-toggle" class="menu-close" aria-label="Đóng menu">✕</label></div>' +
    '<div class="px-3 py-3 flex flex-col gap-1">' + links + logout + '</div></aside>';
  html += '<div class="max-w-7xl mx-auto px-4 pt-4">' +
    '<header class="banner text-white p-6 rounded-xl shadow-lg mb-4">' +
    '<h1 class="text-2xl font-extrabold">' + esc(b.dataset.title || '') + '</h1>' +
    (b.dataset.sub ? '<p class="text-blue-200 text-sm mt-1">' + esc(b.dataset.sub) + '</p>' : '') + '</header>';
  if (b.dataset.yearbar) {
    html += '<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mt-4 flex flex-wrap items-center gap-4">' +
      '<b class="text-sm">Năm học:</b>' +
      '<select id="year-sel" style="width:auto" class="border p-2 rounded-lg font-semibold"></select>' +
      '<span class="text-sm text-slate-600" id="scope-line"></span></div>';
  }
  html += '<div id="toastbox" style="position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:.6rem 1.1rem;border-radius:8px;font-size:.85rem;display:none;max-width:80%;z-index:200"></div></div>';
  $('shell').innerHTML = html;
}

export async function setYearSel(v) {
  const ysel = $('year-sel');
  if (!isAdmin()) { if (ysel) ysel.value = YEAR; return toast('Chỉ Quản trị được đổi năm học.'); }
  try { await api('saveConfig', {key: 'CurrentSchoolYear', value: v}); YEAR = v; }
  catch (e) { if (ysel) ysel.value = YEAR; return toast(e.message); }
  toast('Đã đổi năm học.');
}

export async function initCommon() {
  const q = new URLSearchParams(location.search);
  if (q.get('login') === 'denied') return location.replace('/login/?login=denied');
  if (q.get('login') === 'error') return location.replace('/login/?login=error&msg=' + encodeURIComponent(q.get('msg') || ''));
  const deny = e => e.status === 401 ? '/login/' : '/login/?login=error&msg=' + encodeURIComponent(e.message);
  try { cur = (await api('getUser')).session; }
  catch (e) { return location.replace(deny(e)); }
  try { YEAR = ((await api('getConfig')).config || {}).CurrentSchoolYear || YEAR; }
  catch (e) { return location.replace(deny(e)); }

  const role = document.body.dataset.role;
  if (role === 'admin' && !isAdmin()) return location.replace('/');
  if (role === 'exec' && !isExec()) return location.replace('/');

  shell();
  const ysel = $('year-sel');
  if (ysel) { fillYears('year-sel', YEAR); ysel.addEventListener('change', () => setYearSel(ysel.value)); }
  const sl = $('scope-line');
  if (sl) sl.textContent = scopeText();
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => tab(b)));
  setVis('.exec-only', isExec());
  setVis('.admin-only', isAdmin());
}

window.addEventListener('error', e => toast('Lỗi: ' + (e.message || 'unknown')));
window.addEventListener('unhandledrejection', e => { const m = e.reason && e.reason.message ? e.reason.message : String(e.reason); toast('Lỗi: ' + m); });