/* Page wiring of the sheet prep tool: read the files, ask for unclear teacher names, write the two workbooks. */
const $ = (id) => document.getElementById(id);
const P = globalThis.SheetPrep;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let base = null;   // { name, buffer }
let result = null; // { tabs, report, touched: Set of tab names }

async function readFile(id) {
  const file = $(id).files[0];
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  // Raw cell values, as the admin import: dates stay Excel day numbers, no time zone shift.
  return { name: file.name, buffer, wb: XLSX.read(buffer) };
}

// Input files: the first sheet, each row with its line in the sheet.
const inputRows = (file) => XLSX.utils.sheet_to_json(file.wb.Sheets[file.wb.SheetNames[0]], { defval: '' })
  .map((row) => ({ ...row, _row: row.__rowNum__ + 1 }));

// One select per unclear name; resolves to Map key(name) -> email | null, or null when cancelled.
function askNames(names, users) {
  const sorted = [...users].sort((a, b) => String(a.FullName).localeCompare(String(b.FullName), 'vi'));
  const option = (u) => `<option value="${esc(u.Email)}">${esc(u.FullName)} — ${esc(u.Email)}</option>`;
  $('names-list').innerHTML = names.map((n, i) => `
    <label class="grid gap-1 border rounded-lg p-2">
      <span><b>${esc(n.name)}</b> <span class="text-slate-500">(${n.count} dòng, ${n.candidates.length ? `${n.candidates.length} người trùng` : 'không ai khớp'})</span></span>
      <select data-i="${i}" class="border rounded p-1">
        <option value="">— Bỏ qua —</option>
        ${n.candidates.length ? `<optgroup label="Gợi ý">${n.candidates.map(option).join('')}</optgroup>` : ''}
        <optgroup label="Tất cả">${sorted.map(option).join('')}</optgroup>
      </select>
    </label>`).join('');
  const dialog = $('names');
  return new Promise((resolve) => {
    dialog.onclose = () => {
      if (dialog.returnValue !== 'ok') return resolve(null);
      const choices = new Map();
      for (const select of dialog.querySelectorAll('select')) choices.set(P.key(names[select.dataset.i].name), select.value || null);
      resolve(choices);
    };
    dialog.returnValue = '';
    dialog.showModal();
  });
}

async function run() {
  $('error').textContent = '';
  $('dl-prepared').disabled = $('dl-report').disabled = true;
  result = null;
  try {
    const baseFile = await readFile('f-base');
    if (!baseFile) throw new Error('Chưa chọn Sheet cũ.');
    base = { name: baseFile.name.replace(/\.xlsx$/i, ''), buffer: baseFile.buffer };
    const tabs = Object.fromEntries(baseFile.wb.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(baseFile.wb.Sheets[name], { defval: '' })]));
    const [teachers, attendance, teacherAttendance, teaching] = await Promise.all(['f-teachers', 'f-attendance', 'f-teacher-attendance', 'f-teaching'].map(readFile));
    const report = P.newReport();
    const touched = new Set(['Users', 'Students']); // names are always put in Title Case

    if (teachers) { P.addTeachers(tabs, inputRows(teachers), report, teachers.name); touched.add('GroupMembers'); }
    if (attendance) P.addStudentAttendance(tabs, inputRows(attendance), report, attendance.name).forEach((t) => touched.add(t));

    const teacherRows = teacherAttendance ? inputRows(teacherAttendance) : [];
    const teachingRows = teaching ? inputRows(teaching) : [];
    let choices = new Map();
    const unclear = P.unresolvedNames(tabs, [...teacherRows, ...teachingRows]);
    if (unclear.length) {
      choices = await askNames(unclear, tabs.Users ?? []);
      if (!choices) throw new Error('Đã hủy.');
    }
    if (teacherAttendance) { P.addTeacherAttendance(tabs, teacherRows, choices, report, teacherAttendance.name); touched.add('TeacherAttendance'); }
    if (teaching) { P.addTeaching(tabs, teachingRows, choices, report, teaching.name); touched.add('Teaching'); }
    P.normalizeNames(tabs);
    const droppedLines = P.dropDuplicateStudents(tabs, report);

    result = { tabs, report, touched, droppedLines };
    showSummary(report);
    $('dl-prepared').disabled = $('dl-report').disabled = false;
  } catch (e) {
    $('error').textContent = e.message;
    $('summary').classList.add('hidden');
  }
}

function showSummary(report) {
  const counts = {};
  for (const a of report.added) {
    counts[a.tab] ??= { new: 0, replaced: 0 };
    counts[a.tab][a.action]++;
  }
  const cell = 'p-1.5 px-3 border';
  $('summary').classList.remove('hidden');
  $('summary').innerHTML = '<h3 class="font-bold mb-2">Kết quả</h3><table class="border-collapse mb-4">'
    + `<tr><th class="${cell}">Tab</th><th class="${cell}">Thêm</th><th class="${cell}">Cập nhật</th></tr>`
    + Object.entries(counts).map(([tab, c]) => `<tr><td class="${cell} font-mono">${esc(tab)}</td><td class="${cell} text-right">${c.new}</td><td class="${cell} text-right">${c.replaced}</td></tr>`).join('')
    + '</table>'
    + `<p class="mb-2">Dòng trùng đã bỏ (giữ dòng sau): <b>${report.duplicates.length}</b> · Tên huynh trưởng: <b>${report.names.length}</b></p>`
    + `<h3 class="font-bold mb-2">Dòng bị bỏ qua (${report.skipped.length})</h3>`
    + (report.skipped.length
      ? '<div class="overflow-x-auto"><table class="w-full border-collapse">' + report.skipped.map((s) => `<tr><td class="${cell} font-mono whitespace-nowrap">${esc(s.file)}</td><td class="${cell} text-center">${s.row}</td><td class="${cell}">${esc(s.reason)}</td></tr>`).join('') + '</table></div>'
      : '<p class="text-slate-500">Không có.</p>');
}

// Header of a base sheet, so rewritten tabs keep their column order; the feature columns are added after.
function headerOf(ws, extra) {
  const first = ws ? (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] ?? []) : [];
  return [...new Set([...first.map(String).filter(Boolean), ...extra])];
}

const FEATURE_COLUMNS = { Users: ['Email', 'SaintName', 'FullName', 'Status'], GroupMembers: ['GroupName', 'Email'], TeacherAttendance: P.TEACHER_COLUMNS, Teaching: P.TEACHING_COLUMNS };

// Students are only renamed: their cells are set in place so date cells stay dates.
function renameInPlace(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const head = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    if (!['FullName', 'SaintName'].includes(String(head?.v ?? '').trim())) continue;
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || typeof cell.v !== 'string') continue;
      cell.v = P.titleCase(cell.v);
      delete cell.w; delete cell.h; delete cell.r;
    }
  }
}

// Removes whole sheet lines (1-based), moving the cells below up.
function deleteLines(ws, lines) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  let to = range.s.r;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const drop = lines.has(r + 1);
    for (let c = range.s.c; c <= range.e.c; c++) {
      const from = XLSX.utils.encode_cell({ r, c });
      const cell = ws[from];
      delete ws[from];
      if (!drop && cell) ws[XLSX.utils.encode_cell({ r: to, c })] = cell;
    }
    if (!drop) to++;
  }
  range.e.r = to - 1;
  ws['!ref'] = XLSX.utils.encode_range(range);
}

function downloadPrepared() {
  const wb = XLSX.read(base.buffer); // a fresh copy: untouched tabs are written back as they were
  for (const tab of result.touched) {
    if (tab === 'Students') {
      if (wb.Sheets.Students) { renameInPlace(wb.Sheets.Students); deleteLines(wb.Sheets.Students, result.droppedLines); }
      continue;
    }
    const rows = result.tabs[tab];
    if (!rows) continue;
    const columns = FEATURE_COLUMNS[tab] ?? P.STUDENT_COLUMNS; // the rest are Att_<class> tabs
    const ws = XLSX.utils.json_to_sheet(rows, { header: headerOf(wb.Sheets[tab], columns) });
    if (wb.Sheets[tab]) wb.Sheets[tab] = ws;
    else XLSX.utils.book_append_sheet(wb, ws, tab);
  }
  XLSX.writeFile(wb, `${base.name}-prepared.xlsx`);
}

function downloadReport() {
  const wb = XLSX.utils.book_new();
  const heads = { Added: ['Tab', 'Key', 'Action', 'Values'], Skipped: ['File', 'Row', 'Reason'], Duplicates: ['File', 'Row', 'KeptRow'], NameChoices: ['Name', 'How', 'Email'] };
  for (const [name, rows] of Object.entries(P.reportSheets(result.report))) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([heads[name], ...rows.map((r) => heads[name].map((h) => r[h]))]), name);
  }
  XLSX.writeFile(wb, `${base.name}-report.xlsx`);
}

$('run').onclick = run;
$('dl-prepared').onclick = downloadPrepared;
$('dl-report').onclick = downloadReport;
