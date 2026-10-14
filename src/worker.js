// Worker entry. The app is built once per isolate; bindings and secrets arrive with each call.
import { createApp } from './app.js';
import { emptyDriveTrash } from './lib/db/lessons.js';

const { app, driveOf } = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),

  // UC-X1, weekly (Sunday 00:00 UTC): trash the lesson files that were removed from their lessons.
  scheduled(event, env, ctx) {
    ctx.waitUntil(emptyDriveTrash(env.DB, driveOf(env)).catch((e) => console.error('drive trash job:', e.message)));
  },
};
