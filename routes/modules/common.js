'use strict';

const { RANK, ADMIN } = require('../../lib/authz');

module.exports = {
  register(app, ctx) {
    const { call, proxy, authz } = ctx;
    const { send } = authz;

    // Đọc mở cho user hợp lệ (FR-AUTH-11)
    for (const a of ['getStudents', 'getClasses', 'getHolidays', 'getTeachers', 'getAcademicYear', 'getConfig', 'getYearOptions']) {
      app.post('/api/' + a, proxy(a));
    }

    // Ghi Thiếu nhi theo lớp (FR-AUTH-10)
    app.post('/api/saveStudent', authz.requireScopeWrite, proxy('saveStudent'));
    app.post('/api/saveStudentOrder', authz.requireScopeWrite, proxy('saveStudentOrder'));
    app.post('/api/searchByIdNumber', proxy('searchByIdNumber'));
    app.post('/api/importStudents', authz.requireScopeWrite, proxy('importStudents'));
  },
};
