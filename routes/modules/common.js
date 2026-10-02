'use strict';

const { RANK, ADMIN } = require('../../lib/authz');

module.exports = {
  register(app, ctx) {
    const { call, proxy, authz } = ctx;
    const { send } = authz;

    app.get('/wakeup', (req, res) => {
      res.send('Wakeup call received');
    });

    // Đọc mở cho user hợp lệ (FR-AUTH-11)
    for (const a of ['getStudents', 'getClasses', 'getHolidays', 'getTeachers', 'getConfig', 'getYearOptions']) {
      app.post('/api/' + a, proxy(a));
    }

    // Ghi Thiếu nhi theo lớp (FR-AUTH-10)
    app.post('/api/saveStudentPhoto', authz.requireScopeWrite, proxy('saveStudentPhoto'));
    app.post('/api/saveStudentFull', authz.requireScopeWrite, proxy('saveStudentFull'));
    app.post('/api/searchStudentById', proxy('searchStudentById'));
    app.post('/api/importStudents', authz.requireScopeWrite, proxy('importStudents'));
  },
};
