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

    // Ghi học sinh theo lớp (FR-AUTH-10)
    app.post('/api/saveStudent', authz.requireScopeWrite, proxy('saveStudent'));

    // Tìm kiếm CCCD: chỉ trả nếu học sinh thuộc scope[] hoặc admin
    app.post('/api/searchByIdNumber', async (req, res, next) => {
      try {
        const data = await call('searchByIdNumber', req.body || {});
        const list = (data.students || []).map((x) => (x.CurrentClass ? x : { ...x, CurrentClass: x.className }));
        if ((RANK[req.session.tier] || 0) < RANK[ADMIN]) {
          if (list.some((st) => !req.session.scope.includes(st.CurrentClass))) return send(res, 403, 'Thiếu nhi không thuộc phạm vi của bạn.');
        }
        res.json(data);
      } catch (e) { next(e); }
    });
  },
};
