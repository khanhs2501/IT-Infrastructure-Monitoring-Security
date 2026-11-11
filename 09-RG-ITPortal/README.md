# RG-ITPortal v1.8.2

Portal quản trị và giám sát hạ tầng ROYALGROUP, tích hợp Zabbix, Wazuh, pfSense, Active Directory, Docker, tài sản, lỗ hổng, helpdesk và báo cáo.

## Tài liệu bàn giao

- [Kiến trúc & thiết kế](docs/ARCHITECTURE_DESIGN.md)
- [Dựng Lab](docs/LAB_REBUILD.md)
- [Cảnh báo & thông báo](docs/ALERTS_NOTIFICATIONS.md)
- [Bộ test](docs/TEST_CASES.md) và [kết quả chạy](docs/TEST_RESULTS.md)
- [Vận hành và bảo mật](docs/SECURITY_OPERATIONS.md)
- [Cấu hình](docs/CONFIGURATION.md), [xử lý lỗi đăng nhập](docs/LOGIN_TROUBLESHOOTING.md), [quản lý máy tính AD](docs/AD_COMPUTER_MANAGEMENT.md)
- [Khung báo cáo thực tập](docs/INTERNSHIP_REPORT_TEMPLATE.md) và [kịch bản video demo](docs/DEMO_VIDEO_SCRIPT.md)

## Chạy thử trên Windows

1. Cài Node.js 22 LTS x64 và Windows PowerShell. Cần RSAT/ActiveDirectory cho các chức năng AD.
2. Sao chép thư mục portal ra một máy Lab Windows; không dùng cấu hình thật từ máy sản xuất.
3. Trong thư mục dự án, chạy `npm ci`.
4. Sao chép `.env.example` thành `.env`, điền endpoint và thông tin xác thực dành riêng cho Lab. Tạo một `SESSION_SECRET` ngẫu nhiên dài ít nhất 32 ký tự.
5. Chọn cổng chưa sử dụng bằng `PORT`; nếu thử cục bộ, nên chọn cổng lớn hơn 1024.
6. Chạy `npm start`, sau đó mở `http://localhost:<PORT>`.

Các tích hợp ngoài Portal cần cài và cấu hình riêng. Portal không tự dựng Active Directory, Zabbix, Wazuh, pfSense hoặc Docker. Xem [LAB_REBUILD.md](docs/LAB_REBUILD.md) để biết giới hạn và thứ tự dựng.

## Kiểm tra

```powershell
npm test
npm run check:env
```

`node check.js` kết nối tới dịch vụ ngoài theo `.env`; chỉ dùng sau khi xác minh host và tài khoản Lab. Không chạy lệnh này với thông tin production khi chỉ muốn kiểm tra mã nguồn.

## Kho mã nguồn và dữ liệu nhạy cảm

Repo GitHub chứa mã nguồn và cấu hình mẫu đã thay endpoint/credential bằng placeholder. Không đưa `.env`, `itportal.db`, bản sao lưu, log, token, private key, `node_modules` hoặc dữ liệu người dùng vào Git. `.env.example` là mẫu; thay bằng thông tin Lab của bạn trên máy triển khai.

## Cấu trúc chính

- `server.js`: Express, xác thực phiên, SQLite, health endpoint và khởi động dịch vụ.
- `routes/`: API theo từng miền chức năng.
- `public/`: giao diện dashboard và các trang giám sát/quản trị.
- `scripts/`: kiểm tra cấu hình, chẩn đoán và kiểm thử tự động.
- `docs/`: tài liệu thiết kế, dựng Lab, cấu hình, vận hành, kiểm thử và bàn giao.
