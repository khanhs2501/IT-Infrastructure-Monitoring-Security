# RG-ITPortal v1.8.0 — Dashboard vận hành

## Dashboard

- Tổng quan vận hành theo quyền người dùng: số phiếu đang mở/quá hạn, tài sản và lỗ hổng nghiêm trọng, trạng thái Zabbix/Wazuh/pfSense.
- Thêm thời điểm cập nhật, điều hướng nhanh tới Hỗ trợ kỹ thuật và danh sách lỗ hổng cần xử lý.
- Làm nổi bật thông số CPU/RAM/Disk và uptime cho từng máy chủ trên dashboard.
- Các số liệu AD, tài sản, bảo mật và giám sát chỉ được truy vấn khi tài khoản có quyền xem module tương ứng.

## Cập nhật

- Đã tăng phiên bản và đổi tham số cache của giao diện lên `1.8.0`.
- Không thay đổi schema ticket/asset hiện hữu. Database hiện tại cần sao lưu trước khi nâng cấp như mọi lần cập nhật.
