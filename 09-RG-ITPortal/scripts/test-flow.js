'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// Isolated in-memory process config; the test uses a disposable SQLite file and never touches itportal.db.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'flow-test-secret-that-is-long-enough-123456789';
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = 'false';
process.env.AUDIT_RETENTION_DAYS = '30';
process.env.DB_PATH = '';
process.env.NODE_ENV = 'test';

const { loadSqliteForFlowTest } = require('./_test-sqlite');
const sqlite3 = loadSqliteForFlowTest();
const { initializeDatabase, createApp, resolveDbPath, parsePort, parseTrustProxy } = require('../server');
const perm = require('../routes/perm');
const { psq } = require('../routes/utils');
const adAuth = require('../routes/ad-auth');
const dockerRoutes = require('../routes/docker');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const run = (db, sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, error => error ? reject(error) : resolve()));
const get = (db, sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => error ? reject(error) : resolve(row)));
const all = (db, sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (error, rows) => error ? reject(error) : resolve(rows || [])));
const closeDb = db => new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
const closeHttp = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-itportal-flow-'));
  const dbPath = path.join(tempRoot, 'flow-test.db');
  let db = null, httpServer = null, appRef = null;
  try {
    db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 5000);

    // Seed an old audit record before initialization; retention cleanup should remove it.
    await run(db, 'CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, method TEXT, path TEXT, status INTEGER, ip TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
    await run(db, "INSERT INTO audit_log (username, role, method, path, status, ip, created_at) VALUES ('test','Employee','GET','/old',200,'127.0.0.1',datetime('now','-400 days'))");
    await initializeDatabase(db);
    await perm.init(db);

    const journal = await get(db, 'PRAGMA journal_mode');
    assert.equal(String(journal.journal_mode).toLowerCase(), 'wal', 'SQLite must use WAL mode');
    const indexes = await all(db, "SELECT name FROM sqlite_master WHERE type='index'");
    const names = new Set(indexes.map(row => row.name));
    for (const name of ['idx_audit_log_created_at', 'idx_tickets_status_created', 'idx_ticket_comments_ticket_id']) assert.ok(names.has(name), `missing index ${name}`);
    const retained = await get(db, "SELECT COUNT(*) AS count FROM audit_log WHERE path='/old'");
    assert.equal(retained.count, 0, 'old audit records should be pruned by retention policy');
    assert.ok(path.isAbsolute(resolveDbPath()), 'default DB path must be absolute');
    assert.equal(parsePort('8123'), 8123);
    assert.throws(() => parsePort('port80'), /PORT/);
    assert.equal(parseTrustProxy('false'), false);
    assert.equal(parseTrustProxy('2'), 2);
    console.log('PASS SQLite absolute path, WAL, indexes and audit retention');
    console.log('PASS server configuration parsing for PORT and TRUST_PROXY');

    const foldedYaml = 'services:\n  web:\n    image: nginx:alpine\n    command: >\n      echo hello\n      echo world\n';
    assert.equal(dockerRoutes._decodeComposeBody({ compose: foldedYaml }), foldedYaml, 'raw Compose YAML, including folded scalar >, must remain unchanged');
    assert.equal(dockerRoutes._decodeComposeBody({ compose64: Buffer.from(foldedYaml, 'utf8').toString('base64') }), foldedYaml, 'base64 Compose path must round-trip');
    assert.equal(dockerRoutes._checkComposeBody(foldedYaml), '', 'safe Compose YAML containing > should pass validation');
    assert.throws(() => dockerRoutes._decodeComposeBody({ compose64: '%%%not-base64%%%' }), /Compose64/);
    console.log('PASS Docker Compose preserves YAML folded scalar >');

    const attack = "User’); Start-Process calc; Write-Output ‘oops”";
    const escaped = psq(attack);
    assert.ok(escaped.includes('’’'), 'curly single quote U+2019 must be doubled');
    assert.ok(escaped.includes('‘‘'), 'curly left single quote U+2018 must be doubled');
    assert.ok(escaped.includes('””'), 'curly double quote U+201D must be doubled');
    const auth = read('routes/auth.js');
    const server = read('server.js');
    const ad = read('routes/ad.js');
    const adAuthSource = read('routes/ad-auth.js');
    const guardSource = read('routes/login-guard.js');
    assert.match(guardSource, /byKey/, 'login limiter must be keyed per account+IP, not per IP only');
    assert.match(adAuthSource, /roleFromGroups/);
    assert.equal(adAuth.roleFromGroups(['Domain Users', 'domain admins']), 'Super-Admin', 'exact, case-insensitive Domain Admins match');
    assert.equal(adAuth.roleFromGroups(['IT-Helpdesk']), 'IT-Staff');
    assert.equal(adAuth.roleFromGroups(['Domain Admins Helpers', 'Not-IT-Helpdesk']), 'Employee', 'group names must never match by substring');
    assert.match(auth, /sessionCall\(req\.session, 'regenerate'\)/);
    assert.match(auth, /status\(503\)/);
    assert.match(auth, /password\.length > 256/);
    assert.match(ad, /okFullName = .*length <= 128/);
    assert.match(ad, /okPassword = .*length <= 256/);
    assert.match(server, /createLoginGuard\(\)/);
    assert.match(server, /new SQLiteSessionStore\(/);
    assert.match(server, /await perm\.init\(db\)/);
    assert.match(server, /sessionSecret\.length < 32/);
    assert.match(server, /REPLACE_|CHANGE_ME|YOUR_SECRET/);
    const packageJson = JSON.parse(read('package.json'));
    assert.equal(packageJson.main, 'server.js', 'package main should point to the server entry point');
    for (const removed of ['activedirectory2', 'node-powershell', 'https']) {
      assert.ok(!Object.prototype.hasOwnProperty.call(packageJson.dependencies || {}, removed), `unused package ${removed} should be removed`);
    }
    for (const setting of ['PORT=', 'TRUST_PROXY=', 'COOKIE_SECURE=', 'AUDIT_RETENTION_DAYS=']) {
      assert.ok(read('.env.example').includes(setting), `missing environment setting ${setting}`);
    }
    assert.match(server, /if \(error\.code === 'EADDRINUSE'\)/);
    assert.match(server, /process\.once\('SIGTERM'/);
    assert.doesNotMatch(server, /replace\(\/</, 'API body middleware must not escape/mutate all request strings');
    assert.match(server, /SELECT 1 AS ok/);
    console.log('PASS PowerShell smart-quote mitigation, exact group matching, session rotation and login error semantics');
    console.log('PASS full-name/password limits, failed-login rate limit and graceful startup/shutdown guards');

    for (const [file, fields] of [
      ['public/js/app.js', ['l.hostname', 'g.DisplayName', 't.requester', 'a.desc']],
      ['public/js/ui2.js', ['g.DisplayName', 's.Name', 'e.desc']],
      ['public/js/ui4.js', ['x.host', 'x.name', 'x.title']],
      ['public/js/ui6.js', ['t.requester', 't.title', 'c.body']]
    ]) {
      const source = read(file);
      for (const field of fields) assert.ok(source.includes(`esc(${field})`), `${file} should escape ${field}`);
    }
    console.log('PASS escape() coverage for DHCP, Wazuh, Zabbix, GPO and helpdesk display fields');

    const indexHtml = read('public/index.html');
    const appJs = read('public/js/app.js');
    const ui4 = read('public/js/ui4.js');
    assert.equal((indexHtml.match(/id=\"resetPassModal\"/g) || []).length, 0, 'reset password modal should not duplicate the modal injected by ui4.js');
    assert.equal((ui4.match(/id=\"resetPassModal\"/g) || []).length, 1, 'ui4.js should inject exactly one reset password modal');
    assert.match(ui4, /id=\"rpPass\"[^>]*maxlength=\"256\"/);
    assert.match(ui4, /id=\"rpPass2\"[^>]*maxlength=\"256\"/);
    assert.match(appJs, /'platforms', 'computers'/, 'all legitimate dynamically loaded views must be allowlisted');
    assert.match(ad, /-Filter \{ Name -eq \$departmentName \}/, 'OU filter should use a PowerShell variable rather than embedding user input in a double-quoted script string');
    console.log('PASS unique reset-password modal, max password length and allowlisted page navigation');

    const app = createApp(db);
    appRef = app;
    await app.locals.ready;
    httpServer = http.createServer(app);
    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const address = httpServer.address();
    const base = `http://127.0.0.1:${address.port}`;
    const healthResponse = await fetch(`${base}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    assert.equal(health.database, 'ok');

    // Invalid-form attempts must remain validation errors rather than consuming the failed-password limit.
    for (let i = 0; i < 12; i++) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'invalid user', password: 'not-a-password' })
      });
      assert.equal(response.status, 400, `invalid login form ${i + 1} should not be rate-limited`);
    }
    console.log('PASS live /api/health SQLite probe and invalid-login validation/rate-limit behavior');
  } finally {
    if (httpServer?.listening) {
      // Fetch can leave an idle keep-alive socket open in some Node builds.
      // Close active/idle connections before awaiting the server's close callback.
      try { httpServer.closeAllConnections?.(); } catch (_) {}
      await closeHttp(httpServer).catch(() => {});
    }
    try { appRef?.locals.sessionStore.close(); } catch (_) {}
    if (appRef) await appRef.locals.ready.catch(() => {});   // đừng đóng DB khi migration còn chạy (gây SQLITE_MISUSE)
    if (db) await closeDb(db).catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('FAIL flow tests:', error && error.stack || error);
  process.exitCode = 1;
});
