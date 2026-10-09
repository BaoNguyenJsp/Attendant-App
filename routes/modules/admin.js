'use strict';

const { ADMIN } = require('../../lib/authz');
const cache = require('../../lib/cache');

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    for (const a of [
      'getUsers', 'saveUsers', 'saveUser', 'getGroups', 'saveGroups',
      'getGroupMembers', 'saveGroupMembers',
      'saveHolidays', 'saveConfig', 'startSchoolYear',
    ]) {
      app.post('/api/' + a, authz.requireTier(ADMIN), proxy(a));
    }

    app.post('/api/warmCache', authz.requireTier(ADMIN), async (c) => {
      const { warmCache } = require('../../lib/apps-script');
      cache.clearAll();
      await warmCache(ctx.call);
      return c.json({ status: 'ok' });
    });
  },
};
