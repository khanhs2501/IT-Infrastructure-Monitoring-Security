# IT Infrastructure Monitoring & Security — bàn giao

Repo gồm bộ cấu hình đã thu thập/khử thông tin nhạy cảm cho Windows Server, Zabbix Agent, Wazuh Agent, Sysmon, AD/DNS/DHCP/GPO, Ubuntu Server và source RG-ITPortal.

## Các hạng mục bàn giao

| Hạng mục | Trạng thái hiện tại |
|---|---|
| Source/config được quản lý trong Git/GitHub | Có source Portal và config mẫu/export đã chọn. Không đưa credential, private key, DB hay backup runtime lên repo. |
| Môi trường Lab dựng lại | Có hướng dẫn và checklist; chưa chứng minh dựng lại xong bằng một lần chạy Lab. |
| Dashboard Monitoring + Security Alert | Có trong source Portal; kiểm thử kết nối dịch vụ thật còn cần chạy trên Lab. |
| Rule/threshold/notification | Có ma trận đề xuất và cách thiết lập. Chưa có export/evidence xác nhận cấu hình cụ thể của Zabbix/Wazuh/notification đã được nghiệm thu. |
| Test case + kết quả | Có bộ test tự động đã chạy PASS; test chấp nhận Lab còn chờ thực hiện. |
| Tài liệu thiết kế/cài đặt/vận hành/troubleshooting | Có trong `09-RG-ITPortal/docs/`. |
| Báo cáo thực tập + video demo | Có bản nháp báo cáo và kịch bản quay; cần điền thông tin cá nhân/trường, kết quả Lab và quay video thật. |

## Điểm bắt đầu

- [RG-ITPortal README](09-RG-ITPortal/README.md)
- [Architecture & Design](09-RG-ITPortal/docs/ARCHITECTURE_DESIGN.md)
- [Lab Rebuild](09-RG-ITPortal/docs/LAB_REBUILD.md)
- [Alerts & Notifications](09-RG-ITPortal/docs/ALERTS_NOTIFICATIONS.md)
- [Test Cases](09-RG-ITPortal/docs/TEST_CASES.md) · [Test Results](09-RG-ITPortal/docs/TEST_RESULTS.md)
- [Internship Report Draft](09-RG-ITPortal/docs/INTERNSHIP_REPORT_TEMPLATE.md) · [Demo Video Script](09-RG-ITPortal/docs/DEMO_VIDEO_SCRIPT.md)

## Bảo vệ thông tin

Repo GitHub là bản chia sẻ; chỉ đưa cấu hình mẫu hoặc export đã rà soát/khử bí mật. Không commit `.env`, credential, token, private key, user database, backup hoặc log. Trước khi bổ sung export server mới, kiểm tra endpoint, hostname/domain, tài khoản và secret theo README trong từng thư mục.
