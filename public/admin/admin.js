/* =====================================================================
   SỔ THIẾU NHI — admin/admin.js (Xứ đoàn only)
   Users (UC-M1), groups and classes with their edit forms (UC-M2, UC-M3), holidays (UC-M4), configuration (UC-M5),
   year rollover (UC-M6), cache (UC-M7), Drive connection (UC-M8), import of the old Google Sheet.
   ===================================================================== */
'use strict';

import { initCommon, load, state, $, api, esc, toast, fillSel, setupTabs, TEACHER_SESSIONS, personName, snapToSunday, fmtDate } from '../shared/common.js';
import { SESSION_LABEL, USER_STATUS_LABEL, TIER_LABEL } from '../shared/labels.js';
import { matchesPerson } from '../shared/search.js';
import { badge, tierBadge, STATUS_TONE } from '../shared/ui.js';

await initCommon();
await load('classes');

let directory = { users: [], groups: [], memberships: [] };
let holidays = [];
const TIER_ORDER = Object.keys(TIER_LABEL); // CLASS, SECTOR, SECTOR_ADMIN, ADMIN
// directory.groups is kept in display order, so the groups of a user come out in that order too.
const groupsOf = (userId) => directory.groups.filter((g) => directory.memberships.some((m) => m.userId === userId && m.groupId === g.id));
const classNames = (ids) => ids.map((id) => state.classes.find((c) => c.id === id)?.name).filter(Boolean).join(', ');

async function loadDirectory() {
  const { users, groups, memberships } = await api('getDirectory');
  // Display order everywhere: Lớp, Ngành, BQT ngành, Xứ đoàn; by name inside a type (numbers as numbers: Ấu 2 before Ấu 10).
  groups.sort((a, b) => TIER_ORDER.indexOf(a.type) - TIER_ORDER.indexOf(b.type) || a.name.localeCompare(b.name, 'vi', { numeric: true }));
  directory = { users, groups, memberships };
}

/* ---------- Users ---------- */
function renderUsers() {
  const query = $('user-query').value;
  // Exact match on the full name or the email; an empty box shows everyone.
  const users = query.trim() ? directory.users.filter((u) => matchesPerson(u, query, { byEmail: true })) : directory.users;
  $('user-tbody').innerHTML = users.length
    ? users.map((u) => `<tr class="hover:bg-slate-50 bg-white"><td class="p-2 border">${esc(u.email)}</td>`
      + `<td class="p-2 border font-medium">${esc(personName(u))}</td><td class="p-2 border text-center whitespace-nowrap">${esc(u.phone ?? '')}</td>`
      + `<td class="p-2 border">${groupsOf(u.id).map((g) => `<span class="whitespace-nowrap">${tierBadge(g.type)} ${esc(g.name)}</span>`).join('<br>')}</td>`
      + `<td class="p-2 border text-center">${badge(USER_STATUS_LABEL[u.status], STATUS_TONE[u.status])}</td>`
      + `<td class="p-2 border text-center"><button class="edit-user bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs px-4 py-2 rounded-lg" data-id="${u.id}">Cập nhật</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="p-4 text-center text-slate-400">Không tìm thấy Huynh trưởng nào khớp chính xác.</td></tr>';
}

let editingUser = null;

function openUser(id) {
  editingUser = id ? directory.users.find((u) => u.id === Number(id)) : null;
  const u = editingUser;
  $('user-title').textContent = u ? `Cập nhật Huynh trưởng — ${u.fullName}` : 'Thêm Huynh trưởng';
  $('user-email').value = u?.email ?? '';
  $('user-saint').value = u?.saintName ?? '';
  $('user-fullname').value = u?.fullName ?? '';
  $('user-phone').value = u?.phone ?? '';
  $('user-status').value = u?.status ?? 'ACTIVE';
  const mine = new Set(u ? groupsOf(u.id).map((g) => g.id) : []);
  $('user-groups').innerHTML = directory.groups.map((g) => `<label class="flex items-center gap-2 text-sm py-0.5"><input type="checkbox" class="user-group" value="${g.id}"${mine.has(g.id) ? ' checked' : ''}> ${tierBadge(g.type)} ${esc(g.name)}</label>`).join('');
  $('user-modal').classList.add('open');
}

async function saveUser() {
  const user = {
    id: editingUser?.id,
    email: $('user-email').value.trim().toLowerCase(),
    saintName: $('user-saint').value.trim(),
    fullName: $('user-fullname').value.trim(),
    phone: $('user-phone').value.trim(),
    status: $('user-status').value,
  };
  if (!user.email || !user.fullName) return toast('Nhập Email và Họ và tên.');
  // An email change is checked for uniqueness first, then confirmed (UC-M1).
  if (editingUser && editingUser.email.toLowerCase() !== user.email) {
    if (directory.users.some((u) => u.id !== editingUser.id && u.email.toLowerCase() === user.email)) return toast(`Email ${user.email} đã thuộc về một Huynh trưởng khác.`);
    if (!confirm(`Đổi email từ ${editingUser.email} sang ${user.email}? Người dùng sẽ đăng nhập bằng email mới.`)) return;
  }
  const groupIds = [...$('user-groups').querySelectorAll('.user-group:checked')].map((box) => Number(box.value));
  try {
    // The user and their groups are saved together; unchanged groups are not rewritten by the server.
    await api('saveUser', { user, groupIds });
    await loadDirectory();
  } catch (e) { return toast(e.message); }
  $('user-modal').classList.remove('open');
  toast('Đã lưu.');
  renderUsers();
}

/* ---------- Groups and classes ---------- */
const EDIT_BUTTON = 'bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs px-3 py-2 rounded-lg whitespace-nowrap';
const DELETE_BUTTON = 'bg-red-50 hover:bg-red-100 text-red-700 font-bold text-xs px-3 py-2 rounded-lg whitespace-nowrap';

// After a change the server has rewritten its lists; the page reads them again.
async function change(action, body, done) {
  try {
    await api(action, body);
    await Promise.all([load('classes'), loadDirectory()]);
  } catch (e) {
    toast(e.message);
    return false;
  }
  renderGroups();
  renderClasses();
  toast(done);
  return true;
}

function renderGroups() {
  const covered = (g) => {
    if (g.type === 'ADMIN') return 'Tất cả các lớp';
    if (g.type === 'SECTOR_ADMIN') return esc(directory.groups.find((s) => s.id === g.sectorGroupId)?.name ?? '—');
    return esc(classNames(g.classIds));
  };
  $('group-tbody').innerHTML = directory.groups.map((g) => `<tr><td class="p-2 border font-medium">${esc(g.name)}</td><td class="p-2 border text-center">${tierBadge(g.type)}</td><td class="p-2 border">${covered(g)}</td>`
    + `<td class="p-2 border text-sm">${esc(g.description ?? '')}</td>`
    + `<td class="p-2 border text-center whitespace-nowrap"><button class="edit-group ${EDIT_BUTTON}" data-id="${g.id}">Cập nhật</button> <button class="delete-group ${DELETE_BUTTON}" data-id="${g.id}">Xóa</button></td></tr>`).join('');
}

let editingGroup = null;

// Only the field of the chosen type is shown.
function showGroupFields() {
  const type = $('group-type').value;
  for (const [row, shown] of [['group-class-row', 'CLASS'], ['group-classes-row', 'SECTOR'], ['group-sector-row', 'SECTOR_ADMIN'], ['group-admin-row', 'ADMIN']]) {
    $(row).style.display = type === shown ? '' : 'none';
  }
}

function openGroup(id) {
  editingGroup = id ? directory.groups.find((g) => g.id === Number(id)) : null;
  const g = editingGroup;
  $('group-title').textContent = g ? `Cập nhật nhóm — ${g.name}` : 'Thêm nhóm';
  $('group-name').value = g?.name ?? '';
  $('group-description').value = g?.description ?? '';
  $('group-type').value = g?.type ?? 'CLASS';
  $('group-type').disabled = !!g;
  const mine = new Set(g?.classIds ?? []);
  fillSel('group-class', state.classes.map((c) => ({ v: c.id, t: c.name })), g?.classIds[0]);
  $('group-classes').innerHTML = state.classes.map((c) => `<label class="flex items-center gap-2 text-sm py-0.5"><input type="checkbox" class="group-class-box" value="${c.id}"${mine.has(c.id) ? ' checked' : ''}> ${esc(c.name)}</label>`).join('');
  fillSel('group-sector', directory.groups.filter((s) => s.type === 'SECTOR').map((s) => ({ v: s.id, t: s.name })), g?.sectorGroupId);
  showGroupFields();
  $('group-modal').classList.add('open');
}

async function saveGroup() {
  const type = $('group-type').value;
  const name = $('group-name').value.trim();
  if (!name) return toast('Nhập tên nhóm.');
  const classIds = type === 'CLASS' ? [Number($('group-class').value)].filter(Boolean)
    : type === 'SECTOR' ? [...$('group-classes').querySelectorAll('.group-class-box:checked')].map((box) => Number(box.value)) : [];
  const body = { id: editingGroup?.id, name, type, description: $('group-description').value.trim(), classIds, sectorGroupId: type === 'SECTOR_ADMIN' ? Number($('group-sector').value) : null };
  if (await change('saveGroup', body, 'Đã lưu nhóm.')) $('group-modal').classList.remove('open');
}

function deleteGroup(id) {
  const g = directory.groups.find((x) => x.id === Number(id));
  if (g && confirm(`Xóa nhóm ${g.name}?`)) change('deleteGroup', { id: g.id }, 'Đã xóa nhóm.');
}

function renderClasses() {
  $('class-tbody').innerHTML = state.classes.map((c, i) => `<tr><td class="p-2 border text-center">${i + 1}</td><td class="p-2 border font-medium">${esc(c.name)}</td>`
    + `<td class="p-2 border text-center">${esc(c.grade ?? '')}</td><td class="p-2 border text-center font-bold">${c.size}</td>`
    + '<td class="p-2 border text-center whitespace-nowrap">'
    + `<button class="move-class px-2 text-lg text-slate-500 hover:text-blue-900 disabled:opacity-30" data-id="${c.id}" data-step="-1" title="Lên trên"${i === 0 ? ' disabled' : ''}>▲</button>`
    + `<button class="move-class px-2 text-lg text-slate-500 hover:text-blue-900 disabled:opacity-30" data-id="${c.id}" data-step="1" title="Xuống dưới"${i === state.classes.length - 1 ? ' disabled' : ''}>▼</button> `
    + `<button class="edit-class ${EDIT_BUTTON}" data-id="${c.id}">Cập nhật</button> <button class="delete-class ${DELETE_BUTTON}" data-id="${c.id}">Xóa</button></td></tr>`).join('');
}

let editingClass = null;

function openClass(id) {
  editingClass = id ? state.classes.find((c) => c.id === Number(id)) : null;
  $('class-title').textContent = editingClass ? `Cập nhật lớp — ${editingClass.name}` : 'Thêm lớp';
  $('class-name').value = editingClass?.name ?? '';
  $('class-grade').value = editingClass?.grade ?? '';
  $('class-modal').classList.add('open');
}

async function saveClass() {
  const name = $('class-name').value.trim();
  if (!name) return toast('Nhập tên lớp.');
  if (await change('saveClass', { id: editingClass?.id, name, grade: $('class-grade').value.trim() }, 'Đã lưu lớp.')) $('class-modal').classList.remove('open');
}

// One step up or down in the promotion order.
function moveClass(id, step) {
  const ids = state.classes.map((c) => c.id);
  const from = ids.indexOf(Number(id));
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  change('reorderClasses', { ids }, 'Đã đổi thứ tự lớp.');
}

function deleteClass(id) {
  const c = state.classes.find((x) => x.id === Number(id));
  if (c && confirm(`Xóa lớp ${c.name}?`)) change('deleteClass', { id: c.id }, 'Đã xóa lớp.');
}

/* ---------- Holidays: one session of one week each ---------- */
function renderHolidays() {
  $('hol-tbody').innerHTML = holidays.length
    ? holidays.map((h, i) => `<tr><td class="p-2 border text-center">${esc(fmtDate(h.weekOf))}</td><td class="p-2 border text-center">${esc(SESSION_LABEL[h.session])}</td>`
      + `<td class="p-2 border">${esc(h.reason ?? '')}</td>`
      + `<td class="p-2 border text-center"><button class="delete-holiday text-red-600 hover:text-red-800 font-bold" data-i="${i}" title="Xóa">✕</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="p-4 text-center text-slate-400">Chưa có ngày nghỉ.</td></tr>';
}

// Every add or delete saves the whole list; the server checks the same rules again.
async function saveHolidays(next) {
  try {
    holidays = (await api('saveHolidays', { holidays: next })).holidays;
    renderHolidays();
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

async function addHoliday() {
  snapToSunday($('hol-week'));
  const holiday = { weekOf: $('hol-week').value, session: $('hol-session').value, reason: $('hol-reason').value.trim() };
  const start = state.config.AttendanceStartDate;
  if (start && holiday.weekOf < start) return toast('Tuần nghỉ không được trước ngày bắt đầu điểm danh.');
  if (holidays.some((h) => h.weekOf === holiday.weekOf && h.session === holiday.session)) return toast('Buổi này của tuần này đã có trong danh sách.');
  if (await saveHolidays([...holidays, holiday])) { $('hol-reason').value = ''; toast('Đã thêm ngày nghỉ.'); }
}

/* ---------- Configuration ---------- */
const PROTECTED_KEY = 'CurrentSchoolYear';

// A key whose name ends with "Date" gets a date picker.
const configRow = (key, value, isNew) => `<tr><td class="p-2 border"><input type="text" class="cfg-key w-full border p-2 rounded font-mono" value="${esc(key)}"${isNew ? ' placeholder="Tên cấu hình"' : ' readonly'}></td>`
  + `<td class="p-2 border"><input type="${/Date$/.test(key) ? 'date' : 'text'}" class="cfg-value w-full border p-2 rounded" value="${esc(value)}"></td>`
  + '<td class="p-2 border text-center"><button type="button" class="cfg-delete text-red-600 hover:text-red-800 font-bold" title="Xóa">✕</button></td></tr>';

function renderConfig() {
  $('cfg-tbody').innerHTML = Object.entries(state.config).map(([key, value]) => configRow(key, value, false)).join('');
}

function deleteConfigRow(row) {
  const key = row.querySelector('.cfg-key').value.trim();
  if (key === PROTECTED_KEY) return toast(`Không được xóa ${PROTECTED_KEY}.`);
  // The key is really removed on save.
  if (key && !confirm(`Xóa cấu hình ${key}?`)) return;
  row.remove();
}

async function saveConfig() {
  const config = [...$('cfg-tbody').querySelectorAll('tr')]
    .map((row) => ({ key: row.querySelector('.cfg-key').value.trim(), value: row.querySelector('.cfg-value').value.trim() }))
    .filter((item) => item.key);
  try {
    await api('saveConfig', { config });
    toast('Đã lưu cấu hình.');
    setTimeout(() => location.reload(), 800);
  } catch (e) { toast(e.message); }
}

/* ---------- Year rollover ---------- */
function nextYear() {
  const [from, to] = state.year.split('-').map(Number);
  return `${from + 1}-${to + 1}`;
}

function openYear() {
  $('year-old').textContent = state.year;
  $('year-new').textContent = nextYear();
  $('year-start').value = '';
  $('year-modal').classList.add('open');
}

async function confirmYear() {
  const attendanceStartDate = $('year-start').value;
  if (!attendanceStartDate) return toast('Nhập ngày bắt đầu điểm danh của năm học mới.');
  if (!confirm(`Chuyển từ năm học ${state.year} sang ${nextYear()}?`)) return;
  const button = $('year-confirm');
  button.disabled = true;
  try {
    const { newYear } = await api('startSchoolYear', { attendanceStartDate });
    $('year-modal').classList.remove('open');
    toast(`Đã chuyển sang năm học ${newYear}.`);
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    // All or nothing: after an error nothing was changed, so it can be fixed and run again.
    toast(`Chưa chuyển năm (không có gì thay đổi): ${e.message}`);
  } finally {
    button.disabled = false;
  }
}

/* ---------- Import of the old Google Sheet: check first, write only after a confirmation ---------- */
let importTabs = null;

async function previewImport() {
  const file = $('imp-file').files[0];
  importTabs = null;
  $('imp-run').disabled = true;
  $('imp-report').innerHTML = file ? '<p class="text-slate-500">Đang kiểm tra tệp…</p>' : '';
  if (!file) return;
  try {
    // Raw cell values: the server converts the dates, so the time zone of the browser cannot shift a day.
    const wb = XLSX.read(await file.arrayBuffer());
    const tabs = Object.fromEntries(wb.SheetNames.map((name) => [name,
      XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }).map((row) => ({ ...row, _row: row.__rowNum__ + 1 }))]));
    const { counts, skipped } = await api('importSheet', { tabs });
    importTabs = tabs;
    $('imp-run').disabled = false;
    $('imp-report').innerHTML = '<h3 class="font-bold mb-2">Sẽ nhập</h3><table class="text-sm border-collapse mb-4">'
      + Object.entries(counts).map(([table, n]) => `<tr><td class="p-1.5 px-3 border font-mono">${esc(table)}</td><td class="p-1.5 px-3 border text-right font-bold">${n}</td></tr>`).join('') + '</table>'
      + `<h3 class="font-bold mb-2">Dòng bị bỏ qua (${skipped.length})</h3>`
      + (skipped.length
        ? '<div class="tbl-scroll"><table class="w-full text-sm border-collapse">' + skipped.map((s) => `<tr><td class="p-1.5 border font-mono whitespace-nowrap">${esc(s.tab)}</td><td class="p-1.5 border text-center">${s.row}</td><td class="p-1.5 border">${esc(s.reason)}</td></tr>`).join('') + '</table></div>'
        : '<p class="text-slate-500 text-sm">Không có.</p>');
  } catch (e) {
    $('imp-report').innerHTML = '';
    toast(e.message);
  }
}

async function runImport() {
  if (!importTabs) return;
  if (prompt(`Toàn bộ dữ liệu trên ${location.host} sẽ bị XÓA và thay bằng dữ liệu của tệp. Gõ NHAP để xác nhận.`) !== 'NHAP') return;
  const button = $('imp-run');
  button.disabled = true;
  try {
    await api('importSheet', { tabs: importTabs, confirm: true });
    toast('Đã nhập xong. Hãy đăng nhập lại.');
    setTimeout(() => location.replace('/login/'), 1500);
  } catch (e) {
    // All or nothing: after an error nothing was changed.
    toast(`Chưa nhập (không có gì thay đổi): ${e.message}`);
    button.disabled = false;
  }
}

/* ---------- Cache and Drive ---------- */
async function clearCache() {
  const button = $('clear-cache');
  button.disabled = true;
  try {
    await api('clearCache');
    toast('Đã xóa và dựng lại bộ nhớ đệm.');
  } catch (e) { toast(e.message); } finally { button.disabled = false; }
}

/* ---------- Events ---------- */
$('user-query').addEventListener('input', renderUsers);
$('user-add').addEventListener('click', () => openUser());
$('user-tbody').addEventListener('click', (e) => {
  const button = e.target.closest('.edit-user');
  if (button) openUser(button.dataset.id);
});

for (const id of ['user-modal', 'year-modal', 'class-modal', 'group-modal']) {
  const modal = $(id);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
  modal.querySelector('.btn-cancel').addEventListener('click', () => modal.classList.remove('open'));
}
$('user-modal').querySelector('.btn-save').addEventListener('click', saveUser);
$('class-modal').querySelector('.btn-save').addEventListener('click', saveClass);
$('group-modal').querySelector('.btn-save').addEventListener('click', saveGroup);
$('class-add').addEventListener('click', () => openClass());
$('group-add').addEventListener('click', () => openGroup());
$('group-type').addEventListener('change', showGroupFields);
$('class-tbody').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.classList.contains('move-class')) moveClass(button.dataset.id, Number(button.dataset.step));
  else if (button.classList.contains('edit-class')) openClass(button.dataset.id);
  else if (button.classList.contains('delete-class')) deleteClass(button.dataset.id);
});
$('group-tbody').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.classList.contains('edit-group')) openGroup(button.dataset.id);
  else if (button.classList.contains('delete-group')) deleteGroup(button.dataset.id);
});
$('year-confirm').addEventListener('click', confirmYear);
$('year-open').addEventListener('click', openYear);

$('hol-week').addEventListener('change', () => snapToSunday($('hol-week')));
$('hol-add').addEventListener('click', addHoliday);
$('hol-tbody').addEventListener('click', (e) => {
  const button = e.target.closest('.delete-holiday');
  if (!button) return;
  const h = holidays[Number(button.dataset.i)];
  if (confirm(`Xóa ngày nghỉ ${SESSION_LABEL[h.session]} tuần ${fmtDate(h.weekOf)}?`)) saveHolidays(holidays.filter((x) => x !== h));
});

$('cfg-add').addEventListener('click', () => $('cfg-tbody').insertAdjacentHTML('beforeend', configRow('', '', true)));
$('cfg-save').addEventListener('click', saveConfig);
$('cfg-tbody').addEventListener('click', (e) => {
  const button = e.target.closest('.cfg-delete');
  if (button) deleteConfigRow(button.closest('tr'));
});
$('drive-connect').addEventListener('click', () => { location.href = '/auth/drive'; });
$('clear-cache').addEventListener('click', clearCache);
$('imp-file').addEventListener('change', previewImport);
$('imp-run').addEventListener('click', runImport);
$('imp-host').textContent = location.host;

/* ---------- Start ---------- */
fillSel('user-status', Object.entries(USER_STATUS_LABEL).map(([v, t]) => ({ v, t })));
fillSel('group-type', Object.entries(TIER_LABEL).map(([v, t]) => ({ v, t })));
// No "Cả tuần": a whole week is closed by adding its sessions one by one.
fillSel('hol-session', TEACHER_SESSIONS.map((code) => ({ v: code, t: SESSION_LABEL[code] })));
snapToSunday($('hol-week'));

try {
  [, { holidays }] = await Promise.all([loadDirectory(), api('getHolidays')]);
} catch (e) { toast(e.message); }

const showTab = setupTabs({ 't-users': renderUsers, 't-groups': renderGroups, 't-classes': renderClasses, 't-holidays': renderHolidays, 't-config': renderConfig });
showTab('t-users');

// Back from Google after "Kết nối Google Drive".
const drive = new URLSearchParams(location.search).get('drive');
if (drive === 'connected') toast('Đã kết nối Google Drive.');
if (drive === 'error') toast('Kết nối Google Drive không thành công. Hãy thử lại và chấp nhận quyền truy cập Drive.');
