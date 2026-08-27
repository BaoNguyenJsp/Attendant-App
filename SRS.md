# Đặc tả Yêu Cầu Phần Mềm — Sổ Thiếu Nhi (Attendant App)

**Phiên bản:** 1.0
**Ngày:** 2026-08-27
**Trạng thái:** Dự thảo

---

## 1. Giới thiệu

### 1.1 Mục đích

Tài liệu này quy định các yêu cầu chức năng và phi chức năng của hệ thống **Sổ Thiếu Nhi** — hệ thống quản lý sinh hoạt giới trẻ của Giáo xứ Nghĩa Hòa. Phạm vi gồm: quản lý điểm danh (Điểm danh), sổ giảng dạy hàng tuần (Giảng dạy), học bạ (Học bạ), hồ sơ học sinh và công tác quản trị.

Hệ thống thay thế các công cụ điểm danh, giảng dạy và học bạ riêng lẻ trước đây bằng một ứng dụng web hợp nhất: một lần đăng nhập Google, một màn hình launcher, một nguồn dữ liệu tập trung và phân quyền theo vai trò.

### 1.2 Phạm vi

Trong phạm vi:
- Đăng nhập Google OAuth (Gmail) kèm phân quyền theo vai trò.
- Màn hình launcher liên kết bốn phân hệ.
- Nhập/sửa điểm danh, tra cứu theo CCCD, thống kê theo lớp, báo cáo toàn đoàn.
- Sổ giảng dạy hàng tuần kèm upload giáo án lên Google Drive.
- Nhập điểm hàng loạt, tra cứu học bạ theo năm, tổng hợp & xếp loại, danh sách khen thưởng.
- Quản lý học sinh (thêm, sửa, chuyển lớp, ra trường).
- Quản trị: người dùng, nhóm giáo viên, phân công, lớp học, chuyển năm học.

Ngoài phạm vi (không xây dựng):
- Cơ sở dữ liệu thật (SQLite/Postgres) — Google Sheets đủ đáp ứng ở quy mô này.
- Gộp các phân hệ thành một SPA ngoài mô hình launcher.
- Mật khẩu từng người dùng — thay bằng Google OAuth.
- Giới hạn tốc độ (rate limiting) — xem xét lại nếu ứng dụng được phát hành công khai.

### 1.3 Định nghĩa, thuật ngữ, viết tắt

| Thuật ngữ | Ý nghĩa |
|------|---------|
| CCCD | Căn cước công dân — mã định danh cố định của học sinh |
| GLV | Giáo lý viên |
| GV / gv | Giáo viên — vai trò giáo viên |
| GVCN / gvcn | Giáo viên chủ nhiệm — vai trò giáo viên chủ nhiệm |
| TBM | Trưởng bộ môn (xem xét/chỉnh sửa giáo án) |
| HK | Học kỳ (HK1 / HK2) |
| ĐTB | Điểm trung bình |
| WeekOf | Ngày Chúa Nhật (YYYY-MM-DD) làm mốc cho tuần điểm danh/giảng dạy |
| Session | Buổi sinh hoạt — một trong 4 loại buổi (xem §3.3) |
| Rollover | Quy trình đầu năm học — chuyển từ cuối năm cũ sang năm học mới |
| Apps Script | Backend web app Google Apps Script đọc/ghi bảng tính |
| Node proxy | Máy chủ Node.js/Express xác thực và chuyển tiếp tới Apps Script |

### 1.4 Quy ước tài liệu

Mã yêu cầu theo quy ước thống nhất:
- **FR-XX-YY** — yêu cầu chức năng (XX = phân hệ: AUTH, LAUNCH, DD, GD, HB, HS, ADM, CROSS).
- **NFR-YY** — yêu cầu phi chức năng.
- Các tên hàm được trích trong yêu cầu (ví dụ `normSunday`, `only`, `markAll`) biểu thị hành vi giao diện.

"Shall" = bắt buộc; "should" = khuyến nghị; "may" = tùy chọn.

---

## 2. Tổng quan

### 2.1 Góc nhìn sản phẩm

```
Trình duyệt (một ứng dụng HTML)
   │  fetch('/api/…')
   ▼
Node.js/Express proxy  — đăng nhập OAuth, session, thực thi vai trò/phạm vi (tầng kiểm soát)
   │  POST/GET kèm token dùng chung
   ▼
Google Apps Script (một web app) — kiểm tra token, đọc/ghi bảng tính
   ▼
Google Sheets (một bảng tính, 11 tab)   Google Drive (file giáo án, chỉ lưu URL trong sheet)
```

- Trình duyệt không bao giờ gọi trực tiếp Apps Script và không giữ bất kỳ thông tin đăng nhập nào.
- Mọi thao tác ghi đều trả về phản hồi thành công/lỗi thật cho trình duyệt (không dùng `mode:'no-cors'` kiểu fire-and-forget).
- Phân quyền được **thực thi ở phía máy chủ** (Node), không chỉ đơn thuần ẩn nút trong giao diện.

### 2.2 Chức năng sản phẩm (tóm tắt)

| Phân hệ | Chức năng |
|--------|-----------|
| Đăng nhập & vai trò | Đăng nhập Google OAuth; từ chối email không có/đã bị khóa; giao diện thích ứng theo vai trò; đăng xuất |
| Launcher | Banner năm học, danh tính người dùng, lối vào quản trị, các thẻ phân hệ |
| Điểm danh (S2) | Nhập/sửa điểm danh theo lớp/tuần/buổi; tra cứu CCCD; thống kê theo lớp; báo cáo toàn đoàn; xuất Excel/in |
| Giảng dạy (S3) | Thẻ bài giảng hàng tuần theo lớp; modal cập nhật kèm upload file lên Drive; thống kê theo lớp & tần suất giáo viên |
| Học bạ (S4) | Nhập điểm hàng loạt; tra cứu học bạ theo năm bằng CCCD; tổng hợp & xếp loại; danh sách khen thưởng |
| Học sinh (S4b) | Thêm/sửa/chuyển lớp/ra trường học sinh |
| Quản trị (S5) | Người dùng, nhóm giáo viên, phân công, lớp học, chuyển năm học |

### 2.3 Phân loại người dùng

| Vai trò | Mô tả | Phạm vi |
|------|-------------|-------|
| **admin** | Điều phối viên mục vụ của giáo xứ | Toàn bộ: mọi lớp, báo cáo toàn đoàn, Quản trị (người dùng/nhóm/phân công/lớp/chuyển năm) |
| **gv** | Giáo lý viên | Các lớp được phân công năm nay (cá nhân hoặc qua nhóm); không có báo cáo toàn đoàn; không có cột Xếp loại |
| **gvcn** | Giáo viên chủ nhiệm (đồng thời là gv) | Như gv, thêm: quản lý học sinh lớp chủ nhiệm, nhập điểm cho lớp đó, xem tổng hợp cho lớp đó |
| **blocked / unknown** | Bất kỳ email nào không active trong Users | Bị từ chối khi đăng nhập: "Liên hệ admin để được cấp quyền" |

Một người dùng có thể giữ nhiều vai trò cùng lúc (ví dụ `admin,gv,gvcn`); quyền được cấp nếu **ít nhất một** vai trò thỏa điều kiện.

### 2.4 Môi trường vận hành

- **Trình duyệt:** Chrome/Edge/Firefox mới nhất trên máy tính và điện thoại. Không cần build toolchain; một HTML + vanilla JS.
- **Backend:** Node.js (≥ v18) với Express; cấu hình OAuth client Google phía máy chủ.
- **Dữ liệu:** một Google spreadsheet; một Google Apps Script web app; Google Drive lưu file giáo án.
- **Ngôn ngữ:** toàn bộ giao diện bằng tiếng Việt.

### 2.5 Ràng buộc thiết kế & triển khai

1. Một spreadsheet, một Apps Script, một Node proxy — không nhập trùng dữ liệu học sinh; mối liên kết duy nhất giữa các phân hệ là CCCD.
2. Học sinh được định danh cố định bằng CCCD; không bao giờ xóa dòng (tra cứu lịch sử phụ thuộc vào điều này).
3. File giáo án lưu trên Google Drive; sheet chỉ lưu URL chia sẻ (tránh giới hạn 50k ký tự/ô).
4. Ô điểm trống được lưu trống (`NULL`), không ép về 0.
5. Ngày tháng tính bằng phép toán ngày giờ cục bộ (giờ Việt Nam), không bao giờ dùng `toISOString()` (lệch 1 ngày do UTC).
6. Mọi dữ liệu động được escape trước khi chèn vào DOM (chống XSS).
7. Năm học và trọng số xếp loại là cấu hình, không hardcode.

### 2.6 Giả định và phụ thuộc

- Người dùng có tài khoản Google (Gmail) để đăng nhập.
- Admin được khai báo trực tiếp trong tab `Users` (không có luồng bootstrap).
- Đã có OAuth client Google (Client ID/Secret) và một thư mục Drive, được cấu hình trong `config.js` (có thể ghi đè bằng biến môi trường).
- Tái deploy Apps Script web app có thể đổi URL; `config.js` phải trỏ tới deployment đang hoạt động.
- Năm học hiện tại là 2026–2027.

---

## 3. Yêu cầu chức năng

### 3.1 Xác thực & phân quyền (FR-AUTH)

| ID | Yêu cầu |
|----|-------------|
| FR-AUTH-01 | Ứng dụng phải chặn toàn bộ nội dung phía sau đăng nhập Google OAuth. Cổng chặn là lớp phủ đăng nhập S0. |
| FR-AUTH-02 | Khi đăng nhập, máy chủ phải đọc email của người dùng từ token Google và đối chiếu với tab `Users`. |
| FR-AUTH-03 | Email không có trong `Users` phải bị từ chối kèm thông báo "Liên hệ admin để được cấp quyền". |
| FR-AUTH-04 | Người dùng có `Status` là `blocked` phải bị từ chối và không được vào hệ thống. |
| FR-AUTH-05 | Khi thành công, máy chủ phải tạo session chứa `{email, roles[], lops[], gvcnOf[], groups[]}` tính từ `Users`, `Assignments` và `GroupMembers`. |
| FR-AUTH-06 | Giao diện phải thích ứng theo session đăng nhập (`renderUser`): huy hiệu vai trò, ẩn/hiện các điều khiển `admin-only` và `mgr-only`, lọc danh sách lớp theo phạm vi của người dùng. |
| FR-AUTH-07 | Đăng xuất phải xóa session trên máy chủ và quay về cổng đăng nhập. |
| FR-AUTH-08 | Middleware trên máy chủ phải kiểm tra vai trò và phạm vi trên mọi lời gọi API trước khi chuyển tiếp tới Apps Script; lời gọi ngoài phạm vi phải trả 403 kể cả khi gọi trực tiếp (ví dụ qua curl). Phân quyền không chỉ là ẩn nút trong giao diện. |
| FR-AUTH-09 | Các thao tác toàn đoàn (`getStats(toandoan)`, tổng hợp toàn đoàn) phải yêu cầu `admin` ở máy chủ. |
| FR-AUTH-10 | Tra cứu CCCD phải bị giới hạn phạm vi: gvcn → học sinh lớp chủ nhiệm của mình (mọi năm); gv → học sinh các lớp được phân công; admin → mọi học sinh. Tra cứu CCCD ngoài phạm vi trả 403. |

### 3.2 Launcher (FR-LAUNCH)

| ID | Yêu cầu |
|----|-------------|
| FR-LAUNCH-01 | Sau khi đăng nhập, người dùng vào launcher (S1): banner gradient với tiêu đề ứng dụng, năm học, email người dùng + huy hiệu vai trò, và nút đăng xuất. |
| FR-LAUNCH-02 | Banner hiển thị năm học hiện tại (2026–2027) lấy từ `Config.CurrentSchoolYear`, có thể chọn/đổi mà không hardcode. |
| FR-LAUNCH-03 | Nút "⚙ Quản trị" chỉ hiện với `admin` (`admin-only`). |
| FR-LAUNCH-04 | Launcher hiển thị các thẻ phân hệ: **Điểm danh**, **Giảng dạy**, **Học bạ**. Thẻ **Học sinh** chỉ hiện với `admin` và `gvcn` (`mgr-only`). |
| FR-LAUNCH-05 | Mỗi thẻ mô tả phạm vi của người dùng (ví dụ "Lớp của bạn: A1, A2 — theo phân công năm nay") lấy từ `lops[]` trong session. |

### 3.3 Điểm danh (FR-DD)

**Loại buổi sinh hoạt:**

| Mã | Nhãn trên giao diện |
|------|----------|
| `SUN_MASS` | Chủ Nhật — Lễ Chúa Nhật |
| `SUN_CLASS` | Chủ Nhật — Học Giáo Lý |
| `SUN_ADORATION` | Chủ Nhật — Chầu Thánh Thể |
| `THU_MASS` | Thứ Năm — Lễ Thứ Năm |

**Tab: Điểm Danh & Sửa (t-dd)**

| ID | Yêu cầu |
|----|-------------|
| FR-DD-01 | Bộ lọc: Lớp, Tuần Điểm Danh (ngày), Buổi Sinh Hoạt (chọn buổi). Ngày tuần phải được chuẩn hóa về Chúa Nhật của tuần qua `normSunday` trước khi dùng. |
| FR-DD-02 | Bảng điểm danh liệt kê học sinh của lớp: STT, Số CCCD, Họ Và Tên, Hiện Diện (checkbox), Có Phép (checkbox), Ghi Chú/Lý Do Vắng (ô nhập). |
| FR-DD-03 | "Hiện Diện" và "Có Phép" loại trừ lẫn nhau trên từng dòng (`only`): chọn một ô thì xóa ô kia. |
| FR-DD-04 | Nút "✅ Chọn Hiện Diện Tất Cả" phải đánh dấu toàn bộ học sinh hiện diện và xóa hết cờ có phép (`markAll`). |
| FR-DD-05 | Tổng kết tức thì hiển thị "Sĩ số / Hiện diện / Vắng" tính từ các checkbox (`updateSum`). |
| FR-DD-06 | Nếu đã có dữ liệu điểm danh cho (lớp, tuần, buổi) đang chọn, giao diện phải hiện nhãn chế độ sửa ("Bạn đang ở chế độ CHỈNH SỬA / CẬP NHẬT LẠI") và điền sẵn trạng thái đã lưu (`renderDD`). |
| FR-DD-07 | Lưu phải gửi toàn bộ dòng của (lớp, tuần, buổi) thành một batch; batch thay thế trọn cụm điểm danh của cả lớp ứng với khóa đó. |
| FR-DD-08 | Lưu phải báo **kết quả thật** từ máy chủ (thông báo thành công hoặc lỗi thật), không phải thông báo thành công kiểu fire-and-forget (`saveAttendance` qua proxy; cấm dùng `mode:'no-cors'`). |
| FR-DD-09 | Mỗi dòng điểm danh mang `SchoolYear`; dữ liệu các năm trước được giữ nguyên và không bao giờ xóa khi chuyển năm. |
| FR-DD-10 | Chặn theo session/phạm vi: chỉ người dùng được phân công lớp đó trong năm nay mới được xem hoặc lưu điểm danh của lớp. |

**Tab: Trích Lục Theo CCCD (t-tl)**

| ID | Yêu cầu |
|----|-------------|
| FR-DD-11 | Nhập CCCD; ứng dụng trả về thông tin học sinh (họ tên, lớp hiện tại, huy hiệu active) và danh sách đầy đủ các buổi VẮNG / CÓ PHÉP qua **mọi năm**, mỗi dòng gồm Ngày, Buổi Sinh Hoạt, Trạng Thái, Ghi Chú/Lý Do. |
| FR-DD-12 | Tra cứu CCCD bị giới hạn phạm vi phía máy chủ (FR-AUTH-10). |
| FR-DD-13 | Nút "📥 Xuất File Excel" xuất kết quả tra cứu (SheetJS). |

**Tab: Thống Kê Theo Lớp (t-tk)**

| ID | Yêu cầu |
|----|-------------|
| FR-DD-14 | Chọn lớp; ứng dụng hiển thị từng học sinh cột tỷ lệ hiện diện theo từng loại buổi (Lễ CN, Giáo Lý, Chầu TT, Lễ T5) và tổng tỷ lệ hiện diện %. |
| FR-DD-15 | Các tuần có trong `Holidays` phải bị loại khỏi mẫu số tỷ lệ (buổi nghỉ đã lên lịch không được trừ điểm học sinh). |
| FR-DD-16 | Nút "📊 Xuất Excel" và "🖨️ In Báo Cáo" xuất/in báo cáo. |
| FR-DD-17 | Chỉ các lớp nằm trong phạm vi người dùng mới được chọn. |

**Tab: Báo Cáo Toàn Đoàn (t-toandoan)**

| ID | Yêu cầu |
|----|-------------|
| FR-DD-18 | Chỉ hiển thị với `admin`; máy chủ cũng từ chối (403) thao tác cơ bản cho người không phải admin. |
| FR-DD-19 | Báo cáo hiển thị tổng số thiếu nhi toàn đoàn, tỷ lệ hiện diện Chúa Nhật trung bình, tỷ lệ hiện diện Thứ Năm trung bình, và bảng theo lớp (Sĩ Số, tỷ lệ từng loại buổi, xếp loại Chuyên Cần). |
| FR-DD-20 | "📊 Xuất Excel Báo Cáo" và "🖨️ In Báo Cáo" xuất/in báo cáo toàn đoàn. |

### 3.4 Giảng dạy (FR-GD)

**Tab: Lịch Theo Tuần (t-week)**

| ID | Yêu cầu |
|----|-------------|
| FR-GD-01 | Chọn Chúa Nhật của tuần (chuẩn hóa qua `normSunday`); ứng dụng hiển thị một thẻ cho mỗi lớp trong tuần đó. |
| FR-GD-02 | Mỗi thẻ hiển thị: huy hiệu trạng thái (Đã cập nhật / Chưa nhập), GLV được phân công, nội dung bài học, liên kết giáo án đã upload (Drive), và trạng thái bản đã chỉnh sửa của TBM (bản đã duyệt / chưa có). |
| FR-GD-03 | Huy hiệu tổng kết "Đã cập nhật: X/Y lớp" hiển thị mức độ đã cập nhật. |
| FR-GD-04 | "Cập nhật" mở modal (`openModal`): các trường GLV đứng lớp, nội dung/tên bài học, 📄 giáo án (GLV upload), và ✏️ giáo án đã chỉnh sửa (TBM upload). |
| FR-GD-05 | Khi lưu, file tải lên được chuyển qua Node tới Apps Script, lưu trên Google Drive, và chỉ URL kết quả được ghi vào sheet (`LessonPlanUrl`, `RevisedPlanUrl`). Giới hạn 50k ký tự/ô không bao giờ được chạm tới. |
| FR-GD-06 | Thao tác ghi phải trả về kết quả thật từ Apps Script; lỗi hiển thị thành thông báo lỗi thật. |
| FR-GD-07 | Khóa bản ghi tuần = (SchoolYear, WeekOf, ClassName); lưu một tuần cho một lớp sẽ ghi đè trọn cụm đó. |
| FR-GD-08 | Chỉ người dùng được phân công lớp đó (hoặc admin) mới được cập nhật bản ghi giảng dạy. |

**Tab: Thống Kê Theo Lớp (t-gdstats)**

| ID | Yêu cầu |
|----|-------------|
| FR-GD-09 | Chọn lớp; ứng dụng hiển thị "Tổng số buổi đã cập nhật" và danh sách tần suất giáo viên (👤 GLV — số buổi). |
| FR-GD-10 | Bảng lịch sử chi tiết hiển thị từng tuần đã cập nhật: Ngày dạy, GLV, Bài học, Giáo án gốc, Giáo án chỉnh sửa. |
| FR-GD-11 | Báo cáo theo nhóm: giáo viên thuộc một nhóm xem được thống kê của cả nhóm trên các lớp mà nhóm được phân công (ví dụ anhbao xem được A1+A2+B1 vì nhóm của anh phụ trách các lớp đó). |

### 3.5 Học bạ (FR-HB)

**Tab: Cập Nhật Điểm Hàng Loạt (t-nh)**

| ID | Yêu cầu |
|----|-------------|
| FR-HB-01 | Chọn Năm Học và Lớp. Lựa chọn lớp giới hạn theo vai trò: admin → mọi lớp; gv/gvcn → các lớp được phân công/lớp của mình (lớp ngoài phạm vi hiển thị disabled). |
| FR-HB-02 | Bảng liệt kê học sinh với các cột nhóm theo HK1 và HK2, mỗi học kỳ gồm một ô nhập điểm 15' và một ô nhập điểm thi (HK). |
| FR-HB-03 | Ô trống được lưu trống (`NULL`) — không bao giờ tự chuyển thành 0. |
| FR-HB-04 | "💾 Lưu Tất Cả Điểm Lớp" lưu cả batch trong một lần gọi; thao tác ghi trả về kết quả thật (Node kiểm tra vai trò gvcn/admin của lớp trước). |
| FR-HB-05 | Khóa dòng điểm = (SchoolYear, IdNumber); khóa batch cả lớp = (SchoolYear, ClassName). Việc tính điểm trung bình thực hiện lúc tổng hợp, không phải lúc nhập. |
| FR-HB-06 | Thêm/xóa học sinh thực hiện ở màn hình Học sinh/Quản trị, không phải ở đây. |
| FR-HB-07 | Chỉ `gvcn` của lớp hoặc `admin` mới được lưu điểm; người khác chỉ xem (nếu trong phạm vi) hoặc bị chặn. |

**Tab: Trích Lục Học Bạ (t-hbt)**

| ID | Yêu cầu |
|----|-------------|
| FR-HB-08 | Nhập CCCD; ứng dụng trả về thông tin học sinh và một thẻ gập **cho mỗi năm học** chứa lớp của năm đó, điểm HK1/HK2 và ĐTB năm theo từng môn, cùng tóm tắt chuyên cần của năm đó (chuyên cần, vắng có phép/không phép). |
| FR-HB-09 | Thẻ năm hiện tại mở sẵn; các năm cũ thu gọn (thẻ gập theo từng năm). |
| FR-HB-10 | Không gộp các năm trong một bảng; không dựa vào `getCalculatedClass` — lớp của mỗi năm lấy từ chính dữ liệu năm đó. |
| FR-HB-11 | Tra cứu bị giới hạn phạm vi theo FR-AUTH-10; CCCD ngoài phạm vi → 403. |

**Tab: Tổng Hợp & Xếp Loại (t-th)**

| ID | Yêu cầu |
|----|-------------|
| FR-HB-12 | Với một lớp/năm đã chọn, mỗi học sinh hiển thị: ĐTB học lực, % chuyên cần, Điểm tổng hợp, Xếp loại. |
| FR-HB-13 | ĐTB học kỳ = (15' + 2·HK) / 3; ĐTB năm = (HK1 + 2·HK2) / 3 — tính phía máy chủ. |
| FR-HB-14 | Điểm tổng hợp = Học lực × `AcademicWeight` + Chuyên cần × (1 − `AcademicWeight`); trọng số mặc định 60/40, lưu trong `Config`, và chỉnh được qua giao diện. |
| FR-HB-15 | Bảng kết hợp dữ liệu từ `Scores` (học lực) và `Attendance` (chuyên cần) — học sinh điểm cao nhưng chuyên cần thấp phải bị hạ xuống thấy rõ. |
| FR-HB-16 | Cột theo vai trò: `gvcn` → đủ cột cho lớp của mình; `gv` → các lớp được phân công nhưng **không có cột Xếp loại**; `admin` → mọi lớp kèm nút "📊 Xếp loại toàn đoàn". |
| FR-HB-17 | Thao tác tổng hợp toàn đoàn yêu cầu `admin`; gv gọi trực tiếp bị 403. |

**Tab: Khen Thưởng (t-kt)**

| ID | Yêu cầu |
|----|-------------|
| FR-HB-18 | Lọc theo Năm Học và Lớp; danh sách hiển thị STT, Họ Tên, Lớp, Chuyên Cần cả năm, ĐTB học tập CN, Danh Hiệu. |
| FR-HB-19 | Danh sách khen thưởng lấy từ kết quả Tổng hợp & xếp loại (học lực + chuyên cần), không chỉ dựa trên điểm môn. |
| FR-HB-20 | "🖨️ In Danh Sách" in danh sách. |

### 3.6 Học sinh — Quản lý học sinh (FR-HS)

| ID | Yêu cầu |
|----|-------------|
| FR-HS-01 | Bộ lọc lớp: admin → mọi lớp; gvcn → lớp chủ nhiệm của mình, cố định và không sửa được. Màn hình này không dành cho gv thường (`mgr-only`). |
| FR-HS-02 | "＋ Thêm thiếu nhi" thêm học sinh (Họ tên + CCCD) vào lớp đang chọn trong tab `Students`. |
| FR-HS-03 | Bảng liệt kê STT, Họ Và Tên, Số CCCD, Ghi chú, và thao tác "✏️ Sửa". |
| FR-HS-04 | Sửa hỗ trợ đổi tên và **chuyển lớp**; CCCD không đổi khi chuyển lớp, bảo toàn lịch sử điểm danh và học bạ. |
| FR-HS-05 | Học sinh không bao giờ bị xóa — khi thôi sinh hoạt ghi là `graduated`/`withdrawn` để lịch sử vẫn tra cứu được theo CCCD. |

### 3.7 Quản trị (FR-ADM)

| ID | Yêu cầu |
|----|-------------|
| FR-ADM-01 | Chỉ `admin` truy cập. Các tab: Người dùng, Nhóm giáo viên, Phân công, Lớp học, Đầu năm học. |
| FR-ADM-02 | **Users:** danh sách Email, Họ tên, Vai trò (đa vai trò, phân cách bằng dấu phẩy, hiện huy hiệu), Trạng thái (active/blocked). Admin thêm giáo viên bằng email + chọn vai trò; giáo viên sau đó đăng nhập bằng Gmail. Khóa một email sẽ từ chối đăng nhập của email đó. |
| FR-ADM-03 | **Nhóm giáo viên:** tạo/sửa nhóm và thành viên; dùng cho phân công hàng loạt và báo cáo theo nhóm. |
| FR-ADM-04 | **Phân công:** gán mỗi lớp (theo năm học) cho một email cá nhân hoặc một nhóm (`group:<GroupName>`); kết quả quyết định mọi phép kiểm tra phạm vi. |
| FR-ADM-05 | **Lớp học:** thêm/sửa lớp; danh sách lớp cấp dữ liệu cho mọi dropdown lớp trong ứng dụng. Chỉ được xóa lớp trống (không có học sinh) để tránh làm mồ côi điểm/điểm danh. |
| FR-ADM-06 | **Đầu năm học (`startSchoolYear`):** quy trình chuyển năm phải (1) lên lớp học sinh (A1→A2→B1…; lớp cuối → `graduated`, học sinh học lại lớp chỉnh tay), (2) copy phân công năm cũ sang năm mới làm bản nháp để admin rà soát, (3) **không** copy điểm/điểm danh/giảng dạy (năm cũ giữ làm lịch sử, năm mới bắt đầu trống), và (4) không bao giờ xóa dữ liệu. |
| FR-ADM-07 | Nút chuyển năm yêu cầu xác nhận rõ ràng; `Config.CurrentSchoolYear` được cập nhật sang năm mới. |

### 3.8 Yêu cầu xuyên suốt (FR-CROSS)

| ID | Yêu cầu |
|----|-------------|
| FR-CROSS-01 | Mọi thao tác ghi tới Apps Script trả về `{status, message}` thật; giao diện hiển thị thành công hoặc lỗi đúng sự thật. Cấm dùng `mode:'no-cors'`. |
| FR-CROSS-02 | Mọi dữ liệu động chèn vào DOM đều được escape HTML (kể cả giá trị nằm trong thuộc tính) để chống XSS. |
| FR-CROSS-03 | Ngày tháng tính bằng các thành phần ngày cục bộ (giờ VN), không bao giờ dùng `toISOString()` (lệch 1 ngày do UTC). Ngày tuần chuẩn hóa về Chúa Nhật. |
| FR-CROSS-04 | `Config` chứa `CurrentSchoolYear`, `AcademicWeight`, `DriveFolderId`; thay đổi chúng không cần sửa code. |
| FR-CROSS-05 | Các buổi nghỉ (tab `Holidays`) loại tuần/buổi đó khỏi mẫu số tỷ lệ hiện diện, đồng thời giữ nguyên mọi bản ghi đã lưu để tra cứu theo CCCD. |
| FR-CROSS-06 | Bộ lọc năm học: truy vấn mặc định theo `Config.CurrentSchoolYear`; tra cứu lịch sử có thể truyền năm cụ thể. |

---

## 4. Yêu cầu giao diện ngoài

### 4.1 Giao diện người dùng

- **S0 Cổng đăng nhập:** lớp phủ với đăng nhập Google; thông báo từ chối cho email bị khóa/không có.
- **S1 Launcher:** banner + bộ chọn năm học + lối vào quản trị + các thẻ phân hệ.
- **S2 Điểm danh:** 4 tab (Điểm danh & sửa / Trích lục / Thống kê lớp / Toàn đoàn). Ô ngày chuẩn hóa về Chúa Nhật; các checkbox loại trừ lẫn nhau.
- **S3 Giảng dạy:** 2 tab; lưới thẻ + modal cập nhật với hai trường upload file.
- **S4 Học bạ:** 4 tab; bảng điểm nhóm theo HK1/HK2, tra cứu gập theo năm, bảng tổng hợp với trọng số chỉnh được, bảng khen thưởng.
- **S4b Học sinh:** bảng học sinh lọc theo lớp kèm thêm/sửa.
- **S5 Quản trị:** 5 tab quản trị.
- Mọi màn hình: banner header gradient, thanh tab trắng với trạng thái active gạch chân xanh, thông báo toast cho kết quả.

### 4.2 Giao diện phần mềm

| Giao diện | Chi tiết |
|-----------|---------|
| Trình duyệt → Node | `GET/POST /api/*` với session cookie HttpOnly; đăng nhập qua luồng Google OAuth (`/auth/google`, callback) |
| Node → Apps Script | Một URL web app; token bí mật dùng chung trong query (`GET`) hoặc body (`POST`); body POST dạng `text/plain;charset=utf-8` để khớp `e.postData.contents` |
| Apps Script → Sheets | `SpreadsheetApp` đọc/ghi 11 tab |
| Apps Script → Drive | `DriveApp.createFile` cho giáo án; lưu URL chia sẻ vào sheet |
| Xuất Excel | SheetJS (`xlsx`) phía client cho các bản xuất điểm danh/thống kê/tổng hợp |
| Google OAuth | OAuth client Cloud; máy chủ đọc email từ token đã xác thực |

### 4.3 Giao diện phần cứng

Không có — chỉ dùng trình duyệt chuẩn trên máy tính/điện thoại.

---

## 5. Yêu cầu phi chức năng

| ID | Yêu cầu |
|----|-------------|
| NFR-01 | **Bảo mật — phân quyền:** mọi thao tác nhạy cảm (báo cáo toàn đoàn, tra cứu CCCD ngoài phạm vi, lưu điểm lớp khác, thao tác admin) bị từ chối 403 ở tầng Node, không chỉ ẩn trong giao diện. |
| NFR-02 | **Bảo mật — thông tin đăng nhập:** không có mật khẩu, URL Apps Script hay token nào nằm trong code client; mọi bí mật nằm phía máy chủ và có thể ghi đè bằng biến môi trường. |
| NFR-03 | **Bảo mật — XSS:** mọi nội dung động hiển thị đều được escape (FR-CROSS-02). |
| NFR-04 | **Bảo mật — session:** session cookie là HttpOnly; người dùng không có/bị khóa không được cấp session. |
| NFR-05 | **Toàn vẹn dữ liệu:** học sinh, điểm danh và điểm không bao giờ bị xóa; chuyển năm không phá hủy dữ liệu. CCCD là khóa định danh vĩnh viễn. |
| NFR-06 | **Toàn vẹn dữ liệu:** ô điểm trống giữ nguyên trống; không có số 0 ngầm. |
| NFR-07 | **Hiệu năng:** hệ thống xử lý ~600 học sinh và ~25k dòng điểm danh/năm; tải trang thông thường không có độ trễ đáng kể (tổng hợp phía máy chủ, không tính toán nặng phía client). |
| NFR-08 | **Khả dụng:** ứng dụng bằng tiếng Việt, chạy trên điện thoại và máy tính, và phản hồi tức thì, chân thật cho mỗi lần lưu. |
| NFR-09 | **Tin cậy:** lỗi ghi được truyền về thành thông báo lỗi thật để người vận hành biết dữ liệu chưa được lưu. |
| NFR-10 | **Cấu hình hóa:** năm học và trọng số xếp loại sửa được mà không cần đổi code (tab Config). |
| NFR-11 | **Bảo trì:** một spreadsheet, một Apps Script, một Node proxy — thay đổi schema chạm đúng một nơi, không phải ba ứng dụng. |
| NFR-12 | **Khả chuyển/triển khai:** frontend không có bước build; hosting là file tĩnh do ứng dụng Node phục vụ. |

---

## 6. Yêu cầu dữ liệu

Một bảng tính, 11 tab; mỗi tab một dòng header; mọi thao tác đọc/ghi qua Apps Script.

### 6.1 Từ điển dữ liệu

**1. Users** — danh tính đăng nhập
| Cột | Ví dụ | Ghi chú |
|--------|---------|-------|
| Email | anhbao@gmail.com | Đăng nhập bằng chính Gmail này |
| FullName | Anh Bảo | |
| Roles | admin,gv,gvcn | Phân cách bằng dấu phẩy; đa vai trò |
| Status | active / blocked | Blocked → từ chối đăng nhập |

**2. TeacherGroups**
| Cột | Ví dụ |
|--------|---------|
| GroupName | Tổ Nghiệp vụ (Khối 1–2) |
| Description | |

**3. GroupMembers**
| Cột | Ví dụ |
|--------|---------|
| GroupName | Tổ Nghiệp vụ (Khối 1–2) |
| Email | anhbao@gmail.com |

**4. Classes** — thứ tự dòng = thứ tự lên lớp (A1→A2→B1…)
| Cột | Ví dụ |
|--------|---------|
| ClassName | A1 |
| Grade | Kinh Thánh 1 |

**5. Students** — khóa vĩnh viễn = IdNumber (CCCD), không bao giờ xóa
| Cột | Ví dụ | Ghi chú |
|--------|---------|-------|
| IdNumber | 079212345678 | Vĩnh viễn |
| FullName | Nguyễn Văn An | |
| DateOfBirth | 2015-03-01 | |
| CurrentClass | A1 | Chuyển lớp = sửa ở đây |
| EnrollYear | 2024-2025 | |
| Status | active / graduated / withdrawn | |
| Note | | |

**6. Assignments** — theo năm
| Cột | Ví dụ |
|--------|---------|
| SchoolYear | 2026-2027 |
| ClassName | A2 |
| Assignee | anhbao@gmail.com HOẶC group:Tổ Nghiệp vụ (Khối 1–2) |

**7. Attendance** — chỉ thêm mới qua các năm; khóa ghi đè = (SchoolYear, WeekOf, Session, ClassName)
| Cột | Ví dụ |
|--------|---------|
| SchoolYear | 2026-2027 |
| WeekOf | 2026-08-23 (Chúa Nhật) |
| Session | SUN_MASS / SUN_CLASS / SUN_ADORATION / THU_MASS |
| IdNumber | 079212345678 |
| ClassName | A1 |
| AttendanceStatus | present / absent / excused |
| Note | |

**8. Teaching** — khóa = (SchoolYear, WeekOf, ClassName)
| Cột | Ví dụ |
|--------|---------|
| SchoolYear | 2026-2027 |
| WeekOf | 2026-08-23 |
| ClassName | A1 |
| TeacherEmail | anhbao@gmail.com |
| LessonContent | Chúa là mục tử nhân lành |
| LessonPlanUrl | https://drive…/giaoan.pdf |
| RevisedPlanUrl | https://drive…/duyet.pdf (trống nếu chưa có) |
| UpdatedBy | anhbao@gmail.com |

**9. Scores** — một dòng/học sinh/năm; ô trống = chưa có điểm
| Cột | Ví dụ |
|--------|---------|
| SchoolYear | 2026-2027 |
| IdNumber | 079212345678 |
| ClassName | A1 |
| Quiz15_S1 | 8 |
| Exam_S1 | 9 |
| Quiz15_S2 | |
| Exam_S2 | |

**10. Config**
| Khóa | Giá trị |
|-----|-------|
| CurrentSchoolYear | 2026-2027 |
| AcademicWeight | 0.6 |
| DriveFolderId | <id thư mục drive> |

**11. Holidays** — loại khỏi mẫu số tỷ lệ hiện diện
| Cột | Ví dụ | Ghi chú |
|--------|---------|-------|
| SchoolYear | 2026-2027 | |
| WeekOf | 2027-01-03 | |
| Session | (trống = nghỉ cả tuần) | Hoặc một mã buổi cụ thể |
| Reason | Nghỉ Tết Dương lịch | |

### 6.2 Quan hệ dữ liệu

```
Users ──┬─ TeacherGroups ← GroupMembers
        └─ Assignments (theo năm) ── quy định phạm vi gv/gvcn cho từng lớp
Classes ── Students (CurrentClass)
              │ IdNumber
              ├── Attendance (theo tuần/buổi/năm)
              ├── Teaching   (theo tuần/lớp/năm; file trên Drive)
              └── Scores     (theo năm)
Config   ── CurrentSchoolYear + AcademicWeight
Holidays ── loại tuần/buổi khỏi mẫu số tỷ lệ hiện diện
```

---

## 7. Quy tắc nghiệp vụ & ma trận phân quyền

### 7.1 Ma trận phân quyền

| Chức năng | gv | gvcn | admin |
|----------|----|------|-------|
| Nhập/sửa điểm danh | Lớp được phân công | Lớp được phân công | Toàn bộ |
| Thống kê điểm danh (theo lớp) | Lớp được phân công | Lớp được phân công | Toàn bộ |
| Báo cáo toàn đoàn | — (403) | — (403) | ✅ |
| Cập nhật giảng dạy | Lớp được phân công | Lớp được phân công | Toàn bộ |
| Nhập điểm | — | Lớp của mình | Toàn bộ |
| Tra cứu học bạ (CCCD) | Lớp được phân công | Lớp của mình (mọi năm) | Toàn bộ |
| Tổng hợp & xếp loại | Lớp được phân công, không cột Xếp loại | Lớp của mình, đủ cột | Toàn bộ + toàn đoàn |
| Danh sách khen thưởng | xem theo phạm vi | xem theo phạm vi | Toàn bộ |
| Quản lý học sinh | — | Lớp của mình | Toàn bộ |
| Quản trị (users/nhóm/phân công/lớp/chuyển năm) | — | — | ✅ |

Quy tắc: quyền được cấp nếu ít nhất một vai trò thỏa yêu cầu.

### 7.2 Quy tắc nghiệp vụ

- **Buổi sinh hoạt:** điểm danh ghi theo (lớp, Chúa Nhật của tuần, buổi); bốn loại buổi định nghĩa ở §3.3.
- **Ngữ nghĩa ghi đè:** lưu điểm danh cho một lớp/tuần/buổi thay thế trọn cụm đó; lưu giảng dạy cho một lớp/tuần thay thế trọn cụm đó.
- **Điểm:** ĐTB học kỳ = (15' + 2·HK)/3; ĐTB năm = (HK1 + 2·HK2)/3.
- **Điểm tổng hợp:** Học lực × `AcademicWeight` + Chuyên cần × (1 − `AcademicWeight`).
- **Buổi nghỉ:** loại khỏi mẫu số tỷ lệ; các bản ghi đã lưu vẫn giữ.
- **Không xóa phá hủy:** học sinh không bao giờ bị gỡ; điểm danh/điểm không bao giờ bị xóa sạch; chuyển năm chỉ thêm dữ liệu.
- **Ngoài phạm vi = 403:** thực thi ở Node, kể cả với lời gọi API trực tiếp.

---

## 8. Tiêu chí chấp nhận & kiểm thử

1. **Đăng nhập:** đăng nhập Google bằng email active có trong `Users` vào được ứng dụng; email không có → "liên hệ admin"; email `blocked` → bị từ chối.
2. **Phạm vi vai trò:** `admin,gv,gvcn` thấy phần quản trị + các lớp được phân công; `gv` thường chỉ thấy lớp được phân công và không có Quản trị; gọi API trực tiếp cho lớp/CCCD ngoài phạm vi qua curl → 403.
3. **Điểm danh:** lưu một lớp/tuần/buổi; tải lại thấy chế độ sửa đã điền sẵn; số liệu tổng kết đúng; hiện diện/có phép loại trừ lẫn nhau.
4. **Trích lục:** một CCCD trả về các dòng VẮNG/CÓ PHÉP trải nhiều năm học.
5. **Toàn đoàn:** admin xem được báo cáo; lời gọi trực tiếp của gv bị chặn.
6. **Giảng dạy:** upload giáo án → file lưu trên Drive, URL ghi vào Teaching; thẻ hiện "Đã cập nhật".
7. **Học bạ:** lưu điểm hàng loạt với tư cách gvcn của lớp thành công; lưu lớp khác thất bại; ô trống tải lại vẫn trống (không phải 0).
8. **Tổng hợp:** điểm tổng hợp khớp Học lực×60% + Chuyên cần×40%; học sinh chuyên cần thấp bị hạ thấy rõ; gv không thấy cột Xếp loại.
9. **Chuyển năm:** `startSchoolYear(2027-2028)` lên lớp đúng, copy phân công làm bản nháp, giữ nguyên dữ liệu năm cũ, năm mới trống.
10. **Phản hồi thật:** trỏ proxy tới một URL giả → giao diện hiện lỗi, không bao giờ hiện "thành công".
11. **XSS:** ghi chú chứa `<b>x</b>` sau khi lưu/tải lại hiển thị dạng văn bản thô.
12. **Múi giờ:** ngày điểm danh mặc định khớp ngày hiện tại (giờ VN) quanh thời điểm nửa đêm.
