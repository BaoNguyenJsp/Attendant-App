// The Hono app. Everything comes from c.env, so the same app runs in the Worker and in tests.
import { Hono } from 'hono';
import { readSession, makeSessionCookie } from './session.js';
import { AppError, fail } from './lib/errors.js';
import { requireTier } from './lib/access.js';
import { todayVN } from './lib/text.js';
import { makeDrive } from './lib/drive.js';
import { isSessionValid } from './lib/db/users.js';
import { makeLists } from './http/lists.js';
import { ACTIONS } from './http/actions.js';
import { registerPhotos } from './http/photos.js';
import { registerAuth } from './http/auth.js';

const error = (c, status, message) => c.json({ status: 'error', message }, status);

// `fetch` is the outbound fetch used to talk to Google.
export function createApp({ fetch = globalThis.fetch } = {}) {
  const app = new Hono();

  const driveOf = (env) => makeDrive({ db: env.DB, clientId: env.OAUTH_CLIENT_ID, clientSecret: env.OAUTH_CLIENT_SECRET, fetch });
  const context = (c) => ({
    db: c.env.DB,
    env: c.env,
    actor: c.get('session'),
    today: todayVN(),
    lists: makeLists(c.env.DB, c.env.CACHE),
    drive: driveOf(c.env),
    // Google ties an upload session to the page origin that will PUT the file.
    origin: c.req.header('Origin') ?? new URL(c.req.url).origin,
  });

  // The session lives in a signed cookie; it is written back after every response.
  app.use('*', async (c, next) => {
    c.set('session', await readSession(c.req.raw, c.env.SESSION_SECRET));
    await next();
    c.header('Set-Cookie', await makeSessionCookie(c.get('session'), c.env.SESSION_SECRET));
  });

  // R1: a valid session on every API call; a locked user or changed groups or email end it.
  app.use('/api/*', async (c, next) => {
    const session = c.get('session');
    if (!session.userId) return error(c, 401, 'Chưa đăng nhập.');
    if (!(await isSessionValid(c.env.DB, session))) {
      c.set('session', {});
      return error(c, 401, 'Quyền của bạn vừa thay đổi. Vui lòng đăng nhập lại.');
    }
    await next();
  });

  registerAuth(app, { fetch });
  registerPhotos(app, context);

  app.post('/api/:action', async (c) => {
    const name = c.req.param('action');
    if (!Object.hasOwn(ACTIONS, name)) fail(404, 'Thao tác không tồn tại.');
    const action = ACTIONS[name];
    const ctx = context(c);
    if (action.tier) requireTier(ctx.actor, action.tier);
    let body = await c.req.json().catch(() => ({}));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) body = {};
    return c.json({ status: 'ok', ...(await action.run(ctx, body)) });
  });

  app.onError((err, c) => {
    if (err instanceof AppError) return error(c, err.status, err.message);
    console.error(err);
    return error(c, 500, 'Lỗi máy chủ.');
  });

  return { app, context, driveOf };
}
