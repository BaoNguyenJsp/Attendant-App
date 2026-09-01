'use strict';

// S6 — Quản trị (tier Quản trị / Xứ đoàn).
const { ADMIN } = require('../../lib/authz');

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    for (const a of [
      'getUsers', 'saveUsers', 'getGroups', 'saveGroups',
      'getGroupMembers', 'saveGroupMembers', 'saveClass',
      'saveHolidays', 'saveConfig', 'startSchoolYear',
    ]) {
      app.post('/api/' + a, authz.requireTier(ADMIN), proxy(a));
    }
  },
};
