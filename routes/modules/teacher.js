'use strict';

// S5 — Điểm danh & thống kê Huynh trưởng: tier Quản trị ngành trở lên,
// non-admin chỉ trong ngành mình quản lý (requireTeacherScope).
const { BQT } = require('../../lib/authz');

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    for (const a of ['getTeacherAttendance', 'saveTeacherAttendance', 'getTeacherStats']) {
      app.post('/api/' + a, authz.requireTier(BQT), authz.requireTeacherScope, proxy(a));
    }
    // Trích lục tra theo email (không có sector trong body) → không requireTeacherScope.
    app.post('/api/getTeacherTrichLuc', authz.requireTier(BQT), proxy('getTeacherTrichLuc'));
  },
};
