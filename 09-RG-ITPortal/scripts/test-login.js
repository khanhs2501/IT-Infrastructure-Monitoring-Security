'use strict';
// Kiểm thử luồng đăng nhập đầu-cuối (HTTP thật + SQLite tạm). AD/PowerShell được giả lập, KHÔNG kết nối domain thật.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'login-test-secret-that-is-long-enough-123456789';
process.env.COOKIE_SECURE = 'false';
process.env.TRUST_PROXY = 'false';
process.env.NODE_ENV = 'test';
process.env.DB_PATH = '';

// --- Giả lập PowerShell/AD trước khi nạp routes/ad-auth (module này lấy runPS lúc nạp) ---
const utils = require('../routes/utils');
const psCalls = [];
let psBehavior = () => null;
const fakeRunPS = async (script, timeout) => {
  psCalls.push(script);
  await new Promise(r => setTimeout(r, 40));
  return psBehavior(script, timeout);
};
fakeRunPS.lastErr = '';
utils.runPS = fakeRunPS;

const { loadSqliteForFlowTest } = require('./_test-sqlite');
const sqlite3 = loadSqliteForFlowTest();
const { initializeDatabase, createApp } = require('../server');
const perm = require('../routes/perm');
const adAuth = require('../routes/ad-auth');
const SQLiteSessionStore = require('../routes/session-store');
const { createLoginGuard } = require('../routes/login-guard');

const run = (db, sql, args = []) => new Promise((res, rej) => db.run(sql, args, e => e ? rej(e) : res()));
const get = (db, sql, args = []) => new Promise((res, rej) => db.get(sql, args, (e, r) => e ? rej(e) : res(r)));
const all = (db, sql, args = []) => new Promise((res, rej) => db.all(sql, args, (e, r) => e ? rej(e) : res(r || [])));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const listen = app => new Promise((resolve, reject) => { const s = http.createServer(app); s.once('error', reject); s.listen(0, '127.0.0.1', () => resolve(s)); });
const stop = async s => { try { s.closeAllConnections?.(); } catch (_) {} await new Promise(r => s.close(() => r())); };

const adminResult = { Success: true, Username: 'Administrator', FullName: 'Administrator', Department: 'IT', Groups: ['Domain Admins', 'Domain Users'] };
const authCalls = () => psCalls.filter(x => x.includes('ValidateCredentials'));   // bỏ qua các lệnh PowerShell khác (vd. làm nóng cache OU)
const decodeB64 = script => [...script.matchAll(/Dec '([A-Za-z0-9+/=]+)'/g)].map(m => Buffer.from(m[1], 'base64').toString('utf8'));

function client(base) {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const line of set) { if (/^rg\.sid=/.test(line)) cookie = line.split(';')[0]; }
    let json = null; const text = await res.text(); try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, json, text, headers: res.headers, setCookie: set };
  };
  return { call, setCookie: c => { cookie = c; }, get cookie() { return cookie; } };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-itportal-login-'));
  const db = new sqlite3.Database(path.join(tempRoot, 'login-test.db'));
  db.configure('busyTimeout', 5000);
  const servers = [], apps = [];
  try {
    await initializeDatabase(db);
    await perm.init(db);
    const guard = createLoginGuard({ maxAttempts: 3, windowMinutes: 10 });
    const app1 = createApp(db, { loginGuard: guard, cookieSecure: false });
    apps.push(app1); await app1.locals.ready;
    const server1 = await listen(app1); servers.push(server1);
    const base1 = `http://127.0.0.1:${server1.address().port}`;
    const admin = client(base1);

    // 1) Chuẩn hóa tên đăng nhập: DOMAIN\user và UPN đều vào được; chuỗi nguy hiểm bị từ chối.
    assert.deepEqual(adAuth.normalizeLogin('ROYAL\\Administrator'), { sam: 'Administrator', login: 'Administrator', form: 'domain\\user' });
    assert.equal(adAuth.normalizeLogin('administrator@royal.local').login, 'administrator@royal.local');
    for (const bad of ["a'; calc", 'a b', '', 'x'.repeat(200), 'a"b', '$(whoami)']) assert.equal(adAuth.normalizeLogin(bad), null, `must reject ${bad}`);
    console.log('PASS login name normalisation (DOMAIN\\user, UPN, injection rejected)');

    // 2) Đăng nhập Administrator bằng DOMAIN\Administrator; mật khẩu không nằm trong script dạng rõ.
    psBehavior = () => adminResult;
    const tricky = `Pa$$w0rd'"’\`;\n$(calc)`;
    let r = await admin.call('POST', '/api/auth/login', { username: 'ROYAL\\Administrator', password: tricky });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.user.role, 'Super-Admin');
    const sent = authCalls().pop();
    assert.ok(!sent.includes('calc') && !sent.includes(tricky), 'password must only travel base64-encoded inside the script');
    assert.deepEqual(decodeB64(sent), ['Administrator', 'Administrator', tricky], 'login, sam and password round-trip through base64');
    const cookieLine = r.setCookie.find(l => l.startsWith('rg.sid='));
    assert.ok(/HttpOnly/i.test(cookieLine) && /SameSite=Lax/i.test(cookieLine) && !/;\s*Secure/i.test(cookieLine), 'cookie must be HttpOnly+Lax and NOT Secure over plain HTTP');
    r = await admin.call('GET', '/api/auth/me');
    assert.equal(r.json.username, 'Administrator');
    console.log('PASS Administrator login via DOMAIN\\user with hostile password characters; session cookie flags correct');

    // 3) Phiên sống sót qua "restart" (app + store mới, cùng database).
    await stop(server1); servers.pop();
    const app2 = createApp(db, { loginGuard: createLoginGuard({ maxAttempts: 3 }), cookieSecure: false });
    apps.push(app2); await app2.locals.ready;
    const server2 = await listen(app2); servers.push(server2);
    const base2 = `http://127.0.0.1:${server2.address().port}`;
    const afterRestart = client(base2); afterRestart.setCookie(admin.cookie);
    r = await afterRestart.call('GET', '/api/auth/me');
    assert.equal(r.json && r.json.username, 'Administrator', 'session must survive a server restart');
    console.log('PASS session survives server restart (SQLite session store)');

    // 4) /views yêu cầu đăng nhập.
    r = await client(base2).call('GET', '/views/ad.html'); assert.equal(r.status, 401);
    r = await afterRestart.call('GET', '/views/ad.html'); assert.equal(r.status, 200);
    r = await client(base2).call('GET', '/'); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control') || '', /no-cache/, 'index.html must not be cached for an hour');
    console.log('PASS /views protected, index.html revalidated');

    // 5) Chặn theo TỪNG tài khoản: bob sai 3 lần bị chặn, Administrator vẫn đăng nhập được.
    psBehavior = () => ({ Success: false, Reason: 'invalid_credentials' });
    const bob = client(base2);
    for (let i = 1; i <= 3; i++) {
      r = await bob.call('POST', '/api/auth/login', { username: 'bob', password: 'wrong' });
      assert.equal(r.status, 401); assert.equal(r.json.code, 'invalid_credentials'); assert.equal(r.json.attemptsLeft, 3 - i);
    }
    r = await bob.call('POST', '/api/auth/login', { username: 'bob', password: 'wrong' });
    assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0); assert.match(r.json.error, /bob/);
    psBehavior = () => adminResult;
    r = await client(base2).call('POST', '/api/auth/login', { username: 'Administrator', password: 'right' });
    assert.equal(r.status, 200, 'another account must NOT be locked by bob\'s typos');
    console.log('PASS per-account lockout does not block Administrator');

    // 6) Lỗi hạ tầng AD/PowerShell: 503, KHÔNG tính là sai mật khẩu, có thử lại 1 lần.
    psBehavior = () => null; fakeRunPS.lastErr = 'ADWS không phản hồi';
    const before = authCalls().length;
    for (let i = 0; i < 5; i++) {
      r = await client(base2).call('POST', '/api/auth/login', { username: 'dave', password: 'x' });
      assert.equal(r.status, 503, 'AD outage must stay 503 and never become 429');
      assert.equal(r.json.code, 'ad_unavailable');
    }
    assert.equal(authCalls().length - before, 10, 'transient AD failure is retried exactly once per login');
    console.log('PASS AD outage -> 503 (not counted as bad password), single retry');

    // 7) Timeout không retry.
    fakeRunPS.lastErr = 'PowerShell timed out after 45000 ms';
    const t0 = authCalls().length;
    r = await client(base2).call('POST', '/api/auth/login', { username: 'erin', password: 'x' });
    assert.equal(r.status, 503); assert.equal(r.json.code, 'ad_timeout'); assert.equal(authCalls().length - t0, 1);
    console.log('PASS AD timeout reported separately, no retry');

    // 8) Lý do cụ thể từ AD.
    for (const [reason, code] of [['locked_out', 'locked_out'], ['disabled', 'disabled'], ['password_expired', 'password_expired'], ['weird', 'invalid_credentials']]) {
      psBehavior = () => ({ Success: false, Reason: reason });
      r = await client(base2).call('POST', '/api/auth/login', { username: `u_${reason}`, password: 'x' });
      assert.equal(r.status, 401); assert.equal(r.json.code, code);
    }
    console.log('PASS locked / disabled / expired accounts are explained');

    // 9) Bấm đăng nhập nhiều lần cùng lúc => chỉ hỏi AD một lần.
    psBehavior = () => adminResult;
    const n0 = authCalls().length;
    const burst = await Promise.all(Array.from({ length: 6 }, () => client(base2).call('POST', '/api/auth/login', { username: 'Administrator', password: 'same-pass' })));
    assert.ok(burst.every(x => x.status === 200), 'all duplicate submits succeed');
    assert.equal(authCalls().length - n0, 1, 'identical concurrent logins must share one PowerShell run');
    console.log('PASS double-submit/burst logins share one AD query (no 429 from in-flight requests)');

    // 10) Chống đăng nhập chéo trang (CSRF): Origin lạ bị từ chối.
    r = await client(base2).call('POST', '/api/auth/login', { username: 'Administrator', password: 'x' }, { origin: 'http://evil.example' });
    assert.equal(r.status, 403);
    r = await client(base2).call('POST', '/api/auth/login', { username: 'Administrator', password: 'x' }, { origin: base2 });
    assert.equal(r.status, 200);
    console.log('PASS cross-origin write requests rejected, same-origin accepted');

    // 11) Audit ghi tên tài khoản đã thử khi thất bại, kèm đường dẫn đầy đủ.
    await sleep(150);
    const rows = await all(db, "SELECT username, path, status FROM audit_log WHERE path = '/api/auth/login' AND status = 401 AND username = 'bob'");
    assert.ok(rows.length >= 3, 'failed logins must be audited with the attempted username and full /api path');
    console.log('PASS audit log keeps attempted username + full path for failed logins');

    // 12) Đăng xuất xóa phiên trong DB; phiên hết hạn bị từ chối.
    const sessCount = (await get(db, 'SELECT COUNT(*) AS n FROM sessions')).n;
    r = await afterRestart.call('POST', '/api/auth/logout'); assert.equal(r.status, 200);
    r = await afterRestart.call('GET', '/api/auth/me'); assert.equal(r.json, null);
    assert.equal((await get(db, 'SELECT COUNT(*) AS n FROM sessions')).n, sessCount - 1);
    const exp = client(base2); await exp.call('POST', '/api/auth/login', { username: 'Administrator', password: 'right' });
    assert.equal((await exp.call('GET', '/api/auth/me')).json.username, 'Administrator');
    await run(db, 'UPDATE sessions SET expires = 1');
    assert.equal((await exp.call('GET', '/api/auth/me')).json, null, 'expired session must be rejected');
    console.log('PASS logout destroys session row; expired sessions rejected');

    // 13) Session store độc lập.
    const store = new SQLiteSessionStore(db, { ttlMs: 60000 }); await store.ready;
    const cb = (fn, ...a) => new Promise((res, rej) => fn.call(store, ...a, (e, v) => e ? rej(e) : res(v)));
    await cb(store.set, 's1', { cookie: { expires: new Date(Date.now() + 60000).toISOString() }, user: { username: 'Zed' } });
    assert.equal((await cb(store.get, 's1')).user.username, 'Zed');
    await cb(store.set, 's2', { cookie: { expires: new Date(Date.now() - 1000).toISOString() }, user: { username: 'Old' } });
    assert.equal(await cb(store.get, 's2'), null, 'expired row is not returned');
    await cb(store.destroyByUser, 'Zed'); assert.equal(await cb(store.get, 's1'), null);
    store.close();
    console.log('PASS session store get/set/expiry/destroyByUser');
  } finally {
    for (const s of servers) await stop(s).catch(() => {});
    for (const a of apps) { try { a.locals.sessionStore.close(); } catch (_) {} await a.locals.ready.catch(() => {}); }
    await new Promise(r => db.close(() => r()));
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().then(() => console.log('Login flow tests passed (AD/PowerShell simulated; no live domain contacted).'))
  .catch(error => { console.error('FAIL login tests:', error && error.stack || error); process.exitCode = 1; });
