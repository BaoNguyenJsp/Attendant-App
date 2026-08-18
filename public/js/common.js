function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401 && !path.startsWith('/api/login')) {
    location.href = '/index.html';
    throw new Error('Unauthorized');
  }
  let data;
  try { data = await res.json(); }
  catch { data = { status: 'error', message: 'Phản hồi không hợp lệ' }; }
  if (!res.ok) throw new Error(data.message || ('HTTP ' + res.status));
  return data;
}

function toLocalDateString(d) {
  const date = new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function safeUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}
