# Sổ Thiếu Nhi — Cloudflare

Ứng dụng quản lý sinh hoạt thiếu nhi (Giáo xứ Nghĩa Hòa).

```
Trình duyệt (public/…)             trang tĩnh + ES module, không build
   │  POST /api/<action>  ·  /api/students/:id/photo  ·  /auth/…
   ▼
Cloudflare Worker (src/, Hono)      đăng nhập Google · phiên trong cookie ký · phân quyền R1–R8
   ├── D1  (schema.sql)             toàn bộ dữ liệu
   ├── KV                           bộ nhớ đệm các danh sách ít đổi
   ├── R2                           ảnh thiếu nhi (riêng tư)
   └── Google Drive REST            file giáo án (một tài khoản chủ, kết nối từ trang Quản trị)
```

Tài liệu thiết kế: `docs/superpowers/plans/2026-10-10-cloudflare-migration-unified.md`.
Trang cũ (Express + Apps Script + Google Sheet, nhánh `master`) vẫn chạy riêng để tra cứu các năm trước; `Code.gs` và `SRS.md` thuộc về trang cũ.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `src/lib/` | Mã dùng chung: mã (codes), chuẩn hoá chữ và ngày, quyền, cache, Drive |
| `src/lib/db/` | Mỗi mảng một module đọc/ghi D1: `org`, `users`, `students`, `attendance`, `academics`, `lessons` |
| `src/http/` | `actions.js` (mọi `POST /api/<action>`), `photos.js`, `auth.js`, `lists.js` |
| `src/app.js`, `src/worker.js` | Ứng dụng Hono và điểm vào của Worker (`fetch`, cron mỗi giờ) |
| `public/` | Giao diện: `lessons`, `attendance`, `academics`, `students`, `teachers`, `admin`, `login`, `shared` |
| `schema.sql` | Lược đồ D1 (chạy lại được: xoá rồi tạo) |
| `scripts/seed-demo.mjs` | Sinh dữ liệu mẫu → `seed.sql` |
| `test/` | Kiểm thử chạy bằng `node --test`, không cần Cloudflare |

## Chạy trên máy

Cần Node ≥ 22.16.

```bash
npm install
cp .dev.vars.example .dev.vars      # điền SESSION_SECRET và OAuth client
npm run seed                        # tạo seed.sql (dữ liệu mẫu, người thật duy nhất là admin)
npm run db:local                    # nạp schema + dữ liệu mẫu vào D1 cục bộ, xoá KV cục bộ
npm run dev                         # http://localhost:8787
```

Đăng nhập cần một Google OAuth client có redirect URI `http://localhost:8787/auth/callback` và email của bạn trong bảng `Users`.

## Kiểm thử

```bash
npm test          # toàn bộ: dữ liệu, quyền, HTTP, kiểm tra tĩnh các trang
npm run smoke     # khi `npm run dev` đang chạy: đi qua mọi trang và mọi nhóm thao tác trên workerd + D1 cục bộ
```

`npm run smoke` chạy cả chuyển năm học trên D1 cục bộ; chạy lại `npm run db:local` sau đó để có lại dữ liệu mẫu.

## Đưa lên Cloudflare (làm một lần)

1. `npx wrangler login`
2. Tạo tài nguyên và ghi id vào `wrangler.jsonc` (thay các số 0):
   ```bash
   npx wrangler d1 create so-thieu-nhi
   npx wrangler kv namespace create CACHE
   npx wrangler r2 bucket create so-thieu-nhi-photos
   ```
   Không đặt lifecycle rule cho bucket: ảnh không tự hết hạn.
3. Google Cloud Console → OAuth client (Web application), **tạo client secret mới** (secret cũ đã nằm trong lịch sử git):
   - Redirect URI: `https://<worker-url>/auth/callback` và `https://<worker-url>/auth/drive/callback`
   - Bật **Google Drive API**; đưa OAuth consent screen sang **In production**.
4. Secret của Worker:
   ```bash
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put OAUTH_CLIENT_ID
   npx wrangler secret put OAUTH_CLIENT_SECRET
   npx wrangler secret put OAUTH_REDIRECT_URI     # https://<worker-url>/auth/callback
   ```
5. Dữ liệu:
   ```bash
   npx wrangler d1 execute DB --remote --file=schema.sql
   npm run seed && npx wrangler d1 execute DB --remote --file=seed.sql     # dữ liệu mẫu để kiểm tra
   ```
6. `npm run deploy`
7. Đăng nhập bằng tài khoản Xứ đoàn → **Quản trị → Cấu hình**: đặt `DriveFolderId` (thư mục gốc chứa giáo án) → **Kết nối Google Drive** bằng tài khoản sở hữu thư mục đó.
8. Kiểm tra từng use case của mục 6 trong tài liệu thiết kế (danh sách kiểm tra ở cuối mỗi task của `docs/superpowers/plans/2026-10-11-plan-4-frontend.md`). Hai điểm chưa kiểm được trên máy: upload file thẳng từ trình duyệt lên Drive (Google có nhận `Origin` do Worker gửi không) và đăng nhập Google thật.
9. Thay dữ liệu mẫu bằng danh sách thật: chạy lại `schema.sql`, rồi nạp lớp, nhóm, Huynh trưởng thật (SQL), nhập Thiếu nhi bằng Excel từng lớp, bấm nút bộ nhớ đệm ở trang Quản trị.

## Vận hành

- **Nhóm và lớp** không có màn hình sửa: sửa bằng SQL trong Cloudflare console, rồi bấm nút bộ nhớ đệm (góc dưới phải trang Quản trị). Người có nhóm bị đổi cần đăng nhập lại: `UPDATE Users SET AuthVersion = AuthVersion + 1 WHERE Id = …`.
- **Lịch sử cấu hình** nằm ở bảng `ConfigHistory` (không có màn hình).
- **Khôi phục**: D1 giữ lịch sử 30 ngày (`wrangler d1 time-travel`).
- **File giáo án đã gỡ** được chuyển vào thùng rác Drive bởi cron mỗi giờ (bảng `DriveTrash` là hàng đợi).
