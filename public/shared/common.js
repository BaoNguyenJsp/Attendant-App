/* ---------- Advanced Persistent TTL Cache Engine ---------- */
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes TTL
const CACHEABLE_ACTIONS = new Set(['getConfig', 'getClasses', 'getStudents', 'getTeachers']);

const CACHE_INVALIDATIONS = {
  'saveConfig': ['getConfig'],
  'startSchoolYear': ['getConfig', 'getClasses', 'getStudents'],
  'saveClass': ['getClasses'],
  'saveStudent': ['getStudents'],
  'saveUser': ['getTeachers'],
  'saveGroupMembers': ['getTeachers']
};

export function clearApiCache(action) {
  if (action) {
    localStorage.removeItem('api_cache_' + action);
  } else {
    CACHEABLE_ACTIONS.forEach(act => localStorage.removeItem('api_cache_' + act));
  }
}

function getStoredCache(action) {
  const cacheKey = 'api_cache_' + action;
  const itemStr = localStorage.getItem(cacheKey);
  if (!itemStr) return null;

  try {
    const item = JSON.parse(itemStr);
    const now = Date.now();
    // Return payload if within TTL window
    if (item.timestamp && (now - item.timestamp < CACHE_TTL_MS)) {
      return item.data;
    }
  } catch (e) {
    localStorage.removeItem(cacheKey);
  }
  return null;
}

function setStoredCache(action, data) {
  const cacheKey = 'api_cache_' + action;
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      timestamp: Date.now(),
      data: data
    }));
  } catch (e) {
    // Handle quota full errors gracefully
    console.warn('localStorage quota exceeded');
  }
}

/* ---------- Enhanced API Dispatcher ---------- */
export async function api(action, body) {
  const isCacheable = CACHEABLE_ACTIONS.has(action) && (!body || Object.keys(body).length === 0);

  // 1. Return valid local cached data instantly if available
  if (isCacheable) {
    const cachedData = getStoredCache(action);
    if (cachedData) {
      return JSON.parse(JSON.stringify(cachedData));
    }
  }

  // 2. Auto-invalidate dependent local cache keys on write mutations
  if (CACHE_INVALIDATIONS[action]) {
    CACHE_INVALIDATIONS[action].forEach(act => clearApiCache(act));
  }

  pendingApi++;
  showLoading();
  try {
    let r;
    try { 
      r = await fetch('/api/' + action, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        credentials: 'same-origin', 
        body: JSON.stringify(body || {})
      }); 
    } catch (e) { 
      throw new Error('Mất kết nối máy chủ.'); 
    }

    let j;
    try { j = await r.json(); }
    catch (e) { throw new Error('Máy chủ trả về lỗi (HTTP ' + r.status + '). Vui lòng thử lại.'); }
    
    if (!r.ok || j.status === 'error') { 
      const e = new Error(j.message || 'Lỗi máy chủ'); 
      e.status = r.status; 
      throw e; 
    }
    
    // 3. Save successful response to persistent storage
    if (isCacheable) {
      setStoredCache(action, j);
    }

    return j;
  } finally {
    pendingApi--;
    hideLoading();
  }
}