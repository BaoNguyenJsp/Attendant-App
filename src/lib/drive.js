// Google Drive through its REST API, as the one owner account an admin connected (D2).
import { fail } from './errors.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';

export const NOT_CONNECTED = 'Google Drive chưa được kết nối. Quản trị viên vào trang Quản trị và bấm Kết nối Google Drive.';

export function makeDrive({ db, clientId, clientSecret, fetch = globalThis.fetch }) {
  let token = null; // one access token per request is enough; it lives about an hour

  async function accessToken() {
    if (token) return token;
    const refreshToken = await db.prepare("SELECT Value FROM Secrets WHERE Key = 'DriveRefreshToken'").first('Value');
    if (!refreshToken) fail(409, NOT_CONNECTED);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
    });
    // A revoked authorisation looks the same to the user as no connection.
    if (!res.ok) fail(409, NOT_CONNECTED);
    token = (await res.json()).access_token;
    return token;
  }

  const call = async (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await accessToken()}` } });

  async function childFolder(parentId, name) {
    const query = `'${parentId}' in parents and name = '${name.replace(/['\\]/g, '\\$&')}' and mimeType = '${FOLDER_TYPE}' and trashed = false`;
    const found = await call(`${FILES_URL}?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id)')}`);
    if (found.ok) {
      const { files } = await found.json();
      if (files?.length) return files[0].id;
    }
    const made = await call(FILES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_TYPE, parents: [parentId] }) });
    if (!made.ok) fail(502, 'Không tạo được thư mục trên Google Drive.');
    return (await made.json()).id;
  }

  // False when the folder was deleted, or it or a folder above it is in the trash: an upload into it would
  // succeed but nobody would see the file.
  async function alive(folderId) {
    const res = await call(`${FILES_URL}/${encodeURIComponent(folderId)}?fields=trashed`);
    return res.ok && !(await res.json()).trashed;
  }

  // The folder for a path under the root, created on demand. Ids are remembered in DriveFolders.
  // Usual case: the last folder is remembered and still there, one check. Otherwise the path is walked from
  // the root and every missing or deleted folder is created again.
  // ponytail: no lock, so two requests that both miss DriveFolders each create the folder. One save is one
  // request; two users creating the same new folder in the same second can still duplicate it.
  // Upgrade path: claim the PathKey row in D1 before creating the folder.
  async function folderFor(rootId, parts) {
    const remembered = (pathKey) => db.prepare('SELECT FolderId FROM DriveFolders WHERE PathKey = ?').bind(pathKey).first('FolderId');
    const last = await remembered([rootId, ...parts].join('/'));
    if (last && await alive(last)) return last;
    let parent = rootId;
    for (let i = 0; i < parts.length; i++) {
      const pathKey = [rootId, ...parts.slice(0, i + 1)].join('/');
      let id = await remembered(pathKey);
      if (!id || !(await alive(id))) {
        id = await childFolder(parent, parts[i]);
        await db.prepare('INSERT OR REPLACE INTO DriveFolders (PathKey, FolderId) VALUES (?, ?)').bind(pathKey, id).run();
      }
      parent = id;
    }
    return parent;
  }

  // A resumable upload session the browser can PUT the file to. Google ties the session to the Origin given here.
  async function createUploadUrl({ folderId, filename, origin }) {
    const res = await call(UPLOAD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify({ name: filename, parents: [folderId] }),
    });
    const location = res.ok ? res.headers.get('Location') : null;
    if (!location) fail(502, 'Google Drive từ chối tạo phiên tải lên.');
    return location;
  }

  // True when the file is in the trash or no longer exists.
  async function trash(fileId) {
    const res = await call(`${FILES_URL}/${encodeURIComponent(fileId)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    return res.ok || res.status === 404;
  }

  return { folderFor, createUploadUrl, trash };
}
