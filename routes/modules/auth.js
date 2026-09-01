'use strict';

module.exports = {
  register(app) {
    // FR-AUTH-05: đọc session đã tính khi đăng nhập, không gọi Apps Script.
    app.post('/api/getUser', (req, res) => res.json({
      status: 'ok',
      session: {
        email: req.session.email, fullName: req.session.fullName,
        groups: req.session.groups, scope: req.session.scope,
        tier: req.session.tier, sectors: req.session.sectors,
      },
    }));
  },
};
