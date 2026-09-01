# Sổ Thiếu Nhi — Node.js + Google Apps Script

Ứng dụng quản lý sinh hoạt thiếu nhi (Giáo xứ Nghĩa Hòa). Kiến trúc:

```
Browser (public/index.html)
   │  fetch() POST JSON — chỉ qua Node
   ▼
Node.js + Express  ←  OAuth login · session · PHÂN QUYỀN (403 ngay cả khi gọi thẳng API)
   │
   ▼
Google Apps Script (Code.gs)  ←  dịch vụ lưu trữ, kiểm tra SHARED_TOKEN
   ▼
Google Sheets (12 tab) + Google Drive (file giáo án)
```

Nguồn chuẩn: `SRS.md` + `GOOGLE-SHEET-DESIGN.md`. Không build toolchain, Node ≥ 18 (global fetch), không thư viện Google.

## 1. Tạo Google Cloud OAuth client

1. Vào [console.cloud.google.com](https://console.cloud.google.com) → tạo project.
2. **APIs & Services → OAuth consent screen** → cấu hình (External, thêm test users).
3. **Credentials → Create Credentials → OAuth client ID → Web application**:
   - Authorized redirect URIs: `http://localhost:3000/auth/callback` (thêm cả URL máy chủ thật nếu deploy).
   - Lưu **Client ID** và **Client Secret**.
4. Scopes ứng dụng dùng: `openid email profile` (chỉ lấy email + tên).

## 2. Deploy Apps Script (Code.gs)

1. Mở [script.google.com](https://script.google.com) → New project → dán toàn bộ `Code.gs`.
2. **Project Settings → Script properties**, thêm:
   - `SPREADSHEET_ID` — id của Google Sheet dữ liệu (12 tab theo GOOGLE-SHEET-DESIGN).
   - `SHARED_TOKEN` — chuỗi bí mật bất kỳ (khớp với biến môi trường `SHARED_TOKEN` bên Node).
3. **Deploy → New deployment → Web app**:
   - **Execute as: `Me`** (KHÔNG dùng "User accessing" — Node gọi bằng danh tính chia sẻ).
   - **Who has access: `Anyone with link`**.
   - Copy URL web app → đây là `APPS_SCRIPT_URL`.
4. Trong tab `Config` của Sheet: khóa `CurrentSchoolYear` (vd `2026-2027`) và `DriveFolderId` (id thư mục Drive chứa file giáo án — tạo trước, cấp quyền cho tài khoản đã "Execute as").

> **SHARED_TOKEN dùng để làm gì?** Web app "Anyone with link" là URL công khai — ai biết URL đều POST tới được và Apps Script chạy với quyền của chủ sở hữu (đọc/ghi toàn bộ Sheet, có PII học sinh). `doPost` từ chối mọi request thiếu đúng token. Chỉ Node giữ token trong env; Apps Script giữ bản sao trong script property. → Khoảng 3 dòng code ngăn người ngoài đọc/ghi Sheet khi biết URL.

## 3. Chạy Node

```bash
npm install
```

Biến môi trường (mặc định dev đủ để chạy local trước khi có Google):

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng (mặc định `3000`) |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | OAuth client §1 |
| `OAUTH_REDIRECT_URI` | `http://localhost:3000/auth/callback` |
| `SESSION_SECRET` | Chuỗi bí mật ký session (mặc định: sinh ngẫu nhiên mỗi lần khởi động — sẽ mất session khi restart) |
| `SESSION_SECURE` | `1` nếu chạy qua HTTPS |
| `APPS_SCRIPT_URL` | URL web app §2.3 |
| `SHARED_TOKEN` | Khớp với script property §2.2 |
| `DRIVE_FOLDER_ID` | (không bắt buộc nếu Config tab đã có `DriveFolderId`) |

Ví dụ (Windows PowerShell):

```powershell
$env:OAUTH_CLIENT_ID="..."; $env:OAUTH_CLIENT_SECRET="..."; $env:APPS_SCRIPT_URL="..."; $env:SHARED_TOKEN="..."
node server.js
```

Mở `http://localhost:3000`, đăng nhập bằng Google (email phải có trong tab `Users` và được thêm vào nhóm trong `GroupMembers`).

## 4. Kiểm tra

```bash
node server.js --selfcheck   # assert scope/tier/điểm + đủ endpoint
node --check server.js       # syntax
```

## 5. Phân quyền tóm tắt

- **Lớp** — điểm danh/điểm/giáo án trong đúng lớp của mình.
- **Ngành** — như Lớp, mở rộng sang các lớp trong `Groups.Scope`.
- **Quản trị ngành** — thêm điểm danh/thống kê giáo viên trong ngành; thống kê toàn đoàn.
- **Quản trị** — toàn bộ (users, groups, lớp, holidays, config, năm học).

`Groups.Type` lưu tiếng Việt: `Lớp / Ngành / Quản trị ngành / Quản trị`. Mọi write đều bị chặn nếu `className` ngoài phạm vi (403), kể cả gọi thẳng API.

## 6. Cấu trúc giao diện (feature modules)

Front-end là multi-page (không build step, Express serve tĩnh). Mỗi tính năng là một thư mục riêng `index.html` + `*.js`; mã dùng chung nằm trong `public/shared/`.

```
public/
├── index.html            ← launcher (`/`): các thẻ liên kết vào từng trang
├── login/                ← `/login/`: đăng nhập Google, xử lý `?login=denied|error`
├── giangday/             ← `/giangday/`: giáo án giảng dạy
├── diemdanh/             ← `/diemdanh/`: chuyên cần · trích lục · thống kê
├── hocba/                ← `/hocba/`: học bạ
├── hocsinh/              ← `/hocsinh/`: quản lý học sinh
├── giaovien/             ← `/giaovien/`: điểm danh & thống kê giáo viên
├── admin/                ← `/admin/`: quản trị (users, nhóm, phân công, lớp, nghỉ lễ, quyền, chuyển năm)
└── shared/
    ├── common.js         ← session guard, shell (header/năm/toast), api, helpers
    ├── ui.js             ← render dùng chung (badge, công thức điểm, trích lục)
    └── style.css         ← style nền dùng chung
```

Mỗi trang gọi `initCommon()` (trong `shared/common.js`) để chặn chưa đăng nhập / sai quyền, rồi nạp dữ liệu của riêng nó. Trang tạm thời không dùng đến chỉ để lại backup ở `index.spa.bak.html` (bản SPA gốc).
