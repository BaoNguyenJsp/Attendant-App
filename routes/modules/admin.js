'use strict';

// S6 — Quản trị (tier Quản trị / Xứ đoàn).
const { ADMIN } = require('../../lib/authz');
const cache = require('../../lib/cache');
const { warmCache } = require('../../lib/apps-script');

module.exports = {
  register(app, ctx) {
    const { proxy, authz } = ctx;
    for (const a of [
      'getUsers', 'saveUsers', 'saveUser', 'getGroups', 'saveGroups',
      'getGroupMembers', 'saveGroupMembers', 'saveClass',
      'saveHolidays', 'saveConfig', 'startSchoolYear',
    ]) {
      app.post('/api/' + a, authz.requireTier(ADMIN), proxy(a));
    }

    // Nút "làm mới bộ nhớ đệm" ở trang Quản trị: xoá rồi nạp lại để không
    // trả về dữ liệu cũ đang còn trong đệm.
    app.post('/api/warmCache', authz.requireTier(ADMIN), async (req, res) => {
      cache.clearAll();
      await warmCache();
      res.json({ status: 'ok' });
    });
  },
};
