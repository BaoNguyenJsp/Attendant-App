// Worker entry. The app is built once per isolate; bindings and secrets arrive with each call.
import { createApp } from './app.js';
import { emptyDriveTrash } from './lib/db/lessons.js';
import { purgeFinishedRequests } from './lib/db/inventory.js';

const { app, driveOf } = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),

  // Weekly, Sunday 00:00 UTC (wrangler.jsonc): delete the warehouse requests finished a week ago, then (UC-X1) trash the Drive
  // files queued in DriveTrash: lesson files removed from their lessons, replaced or removed warehouse photos.
  scheduled(event, env, ctx) {
    ctx.waitUntil(purgeFinishedRequests(env.DB)
      .catch((e) => console.error('warehouse purge job:', e.message))
      .then(() => emptyDriveTrash(env.DB, driveOf(env)))
      .catch((e) => console.error('drive trash job:', e.message)));
  },
};
