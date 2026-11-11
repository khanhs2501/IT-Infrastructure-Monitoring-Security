# Xử lý sự cố đăng nhập Portal

Chạy trên máy chủ Portal (PowerShell/CMD, thư mục `C:\RG-ITPortal`):

```powershell
npm run diagnose:login -- Administrator
```

Script kiểm tra: PowerShell/AD có chạy được không, chính sách khóa tài khoản của domain, tài khoản có bị **LockedOut / Disabled / PasswordExpired** không, các lần đăng nhập gần đây (HTTP 200/401/429/503) và cho phép thử mật khẩu (nhập ẩn).

## Thông báo → nguyên nhân → cách xử lý

| Portal báo | HTTP | Nguyên nhân | Xử lý |
|---|---|---|---|
| Tên tài khoản hoặc mật khẩu không chính xác | 401 | AD từ chối mật khẩu. **Mỗi lần sai đều cộng vào bộ đếm khóa của AD.** | Kiểm tra gõ phím/Caps Lock/bộ gõ tiếng Việt; trình duyệt có tự điền mật khẩu cũ không |
| Tài khoản đang bị KHÓA trong Active Directory | 401 `locked_out` | Nhập sai vượt ngưỡng khóa của domain | `Unlock-ADAccount -Identity Administrator` trên DC, hoặc đợi hết thời gian khóa |
| Tài khoản đã bị vô hiệu hóa | 401 `disabled` | Tài khoản Disabled | `Enable-ADAccount -Identity <tên>` |
| Mật khẩu không đúng hoặc đã hết hạn | 401 `password_expired` | Mật khẩu hết hạn | Đặt lại mật khẩu trên DC |
| Tài khoản "x" đã nhập sai quá N lần… | 429 | Portal tạm chặn **riêng tài khoản đó** (không ảnh hưởng người khác) | Đợi số phút hiển thị, hoặc restart service để xóa bộ đếm khẩn cấp |
| Không thể xác thực với Active Directory… | 503 | **Không phải sai mật khẩu.** PowerShell/ADWS chậm hoặc lỗi | Chạy `diagnose:login`; kiểm tra service *Active Directory Web Services*, RSAT, antivirus quét `powershell.exe`; xem `daemon\royalgroupitportal.err.log` |
| Xác thực thành công nhưng trình duyệt không giữ được phiên | — | Cookie bị chặn; hoặc `COOKIE_SECURE=true` trong khi dùng `http://` | Đặt `COOKIE_SECURE="auto"` (hoặc `false`) trong `.env`, restart |
| Phiên đăng nhập đã hết hạn | 401 | Quá `SESSION_HOURS` giờ, hoặc đã đăng xuất | Đăng nhập lại |

## Lưu ý để Administrator không tự khóa mình
- Đặt `LOGIN_MAX_ATTEMPTS` **nhỏ hơn** ngưỡng khóa của domain (`diagnose:login` in ra ngưỡng này).
- Tắt tự điền mật khẩu cũ của trình duyệt cho trang Portal; mỗi lần tự điền sai là một lần cộng vào bộ đếm của AD.
- Tài khoản dịch vụ/script cũ dùng mật khẩu Administrator cũ cũng làm tăng bộ đếm: kiểm tra `LastBadPasswordAttempt` trong kết quả `diagnose:login`.

## Xem nhật ký
- Nhật ký ứng dụng: `daemon\royalgroupitportal.out.log`, `...err.log` (dòng `[auth] ...`).
- Menu **Nhật Ký Hoạt Động** (Super-Admin): mỗi lần đăng nhập, kể cả thất bại, ghi tên tài khoản đã thử, mã HTTP và IP.
- Lưu ý: nếu mọi người đi qua cùng NAT/gateway, cột IP sẽ giống nhau (`TRUST_PROXY=false`). Chỉ đặt `TRUST_PROXY` khi có reverse proxy tin cậy.
