# Active Directory và Computer Management

Portal sử dụng Windows PowerShell/RSAT để truy vấn Active Directory. Trên máy chạy Portal cần có kết nối domain và module ActiveDirectory; các thao tác ghi cần quyền ủy quyền phù hợp.

Làm mới Group Policy từ xa dùng `Invoke-GPUpdate` (RSAT Group Policy Management), không dùng PowerShell Remoting/WinRM. Tài khoản chạy Portal cần quyền lập lịch tác vụ từ xa trên máy đích; firewall của máy đích cần cho phép Remote Scheduled Tasks Management (RPC/RPC-EPMAP) và Windows Management Instrumentation (WMI). Restart và repair trust vẫn dùng WinRM.

## Các tính năng

- Tìm kiếm/liệt kê user theo OU hoặc phạm vi toàn domain, xem thông tin nhóm và manager.
- Tạo OU kèm nhóm bảo mật `G_<TênOU>`.
- Sửa user, reset mật khẩu, khóa/mở khóa và xóa user với cập nhật dòng hiện tại trong UI.
- Liệt kê computer, chẩn đoán và thao tác computer dựa trên `COMPUTER_MANAGED_OUS` và `COMPUTER_PROTECTED_NAMES`.

## Cấu hình

- `DEPT_PARENT_OU`: tên OU cha quản lý các OU phòng ban.
- `DEPT_EXCLUDE_OU`: OU không được đưa vào danh sách thông thường.
- `COMPUTER_MANAGED_OUS`: danh sách OU được quản lý, phân tách bằng dấu phẩy.
- `COMPUTER_PROTECTED_NAMES`: tên computer cần bảo vệ, phân tách bằng dấu phẩy.

## An toàn

Thử các thao tác xóa, khóa, reset mật khẩu hoặc sửa trust trên tài khoản/máy kiểm thử trước. Không dùng Domain Admin làm tài khoản dịch vụ nếu có thể ủy quyền các quyền riêng cần thiết.
