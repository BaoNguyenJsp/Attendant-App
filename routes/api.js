'use strict';

// Nạp các module theo SRS. Mọi /api/* đều qua requireSession (401 nếu chưa đăng nhập).
module.exports = function registerApi(app, ctx) {
  const { authz } = ctx;
  app.use('/api', authz.requireSession);

  const modules = [
    'auth', 'common', 'attendance', 'teaching', 'scores', 'teacher', 'report', 'admin',
  ];
  for (const name of modules) require('./modules/' + name).register(app, ctx);
};
