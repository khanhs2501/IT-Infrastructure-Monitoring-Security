'use strict';

const express = require('express');
const perm = require('./perm');
const router = express.Router();

module.exports = function createDashboardRouter(db) {
  const one = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));

  router.get('/summary', async (req, res) => {
    const user = req.session.user;
    try {
      const [tickets, assets, vulnerabilities] = await Promise.all([
        perm.can(user, 'helpdesk', 'view') ? one(`SELECT SUM(CASE WHEN status IN ('Open','InProgress') THEN 1 ELSE 0 END) open,
          SUM(CASE WHEN status IN ('Open','InProgress') AND resolution_due_at IS NOT NULL AND datetime(resolution_due_at)<datetime('now') THEN 1 ELSE 0 END) overdue
          FROM tickets ${perm.can(user, 'helpdesk', 'manage') ? '' : 'WHERE username=? OR (username IS NULL AND requester=?)'}`,
          perm.can(user, 'helpdesk', 'manage') ? [] : [user.username, user.fullname || user.username]) : null,
        perm.can(user, 'assets', 'view') ? one("SELECT COUNT(*) total, SUM(CASE WHEN criticality='Critical' AND status!='Retired' THEN 1 ELSE 0 END) critical FROM assets") : null,
        perm.can(user, 'vuln', 'view') ? one("SELECT COUNT(*) open, SUM(CASE WHEN severity='Critical' THEN 1 ELSE 0 END) critical FROM vulnerability_findings WHERE status IN ('Open','InProgress')") : null
      ]);
      res.json({ generatedAt: new Date().toISOString(),
        tickets: tickets ? { open: tickets.open || 0, overdue: tickets.overdue || 0 } : null,
        assets: assets ? { total: assets.total || 0, critical: assets.critical || 0 } : null,
        vulnerabilities: vulnerabilities ? { open: vulnerabilities.open || 0, critical: vulnerabilities.critical || 0 } : null });
    } catch (error) {
      console.error('[dashboard] Summary failed:', error.message);
      res.status(500).json({ success: false, error: 'Không tải được tổng quan vận hành' });
    }
  });

  return router;
};
