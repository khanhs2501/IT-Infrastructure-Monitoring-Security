const express = require('express');
const router = express.Router();

module.exports = function (db) {
  const all = (sql, p = []) => new Promise((resolve, reject) => db.all(sql, p, (e, rows) => e ? reject(e) : resolve(rows || [])));
  const one = (sql, p = []) => new Promise((resolve, reject) => db.get(sql, p, (e, row) => e ? reject(e) : resolve(row)));
  const boundedLimit = v => Math.min(1000, Math.max(1, Number(v) || 500));

  router.get('/summary', async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const modifier = `-${days} days`;
    try {
      const [periodTicket, activeTicket, asset, vuln, patch, createdTrend, resolvedTrend, vulnBySeverity, patchByStatus] = await Promise.all([
        one(`SELECT COUNT(*) total,
          SUM(CASE WHEN status='Resolved' AND datetime(resolved_at) >= datetime('now', ?) THEN 1 ELSE 0 END) resolved_period,
          ROUND(AVG(CASE WHEN first_response_at IS NOT NULL THEN (julianday(first_response_at)-julianday(created_at))*1440 END),1) avg_response_minutes,
          ROUND(AVG(CASE WHEN resolved_at IS NOT NULL THEN (julianday(resolved_at)-julianday(created_at))*1440 END),1) avg_resolution_minutes
          FROM tickets WHERE datetime(created_at)>=datetime('now', ?)`, [modifier, modifier]),
        one(`SELECT SUM(CASE WHEN status IN ('Open','InProgress') THEN 1 ELSE 0 END) open,
          SUM(CASE WHEN response_due_at IS NOT NULL AND (
            (first_response_at IS NOT NULL AND datetime(first_response_at)>datetime(response_due_at) AND (status IN ('Open','InProgress') OR (resolved_at IS NOT NULL AND datetime(resolved_at)>=datetime('now', ?))))
            OR (first_response_at IS NULL AND status IN ('Open','InProgress') AND datetime(response_due_at)<datetime('now'))
          ) THEN 1 ELSE 0 END) response_breached,
          SUM(CASE WHEN resolution_due_at IS NOT NULL AND (
            (resolved_at IS NOT NULL AND datetime(resolved_at)>datetime(resolution_due_at) AND datetime(resolved_at)>=datetime('now', ?))
            OR (resolved_at IS NULL AND status IN ('Open','InProgress') AND datetime(resolution_due_at)<datetime('now'))
          ) THEN 1 ELSE 0 END) resolution_breached
          FROM tickets`, [modifier, modifier]),
        one(`SELECT COUNT(*) total, SUM(CASE WHEN status='Active' THEN 1 ELSE 0 END) active, SUM(CASE WHEN criticality='Critical' AND status!='Retired' THEN 1 ELSE 0 END) critical FROM assets`),
        one(`SELECT COUNT(*) total, SUM(CASE WHEN status IN ('Open','InProgress') THEN 1 ELSE 0 END) open, SUM(CASE WHEN severity='Critical' AND status IN ('Open','InProgress') THEN 1 ELSE 0 END) critical, SUM(CASE WHEN status='Mitigated' THEN 1 ELSE 0 END) mitigated FROM vulnerability_findings`),
        one(`SELECT COUNT(*) total, SUM(CASE WHEN status='Installed' THEN 1 ELSE 0 END) installed, SUM(CASE WHEN status IN ('Planned','InProgress','Failed','Deferred') THEN 1 ELSE 0 END) pending FROM patch_jobs`),
        all(`SELECT date(created_at) day, COUNT(*) created FROM tickets WHERE datetime(created_at)>=datetime('now', ?) GROUP BY date(created_at)`, [modifier]),
        all(`SELECT date(resolved_at) day, COUNT(*) resolved FROM tickets WHERE resolved_at IS NOT NULL AND datetime(resolved_at)>=datetime('now', ?) GROUP BY date(resolved_at)`, [modifier]),
        all(`SELECT severity, COUNT(*) count FROM vulnerability_findings WHERE status IN ('Open','InProgress') GROUP BY severity`),
        all(`SELECT status, COUNT(*) count FROM patch_jobs GROUP BY status`)
      ]);
      const audit = await one(`SELECT COUNT(*) total FROM audit_log WHERE datetime(created_at)>=datetime('now', ?)`, [modifier]).catch(() => ({ total: 0 }));
      const trend = new Map();
      for (const x of createdTrend) trend.set(x.day, { day: x.day, created: x.created || 0, resolved: 0 });
      for (const x of resolvedTrend) {
        const row = trend.get(x.day) || { day: x.day, created: 0, resolved: 0 };
        row.resolved = x.resolved || 0; trend.set(x.day, row);
      }
      const ticketTrend = [...trend.values()].sort((a, b) => a.day.localeCompare(b.day));
      res.json({ generatedAt: new Date().toISOString(), days,
        tickets: { total: periodTicket?.total || 0, open: activeTicket?.open || 0, resolvedPeriod: periodTicket?.resolved_period || 0, responseBreached: activeTicket?.response_breached || 0, resolutionBreached: activeTicket?.resolution_breached || 0, avgResponseMinutes: periodTicket?.avg_response_minutes ?? null, avgResolutionMinutes: periodTicket?.avg_resolution_minutes ?? null },
        assets: { total: asset?.total || 0, active: asset?.active || 0, critical: asset?.critical || 0 },
        vulnerabilities: { total: vuln?.total || 0, open: vuln?.open || 0, critical: vuln?.critical || 0, mitigated: vuln?.mitigated || 0, bySeverity: vulnBySeverity },
        patches: { total: patch?.total || 0, installed: patch?.installed || 0, pending: patch?.pending || 0, byStatus: patchByStatus },
        auditActions: audit?.total || 0, ticketTrend });
    } catch (e) {
      res.status(500).json({ error: 'Không thể tổng hợp KPI. Hãy kiểm tra migration bảng ticket/assets/vulnerability/patch.' });
    }
  });

  async function readDataset(type, limit) {
    if (type === 'assets') return all('SELECT asset_tag,name,asset_type,hostname,ip_address,os,environment,criticality,status,source,monitoring_state,updated_at FROM assets ORDER BY name LIMIT ?', [limit]);
    if (type === 'tickets') return all('SELECT id,requester,username,type,title,priority,status,assignee,asset_id,external_source,external_id,created_at,first_response_at,resolved_at,response_due_at,resolution_due_at FROM tickets ORDER BY id DESC LIMIT ?', [limit]);
    if (type === 'vulnerabilities') return all('SELECT cve,asset_name,title,package_name,installed_version,fixed_version,severity,score,status,source,detected_at,due_date,assigned_to,updated_at FROM vulnerability_findings ORDER BY detected_at DESC LIMIT ?', [limit]);
    if (type === 'patches') return all('SELECT asset_name,title,patch_ref,patch_type,status,planned_date,completed_at,assigned_to,updated_at FROM patch_jobs ORDER BY id DESC LIMIT ?', [limit]);
    return null;
  }
  const columns = {
    assets: ['asset_tag','name','asset_type','hostname','ip_address','os','environment','criticality','status','source','monitoring_state','updated_at'],
    tickets: ['id','requester','username','type','title','priority','status','assignee','asset_id','external_source','external_id','created_at','first_response_at','resolved_at','response_due_at','resolution_due_at'],
    vulnerabilities: ['cve','asset_name','title','package_name','installed_version','fixed_version','severity','score','status','source','detected_at','due_date','assigned_to','updated_at'],
    patches: ['asset_name','title','patch_ref','patch_type','status','planned_date','completed_at','assigned_to','updated_at']
  };
  const csvCell = value => {
    let s = String(value ?? '');
    // Ngăn Excel/LibreOffice diễn giải dữ liệu do người dùng nhập như công thức CSV.
    if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };

  // Dataset chỉ đọc để tích hợp báo cáo / Power BI. Endpoint vẫn yêu cầu session và reports/view.
  router.get('/dataset', async (req, res) => {
    const limit = boundedLimit(req.query.limit);
    try {
      const types = ['assets','tickets','vulnerabilities','patches'];
      const datasets = {};
      for (const type of types) datasets[type] = await readDataset(type, limit);
      res.json({ generatedAt: new Date().toISOString(), limit, ...datasets });
    } catch (e) { res.status(500).json({ error: 'Không thể xuất dataset báo cáo' }); }
  });

  router.get('/export.csv', async (req, res) => {
    const type = String(req.query.type || 'tickets');
    if (!Object.prototype.hasOwnProperty.call(columns, type)) return res.status(400).json({ error: 'type phải là assets, tickets, vulnerabilities hoặc patches' });
    const limit = boundedLimit(req.query.limit);
    try {
      const rows = await readDataset(type, limit);
      const fields = columns[type];
      const csv = [fields.map(csvCell).join(','), ...rows.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="royal-it-${type}-${new Date().toISOString().slice(0,10)}.csv"`);
      res.send('\ufeff' + csv);
    } catch (e) { res.status(500).json({ error: 'Không thể xuất CSV' }); }
  });
  return router;
};
