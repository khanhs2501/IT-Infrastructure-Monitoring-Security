const express = require('express'); const router = express.Router(); const axios = require('axios');
const ZABBIX_URL = process.env.ZABBIX_URL;

async function zbx(method, params) {
    const body = { jsonrpc: '2.0', method, params, id: 1 }, token = process.env.ZABBIX_TOKEN;
    let r = await axios.post(ZABBIX_URL, body, { headers: { 'Content-Type': 'application/json-rpc', Authorization: 'Bearer ' + token }, timeout: 5000 });
    if (r.data.error) r = await axios.post(ZABBIX_URL, { ...body, auth: token }, { timeout: 5000 }); // Zabbix < 6.4
    if (r.data.error) throw new Error((r.data.error.data || r.data.error.message) + (/authoriz/i.test(r.data.error.data || '') ? ' - kiểm tra ZABBIX_TOKEN trong .env (chạy node check.js)' : ''));
    return r.data.result;
}

// ---------- SỨC KHỎE SERVER: lấy từ Zabbix (không SSH/PowerShell trực tiếp nữa) ----------
// Tên host trên Zabbix. Nếu khác, thêm vào .env: ZABBIX_HOST_WIN=... và ZABBIX_HOST_LINUX=...
const WANT = { win: process.env.ZABBIX_HOST_WIN || 'ROYAL01', linux: process.env.ZABBIX_HOST_LINUX || 'LINUX01' };
let hostCache = { t: 0, map: null };
async function findHosts() {
    if (hostCache.map && Date.now() - hostCache.t < 300000) return hostCache.map;
    const all = await zbx('host.get', { output: ['hostid', 'host', 'name'], selectInterfaces: ['ip'] });
    const pick = (want, ip) => all.find(h => [h.host, h.name].some(n => n.toLowerCase() === want.toLowerCase())) || (ip && all.find(h => h.interfaces.some(i => i.ip === ip)));
    const map = { win: pick(WANT.win), linux: pick(WANT.linux, process.env.LINUX_SSH_HOST), names: all.map(h => h.name) };
    if (map.win && map.linux) hostCache = { t: Date.now(), map };
    return map;
}
async function hostMetrics(h) {
    const items = await zbx('item.get', { hostids: h.hostid, output: ['key_', 'lastvalue', 'lastclock'], search: { key_: ['system.cpu.util', 'vm.memory.util', 'vm.memory.size[pavailable]', 'system.uptime', 'pused'] }, searchByAny: true });
    const now = Date.now() / 1000, find = rx => items.find(i => rx.test(i.key_) && i.lastclock !== '0');
    const val = i => i ? parseFloat(i.lastvalue) : NaN;
    let mem = val(find(/^vm\.memory\.util(ization)?$/));
    if (isNaN(mem)) { const p = val(find(/^vm\.memory\.size\[pavailable\]$/)); if (!isNaN(p)) mem = 100 - p; }
    const up = find(/^system\.uptime$/);
    return {
        cpu: val(find(/^system\.cpu\.util$/)), mem, disk: val(find(/^vfs\.fs\.(dependent\.)?size\[(\/|C:),pused\]$/i)),
        uptime: up ? parseFloat(up.lastvalue) + (now - +up.lastclock) : NaN,   // cộng thêm thời gian trôi qua để đồng hồ uptime chạy
        age: items.length ? now - Math.max(...items.map(i => +i.lastclock)) : Infinity
    };
}

router.get('/zabbix', async (req, res) => {
    const errors = []; let problems = [], actionsLog = [];
    const metrics = { royal_cpu: '--', royal_mem: '--', royal_disk: '--', royal_uptime: '--:--:--', linux_cpu: '--', linux_mem: '--', linux_disk: '--', linux_uptime: '--:--:--', source: 'Zabbix' };
    const fmt = t => new Date(t * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), sev = ['Not classified', 'Info', 'Warning', 'Average', 'High', 'Disaster'];
    const f1 = v => isNaN(v) ? '--' : v.toFixed(1), z2 = n => String(Math.floor(n)).padStart(2, '0');
    const hms = s => isNaN(s) ? '--:--:--' : `${z2(s / 3600)}:${z2((s % 3600) / 60)}:${z2(s % 60)}`;

    await Promise.all([
        (async () => {
            try {
                const H = await findHosts();
                for (const [k, prefix, label] of [['win', 'royal', 'ROYAL01'], ['linux', 'linux', 'LINUX01']]) {
                    if (!H[k]) { errors.push(`Zabbix: không thấy host "${WANT[k]}". Các host hiện có: ${H.names.join(', ')} (đặt ZABBIX_HOST_${k === 'win' ? 'WIN' : 'LINUX'} trong .env)`); continue; }
                    const m = await hostMetrics(H[k]);
                    metrics[prefix + '_cpu'] = f1(m.cpu); metrics[prefix + '_mem'] = f1(m.mem); metrics[prefix + '_disk'] = f1(m.disk); metrics[prefix + '_uptime'] = hms(m.uptime);
                    const missing = [['CPU', m.cpu], ['RAM', m.mem], ['Disk', m.disk], ['Uptime', m.uptime]].filter(x => isNaN(x[1])).map(x => x[0]);
                    if (missing.length) errors.push(`${label}: Zabbix chưa có dữ liệu ${missing.join(', ')} - kiểm tra template "${k === 'win' ? 'Windows' : 'Linux'} by Zabbix agent" đã gắn vào host chưa`);
                    else if (m.age > 300) errors.push(`${label}: Zabbix không nhận dữ liệu mới trong ${Math.round(m.age / 60)} phút - kiểm tra Zabbix agent`);
                }
            } catch (e) { errors.push('Zabbix (sức khỏe server): ' + e.message); }
        })(),
        (async () => {
            try {
                // event.get để kéo toàn bộ lịch sử (bất kể đã đóng bao lâu)
                const pr = await zbx('event.get', { source: 0, object: 0, value: 1, output: ['eventid', 'objectid', 'clock', 'name', 'severity', 'r_eventid'], sortfield: ['eventid'], sortorder: 'DESC', limit: 25 });
                const trg = pr.length ? await zbx('trigger.get', { triggerids: pr.map(p => p.objectid), output: ['triggerid'], selectHosts: ['name'] }) : [];
                const hostOf = {}; trg.forEach(t => hostOf[t.triggerid] = t.hosts[0] && t.hosts[0].name);
                const r_ids = pr.filter(p => p.r_eventid !== '0').map(p => p.r_eventid);
                const r_evs = r_ids.length ? await zbx('event.get', { eventids: r_ids, output: ['eventid', 'clock'] }) : [];
                const r_map = {}; r_evs.forEach(e => r_map[e.eventid] = e.clock);
                problems = pr.map(p => {
                    const rc = r_map[p.r_eventid];
                    return { event_id: p.eventid, time: fmt(p.clock), recovery_time: rc ? fmt(rc) : '--', status: rc ? 'RESOLVED' : 'PROBLEM', host: hostOf[p.objectid] || 'System', severity: sev[+p.severity] || 'Warning', name: p.name, duration: rc ? Math.round((rc - p.clock) / 60) + 'm' : 'Live' };
                });
            } catch (e) { errors.push('Zabbix (problem): ' + e.message); }
        })(),
        (async () => {
            try {
                const al = await zbx('alert.get', { output: ['clock', 'sendto', 'subject', 'status'], selectMediatypes: ['name'], sortfield: ['clock'], sortorder: 'DESC', limit: 15 });
                actionsLog = al.map(a => ({ time: fmt(a.clock), action: 'Zabbix Alert', media: a.mediatypes && a.mediatypes[0] ? a.mediatypes[0].name : '-', recipient: a.sendto || '-', message: a.subject || 'Alert', status: a.status === '1' ? 'Sent' : 'Failed' }));
            } catch (e) { errors.push('Zabbix (alert): ' + e.message); }
        })()
    ]);
    res.json({ metrics, problems, actionsLog, errors });
});
module.exports = router;
