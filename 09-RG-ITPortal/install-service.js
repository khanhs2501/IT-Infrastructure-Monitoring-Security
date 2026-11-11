const path = require('path');
const Service = require('node-windows').Service;

const svc = new Service({
  name: 'RoyalGroup IT Portal',
  description: 'Hệ thống Trung tâm Điều hành Hạ tầng & An ninh ROYALGROUP.VN (Node.js Web Server)',
  script: path.join(__dirname, 'server.js'),   // theo thư mục hiện tại, không còn cố định C:\\RG-ITPortal
  env: [{ name: 'NODE_ENV', value: 'production' }],
  // Mặc định node-windows chỉ cho khởi động lại 3 lần/60 giây rồi DỪNG HẲN service. Nới ra để lỗi thoáng qua (DB bận, mạng) không làm Portal chết.
  maxRestarts: 10,
  wait: 2,
  grow: 0.5
});

svc.on('install', function () {
  console.log('Đã đăng ký Windows Service thành công!');
  console.log('Đang khởi động ROYALGROUP IT Portal ngầm...');
  svc.start();
});
svc.on('alreadyinstalled', function () {
  console.log('Service này đã được cài đặt từ trước. Muốn áp dụng cấu hình mới: node uninstall-service.js rồi chạy lại file này.');
});

svc.install();
