/* =====================================================================
   SỔ THIẾU NHI — shared/ui.js
   Small rendering helpers used by more than one page.
   ===================================================================== */
'use strict';

import { esc, fmtDate } from './common.js';
import { TIER_LABEL, TIER_BADGE, SESSION_LABEL, MARK_LABEL } from './labels.js';

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
