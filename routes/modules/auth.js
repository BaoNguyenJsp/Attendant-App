'use strict';

module.exports = {
  register(app) {
    app.post('/api/getSessionUser', (c) => {
      const sess = c.get('session') || {};
      return c.json({
        status: 'ok',
        session: {
          email: sess.email,
          fullName: sess.fullName,
          groups: sess.groups,
          scope: sess.scope,
          tier: sess.tier,
          sectors: sess.sectors,
        },
      });
    });
  },
};
