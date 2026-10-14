// Student photos (UC-S6). Private: served by the Worker to signed-in users only.
// The bytes live in the StudentPhotos table of D1. To move to R2, add the PHOTOS binding in wrangler.jsonc and
// deploy: new photos then go to R2 under students/<Id>, and photos saved before stay readable from D1.
import { fail } from '../lib/errors.js';
import { requireTier } from '../lib/access.js';
import { getStudent, setPhotoVersion } from '../lib/db/students.js';

const MAX_BYTES = 2 * 1024 * 1024;
const keyOf = (studentId) => `students/${studentId}`;

// The type is read from the first bytes, never from what the browser claims.
function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  return null;
}

async function studentOf(c) {
  const id = Number(c.req.param('id'));
  const student = Number.isInteger(id) ? await getStudent(c.env.DB, id) : null;
  if (!student) fail(404, 'Không tìm thấy Thiếu nhi.');
  return student;
}

async function readPhoto(env, studentId) {
  const object = env.PHOTOS ? await env.PHOTOS.get(keyOf(studentId)) : null;
  if (object) return { body: object.body, contentType: object.httpMetadata?.contentType };
  const row = await env.DB.prepare('SELECT ContentType, Bytes FROM StudentPhotos WHERE StudentId = ?').bind(studentId).first();
  return row ? { body: new Uint8Array(row.Bytes), contentType: row.ContentType } : null; // D1 returns a BLOB as an array of numbers
}

// One copy only: a photo written to R2 removes the D1 copy of before the switch.
async function writePhoto(env, studentId, bytes, contentType) {
  if (env.PHOTOS) await env.PHOTOS.put(keyOf(studentId), bytes, { httpMetadata: { contentType } });
  await (env.PHOTOS
    ? env.DB.prepare('DELETE FROM StudentPhotos WHERE StudentId = ?').bind(studentId)
    : env.DB.prepare('INSERT OR REPLACE INTO StudentPhotos (StudentId, ContentType, Bytes) VALUES (?, ?, ?)').bind(studentId, contentType, bytes)).run();
}

async function removePhoto(env, studentId) {
  if (env.PHOTOS) await env.PHOTOS.delete(keyOf(studentId));
  await env.DB.prepare('DELETE FROM StudentPhotos WHERE StudentId = ?').bind(studentId).run();
}

export function registerPhotos(app, context) {
  app.get('/api/students/:id/photo', async (c) => {
    const student = await studentOf(c);
    const photo = student.photoVersion ? await readPhoto(c.env, student.id) : null;
    if (!photo) fail(404, 'Thiếu nhi này chưa có ảnh.');
    // The page puts ?v=<photoVersion> in the address, so the browser may keep the bytes for a year.
    const headers = { 'Content-Type': photo.contentType ?? 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' };
    if (c.req.query('download')) {
      const name = `${student.idNumber}_${student.fullName}.jpg`;
      headers['Content-Disposition'] = `attachment; filename="${student.idNumber}.jpg"; filename*=UTF-8''${encodeURIComponent(name)}`;
    }
    return c.body(photo.body, 200, headers);
  });

  // Upload and replace are the same call: the new bytes overwrite the old ones.
  app.put('/api/students/:id/photo', async (c) => {
    const ctx = context(c);
    requireTier(ctx.actor, 'ADMIN');
    const student = await studentOf(c);
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const contentType = imageType(bytes);
    if (!contentType) fail(400, 'Ảnh phải là JPEG hoặc PNG.');
    if (bytes.length > MAX_BYTES) fail(413, 'Ảnh không được lớn hơn 2 MB.');
    await writePhoto(c.env, student.id, bytes, contentType);
    // Seconds since 1970, always larger than the last one, so a replaced photo gets a new address.
    const photoVersion = Math.max(student.photoVersion + 1, Math.floor(Date.now() / 1000));
    await setPhotoVersion(ctx.db, student.id, photoVersion, ctx.actor.userId);
    await ctx.lists.refresh('students');
    return c.json({ status: 'ok', photoVersion });
  });

  app.delete('/api/students/:id/photo', async (c) => {
    const ctx = context(c);
    requireTier(ctx.actor, 'ADMIN');
    const student = await studentOf(c);
    await removePhoto(c.env, student.id);
    await setPhotoVersion(ctx.db, student.id, 0, ctx.actor.userId);
    await ctx.lists.refresh('students');
    return c.json({ status: 'ok' });
  });
}
