/* =====================================================================
   SỔ THIẾU NHI — shared/siblings.js
   Sibling families on the pages (UC-S4): a member is a student ('s12') or a Huynh trưởng ('u7'); a graduate is shown
   as the user made from them. Needs state.families (load('families')) and state.students for the search.
   ===================================================================== */
import { state, $, esc, toast, className, personName } from './common.js';
import { matchesStudent, matchesPerson } from './search.js';

// The other members of a person's family.
export function siblingsOf(key) {
  const { members, graduates } = state.families;
  const me = graduates[key] ?? key;
  const familyId = members.find((m) => m.key === me)?.familyId;
  return familyId === undefined ? [] : members.filter((m) => m.familyId === familyId && m.key !== me);
}

// Huynh trưởng in red, students with their class.
export const siblingBadge = (m) => (m.teacher
  ? `<span class="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs whitespace-nowrap">${esc(m.name)} (Huynh trưởng)</span>`
  : `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs whitespace-nowrap">${esc(m.name)} (${esc(className(m.classId))})</span>`);

// Only siblings still active are shown, spaced apart when they wrap. Past CELL_LIMIT the cell shows the first ones and
// a "+N" button that opens the whole list in a popup.
const CELL_LIMIT = 3;
const activeSiblings = (key) => siblingsOf(key).filter((m) => m.active);

export function siblingCell(key) {
  const shown = activeSiblings(key);
  if (!shown.length) return '';
  const cut = shown.length > CELL_LIMIT ? CELL_LIMIT - 1 : shown.length;
  const more = cut < shown.length
    ? `<button type="button" class="sibling-more bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded text-xs whitespace-nowrap" data-key="${esc(key)}">+${shown.length - cut} khác</button>`
    : '';
  return `<div class="flex flex-wrap justify-center gap-1.5 max-w-xs mx-auto">${shown.slice(0, cut).map(siblingBadge).join('')}${more}</div>`;
}

// One popup for every page (native popover: closes on Esc or a click outside).
let popup = null;
document.addEventListener('click', (e) => {
  if (e.target.closest('.sibling-close')) { popup?.hidePopover(); return; }
  const button = e.target.closest('.sibling-more');
  if (!button) return;
  if (!popup) {
    popup = document.createElement('div');
    popup.popover = 'auto';
    popup.className = 'rounded-xl shadow-xl border border-slate-200 bg-white p-4 max-w-sm';
    document.body.append(popup);
  }
  const list = activeSiblings(button.dataset.key);
  popup.innerHTML = `<div class="font-bold text-blue-900 mb-3">Anh/Chị/Em (${list.length})</div>`
    + `<div class="flex flex-col items-start gap-1.5 max-h-80 overflow-y-auto">${list.map(siblingBadge).join('')}</div>`
    + '<div class="text-right mt-3"><button type="button" class="sibling-close text-sm font-bold text-slate-600 hover:text-slate-900">Đóng</button></div>';
  popup.showPopover();
});

const studentMember = (s) => ({ key: `s${s.id}`, name: s.fullName, classId: s.classId, teacher: false, active: s.status === 'ACTIVE' });
const userMember = (u) => ({ key: `u${u.id}`, name: personName(u), classId: null, teacher: true, active: u.status === 'ACTIVE' });

// The sibling field of a form: elements `<prefix>-sibling-tags`, `-search` and `-dropdown`. The search offers active
// students and the active users of `users()`. Siblings no longer active are not drawn but stay in the list, so a save keeps them.
// With lockTeachers (the student form) Huynh trưởng are shown without the remove button; the server keeps them too.
// With onLeave(key) -> families, the button `<prefix>-sibling-leave` takes only this person out of the family at once,
// instead of removing every sibling one by one (which would also split the others apart).
export function siblingEditor(prefix, users = () => [], { lockTeachers = false, onLeave = null } = {}) {
  const tags = $(`${prefix}-sibling-tags`);
  const search = $(`${prefix}-sibling-search`);
  const drop = $(`${prefix}-sibling-dropdown`);
  const leave = onLeave && $(`${prefix}-sibling-leave`);
  let me = null;
  let keys = [];
  let before = '';

  const known = (key) => state.families.members.find((m) => m.key === key)
    ?? [...state.students.map(studentMember), ...users().map(userMember)].find((m) => m.key === key);
  const render = () => {
    tags.innerHTML = keys.map(known).filter((m) => m?.active).map((m) => `<span class="flex items-center gap-1">${siblingBadge(m)}`
      + (m.teacher && lockTeachers ? '' : `<button type="button" class="remove-sibling text-slate-500 hover:text-red-700 font-bold px-1" data-key="${m.key}" title="Bỏ">×</button>`)
      + '</span>').join('');
    // Only for someone saved in a family.
    leave?.classList.toggle('hidden', !me || !before);
  };

  search.addEventListener('input', () => {
    const query = search.value;
    if (!query.trim()) { drop.classList.add('hidden'); return; }
    const taken = new Set([me, ...keys]);
    const hits = [
      ...state.students.filter((s) => s.status === 'ACTIVE' && matchesStudent(s, query)).map((s) => ({ ...studentMember(s), detail: `${s.idNumber} — ${className(s.classId)}` })),
      ...users().filter((u) => u.status === 'ACTIVE' && matchesPerson(u, query))
        .map((u) => ({ ...userMember(u), detail: u.className ? `Huynh trưởng — ${u.className}` : 'Huynh trưởng' })),
    ].filter((m) => !taken.has(m.key));
    drop.innerHTML = hits.length
      ? hits.map((m) => `<div class="sibling-option p-2 hover:bg-blue-50 cursor-pointer border-b border-slate-100 last:border-0" data-key="${m.key}">`
        + `<div class="text-sm font-bold ${m.teacher ? 'text-red-700' : 'text-blue-900'}">${esc(m.name)}</div><div class="text-xs text-slate-500">${esc(m.detail)}</div></div>`).join('')
      : '<div class="p-2 text-sm text-slate-500 text-center">Không tìm thấy (nhập họ tên có dấu hoặc số CCCD)</div>';
    drop.classList.remove('hidden');
  });
  drop.addEventListener('click', (e) => {
    const option = e.target.closest('.sibling-option');
    if (!option) return;
    keys.push(option.dataset.key);
    search.value = '';
    drop.classList.add('hidden');
    render();
  });
  leave?.addEventListener('click', async () => {
    if (!confirm('Rời nhóm anh chị em? Các thành viên khác vẫn ở cùng một nhóm.')) return;
    try { state.families = await onLeave(me); } catch (e) { return toast(e.message); }
    keys = [];
    before = '';
    render();
    toast('Đã rời nhóm anh chị em.');
  });
  tags.addEventListener('click', (e) => {
    const remove = e.target.closest('.remove-sibling');
    if (!remove) return;
    keys = keys.filter((k) => k !== remove.dataset.key);
    render();
  });

  return {
    // `key` of the person in the form, null for a new one.
    open(key) {
      me = key;
      keys = key ? siblingsOf(key).map((m) => m.key) : [];
      before = [...keys].sort().join();
      search.value = '';
      drop.classList.add('hidden');
      render();
    },
    // The wanted siblings, or undefined when unchanged (an ordinary edit never touches the family).
    changed: () => ([...keys].sort().join() === before ? undefined : keys),
    // Visible siblings, for a confirm message.
    count: () => keys.map(known).filter((m) => m?.active).length,
  };
}
