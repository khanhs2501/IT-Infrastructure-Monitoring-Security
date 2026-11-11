# Bộ kiểm thử bàn giao

## Kiểm thử tự động

Chạy `npm test` trong thư mục `09-RG-ITPortal`. Các flow test dùng DB tạm trong thư mục temp và mô phỏng PowerShell/AD; không cần domain hoặc gọi AD thật.

| ID | Phạm vi | Tiêu chí đạt | Bằng chứng |
|---|---|---|---|
| T-01 | Smoke, cú pháp và file cần thiết | JS parse được; các file/features chính hiện diện; repo public không chứa `.env` hay DB runtime | `scripts/smoke-check.js` |
| T-02 | AD PowerShell JSON | JSON parse đúng khi stdout có warning, nested object/list và giá trị false | `scripts/test-ad-query.js` |
| T-03 | Thao tác hàng AD UI | Edit/lock/delete chỉ cập nhật hàng tương ứng, không tải lại cả danh sách | `scripts/test-ad-row-actions.js` |
| T-04 | HTTP flow và SQLite | Health, login/session, phân quyền và flow API sử dụng DB test tạm hoạt động | `scripts/test-flow.js` |
| T-05 | Đăng nhập | Chuẩn hóa username, cookie/session, login guard, lỗi AD, CSRF, audit, logout và expiry | `scripts/test-login.js` |
| T-06 | Cú pháp `.env` | Mẫu cấu hình hợp lệ theo parser của ứng dụng | `npm run check:env` |

## Kiểm thử chấp nhận trên Lab

| ID | Thao tác | Kết quả mong muốn | Trạng thái |
|---|---|---|---|
| A-01 | Đăng nhập bằng tài khoản AD hợp lệ | Vào dashboard đúng vai trò | Chưa chạy trên Lab |
| A-02 | Đăng nhập sai hoặc tài khoản bị khóa | Hiện phản hồi phù hợp, không làm lộ mật khẩu | Chưa chạy trên Lab |
| A-03 | Mở trang Zabbix | Hiện host/problem/event thật từ Lab hoặc báo lỗi nguồn rõ ràng | Chưa chạy trên Lab |
| A-04 | Mở trang Wazuh Security Alert | Hiện event Lab, level/agent/time đúng | Chưa chạy trên Lab |
| A-05 | Tạo alert Zabbix test | Sự kiện xuất hiện và recovery sau khi điều kiện trở lại bình thường | Chưa chạy trên Lab |
| A-06 | Tạo Wazuh event test + notification | Event xuất hiện ở Indexer/Portal; kênh nhận test nhận thông báo | Chưa chạy trên Lab |
| A-07 | Dùng tài khoản không đủ quyền vào thao tác quản trị | Bị từ chối, dữ liệu không bị đổi | Chưa chạy trên Lab |
| A-08 | Restart Portal | Service lên lại; session còn hiệu lực theo cấu hình | Chưa chạy trên Lab |
| A-09 | Tắt tạm một endpoint tích hợp | UI báo lỗi kết nối, không giả vờ dùng dữ liệu mới | Chưa chạy trên Lab |
| A-10 | Thao tác Docker/AD được cho phép | Kết quả đúng, audit có ghi nhận khi áp dụng | Chưa chạy trên Lab |

Ghi kết quả, ngày giờ, phiên bản, người thực hiện và ảnh/log đã loại bỏ credential. Xem [TEST_RESULTS.md](TEST_RESULTS.md).
