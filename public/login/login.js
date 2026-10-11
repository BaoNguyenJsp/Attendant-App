/* =====================================================================
   SỔ THIẾU NHI — login/login.js
   Shows the reason of a refused sign-in, jumps to / when already signed in,
   otherwise shows the "Đăng nhập bằng Google" button.
   ===================================================================== */
'use strict';

import { $, api } from '../shared/common.js';

function showLogin(message) {
  $('login-status').style.display = 'none';
  if (message) {
    $('login-error').style.display = 'block';
    $('login-error').textContent = `⛔ ${message}`;
  }
  $('login-btn').style.display = 'block';
}

const query = new URLSearchParams(location.search);
const refused = query.get('login') === 'denied' ? 'Bạn đã hủy đăng nhập bằng Google.' : (query.get('login') === 'error' ? query.get('msg') : '');
if (refused) showLogin(refused);
else {
  try {
    await api('getSession');
    location.replace('/');
  } catch (e) {
    // 401 is the normal state of the login page: show the button without an error.
    showLogin(e.status === 401 ? '' : e.message);
  }
}
