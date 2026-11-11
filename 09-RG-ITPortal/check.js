require('dotenv').config();
const axios = require('axios'), https = require('https'), { Client } = require('ssh2'), { runPS } = require('./routes/utils'), e = process.env;
let bad = 0; const ok = (n, m = '') => console.log('\x1b[32m✔\x1b[0m', n, m), no = (n, m) => (bad++, console.log('\x1b[31m✘\x1b[0m', n, '-', m));
const ssh = (host, port, username, password, cmd) => new Promise((res, rej) => { const c = new Client(); c.on('ready', () => c.exec(cmd, (er, s) => { if (er) { c.end(); return rej(er); } let d = ''; s.on('data', x => d += x).on('close', () => { c.end(); res(d.trim()); }); })).on('error', rej).connect({ host, port: +port || 22, username, password, readyTimeout: 6000 }); });
(async () => {
    const keys = ['SESSION_SECRET', 'ZABBIX_URL', 'ZABBIX_TOKEN', 'INDEXER_URL', 'INDEXER_USER', 'INDEXER_PASS', 'LINUX_SSH_HOST', 'LINUX_SSH_USER', 'LINUX_SSH_PASS', 'PFSENSE_SSH_HOST', 'PFSENSE_SSH_USER', 'PFSENSE_SSH_PASS'];
    const empty = keys.filter(k => !e[k]); empty.length ? no('.env', 'đang trống: ' + empty.join(', ')) : ok('.env', 'đủ ' + keys.length + ' khóa');
    try {
        const v = await axios.post(e.ZABBIX_URL, { jsonrpc: '2.0', method: 'apiinfo.version', params: {}, id: 1 }, { timeout: 5000 }); ok('Zabbix API', 'phiên bản ' + v.data.result);
        const body = { jsonrpc: '2.0', method: 'host.get', params: { limit: 1, output: ['host'] }, id: 1 };
        let r = await axios.post(e.ZABBIX_URL, body, { headers: { Authorization: 'Bearer ' + e.ZABBIX_TOKEN }, timeout: 5000 }), st = 'header Bearer';
        if (r.data.error) { r = await axios.post(e.ZABBIX_URL, { ...body, auth: e.ZABBIX_TOKEN }, { timeout: 5000 }); st = 'auth trong body'; }
        r.data.error ? no('Zabbix token', (r.data.error.data || r.data.error.message) + ' -> tạo token mới ở Users > API tokens; user của token phải có role được phép truy cập API') : ok('Zabbix token', 'hợp lệ (' + st + ')');
    } catch (x) { no('Zabbix API', (x.code || x.message) + ' - kiểm tra ZABBIX_URL'); }
    try {
        const r = await axios.get(e.INDEXER_URL, { auth: { username: e.INDEXER_USER, password: e.INDEXER_PASS }, httpsAgent: new https.Agent({ rejectUnauthorized: false }), timeout: 6000 });
        ok('Wazuh Indexer', 'cluster ' + r.data.cluster_name);
    } catch (x) { no('Wazuh Indexer', x.response ? 'HTTP ' + x.response.status + (x.response.status === 401 ? ' - sai INDEXER_USER/INDEXER_PASS' : '') : x.code || x.message); }
    try { ok('LINUX01 SSH', 'đăng nhập bằng user ' + await ssh(e.LINUX_SSH_HOST, e.LINUX_SSH_PORT, e.LINUX_SSH_USER, e.LINUX_SSH_PASS, 'whoami')); const d = await ssh(e.LINUX_SSH_HOST, e.LINUX_SSH_PORT, e.LINUX_SSH_USER, e.LINUX_SSH_PASS, '(docker ps -q >/dev/null 2>&1 && echo yes) || echo no'); console.log(d === 'yes' ? '   docker: đọc được' : '   \x1b[33m!\x1b[0m docker: user chưa có quyền (thêm vào nhóm docker nếu cần đếm container)'); }
    catch (x) { no('LINUX01 SSH', x.message + ' - sai LINUX_SSH_USER/LINUX_SSH_PASS hoặc server không cho đăng nhập bằng mật khẩu'); }
    try { ok('pfSense SSH', await ssh(e.PFSENSE_SSH_HOST, e.PFSENSE_SSH_PORT, e.PFSENSE_SSH_USER, e.PFSENSE_SSH_PASS, 'uname -sr')); }
    catch (x) { no('pfSense SSH', x.message + ' - bật Secure Shell trong System > Advanced > Admin Access và cấp quyền shell cho user'); }
    const p = await runPS(`[PSCustomObject]@{ Domain = (Get-ADDomain).DNSRoot; User = $env:USERNAME; GPO = [bool](Get-Module -ListAvailable GroupPolicy); SMB = [bool](Get-Command New-SmbShare -ErrorAction SilentlyContinue) } | ConvertTo-Json -Compress`);
    p ? ok('PowerShell/AD', `domain ${p.Domain}, chạy bằng ${p.User}, GPO=${p.GPO}, SMB=${p.SMB}`) : no('PowerShell/AD', runPS.lastErr + ' - chạy node bằng tài khoản domain có quyền quản trị, máy phải cài RSAT');
    console.log(bad ? `\n\x1b[31mCó ${bad} mục lỗi.\x1b[0m Sửa .env rồi chạy lại: node check.js` : '\n\x1b[32mTất cả kết nối đều OK.\x1b[0m'); process.exit(bad ? 1 : 0);
})();
