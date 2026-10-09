'use strict';

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;

    const statsProxy = (action, openToAll) => async (c) => {
      const body = c.get('body') || {};
      if (body.wholeDeanery || !body.className) {
        if (openToAll) return proxy(action)(c);
        return authz.requireDeanery(c, () => proxy(action)(c));
      }
      return authz.requireScopeWrite(c, () => proxy(action)(c));
    };

    app.post('/api/getClassReport', statsProxy('getClassReport'));
    app.post('/api/getClassAttendanceStats', statsProxy('getClassAttendanceStats', true));
  },
};
