# Cấu hình RG-ITPortal v1.8.2

Ứng dụng đọc `.env` cạnh `server.js`; DB mặc định cũng được tạo cạnh `server.js` với đường dẫn tuyệt đối. `.env.example` trong repo chỉ là mẫu đã khử thông tin thật, không chứa endpoint/credential production.

## Cài đặt cấu hình

1. Copy `.env.example` thành `.env` trên máy Lab.
2. Thay toàn bộ giá trị `example.invalid`, `YOUR_*`, `WINDOWS_HOSTNAME`, `LINUX_HOSTNAME` và `EXAMPLE-DC` bằng dữ liệu Lab.
3. Sinh `SESSION_SECRET` ngẫu nhiên ít nhất 32 ký tự. Không dùng lại secret trên server khác.
4. Chọn `PORT` trống. Dùng cổng lớn hơn 1024 cho thử nghiệm không cần quyền quản trị.
5. Đặt tài khoản API chỉ đọc cho monitoring khi có thể. Tạo tài khoản SSH riêng cho Lab với đúng quyền tính năng cần dùng.
6. Dùng TLS và xác minh certificate trong môi trường dùng thật. `INDEXER_TLS_REJECT_UNAUTHORIZED=false` chỉ phục vụ Lab có certificate tự ký và cần ghi nhận rủi ro.
7. Giới hạn ACL mạng; không mở endpoint quản trị ra Internet.

## Biến chính

| Biến | Yêu cầu / mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `80` trong mẫu; nên đổi sang cổng Lab trống | Cổng HTTP của Portal |
| `TRUST_PROXY` | `false` | Chỉ cấu hình khi xác định rõ proxy tin cậy |
| `COOKIE_SECURE` | `false` | Đặt `true` nếu browser luôn truy cập HTTPS; `false` cho HTTP Lab |
| `DB_PATH` | trống | Trống dùng file DB cạnh `server.js`; có thể đặt đường dẫn tuyệt đối |
| `AUDIT_RETENTION_DAYS` | `180` | Số ngày giữ audit (1–3650) |
| `SESSION_SECRET` | bắt buộc, 32+ ký tự | Bí mật ký session cookie |
| `ZABBIX_URL`, `ZABBIX_TOKEN` | endpoint/token Lab | Truy vấn API Zabbix |
| `ZABBIX_HOST_WIN`, `ZABBIX_HOST_LINUX`, `ASSET_ZABBIX_HOSTS` | tên host trong Zabbix Lab | Ánh xạ máy trong Portal |
| `INDEXER_URL`, `INDEXER_USER`, `INDEXER_PASS` | endpoint/user/password Lab | Truy vấn Wazuh Indexer |
| `INDEXER_TLS_REJECT_UNAUTHORIZED` | `true` khi xác minh certificate | Bật xác minh TLS |
| `LINUX_SSH_HOST`, `LINUX_SSH_USER`, `LINUX_SSH_PASS` | máy/tài khoản Lab | Tích hợp SSH/Docker |
| `PFSENSE_SSH_*` | Lab firewall, nếu dùng | Tích hợp pfSense |
| `DEPT_PARENT_OU`, `DEPT_EXCLUDE_OU`, `COMPUTER_MANAGED_OUS`, `COMPUTER_PROTECTED_NAMES` | Tên OU/máy tính trong AD Lab; nhập tên OU, không dùng DN | Phạm vi thao tác máy tính và OU |
| `SESSION_HOURS` | `12` | Thời gian session (1–168 giờ) |
| `LOGIN_MAX_ATTEMPTS` | `8` | Sai mật khẩu liên tiếp trên mỗi tài khoản trước khi chặn; đặt dưới chính sách khóa AD |
| `LOGIN_WINDOW_MINUTES` | `10` | Cửa sổ tính số lần sai |
| `LOGIN_IP_MAX_ATTEMPTS` | `120` | Giới hạn tổng theo IP |
| `LOGIN_VERBOSE_ERRORS` | `true` | Có giải thích lý do từ chối AD hay thông báo chung |
| `SUPER_ADMIN_GROUPS`, `IT_STAFF_GROUPS` | tên nhóm Lab | Ánh xạ nhóm AD sang vai trò |
| `ALLOWED_ORIGINS` | trống | Origin bổ sung cho API ghi; chỉ thêm khi cần |

Các biến cloud/Kubernetes là tùy chọn; để trống nếu không dùng. Không dán nội dung `.env` vào issue, chat hoặc GitHub.

## Cấu hình phiên và quyền

Session được lưu trong SQLite để còn tồn tại sau khi restart. Vai trò lấy từ nhóm AD ở thời điểm đăng nhập; người dùng cần đăng nhập lại sau khi thay đổi nhóm. Cookie `HttpOnly`/`SameSite=Lax`, API ghi kiểm tra Origin. Tài khoản chạy portal phải có quyền AD/SSH tối thiểu theo công việc.

Xem thêm [LOGIN_TROUBLESHOOTING.md](LOGIN_TROUBLESHOOTING.md), [AD_COMPUTER_MANAGEMENT.md](AD_COMPUTER_MANAGEMENT.md) và [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md).
