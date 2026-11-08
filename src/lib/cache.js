// KV cache for the rarely changing lists (plan D7). Values are JSON.
const PREFIX = 'cache:';

// Returns the cached value, or loads it, stores it and returns it.
export async function cached(kv, name, load) {
  const hit = await kv.get(PREFIX + name, 'json');
  if (hit !== null) return hit;
  const value = await load();
  await kv.put(PREFIX + name, JSON.stringify(value));
  return value;
}

// Called by every save that changes a cached list: reload from D1 and overwrite.
export async function refresh(kv, name, load) {
  const value = await load();
  await kv.put(PREFIX + name, JSON.stringify(value));
  return value;
}

// clearCache / startSchoolYear: drop everything, then rebuild each list before answering.
// `loaders` is { name: () => Promise<value> }.
export async function rebuildAll(kv, loaders) {
  const { keys } = await kv.list({ prefix: PREFIX });
  await Promise.all(keys.map((k) => kv.delete(k.name)));
  await Promise.all(Object.entries(loaders).map(([name, load]) => refresh(kv, name, load)));
}
