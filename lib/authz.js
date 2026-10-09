'use strict';

// Phân quyền (SRS §2.3, FR-AUTH-10/11/12). Tier từ cao→thấp:
// Quản trị > Quản trị ngành > Ngành > Lớp.
const RANK = { 'Lớp': 1, 'Ngành': 2, 'Quản trị ngành': 3, 'Quản trị': 4 };
const ADMIN = 'Quản trị';
const BQT = 'Quản trị ngành';

const splitScope = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

const signal = require('./auth-signal');

// Mở rộng nhóm → danh sách lớp, tối đa 1 cấp theo Groups.Scope (GOOGLE-SHEET-DESIGN §2).
// catalog = toàn bộ Groups sheet {name,type,scope} (không chỉ nhóm của user) để BQT/BCH quy chiếu
// đúng ngành cha; lọc kết quả xuống các lớp có thật để tên ngành không bao giờ lọt vào scope.
function expandScope(groups, catalog, allClassNames) {
  const byName = new Map((catalog || groups).map((g) => [g.name, g]));
  const set = new Set();
  for (const g of groups) {
    if (!g.type) continue;
    if (g.type === ADMIN) { allClassNames.forEach((c) => set.add(c)); }
    else if (g.type === 'Lớp') { set.add(g.scope); }
    else if (g.type === 'Ngành') { splitScope(g.scope).forEach((c) => set.add(c)); }
    else if (g.type === BQT) {
      const ref = byName.get(g.scope);
      if (ref && ref.type === 'Ngành') splitScope(ref.scope).forEach((c) => set.add(c));
      else splitScope(g.scope).forEach((c) => set.add(c));
    }
  }
  const out = [...set];
  return allClassNames.length ? out.filter((c) => allClassNames.includes(c)) : out;
}

// Cấp quyền = nhóm có type cao nhất.
function computeTier(groups) {
  let label = '';
  let rank = 0;
  for (const g of groups) {
    const r = RANK[g.type] || 0;
    if (r > rank) { rank = r; label = g.type; }
  }
  return label;
}

// Các ngành mà user (BQT) quản lý — dùng cho điểm danh Huynh trưởng.
function computeSectors(groups) {
  return groups.filter((g) => g.type === BQT && g.scope).map((g) => g.scope);
}

// Middleware phân quyền — Hono-compatible (c, next).
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

  // FR-AUTH-10: ghi chỉ cho lớp trong scope[] (admin thì mọi lớp).
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

  // Điểm danh Huynh trưởng: admin mọi ngành; BQT chỉ ngành mình quản lý.
  const requireTeacherScope = async (c, next) => {
    const sess = c.get('session') || {};
    if ((RANK[sess.tier] || 0) >= RANK[ADMIN]) return next();
    const sector = (c.get('body') || {}).sector;
    if (sector && (sess.sectors || []).includes(sector)) return next();
    return send(c, 403, 'Ngành không thuộc quyền quản lý của bạn.');
  };

  // Toàn đoàn: BQT + admin (SRS §2.3b).
  const requireDeanery = async (c, next) => {
    const sess = c.get('session') || {};
    if ((RANK[sess.tier] || 0) >= RANK[BQT]) return next();
    return send(c, 403, 'Báo cáo toàn đoàn cần quyền Quản trị ngành.');
  };

  return { send, requireSession, requireTier, requireScopeWrite, requireTeacherScope, requireDeanery };
}

module.exports = { RANK, ADMIN, BQT, splitScope, expandScope, computeTier, computeSectors, makeAuthz };
