'use strict';

module.exports = function registerApi(app, ctx) {
  const { authz } = ctx;
  app.use('/api/*', authz.requireSession);

  [
    require('./modules/auth'),
    require('./modules/common'),
    require('./modules/attendance'),
    require('./modules/teaching'),
    require('./modules/scores'),
    require('./modules/teacher'),
    require('./modules/report'),
    require('./modules/admin'),
  ].forEach(m => m.register(app, ctx));
};
