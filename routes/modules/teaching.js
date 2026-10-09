'use strict';

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    app.post('/api/getTeaching', proxy('getTeaching'));
    app.post('/api/saveTeaching', authz.requireScopeWrite, async (c) => {
      const body = c.get('body') || {};
      body.teacherEmail = (c.get('session') || {}).email;
      body.updatedBy = body.teacherEmail;
      return proxy('saveTeaching')(c);
    });
    app.post('/api/uploadFile', authz.requireScopeWrite, proxy('uploadFile'));
    app.post('/api/getUploadUrl', proxy('getUploadUrl'));
  },
};
