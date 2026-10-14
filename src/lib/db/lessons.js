// Lessons and their files (UC-L1 to L4), upload links, the Drive trash queue (UC-X1).
import { all, now } from './sql.js';
import { configMap } from './org.js';
import { requireWeek } from './attendance.js';
import { fail } from '../errors.js';
import { requireClass } from '../access.js';
import { FILE_SLOTS, FILE_TYPES, DEFAULT_LOCATION } from '../codes.js';

const MAX_UPLOADS_PER_SLOT = 3;
const safeName = (s) => String(s ?? '').replace(/[\\/:*?"<>|]/g, '_').trim();

export async function getLessons(db, { schoolYear } = {}) {
  const year = schoolYear || (await configMap(db)).CurrentSchoolYear;
  const lessons = await all(db, `
    SELECT l.Id AS id, l.SchoolYear AS schoolYear, l.WeekOf AS weekOf, l.ClassId AS classId, l.TeacherId AS teacherId,
           TRIM(COALESCE(t.SaintName, '') || ' ' || t.FullName) AS teacherName, u.FullName AS updatedByName,
           l.Content AS content, l.Location AS location
    FROM Lessons l JOIN Users t ON t.Id = l.TeacherId LEFT JOIN Users u ON u.Id = l.UpdatedBy
    WHERE l.SchoolYear = ? ORDER BY l.WeekOf DESC, l.ClassId`, year);
  const files = await all(db, `
    SELECT f.LessonId, f.Slot, f.Url AS url, f.Name AS name, f.Type AS type, f.DriveFileId AS driveFileId
    FROM LessonFiles f JOIN Lessons l ON l.Id = f.LessonId WHERE l.SchoolYear = ? ORDER BY f.LessonId, f.Slot, f.Position`, year);
  const slot = (lessonId, name) => files.filter((f) => f.LessonId === lessonId && f.Slot === name).map(({ LessonId, Slot, ...f }) => f);
  return lessons.map((l) => ({ ...l, planFiles: slot(l.id, 'PLAN'), revisedFiles: slot(l.id, 'REVISED') }));
}

function readFiles(list, slot) {
  const rows = (list ?? []).map((f, position) => {
    const url = String(f.url ?? '').trim();
    if (!FILE_TYPES.includes(f.type)) fail(400, 'Loại tệp không hợp lệ.');
    if (!/^https?:\/\//i.test(url)) fail(400, 'URL không hợp lệ (phải bắt đầu bằng http).');
    if (f.type === 'FILE' && !String(f.driveFileId ?? '').trim()) fail(400, 'Tệp tải lên thiếu mã Google Drive.');
    return { Slot: slot, Position: position, Url: url, Name: String(f.name ?? '').trim(), Type: f.type, DriveFileId: f.type === 'FILE' ? String(f.driveFileId).trim() : null };
  });
  if (rows.filter((r) => r.Type === 'FILE').length > MAX_UPLOADS_PER_SLOT) fail(400, `Chỉ được phép tối đa ${MAX_UPLOADS_PER_SLOT} file cho mỗi phần.`);
  return rows;
}

// One lesson per class per week. The teacher is whoever saved it first; later savers are the updater.
export async function saveLesson(db, actor, input) {
  const classId = Number(input.classId);
  const { weekOf } = input;
  requireClass(actor, classId);
  requireWeek(weekOf);
  const schoolYear = input.schoolYear || (await configMap(db)).CurrentSchoolYear;
  const key = [schoolYear, weekOf, classId];
  const old = await db.prepare('SELECT Id FROM Lessons WHERE SchoolYear = ? AND WeekOf = ? AND ClassId = ?').bind(...key).first();
  const content = String(input.content ?? '').trim();
  if (!old && !content) fail(400, 'Nhập nội dung bài học trước khi lưu.');
  const location = String(input.location ?? '').trim() || DEFAULT_LOCATION;
  const files = [...readFiles(input.planFiles, 'PLAN'), ...readFiles(input.revisedFiles, 'REVISED')];

  const statements = [];
  if (old) {
    statements.push(db.prepare('UPDATE Lessons SET Content = ?, Location = ?, UpdatedAt = ?, UpdatedBy = ? WHERE Id = ?').bind(content, location, now(), actor.userId, old.Id));
    // UC-L4: only documents uploaded through this app (FILE) are sent to the Drive trash.
    // ponytail: the Drive file id of a FILE entry comes from the browser, so a teacher with write scope could name any file of the owner account and have it trashed on removal. Verify the parent folder in the trash job if that risk matters.
    const kept = new Set(files.map((f) => f.DriveFileId).filter(Boolean));
    const removed = (await all(db, "SELECT DriveFileId FROM LessonFiles WHERE LessonId = ? AND Type = 'FILE'", old.Id)).map((r) => r.DriveFileId).filter((id) => id && !kept.has(id));
    for (const id of removed) statements.push(db.prepare('INSERT OR IGNORE INTO DriveTrash (FileId) VALUES (?)').bind(id));
    statements.push(db.prepare('DELETE FROM LessonFiles WHERE LessonId = ?').bind(old.Id));
  } else {
    statements.push(db.prepare('INSERT INTO Lessons (SchoolYear, WeekOf, ClassId, TeacherId, Content, Location, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(...key, actor.userId, content, location, actor.userId));
  }
  // A new lesson has no id yet inside the batch, so its files find it by its unique key.
  for (const f of files) {
    statements.push(db.prepare(`INSERT INTO LessonFiles (LessonId, Slot, Position, Url, Name, Type, DriveFileId)
      VALUES ((SELECT Id FROM Lessons WHERE SchoolYear = ? AND WeekOf = ? AND ClassId = ?), ?, ?, ?, ?, ?, ?)`).bind(...key, f.Slot, f.Position, f.Url, f.Name, f.Type, f.DriveFileId));
  }
  await db.batch(statements);
  return (await getLessons(db, { schoolYear })).find((l) => l.weekOf === weekOf && l.classId === classId);
}

// UC-L3: for each file a link the browser uploads it to, in <root>/<year>/<class>/<week>/<PLAN|REVISED>.
// One call per save, so the folder of a slot is checked or created once however many files go into it.
export async function createUploadUrls(db, drive, actor, { schoolYear, weekOf, classId, files, origin }) {
  requireClass(actor, Number(classId));
  requireWeek(weekOf);
  if (!Array.isArray(files) || !files.length || files.length > MAX_UPLOADS_PER_SLOT * FILE_SLOTS.length) fail(400, 'Danh sách tệp không hợp lệ.');
  const wanted = files.map((f) => ({ slot: f?.slot, name: safeName(f?.filename) }));
  if (wanted.some((f) => !FILE_SLOTS.includes(f.slot))) fail(400, 'Loại giáo án không hợp lệ.');
  if (wanted.some((f) => !f.name)) fail(400, 'Thiếu tên tệp.');
  const className = await db.prepare('SELECT Name FROM Classes WHERE Id = ?').bind(Number(classId)).first('Name');
  if (!className) fail(400, 'Lớp không tồn tại.');
  const config = await configMap(db);
  const folderIds = {};
  const urls = [];
  for (const f of wanted) { // one after another: requests side by side would each create the folders
    folderIds[f.slot] ??= await drive.folderFor(config.DriveFolderId || 'root', [schoolYear || config.CurrentSchoolYear, className, weekOf, f.slot].map(safeName));
    urls.push(await drive.createUploadUrl({ folderId: folderIds[f.slot], filename: f.name, origin }));
  }
  return urls;
}

// UC-X1, weekly. A file that cannot be trashed stays in the queue for the next run.
export async function emptyDriveTrash(db, drive) {
  const queue = await all(db, 'SELECT FileId FROM DriveTrash LIMIT 50');
  let done = 0;
  for (const { FileId } of queue) {
    if (!(await drive.trash(FileId))) continue;
    await db.prepare('DELETE FROM DriveTrash WHERE FileId = ?').bind(FileId).run();
    done += 1;
  }
  return done;
}
