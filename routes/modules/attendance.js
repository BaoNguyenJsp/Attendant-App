'use strict';

// S2 — Điểm danh thiếu nhi.
module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    app.post('/api/getAttendance', proxy('getAttendance'));
    app.post('/api/saveAttendance', authz.requireScopeWrite, proxy('saveAttendance'));
  },
};
