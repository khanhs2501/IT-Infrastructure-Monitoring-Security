# RG-ITPortal v1.8.2

Portal quản trị và giám sát hạ tầng ROYALGROUP: Zabbix, Wazuh, pfSense, Active Directory, Docker, tài sản, lỗ hổng, helpdesk và báo cáo.

## Chạy nhanh trên Windows

1. Giải nén toàn bộ ZIP vào `C:\RG-ITPortal` (hoặc thư mục riêng để thử trước).
2. Cần **Node.js 22 LTS x64**. ZIP đã kèm `node_modules` cho Windows x64; nếu thiếu/lỗi, `START_PORTAL.cmd` tự chạy `npm ci`.
3. Nhấp đúp **`START_PORTAL.cmd`**: kiểm tra Node, thư viện, `.env`, rồi khởi động và tự mở trình duyệt tại cổng đặt trong `.env` (`PORT`, hiện là `80` → `http://localhost`).
   - Muốn chạy kèm bộ test tự động: `START_PORTAL.cmd test`.
4. Nếu đang chạy Windows Service **RoyalGroup IT Portal**, dừng service trước (cùng cổng sẽ xung đột), hoặc đặt `PORT` khác trong `.env`.

> Portal xác thực bằng Active Directory qua PowerShell nên phải chạy trên **Windows có RSAT/ActiveDirectory module**, bằng tài khoản có quyền đọc AD.

## Cập nhật không mất dữ liệu (đang có bản 1.6.0 chạy thật)

1. Dừng service, sao lưu cả thư mục `C:\RG-ITPortal`.
2. Chép đè ZIP mới **nhưng giữ lại** `.env` và `itportal.db` đang chạy thật (ZIP chứa bản snapshot cũ của hai file này).
3. Thêm khối "Đăng nhập & phiên" từ `.env.example` vào `.env` (tùy chọn, đã có mặc định an toàn).
4. Khởi động lại. Người dùng đăng nhập lại một lần; từ đó phiên được giữ qua mọi lần restart.

## Cài thành Windows Service

```powershell
node install-service.js     # cài + chạy (đường dẫn theo thư mục hiện tại)
node uninstall-service.js   # gỡ (giữ nguyên dữ liệu)
```

## Đăng nhập lỗi?

```powershell
npm run diagnose:login -- Administrator
```
Xem `docs/LOGIN_TROUBLESHOOTING.md` (bảng thông báo → nguyên nhân → cách xử lý).

## Dữ liệu kèm theo

- `.env`: cấu hình thật (Zabbix, Wazuh, SSH, session secret) + các khóa mới của v1.7.0.
- `itportal.db`: snapshot SQLite đã gộp WAL (không còn `-wal`/`-shm` riêng).

**Bảo mật:** ZIP chứa thông tin xác thực thật và dữ liệu vận hành. Không đưa lên kho công khai; nếu đã chia sẻ ra ngoài, hãy xoay vòng mật khẩu/token. `INDEXER_TLS_REJECT_UNAUTHORIZED=false` chỉ hợp lý cho lab dùng chứng chỉ tự ký.

## Kiểm tra

```powershell
npm test            # smoke + AD contract + flow + login (không cần domain thật)
npm run check:env   # kiểm tra cú pháp .env
node check.js       # kết nối thật tới Zabbix/Wazuh/SSH/AD theo .env
```

## Cấu trúc

- `server.js`: Express, session (SQLite), SQLite WAL, health, tắt an toàn, xử lý lỗi toàn cục.
- `routes/`: API (AD, tài sản, Docker, helpdesk, monitoring, reports, security…); `ad-auth.js`, `auth.js`, `login-guard.js`, `session-store.js` lo đăng nhập/phiên.
- `public/`: giao diện; `js/auth.js` xử lý đăng nhập và phiên hết hạn.
- `scripts/`: kiểm thử, `diagnose-login.js`, `check-env.js`.
- `docs/`: `CONFIGURATION.md`, `LOGIN_TROUBLESHOOTING.md`, `SECURITY_OPERATIONS.md`, `CHANGELOG_v1.7.0.md`, `CHANGELOG_v1.8.0.md`.
