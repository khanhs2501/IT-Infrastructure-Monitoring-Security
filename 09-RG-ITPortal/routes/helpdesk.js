// Phiếu hỗ trợ: gắn theo TÊN ĐĂNG NHẬP, có mô tả, mức ưu tiên, trạng thái (Open → InProgress → Resolved / Cancelled) và trao đổi qua lại
const express = require('express'); const router = express.Router(); const perm = require('./perm');
const TYPES = ['Sự cố', 'Yêu cầu cấp phát/cài đặt', 'Quên mật khẩu / Mở khóa tài khoản', 'Quyền truy cập thư mục', 'Khác'], PRIOS = ['Low', 'Normal', 'High', 'Urgent'];
module.exports = function (db) {
    const all = (s, p = []) => new Promise(ok => db.all(s, p, (e, rows) => ok(rows || [])));
    const exec = (s, p = []) => new Promise(ok => db.run(s, p, function (e) { ok({ err: e, id: this && this.lastID, changes: this && this.changes }); }));
    db.serialize(() => {
        ['username TEXT', 'description TEXT', 'assignee TEXT', 'resolution TEXT', 'updated_at DATETIME', 'asset_id INTEGER', 'external_source TEXT', 'external_id TEXT', 'first_response_at TEXT', 'resolved_at TEXT', 'response_due_at TEXT', 'resolution_due_at TEXT'].forEach(c => db.run(`ALTER TABLE tickets ADD COLUMN ${c}`, () => {}));
        db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_external_event ON tickets(external_source, external_id) WHERE external_source IS NOT NULL AND external_id IS NOT NULL', () => {});
        db.run('CREATE TABLE IF NOT EXISTS ticket_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, username TEXT, fullname TEXT, role TEXT, body TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    });
    const me = req => req.session.user, seeAll = req => me(req).role !== 'Employee', staff = req => perm.can(me(req), 'helpdesk', 'manage');
    const owns = (t, u) => t.username ? t.username.toLowerCase() === String(u.username).toLowerCase() : t.requester === u.fullname;   // phiếu cũ chưa có username thì khớp theo tên hiển thị
    const Q = "SELECT *, datetime(created_at,'localtime') AS local_created, datetime(updated_at,'localtime') AS local_updated";
    const get = async (id, req) => { const t = (await all(`${Q} FROM tickets WHERE id = ?`, [id]))[0]; return t && (seeAll(req) || owns(t, me(req))) ? t : null; };
    const touch = id => exec('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
    const miss = res => res.status(404).json({ success: false, error: 'Không tìm thấy phiếu' });
    const sqlDate = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    const SLA_HOURS = { Low: { response: 16, resolution: 72 }, Normal: { response: 8, resolution: 24 }, High: { response: 4, resolution: 8 }, Urgent: { response: 1, resolution: 4 } };
    const slaDue = priority => { const v = SLA_HOURS[priority] || SLA_HOURS.Normal, now = Date.now(); return { response: sqlDate(now + v.response * 3600000), resolution: sqlDate(now + v.resolution * 3600000) }; };

    router.get('/tickets', async (req, res) => {
        const rows = await all(`${Q}, (SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id = tickets.id) AS comments FROM tickets ORDER BY id DESC LIMIT 500`);
        res.json(seeAll(req) ? rows : rows.filter(t => owns(t, me(req))));
    });
    router.post('/tickets', async (req, res) => {
        const u = me(req), body = req.body || {};
        const type = typeof body.type === 'string' ? body.type : '';
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const description = typeof body.description === 'string' ? body.description : '';
        const priority = typeof body.priority === 'string' ? body.priority : 'Normal';
        if (!TYPES.includes(type) || title.length < 5 || title.length > 200 || description.length > 2000) return res.status(400).json({ success: false, error: 'Loại phiếu không hợp lệ; tiêu đề phải từ 5–200 ký tự và mô tả tối đa 2000 ký tự.' });
        const prio = PRIOS.includes(priority) ? priority : 'Normal', due = slaDue(prio), assetId = Number(body.asset_id) || null;
        if (assetId) { const ar = await all('SELECT id FROM assets WHERE id=?', [assetId]); if (!ar.length) return res.status(400).json({ success: false, error: 'Tài sản liên kết không tồn tại' }); }
        const r = await exec('INSERT INTO tickets (requester, username, type, title, description, priority, asset_id, response_due_at, resolution_due_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)', [u.fullname, u.username, type, title, description, prio, assetId, due.response, due.resolution]);
        res.status(r.err ? 500 : 201).json({ success: !r.err, id: r.id, error: r.err ? 'Không tạo được phiếu' : undefined });
    });
    // Tạo incident từ Zabbix/Wazuh/pfSense mà không tạo trùng theo external source + ID.
    router.post('/tickets/from-alert', async (req, res) => {
        if (!staff(req)) return res.status(403).json({ success: false, error: 'Chỉ IT có quyền xử lý mới được chuyển alert thành incident' });
        const b = req.body || {}, source = ['Zabbix', 'Wazuh', 'pfSense', 'Manual'].includes(b.source) ? b.source : 'Manual';
        const externalId = typeof b.external_id === 'string' ? b.external_id.trim().slice(0, 180) || null : null;
        const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
        const description = typeof b.description === 'string' ? b.description.trim().slice(0, 2000) : '';
        const priority = PRIOS.includes(b.priority) ? b.priority : 'High';
        if (title.length < 5) return res.status(400).json({ success: false, error: 'Tiêu đề incident tối thiểu 5 ký tự' });
        if (externalId) {
            const existing = await all('SELECT id,status FROM tickets WHERE external_source=? AND external_id=? LIMIT 1', [source, externalId]);
            if (existing.length) return res.json({ success: true, duplicate: true, id: existing[0].id, status: existing[0].status });
        }
        const due = slaDue(priority);
        let assetId = Number(b.asset_id) || null;
        const assetName = String(b.asset_name || '').trim().slice(0, 150);
        if (assetId && !(await all('SELECT id FROM assets WHERE id=?', [assetId])).length) return res.status(400).json({ success: false, error: 'Tài sản liên kết không tồn tại' });
        if (!assetId && assetName) {
            const matches = await all('SELECT id FROM assets WHERE lower(hostname)=lower(?) OR lower(name)=lower(?) OR lower(asset_tag)=lower(?) ORDER BY CASE WHEN lower(hostname)=lower(?) THEN 0 ELSE 1 END LIMIT 1', [assetName, assetName, assetName, assetName]);
            if (matches.length) assetId = matches[0].id;
        }
        const r = await exec(`INSERT INTO tickets (requester,username,type,title,description,priority,status,asset_id,external_source,external_id,response_due_at,resolution_due_at,updated_at)
            VALUES (?,?,?,?,?,?,'Open',?,?,?,?,?,CURRENT_TIMESTAMP)`, ['System Integration', 'system', 'Sự cố', title, description, priority, assetId, source, externalId, due.response, due.resolution]);
        if (r.err) return res.status(500).json({ success: false, error: 'Không tạo được incident (có thể đã tồn tại)' });
        res.status(201).json({ success: true, id: r.id, duplicate: false });
    });

    router.get('/tickets/:id', async (req, res) => {
        const t = await get(req.params.id, req); if (!t) return miss(res);
        res.json({ ticket: t, comments: await all("SELECT *, datetime(created_at,'localtime') AS local_created FROM ticket_comments WHERE ticket_id = ? ORDER BY id", [t.id]) });
    });
    router.post('/tickets/:id/comments', async (req, res) => {
        const t = await get(req.params.id, req); if (!t) return miss(res);
        const u = me(req), body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
        if (!body || body.length > 1500) return res.status(400).json({ success: false, error: 'Nội dung bình luận bắt buộc, tối đa 1500 ký tự.' });
        if (!['Open', 'InProgress'].includes(t.status)) return res.json({ success: false, error: 'Phiếu đã đóng' });
        await exec('INSERT INTO ticket_comments (ticket_id, username, fullname, role, body) VALUES (?,?,?,?,?)', [t.id, u.username, u.fullname, staff(req) ? 'IT' : 'User', body]); await touch(t.id);
        res.json({ success: true });
    });
    router.post('/tickets/:id/take', async (req, res) => {   // IT nhận xử lý
        const t = await get(req.params.id, req); if (!t) return miss(res); if (!staff(req)) return res.status(403).json({ success: false, error: 'Không đủ quyền hạn' });
        if (!['Open', 'InProgress'].includes(t.status)) return res.json({ success: false, error: 'Phiếu đã đóng' });
        await exec("UPDATE tickets SET status = 'InProgress', assignee = ?, first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ?", [me(req).fullname, t.id]); res.json({ success: true });
    });
    router.post('/tickets/:id/resolve', async (req, res) => {   // IT đóng phiếu: bắt buộc ghi kết quả (phiếu mật khẩu phải ghi rõ cách xác minh)
        const t = await get(req.params.id, req); if (!t) return miss(res); if (!staff(req)) return res.status(403).json({ success: false, error: 'Không đủ quyền hạn' });
        const note = String(req.body.note || '').trim().slice(0, 500), pw = /mật khẩu/i.test(t.type);
        if (note.length < (pw ? 15 : 5)) return res.json({ success: false, error: pw ? 'Phiếu mật khẩu: ghi rõ đã xác minh danh tính bằng cách nào (tối thiểu 15 ký tự)' : 'Cần ghi kết quả xử lý (tối thiểu 5 ký tự)' });
        if (!['Open', 'InProgress'].includes(t.status)) return res.json({ success: false, error: 'Phiếu đã đóng' });
        await exec("UPDATE tickets SET status = 'Resolved', resolution = ?, resolved_at = CURRENT_TIMESTAMP, first_response_at = COALESCE(first_response_at, CURRENT_TIMESTAMP), assignee = COALESCE(assignee, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?", [note, me(req).fullname, t.id]); res.json({ success: true });
    });
    router.post('/tickets/:id/cancel', async (req, res) => {   // người gửi tự hủy phiếu chưa được nhận xử lý
        const t = await get(req.params.id, req); if (!t) return miss(res);
        if (!owns(t, me(req)) || t.status !== 'Open') return res.json({ success: false, error: 'Chỉ người gửi hủy được phiếu chưa được nhận xử lý' });
        await exec("UPDATE tickets SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [t.id]); res.json({ success: true });
    });
    return router;
};
