# Bảo mật và vận hành

## Trước khi triển khai

- Chỉ dùng HTTPS cho môi trường sản xuất; bật `COOKIE_SECURE=true` khi TLS đã hoạt động. Nếu chạy HTTP lab, để `false`.
- Chỉ cấu hình `TRUST_PROXY` khi biết rõ proxy phía trước Portal và giới hạn chính xác số hop/địa chỉ tin cậy.
- Giữ `.env`, `itportal.db`, log và backup ngoài kho mã nguồn công khai. Gói phục hồi v1.6.0 chứa `.env` thật và DB người dùng theo yêu cầu, vì vậy cần được xem là dữ liệu bí mật.
- Đổi/thu hồi các mật khẩu, token, session secret nếu ZIP hoặc log đã bị chia sẻ ngoài phạm vi tin cậy.
- Với Wazuh TLS, ưu tiên tin cậy certificate của Indexer thay vì tắt xác minh TLS.
- Tài khoản chạy Node/Windows Service cần chỉ có quyền tối thiểu phù hợp; tránh cấp Domain Admin nếu không bắt buộc.

## SQLite

Database sử dụng đường dẫn tuyệt đối, WAL, busy timeout, index và dọn audit theo `AUDIT_RETENTION_DAYS`. Sao lưu bằng SQLite backup API hoặc dừng Portal sạch trước khi copy DB. Không tự copy `.db` trong lúc service đang ghi và chỉ lấy file chính mà bỏ WAL.

## Kiểm thử và health

- `npm test`: kiểm thử mã nguồn, hợp đồng API, thao tác tại chỗ và flow HTTP/SQLite.
- `GET /api/health`: kiểm tra truy vấn SQLite thực tế.
- `node check.js`: kiểm tra kết nối với dịch vụ bên ngoài; chỉ chạy khi đã xác minh các địa chỉ/credentials đang dùng.

## Sự cố khởi động

- `EADDRINUSE`: dừng instance/service cũ hoặc đổi `PORT`.
- Không tải được SQLite: cài Node.js x64 tương thích và chạy `npm install` trong thư mục dự án. `node_modules` là phụ thuộc theo nền tảng; không sao chép từ Linux sang Windows hoặc ngược lại.
- Lỗi Active Directory/PowerShell: kiểm tra Windows PowerShell, RSAT ActiveDirectory, kết nối domain và quyền tài khoản chạy Portal.

## Đăng nhập, phiên và CSRF (v1.7.0)

- Mật khẩu chỉ đi vào PowerShell dưới dạng base64; tên đăng nhập chỉ nhận ký tự an toàn (`tên`, `DOMAIN\tên`, `tên@domain`).
- Chống dò mật khẩu theo từng tài khoản + trần theo IP; lỗi hạ tầng AD (503) không bị tính là sai mật khẩu. Mỗi lần AD từ chối vẫn cộng vào bộ đếm khóa của **domain** — giữ `LOGIN_MAX_ATTEMPTS` nhỏ hơn ngưỡng khóa.
- Phiên lưu trong bảng `sessions` của SQLite (hết hạn tự dọn mỗi 15 phút). Thu hồi khẩn cấp: dừng service rồi `DELETE FROM sessions;` hoặc đổi `SESSION_SECRET`.
- Thao tác ghi (`POST/PUT/DELETE`) kiểm tra `Origin` trùng `Host`; cookie `HttpOnly`, `SameSite=Lax`.
- `/views/*` chỉ phục vụ sau khi đăng nhập. Vai trò được tính lúc đăng nhập (đổi nhóm AD có hiệu lực ở lần đăng nhập sau).
- Nhật ký (menu *Nhật Ký Hoạt Động*) ghi đường dẫn API đầy đủ và tên tài khoản đã thử khi đăng nhập thất bại.

