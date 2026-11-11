// Ma trận phân quyền: vai trò mặc định + ghi đè RIÊNG TỪNG NGƯỜI (mỗi IT-Staff một vai trò). Super-Admin luôn toàn quyền.
const MODULES = ['zabbix', 'wazuh', 'pfsense', 'ad', 'computers', 'laps', 'admin', 'helpdesk', 'deleg', 'docker', 'assets', 'vuln', 'reports', 'platforms'], RANK = { none: 0, view: 1, manage: 2 };
const DEFAULTS = {
    'IT-Staff': { zabbix: 'view', wazuh: 'view', pfsense: 'view', ad: 'view', computers: 'manage', laps: 'none', admin: 'none', helpdesk: 'manage', deleg: 'manage', docker: 'none', assets: 'manage', vuln: 'manage', reports: 'view', platforms: 'view' },
    'Employee': { zabbix: 'none', wazuh: 'none', pfsense: 'none', ad: 'none', computers: 'none', laps: 'none', admin: 'none', helpdesk: 'view', deleg: 'none', docker: 'none', assets: 'none', vuln: 'none', reports: 'none', platforms: 'none' }
};
let M = JSON.parse(JSON.stringify(DEFAULTS)), U = {};   // U[username][module] = level
const key = u => String(u || '').toLowerCase();
const dbRun = (db, sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, error => error ? reject(error) : resolve()));
const dbAll = (db, sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || [])));
async function init(db) {
    await dbRun(db, 'CREATE TABLE IF NOT EXISTS permissions (role TEXT, module TEXT, level TEXT, PRIMARY KEY (role, module))');
    await dbRun(db, 'CREATE TABLE IF NOT EXISTS user_perms (username TEXT, module TEXT, level TEXT, PRIMARY KEY (username, module))');
    const [roles, users] = await Promise.all([
        dbAll(db, 'SELECT * FROM permissions'),
        dbAll(db, 'SELECT * FROM user_perms')
    ]);
    M = JSON.parse(JSON.stringify(DEFAULTS));
    U = {};
    for (const row of roles) {
        if (M[row.role] && row.module in M[row.role] && row.level in RANK) M[row.role][row.module] = row.level;
    }
    for (const row of users) {
        if (MODULES.includes(row.module) && row.level in RANK) (U[key(row.username)] = U[key(row.username)] || {})[row.module] = row.level;
    }
    return true;
}
const eff = u => ({ ...(M[u.role] || {}), ...(U[key(u.username)] || {}) });
const all = () => Object.fromEntries(MODULES.map(m => [m, 'manage']));
const forRole = r => r === 'Super-Admin' ? all() : (M[r] || {});
const forUser = u => u.role === 'Super-Admin' ? all() : eff(u);
const can = (u, mod, lvl) => !!u && (u.role === 'Super-Admin' || RANK[eff(u)[mod] || 'none'] >= RANK[lvl]);
const need = (mod, lvl) => (req, res, next) => can(req.session.user, mod, lvl) ? next() : res.status(403).json({ error: 'Không đủ quyền hạn' });
function router(db) {
    const r = require('express').Router();
    r.get('/', (req, res) => res.json({ modules: MODULES, matrix: M, users: U }));
    r.put('/', (req, res) => {   // đổi mặc định theo vai trò
        const { role, module, level } = req.body;
        if (!M[role] || !MODULES.includes(module) || !(level in RANK)) return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ' });
        M[role][module] = level; db.run('INSERT OR REPLACE INTO permissions VALUES (?,?,?)', [role, module, level], e => { if (e) console.error('[perm] Không lưu được quyền vai trò:', e.message); res.json({ success: !e }); });
    });
    r.put('/user', (req, res) => {   // ghi đè riêng cho 1 người: levels = { module: 'none'|'view'|'manage'|'default' }
        const { username, levels } = req.body;
        if (!/^[\w.\-]{1,64}$/.test(username || '') || !levels || typeof levels !== 'object') return res.status(400).json({ success: false, error: 'Dữ liệu không hợp lệ' });
        const k = key(username), logErr = e => { if (e) console.error('[perm] Không lưu được quyền người dùng:', e.message); };
        for (const [m, l] of Object.entries(levels)) {
            if (!MODULES.includes(m)) continue;
            if (l === 'default') { if (U[k]) delete U[k][m]; db.run('DELETE FROM user_perms WHERE username = ? AND module = ?', [k, m], logErr); }
            else if (l in RANK) { (U[k] = U[k] || {})[m] = l; db.run('INSERT OR REPLACE INTO user_perms VALUES (?,?,?)', [k, m, l], logErr); }
        }
        res.json({ success: true });
    });
    return r;
}
module.exports = { init, forRole, forUser, can, need, router, MODULES };