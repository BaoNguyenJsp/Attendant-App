/* =====================================================================
   SỔ THIẾU NHI — login/index.js
   Trang đăng nhập: xử lý ?login=denied|error, tự động nhảy về / nếu đã
   đăng nhập, ngược lại hiện nút "Đăng nhập bằng Google".
   ===================================================================== */
'use strict';

import { $, api } from '../shared/common.js';

function showLogin(msg) {
  $('login-status').style.display = 'none';
  if (msg) { $('login-error').style.display = 'block'; $('login-error').textContent = '⛔ ' + msg; }
  $('login-btn').style.display = 'block';
}

const q = new URLSearchParams(location.search);
let msg = q.get('login') === 'denied' ? 'Email chưa được cấp quyền dùng hệ thống. Liên hệ quản trị.'
  : (q.get('login') === 'error' ? q.get('msg') : '');
if (msg) showLogin(msg);
else {
  try {
    localStorage.clear();
    await api('getUser'); 
    location.replace('/'); 
  }
  // 401 = chưa đăng nhập: trạng thái bình thường của trang login → gate sạch, không báo lỗi.
  catch (e) { showLogin(e.status === 401 ? '' : e.message); }
}
