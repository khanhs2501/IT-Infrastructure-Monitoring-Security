# Dựng lại môi trường Lab

## Trạng thái bàn giao

Repo có mã nguồn Portal, mẫu cấu hình và các bản export cấu hình đã lọc bí mật cho Windows Server, Ubuntu, Zabbix Agent và Wazuh. Đây là tài liệu để dựng một Lab tương đương về chức năng; repo **không chứa image/backup, database, AD system state, Wazuh index, Zabbix database hoặc chứng thư/khóa**. Vì vậy không thể phục hồi nguyên trạng server production chỉ bằng `git clone`.

## Mô hình Lab tối thiểu

| Máy | Vai trò | Gợi ý tài nguyên Lab |
|---|---|---|
| Windows Server | AD DS/DNS, Portal, Zabbix Agent, Wazuh Agent | 2 vCPU, 4–8 GB RAM, 60 GB disk |
| Ubuntu Server | Zabbix Server, Wazuh components, Docker | 4 vCPU, 8–16 GB RAM, 100 GB disk |
| Máy quản trị | Trình duyệt và PowerShell/SSH | Có thể dùng Windows Server nếu dành riêng cho Lab |

Chọn dải IP riêng trong mạng host-only/internal của hypervisor. Bảng dưới là chỗ điền cho Lab mới, không phải địa chỉ production:

| Vai trò | Tên DNS Lab | Địa chỉ Lab |
|---|---|---|
| Domain Controller | `<dc.lab.example>` | `<IP_DC>` |
| Ubuntu monitoring | `<monitor.lab.example>` | `<IP_UBUNTU>` |
| Portal | `<portal.lab.example>` | `<IP_PORTAL>` |

## Quy trình dựng

1. **Tạo mạng ảo cô lập.** Dành riêng subnet Lab, xác nhận route/firewall không đưa các dịch vụ thử nghiệm ra mạng production.
2. **Cài Windows Server và AD DS/DNS.** Tạo forest/domain Lab mới; cài RSAT ActiveDirectory trên máy chạy Portal. Tạo nhóm kiểm thử `Domain Admins`/nhóm IT phù hợp và một tài khoản thường.
3. **Cài Ubuntu.** Dùng bản LTS đã được tổ chức phê duyệt. Cài Docker Engine, sau đó dựng Wazuh/Zabbix theo hướng dẫn chính thức tương ứng với phiên bản muốn kiểm thử. Không sử dụng lại dữ liệu production.
4. **Đưa agent vào Lab.** Dựa trên `02-Zabbix-Agent/zabbix_agentd.conf.example`, `03-Wazuh-Agent/` và các export trong `08-Ubuntu-Server/`; thay mọi hostname, IP, password, key và certificate bằng thông tin mới. Cấu hình manager/agent hai chiều theo tài liệu sản phẩm.
5. **Chuẩn bị Portal.** Cài Node.js 22 LTS x64 trên Windows, clone repo hoặc lấy bản source, chạy `npm ci`, copy `.env.example` thành `.env`. Điền endpoint Lab, tài khoản API/SSH Lab và `SESSION_SECRET` riêng dài tối thiểu 32 ký tự.
6. **Kiểm tra quyền và kết nối.** Đảm bảo Portal chạy dưới tài khoản dịch vụ riêng. Kiểm tra DNS, đường mạng cần thiết và ACL; dùng tài khoản chỉ đọc cho monitoring.
7. **Khởi động và xác minh.** Chạy `npm test`, `npm run check:env`, `npm start`. Mở `http://localhost:<PORT>` trong mạng Lab. Đăng nhập AD rồi xác nhận Dashboard, Zabbix, Wazuh và Docker; lỗi nguồn tích hợp cần được giữ lại làm bằng chứng test âm.
8. **Thiết lập cảnh báo và thông báo.** Thực hiện theo [ALERTS_NOTIFICATIONS.md](ALERTS_NOTIFICATIONS.md), tạo ngưỡng trong Zabbix/Wazuh Lab và gửi thử tới mailbox/webhook Lab.
9. **Lưu hồ sơ tái dựng.** Ghi lại phiên bản OS, package, IP Lab, sơ đồ, các bước, test evidence và cấu hình đã khử bí mật. Snapshot VM chỉ giữ cục bộ nếu có dữ liệu nhạy cảm.

## Các điểm cần thay khi dựng

- Endpoint, port, DNS, OU distinguished name, nhóm AD và agent names.
- `ZABBIX_URL`, token API, host macros và quyền user Zabbix.
- `INDEXER_URL`, user/password và CA certificate cho Wazuh Indexer.
- `LINUX_SSH_*`, user có quyền Docker phù hợp; không dùng SSH password của máy thật.
- `PFSENSE_SSH_*` nếu có firewall Lab; có thể bỏ tích hợp này khi không có thiết bị thử nghiệm.
- `PORT`, `COOKIE_SECURE`, TLS/reverse proxy, `DB_PATH` và retention theo môi trường.

## Kiểm tra hoàn tất Lab

- [ ] Domain test phân giải DNS và xác thực được.
- [ ] Agent Windows/Linux hiển thị online ở hệ thống tương ứng.
- [ ] Dashboard hiển thị dữ liệu mới, không chỉ dữ liệu cache.
- [ ] Wazuh Security Alert có thể hiển thị event Lab.
- [ ] Một alert test kích hoạt và một notification test được nhận.
- [ ] Kiểm thử quyền từ tài khoản IT và tài khoản không đủ quyền.
- [ ] Cất bằng chứng (ảnh đã che dữ liệu cá nhân, thời gian, kết quả, log test) trong gói báo cáo.

Không đánh dấu Lab là dựng xong cho tới khi checklist được chạy trên Lab thực tế.
