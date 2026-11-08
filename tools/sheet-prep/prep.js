/* Rules of the sheet prep tool (docs/superpowers/specs/2026-10-25-sheet-prep-tool-design.md).
   A classic script, so the page runs from file://; the tests load it with vm.runInThisContext.
   tabs = { tab name: row objects } as XLSX.utils.sheet_to_json(ws, { defval: '' }) returns them.
   Input rows carry _row, their line in the sheet. Every function that adds data mutates tabs. */
(function () {
  const text = (v) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const key = (v) => text(v).toLocaleLowerCase('vi');
  const upper = (v) => text(v).toLocaleUpperCase('vi');
  const titleCase = (v) => key(v).split(' ').map((w) => w.charAt(0).toLocaleUpperCase('vi') + w.slice(1)).join(' ');
  const idKey = (v) => String(v ?? '').trim().replace(/^'+/, '').replace(/^0+/, ''); // as src/lib/text.js

  // Dates are 'YYYY-MM-DD' strings handled in UTC, as src/lib/text.js.
  const DAY = 86400000;
  const parse = (date) => new Date(`${date}T00:00:00Z`);
  const format = (d) => d.toISOString().slice(0, 10);
  const isDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parse(date).getTime()) && format(parse(date)) === date;
  const previousSunday = (date) => format(new Date(parse(date).getTime() - parse(date).getUTCDay() * DAY));
  const comingSunday = (date) => format(new Date(parse(date).getTime() + ((7 - parse(date).getUTCDay()) % 7) * DAY));

  // An Excel date cell arrives as a day number; a text cell as 'YYYY-MM-DD' or 'DD/MM/YYYY' (as sheet-import.js).
  function toIsoDate(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? new Date(Math.round((v - 25569) * DAY)).toISOString().slice(0, 10) : '';
    const s = text(v);
    const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : s.slice(0, 10);
    return isDate(iso) ? iso : '';
  }

  // The value of the first column whose header matches one of the names (case and spaces ignored).
  function pick(row, names) {
    const wanted = names.map(key);
    const header = Object.keys(row).find((h) => wanted.includes(key(h)));
    return header === undefined ? undefined : row[header];
  }

  function requireColumns(rows, file, columns) {
    for (const aliases of columns) {
      if (!rows.some((r) => pick(r, aliases) !== undefined)) throw new Error(`${file}: thiếu cột ${aliases[0]}`);
    }
  }

  const newReport = () => ({ added: [], skipped: [], duplicates: [], names: [] });
  const skip = (report, file, row, reason) => { report.skipped.push({ file, row, reason }); };
  const describe = (row) => Object.entries(row).map(([k, v]) => `${k}=${v}`).join('; ');

  const SESSION_COLUMNS = { cn_le: 'LeChuaNhat_Status', cn_giaoly: 'HocGiaoLy_Status', cn_chau: 'ChauThanhThe_Status', t5_le: 'LeThu5_Status', hophuynhtruong: 'HopHuynhTruong_Status', cn_hopht: 'HopHuynhTruong_Status' };
  const STUDENT_COLUMNS = ['WeekOf', 'IdNumber', 'ClassName', 'LeChuaNhat_Status', 'HocGiaoLy_Status', 'ChauThanhThe_Status', 'LeThu5_Status'];
  const TEACHER_COLUMNS = ['WeekOf', 'TeacherEmail', 'LeChuaNhat_Status', 'HocGiaoLy_Status', 'ChauThanhThe_Status', 'LeThu5_Status', 'HopHuynhTruong_Status'];
  const TEACHING_COLUMNS = ['SchoolYear', 'WeekOf', 'ClassName', 'TeacherEmail', 'UpdatedBy', 'LessonContent', 'LessonPlanUrl', 'LessonPlanNames', 'LessonPlanTypes', 'RevisedPlanUrl', 'RevisedPlanNames', 'RevisedPlanTypes'];
  const NAME_ALIASES = ['HoTen', 'Họ Tên', 'Tên', 'Ten', 'Giáo Lý Viên', 'GiaoLyVien'];
  const DATE = ['Ngay', 'Ngày'];
  const SESSION = ['Buoi', 'Buổi'];
  const STATUS = ['TrangThai', 'Trạng Thái'];
  const CLASS = ['TenLop', 'Tên Lớp', 'Lớp'];

  const classNameOf = (tabs) => new Map((tabs.Classes ?? []).filter((c) => text(c.ClassName)).map((c) => [key(c.ClassName), text(c.ClassName)]));
  const badTabName = (name) => name.length > 31 || /[[\]:*?/\\]/.test(name);

  // Marks: one entry per input row = { rowKey, fixed (columns of a new row), column, status, row }.
  // The same rowKey + column twice: the later row wins. The tab is merged by rowKeyOf(base row);
  // the input sets only the sessions it has. Returns nothing; reports added rows.
  function mergeMarks(tabs, tab, columns, entries, rowKeyOf, report, file) {
    const kept = new Map();
    for (const e of entries) {
      const k = `${e.rowKey}|${e.column}`;
      if (kept.has(k)) report.duplicates.push({ file, row: kept.get(k).row, keptRow: e.row });
      kept.set(k, e);
    }
    const rows = (tabs[tab] ??= []);
    const byKey = new Map();
    for (const r of rows) {
      const week = toIsoDate(r.WeekOf);
      if (week) r.WeekOf = previousSunday(week);
      byKey.set(rowKeyOf(r), r);
    }
    const touched = new Map(); // row -> action
    for (const e of kept.values()) {
      let r = byKey.get(e.rowKey);
      if (!r) {
        r = { ...Object.fromEntries(columns.map((c) => [c, ''])), ...e.fixed };
        rows.push(r);
        byKey.set(e.rowKey, r);
        touched.set(r, 'new');
      } else if (!touched.has(r)) touched.set(r, 'replaced');
      r[e.column] = e.status;
    }
    for (const [r, action] of touched) report.added.push({ tab, key: rowKeyOf(r), action, values: describe(r) });
  }

  // Feature 2: teachers not yet in Users get a htnhNN@gmail.com address and a membership in their class group.
  function addTeachers(tabs, rows, report, file) {
    requireColumns(rows, file, [['HoTen', 'Họ Tên', 'Tên'], CLASS]);
    const users = (tabs.Users ??= []);
    const members = (tabs.GroupMembers ??= []);
    const groups = tabs.Groups ?? [];
    const saints = new Set([...users, ...(tabs.Students ?? [])].map((r) => key(r.SaintName)).filter(Boolean));
    let last = Math.max(0, ...users.map((u) => Number(text(u.Email).match(/^htnh(\d+)@gmail\.com$/i)?.[1] ?? 0)));
    for (const r of rows) {
      const name = text(pick(r, ['HoTen', 'Họ Tên', 'Tên']));
      if (!name) continue;
      const words = name.split(' ');
      const saint = words.length > 1 && saints.has(key(words[0])) ? words[0] : '';
      const fullName = saint ? words.slice(1).join(' ') : name;
      let user = users.find((u) => [key(u.FullName), key(`${u.SaintName ?? ''} ${u.FullName}`)].some((k) => k === key(name) || k === key(fullName)));
      if (!user) {
        user = { Email: `htnh${String(++last).padStart(2, '0')}@gmail.com`, SaintName: titleCase(saint), FullName: titleCase(fullName), Status: 'Hoạt động' };
        users.push(user);
        report.added.push({ tab: 'Users', key: user.Email, action: 'new', values: describe(user) });
      }
      const target = key(pick(r, CLASS));
      const group = groups.find((g) => key(g.Type) === 'lớp' && key(text(g.Scope) || g.GroupName) === target) ?? groups.find((g) => key(g.GroupName) === target);
      if (!group) { skip(report, file, r._row, `${user.FullName}: không có nhóm cho "${text(pick(r, CLASS))}", chưa thêm vào nhóm`); continue; }
      if (members.some((m) => key(m.GroupName) === key(group.GroupName) && key(m.Email) === key(user.Email))) continue;
      const member = { GroupName: text(group.GroupName), Email: user.Email };
      members.push(member);
      report.added.push({ tab: 'GroupMembers', key: `${member.GroupName}|${member.Email}`, action: 'new', values: describe(member) });
    }
  }

  // Shared checks of an attendance row; null when it must not be used (reported unless the status is empty).
  function markOf(r, report, file, allowed) {
    const status = text(pick(r, STATUS));
    if (!status) return null;
    const date = toIsoDate(pick(r, DATE));
    const column = SESSION_COLUMNS[key(pick(r, SESSION))];
    if (!date) { skip(report, file, r._row, `Ngày không hợp lệ: ${text(pick(r, DATE))}`); return null; }
    if (!column || !allowed.includes(column)) { skip(report, file, r._row, `Buổi không hợp lệ: ${text(pick(r, SESSION))}`); return null; }
    return { week: previousSunday(date), column, status };
  }

  // Feature 1: one Att_<class> tab per class. Returns the tab names written.
  function addStudentAttendance(tabs, rows, report, file) {
    requireColumns(rows, file, [DATE, SESSION, CLASS, ['SoCCCD', 'IdNumber'], STATUS]);
    const classes = classNameOf(tabs);
    const students = new Map((tabs.Students ?? []).map((s) => [idKey(s.IdNumber), s]));
    const byTab = new Map();
    for (const r of rows) {
      const mark = markOf(r, report, file, STUDENT_COLUMNS);
      if (!mark) continue;
      const className = classes.get(key(pick(r, CLASS)));
      const id = pick(r, ['SoCCCD', 'IdNumber']);
      const student = students.get(idKey(id));
      if (!className) { skip(report, file, r._row, `Không có lớp "${text(pick(r, CLASS))}"`); continue; }
      if (!student) { skip(report, file, r._row, `Không có thiếu nhi ${text(id)}`); continue; }
      const tab = Object.keys(tabs).find((t) => key(t) === key(`Att_${className}`)) ?? `Att_${className}`;
      if (badTabName(tab)) { skip(report, file, r._row, `Tên tab "${tab}" quá 31 ký tự hoặc có ký tự cấm`); continue; }
      const IdNumber = [text(id), text(student.IdNumber)].map((s) => s.replace(/^'+/, '')).sort((a, b) => b.length - a.length)[0];
      if (!byTab.has(tab)) byTab.set(tab, []);
      byTab.get(tab).push({ rowKey: `${idKey(id)}|${mark.week}`, fixed: { WeekOf: mark.week, IdNumber, ClassName: className }, column: mark.column, status: mark.status, row: r._row });
    }
    for (const [tab, entries] of byTab) mergeMarks(tabs, tab, STUDENT_COLUMNS, entries, (x) => `${idKey(x.IdNumber)}|${x.WeekOf}`, report, file);
    return [...byTab.keys()];
  }

  // Teacher names: the last two words (one for a one-word name) against the users' full names.
  function candidatesFor(users, name) {
    const words = key(name).split(' ').filter(Boolean);
    const n = Math.min(2, words.length);
    if (!n) return [];
    const tail = words.slice(-n).join(' ');
    return users.filter((u) => key(u.FullName).split(' ').slice(-n).join(' ') === tail);
  }

  function unresolvedNames(tabs, rows) {
    const seen = new Map();
    for (const r of rows) {
      const name = text(pick(r, NAME_ALIASES));
      if (!name) continue;
      const entry = seen.get(key(name)) ?? { name, count: 0, candidates: candidatesFor(tabs.Users ?? [], name) };
      entry.count++;
      seen.set(key(name), entry);
    }
    return [...seen.values()].filter((e) => e.candidates.length !== 1);
  }

  // choices: Map key(name) -> email, or null to skip. Each distinct name is logged once in report.names.
  function emailFor(tabs, name, choices, report) {
    const k = key(name);
    let email = null;
    let how = 'skipped';
    if (choices.has(k)) {
      email = choices.get(k);
      how = email ? 'chosen' : 'skipped';
    } else {
      const found = candidatesFor(tabs.Users ?? [], name);
      if (found.length === 1) { email = text(found[0].Email); how = 'auto'; }
    }
    if (!report.names.some((n) => key(n.name) === k)) report.names.push({ name: text(name), how, email: email ?? '' });
    return email;
  }

  // Feature 3: the TeacherAttendance tab.
  function addTeacherAttendance(tabs, rows, choices, report, file) {
    requireColumns(rows, file, [DATE, SESSION, NAME_ALIASES, STATUS]);
    const entries = [];
    for (const r of rows) {
      const mark = markOf(r, report, file, TEACHER_COLUMNS);
      if (!mark) continue;
      const name = text(pick(r, NAME_ALIASES));
      const email = name && emailFor(tabs, name, choices, report);
      if (!email) { skip(report, file, r._row, `Không xác định được huynh trưởng "${name}"`); continue; }
      entries.push({ rowKey: `${key(email)}|${mark.week}`, fixed: { WeekOf: mark.week, TeacherEmail: email }, column: mark.column, status: mark.status, row: r._row });
    }
    mergeMarks(tabs, 'TeacherAttendance', TEACHER_COLUMNS, entries, (x) => `${key(x.TeacherEmail)}|${x.WeekOf}`, report, file);
  }

  // Feature 4: the Teaching tab. Every value is a URL, so every file is a link.
  function addTeaching(tabs, rows, choices, report, file) {
    const SchoolYear = text((tabs.Config ?? []).find((c) => key(c.Key) === 'currentschoolyear')?.Value);
    if (!SchoolYear) throw new Error('Config thiếu CurrentSchoolYear');
    const COLS = { date: ['Ngày Chủ Nhật', ...DATE], cls: CLASS, content: ['Nội dung bài học', 'LessonContent'], plan: ['Link Giáo Án', 'LessonPlanUrl'], revised: ['Giáo án duyệt', 'RevisedPlanUrl'] };
    requireColumns(rows, file, [COLS.date, COLS.cls, NAME_ALIASES, COLS.content, COLS.plan]);
    const classes = classNameOf(tabs);
    const files = (value, name) => {
      const urls = String(value ?? '').split(/[,\r\n]+/).map(text).filter(Boolean);
      return { url: urls.join(','), names: urls.map(() => name).join('\n'), types: urls.map(() => 'link').join(',') };
    };
    const kept = new Map();
    for (const r of rows) {
      if (!text(pick(r, COLS.date)) && !text(pick(r, COLS.cls))) continue;
      const date = toIsoDate(pick(r, COLS.date));
      const ClassName = classes.get(key(pick(r, COLS.cls)));
      if (!date) { skip(report, file, r._row, `Ngày không hợp lệ: ${text(pick(r, COLS.date))}`); continue; }
      if (!ClassName) { skip(report, file, r._row, `Không có lớp "${text(pick(r, COLS.cls))}"`); continue; }
      const name = text(pick(r, NAME_ALIASES));
      const email = name && emailFor(tabs, name, choices, report);
      if (!email) { skip(report, file, r._row, `Không xác định được huynh trưởng "${name}"`); continue; }
      const WeekOf = comingSunday(date);
      const plan = files(pick(r, COLS.plan), 'Giáo án');
      const revised = files(pick(r, COLS.revised), 'Giáo án duyệt');
      const row = {
        SchoolYear, WeekOf, ClassName, TeacherEmail: email, UpdatedBy: '', LessonContent: upper(pick(r, COLS.content)),
        LessonPlanUrl: plan.url, LessonPlanNames: plan.names, LessonPlanTypes: plan.types,
        RevisedPlanUrl: revised.url, RevisedPlanNames: revised.names, RevisedPlanTypes: revised.types,
      };
      const k = `${SchoolYear}|${WeekOf}|${key(ClassName)}`;
      if (kept.has(k)) report.duplicates.push({ file, row: kept.get(k).line, keptRow: r._row });
      kept.set(k, { row, line: r._row });
    }
    const rowsOut = (tabs.Teaching ??= []);
    const keyOf = (x) => `${text(x.SchoolYear)}|${x.WeekOf}|${key(x.ClassName)}`;
    for (const r of rowsOut) r.WeekOf = toIsoDate(r.WeekOf) || r.WeekOf;
    for (const [k, { row }] of kept) {
      const at = rowsOut.findIndex((x) => keyOf(x) === k);
      if (at >= 0) rowsOut[at] = { ...rowsOut[at], ...row };
      else rowsOut.push(row);
      report.added.push({ tab: 'Teaching', key: k, action: at >= 0 ? 'replaced' : 'new', values: describe(row) });
    }
  }

  function normalizeNames(tabs) {
    for (const r of [...(tabs.Users ?? []), ...(tabs.Students ?? [])]) {
      for (const c of ['FullName', 'SaintName']) if (c in r) r[c] = titleCase(r[c]);
    }
  }

  // Students sharing a CCCD: every copy leaves the Students tab, so the importer cannot pick the wrong one.
  // Their Att_*, Scores, AcademicYear... rows stay; once one student is added back they import again.
  // Run last, so the features still match those students. Returns the sheet lines removed.
  function dropDuplicateStudents(tabs, report) {
    const students = tabs.Students ?? [];
    const line = (s, i) => (s.__rowNum__ ?? i + 1) + 1;
    const count = new Map();
    for (const s of students) if (idKey(s.IdNumber)) count.set(idKey(s.IdNumber), (count.get(idKey(s.IdNumber)) ?? 0) + 1);
    const dropped = new Set();
    students.forEach((s, i) => {
      if (count.get(idKey(s.IdNumber)) < 2) return;
      dropped.add(line(s, i));
      skip(report, 'Students', line(s, i), `CCCD ${text(s.IdNumber)} bị trùng (${text(s.FullName)}): đã bỏ mọi dòng của CCCD này, dữ liệu ở tab khác vẫn giữ`);
    });
    tabs.Students = students.filter((s, i) => !dropped.has(line(s, i)));
    return dropped;
  }

  const reportSheets = (report) => ({
    Added: report.added.map((a) => ({ Tab: a.tab, Key: a.key, Action: a.action, Values: a.values })),
    Skipped: report.skipped.map((s) => ({ File: s.file, Row: s.row, Reason: s.reason })),
    Duplicates: report.duplicates.map((d) => ({ File: d.file, Row: d.row, KeptRow: d.keptRow })),
    NameChoices: report.names.map((n) => ({ Name: n.name, How: n.how, Email: n.email })),
  });

  globalThis.SheetPrep = {
    key, toIsoDate, previousSunday, comingSunday, titleCase, upper, idKey, pick, requireColumns, newReport,
    STUDENT_COLUMNS, TEACHER_COLUMNS, TEACHING_COLUMNS, NAME_ALIASES,
    addTeachers, addStudentAttendance, candidatesFor, unresolvedNames, addTeacherAttendance, addTeaching, normalizeNames, dropDuplicateStudents, reportSheets,
  };
})();
