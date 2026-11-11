# Kịch bản video demo ngắn (3–5 phút)

> Đây là kịch bản để quay demo trên Lab. Chưa phải video đã quay; không dùng giao diện hay dữ liệu production nếu chưa được phép.

| Thời gian | Cảnh quay | Thao tác / lời dẫn | Bằng chứng |
|---|---|---|---|
| 0:00–0:20 | Tiêu đề | Nêu tên đề tài, mục tiêu và môi trường Lab | Tên đề tài, ngày quay |
| 0:20–0:50 | Sơ đồ kiến trúc | Chỉ luồng Portal ↔ Zabbix/Wazuh/AD/Docker | `ARCHITECTURE_DESIGN.md` |
| 0:50–1:30 | Đăng nhập và Dashboard | Đăng nhập tài khoản test; chỉ ra trạng thái tổng quan và nguồn dữ liệu | Che username/domain/IP thật |
| 1:30–2:05 | Monitoring | Mở trang Zabbix; chỉ ra host/problem và thời gian lấy dữ liệu | Tạo/chuẩn bị event Lab có thể phục hồi |
| 2:05–2:45 | Security Alert | Mở Wazuh alert; chỉ ra rule ID, level, agent; tạo incident nếu tính năng quyền cho phép | Alert Lab đã khử thông tin |
| 2:45–3:20 | Notification | Hiện email/webhook test nhận được và liên kết với event ID | Ẩn địa chỉ cá nhân, token và URL nhạy cảm |
| 3:20–4:00 | Test và mã nguồn | Nêu `npm test` PASS; lướt repo/docs/test result trên GitHub | Không mở `.env`, secret hoặc DB |
| 4:00–4:20 | Kết thúc | Tóm tắt trạng thái và giới hạn còn lại | Slide cuối: repo và tài liệu |

## Checklist trước khi quay

- [ ] Dựng và nghiệm thu Lab; dùng tài khoản/dữ liệu tổng hợp.
- [ ] Xác nhận consent/cho phép ghi hình môi trường.
- [ ] Tắt thông báo desktop và che email, IP/domain, hostname, tên người dùng, ticket, token.
- [ ] Chuẩn bị sự kiện có thể kích hoạt an toàn rồi recovery; không tạo sự cố phá hoại.
- [ ] Dùng 1080p, bật tiếng rõ, quay theo một lần thử trước; cắt bỏ màn hình chờ/lỗi.
- [ ] Lưu MP4 trong thư mục bàn giao ngoài repo public nếu video chứa dữ liệu nội bộ; chỉ đưa bản đã duyệt lên nơi nộp.

## Trạng thái

Kịch bản đã chuẩn bị. Video thực tế còn phải quay sau khi Lab và alert/notification được kiểm chứng.
