/* =====================================================================
   SỔ THIẾU NHI — shared/common.js
   Session state, API client, dates, page shell, small DOM helpers.
   ===================================================================== */
'use strict';

/* ---------- Codes ---------- */
export const SESSIONS = ['SUNDAY_MASS', 'CATECHISM', 'ADORATION', 'THURSDAY_MASS'];
export const TEACHER_SESSIONS = [...SESSIONS, 'TEACHER_MEETING'];
export const MARK = { NONE: 0, PRESENT: 1, EXCUSED: 2, ABSENT: 3 };
const TIER_RANK = { CLASS: 1, SECTOR: 2, SECTOR_ADMIN: 3, ADMIN: 4 };

/* ---------- State shared by the scripts of one page ---------- */
export const state = { session: null, config: {}, year: '', students: [], classes: [], groups: [] };

export const isAdmin = () => state.session?.tier === 'ADMIN';
export const isExec = () => (TIER_RANK[state.session?.tier] ?? 0) >= TIER_RANK.SECTOR_ADMIN;
// The server decides; this only hides buttons that would be refused.
export const canWriteClass = (classId) => isAdmin() || (state.session?.classIds ?? []).includes(Number(classId));
export const className = (classId) => state.classes.find((c) => c.id === Number(classId))?.name ?? '';
export const personName = (person) => [person.saintName, person.fullName].filter(Boolean).join(' ');
export const photoUrl = (student) => `/api/students/${student.id}/photo?v=${student.photoVersion}`;

// The classes offered in a dropdown: those in scope, or all of them for a user without any.
export function scopeClasses() {
  const mine = state.classes.filter((c) => (state.session?.classIds ?? []).includes(c.id));
  return mine.length ? mine : state.classes;
}

/* ---------- DOM helpers ---------- */
export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let toastTimer;
export function toast(message) {
  const box = $('toastbox');
  if (!box) return;
  box.textContent = message;
  box.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.style.display = 'none'; }, 5000);
}

// items: [{ v: value, t: text }]
export function fillSel(selectId, items, value) {
  const select = $(selectId);
  if (!select) return;
  select.innerHTML = items.map((it) => `<option value="${esc(it.v)}">${esc(it.t ?? it.v)}</option>`).join('');
  if (value !== undefined) select.value = value;
}

export function fillClasses(...selectIds) {
  const items = scopeClasses().map((c) => ({ v: c.id, t: c.name }));
  selectIds.forEach((id) => fillSel(id, items));
}

export function setVis(selector, on) {
  // The stylesheet hides these until they carry .shown, so each keeps its own display (cell, inline, flex…).
  document.querySelectorAll(selector).forEach((el) => el.classList.toggle('shown', on));
}

// Tabs: buttons .tab-btn[data-tab] show the pane with that id; handlers[tabId] runs each time its tab is shown.
export function setupTabs(handlers = {}) {
  const show = (tabId) => {
    document.querySelectorAll('[data-pane]').forEach((pane) => { pane.style.display = pane.id === tabId ? 'block' : 'none'; });
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabId));
    return handlers[tabId]?.();
  };
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => show(btn.dataset.tab)));
  return show;
}

export function exportExcel(tableId, filename) {
  const table = $(tableId);
  if (!table) return;
  const wb = XLSX.utils.table_to_book(table, { sheet: 'Sheet1', raw: true });
  const ws = wb.Sheets.Sheet1;
  // Numbers shown with a decimal comma or as plain digits become numbers in the file.
  Object.keys(ws).filter((k) => k[0] !== '!').forEach((addr) => {
    const cell = ws[addr];
    if (cell.t !== 's') return;
    if (/^\d+,\d+$/.test(cell.v)) { cell.v = parseFloat(cell.v.replace(',', '.')); cell.t = 'n'; delete cell.w; }
    else if (/^\d{1,9}$/.test(cell.v)) { cell.v = parseInt(cell.v, 10); cell.t = 'n'; delete cell.w; }
  });
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/* ---------- Numbers ---------- */
export const fmt1 = (v) => (v == null || v === '' ? '—' : (Math.round(+v * 100) / 100).toLocaleString('vi-VN'));
export const pct = (part, whole) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

/* ---------- Dates: 'YYYY-MM-DD' strings, computed in UTC so the browser time zone never shifts a day ---------- */
const DAY = 86400000;
const parseIso = (iso) => new Date(`${iso}T00:00:00Z`);
const formatIso = (date) => date.toISOString().slice(0, 10);
const isIso = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(parseIso(iso).getTime());

/** Today's date in Vietnam. */
export function vnTodayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
}

/** The Sunday on or before the date (default: today). */
export function lastSunday(iso = vnTodayIso()) {
  const d = parseIso(iso);
  return formatIso(new Date(d.getTime() - d.getUTCDay() * DAY));
}

/** The Sunday on or after the date (default: today). */
export function upcomingSunday(iso = vnTodayIso()) {
  const d = parseIso(iso);
  return formatIso(new Date(d.getTime() + ((7 - d.getUTCDay()) % 7) * DAY));
}

/** 'Tuần 20/09/2026 - 26/09/2026' for a Sunday. */
export function weekLabel(iso) {
  if (!isIso(iso)) return '';
  return `Tuần ${fmtDate(iso)} - ${fmtDate(formatIso(new Date(parseIso(iso).getTime() + 6 * DAY)))}`;
}

/** A week input always holds a Sunday: an empty or invalid value becomes the last Sunday, any other day moves back. */
export function snapToSunday(inputEl) {
  if (!inputEl) return;
  inputEl.value = isIso(inputEl.value) ? lastSunday(inputEl.value) : lastSunday();
  const label = inputEl.dataset.weekLabel && $(inputEl.dataset.weekLabel);
  if (label) label.textContent = weekLabel(inputEl.value);
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY'. */
export function fmtDate(value) {
  const m = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value ?? '');
}

/** A date typed or read from Excel ('YYYY-MM-DD', 'D/M/YYYY' or a Date) -> 'YYYY-MM-DD'; '' when it is not a date. */
export function toIsoDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    // SheetJS dates can sit a few seconds before local midnight; half a day later is safely the same day.
    const d = new Date(value.getTime() + DAY / 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const text = String(value ?? '').trim();
  if (isIso(text)) return text;
  const m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
  return isIso(iso) && formatIso(parseIso(iso)) === iso ? iso : '';
}

/* ---------- Loading overlay ---------- */
let pending = 0;
let overlay = null;

function showLoading() {
  if (!document.body.dataset.role) return;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="loading-box"><div class="loading-spinner"></div><div class="loading-text">Đang tải…</div></div>';
    document.body.appendChild(overlay);
  }
  overlay.classList.add('active');
}

function hideLoading() {
  setTimeout(() => {
    if (pending > 0) return;
    if (overlay) overlay.classList.remove('active');
    document.body.classList.add('ready');
  }, 0);
}

if (document.body && document.body.dataset.role) showLoading();

/* ---------- API client ---------- */
const RETRIES = 3;
const BUSY = new Set([502, 503, 504]);

// One request. Retried only when the server could not be reached or is busy; an answer such as
// "no right" or "wrong input" is final and is thrown at once as an Error with .status.
async function request(path, init) {
  pending += 1;
  showLoading();
  try {
    for (let attempt = 1; ; attempt += 1) {
      let res;
      try {
        res = await fetch(path, { credentials: 'same-origin', ...init });
      } catch (e) {
        if (attempt >= RETRIES) throw new Error('Mất kết nối máy chủ.');
      }
      if (res && !(BUSY.has(res.status) && attempt < RETRIES)) {
        const json = await res.json().catch(() => null);
        if (res.ok && json && json.status !== 'error') return json;
        const error = new Error(json?.message || `Máy chủ trả về lỗi (HTTP ${res.status}).`);
        error.status = res.status;
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  } finally {
    pending -= 1;
    hideLoading();
  }
}

export const api = (action, body) => request(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

// For the routes that are not actions (student photos): body is sent as it is.
export const apiSend = (method, path, body) => request(path, { method, body });

/* ---------- Lists kept in state ---------- */
const LISTS = { students: 'getStudents', classes: 'getClasses', groups: 'getGroups' };

export async function load(...names) {
  const results = await Promise.all(names.map((name) => api(LISTS[name])));
  names.forEach((name, i) => { state[name] = results[i][name] ?? []; });
}

// Girls first, then boys, then by first name in the Vietnamese alphabet.
const genderRank = (g) => (g === 'F' ? 0 : g === 'M' ? 1 : 2);
export function sortStudents(rows) {
  return rows.slice().sort((a, b) => genderRank(a.gender) - genderRank(b.gender) || String(a.firstName ?? '').localeCompare(String(b.firstName ?? ''), 'vi'));
}

/* ---------- Page shell ---------- */
const NAV = [
  ['/lessons/', '📕 Giảng dạy', ''],
  ['/attendance/', '✅ Chuyên cần', ''],
  ['/academics/', '🎓 Học tập', ''],
  ['/students/', '👥 Thiếu nhi', ''],
  ['/teachers/', '🧑‍🏫 Huynh trưởng', 'exec-only'],
  ['/admin/', '⚙ Quản trị', 'admin-only'],
];

function shell() {
  const body = document.body;
  const links = NAV.map(([href, text, role]) => `<a class="nav-link${role ? ` ${role}` : ''}" href="${href}">${text}</a>`).join('');
  const logout = '<a class="nav-logout" href="/auth/logout">🔒 Đăng xuất</a>';
  const brand = '<a href="/" class="flex items-center gap-2.5 no-underline">'
    + '<label for="menu-toggle" class="menu-hamburger md:hidden" aria-label="Mở menu">☰</label>'
    + '<img src="/logo.png" alt="TNTT Nghĩa Hòa" class="h-9 w-9 rounded-lg">'
    + '<span class="text-blue-900 font-extrabold text-sm sm:text-base leading-tight">Quản lý học vụ TNTT Nghĩa Hòa</span></a>';
  $('shell').innerHTML = '<input type="checkbox" id="menu-toggle" class="menu-toggle">'
    + '<nav class="sticky top-0 z-40 bg-white/95 backdrop-blur shadow-sm border-b border-slate-200">'
    + `<div class="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">${brand}`
    + `<div class="hidden md:flex items-center gap-1">${links}${logout}</div>`
    + '</div></nav>'
    + '<label for="menu-toggle" class="menu-backdrop" aria-hidden="true"></label>'
    + '<aside class="menu-drawer">'
    + `<div class="flex items-center justify-between px-4 py-3 border-b border-slate-200">${brand}`
    + '<label for="menu-toggle" class="menu-close" aria-label="Đóng menu">✕</label></div>'
    + `<div class="px-3 py-3 flex flex-col gap-1">${links}${logout}</div></aside>`
    + '<div class="max-w-7xl mx-auto px-4 pt-4">'
    + '<header class="banner text-white p-6 rounded-xl shadow-lg mb-4">'
    + `<h1 class="text-2xl font-extrabold">${esc(body.dataset.title || '')}</h1>`
    + (body.dataset.sub ? `<p class="text-blue-200 text-sm mt-1">${esc(body.dataset.sub)}</p>` : '')
    + '</header>'
    + '<div id="toastbox" style="position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:.6rem 1.1rem;border-radius:8px;font-size:.85rem;display:none;max-width:80%;z-index:200"></div></div>';
}

// Leaves the page; the promise never settles, so the page script stops here.
function leave(url) {
  location.replace(url);
  return new Promise(() => {});
}

/** Every page starts here: session, configuration, role check, shell. Session and config are asked in parallel. */
export async function initCommon() {
  const query = new URLSearchParams(location.search);
  if (query.get('login') === 'denied') return leave('/login/?login=denied');
  if (query.get('login') === 'error') return leave(`/login/?login=error&msg=${encodeURIComponent(query.get('msg') || '')}`);
  try {
    const [session, config] = await Promise.all([api('getSession'), api('getConfig')]);
    state.session = session.session;
    state.config = Object.fromEntries(config.config.map((c) => [c.key, c.value]));
    state.year = state.config.CurrentSchoolYear ?? '';
  } catch (e) {
    return leave(e.status === 401 ? '/login/' : `/login/?login=error&msg=${encodeURIComponent(e.message)}`);
  }

  const role = document.body.dataset.role;
  if (role === 'admin' && !isAdmin()) return leave('/');
  if (role === 'exec' && !isExec()) return leave('/');

  shell();
  setVis('.exec-only', isExec());
  setVis('.admin-only', isAdmin());
}

window.addEventListener('error', (e) => toast(`Lỗi: ${e.message || 'unknown'}`));
window.addEventListener('unhandledrejection', (e) => toast(`Lỗi: ${e.reason && e.reason.message ? e.reason.message : String(e.reason)}`));
