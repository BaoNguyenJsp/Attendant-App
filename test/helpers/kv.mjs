// In-memory stand-in for a Workers KV binding. Tests only.
export function createKV() {
  const map = new Map();
  return {
    get: async (key, type) => (map.has(key) ? (type === 'json' ? JSON.parse(map.get(key)) : map.get(key)) : null),
    put: async (key, value) => { map.set(key, String(value)); },
    delete: async (key) => { map.delete(key); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...map.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
}
