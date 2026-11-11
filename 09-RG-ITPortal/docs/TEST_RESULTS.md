# Kết quả kiểm thử

**Ngày chạy:** 2026-11-11
**Môi trường:** Windows PowerShell, Node.js v24.22.1, portal v1.8.2
**Lệnh:** `npm ci` rồi `npm test` trong `09-RG-ITPortal`

## Kết quả tự động

| Nhóm | Kết quả | Bằng chứng / phạm vi |
|---|---|---|
| Smoke + syntax + yêu cầu file/feature | PASS | Các file JS parse được; cấu trúc/sidebar, health, session, AD và mẫu cấu hình được kiểm tra. Repo không có `.env`/SQLite runtime. |
| PowerShell JSON và AD contract | PASS | JSON sau console noise, nested data/false và contract truy vấn AD. Không gọi domain thật. |
| AD UI row actions | PASS | Lock/unlock và delete cập nhật một hàng, không reload toàn bộ danh sách. |
| HTTP/SQLite flow | PASS | Chạy app test cục bộ, DB tạm, health/login/session/permission flow. |
| Login/security flow | PASS | Tên đăng nhập, session qua restart, giới hạn sai mật khẩu, lỗi AD, timeout, CSRF, audit, logout và expiry. AD được giả lập. |

**Kết luận:** `npm test` kết thúc với exit code 0. Test tự động không xác nhận kết nối tới Zabbix, Wazuh Indexer, domain AD, Docker/SSH, pfSense, alert thresholds hoặc email/webhook thật. Các kiểm thử chấp nhận A-01–A-10 trong [TEST_CASES.md](TEST_CASES.md) vẫn cần được thực hiện trên Lab.

## Hạn chế / ghi nhận

- Trước lần chạy đạt, smoke test và AD contract test còn sót kỳ vọng v1.7.0 cùng dữ liệu thật. Tôi cập nhật các kỳ vọng sang phiên bản/cấu hình mẫu 1.8.2 đã khử thông tin thật.
- `npm ci` báo 5 cảnh báo lỗ hổng phụ thuộc (2 moderate, 3 high). Chưa chạy `npm audit fix` và chưa đổi phiên bản thư viện vì cần đánh giá compatibility trước khi nâng cấp.
- Chưa chạy `npm run check:env` vì script yêu cầu `.env` riêng của môi trường triển khai. Không tạo `.env` giả rồi nhầm thành cấu hình chạy thật.
- Chưa có bằng chứng kiểm thử browser giao diện end-to-end hoặc demo video ghi trực tiếp.

## Cần bổ sung khi nghiệm thu Lab

Ghi phiên bản Windows/Ubuntu, Node, Zabbix, Wazuh; ngày giờ; người test; ID sự kiện; ảnh đã che thông tin; kết quả notification; kết luận PASS/FAIL và ticket khắc phục (nếu có). Không đưa mật khẩu, token, private key hoặc thông tin cá nhân lên bản public.
