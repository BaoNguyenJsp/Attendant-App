/* =====================================================================
   SỔ THIẾU NHI — shared/ui.js
   Small rendering helpers used by more than one page.
   ===================================================================== */
'use strict';

import { $, esc, fmtDate, MARK } from './common.js';
import { TIER_LABEL, TIER_BADGE, SESSION_LABEL, SESSION_SHORT_LABEL, MARK_LABEL } from './labels.js';

const TONES = {
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  blue: 'bg-blue-100 text-blue-700',
  grey: 'bg-slate-200 text-slate-600',
};

export const badge = (text, tone = 'grey') => `<span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${TONES[tone] ?? TONES.grey}">${esc(text || '—')}</span>`;

export const STATUS_TONE = { ACTIVE: 'blue', INACTIVE: 'red', GRADUATED: 'grey' };

// The badge of a group type or of a user's tier.
export const tierBadge = (type) => `<span class="badge ${TIER_BADGE[type] ?? 'b-class'}">${esc(TIER_LABEL[type] ?? '—')}</span>`;

// The table of missed sessions used by the two absence lookups. absences: [{ weekOf, session, mark }].
export function absenceTable(tableId, absences) {
  const rows = absences.length
    ? absences.map((a) => `<tr><td class="p-2 border text-center">${esc(fmtDate(a.weekOf))}</td><td class="p-2 border text-center">${esc(SESSION_LABEL[a.session])}</td><td class="p-2 border text-center">${esc(MARK_LABEL[a.mark])}</td></tr>`).join('')
    : '<tr><td colspan="3" class="p-4 text-center text-slate-400">Không có buổi vắng trong năm học này.</td></tr>';
  return `<div style="overflow-x:auto"><table id="${esc(tableId)}" class="w-full text-sm border-collapse min-w-[560px]"><thead>`
    + '<tr class="bg-blue-900 text-white text-xs uppercase font-bold text-center"><th class="p-3 border">Tuần</th><th class="p-3 border">Buổi</th><th class="p-3 border">Tình trạng</th></tr>'
    + `</thead><tbody>${rows}</tbody></table></div>`;
}

// Opens a print window with a title, a subtitle (HTML), one table (HTML) and the two signature blocks.
// Returns false when the browser blocked the window.
export function printDocument({ title, subtitle, tableHtml, leftSignature, landscape = false, leftColumn = 2 }) {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title><style>
    body{font-family:'Times New Roman',Times,serif;padding:20px;color:#000}
    .header{text-align:center;margin-bottom:20px}
    .header h2{margin:0;font-size:20px;text-transform:uppercase}
    .header h3{margin:5px 0 0;font-size:16px;font-weight:normal}
    table{width:100%;border-collapse:collapse;margin-top:15px;font-size:13px}
    th,td{border:1px solid #000;padding:6px;text-align:center}
    th{background:#f4f4f4;font-weight:bold}
    td:nth-child(${leftColumn}){text-align:left}
    .footer{margin-top:40px;display:flex;justify-content:space-between;font-size:15px}
    .signature{text-align:center;width:40%}
    @media print{@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:15mm}}
  </style></head><body>
    <div class="header"><h2>${esc(title)}</h2><h3>${subtitle}</h3></div>
    ${tableHtml}
    <div class="footer">
      <div class="signature"><p><b>${esc(leftSignature)}</b></p><br><br><br></div>
      <div class="signature"><p><b>Xứ đoàn trưởng</b></p><br><br><br></div>
    </div>
  </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 250);
  return true;
}

/* ---------- Attendance card view (student and teacher attendance tabs) ---------- */
// Both pages keep the table/card choice under one key, so it holds per browser.
const VIEW_KEY = 'attendanceView';

// Switches #t-attendance between the table and the card view (.v2); onChange redraws the page after a click.
// Returns a getter: true while the card view is on.
export function setupViewToggle(button, onChange) {
  let cards = false;
  try { cards = localStorage.getItem(VIEW_KEY) === 'cards'; } catch { /* storage blocked: table view */ }
  const apply = () => {
    $('t-attendance').classList.toggle('v2', cards);
    button.textContent = cards ? '🗂 Bảng' : '📱 Thẻ';
    button.title = cards ? 'Đổi sang giao diện bảng' : 'Đổi sang giao diện thẻ (mới, dễ dùng trên điện thoại)';
  };
  button.addEventListener('click', () => {
    cards = !cards;
    try { localStorage.setItem(VIEW_KEY, cards ? 'cards' : 'table'); } catch { /* not kept: still switches now */ }
    apply();
    onChange();
  });
  apply();
  return () => cards;
}

// The holiday sessions of the week cannot be picked; when the picked one is a holiday, the first open session is picked instead.
// When every session is a holiday the pick stays, and the page locks the marks.
export function lockHolidays(select, holidays) {
  const off = new Set(holidays.map((h) => h.session));
  for (const option of select.options) {
    option.disabled = off.has(option.value);
    option.textContent = `${SESSION_LABEL[option.value]}${option.disabled ? ' (nghỉ)' : ''}`;
  }
  if (select.selectedOptions[0]?.disabled) select.value = [...select.options].find((o) => !o.disabled)?.value ?? select.value;
}

// One tab per session; a green dot marks a session that has any mark this week; holiday tabs are disabled. rows: [{ marks }].
export const sessionTabs = (codes, current, rows, holidays = []) => codes.map((c) => `<button type="button" data-session="${c}" title="${esc(SESSION_LABEL[c])}"`
  + `${holidays.some((h) => h.session === c) ? ' disabled' : ''}`
  + ` class="relative py-2 px-0.5 rounded-lg text-[11px] sm:text-xs font-bold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${c === current ? 'bg-blue-900 text-white' : 'bg-slate-200 text-slate-700'}">${esc(SESSION_SHORT_LABEL[c])}`
  + `${rows.some((r) => r.marks[c] !== MARK.NONE) ? '<span class="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500"></span>' : ''}</button>`).join('');

const markButton = (i, mark, on, sign, label, title, onClass, editable) => `<button type="button" title="${title}" class="att-mark w-12 h-11 rounded-lg flex flex-col items-center justify-center leading-none ${on ? onClass : 'bg-slate-200 text-slate-500'}"`
  + ` data-i="${i}" data-which="${mark}" aria-pressed="${on}"${editable ? '' : ' disabled'}><span class="text-base font-extrabold">${sign}</span><span class="text-[10px] font-bold mt-0.5">${label}</span></button>`;

// One card per person, with the data of its table row. items: [{ title, sub, mark }]; title and sub are HTML.
export function markCards(items, editable, emptyText) {
  return items.map(({ title, sub, mark }, i) => {
    const present = mark === MARK.PRESENT;
    const excused = mark === MARK.EXCUSED;
    const tone = present ? 'border-emerald-500 bg-emerald-50' : excused ? 'border-amber-500 bg-amber-50' : 'border-slate-200 bg-white';
    return `<div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border-2 ${tone}"><div class="min-w-0">`
      + `<div class="text-sm font-bold text-slate-800 leading-tight">${title}</div><div class="text-[11px] text-slate-500 truncate">${sub}</div></div>`
      + `<div class="flex gap-1 flex-none">${markButton(i, MARK.PRESENT, present, '✓', 'Có mặt', 'Hiện diện', 'bg-emerald-500 text-white', editable)}`
      + `${markButton(i, MARK.EXCUSED, excused, 'P', 'Phép', 'Có phép', 'bg-amber-500 text-white', editable)}</div></div>`;
  }).join('') || `<p class="p-4 text-center text-slate-400">${esc(emptyText)}</p>`;
}

// Asked before leaving a week with unsaved marks. Resolves to 'save', 'drop' or 'stay'; a tap outside the box is 'stay'.
let unsavedBox;
export function askUnsaved() {
  if (!unsavedBox) {
    unsavedBox = document.createElement('div');
    unsavedBox.className = 'modal';
    unsavedBox.innerHTML = '<div class="modal-content"><h3>⚠ Có thay đổi chưa lưu</h3>'
      + '<p class="text-sm text-slate-600 mb-4">Điểm danh tuần này chưa được lưu. Bạn muốn làm gì?</p><div class="flex flex-col gap-2">'
      + '<button type="button" data-choice="save" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg">💾 Lưu rồi chuyển</button>'
      + '<button type="button" data-choice="drop" class="bg-red-100 hover:bg-red-200 text-red-700 font-bold py-3 rounded-lg">Bỏ thay đổi</button>'
      + '<button type="button" data-choice="stay" class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-3 rounded-lg">Ở lại</button></div></div>';
    document.body.appendChild(unsavedBox);
  }
  unsavedBox.classList.add('open');
  return new Promise((resolve) => {
    unsavedBox.onclick = (e) => {
      const choice = e.target.closest('[data-choice]')?.dataset.choice ?? (e.target === unsavedBox ? 'stay' : null);
      if (!choice) return;
      unsavedBox.classList.remove('open');
      resolve(choice);
    };
  });
}

// Moves a week input by whole weeks; false when it holds no date.
export function shiftWeek(input, weeks) {
  const day = new Date(`${input.value}T00:00:00Z`);
  if (Number.isNaN(day.getTime())) return false;
  day.setUTCDate(day.getUTCDate() + 7 * weeks);
  input.value = day.toISOString().slice(0, 10);
  return true;
}
