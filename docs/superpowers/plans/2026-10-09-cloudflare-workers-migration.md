# Cloudflare Workers Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Express/Node.js server with a Hono-based Cloudflare Worker so the app runs on Cloudflare's edge runtime.

**Architecture:** A Hono app in `src/worker.js` is the Worker entry point. Session state lives in an HMAC-SHA256-signed cookie (no server-side store). All `lib/` and `routes/` files stay as CommonJS; wrangler/esbuild bundles them into the ESM Worker. Static files in `public/` are served by Cloudflare's assets system — the Worker only handles `/api/*` and `/auth/*`.

**Tech Stack:** Hono (routing), Cloudflare Workers (runtime), `crypto.subtle` (session signing), `wrangler dev` (local dev), `wrangler deploy` (deploy)

**Spec:** Approved in-chat design — Option A (wrangler dev for local dev, no server.js preservation)

## Global Constraints

- Node.js `>=18` is no longer the runtime; target is Cloudflare Workers with `nodejs_compat`
- `src/worker.js` and `src/session.js` must use ESM (`export`/`import`); all existing `lib/` and `routes/` stay CommonJS
- `wrangler dev` is the sole local-dev command; `server.js` is kept but unused
- All secrets go in Cloudflare dashboard (or `wrangler secret put`); never hardcoded
- Hono is the only new production dependency added

## Review Focus

- **Session cookie survives redirect cycle (OAuth callback):** After `/auth/callback` sets the session and redirects to `/`, the next request must read the same session from the cookie. Verify by logging in and confirming `/api/getSessionUser` returns the correct email.
- **`req.session = null` clears cookie:** The logout route sets the session to `null`; the `Set-Cookie: sess=; Max-Age=0` header must appear in the response.
- **Write queue is per-isolate, not global:** Multiple concurrent Cloudflare Workers instances each have their own `writeActive` counter. This is fail-safe (GAS has its own lock) but means the Node-level concurrency cap only applies within one instance. No code fix needed — document the known ceiling with a `ponytail:` comment.
- **Body mutation in teaching module:** `teaching.js` does `req.body.teacherEmail = req.session.email` before calling `proxy`. The Hono version stores the parsed body in `c.get('body')` and the teaching module must mutate that cached object, not re-parse.
- **Assets routing:** Paths that map to files in `public/` (e.g. `/`, `/login/`) must be served as assets, not reach the Worker. Verify by loading the app in a browser after `wrangler dev` — if the Worker returns a 404 for `/`, the asset routing is broken.

---

## Task 1: Foundation — wrangler.jsonc, package.json, .dev.vars

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `package.json`
- Create: `.dev.vars` (gitignored)
- Modify: `.gitignore` (add `.dev.vars` if not present)

**Interfaces:**
- Produces: `env.OAUTH_CLIENT_ID`, `env.OAUTH_CLIENT_SECRET`, `env.OAUTH_REDIRECT_URI`, `env.SESSION_SECRET`, `env.APPS_SCRIPT_URL`, `env.SHARED_TOKEN` — available in all Worker handlers via `c.env`

- [ ] **Step 1: Update wrangler.jsonc**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "so-thieu-nhi",
  "main": "src/worker.js",
  "compatibility_date": "2026-10-06",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "assets": { "directory": "public" }
}
```

- [ ] **Step 2: Add hono to package.json dependencies and update scripts**

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "preview": "wrangler dev"
  },
  "dependencies": {
    "cookie-session": "^2.1.0",
    "express": "^4.19.2",
    "hono": "^4.6.0",
    "undici": "^7.29.1"
  }
}
```

- [ ] **Step 3: Install hono**

```
npm install hono
```

- [ ] **Step 4: Create .dev.vars with local dev secrets**

```
OAUTH_CLIENT_ID=193461300791-gjfv9287ek3olbrdbvatthtqjnrn7g00.apps.googleusercontent.com
OAUTH_CLIENT_SECRET=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
OAUTH_REDIRECT_URI=http://localhost:8787/auth/callback
SESSION_SECRET=dev-session-secret-change-in-prod
APPS_SCRIPT_URL=https://script.google.com/macros/s/AKfycbyAQTzBRkl13KrOdyjuFfMjLzdr6-v1vWrLOCzhIHK9eznAquuAkbaIawfsSnfboGOo/exec
SHARED_TOKEN=dev-shared-token
```

- [ ] **Step 5: Ensure .dev.vars is gitignored**

Open `.gitignore`. If `.dev.vars` is not already listed, add it on its own line.

- [ ] **Step 6: Verify wrangler can parse the config**

```
npx wrangler whoami
```

Expected: prints the Cloudflare account name (or "not logged in" — either is fine; just must not error on config parse).

---

## Task 2: Session module — src/session.js

**Files:**
- Create: `src/session.js`

**Interfaces:**
- Produces:
  - `readSession(request: Request, secret: string): Promise<object>` — parses and verifies the signed cookie; returns `{}` on miss/tamper
  - `makeSessionCookie(session: object|null, secret: string): Promise<string>` — returns a `Set-Cookie` header value; if `session` is null or has no `email`, returns a clearing cookie

- [ ] **Step 1: Create src/session.js**

```js
// src/session.js
const COOKIE = 'sess';
const OPTS = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'; // 30 days

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export async function readSession(request, secret) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return {};
  try {
    const [payload, sig] = m[1].split('.');
    if (!sig || sig !== await hmac(payload, secret)) return {};
    return JSON.parse(atob(payload));
  } catch { return {}; }
}

export async function makeSessionCookie(session, secret) {
  if (!session || !session.email)
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  const payload = btoa(JSON.stringify(session));
  const sig = await hmac(payload, secret);
  return `${COOKIE}=${payload}.${sig}; ${OPTS}`;
}
```

- [ ] **Step 2: Verify session module selfcheck passes**

Create a temporary inline check by running in Node (crypto.subtle is available in Node >=18):

```
node -e "
import('./src/session.js').then(async ({ readSession, makeSessionCookie }) => {
  const secret = 'test';
  const sess = { email: 'a@b.com' };
  const cookie = await makeSessionCookie(sess, secret);
  const val = cookie.split(';')[0].split('=').slice(1).join('=');
  const req = new Request('http://x', { headers: { Cookie: 'sess=' + val } });
  const out = await readSession(req, secret);
  if (out.email !== 'a@b.com') throw new Error('session roundtrip failed');
  console.log('session selfcheck OK');
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: `session selfcheck OK`

---

## Task 3: Update lib/apps-script.js

Remove the `undici.Agent` (Workers has built-in connection pooling), remove the `require('../config')` module-level import, and accept `cfg` as a parameter so the Worker can pass `env` values. Also update `makeProxy` to return a Hono-compatible handler.

**Files:**
- Modify: `lib/apps-script.js`

**Interfaces:**
- Consumes: `cfg: { appsScriptUrl: string, sharedToken: string }` passed to `makeCallAppsScript(cfg)`
- Produces:
  - `makeCallAppsScript(cfg): callAppsScript` — returns the async function that calls GAS
  - `makeProxy(call): (action: string) => HonoHandler` — returns `(c) => c.json(await call(action, c.get('body')))`
  - `warmCache(call): Promise<void>` — accepts `call` as first arg now
  - `HttpError` — unchanged

- [ ] **Step 1: Replace the top of lib/apps-script.js**

Remove these lines at the top:
```js
const cfg = require('../config');
const { Agent } = require('undici');

const keepAliveDispatcher = new Agent({
  keepAliveTimeout: 10000,
  keepAliveMaxTimeout: 10000,
  connections: 20
});
```

Replace with:
```js
// cfg is passed in via makeCallAppsScript(cfg) — no module-level require
```

- [ ] **Step 2: Wrap callAppsScript in a factory function**

Change the `callAppsScript` function signature from a bare `async function callAppsScript(action, body, maxRetries = 3)` to a factory:

```js
function makeCallAppsScript(cfg) {
  async function callAppsScript(action, body, maxRetries = 3) {
    // ... all existing body unchanged, EXCEPT:
    // Remove: dispatcher: keepAliveDispatcher,
    // The fetch() call becomes plain fetch without dispatcher option
    // Everything else stays identical
  }
  return callAppsScript;
}
```

The only change inside the function body: remove the `dispatcher: keepAliveDispatcher,` line from the `fetch()` options object.

- [ ] **Step 3: Update makeProxy to return a Hono handler**

Replace:
```js
function makeProxy(call) {
  return (action) => async (req, res, next) => {
    try { res.json(await call(action, req.body || {})); }
    catch (e) { next(e); }
  };
}
```

With:
```js
function makeProxy(call) {
  return (action) => async (c) => {
    return c.json(await call(action, c.get('body') || {}));
  };
}
```

- [ ] **Step 4: Update warmCache to accept call as a parameter**

Change signature from `function warmCache()` to `function warmCache(call)`. The function body already uses `callAppsScript` — replace every occurrence of `callAppsScript` inside `warmCache` with `call`.

- [ ] **Step 5: Update module.exports**

Replace:
```js
module.exports = { callAppsScript, makeProxy, warmCache, HttpError };
```

With:
```js
module.exports = { makeCallAppsScript, makeProxy, warmCache, HttpError };
```

- [ ] **Step 6: Update the selfcheck at the bottom**

The selfcheck at the bottom (`if (require.main === module)`) tests `acquireWrite`/`releaseWrite` directly — those are module-level and unchanged. The selfcheck doesn't call `callAppsScript`, so it still passes as-is. Verify:

```
node lib/apps-script.js
```

Expected: `apps-script self-check OK (cap=1)`

---

## Task 4: Update lib/authz.js — Hono-compatible middleware

Replace the five Express-style `(req, res, next)` middleware factories with Hono-style `(c, next)` functions. `makeAuthz` returns the same shape as before so all route modules using `ctx.authz.requireSession` etc. continue to work without changes.

**Files:**
- Modify: `lib/authz.js`

**Interfaces:**
- Consumes: `c.get('session')` for session reads
- Produces: `makeAuthz()` returns `{ send, requireSession, requireTier, requireScopeWrite, requireTeacherScope, requireDeanery }` — same shape, Hono-compatible

- [ ] **Step 1: Replace makeAuthz body in lib/authz.js**

Replace the entire `makeAuthz` function with:

```js
function makeAuthz() {
  const send = (c, status, message) => c.json({ status: 'error', message }, status);

  const requireSession = async (c, next) => {
    const sess = c.get('session') || {};
    if (!sess.email) return send(c, 401, 'Chưa đăng nhập.');
    if (signal.isStale(sess.email)) {
      c.set('session', null);
      return send(c, 401, 'Quyền của bạn vừa thay đổi. Vui lòng đăng nhập lại.');
    }
    await next();
  };

  const requireTier = (minType) => async (c, next) => {
    const sess = c.get('session') || {};
    if ((RANK[sess.tier] || 0) < RANK[minType]) return send(c, 403, 'Bạn không có quyền thực hiện thao tác này.');
    await next();
  };

  const requireScopeWrite = async (c, next) => {
    const sess = c.get('session') || {};
    if ((RANK[sess.tier] || 0) >= RANK[ADMIN]) return next();
    const readOnlyEndpoints = ['getClassAttendanceStats', 'getClassReport', 'getStudentRecord', 'searchStudentById'];
    if (readOnlyEndpoints.some(ep => c.req.path.includes(ep))) return next();
    const b = c.get('body') || {};
    const classes = [b.className, b.CurrentClass, b.ClassName].filter(Boolean);
    if (!classes.length) return send(c, 403, 'Thiếu lớp để kiểm tra quyền.');
    if (classes.every((cl) => (sess.scope || []).includes(cl))) return next();
    return send(c, 403, 'Lớp không nằm trong phạm vi của bạn.');
  };

  const requireTeacherScope = async (c, next) => {
    const sess = c.get('session') || {};
    if ((RANK[sess.tier] || 0) >= RANK[ADMIN]) return next();
    const sector = (c.get('body') || {}).sector;
    if (sector && (sess.sectors || []).includes(sector)) return next();
    return send(c, 403, 'Ngành không thuộc quyền quản lý của bạn.');
  };

  const requireDeanery = async (c, next) => {
    const sess = c.get('session') || {};
    if ((RANK[sess.tier] || 0) >= RANK[BQT]) return next();
    return send(c, 403, 'Báo cáo toàn đoàn cần quyền Quản trị ngành.');
  };

  return { send, requireSession, requireTier, requireScopeWrite, requireTeacherScope, requireDeanery };
}
```

- [ ] **Step 2: Verify lib/authz.js has no remaining Express-style (req, res, next) in makeAuthz**

Search for `req.session` or `res.status` inside `makeAuthz` — must find zero matches.

---

## Task 5: Update routes/oauth.js — Hono + Web Crypto

Replace `crypto.randomBytes` with `crypto.getRandomValues`, replace Express `req`/`res` with Hono `c`, and read config from `c.env`.

**Files:**
- Modify: `routes/oauth.js`

**Interfaces:**
- Consumes: `c.env.OAUTH_CLIENT_ID`, `c.env.OAUTH_CLIENT_SECRET`, `c.env.OAUTH_REDIRECT_URI` from Worker env; `c.get('session')` for session reads; `c.set('session', obj)` for session writes
- Produces: `registerOAuth(app, ctx)` — same signature, registers GET `/auth/google`, GET `/auth/callback`, GET `/auth/logout`

- [ ] **Step 1: Rewrite routes/oauth.js**

```js
'use strict';

const { expandScope, computeTier, computeSectors } = require('../lib/authz');
const signal = require('../lib/auth-signal');

const oauth = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  userinfo: 'https://www.googleapis.com/oauth2/v3/userinfo',
};

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

module.exports = function registerOAuth(app, ctx) {
  const { call, authz } = ctx;
  const { send } = authz;

  app.get('/auth/google', (c) => {
    const state = randomHex(16);
    const sess = c.get('session') || {};
    c.set('session', { ...sess, oauthState: state });
    const q = new URLSearchParams({
      client_id: c.env.OAUTH_CLIENT_ID,
      redirect_uri: c.env.OAUTH_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    return c.redirect(`${oauth.authorize}?${q}`);
  });

  app.get('/auth/callback', async (c) => {
    try {
      const { code, state, error } = c.req.query();
      const sess = c.get('session') || {};
      if (error) return c.redirect('/login/?login=denied');
      if (!code || !state || state !== sess.oauthState) return send(c, 400, 'Phiên đăng nhập không hợp lệ.');

      const tok = await fetch(oauth.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: c.env.OAUTH_CLIENT_ID,
          client_secret: c.env.OAUTH_CLIENT_SECRET,
          redirect_uri: c.env.OAUTH_REDIRECT_URI,
          grant_type: 'authorization_code',
        }),
      });
      if (!tok.ok) return send(c, 502, 'Google không cấp token.');
      const { access_token } = await tok.json();

      const me = await fetch(oauth.userinfo, { headers: { Authorization: `Bearer ${access_token}` } });
      if (!me.ok) return send(c, 502, 'Không lấy được thông tin tài khoản.');
      const info = await me.json();
      if (!info.email || info.email_verified === false) return send(c, 401, 'Tài khoản Google không hợp lệ.');

      const data = await call('getSessionUser', { email: info.email });
      const s = data.session;
      const classes = s.classes || [];
      c.set('session', {
        email: s.email,
        fullName: s.fullName,
        groups: s.groups,
        scope: expandScope(s.groups, s.catalog, classes),
        tier: computeTier(s.groups),
        sectors: computeSectors(s.groups),
      });
      signal.clear(s.email);
      return c.redirect('/');
    } catch (e) {
      console.error('login callback failed:', e.message || e);
      const denied = e.status === 401;
      return c.redirect(denied ? '/login/?login=denied' : `/login/?login=error&msg=${encodeURIComponent(e.message || '')}`);
    }
  });

  app.get('/auth/logout', (c) => {
    c.set('session', null);
    return c.redirect('/login/');
  });
};
```

- [ ] **Step 2: Verify no remaining references to req/res/crypto.randomBytes in routes/oauth.js**

```
grep -n "req\.\|res\.\|randomBytes" routes/oauth.js
```

Expected: no matches.

---

## Task 6: Update route modules and routes/api.js

Five modules need updating; three stay unchanged. `routes/api.js` needs one line change for Hono prefix matching.

**Files:**
- Modify: `routes/api.js`
- Modify: `routes/modules/auth.js`
- Modify: `routes/modules/common.js`
- Modify: `routes/modules/teaching.js`
- Modify: `routes/modules/report.js`
- Modify: `routes/modules/admin.js`
- No change: `routes/modules/attendance.js`, `routes/modules/scores.js`, `routes/modules/teacher.js`

**Interfaces:**
- Consumes: `c.get('session')` for session reads; `c.get('body')` for parsed request body; `ctx.proxy(action)` returns Hono handler `(c) => c.json(...)`
- Produces: same `/api/*` endpoint registrations

- [ ] **Step 1: Rewrite routes/api.js**

Replace the entire file content. The dynamic `require('./modules/' + name)` path is rewritten as explicit requires so esbuild can statically include all modules in the bundle. The `/api` prefix is updated to `/api/*` for Hono's prefix matcher.

```js
'use strict';

module.exports = function registerApi(app, ctx) {
  const { authz } = ctx;
  app.use('/api/*', authz.requireSession);

  [
    require('./modules/auth'),
    require('./modules/common'),
    require('./modules/attendance'),
    require('./modules/teaching'),
    require('./modules/scores'),
    require('./modules/teacher'),
    require('./modules/report'),
    require('./modules/admin'),
  ].forEach(m => m.register(app, ctx));
};
```

- [ ] **Step 2: Rewrite routes/modules/auth.js**

```js
'use strict';

module.exports = {
  register(app) {
    app.post('/api/getSessionUser', (c) => {
      const sess = c.get('session') || {};
      return c.json({
        status: 'ok',
        session: {
          email: sess.email,
          fullName: sess.fullName,
          groups: sess.groups,
          scope: sess.scope,
          tier: sess.tier,
          sectors: sess.sectors,
        },
      });
    });
  },
};
```

- [ ] **Step 3: Rewrite routes/modules/common.js**

```js
'use strict';

const { RANK, ADMIN } = require('../../lib/authz');

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;

    app.get('/wakeup', (c) => c.text('Wakeup call received'));

    for (const a of ['getStudents', 'getClasses', 'getHolidays', 'getTeachers', 'getConfig', 'getYearOptions']) {
      app.post('/api/' + a, proxy(a));
    }

    app.post('/api/saveStudentPhoto', authz.requireScopeWrite, proxy('saveStudentPhoto'));
    app.post('/api/saveStudentFull', authz.requireScopeWrite, proxy('saveStudentFull'));
    app.post('/api/searchStudentById', proxy('searchStudentById'));
    app.post('/api/importStudents', authz.requireScopeWrite, proxy('importStudents'));
  },
};
```

- [ ] **Step 4: Rewrite routes/modules/teaching.js**

```js
'use strict';

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    app.post('/api/getTeaching', proxy('getTeaching'));
    app.post('/api/saveTeaching', authz.requireScopeWrite, async (c) => {
      const body = c.get('body') || {};
      body.teacherEmail = (c.get('session') || {}).email;
      body.updatedBy = body.teacherEmail;
      return proxy('saveTeaching')(c);
    });
    app.post('/api/uploadFile', authz.requireScopeWrite, proxy('uploadFile'));
    app.post('/api/getUploadUrl', proxy('getUploadUrl'));
  },
};
```

- [ ] **Step 5: Rewrite routes/modules/report.js**

```js
'use strict';

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;

    const statsProxy = (action, openToAll) => async (c, next) => {
      const body = c.get('body') || {};
      if (body.wholeDeanery || !body.className) {
        if (openToAll) return proxy(action)(c);
        return authz.requireDeanery(c, () => proxy(action)(c));
      }
      return authz.requireScopeWrite(c, () => proxy(action)(c));
    };

    app.post('/api/getClassReport', statsProxy('getClassReport'));
    app.post('/api/getClassAttendanceStats', statsProxy('getClassAttendanceStats', true));
  },
};
```

- [ ] **Step 6: Rewrite routes/modules/admin.js**

```js
'use strict';

const { ADMIN } = require('../../lib/authz');
const cache = require('../../lib/cache');

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    for (const a of [
      'getUsers', 'saveUsers', 'saveUser', 'getGroups', 'saveGroups',
      'getGroupMembers', 'saveGroupMembers',
      'saveHolidays', 'saveConfig', 'startSchoolYear',
    ]) {
      app.post('/api/' + a, authz.requireTier(ADMIN), proxy(a));
    }

    app.post('/api/warmCache', authz.requireTier(ADMIN), async (c) => {
      const { warmCache } = require('../../lib/apps-script');
      cache.clearAll();
      await warmCache(ctx.call);
      return c.json({ status: 'ok' });
    });
  },
};
```

- [ ] **Step 7: Verify unchanged modules compile without Express refs**

```
grep -n "req\.\|res\.\|next(" routes/modules/attendance.js routes/modules/scores.js routes/modules/teacher.js
```

Expected: no matches (these modules only call `proxy(action)` and `authz.requireTier(BQT)`, which are now Hono-compatible).

---

## Task 7: Create src/worker.js — Hono entry point

**Files:**
- Create: `src/worker.js`

**Interfaces:**
- Consumes: `src/session.js` `readSession`/`makeSessionCookie`; `lib/apps-script.js` `makeCallAppsScript`/`makeProxy`/`warmCache`; `lib/authz.js` `makeAuthz`; `routes/oauth.js`; `routes/api.js`
- Produces: `export default { fetch }` — the Worker handler

- [ ] **Step 1: Create src/worker.js**

```js
// src/worker.js — ESM entry point; esbuild bundles CJS modules via require()
import { Hono } from 'hono';
import { createRequire } from 'node:module'; // nodejs_compat provides this
import { readSession, makeSessionCookie } from './session.js';

const require = createRequire(import.meta.url);
const { makeCallAppsScript, makeProxy, warmCache, HttpError } = require('../lib/apps-script');
const { makeAuthz } = require('../lib/authz');
const registerOAuth = require('../routes/oauth');
const registerApi = require('../routes/api');

// ponytail: per-isolate singletons — safe because env bindings are constant per isolate
let _app = null;
let _warming = false;

function buildApp(env) {
  const call = makeCallAppsScript({
    appsScriptUrl: env.APPS_SCRIPT_URL,
    sharedToken: env.SHARED_TOKEN,
  });

  const app = new Hono();

  // Warm cache once per isolate on first request (non-blocking)
  app.use('*', async (c, next) => {
    if (!_warming) {
      _warming = true;
      warmCache(call).catch(() => {});
    }
    await next();
  });

  // Parse body once; store in context so handlers can mutate it (teaching.js needs this)
  app.use('*', async (c, next) => {
    if (c.req.method === 'POST') {
      try { c.set('body', await c.req.json()); }
      catch { c.set('body', {}); }
    } else {
      c.set('body', {});
    }
    await next();
  });

  // Read session from signed cookie; write it back after every response
  app.use('*', async (c, next) => {
    c.set('session', await readSession(c.req.raw, env.SESSION_SECRET));
    await next();
    const cookie = await makeSessionCookie(c.get('session'), env.SESSION_SECRET);
    c.header('Set-Cookie', cookie);
  });

  const ctx = { call, proxy: makeProxy(call), authz: makeAuthz() };
  registerOAuth(app, ctx);
  registerApi(app, ctx);

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ status: 'error', message: err.message }, err.status);
    console.error(err);
    return c.json({ status: 'error', message: 'Lỗi máy chủ.' }, 500);
  });

  return app;
}

export default {
  async fetch(request, env, ctx) {
    // Build once per isolate; env bindings are identical across all requests in the same isolate
    if (!_app) _app = buildApp(env);
    return _app.fetch(request, env, ctx);
  },
};
```

- [ ] **Step 2: Start wrangler dev and verify it compiles**

```
npx wrangler dev
```

Expected: starts on `http://localhost:8787` with no bundling errors. If there are `require is not defined` errors, check that `src/worker.js` uses `require()` for CommonJS modules (esbuild handles interop).

- [ ] **Step 3: Open browser to http://localhost:8787**

Expected: the app's login page loads (served from `public/login/index.html` via assets). No 404.

- [ ] **Step 4: Log in with Google and verify session works**

1. Click login → redirected to Google OAuth
2. Authorize → redirected back to `/auth/callback`
3. Redirected to `/` → app loads
4. Open browser DevTools → Network → POST `/api/getSessionUser` → response contains `email` field

- [ ] **Step 5: Verify logout clears cookie**

1. Click logout → redirected to `/login/`
2. DevTools → check the logout response has `Set-Cookie: sess=; Max-Age=0`

- [ ] **Step 6: Test one write endpoint (e.g. save attendance for a class)**

Confirms authz scope check + GAS write + cache invalidation all work end-to-end.

- [ ] **Step 7: Commit**

```
git add src/worker.js src/session.js wrangler.jsonc package.json package-lock.json .dev.vars.example lib/apps-script.js lib/authz.js routes/oauth.js routes/api.js routes/modules/auth.js routes/modules/common.js routes/modules/teaching.js routes/modules/report.js routes/modules/admin.js docs/superpowers/plans/
git commit -m "feat: migrate server to Cloudflare Workers with Hono"
```

---

## Task 8: Set production secrets and deploy

**Files:**
- None (Cloudflare dashboard / wrangler CLI only)

- [ ] **Step 1: Set each secret in Cloudflare via wrangler**

Run these one at a time; each prompts for the value:

```
npx wrangler secret put OAUTH_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put SHARED_TOKEN
npx wrangler secret put APPS_SCRIPT_URL
npx wrangler secret put OAUTH_CLIENT_ID
npx wrangler secret put OAUTH_REDIRECT_URI
```

For `OAUTH_REDIRECT_URI`, use the production Workers URL: `https://so-thieu-nhi.<your-subdomain>.workers.dev/auth/callback`

- [ ] **Step 2: Update Google OAuth redirect URI in Google Cloud Console**

In [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → the OAuth client → add the production Workers callback URL to "Authorized redirect URIs".

- [ ] **Step 3: Deploy**

```
npx wrangler deploy
```

Expected: output shows the Workers URL (e.g. `https://so-thieu-nhi.<subdomain>.workers.dev`).

- [ ] **Step 4: Smoke test production**

1. Open the Workers URL in browser → login page loads
2. Log in → app works
3. Save attendance for one class → data appears in the Google Sheet

- [ ] **Step 5: Final commit if any production fixes were needed**

```
git add -p
git commit -m "fix: production deployment adjustments"
```
