# Cảnh báo, ngưỡng và thông báo

## Tình trạng được xác nhận từ repo

- Portal có trang Zabbix lấy trạng thái host/problem/event và thông tin alert qua API (`routes/monitoring.js`).
- Portal có khu vực Security Alert truy vấn Wazuh alerts (`routes/security.js`, `public/views/wazuh.html`). UI phân mức Wazuh: level từ 15 là Critical, từ 12 là High, thấp hơn là thông tin/medium.
- Các export cấu hình agent/server không phải export đầy đủ cấu hình Zabbix frontend, trigger/prototype, action, media type hoặc Wazuh ruleset. Do đó không thể xác nhận bằng Git rằng tất cả ngưỡng và kênh thông báo production đã được cấu hình.
- Các mức dưới đây là **đề xuất để thiết lập/kiểm tra trong Lab**, không phải khai báo đã cài trên hệ thống thật.

## Ma trận đề xuất

| Nguồn | Điều kiện đề xuất | Mức | Đối tượng nhận |
|---|---|---|---|
| Zabbix | Host critical không phản hồi liên tục 5 phút | High | IT trực ca |
| Zabbix | CPU > 90% liên tục 10 phút | Warning | IT vận hành |
| Zabbix | RAM available < 10% liên tục 10 phút | Warning | IT vận hành |
| Zabbix | Dung lượng trống volume hệ thống < 15% hoặc < 10 GB | High | IT vận hành |
| Zabbix | Agent không hoạt động liên tục 5 phút | Warning | IT vận hành |
| Wazuh | Rule level 15 trở lên | Critical | Security/IT trực ca, xử lý ngay |
| Wazuh | Rule level 12–14 | High | Security/IT, xử lý trong ca |
| Wazuh | Rule level 7–11 | Medium | Hàng đợi triage |
| Wazuh | Rule level 0–6 | Low/Info | Dashboard, chỉ gửi nếu rule cụ thể yêu cầu |

Các ngưỡng CPU/RAM/disk cần hiệu chỉnh sau khi quan sát baseline. Tránh thông báo từng mẫu dữ liệu; dùng thời gian duy trì, recovery event, dependency và suppression/maintenance window để giảm cảnh báo trùng.

## Thiết lập trong Zabbix Lab

1. Tạo/kiểm tra host groups và host inventory; gắn template chính thức tương thích agent/server.
2. Tạo trigger theo các điều kiện trong ma trận. Ghi lại expression, severity, recovery expression và thời gian duy trì trong biên bản Lab.
3. Tạo user group và user media (email/webhook) cho người nhận Lab. Lưu credential/channel secret trong giao diện quản trị hoặc secret store; không commit chúng.
4. Tạo action theo severity/host group; định nghĩa operation, escalation interval, recovery operation và acknowledgment.
5. Dùng test media/action của Zabbix và tạo một sự kiện thử có thể phục hồi an toàn. Ghi nhận timestamp, event ID và người nhận.
6. Xác minh Portal hiển thị đúng event/alert đã tạo.

## Thiết lập trong Wazuh Lab

1. Xác nhận agent đã đăng ký, đồng bộ thời gian và gửi event.
2. Xác nhận rule ID, level, description và decoder của event thử. Không sửa rule mặc định trực tiếp nếu có thể; tạo local rule với ID riêng theo tài liệu Wazuh.
3. Chọn rule cụ thể cần thông báo, thiết lập integration/notification channel trên Wazuh Manager theo phiên bản đã cài. Chỉ cho gửi event cần thiết tới endpoint được phê duyệt.
4. Tạo một alert thử an toàn, xác nhận event xuất hiện trong Indexer và Portal, rồi kiểm tra notification nhận được.
5. Kiểm tra hành vi khi Indexer không truy cập được: Portal cần báo lỗi nguồn, không hiển thị dữ liệu cũ như dữ liệu mới.

## Phiếu ghi nhận cấu hình triển khai

Điền khi chạy Lab; không điền secret hoặc địa chỉ cá nhân trong bản public:

| Trường | Giá trị Lab |
|---|---|
| Zabbix version / action name | `<điền>` |
| Trigger và expression | `<điền>` |
| Severity / recovery | `<điền>` |
| Wazuh version / rule ID / level | `<điền>` |
| Notification channel (loại) | `<email/webhook khác>` |
| Test time / event ID | `<điền>` |
| Kết quả nhận được | `<pass/fail + bằng chứng>` |

**Trạng thái bàn giao:** mã Portal hiển thị alert đã có trong source. Cấu hình ngưỡng và kênh notification cụ thể cần được tạo/kiểm chứng trên Zabbix/Wazuh Lab; repo hiện chưa có bằng chứng để tuyên bố phần này hoàn tất.
