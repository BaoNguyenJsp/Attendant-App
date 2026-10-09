'use strict';

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;

    app.get('/wakeup', (c) => c.text('Wakeup call received'));

    for (const a of ['getStudents', 'getClasses', 'getHolidays', 'getTeachers', 'getConfig', 'getYearOptions']) {
      app.post('/api/' + a, proxy(a));
    }

    app.post('/api/saveStudentPhoto', authz.requireScopeWrite, proxy('saveStudentPhoto'));
    app.post('/api/saveStudentFull', authz.requireScopeWrite, proxy('saveStudentFull'));
    app.post('/api/searchStudentById', proxy('searchStudentById'));
    app.post('/api/importStudents', authz.requireScopeWrite, proxy('importStudents'));
  },
};
