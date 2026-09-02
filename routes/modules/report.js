'use strict';

// FR-REPORT — Thống kê toàn đoàn: BQT + admin; không-toàn-đoàn mở cho mọi user.
module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    const statsProxy = (action, openToAll) => async (req, res, next) => {
      const body = req.body || {};
      // Không khai className = coi như toàn đoàn. getClassAttendanceStats mở cho mọi user đã đăng nhập
      // (FR-DD: Toàn đoàn xem được bởi mọi người có quyền); getSummary vẫn yêu cầu BQT+.
      if (body.wholeDeanery || !body.className) {
        if (openToAll) return authz.requireSession(req, res, () => proxy(action)(req, res, next));
        return authz.requireDeanery(req, res, () => proxy(action)(req, res, next));
      }
      // Khai className cụ thể → phải nằm trong phạm vi lớp của user (FR-AUTH-10).
      authz.requireScopeWrite(req, res, () => proxy(action)(req, res, next));
    };
    app.post('/api/getSummary', statsProxy('getSummary'));
    app.post('/api/getClassAttendanceStats', statsProxy('getClassAttendanceStats', true));
  },
};
