const express = require('express');
const axios = require('axios');
const router = express.Router();

const ASSET_TYPES = ['Server', 'Network', 'Container', 'Cloud', 'Other'];
const CRITICALITIES = ['Critical', 'High', 'Medium', 'Low'];
const ASSET_STATUSES = ['Active', 'Maintenance', 'Retired'];
const clean = (v, max = 250) => String(v ?? '').trim().slice(0, max);
const validIPv4 = v => !v || (/^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split('.').every(x => +x >= 0 && +x <= 255));
const sendErr = (res, status, error) => res.status(status).json({ success: false, error });

module.exports = function (db) {
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows || [])));
  const one = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (e, row) => e ? reject(e) : resolve(row)));
  const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (e) { e ? reject(e) : resolve({ id: this.lastID, changes: this.changes }); }));

  // Upgrade legacy DBs too: the original Portal database used assets(name,type,ip_address,os,status).
  // CREATE TABLE IF NOT EXISTS alone cannot add columns to an existing SQLite table.
  const migrationReady = (async () => {
    await run(`CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_tag TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      asset_type TEXT NOT NULL DEFAULT 'Server',
      hostname TEXT,
      ip_address TEXT,
      os TEXT,
      environment TEXT DEFAULT 'Lab',
      criticality TEXT DEFAULT 'Medium',
      owner TEXT,
      status TEXT DEFAULT 'Active',
      source TEXT DEFAULT 'Manual',
      monitoring_state TEXT,
      notes TEXT,
      last_sync_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    let cols = await all('PRAGMA table_info(assets)');
    const existing = new Set(cols.map(c => c.name));
    const wasLegacy = !existing.has('asset_tag');
    const add = [
      ['asset_tag', 'TEXT'], ['name', 'TEXT'], ['asset_type', "TEXT DEFAULT 'Server'"],
      ['hostname', 'TEXT'], ['ip_address', 'TEXT'], ['os', 'TEXT'],
      ['environment', "TEXT DEFAULT 'Lab'"], ['criticality', "TEXT DEFAULT 'Medium'"],
      ['owner', 'TEXT'], ['status', "TEXT DEFAULT 'Active'"], ['source', "TEXT DEFAULT 'Manual'"],
      ['monitoring_state', 'TEXT'], ['notes', 'TEXT'], ['last_sync_at', 'TEXT'],
      ['created_at', 'TEXT'], ['updated_at', 'TEXT']
    ];
    const added = new Set();
    for (const [name, definition] of add) {
      if (!existing.has(name)) {
        await run(`ALTER TABLE assets ADD COLUMN ${name} ${definition}`);
        added.add(name);
      }
    }
    cols = await all('PRAGMA table_info(assets)');
    const migratedCols = new Set(cols.map(c => c.name));

    if (wasLegacy && migratedCols.has('type')) {
      await run(`UPDATE assets SET asset_type = CASE
        WHEN lower(COALESCE(type,'')) LIKE '%network%' OR lower(COALESCE(type,'')) LIKE '%firewall%' OR lower(COALESCE(type,'')) LIKE '%pfsense%' THEN 'Network'
        WHEN lower(COALESCE(type,'')) LIKE '%container%' OR lower(COALESCE(type,'')) LIKE '%docker%' THEN 'Container'
        WHEN lower(COALESCE(type,'')) LIKE '%cloud%' THEN 'Cloud'
        WHEN lower(COALESCE(type,'')) LIKE '%other%' THEN 'Other'
        ELSE 'Server' END`);
    }
    if (added.has('source')) await run("UPDATE assets SET source='Legacy' WHERE source IS NULL OR source='' OR source='Manual'");
    await run("UPDATE assets SET asset_tag='AST-LEGACY-' || printf('%05d', id) WHERE asset_tag IS NULL OR trim(asset_tag)=''");
    // Repair duplicate tags from an older/incomplete schema before creating the unique index.
    await run(`UPDATE assets AS a SET asset_tag='AST-MIGRATED-' || printf('%05d', a.id)
      WHERE EXISTS (SELECT 1 FROM assets b WHERE b.asset_tag=a.asset_tag AND b.id<>a.id)`);
    await run("UPDATE assets SET name=COALESCE(NULLIF(trim(name),''), NULLIF(trim(hostname),''), asset_tag)");
    await run("UPDATE assets SET environment=COALESCE(NULLIF(environment,''),'Lab'), criticality=COALESCE(NULLIF(criticality,''),'Medium'), source=COALESCE(NULLIF(source,''),'Manual'), created_at=COALESCE(created_at,CURRENT_TIMESTAMP), updated_at=COALESCE(updated_at,CURRENT_TIMESTAMP)");
    if (wasLegacy) {
      await run(`UPDATE assets SET status=CASE
        WHEN lower(COALESCE(status,'')) IN ('retired','decommissioned','removed') THEN 'Retired'
        WHEN lower(COALESCE(status,'')) IN ('maintenance','maint') THEN 'Maintenance'
        ELSE 'Active' END`);
    }
    await run('CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_asset_tag_unique ON assets(asset_tag)');
    await run('CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name)');
    await run('CREATE INDEX IF NOT EXISTS idx_assets_ip ON assets(ip_address)');
  })();

  // Đánh dấu đã xử lý để lỗi migration (DB khóa/đóng sớm) không thành unhandledRejection làm sập Node; lỗi vẫn báo qua từng request.
  migrationReady.catch(e => console.error('[assets] Migration thất bại:', e.message));
  router.ready = migrationReady;

  router.use((req, res, next) => {
    migrationReady.then(() => next()).catch(e => {
      console.error('[assets] Database migration failed:', e.message);
      res.status(500).json({ success: false, error: 'Không khởi tạo được danh mục tài sản. Kiểm tra log Portal và sao lưu database trước khi sửa.' });
    });
  });

  router.get('/', async (req, res) => {
    try {
      const q = clean(req.query.q, 100), type = clean(req.query.type, 30), status = clean(req.query.status, 30);
      const where = [], params = [];
      if (q) { where.push('(asset_tag LIKE ? OR name LIKE ? OR hostname LIKE ? OR ip_address LIKE ? OR owner LIKE ?)'); params.push(...Array(5).fill(`%${q}%`)); }
      if (ASSET_TYPES.includes(type)) { where.push('asset_type = ?'); params.push(type); }
      if (ASSET_STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
      const rows = await all(`SELECT * FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE criticality WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END, name COLLATE NOCASE LIMIT 1000`, params);
      const summary = await one(`SELECT COUNT(*) total, SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END) active, SUM(CASE WHEN criticality='Critical' AND status!='Retired' THEN 1 ELSE 0 END) critical, MAX(last_sync_at) last_sync_at FROM assets`);
      res.json({ assets: rows, summary: { total: summary?.total || 0, active: summary?.active || 0, critical: summary?.critical || 0, last_sync_at: summary?.last_sync_at || null } });
    } catch (e) {
      console.error('[assets] GET failed:', e.message);
      res.status(500).json({ error: 'Không tải được danh mục tài sản. Hãy kiểm tra log Portal; dữ liệu cũ được giữ nguyên.' });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const b = req.body || {}, name = clean(b.name, 150), tag = clean(b.asset_tag, 80) || `AST-${Date.now()}`;
      const type = ASSET_TYPES.includes(b.asset_type) ? b.asset_type : 'Server';
      const criticality = CRITICALITIES.includes(b.criticality) ? b.criticality : 'Medium';
      const status = ASSET_STATUSES.includes(b.status) ? b.status : 'Active';
      const ip = clean(b.ip_address, 45);
      if (!name) return sendErr(res, 400, 'Tên tài sản là bắt buộc');
      if (!/^[\w.\-:]{2,80}$/.test(tag)) return sendErr(res, 400, 'Asset Tag chỉ được dùng chữ, số, dấu chấm, gạch ngang hoặc hai chấm');
      if (!validIPv4(ip)) return sendErr(res, 400, 'Địa chỉ IPv4 không hợp lệ');
      const result = await run(`INSERT INTO assets (asset_tag,name,asset_type,hostname,ip_address,os,environment,criticality,owner,status,source,notes,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`, [tag, name, type, clean(b.hostname, 150) || null, ip || null, clean(b.os, 150) || null, clean(b.environment, 80) || 'Lab', criticality, clean(b.owner, 150) || null, status, 'Manual', clean(b.notes, 2000) || null]);
      res.status(201).json({ success: true, id: result.id });
    } catch (e) {
      res.status(/UNIQUE/i.test(e.message) ? 409 : 500).json({ success: false, error: /UNIQUE/i.test(e.message) ? 'Asset Tag đã tồn tại' : 'Không thể tạo tài sản' });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const id = Number(req.params.id), b = req.body || {};
      if (!Number.isInteger(id) || id < 1) return sendErr(res, 400, 'ID không hợp lệ');
      const old = await one('SELECT * FROM assets WHERE id=?', [id]); if (!old) return sendErr(res, 404, 'Không tìm thấy tài sản');
      const name = clean(b.name ?? old.name, 150), tag = clean(b.asset_tag ?? old.asset_tag, 80), ip = clean(b.ip_address ?? old.ip_address, 45);
      const type = ASSET_TYPES.includes(b.asset_type) ? b.asset_type : old.asset_type;
      const criticality = CRITICALITIES.includes(b.criticality) ? b.criticality : old.criticality;
      const status = ASSET_STATUSES.includes(b.status) ? b.status : old.status;
      if (!name || !/^[\w.\-:]{2,80}$/.test(tag) || !validIPv4(ip)) return sendErr(res, 400, 'Tên, Asset Tag hoặc địa chỉ IPv4 không hợp lệ');
      await run(`UPDATE assets SET asset_tag=?,name=?,asset_type=?,hostname=?,ip_address=?,os=?,environment=?,criticality=?,owner=?,status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [tag, name, type, clean(b.hostname ?? old.hostname, 150) || null, ip || null, clean(b.os ?? old.os, 150) || null, clean(b.environment ?? old.environment, 80) || 'Lab', criticality, clean(b.owner ?? old.owner, 150) || null, status, clean(b.notes ?? old.notes, 2000) || null, id]);
      res.json({ success: true });
    } catch (e) { res.status(/UNIQUE/i.test(e.message) ? 409 : 500).json({ success: false, error: /UNIQUE/i.test(e.message) ? 'Asset Tag đã tồn tại' : 'Không thể cập nhật tài sản' }); }
  });

  router.delete('/:id', async (req, res) => {
    if (req.session.user?.role !== 'Super-Admin') return sendErr(res, 403, 'Chỉ Super-Admin được xóa tài sản');
    try {
      const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return sendErr(res, 400, 'ID không hợp lệ');
      const asset = await one('SELECT id FROM assets WHERE id=?', [id]);
      if (!asset) return sendErr(res, 404, 'Không tìm thấy tài sản');
      const refs = await Promise.all([
        one('SELECT COUNT(*) n FROM tickets WHERE asset_id=?', [id]),
        one('SELECT COUNT(*) n FROM vulnerability_findings WHERE asset_id=?', [id]),
        one('SELECT COUNT(*) n FROM patch_jobs WHERE asset_id=?', [id])
      ]);
      if (refs.some(x => Number(x?.n || 0) > 0)) return sendErr(res, 409, 'Tài sản đang được ticket/lỗ hổng/tác vụ bản vá tham chiếu. Hãy đổi trạng thái sang Retired để giữ lịch sử.');
      await run('DELETE FROM assets WHERE id=?', [id]); res.json({ success: true });
    } catch (e) { console.error('[assets] DELETE failed:', e.message); res.status(500).json({ success: false, error: 'Không thể xóa tài sản' }); }
  });

  // Sync only the approved server names. Error messages are sanitized; credentials are never echoed.
  router.post('/sync-zabbix', async (req, res) => {
    const api = process.env.ZABBIX_URL, token = process.env.ZABBIX_TOKEN;
    if (!api || !token) return res.status(503).json({ success: false, error: 'Thiếu ZABBIX_URL hoặc ZABBIX_TOKEN trong .env của tiến trình Portal; khởi động lại Portal sau khi cập nhật .env.' });
    try {
      const body = { jsonrpc: '2.0', method: 'host.get', params: { output: ['hostid', 'host', 'name', 'status', 'description'], selectInterfaces: ['ip', 'main'] }, id: 1 };
      let response;
      try {
        response = await axios.post(api, body, { headers: { 'Content-Type': 'application/json-rpc', Authorization: 'Bearer ' + token }, timeout: 10000 });
      } catch (e) {
        if (![400, 401, 403].includes(e.response?.status)) throw e;
        response = { data: { error: { message: `HTTP ${e.response.status}`, data: 'Zabbix từ chối Authorization Bearer' } } };
      }
      if (response.data?.error) {
        const firstError = response.data.error;
        response = await axios.post(api, { ...body, auth: token }, { headers: { 'Content-Type': 'application/json-rpc' }, timeout: 10000 });
        if (response.data?.error) {
          const ze = response.data.error;
          const detail = clean(ze.data || ze.message || firstError.data || firstError.message || 'API request failed', 240);
          const err = new Error('Zabbix API: ' + detail);
          err.statusCode = /authori|permission|access denied/i.test(detail) ? 403 : 502;
          throw err;
        }
      }
      const allHosts = response.data?.result || [];
      const allowedNames = String(process.env.ASSET_ZABBIX_HOSTS || 'ROYAL01,LINUX01').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      const hosts = allHosts.filter(h => [h.host, h.name].some(n => n && allowedNames.includes(String(n).toLowerCase())));
      if (!hosts.length) {
        return res.json({ success: true, discovered: 0, totalHosts: allHosts.length, scope: allowedNames, added: 0, updated: 0, message: allHosts.length ? `API OK, nhưng không tìm thấy host khớp phạm vi: ${allowedNames.join(', ')}. Kiểm tra tên host trên Zabbix hoặc ASSET_ZABBIX_HOSTS.` : 'API trả về 0 host; kiểm tra quyền đọc Host groups/Hosts của tài khoản API.' });
      }
      let added = 0, updated = 0;
      for (const h of hosts) {
        const hostname = clean(h.host, 150); if (!hostname) continue;
        const interfaces = Array.isArray(h.interfaces) ? h.interfaces : [];
        const iface = interfaces.find(x => String(x.main) === '1') || interfaces[0] || {};
        const ip = validIPv4(iface.ip || '') ? (iface.ip || null) : null;
        const tag = `ZBX-${h.hostid}`;
        const existing = await one('SELECT * FROM assets WHERE asset_tag=? OR lower(hostname)=lower(?) OR lower(name)=lower(?) ORDER BY CASE WHEN asset_tag=? THEN 0 ELSE 1 END LIMIT 1', [tag, hostname, clean(h.name, 150) || hostname, tag]);
        const monitorState = String(h.status) === '0' ? 'Enabled in Zabbix' : 'Disabled in Zabbix';
        if (existing) {
          await run(`UPDATE assets SET name=CASE WHEN source='Zabbix' THEN ? ELSE name END,hostname=?,ip_address=?,monitoring_state=?,last_sync_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
            [clean(h.name, 150) || hostname, hostname, ip, monitorState, existing.id]);
          updated++;
        } else {
          await run(`INSERT INTO assets (asset_tag,name,asset_type,hostname,ip_address,environment,criticality,status,source,monitoring_state,last_sync_at,updated_at)
            VALUES (?,?,?,?,?,'Lab','Medium','Active','Zabbix',?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            [tag, clean(h.name, 150) || hostname, 'Server', hostname, ip, monitorState]);
          added++;
        }
      }
      res.json({ success: true, discovered: hosts.length, totalHosts: allHosts.length, scope: allowedNames, added, updated });
    } catch (e) {
      const status = e.statusCode || (e.response?.status === 401 || e.response?.status === 403 ? 403 : 502);
      let detail = e.message || 'Không rõ nguyên nhân';
      if (e.code === 'ECONNREFUSED') detail = 'Không kết nối được Zabbix API (ECONNREFUSED); kiểm tra URL, port và mạng từ máy Portal.';
      else if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED') detail = 'Hết thời gian chờ Zabbix API; kiểm tra endpoint và firewall.';
      else if (e.response?.status) detail = `Zabbix API trả HTTP ${e.response.status}; kiểm tra API endpoint và quyền của tài khoản token.`;
      console.error('[assets] Zabbix host sync failed:', detail);
      res.status(status).json({ success: false, error: `Không đồng bộ được host từ Zabbix: ${clean(detail, 240)}` });
    }
  });
  return router;
};
