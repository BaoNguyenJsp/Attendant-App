'use strict';

// S2 — Điểm danh thiếu nhi.
module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    app.post('/api/getStudentAttendance', proxy('getStudentAttendance'));
    app.post('/api/saveStudentAttendance', authz.requireScopeWrite, proxy('saveStudentAttendance'));
  },
};
