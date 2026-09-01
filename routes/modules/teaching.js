'use strict';

// S3 — Giáo án. uploadFile chuyển base64 lên Drive (Apps Script), URL ghi vào Teaching.
module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    app.post('/api/getTeaching', proxy('getTeaching'));
    app.post('/api/saveTeaching', authz.requireScopeWrite, (req, res, next) => {
      req.body.teacherEmail = req.session.email;
      req.body.updatedBy = req.session.email;
      proxy('saveTeaching')(req, res, next);
    });
    app.post('/api/uploadFile', authz.requireScopeWrite, proxy('uploadFile'));
  },
};
