'use strict';

// Tín hiệu buộc đăng xuất: email có nhóm vừa thay đổi → các request sau trả 401
// cho tới khi họ đăng nhập lại (lúc đó quyền được tính lại từ sheet).
// Chỉ giữ trong bộ nhớ — mất khi restart thì session cũ sống tiếp (fail-open,
// chấp nhận được: rủi ro chỉ là quyền cũ tồn tại thêm tới khi hết hạn session).
const stale = new Set();

// Email bị ảnh hưởng bởi một thao tác ghi quyền; rỗng nếu không liên quan.
function affectedEmails(action, body) {
  const b = body || {};
  if (action === 'saveUser') return [b.user && b.user.email];
  if (action === 'saveGroupMembers') return (b.assignments || []).map((a) => a.email);
  return [];
}

function record(action, body) {
  for (const e of affectedEmails(action, body)) {
    const email = String(e || '').trim().toLowerCase();
    if (email) stale.add(email);
  }
}

function isStale(email) {
  return !!email && stale.has(String(email).toLowerCase());
}

function clear(email) {
  stale.delete(String(email).toLowerCase());
}

module.exports = { record, isStale, clear };

/* ---------- Self-check ---------- */
if (require.main === module) {
  const assert = require('assert');

  record('saveGroupMembers', { assignments: [{ email: 'A@Gmail.com', groups: ['Lớp 1'] }] });
  assert.strictEqual(isStale('a@gmail.com'), true, 'email chuẩn hoá hoa/thường');
  clear('a@gmail.com');
  assert.strictEqual(isStale('a@gmail.com'), false);

  record('saveUser', { user: { email: 'b@gmail.com' } });
  assert.strictEqual(isStale('b@gmail.com'), true);
  assert.strictEqual(isStale('c@gmail.com'), false, 'chỉ email liên quan mới bị đánh dấu');

  record('saveAttendance', { className: 'X' });
  assert.strictEqual(isStale('x@gmail.com'), false, 'thao tác khác không đánh dấu');

  console.log('auth-signal self-check OK');
}
