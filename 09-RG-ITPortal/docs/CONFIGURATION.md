# Cấu hình RG-ITPortal v1.8.2

Ứng dụng đọc `.env` tại cùng thư mục với `server.js`; đường dẫn DB mặc định là `itportal.db` trong thư mục này, bất kể working directory của Windows Service.

| Biến | Mặc định trong gói | Ý nghĩa |
|---|---|---|
| `PORT` | `80` (cấu hình thật hiện có) | Cổng HTTP; dùng `80` chỉ khi không có dịch vụ khác chiếm cổng và quyền bind phù hợp. |
| `TRUST_PROXY` | `false` | Chỉ bật khi đi qua reverse proxy tin cậy; đặt giá trị hẹp, không bật mù quáng. |
| `COOKIE_SECURE` | `false` | `false` cho HTTP; `true` chỉ khi **luôn** truy cập bằng HTTPS; `auto`/trống = chỉ gắn `Secure` khi kết nối là HTTPS. Đặt `true` trong khi dùng `http://` sẽ làm đăng nhập xong bị đá ra. |
| `DB_PATH` | trống | Trống sẽ tự dùng đường dẫn tuyệt đối cạnh `server.js`; có thể đặt đường dẫn tuyệt đối riêng. |
| `AUDIT_RETENTION_DAYS` | `180` | Thời gian giữ audit (1–3650 ngày). |
| `SESSION_SECRET` | đã được cung cấp trong `.env` riêng | Chuỗi ngẫu nhiên ít nhất 32 ký tự; không gửi giá trị này cho người khác. |
| `ZABBIX_*` | giữ nguyên cấu hình thật hiện có | URL/token/host cho tích hợp Zabbix. |
| `INDEXER_*`, `WAZUH_SCOPE_AGENTS` | giữ nguyên cấu hình thật hiện có | Kết nối Wazuh Indexer. Xác minh TLS trong production. |
| `LINUX_SSH_*`, `DOCKER_PROTECTED` | giữ nguyên cấu hình thật hiện có | SSH tới Linux/Docker. |
| `PFSENSE_SSH_*` | giữ nguyên cấu hình thật hiện có | SSH tới pfSense. |
| `DEPT_PARENT_OU`, `DEPT_EXCLUDE_OU`, `COMPUTER_MANAGED_OUS`, `COMPUTER_PROTECTED_NAMES` | giữ nguyên cấu hình hiện có | Cấu hình quản lý Active Directory. |

`.env.example` là mẫu không chứa bí mật. Không thay `.env` đang dùng bằng `.env.example`, vì việc đó sẽ làm mất thông tin kết nối hiện hành.

## Đăng nhập & phiên (v1.7.0, tất cả tùy chọn)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `SESSION_HOURS` | `12` | Thời gian sống của phiên (1–168 giờ), gia hạn theo hoạt động. Phiên lưu trong SQLite, không mất khi restart. |
| `LOGIN_MAX_ATTEMPTS` | `8` | Số lần **sai mật khẩu** (AD xác nhận) cho phép của một tài khoản trong `LOGIN_WINDOW_MINUTES`. Đặt **nhỏ hơn** ngưỡng khóa tài khoản của domain. |
| `LOGIN_WINDOW_MINUTES` | `10` | Cửa sổ đếm và thời gian tạm chặn tài khoản vượt ngưỡng. |
| `LOGIN_IP_MAX_ATTEMPTS` | `120` | Trần chung cho một IP (cao vì nhiều máy dùng chung NAT). |
| `LOGIN_VERBOSE_ERRORS` | `true` | `true`: báo rõ tài khoản bị khóa/vô hiệu/hết hạn; `false`: luôn báo chung. |
| `SUPER_ADMIN_GROUPS` | `Domain Admins` | Nhóm AD → vai trò Super-Admin (khớp tuyệt đối tên nhóm, phân tách bằng dấu phẩy). |
| `IT_STAFF_GROUPS` | `IT-Helpdesk` | Nhóm AD → vai trò IT-Staff. |
| `ALLOWED_ORIGINS` | trống | Origin bổ sung được phép gọi API ghi (mặc định chỉ cùng host). |
