'use strict';

// Phân quyền (SRS §2.3, FR-AUTH-10/11/12). Tier từ cao→thấp:
// Quản trị > Quản trị ngành > Ngành > Lớp.
const RANK = { 'Lớp': 1, 'Ngành': 2, 'Quản trị ngành': 3, 'Quản trị': 4 };
const ADMIN = 'Quản trị';
const BQT = 'Quản trị ngành';

const splitScope = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

// Mở rộng nhóm → danh sách lớp, tối đa 1 cấp theo Groups.Scope (GOOGLE-SHEET-DESIGN §2).
function expandScope(groups, allClassNames) {
  const byName = new Map(groups.map((g) => [g.name, g]));
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
  return [...set];
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

// Các ngành mà user (BQT) quản lý — dùng cho điểm danh giáo viên.
function computeSectors(groups) {
  return groups.filter((g) => g.type === BQT && g.scope).map((g) => g.scope);
}

// Các middleware phân quyền — đọc req.session, trả 401/403.
function makeAuthz() {
  const send = (res, status, message) => res.status(status).json({ status: 'error', message });

  const requireSession = (req, res, next) => {
    if (!req.session || !req.session.email) return send(res, 401, 'Chưa đăng nhập.');
    next();
  };

  const requireTier = (minType) => (req, res, next) => {
    if ((RANK[req.session.tier] || 0) < RANK[minType]) return send(res, 403, 'Bạn không có quyền thực hiện thao tác này.');
    next();
  };

  // FR-AUTH-10: ghi chỉ cho lớp trong scope[] (admin thì mọi lớp).
  const requireScopeWrite = (req, res, next) => {
    if ((RANK[req.session.tier] || 0) >= RANK[ADMIN]) return next();
    const b = req.body || {};
    const classes = [b.className, b.CurrentClass, b.ClassName].filter(Boolean);
    if (!classes.length) return send(res, 403, 'Thiếu lớp để kiểm tra quyền.');
    if (classes.every((c) => req.session.scope.includes(c))) return next();
    send(res, 403, 'Lớp không nằm trong phạm vi của bạn.');
  };

  // Điểm danh giáo viên: admin mọi ngành; BQT chỉ ngành mình quản lý.
  const requireTeacherScope = (req, res, next) => {
    if ((RANK[req.session.tier] || 0) >= RANK[ADMIN]) return next();
    const sector = (req.body || {}).sector;
    if (sector && (req.session.sectors || []).includes(sector)) return next();
    send(res, 403, 'Ngành không thuộc quyền quản lý của bạn.');
  };

  // Toàn đoàn: BQT + admin (SRS §2.3b).
  const requireDeanery = (req, res, next) => {
    if ((RANK[req.session.tier] || 0) >= RANK[BQT]) return next();
    send(res, 403, 'Báo cáo toàn đoàn cần quyền Quản trị ngành.');
  };

  return { send, requireSession, requireTier, requireScopeWrite, requireTeacherScope, requireDeanery };
}

module.exports = { RANK, ADMIN, BQT, splitScope, expandScope, computeTier, computeSectors, makeAuthz };
