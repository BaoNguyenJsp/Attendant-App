'use strict';

// Công thức điểm (SRS §6.1 / GOOGLE-SHEET-DESIGN §9). Node không tính điểm cho
// user — Apps Script + frontend tính — nhưng giữ đây để selfcheck chốt hợp đồng.
const dtbHK = (q, e) => (q !== '' && e !== '' && q != null && e != null) ? (+q + 2 * +e) / 3 : null;
const dtbNam = (h1, h2) => (h1 != null && h2 != null) ? (h1 + 2 * h2) / 3 : (h1 ?? h2);
const xepLoai = (d) => (d >= 8 ? 'Giỏi' : d >= 6.5 ? 'Tiên tiến' : 'Trung bình');

module.exports = { dtbHK, dtbNam, xepLoai };
