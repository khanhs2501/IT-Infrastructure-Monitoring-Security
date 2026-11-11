# Báo cáo thực tập tốt nghiệp — bản nháp kỹ thuật

> Điền các mục `[CẦN BỔ SUNG]` theo biểu mẫu của trường. Nội dung mô tả hệ thống hiện có và kết quả test đã chạy; không khẳng định các hạng mục Lab chưa kiểm chứng.

## Trang bìa

- Trường / khoa / ngành: **[CẦN BỔ SUNG]**
- Tên đề tài: **Xây dựng cổng quản trị, giám sát hạ tầng và cảnh báo an ninh CNTT**
- Sinh viên / mã số: **[CẦN BỔ SUNG]**
- Đơn vị thực tập: **[CẦN BỔ SUNG]**
- Người hướng dẫn tại trường / đơn vị: **[CẦN BỔ SUNG]**
- Thời gian thực tập: **[CẦN BỔ SUNG]**
- Địa điểm, năm: **[CẦN BỔ SUNG]**

## Tóm tắt

Đề tài xây dựng RG-ITPortal, ứng dụng nội bộ bằng Node.js/Express để tổng hợp giám sát từ Zabbix, cảnh báo an ninh từ Wazuh và một số chức năng quản trị AD/Docker. Ứng dụng dùng SQLite cho session và dữ liệu cục bộ; các hệ thống chuyên dụng vẫn là nguồn dữ liệu chính. Repo bàn giao gồm mã nguồn Portal, cấu hình mẫu đã khử bí mật, các bản export cấu hình được chọn và tài liệu thiết kế/vận hành. `npm test` chạy thành công trên Windows với AD/PowerShell giả lập; các kết nối và ngưỡng cảnh báo cần nghiệm thu thêm trên Lab. **[Bổ sung mục tiêu, thời gian, kết quả Lab thực tế sau nghiệm thu.]**

## 1. Giới thiệu

### 1.1 Bối cảnh

Hạ tầng CNTT có nhiều hệ thống giám sát riêng, gây khó khăn khi cần nhìn tổng quan sự cố, máy chủ và cảnh báo. Đề tài tạo một cổng nội bộ để gom các góc nhìn vận hành phổ biến và cung cấp một số tác vụ quản trị theo phân quyền.

### 1.2 Mục tiêu

- Tổng hợp dashboard giám sát và security alert.
- Tích hợp API/SSH/PowerShell với Zabbix, Wazuh, Active Directory và Docker.
- Có xác thực phiên, vai trò, audit và hướng dẫn triển khai.
- Quản lý mã nguồn bằng Git/GitHub và cung cấp tài liệu hỗ trợ dựng Lab.

### 1.3 Phạm vi

Portal không thay thế Zabbix/Wazuh, không tự dựng AD hay hạ tầng sản phẩm, và không bao gồm secret, database runtime hoặc backup trong repo public. Cấu hình alert/notification cần được kiểm tra ở hệ thống tương ứng.

## 2. Phân tích yêu cầu

| Yêu cầu | Giải pháp | Bằng chứng |
|---|---|---|
| Git/GitHub | Repo source và config mẫu | GitHub repository; cấu hình placeholder |
| Dựng Lab | Hướng dẫn kiến trúc và bước dựng | `LAB_REBUILD.md`; còn cần thực thi checklist |
| Dashboard + Security Alert | Views/API Zabbix và Wazuh | `public/views`, `routes/monitoring.js`, `routes/security.js` |
| Rules/thresholds/notification | Định nghĩa trên Zabbix/Wazuh | Khuyến nghị trong `ALERTS_NOTIFICATIONS.md`; cần bằng chứng cấu hình Lab |
| Test case/kết quả | Script tự động và checklist chấp nhận | `TEST_CASES.md`, `TEST_RESULTS.md` |
| Tài liệu kỹ thuật | Architecture, install/config/operation/troubleshooting | Thư mục `docs/` |
| Báo cáo/video | Bản nháp và kịch bản | Tài liệu hiện tại; thông tin cá nhân và video thật còn cần hoàn tất |

## 3. Thiết kế hệ thống

Chèn sơ đồ từ `ARCHITECTURE_DESIGN.md` hoặc xuất thành hình theo yêu cầu trường. Mô tả trình duyệt gọi Express; Express truy vấn SQLite, Zabbix JSON-RPC, Wazuh Indexer HTTPS, AD qua PowerShell/RSAT và Linux/Docker qua SSH.

## 4. Công nghệ và triển khai

- Backend: Node.js 22 LTS hoặc phiên bản tương thích, Express.
- Frontend: HTML, CSS, JavaScript, giao tiếp API nội bộ.
- Dữ liệu Portal: SQLite; session được lưu bền.
- Tích hợp: Zabbix API, Wazuh Indexer API, PowerShell/RSAT, SSH/Docker.
- Repo source: `https://github.com/khanhs2501/IT-Infrastructure-Monitoring-Security`.

Ghi phiên bản chính xác, cấu hình Lab và ảnh giao diện sau khi dựng: **[CẦN BỔ SUNG]**.

## 5. Kiểm thử và đánh giá

Kết quả tự động tại `TEST_RESULTS.md`: `npm test` PASS trên Windows/Node.js v24.22.1, gồm static/syntax, AD query/UI contract, HTTP/SQLite flow và login/security flow với AD giả lập. Không dùng domain thật. Kết quả nghiệm thu Zabbix/Wazuh, email/webhook, Docker/SSH, AD thật và browser: **[CẦN CHẠY VÀ GHI KẾT QUẢ LAB]**.

## 6. Bảo mật và giới hạn

- Credential, session secret, private key, database và log không nằm trong repo public.
- Dùng tài khoản ít quyền; bật TLS và xác minh certificate.
- Không chạy thao tác thay đổi AD/Docker trên production khi chưa có phê duyệt/quy trình backup.
- `npm ci` ghi nhận 5 cảnh báo dependency (2 moderate, 3 high); cần xem xét nâng cấp.
- Ngưỡng và notification production chưa được xác nhận qua export đầy đủ; phải ghi cấu hình thực tế tại Lab.

## 7. Kết luận và hướng phát triển

Đã hoàn thiện mô tả kiến trúc, source Portal, tài liệu dựng/config/vận hành và bộ test tự động. Các bước tiếp theo là dựng Lab, nghiệm thu kết nối và notification, xử lý cảnh báo dependency, lưu bằng chứng đã khử dữ liệu, điền thông tin trường/sinh viên và quay video demo thực tế.

## Tài liệu tham khảo

- Tài liệu chính thức của Node.js, Express, Zabbix, Wazuh và Microsoft Active Directory/PowerShell phù hợp phiên bản triển khai.
- Repo source và tài liệu nội bộ được bàn giao.

## Phụ lục cần hoàn thiện

- [ ] Mục lục và định dạng theo mẫu trường.
- [ ] Nhật ký thực tập, phân công và xác nhận người hướng dẫn.
- [ ] Sơ đồ Lab với version/IP được ẩn phù hợp.
- [ ] Ảnh dashboard, alert test, email/webhook nhận được.
- [ ] Bảng test nghiệm thu có xác nhận nếu trường yêu cầu.
