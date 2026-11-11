const express = require('express'); const router = express.Router(); const { Client } = require('ssh2'); const names = require('./names');
const SAMPLE = 2; // giây giữa 2 lần đọc bộ đếm (làm trong CÙNG một phiên SSH nên không phụ thuộc chu kỳ làm mới của trình duyệt)

const run = cmd => new Promise((resolve, reject) => {
    const c = new Client(), timer = setTimeout(() => { c.end(); reject(new Error('SSH quá thời gian chờ')); }, 20000);
    c.on('ready', () => c.exec(cmd, (e, s) => { if (e) { clearTimeout(timer); c.end(); return reject(e); } let d = ''; s.on('data', x => d += x).on('close', () => { clearTimeout(timer); c.end(); resolve(d); }); }))
     .on('error', e => { clearTimeout(timer); reject(e); })
     .connect({ host: process.env.PFSENSE_SSH_HOST, port: +process.env.PFSENSE_SSH_PORT || 22, username: process.env.PFSENSE_SSH_USER, password: process.env.PFSENSE_SSH_PASS, readyTimeout: 8000 });
});

// Đọc bộ đếm theo tên cột của header (không phụ thuộc số cột), chỉ lấy dòng <Link#n> của từng interface
function parseNet(txt) {
    const lines = txt.trim().split('\n'), hdr = lines[0].trim().split(/\s+/), fe = k => hdr.length - hdr.indexOf(k), out = {};
    lines.slice(1).forEach(l => {
        const c = l.trim().split(/\s+/); if (!(c[2] || '').startsWith('<Link')) return;
        const g = k => Number(c[c.length - fe(k)]); out[c[0].replace('*', '')] = { rx: g('Ibytes'), tx: g('Obytes'), ie: g('Ierrs'), oe: g('Oerrs') };
    });
    return out;
}

router.get('/pfsense', async (req, res) => {
    const errors = []; let wan = '?', list = [], leases = [];
    try {
        const raw = await run(
            `/sbin/route -n get default | /usr/bin/awk '/interface:/{print $2}'; echo "@@1"; /usr/bin/netstat -ibn; echo "@@2"; sleep ${SAMPLE}; /usr/bin/netstat -ibn; echo "@@3"; ` +
            `/sbin/ifconfig -a | /usr/bin/awk '/^[a-z0-9_.]+:/{i=$1} /description:/{sub(/^[ \\t]*description: /,""); print i "|" $0}'; echo "@@4"; /usr/sbin/arp -an; echo "@@5"; ` +
            `/usr/bin/tail -c 300000 /var/dhcpd/var/db/dhcpd.leases 2>/dev/null; echo "@@6"; /usr/bin/tail -c 300000 /var/db/kea/kea-leases4.csv 2>/dev/null`);
        const P = raw.split(/@@\d\n?/); wan = (P[0] || '').trim();
        const a = parseNet(P[1] || ''), b = parseNet(P[2] || ''), desc = {};
        (P[3] || '').trim().split('\n').forEach(l => { const [n, d] = l.split('|'); if (n && d) desc[n.replace(':', '')] = d.trim(); });
        const mbps = (x, y) => Math.max(0, (y - x) * 8 / SAMPLE / 1e6);
        list = Object.keys(b).filter(n => !/^(lo|pflog|pfsync|enc)\d*$/.test(n) && a[n]).map(n => ({
            name: n, label: desc[n] || '', isWan: n === wan, in_mbps: mbps(a[n].rx, b[n].rx), out_mbps: mbps(a[n].tx, b[n].tx),
            rx_gb: b[n].rx / 1073741824, tx_gb: b[n].tx / 1073741824, errors: b[n].ie + b[n].oe
        }));
        if (!list.some(i => i.isWan)) errors.push(`pfSense: không tìm thấy bộ đếm của cổng WAN "${wan}". Các interface đọc được: ${Object.keys(b).join(', ')}`);

        // Tên máy từ DHCP: ISC dhcpd (bản ghi sau ghi đè bản ghi trước) và Kea
        const byMac = {};
        (P[5] || '').split(/\n(?=lease )/).forEach(blk => {
            const mac = (blk.match(/hardware ethernet ([0-9a-f:]+)/i) || [])[1]; if (!mac) return;
            byMac[mac.toLowerCase()] = (blk.match(/client-hostname "([^"]*)"/) || [])[1];
        });
        (P[6] || '').trim().split('\n').forEach(l => { const c = l.split(','); if (/^\d+\.\d+\.\d+\.\d+$/.test(c[0]) && c[1] && c[8]) byMac[c[1].toLowerCase()] = c[8]; });

        const found = [];
        (P[4] || '').trim().split('\n').forEach(l => {
            const m = l.match(/\((.*?)\) at ([0-9a-f:]+) on (\S+)/i); if (!m) return;
            found.push({ ip: m[1], mac: m[2], dhcp: byMac[m[2].toLowerCase()], self: /permanent/.test(l) ? 'pfSense (' + (desc[m[3]] || m[3]) + ')' : null });
        });
        names.refresh(found.filter(f => !f.self)).catch(() => {});   // tra tên chạy nền, kết quả lưu đệm cho lần làm mới sau
        leases = found.map(f => { const n = f.self ? { name: f.self, src: 'pfSense' } : names.lookup(f.ip); return { ip: f.ip, mac: f.mac, hostname: n && n.name ? n.name : '(chưa xác định)', status: n && n.name ? n.src : 'ARP' }; });
    } catch (e) { errors.push('pfSense (SSH): ' + e.message); }
    const sel = list.find(i => i.name === req.query.if) || list.find(i => i.isWan);   // cổng đang theo dõi (mặc định là WAN)
    res.json({ interfaces: { wan: { name: sel ? sel.name : wan, in_speed: sel ? sel.in_mbps.toFixed(3) : '0.000', out_speed: sel ? sel.out_mbps.toFixed(3) : '0.000' }, list }, subnets: [], dhcpLeases: leases, errors });
});

// Current pfSense ARP/DHCP bindings for Computer Management. IP addresses can
// change, so callers correlate the current lease by hostname/MAC as well.
router.get('/computer-leases', async (req, res) => {
    try {
        const raw = await run(`/usr/sbin/arp -an; echo "@@1"; /usr/bin/tail -c 300000 /var/dhcpd/var/db/dhcpd.leases 2>/dev/null; echo "@@2"; /usr/bin/tail -c 300000 /var/db/kea/kea-leases4.csv 2>/dev/null`);
        const P = raw.split(/@@\d\n?/), byMac = {}, current = new Map();
        const normMac = value => String(value || '').replace(/-/g, ':').toLowerCase();
        (P[1] || '').split(/\n(?=lease )/).forEach(blk => {
            const ip = (blk.match(/^lease\s+(\d+\.\d+\.\d+\.\d+)/) || [])[1];
            const mac = normMac((blk.match(/hardware ethernet ([0-9a-f:-]+)/i) || [])[1]);
            if (!mac) return;
            const hostname = (blk.match(/client-hostname "([^"]*)"/) || [])[1];
            if (hostname) byMac[mac] = hostname;
            if (ip && /binding state active/i.test(blk)) {
                const starts = (blk.match(/starts\s+\d+\s+([\d/]+\s+[\d:]+)/i) || [])[1];
                current.set(mac, { ip, mac, hostname: hostname || '', expiresAt: Date.parse((blk.match(/ends\s+\d+\s+([\d/]+\s+[\d:]+)/i) || [])[1] || '') || 0, startedAt: Date.parse(starts || '') || 0 });
            }
        });
        (P[2] || '').trim().split('\n').forEach(line => {
            const c = line.split(',');
            const ip = String(c[0] || '').replace(/^"|"$/g, ''), mac = normMac(c[1]), hostname = String(c[8] || '').replace(/^"|"$/g, '');
            if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !mac) return;
            if (hostname) byMac[mac] = hostname;
            const expiresAt = Number(c[4]) * 1000, state = Number(c[9]);
            if (hostname && expiresAt > Date.now() && (!Number.isFinite(state) || state === 0)) current.set(mac, { ip, mac, hostname, expiresAt });
        });
        const leasesByMac = new Map(current);
        (P[0] || '').trim().split('\n').forEach(line => {
            const m = line.match(/\((.*?)\) at ([0-9a-f:]+) on (\S+)/i);
            if (m && !/permanent/i.test(line)) {
                const mac = normMac(m[2]);
                leasesByMac.set(mac, { ...(leasesByMac.get(mac) || {}), ip: m[1], mac, hostname: byMac[mac] || leasesByMac.get(mac)?.hostname || '', arpSeen: true });
            }
        });
        res.json({ leases: [...leasesByMac.values()] });
    } catch (e) {
        res.status(502).json({ success: false, error: 'Không đọc được ARP/DHCP từ pfSense: ' + e.message });
    }
});
module.exports = router;
