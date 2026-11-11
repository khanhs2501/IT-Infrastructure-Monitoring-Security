# RG-ITPortal v1.7.0 — Sửa đăng nhập Administrator & rà soát toàn diện

## Nguyên nhân đăng nhập Administrator "hay bị lỗi" (rút ra từ `audit_log` thật trong `itportal.db`)

| # | Bằng chứng | Nguyên nhân | Cách sửa |
|---|---|---|---|
| 1 | 205/210 lượt đăng nhập đến từ **cùng một IP** `<PRIVATE_IP>` | Giới hạn đăng nhập theo **IP** → một người gõ sai là **cả công ty (kể cả Administrator) bị 429** trong 15 phút | Giới hạn theo **tài khoản + IP** (`routes/login-guard.js`), chỉ đếm lần sai mật khẩu AD đã xác nhận |
| 2 | Các cụm 10 lần đăng nhập thành công/phút rồi 429 (it02 07/10, duykhanh 09/10) | Mỗi lần đăng nhập chạy PowerShell vài giây; request **đang chạy** bị tính vào hạn mức → bấm/F5 nhiều lần tự khóa mình | Nút đăng nhập bị khóa khi đang xử lý; cùng tài khoản + mật khẩu chỉ hỏi AD **một lần**; request đang chạy không bị đếm |
| 3 | Administrator đăng nhập lại liên tục (5 lần/2 giây ngày 24/10, cụm lúc deploy) | Session lưu trong **RAM** (`MemoryStore`, có cảnh báo trong `err.log`) → mỗi lần service restart/deploy mất hết phiên | Session lưu trong **SQLite** (`routes/session-store.js`), sống sót qua restart |
| 4 | `uncaughtException` tiềm ẩn từ `db.run` không callback, migration `assets` không bắt lỗi | Lỗi SQLite lẻ có thể làm **sập cả Node** → service tự restart (tối đa 3 lần/phút rồi dừng hẳn) | Bắt lỗi toàn cục, sửa `perm.js`, `assets.js`; `install-service.js` nới `maxRestarts` |
| 5 | Chỉ nhập được `Administrator`; `it02@royal.local` bị từ chối | Chỉ chấp nhận tên thuần | Nhận `tên`, `DOMAIN\tên`, `tên@domain` |
| 6 | AD từ chối nhưng người dùng không biết vì sao | Không phân biệt sai mật khẩu / **tài khoản bị khóa do nhập sai** / vô hiệu hóa / hết hạn | Báo đúng lý do; lỗi PowerShell/AD báo riêng (503), **không** tính là sai mật khẩu |
| 7 | `NODE_ENV=production` do service đặt (rủi ro tiềm ẩn; `.env` hiện tại đã đặt `COOKIE_SECURE=false` nên chưa phải nguyên nhân thực tế) | Nếu `COOKIE_SECURE` bị xóa/để trống, cookie bị gắn `Secure` → HTTP không giữ được phiên | Mặc định `auto`: chỉ `Secure` khi thật sự là HTTPS |
| 8 | `npm test` của 1.6.0 **crash** (`SQLITE_MISUSE`) khi chạy thử trong môi trường kiểm tra | `START_PORTAL.cmd` bắt buộc chạy test trước khi start → nếu test lỗi thì Portal **không khởi động** | Sửa race khởi tạo; test không còn chạy mặc định khi start (`START_PORTAL.cmd test` nếu muốn) |

## Thay đổi chính

**Đăng nhập / phiên**
- `routes/ad-auth.js` (mới): xác thực AD dùng chung; chuẩn hóa tên; tra lý do từ chối; dự phòng nhóm qua `MemberOf`; tối đa 3 PowerShell song song; timeout 45 s; thử lại 1 lần khi lỗi thoáng qua.
- `routes/login-guard.js` (mới), `routes/session-store.js` (mới), `routes/auth.js` (viết lại).
- Giao diện đăng nhập: báo lỗi ngay trên form, spinner, hiện/ẩn mật khẩu, nhớ tên đăng nhập, xử lý mất kết nối/hết thời gian, **tự về màn hình đăng nhập khi phiên hết hạn** (`public/js/auth.js`).
- `/api/auth/me` không còn bị treo khi AD chậm (tối đa 5 s).

**Bảo mật & vận hành**
- Chặn ghi chéo nguồn (CSRF): thao tác ghi phải cùng `Origin` (có `ALLOWED_ORIGINS` nếu cần).
- `/views/*` chỉ phục vụ sau khi đăng nhập; HTML luôn `no-cache` (trước đây `index.html` bị giữ 1 giờ → chạy JS cũ sau nâng cấp).
- Audit log ghi **đường dẫn đầy đủ** (`/api/ad/computers/...`) và **tên tài khoản đã thử** khi đăng nhập thất bại.
- Xử lý `unhandledRejection`/`uncaughtException`/`db error` bằng log thay vì chết dịch vụ; `wal_checkpoint` khi khởi động; dừng sạch session store.
- `install-service.js` theo thư mục hiện tại + `uninstall-service.js`; `START_PORTAL.cmd` đọc cổng từ `.env`, tự mở trình duyệt, cảnh báo trùng cổng với service.

**Công cụ**
- `npm run diagnose:login -- Administrator` (`scripts/diagnose-login.js`): kiểm tra AD, chính sách khóa tài khoản, trạng thái khóa/hết hạn, lịch sử đăng nhập, thử mật khẩu (nhập ẩn).
- `scripts/test-login.js`: 13 nhóm kiểm thử đăng nhập đầu-cuối (HTTP thật, AD giả lập), gồm cả "restart server mà phiên vẫn còn".
- `check-env.js` kiểm tra thêm cấu hình đăng nhập/phiên.

## Biến `.env` mới (đều tùy chọn, đã thêm sẵn vào `.env` với giá trị mặc định)
`SESSION_HOURS`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES`, `LOGIN_IP_MAX_ATTEMPTS`, `LOGIN_VERBOSE_ERRORS`, `SUPER_ADMIN_GROUPS`, `IT_STAFF_GROUPS`, `ALLOWED_ORIGINS`; `COOKIE_SECURE` nhận thêm `auto`.

## Nâng cấp từ 1.6.0
1. Dừng service **RoyalGroup IT Portal**, sao lưu `C:\RG-ITPortal` (đặc biệt `.env`, `itportal.db`).
2. Chép đè source (xem README: *Cập nhật không mất dữ liệu*), giữ `.env` và `itportal.db` đang chạy thật.
3. Thêm các khóa mới vào `.env` (hoặc dùng bản kèm theo).
4. Muốn áp dụng `maxRestarts` mới của service: `node uninstall-service.js` rồi `node install-service.js`.
5. Khởi động lại; tất cả người dùng đăng nhập lại **một lần** (phiên cũ nằm trong RAM nên không chuyển sang được), từ đó phiên được giữ qua mọi lần restart.

## Giới hạn đã biết (cần xác minh trên môi trường thật)
- Phần PowerShell/AD chỉ được kiểm tra **cú pháp** và logic phía Node (AD giả lập); chưa chạy trên domain thật. Dùng `npm run diagnose:login` để xác nhận.
- Vai trò được tính khi đăng nhập: đổi nhóm trong AD chỉ có hiệu lực ở lần đăng nhập sau (hoặc rút `SESSION_HOURS`).
- Nhóm lồng nhau (nested) không được tính vào vai trò — giữ nguyên hành vi cũ, chỉ nhóm trực tiếp.

