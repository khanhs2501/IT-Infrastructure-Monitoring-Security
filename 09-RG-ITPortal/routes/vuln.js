const express = require('express');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const router = express.Router();
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];
const FINDING_STATUS = ['Open', 'InProgress', 'Mitigated', 'Accepted'];
const PATCH_STATUS = ['Planned', 'InProgress', 'Installed', 'Failed', 'Deferred'];
const clean = (v, max = 500) => String(v ?? '').trim().slice(0, max);
// Lab thường dùng chứng chỉ tự ký; bật INDEXER_TLS_REJECT_UNAUTHORIZED=true khi CA/certificate đã tin cậy.
const agent = new https.Agent({ rejectUnauthorized: process.env.INDEXER_TLS_REJECT_UNAUTHORIZED === 'true' });

module.exports = function (db) {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS vulnerability_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, finding_key TEXT NOT NULL UNIQUE,
      asset_id INTEGER, asset_name TEXT, cve TEXT, title TEXT NOT NULL, package_name TEXT,
      installed_version TEXT, fixed_version TEXT, severity TEXT DEFAULT 'Medium', score REAL,
      status TEXT DEFAULT 'Open', source TEXT DEFAULT 'Manual', reference TEXT,
      detected_at TEXT DEFAULT CURRENT_TIMESTAMP, last_seen TEXT, due_date TEXT,
      assigned_to TEXT, remediation TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS patch_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id INTEGER, asset_name TEXT, finding_id INTEGER,
      title TEXT NOT NULL, patch_ref TEXT, patch_type TEXT DEFAULT 'Other', status TEXT DEFAULT 'Planned',
      planned_date TEXT, completed_at TEXT, assigned_to TEXT, notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_vuln_status_severity ON vulnerability_findings(status,severity)');
    db.run('CREATE INDEX IF NOT EXISTS idx_patch_status ON patch_jobs(status)');
  });
  const all = (sql, p = []) => new Promise((resolve, reject) => db.all(sql, p, (e, rows) => e ? reject(e) : resolve(rows || [])));
  const one = (sql, p = []) => new Promise((resolve, reject) => db.get(sql, p, (e, row) => e ? reject(e) : resolve(row)));
  const run = (sql, p = []) => new Promise((resolve, reject) => db.run(sql, p, function (e) { e ? reject(e) : resolve({ id: this.lastID, changes: this.changes }); }));
  const bad = (res, code, msg) => res.status(code).json({ success: false, error: msg });
  const assetFor = async id => id ? one('SELECT id,name,hostname FROM assets WHERE id=?', [id]) : null;

  router.get('/', async (req, res) => {
    try {
      const [findings, patches, summary] = await Promise.all([
        all(`SELECT v.*, a.asset_tag AS linked_asset_tag FROM vulnerability_findings v LEFT JOIN assets a ON a.id=v.asset_id ORDER BY CASE severity WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 WHEN 'Low' THEN 4 ELSE 5 END, detected_at DESC LIMIT 1000`),
        all('SELECT p.*, a.asset_tag AS linked_asset_tag FROM patch_jobs p LEFT JOIN assets a ON a.id=p.asset_id ORDER BY p.id DESC LIMIT 500'),
        one(`SELECT COUNT(*) total, SUM(CASE WHEN status='Open' THEN 1 ELSE 0 END) open, SUM(CASE WHEN status='InProgress' THEN 1 ELSE 0 END) in_progress, SUM(CASE WHEN severity='Critical' AND status IN ('Open','InProgress') THEN 1 ELSE 0 END) critical FROM vulnerability_findings`)
      ]);
      res.json({ findings, patches, summary: { total: summary?.total || 0, open: summary?.open || 0, in_progress: summary?.in_progress || 0, critical: summary?.critical || 0 }, wazuhConfigured: !!(process.env.INDEXER_URL && process.env.INDEXER_USER && process.env.INDEXER_PASS) });
    } catch (e) { res.status(500).json({ error: 'Không tải được dữ liệu lỗ hổng/bản vá' }); }
  });

  router.post('/findings', async (req, res) => {
    try {
      const b = req.body || {}, title = clean(b.title, 300), cve = clean(b.cve, 100).toUpperCase();
      if (!title) return bad(res, 400, 'Tiêu đề phát hiện là bắt buộc');
      const severity = SEVERITIES.includes(b.severity) ? b.severity : 'Medium';
      const status = FINDING_STATUS.includes(b.status) ? b.status : 'Open';
      const assetId = Number(b.asset_id) || null, asset = await assetFor(assetId);
      if (assetId && !asset) return bad(res, 400, 'Tài sản liên kết không tồn tại');
      const score = b.score === '' || b.score == null ? null : Number(b.score);
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > 10)) return bad(res, 400, 'CVSS score phải từ 0 đến 10');
      const key = 'manual:' + crypto.randomUUID();
      const r = await run(`INSERT INTO vulnerability_findings (finding_key,asset_id,asset_name,cve,title,package_name,installed_version,fixed_version,severity,score,status,source,reference,due_date,assigned_to,remediation,notes,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'Manual',?,?,?,?,?,CURRENT_TIMESTAMP)`, [key, assetId, asset?.name || clean(b.asset_name, 150) || null, cve || null, title, clean(b.package_name, 200) || null, clean(b.installed_version, 100) || null, clean(b.fixed_version, 100) || null, severity, score, status, clean(b.reference, 1000) || null, clean(b.due_date, 30) || null, clean(b.assigned_to, 150) || null, clean(b.remediation, 2000) || null, clean(b.notes, 2000) || null]);
      res.status(201).json({ success: true, id: r.id });
    } catch (e) { res.status(500).json({ success: false, error: 'Không thể lưu phát hiện lỗ hổng' }); }
  });

  router.put('/findings/:id', async (req, res) => {
    try {
      const id = Number(req.params.id), b = req.body || {}; if (!Number.isInteger(id) || id < 1) return bad(res, 400, 'ID không hợp lệ');
      const old = await one('SELECT * FROM vulnerability_findings WHERE id=?', [id]); if (!old) return bad(res, 404, 'Không tìm thấy phát hiện');
      const status = FINDING_STATUS.includes(b.status) ? b.status : old.status;
      const severity = SEVERITIES.includes(b.severity) ? b.severity : old.severity;
      await run('UPDATE vulnerability_findings SET status=?,severity=?,assigned_to=?,due_date=?,remediation=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, severity, clean(b.assigned_to ?? old.assigned_to, 150) || null, clean(b.due_date ?? old.due_date, 30) || null, clean(b.remediation ?? old.remediation, 2000) || null, clean(b.notes ?? old.notes, 2000) || null, id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: 'Không thể cập nhật phát hiện' }); }
  });

  router.delete('/findings/:id', async (req, res) => {
    if (req.session.user?.role !== 'Super-Admin') return bad(res, 403, 'Chỉ Super-Admin được xóa bản ghi phát hiện');
    try { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return bad(res, 400, 'ID không hợp lệ'); await run('DELETE FROM vulnerability_findings WHERE id=?', [id]); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, error: 'Không thể xóa phát hiện' }); }
  });

  router.post('/patches', async (req, res) => {
    try {
      const b = req.body || {}, title = clean(b.title, 300); if (!title) return bad(res, 400, 'Tên bản vá/tác vụ là bắt buộc');
      const assetId = Number(b.asset_id) || null, asset = await assetFor(assetId);
      if (assetId && !asset) return bad(res, 400, 'Tài sản liên kết không tồn tại');
      const status = PATCH_STATUS.includes(b.status) ? b.status : 'Planned';
      const type = ['Windows Update', 'Linux Package', 'Container Image', 'Other'].includes(b.patch_type) ? b.patch_type : 'Other';
      const findingId = Number(b.finding_id) || null;
      if (findingId && !(await one('SELECT id FROM vulnerability_findings WHERE id=?', [findingId]))) return bad(res, 400, 'Finding liên kết không tồn tại');
      const r = await run(`INSERT INTO patch_jobs (asset_id,asset_name,finding_id,title,patch_ref,patch_type,status,planned_date,assigned_to,notes,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`, [assetId, asset?.name || clean(b.asset_name, 150) || null, findingId, title, clean(b.patch_ref, 150) || null, type, status, clean(b.planned_date, 30) || null, clean(b.assigned_to, 150) || null, clean(b.notes, 2000) || null]);
      res.status(201).json({ success: true, id: r.id });
    } catch (e) { res.status(500).json({ success: false, error: 'Không thể tạo tác vụ bản vá' }); }
  });

  router.put('/patches/:id', async (req, res) => {
    try {
      const id = Number(req.params.id), b = req.body || {}; if (!Number.isInteger(id) || id < 1) return bad(res, 400, 'ID không hợp lệ');
      const old = await one('SELECT * FROM patch_jobs WHERE id=?', [id]); if (!old) return bad(res, 404, 'Không tìm thấy tác vụ bản vá');
      const status = PATCH_STATUS.includes(b.status) ? b.status : old.status;
      const completed = status === 'Installed' ? (old.completed_at || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null;
      await run('UPDATE patch_jobs SET status=?,assigned_to=?,planned_date=?,completed_at=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, clean(b.assigned_to ?? old.assigned_to, 150) || null, clean(b.planned_date ?? old.planned_date, 30) || null, completed, clean(b.notes ?? old.notes, 2000) || null, id]);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: 'Không thể cập nhật tác vụ bản vá' }); }
  });

  // Nhập từ Wazuh Vulnerability Detection inventory. Mỗi finding được deduplicate theo agent + CVE + package.
  router.post('/sync-wazuh', async (req, res) => {
    const base = String(process.env.INDEXER_URL || '').replace(/\/$/, ''), user = process.env.INDEXER_USER, pass = process.env.INDEXER_PASS;
    if (!base || !user || !pass) return res.status(503).json({ success: false, error: 'Cần cấu hình INDEXER_URL, INDEXER_USER và INDEXER_PASS trong .env' });
    try {
      const scopeAgents = String(process.env.WAZUH_SCOPE_AGENTS || 'ROYAL01,LINUX01').split(',').map(x => x.trim()).filter(Boolean);
      const r = await axios.post(`${base}/wazuh-states-vulnerabilities-*/_search`, {
        size: 1000, sort: [{ 'vulnerability.detected_at': { order: 'desc', unmapped_type: 'date' } }],
        query: { bool: { filter: [{ terms: { 'agent.name': scopeAgents } }] } },
        _source: ['agent.id','agent.name','host.os.full','vulnerability.id','vulnerability.description','vulnerability.severity','vulnerability.score.base','vulnerability.reference','vulnerability.detected_at','vulnerability.status','package.name','package.version']
      }, { headers: { Authorization: 'Basic ' + Buffer.from(user + ':' + pass).toString('base64') }, httpsAgent: agent, timeout: 15000 });
      const hits = r.data?.hits?.hits || []; let added = 0, updated = 0;
      for (const hit of hits) {
        const s = hit._source || {}, v = s.vulnerability || {}, p = s.package || {}, a = s.agent || {};
        if (!v.id) continue;
        const assetName = clean(a.name || 'Unknown agent', 150), cve = clean(v.id, 100).toUpperCase(), pkg = clean(p.name, 200);
        const key = `wazuh:${a.id || assetName}:${cve}:${pkg}`;
        const found = await one('SELECT id,status FROM vulnerability_findings WHERE finding_key=?', [key]);
        const cvssRaw = v.score?.base, cvss = cvssRaw == null || cvssRaw === '' ? null : Number(cvssRaw);
        const severity = SEVERITIES.find(x => x.toLowerCase() === String(v.severity || '').toLowerCase()) || (cvss == null || !Number.isFinite(cvss) ? 'Medium' : cvss >= 9 ? 'Critical' : cvss >= 7 ? 'High' : cvss >= 4 ? 'Medium' : 'Low');
        const asset = await one('SELECT id FROM assets WHERE lower(hostname)=lower(?) OR lower(name)=lower(?) LIMIT 1', [assetName, assetName]);
        const importedStatus = /solved|fixed|mitigated/i.test(String(v.status || '')) ? 'Mitigated' : 'Open';
        await run(`INSERT INTO vulnerability_findings (finding_key,asset_id,asset_name,cve,title,package_name,installed_version,severity,score,status,source,reference,detected_at,last_seen,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,'Wazuh',?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT(finding_key) DO UPDATE SET asset_id=COALESCE(excluded.asset_id,vulnerability_findings.asset_id),asset_name=excluded.asset_name,title=excluded.title,severity=excluded.severity,score=excluded.score,reference=excluded.reference,last_seen=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,
          installed_version=excluded.installed_version,
          status=CASE WHEN vulnerability_findings.status='Accepted' THEN 'Accepted' WHEN excluded.status='Mitigated' THEN 'Mitigated' WHEN vulnerability_findings.status='Mitigated' THEN 'Open' ELSE vulnerability_findings.status END`,
          [key, asset?.id || null, assetName, cve, clean(v.description || `${cve} ảnh hưởng đến ${pkg}`, 300), pkg || null, clean(p.version, 100) || null, severity, cvss != null && Number.isFinite(cvss) ? cvss : null, importedStatus, clean(v.reference, 1000) || null, clean(v.detected_at, 40) || new Date().toISOString()]);
        found ? updated++ : added++;
      }
      res.json({ success: true, scanned: hits.length, added, updated, scope: scopeAgents, note: 'Dữ liệu được nhập từ inventory Wazuh trong scope agent đã cấu hình; kiểm tra lại Wazuh nếu có trên 1.000 kết quả.' });
    } catch (e) {
      const status = e.response?.status;
      res.status(502).json({ success: false, error: status === 404 ? 'Không tìm thấy index wazuh-states-vulnerabilities-*; kiểm tra Wazuh Vulnerability Detection.' : status ? `Indexer trả về HTTP ${status}; kiểm tra tài khoản chỉ-đọc và index.` : 'Không kết nối được Wazuh Indexer hoặc dữ liệu vulnerability inventory chưa sẵn sàng.' });
    }
  });
  return router;
};
