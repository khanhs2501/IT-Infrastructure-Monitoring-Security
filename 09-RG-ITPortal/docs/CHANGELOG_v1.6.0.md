# RG-ITPortal v1.6.0

- Dọn tài liệu lịch sử v1.4/v1.5 lỗi thời và gộp lại tài liệu cấu hình, vận hành và AD hiện hành.
- Thêm `START_PORTAL.cmd` để kiểm tra Node/dependency, chạy `npm test`, sau đó khởi động Portal.
- Bump package và cache key asset lên v1.6.0; làm logo ROYALGROUP lớn hơn và giữ viền xanh của đồng hồ.
- Bổ sung cấu hình chạy cục bộ `PORT=3000`, `TRUST_PROXY`, `COOKIE_SECURE`, `DB_PATH`, `AUDIT_RETENTION_DAYS` vào `.env` nhưng giữ nguyên credentials hiện có.
- Snapshot `itportal.db` bằng SQLite backup API, kiểm tra integrity và loại sidecar WAL/SHM phụ khỏi gói.
- Loại log daemon khỏi bundle; giữ executable/config service wrapper hiện có.
- Rà soát smoke test theo các file hiện hành; cho phép test flow dùng adapter SQLite tích hợp của Node trên host Linux khi gói chứa binary SQLite dành cho Windows.
