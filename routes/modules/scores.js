'use strict';

// S4 — Điểm & xếp loại.
module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    app.post('/api/getScores', proxy('getScores'));
    app.post('/api/getAcademicRecord', proxy('getAcademicRecord'));
    app.post('/api/saveScores', authz.requireScopeWrite, proxy('saveScores'));
  },
};
