// Tra tên máy theo IP. Thứ tự ưu tiên: AD (máy tính domain) > Zabbix (tên host) > DHCP lease > DNS ngược > NetBIOS
const dns = require('dns').promises; const axios = require('axios'); const { exec } = require('child_process'); const { runPS } = require('./utils');
const IP = /^\d{1,3}(\.\d{1,3}){3}$/, TTL = 600000, cache = new Map(), maps = { ad: { t: 0, m: {} }, zb: { t: 0, m: {} } };
let busy = false;

async function loadAD() {
    if (Date.now() - maps.ad.t < 300000) return; maps.ad.t = Date.now();
    const r = await runPS(`@(Get-ADComputer -Filter * -Properties IPv4Address | Where-Object { $_.IPv4Address } | Select-Object Name, IPv4Address) | ConvertTo-Json -Compress`, 25000);
    maps.ad.m = {}; (r || []).forEach(c => maps.ad.m[c.IPv4Address] = c.Name);
}
async function loadZbx() {
    if (Date.now() - maps.zb.t < 300000) return; maps.zb.t = Date.now();
    const r = await axios.post(process.env.ZABBIX_URL, { jsonrpc: '2.0', method: 'host.get', params: { output: ['name'], selectInterfaces: ['ip'] }, id: 1 }, { headers: { 'Content-Type': 'application/json-rpc', Authorization: 'Bearer ' + process.env.ZABBIX_TOKEN }, timeout: 5000 });
    maps.zb.m = {}; (r.data.result || []).forEach(h => h.interfaces.forEach(i => { if (i.ip && i.ip !== '127.0.0.1') maps.zb.m[i.ip] = h.name; }));
}
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
const rev = ip => withTimeout(dns.reverse(ip).then(a => (a[0] || '').split('.')[0] || null).catch(() => null), 2000);
const nbt = ip => new Promise(res => exec(`nbtstat -A ${ip}`, { timeout: 4000, windowsHide: true }, (e, out) => { const m = /^\s*(\S+)\s+<00>\s+UNIQUE/m.exec(out || ''); res(m ? m[1] : null); }));

// Gọi nền (không chờ): kết quả được lưu đệm, lần làm mới kế tiếp của trang sẽ hiện tên
async function refresh(items) {
    if (busy) return; busy = true;
    try {
        await Promise.all([loadAD().catch(() => {}), loadZbx().catch(() => {})]);
        const todo = items.filter(x => {
            if (!IP.test(x.ip)) return false;
            const hit = cache.get(x.ip), age = hit ? Date.now() - hit.t : Infinity;
            return !hit || age >= (hit.name ? TTL : 15000);
        });
        for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(async x => {
            // A current DHCP client hostname follows the device when its IP changes;
            // directory/monitoring IP maps can briefly retain the previous owner.
            let name = x.dhcp, src = 'DHCP';
            if (!name) { name = maps.ad.m[x.ip]; src = 'AD'; }
            if (!name) { name = maps.zb.m[x.ip]; src = 'Zabbix'; }
            if (!name) { name = await rev(x.ip); src = 'DNS'; }
            if (!name) { name = await nbt(x.ip); src = 'NetBIOS'; }
            cache.set(x.ip, { name: name || null, src: name ? src : null, t: Date.now() });
        }));
    } finally { busy = false; }
}
module.exports = { refresh, lookup: ip => cache.get(ip) || null };
