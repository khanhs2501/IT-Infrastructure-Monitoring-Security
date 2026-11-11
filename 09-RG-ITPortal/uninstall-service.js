const path = require('path');
const Service = require('node-windows').Service;

const svc = new Service({ name: 'RoyalGroup IT Portal', script: path.join(__dirname, 'server.js') });
svc.on('uninstall', function () { console.log('Đã gỡ service "RoyalGroup IT Portal". Dữ liệu (itportal.db, .env) được giữ nguyên.'); });
svc.on('alreadyuninstalled', function () { console.log('Service chưa được cài đặt.'); });
svc.uninstall();
