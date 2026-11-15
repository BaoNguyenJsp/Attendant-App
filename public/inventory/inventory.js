/* =====================================================================
   SỔ THIẾU NHI — inventory/inventory.js
   Warehouse: items and their stock, requests (phiếu mượn / xuất) that a keeper approves,
   returns with a photo. Everyone sees who holds each item.
   Keepers (BQT ngành / Xứ đoàn, isExec) manage items, stock and locations and see every request;
   everyone else asks for items, gives them back and sees only their own requests.
   ===================================================================== */
'use strict';

import {
  initCommon, load, state, $, api, apiSend, esc, toast, setupTabs, isExec, personName, fmtDate, vnTodayIso,
} from '../shared/common.js';
import { ITEM_KIND_LABEL, REQUEST_STATUS_LABEL, PHOTO_STAGE_LABEL } from '../shared/labels.js';
import { searchKey } from '../shared/search.js';
import { badge, cropPhoto, shrinkPhoto, pickImage, takePhoto } from '../shared/ui.js';

await initCommon();
await load('groups');

let items = [];
let locations = [];
let requests = [];
let loans = []; // who holds what: every open loan, for everyone
let myPhone = '';
let filter = 'all'; // stat tile picked: all | low | critical | loan
const openHolders = new Set(); // items whose borrower list is unfolded, kept across re-renders
let current = null; // { item, action } while the item sheet is open; item null = new item
let pendingPhoto = null; // a photo picked for a new item, uploaded after it is created
let requestPhoto = null; // the photo picked in the request sheet
let evidence = null; // { request, stage, blob } while the evidence sheet is open

const keeper = isExec();
const me = personName(state.session ?? {});
const today = vnTodayIso();
const DUE_DAYS = 7;
const byId = (id) => items.find((i) => i.id === Number(id));
const requestById = (id) => requests.find((r) => r.id === Number(id));
const pct = (i) => (i.total ? Math.round((i.available / i.total) * 100) : 0);
// Returnable: same thresholds as the old warehouse sheet, under 10 % critical, up to 50 % low.
// Consumable: no percentage (its total is only the highest level reached), just empty or not.
const level = (i) => (i.kind === 'CONSUMABLE' ? (i.available ? 'ok' : 'critical') : pct(i) < 10 ? 'critical' : pct(i) <= 50 ? 'low' : 'ok');
const LEVEL_TONE = { critical: ['text-red-600', 'bg-red-500'], low: ['text-amber-600', 'bg-amber-400'], ok: ['text-emerald-600', 'bg-emerald-500'] };
// Only an approval takes units off the shelf, so what a returnable item misses is out on loan.
const onLoan = (i) => (i.kind === 'RETURNABLE' ? i.total - i.available : 0);
const leftLabel = (i) => (i.kind === 'RETURNABLE' ? 'Sẵn sàng' : 'Còn lại');
const itemPhotoUrl = (i) => `/api/items/${i.id}/photo?v=${encodeURIComponent(i.photoFileId)}`;
const photo = (i, size = 'w-14 h-14') => (i?.photoFileId
  ? `<img src="${itemPhotoUrl(i)}" loading="lazy" alt="" class="${size} object-cover rounded-xl flex-none bg-slate-100">`
  : `<div class="${size} rounded-xl flex-none bg-slate-100 flex items-center justify-center text-2xl">📦</div>`);
const addDays = (iso, n) => {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + n);
  return day.toISOString().slice(0, 10);
};
const daysLate = (r) => (r.status === 'ON_LOAN' && r.dueDate && r.dueDate < today ? Math.round((Date.parse(today) - Date.parse(r.dueDate)) / 864e5) : 0);
const isMine = (r) => r.userId === state.session?.userId;
const lending = (r) => r.lines.some((l) => byId(l.itemId)?.kind === 'RETURNABLE');
const linesText = (r) => r.lines.map((l) => `${byId(l.itemId)?.name ?? '?'} ×${l.quantity}`).join(', ');
const code = (r) => `YC-${r.id}`;

const requestPhotoUrl = (r, p) => `/api/requests/${r.id}/photos/${encodeURIComponent(p.fileId)}`;
// A photo with a label in one corner and a button in the other.
const photoBox = (src, label, button) => `<div class="relative"><img src="${esc(src)}" alt="" class="w-full max-h-64 object-contain rounded-xl bg-slate-100">`
  + `<span class="absolute top-2 left-2">${label}</span>${button}</div>`;
const cornerButton = (attr, text) => `<button type="button" ${attr} class="absolute top-2 right-2 bg-white/90 text-red-600 font-bold rounded-lg px-2 py-1 text-sm shadow">${text}</button>`;
const newPhoto = (blob, attr) => (blob ? photoBox(URL.createObjectURL(blob), badge('Ảnh mới', 'green'), cornerButton(attr, '✕ Bỏ')) : '');

async function reload() {
  ({ items, locations, requests, loans, myPhone } = await api('getInventory'));
  render();
}

function render() {
  renderStats();
  renderItems();
  renderRequests();
  renderPickers();
}

/* ---------- Tab 1: items ---------- */
function renderStats() {
  const tiles = [
    ['all', 'Tổng mặt hàng', items.length, 'bg-white border-slate-200 text-slate-800'],
    ['low', 'Tồn thấp (10–50%)', items.filter((i) => level(i) === 'low').length, 'bg-amber-50 border-amber-200 text-amber-700'],
    ['critical', 'Rất thấp / Hết (<10%)', items.filter((i) => level(i) === 'critical').length, 'bg-red-50 border-red-200 text-red-600'],
    ['loan', 'Đang cho mượn', items.reduce((n, i) => n + onLoan(i), 0), 'bg-indigo-50 border-indigo-200 text-indigo-700'],
  ];
  $('inv-stats').innerHTML = tiles.map(([key, label, n, tone]) => `<button type="button" data-filter="${key}" class="stat ${filter === key ? 'on' : ''} text-left border rounded-xl p-3 ${tone}">`
    + `<div class="text-[11px] sm:text-xs font-semibold opacity-80 leading-tight">${label}</div><div class="text-2xl sm:text-3xl font-extrabold mt-1">${n}</div></button>`).join('');
}

// The bottom part of a card: who holds the item now. Two lines each: the name (and "Quá hạn" when late),
// then team, how many, since when. Two people fit; more scroll inside.
function holders(i) {
  const list = loans.filter((l) => l.itemId === i.id);
  if (!list.length) return '';
  const rows = list.map((l) => {
    const late = l.dueDate && l.dueDate < today;
    return `<div class="py-1.5 pl-2 border-l-2 ${late ? 'border-red-500 text-red-700' : 'border-indigo-300 text-slate-600'}">`
      + `<div class="flex justify-between gap-2 text-sm leading-5"><span class="font-semibold ${late ? '' : 'text-slate-800'} truncate">👤 ${esc(l.borrower)}</span>`
      + (late ? '<span class="flex-none text-xs font-bold leading-5">⚠ Quá hạn</span>' : '') + '</div>'
      + `<div class="text-xs leading-4 truncate">${esc(l.team)} · SL <b>${l.quantity}</b> · từ ${fmtDate((l.since ?? '').slice(0, 10))}`
      + `${l.dueDate ? ` · hẹn trả ${fmtDate(l.dueDate)}` : ''}</div></div>`;
  }).join('');
  const late = list.filter((l) => l.dueDate && l.dueDate < today).length;
  return '<div class="mt-auto pt-3">'
    + `<details data-holders="${i.id}" class="group -mx-3 -mb-3 px-3 py-2 bg-slate-50 border-t border-slate-200 rounded-b-xl"${openHolders.has(i.id) ? ' open' : ''}>`
    + '<summary class="flex items-center justify-between gap-2 text-xs font-bold text-slate-500 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">'
    + `<span>👥 Đang mượn · ${list.length} người${late ? ` · <span class="text-red-600">⚠ ${late} quá hạn</span>` : ''}</span>`
    + `<span class="text-indigo-600">${list.length > 2 ? '<span class="hidden group-open:inline">↕ cuộn để xem · </span>' : ''}<span class="group-open:hidden">Xem ▾</span><span class="hidden group-open:inline">Thu gọn ▴</span></span></summary>`
    + `<div class="mt-1 max-h-[6.25rem] overflow-y-auto overscroll-contain pr-1">${rows}</div></details></div>`;
}

// Top: landscape photo in the corner, name and badges, the count. Bottom: who holds it.
function itemCard(i) {
  const [text, fill] = LEVEL_TONE[level(i)];
  const out = onLoan(i);
  const status = i.available === 0 ? badge(out ? 'Đang mượn hết' : 'Hết hàng', 'red') : level(i) === 'low' ? badge('Sắp hết', 'amber') : '';
  return `<div role="button" tabindex="0" data-item="${i.id}" class="cursor-pointer w-full text-left flex flex-col p-3 rounded-xl border ${level(i) === 'ok' ? 'border-slate-200' : level(i) === 'low' ? 'border-amber-300' : 'border-red-300'} bg-white hover:bg-slate-50 active:bg-slate-100">`
    + '<div class="flex items-start gap-3">'
    + photo(i, 'w-28 h-[5.25rem] sm:w-32 sm:h-24')
    + '<div class="min-w-0 flex-1">'
    + `<div class="font-bold text-slate-800 truncate">${esc(i.name)}</div>`
    + `<div class="text-xs text-slate-500 truncate">${esc(i.code)}${i.location ? ` · 📍 ${esc(i.location)}` : ''}</div>`
    + `<div class="flex flex-wrap gap-1 mt-1">${badge(ITEM_KIND_LABEL[i.kind], i.kind === 'RETURNABLE' ? 'blue' : 'grey')}${status}${out ? badge(`${out} đang mượn`, 'blue') : ''}</div>`
    + (i.kind === 'RETURNABLE' ? `<div class="bar mt-2"><div class="${fill}" style="width:${pct(i)}%"></div></div>` : '')
    + '</div>'
    + `<div class="text-right flex-none"><div class="text-2xl font-extrabold ${text}">${i.available}${i.kind === 'RETURNABLE' ? `<span class="text-slate-400 text-sm font-bold"> / ${i.total}</span>` : ''}</div>`
    + `<div class="text-[11px] text-slate-500">${leftLabel(i)}</div></div></div>`
    + holders(i) + '</div>';
}

function renderItems() {
  const q = searchKey($('inv-q').value);
  const kind = $('inv-kind').value;
  const stock = $('inv-stock').value;
  const isLate = (l) => l.dueDate && l.dueDate < today;
  const STOCK = {
    in: (i) => i.available > 0,
    out: (i) => i.available === 0,
    loan: (i) => loans.some((l) => l.itemId === i.id), // out with someone, not yet returned
    late: (i) => loans.some((l) => l.itemId === i.id && isLate(l)), // and past the due date
  };
  const location = $('inv-location').value;
  const rank = { critical: 0, low: 1, ok: 2 };
  const list = items
    .filter((i) => (filter === 'all' || (filter === 'loan' ? onLoan(i) > 0 : level(i) === filter))
      && (!kind || i.kind === kind)
      && (!stock || STOCK[stock](i))
      && (!location || String(i.locationId ?? 'none') === location)
      && (!q || searchKey(`${i.name} ${i.code}`).includes(q)))
    // What needs attention first.
    .sort((a, b) => rank[level(a)] - rank[level(b)] || (a.kind === 'RETURNABLE' && b.kind === 'RETURNABLE' ? pct(a) - pct(b) : 0) || a.name.localeCompare(b.name, 'vi'));
  $('inv-list').innerHTML = list.map(itemCard).join('')
    || `<p class="col-span-full p-8 text-center text-slate-400">${items.length ? 'Không có vật phẩm phù hợp.' : 'Kho chưa có vật phẩm nào.'}</p>`;
}

// The dropdowns built from the data: locations, teams.
function renderPickers() {
  const options = (list, keep, first) => `${first}${list.map(([v, t]) => `<option value="${esc(v)}"${String(v) === keep ? ' selected' : ''}>${esc(t)}</option>`).join('')}`;
  const locs = locations.map((l) => [l.id, l.name]);
  $('inv-location').innerHTML = options([...locs, ['none', 'Chưa có nơi để']], $('inv-location').value, '<option value="">Tất cả nơi để</option>');
  $('if-location').innerHTML = options(locs, $('if-location').value, '<option value="">— Chưa chọn —</option>');
  const teams = [...new Set(requests.map((r) => r.team))].sort((a, b) => a.localeCompare(b, 'vi'));
  $('req-team').innerHTML = options(teams.map((t) => [t, t]), $('req-team').value, '<option value="">Tất cả đội nhóm</option>');
  const groups = [...new Set(state.groups.map((g) => g.name))].sort((a, b) => a.localeCompare(b, 'vi'));
  $('rq-team').innerHTML = options(groups.map((g) => [g, g]), $('rq-team').value, '<option value="">— Chọn đội nhóm / ban —</option>');
  renderLocations();
}

/* ---------- Tab 2: requests ---------- */
const STATUS_TONE = { PENDING: 'amber', ON_LOAN: 'blue', CLOSED: 'green', REJECTED: 'grey' };
// Waiting first (a keeper acts on them), then late, then out, then the rest newest first.
const requestRank = (r) => (r.status === 'PENDING' ? 0 : daysLate(r) ? 1 : r.status === 'ON_LOAN' ? 2 : 3);

function requestCard(r) {
  const late = daysLate(r);
  const buttons = [];
  if (r.status === 'PENDING' && keeper) buttons.push(['approve', '✔ Duyệt', 'bg-emerald-600 hover:bg-emerald-700 text-white'], ['reject', '✖ Từ chối', 'bg-slate-100 hover:bg-slate-200 text-slate-700']);
  else if (r.status === 'PENDING' && isMine(r)) buttons.push(['photo', '📷 Ảnh', 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'], ['reject', 'Hủy phiếu', 'bg-slate-100 hover:bg-slate-200 text-slate-700']);
  if (r.status === 'ON_LOAN' && (keeper || isMine(r))) buttons.push(['return', '↩ Trả đồ', 'bg-emerald-600 hover:bg-emerald-700 text-white']);
  if (r.status === 'ON_LOAN' && keeper) buttons.push(['zalo', '💬 Nhắc Zalo', 'bg-blue-600 hover:bg-blue-700 text-white']);
  const photos = r.photos.map((p) => `<a href="${requestPhotoUrl(r, p)}" target="_blank" rel="noopener" title="${esc(PHOTO_STAGE_LABEL[p.stage])} · ${esc(p.byName ?? '')}">`
    + `<img src="${requestPhotoUrl(r, p)}" loading="lazy" alt="${esc(PHOTO_STAGE_LABEL[p.stage])}" class="w-12 h-12 object-cover rounded-lg bg-slate-100"></a>`).join('');
  return `<div class="flex flex-col p-3 rounded-xl border ${late ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-white'}">`
    + `<div class="flex items-center justify-between gap-2"><span class="font-extrabold text-slate-800">${code(r)}</span>`
    + `<span class="flex gap-1">${late ? badge(`Quá hạn ${late} ngày`, 'red') : ''}${badge(REQUEST_STATUS_LABEL[r.status], STATUS_TONE[r.status])}</span></div>`
    + `<div class="text-sm text-slate-700 mt-1">👤 <b>${esc(r.borrower)}</b> · ${esc(r.team)}</div>`
    + `<div class="text-sm text-slate-700">📞 <a class="underline" href="tel:${esc(r.phone)}">${esc(r.phone)}</a></div>`
    + `<div class="text-sm text-slate-800 mt-1">📦 ${esc(linesText(r))}</div>`
    + (r.note ? `<div class="text-xs text-slate-500 italic">${esc(r.note)}</div>` : '')
    + `<div class="text-xs ${late ? 'text-red-700 font-bold' : 'text-slate-500'} mt-1">Tạo ${fmtDate(r.createdAt.slice(0, 10))}${r.byName ? ` bởi ${esc(r.byName)}` : ''}${r.dueDate ? ` · hẹn trả ${fmtDate(r.dueDate)}` : ''}</div>`
    + (r.decidedBy ? `<div class="text-xs text-slate-500">${r.status === 'REJECTED' ? 'Từ chối / hủy' : 'Duyệt'}: ${esc(r.decidedBy)}${r.returnedBy ? ` · Nhận trả: ${esc(r.returnedBy)}` : ''}</div>` : '')
    + (photos ? `<div class="flex flex-wrap gap-1.5 mt-2">${photos}</div>` : '')
    + (buttons.length ? `<div class="grid grid-flow-col auto-cols-fr gap-2 mt-auto pt-2">${buttons.map(([act, label, tone]) => `<button type="button" data-${act}="${r.id}" class="${tone} font-bold rounded-lg py-2.5 text-sm">${label}</button>`).join('')}</div>` : '')
    + '</div>';
}

function renderRequests() {
  const pending = requests.filter((r) => r.status === 'PENDING').length;
  const out = requests.filter((r) => r.status === 'ON_LOAN').length;
  const late = requests.filter(daysLate).length;
  $('req-count').innerHTML = (keeper && pending ? badge(String(pending), 'amber') : '') + (late ? badge(String(late), 'red') : !keeper && out ? badge(String(out), 'blue') : '');
  const q = searchKey($('req-q').value);
  const status = $('req-status').value;
  const team = $('req-team').value;
  const list = requests
    .filter((r) => (!status || (status === 'LATE' ? daysLate(r) > 0 : r.status === status))
      && (!team || r.team === team)
      && (!q || searchKey(`${code(r)} ${r.borrower} ${r.phone} ${r.team} ${r.byName ?? ''} ${r.note ?? ''} ${linesText(r)}`).includes(q)))
    .sort((a, b) => requestRank(a) - requestRank(b) || b.id - a.id);
  $('req-summary').textContent = `${keeper ? '' : 'Phiếu của bạn · '}${pending} chờ duyệt · ${out} đang mượn${late ? ` · ${late} quá hạn` : ''}`;
  $('req-list').innerHTML = list.map(requestCard).join('')
    || `<p class="col-span-full p-8 text-center text-slate-400">${requests.length ? 'Không có phiếu phù hợp.' : 'Chưa có phiếu nào. Bấm vào một vật phẩm ở tab Vật phẩm để tạo phiếu.'}</p>`;
}

async function act(action, r, done) {
  try {
    await api(action, { id: r.id });
    toast(done);
    await reload();
  } catch (e) {
    toast(`Lỗi: ${e.message}`);
    await reload();
  }
}

function approve(r) {
  // Consumables only: nothing comes back, so no hand-over photo.
  if (!lending(r)) {
    if (confirm(`Duyệt ${code(r)} và xuất kho: ${linesText(r)}?`)) act('approveRequest', r, `✅ Đã duyệt ${code(r)}.`);
    return;
  }
  openEvidence(r, 'APPROVE');
}

function reject(r) {
  const question = keeper && !isMine(r) ? `Từ chối ${code(r)} của ${r.borrower}?` : `Hủy ${code(r)}?`;
  if (confirm(question)) act('rejectRequest', r, `Đã ${keeper && !isMine(r) ? 'từ chối' : 'hủy'} ${code(r)}.`);
}

// Zalo cannot be given the text: the reminder goes to the clipboard and the chat opens.
async function remind(r) {
  const late = daysLate(r);
  const text = `Chào ${r.borrower}, Kho Thiếu Nhi nhắc bạn trả đồ đã mượn (phiếu ${code(r)}): ${linesText(r)}. `
    + `Hạn trả: ${fmtDate(r.dueDate)}${late ? ` (đã quá ${late} ngày)` : ''}. Cảm ơn bạn!`;
  try {
    await navigator.clipboard.writeText(text);
    toast('📋 Đã chép lời nhắc. Dán vào khung chat Zalo.');
  } catch {
    prompt('Chép lời nhắc này rồi dán vào Zalo:', text);
  }
  window.open(`https://zalo.me/${encodeURIComponent(r.phone)}`, '_blank', 'noopener');
}

/* ---------- Evidence sheet: hand-over photo at approval, photo of what came back at return,
   and the photo sent with a waiting request (its owner edits it). ---------- */
const EVIDENCE = {
  APPROVE: { title: '📷 Bằng Chứng Giao Đồ', save: 'Lưu Bằng Chứng & Duyệt', action: 'approveRequest', done: 'Đã duyệt', shows: ['SUBMIT', 'APPROVE'] },
  RETURN: { title: '📷 Bằng Chứng Trả Đồ', save: 'Lưu Bằng Chứng & Xác Nhận Trả', action: 'returnRequest', done: 'Đã nhận trả', shows: ['RETURN'] },
  SUBMIT: { title: '📷 Ảnh Bàn Giao Gửi Kèm', save: 'Lưu ảnh', action: null, done: 'Đã lưu ảnh của', shows: ['SUBMIT'] },
};

function openEvidence(r, stage) {
  evidence = { request: r, stage, blob: null };
  $('ev-title').textContent = EVIDENCE[stage].title;
  $('ev-save').textContent = EVIDENCE[stage].save;
  showEvidence();
  $('ev-sheet').classList.add('open');
}

// The photos already on the request: one is enough to approve or return, nothing to take again.
const evidencePhotos = () => evidence.request.photos.filter((p) => EVIDENCE[evidence.stage].shows.includes(p.stage));

function showEvidence() {
  const r = evidence.request;
  const kept = evidencePhotos();
  $('ev-sub').textContent = `${code(r)} · ${r.borrower} · ${linesText(r)}`
    + (kept.length && EVIDENCE[evidence.stage].action ? ' · Đã có ảnh: lưu luôn, hoặc xóa / chụp thêm.' : '');
  $('ev-photo').innerHTML = '<div class="flex flex-col gap-2">'
    + kept.map((p) => photoBox(requestPhotoUrl(r, p), badge(PHOTO_STAGE_LABEL[p.stage], 'blue'), cornerButton(`data-ev-remove="${esc(p.fileId)}"`, '🗑 Xóa'))).join('')
    + newPhoto(evidence.blob, 'data-ev-drop') + '</div>';
  $('ev-save').disabled = !evidence.blob && !(EVIDENCE[evidence.stage].action && kept.length);
}

// After a reload the sheet shows the request as the server has it now.
async function reloadEvidence() {
  await reload();
  evidence.request = requestById(evidence.request.id) ?? evidence.request;
  showEvidence();
}

async function removeEvidencePhoto(fileId) {
  if (!confirm('Xóa ảnh này?')) return;
  try {
    await apiSend('DELETE', `/api/requests/${evidence.request.id}/photos/${encodeURIComponent(fileId)}`);
    toast('Đã xóa ảnh.');
  } catch (e) { toast(`Lỗi: ${e.message}`); }
  await reloadEvidence();
}

async function saveEvidence() {
  const { request: r, stage } = evidence;
  $('ev-save').disabled = true;
  try {
    if (evidence.blob) {
      await apiSend('PUT', `/api/requests/${r.id}/photos/${stage}`, evidence.blob);
      evidence.blob = null; // saved even if the next step fails: a second try does not upload it again
    }
    if (EVIDENCE[stage].action) await api(EVIDENCE[stage].action, { id: r.id });
    closeSheets();
    toast(`✅ ${EVIDENCE[stage].done} ${code(r)}.`);
  } catch (e) {
    toast(`Lỗi: ${e.message}`);
  }
  await reloadEvidence();
}

/* ---------- Request sheet ---------- */
const pickedLines = () => [...$('rq-items').querySelectorAll('input[data-qty]')]
  .map((input) => ({ itemId: Number(input.dataset.qty), quantity: Number(input.value) }))
  .filter((l) => l.quantity > 0);

function updatePicked() {
  const lines = pickedLines();
  $('rq-picked').textContent = `Đã chọn ${lines.length} món`;
  const needsDue = lines.some((l) => byId(l.itemId)?.kind === 'RETURNABLE');
  $('rq-due-hint').textContent = needsDue ? '(bắt buộc với đồ mượn)' : '(chỉ cần với đồ mượn)';
}

function openRequest(itemId) {
  const last = requests.find(isMine); // the user's last request fills the contact fields
  $('rq-borrower').value = me;
  $('rq-phone').value = myPhone || last?.phone || '';
  $('rq-team').value = last?.team ?? '';
  $('rq-due').min = today;
  $('rq-due').value = addDays(today, DUE_DAYS);
  $('rq-note').value = '';
  $('rq-q').value = '';
  showRequestPhoto(null);
  // In stock first, then by name.
  const list = items.slice().sort((a, b) => Number(!a.available) - Number(!b.available) || a.name.localeCompare(b.name, 'vi'));
  $('rq-items').innerHTML = list.map((i) => `<label class="pick-row ${i.available ? '' : 'off'} flex items-center gap-3 p-2 rounded-xl border border-slate-200 bg-white" data-search="${esc(searchKey(`${i.name} ${i.code}`))}">`
    + photo(i, 'w-11 h-11')
    + `<span class="min-w-0 flex-1"><span class="block font-bold text-slate-800 truncate">${esc(i.name)}</span>`
    + `<span class="block text-xs ${i.kind === 'RETURNABLE' ? 'text-blue-600' : 'text-amber-600'}">${i.kind === 'RETURNABLE' ? '🔄 Cho mượn' : '🏷 Xuất tiêu hao'} (${i.available ? `Rảnh: ${i.available}` : 'Hết'})</span></span>`
    + `<input type="number" data-qty="${i.id}" min="0" max="${i.available}" inputmode="numeric" placeholder="SL" class="field !w-20 text-center font-bold"${i.available ? '' : ' disabled'}${Number(itemId) === i.id && i.available ? ' value="1"' : ''}></label>`).join('')
    || '<p class="p-4 text-center text-slate-400">Kho chưa có vật phẩm nào.</p>';
  updatePicked();
  $('req-sheet').classList.add('open');
}

function showRequestPhoto(blob) {
  requestPhoto = blob;
  $('rq-photo').innerHTML = newPhoto(blob, 'data-rq-drop');
}

function filterRequestItems() {
  const q = searchKey($('rq-q').value);
  $('rq-items').querySelectorAll('[data-search]').forEach((row) => { row.style.display = !q || row.dataset.search.includes(q) ? '' : 'none'; });
}

async function saveRequest() {
  const lines = pickedLines();
  const body = {
    borrower: $('rq-borrower').value.trim(), phone: $('rq-phone').value.trim(), team: $('rq-team').value,
    dueDate: $('rq-due').value, note: $('rq-note').value, lines,
  };
  if (!body.borrower || !body.phone || !body.team) return toast('Nhập họ tên, số điện thoại và chọn đội nhóm / ban.');
  if (!lines.length) return toast('Chọn ít nhất một vật phẩm (nhập số lượng).');
  const over = lines.find((l) => !Number.isInteger(l.quantity) || l.quantity > (byId(l.itemId)?.available ?? 0));
  if (over) return toast(`${byId(over.itemId)?.name}: chỉ còn ${byId(over.itemId)?.available}.`);
  if (lines.some((l) => byId(l.itemId)?.kind === 'RETURNABLE') && !body.dueDate) return toast('Chọn ngày hẹn trả cho đồ mượn.');
  try {
    const { id } = await api('createRequest', body);
    closeSheets();
    if (requestPhoto) {
      try {
        await apiSend('PUT', `/api/requests/${id}/photos/SUBMIT`, requestPhoto);
      } catch (e) { toast(`Đã tạo phiếu YC-${id} nhưng chưa lưu được ảnh: ${e.message}`); }
    }
    toast(`✅ Đã tạo phiếu YC-${id}. Chờ quản lý kho duyệt.`);
    await reload();
  } catch (e) { toast(`Lỗi: ${e.message}`); }
}

/* ---------- Item sheet (keepers) ---------- */
const ACTIONS = {
  IN: { label: '＋ Nhập thêm', on: '!bg-emerald-600', save: 'Lưu nhập thêm' },
  LOSS: { label: '− Giảm (hỏng/mất)', on: '!bg-red-600', save: 'Lưu giảm' },
};
const HINT = {
  IN: { RETURNABLE: 'Cộng vào cả Tổng và Sẵn sàng.', CONSUMABLE: 'Cộng vào Còn lại; Tổng nâng lên nếu vượt mức cũ.' },
  LOSS: { RETURNABLE: 'Trừ khỏi cả Tổng và Sẵn sàng (hỏng, mất, kể cả đồ trả về bị hỏng).', CONSUMABLE: 'Trừ khỏi Còn lại (hỏng, hết hạn…).' },
};

function showSheetTab(paneId) {
  document.querySelectorAll('[data-im-pane]').forEach((p) => { p.style.display = p.id === paneId ? 'block' : 'none'; });
  document.querySelectorAll('[data-im-tab]').forEach((b) => b.classList.toggle('on', b.dataset.imTab === paneId));
}

function setAction(action) {
  const i = current.item;
  current.action = action;
  $('im-actions').innerHTML = Object.keys(ACTIONS).map((a) => `<button type="button" data-action="${a}" class="${a === action ? `on ${ACTIONS[a].on}` : ''}">${ACTIONS[a].label}</button>`).join('');
  $('im-hint').textContent = HINT[action][i.kind];
  $('im-save').textContent = ACTIONS[action].save;
  $('im-save').className = `w-full mt-3 text-white font-bold rounded-xl py-3.5 text-base ${ACTIONS[action].on}`;
  setCount(Number($('im-count').value) || 1);
}

function setCount(n) {
  const max = current.action === 'IN' ? 100000 : current.item.available;
  $('im-count').max = max;
  $('im-count').value = Math.max(1, Math.min(n, max || 1));
}

function fillHeader(i) {
  $('im-photo').innerHTML = i?.photoFileId ? `<img src="${itemPhotoUrl(i)}" alt="" class="w-full h-full object-cover">` : '📦';
  $('im-name').textContent = i ? i.name : 'Thêm vật phẩm mới';
  $('im-sub').textContent = i ? `${i.code} · ${leftLabel(i)} ${i.available} / Tổng ${i.total}${onLoan(i) ? ` · ${onLoan(i)} đang mượn` : ''}` : 'Nhập thông tin rồi lưu';
}

function fillInfo(i) {
  $('if-kind').innerHTML = Object.entries(ITEM_KIND_LABEL).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('if-name').value = i?.name ?? '';
  $('if-kind').value = i?.kind ?? 'RETURNABLE';
  $('if-kind').disabled = Boolean(i);
  $('if-code').value = i?.code ?? 'Tự tạo khi lưu';
  $('if-location').value = String(i ? i.locationId ?? '' : (/^\d+$/.test($('inv-location').value) ? $('inv-location').value : ''));
  $('if-note').value = i?.note ?? '';
  $('if-qty').value = 1;
  $('if-qty-row').style.display = i ? 'none' : 'block';
  $('if-delete').style.display = i ? 'block' : 'none';
  pendingPhoto = null;
  showInfoPhoto(i?.photoFileId ? itemPhotoUrl(i) : null);
}

function showInfoPhoto(src) {
  $('if-photo').innerHTML = src ? `<img src="${esc(src)}" alt="" class="w-full h-full object-cover">` : '📦';
  $('if-photo-remove').style.display = src ? 'block' : 'none';
}

// item null = a new item: only the information tab.
function openItem(item, tab = 'im-qty') {
  current = { item, action: null };
  fillHeader(item);
  fillInfo(item);
  $('im-tabs').style.display = item ? '' : 'none';
  $('im-request').style.display = item?.available ? '' : 'none';
  $('im-count').value = 1;
  if (item) {
    setAction('IN');
    showSheetTab(tab);
  } else {
    showSheetTab('im-info');
  }
  $('item-sheet').classList.add('open');
}

const closeSheets = () => document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));

async function saveMove() {
  const i = current.item;
  const quantity = Number($('im-count').value);
  if (!Number.isInteger(quantity) || quantity < 1) return toast('Số lượng phải là số nguyên lớn hơn 0.');
  if (current.action === 'LOSS' && quantity > i.available) return toast(`Chỉ còn ${i.available} trong kho.`);
  try {
    await api('moveItem', { itemId: i.id, type: current.action, quantity });
    closeSheets();
    toast(`✅ ${ACTIONS[current.action].label} ${quantity} — ${i.name}`);
    await reload();
  } catch (e) { toast(`Lỗi: ${e.message}`); }
}

async function saveInfo() {
  const i = current.item;
  const name = $('if-name').value.trim();
  if (!name) return toast('Nhập tên vật phẩm.');
  try {
    const { id } = await api('saveItem', {
      id: i?.id, name, kind: $('if-kind').value, locationId: $('if-location').value,
      note: $('if-note').value, quantity: i ? undefined : Number($('if-qty').value || 0),
    });
    if (pendingPhoto) await apiSend('PUT', `/api/items/${id}/photo`, pendingPhoto);
    closeSheets();
    toast(i ? '✅ Đã lưu thông tin.' : `✅ Đã thêm ${name}.`);
    await reload();
  } catch (e) { toast(`Lỗi: ${e.message}`); }
}

function pickItemPhoto() {
  pickImage().then(async (file) => {
    if (!file) return;
    try {
      const blob = await cropPhoto(file, 640, 480); // 4:3 landscape, the shape of the card picture
      if (!current.item) { // uploaded together with the new item
        pendingPhoto = blob;
        showInfoPhoto(URL.createObjectURL(blob));
        return;
      }
      await apiSend('PUT', `/api/items/${current.item.id}/photo`, blob);
      toast('✅ Đã lưu ảnh lên Google Drive.');
      await reload();
      openItem(byId(current.item.id), 'im-info');
    } catch (e) { toast(`Lỗi: ${e.message}`); }
  });
}

async function removeItemPhoto() {
  if (!current.item) { pendingPhoto = null; showInfoPhoto(null); return; }
  if (!confirm(`Xóa ảnh của ${current.item.name}?`)) return;
  try {
    await apiSend('DELETE', `/api/items/${current.item.id}/photo`);
    await reload();
    openItem(byId(current.item.id), 'im-info');
  } catch (e) { toast(`Lỗi: ${e.message}`); }
}

async function deleteItem() {
  const i = current.item;
  if (!confirm(`Xóa "${i.name}" và toàn bộ lịch sử của nó (kể cả trong các phiếu cũ)? Không hoàn tác được.`)) return;
  try {
    await api('deleteItem', { id: i.id });
    closeSheets();
    toast(`✅ Đã xóa ${i.name}.`);
    await reload();
  } catch (e) { toast(`Lỗi: ${e.message}`); }
}

/* ---------- Locations sheet (keepers) ---------- */
function renderLocations() {
  const used = (id) => items.filter((i) => i.locationId === id).length;
  $('loc-list').innerHTML = locations.map((l) => '<div class="py-2 flex items-center gap-2">'
    + `<input type="text" data-loc="${l.id}" class="field" maxlength="100" value="${esc(l.name)}">`
    + `<span class="text-xs text-slate-500 w-16 text-center flex-none">${used(l.id)} món</span>`
    + `<button type="button" data-loc-delete="${l.id}" class="flex-none text-red-600 font-bold px-2" aria-label="Xóa">🗑</button></div>`).join('')
    || '<p class="p-4 text-center text-slate-400">Chưa có nơi để nào.</p>';
}

async function saveLocation(id, name) {
  try {
    await api('saveLocation', { id, name });
    toast('✅ Đã lưu nơi để.');
  } catch (e) { toast(`Lỗi: ${e.message}`); }
  await reload();
}

/* ---------- Events ---------- */
$('inv-kind').innerHTML = `<option value="">Tất cả loại</option>${Object.entries(ITEM_KIND_LABEL).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}`;
$('req-status').innerHTML = `<option value="">Tất cả trạng thái</option>${Object.entries(REQUEST_STATUS_LABEL).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}<option value="LATE">Quá hạn trả</option>`;
setupTabs();

$('inv-stats').addEventListener('click', (e) => {
  const tile = e.target.closest('[data-filter]');
  if (!tile) return;
  filter = tile.dataset.filter === filter ? 'all' : tile.dataset.filter;
  renderStats();
  renderItems();
});
$('inv-q').addEventListener('input', renderItems);
$('inv-kind').addEventListener('change', renderItems);
$('inv-stock').addEventListener('change', renderItems);
$('inv-location').addEventListener('change', renderItems);
$('inv-add').addEventListener('click', () => openItem(null));
$('inv-locations').addEventListener('click', () => { renderLocations(); $('loc-sheet').classList.add('open'); });
// A request starts from an item: a tap on its card (an admin: the button in its sheet). More items are picked in the request sheet.
$('im-request').addEventListener('click', () => { const { item } = current; closeSheets(); openRequest(item.id); });
// A keeper opens the item; anyone else starts a request with it.
$('inv-list').addEventListener('click', (e) => {
  if (e.target.closest('[data-holders]')) return; // folding the borrower list is not opening the item
  const item = byId(e.target.closest('[data-item]')?.dataset.item);
  if (!item) return;
  if (keeper) openItem(item);
  else if (item.available) openRequest(item.id);
  else toast(`${item.name} đang hết.`);
});

$('inv-list').addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-item]')) {
    e.preventDefault();
    e.target.click();
  }
});
// toggle does not bubble: listened to on the way down.
$('inv-list').addEventListener('toggle', (e) => {
  const id = Number(e.target.dataset?.holders);
  if (id) (e.target.open ? openHolders.add(id) : openHolders.delete(id));
}, true);

$('req-q').addEventListener('input', renderRequests);
$('req-status').addEventListener('change', renderRequests);
$('req-team').addEventListener('change', renderRequests);
$('req-list').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  const handlers = { approve, reject, return: (r) => openEvidence(r, 'RETURN'), photo: (r) => openEvidence(r, 'SUBMIT'), zalo: remind };
  const name = button && Object.keys(handlers).find((key) => key in button.dataset);
  if (name) handlers[name](requestById(button.dataset[name]));
});

$('rq-q').addEventListener('input', filterRequestItems);
$('rq-items').addEventListener('input', updatePicked);
$('rq-save').addEventListener('click', saveRequest);
$('ev-save').addEventListener('click', saveEvidence);
// The two photo buttons of the request sheet and of the evidence sheet: gallery, or the live camera.
document.querySelectorAll('[data-pick]').forEach((button) => button.addEventListener('click', async () => {
  const file = button.dataset.capture ? await takePhoto() : await pickImage();
  if (!file) return;
  try {
    const blob = await shrinkPhoto(file, 1280);
    if (button.dataset.pick === 'rq') {
      showRequestPhoto(blob);
    } else {
      evidence.blob = blob;
      showEvidence();
    }
  } catch (err) { toast(`Lỗi: ${err.message}`); }
}));
$('rq-photo').addEventListener('click', (e) => { if (e.target.closest('[data-rq-drop]')) showRequestPhoto(null); });
$('ev-photo').addEventListener('click', (e) => {
  if (e.target.closest('[data-ev-drop]')) {
    evidence.blob = null;
    showEvidence();
  }
  const remove = e.target.closest('[data-ev-remove]');
  if (remove) removeEvidencePhoto(remove.dataset.evRemove);
});


$('im-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-im-tab]');
  if (tab) showSheetTab(tab.dataset.imTab);
});
$('im-actions').addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (button) setAction(button.dataset.action);
});
$('im-minus').addEventListener('click', () => setCount(Number($('im-count').value) - 1));
$('im-plus').addEventListener('click', () => setCount(Number($('im-count').value) + 1));
$('im-save').addEventListener('click', saveMove);
$('if-save').addEventListener('click', saveInfo);
$('if-delete').addEventListener('click', deleteItem);
$('if-photo-pick').addEventListener('click', pickItemPhoto);
$('if-photo-remove').addEventListener('click', removeItemPhoto);

$('loc-add').addEventListener('click', async () => {
  const name = $('loc-new').value.trim();
  if (!name) return toast('Nhập tên nơi để.');
  $('loc-new').value = '';
  await saveLocation(null, name);
});
$('loc-list').addEventListener('change', (e) => {
  const input = e.target.closest('[data-loc]');
  if (input) saveLocation(Number(input.dataset.loc), input.value);
});
$('loc-list').addEventListener('click', async (e) => {
  const button = e.target.closest('[data-loc-delete]');
  if (!button) return;
  const l = locations.find((x) => x.id === Number(button.dataset.locDelete));
  if (!confirm(`Xóa nơi để "${l.name}"? Các vật phẩm ở đó sẽ thành "chưa có nơi để".`)) return;
  try {
    await api('deleteLocation', { id: l.id });
  } catch (err) { toast(`Lỗi: ${err.message}`); }
  await reload();
});

// A tap on the dark backdrop, the ✕ or Escape closes a sheet.
document.querySelectorAll('.sheet').forEach((sheet) => sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('.sheet-close')) sheet.classList.remove('open');
}));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

await reload();
