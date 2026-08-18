module.exports = {
  port: process.env.PORT || 3000,
  apps: {
    giangday: { url: 'https://script.google.com/macros/s/AKfycbwb56a_hMrS_uq1ZpioY4AVLQonsjpNkj8CbRp0CiJjEgEHr1KXS5QU-yNcPzPVVxc/exec' },
    diemdanh: { url: 'https://script.google.com/macros/s/AKfycby4XRzShFYEXmBlL_92tmrnas1V7byqeWOIpvvcoS0mnRbtGThZj1RfDiulQy2AnDqa/exec' },
    hocba:    { url: 'https://script.google.com/macros/s/AKfycby9vA1LnFm5Sc6fzy1eSqshtlFkfqPQftQFAwTOEJR7fuZGt-bYVQrm97f5-Df5co2u/exec' }
  },
  admin: { id: process.env.ADMIN_ID || 'glv123', pass: process.env.ADMIN_PASS || 'nghiahoa2026' },
  appScriptToken: process.env.APP_SCRIPT_TOKEN || 'change-me'
};
