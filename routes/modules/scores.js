'use strict';

// S4 — Điểm & xếp loại.
module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    app.post('/api/getStudentScores', proxy('getStudentScores'));
    app.post('/api/getStudentRecord', proxy('getStudentRecord'));
    app.post('/api/saveStudentScores', authz.requireScopeWrite, proxy('saveStudentScores'));
  },
};
