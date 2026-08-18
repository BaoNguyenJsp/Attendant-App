const express = require('express');
const crypto = require('crypto');
const config = require('./config');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

// --- Sessions (ponytail: in-memory Map, lost on restart; swap to file/Redis if persistence matters) ---
const SESSION_TTL = 12 * 60 * 60 * 1000;
const sessions = new Map();

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (h) for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function requireAuth(req, res, next) {
  const sid = parseCookies(req).sid;
  const exp = sid && sessions.get(sid);
  if (!exp || exp < Date.now()) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  next();
}

app.post('/api/login', (req, res) => {
  const { id, pass } = req.body || {};
  if (id === config.admin.id && pass === config.admin.pass) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, Date.now() + SESSION_TTL);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
    return res.json({ status: 'success' });
  }
  res.status(401).json({ status: 'error', message: 'Sai tài khoản hoặc mật khẩu' });
});

app.get('/api/session', (req, res) => {
  const sid = parseCookies(req).sid;
  const exp = sid && sessions.get(sid);
  res.json({ status: exp && exp >= Date.now() ? 'success' : 'error' });
});

app.post('/api/logout', requireAuth, (req, res) => {
  sessions.delete(parseCookies(req).sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0');
  res.json({ status: 'success' });
});

// --- Generic proxy to Apps Script ---
function parseUpstream(text) {
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/^\w+\((.*)\)\s*;?\s*$/s);
    if (m) {
      try { return JSON.parse(m[1]); } catch {}
    }
    return { status: 'error', message: 'Phản hồi không hợp lệ từ Apps Script', raw: text.slice(0, 200) };
  }
}

async function proxy(req, res, method) {
  const cfg = config.apps[req.params.app];
  if (!cfg) return res.status(404).json({ status: 'error', message: 'Unknown app' });
  const opts = method === 'POST'
    ? {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...req.body, token: config.appScriptToken })
      }
    : {};
  const url = method === 'POST'
    ? cfg.url
    : cfg.url + '?' + new URLSearchParams({ ...req.query, token: config.appScriptToken }).toString();
  try {
    const upstream = await fetch(url, opts);
    const text = await upstream.text();
    res.status(upstream.status).json(parseUpstream(text));
  } catch (err) {
    res.status(502).json({ status: 'error', message: 'Không kết nối được Apps Script: ' + err.message });
  }
}

app.get('/api/:app', requireAuth, (req, res) => proxy(req, res, 'GET'));
app.post('/api/:app', requireAuth, (req, res) => proxy(req, res, 'POST'));

app.use((req, res) => res.status(404).json({ status: 'error', message: 'Not found' }));

app.listen(config.port, () => console.log(`Sổ Thiếu Nhi app → http://localhost:${config.port}`));
