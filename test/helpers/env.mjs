// In-memory Worker env for HTTP tests: D1 with the demo data, KV, R2, secrets.
import { seededD1 } from './seeded.mjs';
import { createKV } from './kv.mjs';
import { loadSession } from '../../src/lib/db/users.js';
import { makeSessionCookie } from '../../src/session.js';

export function createR2() {
  const map = new Map();
  return {
    put: async (key, value, options = {}) => { map.set(key, { bytes: new Uint8Array(value), httpMetadata: options.httpMetadata ?? {} }); },
    get: async (key) => (map.has(key) ? { body: map.get(key).bytes, httpMetadata: map.get(key).httpMetadata } : null),
    delete: async (key) => { map.delete(key); },
    has: (key) => map.has(key),
  };
}

export async function testEnv() {
  return {
    DB: await seededD1(), CACHE: createKV(), PHOTOS: createR2(),
    SESSION_SECRET: 'test-secret', OAUTH_CLIENT_ID: 'client-id', OAUTH_CLIENT_SECRET: 'client-secret',
    OAUTH_REDIRECT_URI: 'https://app.example/auth/callback',
  };
}

// The Cookie header of a signed-in user.
export async function cookieFor(env, email) {
  return (await makeSessionCookie(await loadSession(env.DB, email), env.SESSION_SECRET)).split(';')[0];
}
