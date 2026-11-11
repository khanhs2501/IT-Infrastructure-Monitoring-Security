# Danh sách tính năng và cơ chế hoạt động của ROYALGROUP IT Portal

Tài liệu này mô tả cơ chế theo mã nguồn hiện tại của portal: dữ liệu lấy từ đâu, thao tác được thực hiện trên hệ thống nào và các giới hạn quan trọng. Đây không phải danh sách cấu hình đã được xác nhận trên mọi máy chủ/client.

## 1. Đăng nhập, phân quyền và nhật ký

- **Đăng nhập:** Portal xác thực thông tin tài khoản với Active Directory (AD), tạo session sau khi xác thực thành công. Có giới hạn thử đăng nhập sai theo tài khoản/IP; session được lưu bền vững.
- **Phân quyền:** mỗi module có mức `none`, `view`, `manage`. Có quyền mặc định theo vai trò và quyền ghi đè riêng cho từng tài khoản. `Super-Admin` có toàn quyền; quyền trên giao diện được kiểm tra lại ở API.
- **Nhật ký:** các request API ghi dữ liệu (và các lần đăng nhập) được lưu vào SQLite cùng tài khoản, vai trò, phương thức, đường dẫn, kết quả và IP. API GET thông thường không ghi log.
- **Hồ sơ của tôi:** đọc thông tin cá nhân, trạng thái tài khoản, nhóm và hạn mật khẩu từ AD.

## 2. Quản trị Active Directory

- **OU phòng ban và nhóm:** danh sách OU/nhóm đọc từ AD. Tạo phòng ban tạo OU cùng nhóm bảo mật theo quy ước `G_<TênOU>`.
- **Tài khoản người dùng:** tạo user vào OU phòng ban, bật tài khoản và thêm nhóm được phép; sửa tên hiển thị/phòng ban/nhóm và di chuyển OU; bật/tắt, đặt lại mật khẩu, mở khóa hoặc xóa user. Một số thao tác với tài khoản quản trị chỉ dành cho Super-Admin.
- **Danh sách nhóm:** đọc nhóm, loại/scope và thành viên đệ quy trong OU đã chọn; màn hình này không sửa thành viên nhóm.
- **Nguồn dữ liệu:** PowerShell RSAT `ActiveDirectory`, chạy dưới danh tính Windows của tiến trình Portal. Quyền thật sự còn phụ thuộc ACL AD của danh tính này.

## 3. Quản lý máy tính (Computer Management)

- **Danh sách:** đọc computer objects từ OU được chọn trong AD (mặc định `Client_Computers`), có phân trang/lọc và thông tin `ManagedBy`.
- **IP:** portal phân giải bản ghi DNS của `DNSHostName` để lấy IPv4. DNS cũ có thể làm IP hiển thị cũ.
- **MAC và lease hiện tại:** lấy từ ARP/lease DHCP của pfSense, ghép trước bằng hostname đã chuẩn hóa; dùng IP làm dự phòng khi hostname lease không mâu thuẫn. AD không tự lưu MAC. Nếu DNS trỏ vào lease mang hostname máy khác, giao diện báo lệch thay vì gán nhầm MAC.
- **Thao tác computer:** chuyển OU, gán owner (`ManagedBy`), bật/tắt object, hoặc xóa computer object khỏi AD. Xóa object không xóa lease pfSense và không gỡ Windows khỏi domain.
- **GPUpdate:** dùng `Invoke-GPUpdate` để lên lịch refresh từ xa; không chạy trực tiếp lệnh trong phiên WinRM. Cần RSAT Group Policy Management trên Portal, quyền lập lịch tác vụ/WMI trên client và luật firewall Remote Scheduled Tasks/WMI phù hợp.
- **Repair trust, restart, shutdown:** chạy lệnh PowerShell từ xa qua WinRM trên máy đích; cần DNS đúng, WinRM/firewall hoạt động và danh tính dịch vụ Portal có quyền tương ứng.
- **LAPS:** đọc mật khẩu LAPS từ thuộc tính AD khi người dùng có quyền `computers` và `laps`; mật khẩu không lưu trong inventory thông thường.
- **Giới hạn nhận diện:** pfSense nhận diện lease mạng; Computer Management liệt kê object AD. Lease DHCP không tự tạo computer object và cũng không chứng minh máy vẫn join domain.

## 4. Quản trị hệ thống Windows

- **GPO:** xem các GPO hiện có; tạo GPO từ danh sách chính sách dựng sẵn (ví dụ khóa USB, bật firewall, tắt SMBv1, NLA, khóa màn hình) bằng thiết lập registry; có thể link vào domain hoặc OU. Xóa theo GUID sẽ xóa GPO.
- **SMB share:** tạo thư mục và share trên máy Windows chạy Portal, cấp mức Read/Change/Full cho nhóm được cho phép. Xóa share chỉ ngừng chia sẻ, không xóa nội dung thư mục.
- **Ổ đĩa/thư mục:** đọc dung lượng ổ đĩa và duyệt thư mục máy chủ ở chế độ chỉ đọc trong phần quản trị hệ thống.
- **Danh tính thực thi:** các lệnh PowerShell và SMB chạy dưới tài khoản dịch vụ Portal; quyền hiển thị của người dùng Portal không tự cấp quyền Windows/AD cho tiến trình.

## 5. Thư mục phòng ban và ủy quyền NTFS

- Portal lấy OU phòng ban và người quản lý từ AD (`ManagedBy`), ánh xạ sang thư mục phòng ban cấu hình trên máy chủ và các SMB share tương ứng.
- Super-Admin thiết lập thư mục phòng ban; trưởng phòng có thể cấp quyền cho nhân viên thuộc OU của mình; IT có thể cấp quyền tạm thời khi ghi lý do, tối đa 30 ngày.
- Quyền được áp dụng bằng ACL NTFS (`Read` hoặc `Modify`) trên thư mục và được ghi vào SQLite để theo dõi người cấp, lý do, mức quyền, thời hạn và quyền trước đó.
- Tác vụ nền tự khôi phục mức quyền trước khi hết hạn; tác vụ nền khác đồng bộ nhóm phòng ban theo OU AD khoảng mỗi 10 phút.
- Người dùng xem các thư mục mình có thể truy cập; Super-Admin có thể duyệt thư mục máy chủ ở chế độ chỉ đọc.

## 6. Quản lý Docker

- Portal kết nối SSH đến máy Linux đã cấu hình và gọi Docker CLI; tài khoản SSH cần quyền sử dụng Docker.
- **Containers:** xem trạng thái/log/inspect và start, stop, restart, pause, unpause. Container/stack hệ thống được bảo vệ; thao tác nhạy cảm như kill/remove chỉ Super-Admin.
- **Stacks/Compose:** xem và sửa Compose trong thư mục quản lý; validate/redeploy có thể khởi động lại dịch vụ. Stack hệ thống yêu cầu xác nhận tên.
- **Images, volumes, networks:** pull/xóa/dọn image; tạo/xóa volume/network và build image. Hành động xóa/dọn bị giới hạn quyền hoặc chặn nếu volume đang được dùng.
- **File browser:** đọc/ghi file container/volume theo quyền và giới hạn của route; stack ngoài thư mục được quản lý là chỉ đọc.

## 7. Tài sản CNTT

- Tài sản được lưu trong SQLite, có Asset Tag duy nhất, loại, hostname, IP, hệ điều hành, môi trường, mức quan trọng, owner và trạng thái.
- Có thể tạo/sửa thủ công hoặc đồng bộ host trong scope cho phép từ Zabbix. Đồng bộ không thay thế cấu hình thủ công tùy ý; các trường và trạng thái có quy tắc riêng.
- Không cho xóa tài sản đang được ticket, phát hiện lỗ hổng hoặc tác vụ bản vá tham chiếu; nên chuyển sang `Retired` để giữ lịch sử.

## 8. Lỗ hổng và theo dõi bản vá

- **Phát hiện:** nhập inventory lỗ hổng từ Wazuh Indexer theo danh sách agent cấu hình; chống trùng theo agent/CVE/package và cập nhật `last_seen`. Có thể thêm phát hiện thủ công, gán người xử lý, hạn xử lý, remediation và trạng thái.
- **Bản vá:** tạo/cập nhật kế hoạch bản vá (Windows Update, Linux Package, Container Image hoặc Other), lịch, người phụ trách và trạng thái.
- **Giới hạn:** đây là quản lý finding/kế hoạch và trạng thái; ghi `Installed` không tự cài bản vá lên thiết bị.

## 9. Helpdesk

- Người dùng tạo ticket với loại, mô tả và độ ưu tiên; ticket gắn với requester, có bình luận và các trạng thái Open → InProgress → Resolved/Cancelled.
- IT nhận xử lý, trao đổi, ghi kết quả khi đóng; SLA phản hồi/giải quyết được tính theo mức ưu tiên.
- Có thể tạo incident từ cảnh báo Zabbix/Wazuh/pfSense; external source + ID được dùng để tránh tạo trùng. Ticket có thể liên kết với tài sản.
- Nhân viên thường chỉ xem ticket của mình; IT có quyền xem/xử lý theo phân quyền.

## 10. Màn hình đọc/giám sát và báo cáo

- **Zabbix:** đọc số liệu giám sát và trạng thái host; không điều khiển thiết bị từ màn hình giám sát.
- **Wazuh/SOC:** đọc cảnh báo/indexer và dữ liệu an ninh; nhập inventory lỗ hổng được mô tả ở mục 8.
- **pfSense:** đọc counters interface, ARP và DHCP lease qua SSH; dùng làm giàu hostname/IP/MAC. Màn hình này không đổi cấu hình DHCP, gateway hay firewall.
- **Platforms:** kiểm tra kết nối và đọc trạng thái Zabbix, Wazuh, pfSense, Kubernetes và AWS nếu cấu hình. Kubernetes/AWS dùng API đọc; phần AWS ký request với credential cấu hình.
- **Reports:** tổng hợp ticket/tài sản/lỗ hổng/bản vá, cung cấp dataset và CSV ở chế độ đọc.
- Các mục này là quan sát/báo cáo; quyền quản trị phụ thuộc riêng từng module.

## 11. Phân biệt các nguồn dữ liệu chính

| Dữ liệu/đối tượng | Nguồn sự thật | Portal dùng để |
|---|---|---|
| User và computer account | Active Directory | Liệt kê/quản trị tài khoản và computer object |
| IP hiện thời, MAC, lease, DHCP hostname | pfSense | Làm giàu thông tin mạng; không thay thế AD |
| Bản ghi tên máy | DNS | Phân giải FQDN/IP; có thể cập nhật chậm hoặc trỏ sai |
| Monitoring/vulnerability inventory | Zabbix/Wazuh | Hiển thị và đồng bộ dữ liệu theo scope cấu hình |
| Ticket, asset, grants, reports, permissions, audit | SQLite của Portal | Lưu nghiệp vụ và lịch sử riêng của Portal |
| Container/stack | Docker trên Linux qua SSH | Đọc hoặc thực hiện thao tác Docker theo quyền Portal |

## 12. Các lưu ý vận hành

- Quyền `manage` trong Portal chỉ cho phép gọi API; tài khoản Windows chạy dịch vụ vẫn phải có quyền AD, NTFS, SMB, WinRM, RPC/WMI hoặc Docker tương ứng.
- Xóa user/computer/GPO là thao tác trên hệ thống nguồn, không chỉ ẩn dòng khỏi Portal.
- IP/MAC từ DHCP, IP từ DNS và computer object AD có vòng đời khác nhau; không nên xem chúng là một bản ghi đồng bộ duy nhất.
- Nên kiểm tra OU, DNS, quyền của tài khoản dịch vụ và firewall trước khi dùng thao tác từ xa trên máy thật.
