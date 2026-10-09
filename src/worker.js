// src/worker.js — ESM entry point; esbuild bundles CJS modules automatically
import { Hono } from 'hono';
import { readSession, makeSessionCookie } from './session.js';

// esbuild injects a require shim for these CJS modules at bundle time
const { makeCallAppsScript, makeProxy, warmCache, HttpError } = require('../lib/apps-script');
const { makeAuthz } = require('../lib/authz');
const registerOAuth = require('../routes/oauth');
const registerApi = require('../routes/api');

// ponytail: per-isolate singletons — safe because env bindings are constant per isolate
// ponytail: write queue is also per-isolate; GAS has its own lock so correctness holds
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
