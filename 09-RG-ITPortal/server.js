'use strict';

const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const helmet = require('helmet');
const perm = require('./routes/perm');
const SQLiteSessionStore = require('./routes/session-store');
const { createLoginGuard } = require('./routes/login-guard');
const adAuth = require('./routes/ad-auth');
const createAuthRouter = require('./routes/auth');

const sessionSecret = String(process.env.SESSION_SECRET || '').trim();
if (sessionSecret.length < 32 || /^(?:REPLACE_|CHANGE_ME|YOUR_SECRET|PUT_YOUR_)/i.test(sessionSecret)) {
    console.error('SESSION_SECRET chưa được cấu hình an toàn. Hãy đặt chuỗi ngẫu nhiên tối thiểu 32 ký tự trong file .env.');
    process.exit(1);
}

function envBoolean(name, fallback) {
    const raw = process.env[name];
    if (raw == null || String(raw).trim() === '') return fallback;
    if (/^(1|true|yes|on)$/i.test(String(raw).trim())) return true;
    if (/^(0|false|no|off)$/i.test(String(raw).trim())) return false;
    throw new Error(`${name} phải là true/false (hoặc 1/0).`);
}

function resolveDbPath() {
    const configured = String(process.env.DB_PATH || '').trim();
    if (!configured) return path.resolve(__dirname, 'itportal.db');
    return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(__dirname, configured);
}

function parseTrustProxy(raw) {
    const value = String(raw ?? '').trim();
    if (!value || /^(false|0|no|off)$/i.test(value)) return false;
    if (/^(true|yes|on)$/i.test(value)) return true;
    if (/^\d+$/.test(value)) return Number(value);
    const parts = value.split(',').map(part => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts : value;
}

function parsePort(raw) {
    const value = Number(raw == null || String(raw).trim() === '' ? 80 : raw);
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error('PORT phải là số nguyên trong khoảng 0–65535.');
    }
    return value;
}

const dbRun = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) { if (error) reject(error); else resolve({ changes: this.changes, lastID: this.lastID }); });
});
const dbGet = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
});

async function initializeDatabase(db) {
    // Run the pragmas before normal application queries. All paths are absolute so
    // a Windows Service working directory cannot accidentally create a second DB.
    await dbGet(db, 'PRAGMA journal_mode = WAL');
    await dbRun(db, 'PRAGMA synchronous = NORMAL');
    await dbRun(db, 'PRAGMA foreign_keys = ON');
    await dbRun(db, 'PRAGMA wal_autocheckpoint = 1000');

    await dbRun(db, `CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT, requester TEXT, type TEXT, title TEXT,
        priority TEXT, status TEXT DEFAULT 'Open', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        username TEXT, description TEXT, assignee TEXT, resolution TEXT, updated_at DATETIME,
        asset_id INTEGER, external_source TEXT, external_id TEXT, first_response_at TEXT,
        resolved_at TEXT, response_due_at TEXT, resolution_due_at TEXT
    )`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, method TEXT,
        path TEXT, status INTEGER, ip TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await dbRun(db, `CREATE TABLE IF NOT EXISTS ticket_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER, username TEXT,
        fullname TEXT, role TEXT, body TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Indices kept idempotent for upgrades from older database schemas.
    await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)');
    await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_tickets_status_created ON tickets(status, created_at)');
    await dbRun(db, 'CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket_id ON ticket_comments(ticket_id, id)');

    const rawDays = Number(process.env.AUDIT_RETENTION_DAYS || 180);
    const retentionDays = Number.isInteger(rawDays) && rawDays >= 1 && rawDays <= 3650 ? rawDays : 180;
    if (retentionDays !== rawDays) console.warn('AUDIT_RETENTION_DAYS không hợp lệ; dùng mặc định 180 ngày.');
    await dbRun(db, "DELETE FROM audit_log WHERE datetime(created_at) < datetime('now', ?)", [`-${retentionDays} days`]);
    return { retentionDays };
}

function createApp(db, options = {}) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', options.trustProxy ?? parseTrustProxy(process.env.TRUST_PROXY));

    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb', parameterLimit: 1000 }));

    // COOKIE_SECURE trống/auto: chỉ gắn cờ Secure khi kết nối thật sự là HTTPS. Trước đây NODE_ENV=production (Windows Service)
    // bật Secure cứng, nên khi truy cập bằng http:// trình duyệt vứt cookie phiên => đăng nhập "thành công" nhưng ngay sau đó bị đá ra.
    const rawSecure = String(process.env.COOKIE_SECURE ?? '').trim().toLowerCase();
    const secureCookie = options.cookieSecure ?? (rawSecure === '' || rawSecure === 'auto' ? 'auto' : envBoolean('COOKIE_SECURE', 'auto'));
    const sessionHours = Number(process.env.SESSION_HOURS);
    const sessionTtlMs = (Number.isFinite(sessionHours) && sessionHours >= 1 && sessionHours <= 168 ? sessionHours : 12) * 60 * 60 * 1000;
    // Session lưu trong SQLite: restart service / deploy / crash không còn làm mất phiên đăng nhập.
    const sessionStore = options.sessionStore || new SQLiteSessionStore(db, { ttlMs: sessionTtlMs });
    app.locals.sessionStore = sessionStore;
    app.use(session({
        name: 'rg.sid',
        secret: process.env.SESSION_SECRET,
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: { maxAge: sessionTtlMs, httpOnly: true, sameSite: 'lax', secure: secureCookie }
    }));

    // /views chứa mẫu giao diện nội bộ: chỉ phục vụ sau khi đăng nhập.
    app.use('/views', (req, res, next) => req.session?.user ? next() : res.status(401).type('text/plain').send('Chưa đăng nhập'));
    app.use(express.static(path.join(__dirname, 'public'), {
        etag: true,
        maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
        // HTML luôn kiểm tra lại: nếu index.html bị trình duyệt giữ 1 giờ thì người dùng vẫn chạy JS bản cũ sau khi nâng cấp.
        setHeaders: (res, filePath) => { if (/\.html?$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache'); }
    }));

    // Do not mutate arbitrary request strings here. Escaping HTML on input corrupts
    // valid YAML (for example the folded scalar marker '>') and user-entered text.
    // Validate per endpoint and escape dynamic values at the HTML-rendering boundary.
    app.use('/api', (req, res, next) => {
        if (req.method !== 'GET' || /^\/api\/ad\/computers\/[^/]+\/laps-password(?:\?|$)/i.test(req.originalUrl)) {
            const priorUser = req.session && req.session.user;
            const fullPath = String(req.originalUrl || req.path || '').split('?')[0].slice(0, 300);   // đường dẫn đầy đủ (gồm /api/...)
            res.on('finish', () => {
                const user = priorUser || (req.session && req.session.user) || { username: '', role: '' };
                const name = user.username || req.auditUsername || '';   // đăng nhập thất bại vẫn ghi lại tên tài khoản đã thử
                db.run('INSERT INTO audit_log (username, role, method, path, status, ip) VALUES (?,?,?,?,?,?)',
                    [name, user.role || '', req.method, fullPath, res.statusCode, req.ip], error => {
                        if (error && !/closed|MISUSE/i.test(String(error.message))) console.error('[audit] Không ghi được audit log:', error.message);
                    });
            });
        }
        next();
    });

    // Chặn CSRF/cross-origin cho mọi thao tác ghi: Origin (nếu trình duyệt gửi) phải trùng Host của Portal.
    const extraOrigins = new Set(String(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
    app.use('/api', (req, res, next) => {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
        const origin = req.get('origin');
        if (!origin) return next();   // gọi trực tiếp (curl, script); cookie SameSite=Lax đã chặn gửi chéo trang
        let originHost = '';
        try { originHost = new URL(origin).host.toLowerCase(); } catch (_) { /* Origin: null / sai định dạng */ }
        const forwarded = app.get('trust proxy') ? String(req.get('x-forwarded-host') || '').split(',')[0].trim().toLowerCase() : '';
        const hostHeader = String(req.get('host') || '').toLowerCase();
        if (originHost && (originHost === hostHeader || (forwarded && originHost === forwarded) || extraOrigins.has(origin.toLowerCase()))) return next();
        return res.status(403).json({ error: 'Yêu cầu bị từ chối: nguồn gốc (Origin) không khớp với Portal.' });
    });

    const requireAuth = (req, res, next) => req.session?.user ? next() : res.status(401).json({ error: 'Chưa đăng nhập' });
    const superOnly = (req, res, next) => req.session?.user?.role === 'Super-Admin' ? next() : res.status(403).json({ error: 'Chỉ Super-Admin' });

    // Đăng nhập: giới hạn theo TÀI KHOẢN + IP, chỉ đếm lần sai mật khẩu đã được AD xác nhận (xem routes/login-guard.js).
    const loginGuard = options.loginGuard || createLoginGuard();
    app.locals.loginGuard = loginGuard;
    app.use('/api/auth', createAuthRouter({
        authenticate: options.authenticate || adAuth.authenticate,
        normalizeLogin: adAuth.normalizeLogin,
        guard: loginGuard,
        verbose: envBoolean('LOGIN_VERBOSE_ERRORS', true)
    }));
    app.get('/api/health', async (req, res) => {
        try {
            const row = await dbGet(db, 'SELECT 1 AS ok');
            if (!row || row.ok !== 1) throw new Error('SQLite probe returned an unexpected result');
            res.json({ ok: true, database: 'ok', uptime: Math.round(process.uptime()), version: require('./package.json').version });
        } catch (error) {
            console.error('[health] Database probe failed:', error.message);
            res.status(503).json({ ok: false, database: 'error', error: 'Database chưa sẵn sàng' });
        }
    });

    app.use('/api', requireAuth);
    app.use('/api/monitoring', perm.need('zabbix', 'view'), require('./routes/monitoring'));
    app.use('/api/security', perm.need('wazuh', 'view'), require('./routes/security'));
    app.use('/api/network', (req, res, next) => {
        if (req.path === '/computer-leases') return perm.need('computers', 'view')(req, res, next);
        return perm.need('pfsense', 'view')(req, res, next);
    }, require('./routes/network'));
    app.use('/api/ad', (req, res, next) => {
        const isComputerRoute = req.path === '/computers' || req.path === '/computer-ous' || req.path === '/computer-diagnostics' || req.path.startsWith('/computers/');
        const moduleName = isComputerRoute ? 'computers' : 'ad';
        const level = req.method === 'GET' || (req.method === 'POST' && /^\/users\/[\w.\-]+\/reset-password$/.test(req.path)) ? 'view' : 'manage';
        return perm.need(moduleName, level)(req, res, next);
    }, require('./routes/ad'));
    app.use('/api/admin', (req, res, next) => perm.need('admin', req.method === 'GET' ? 'view' : 'manage')(req, res, next), require('./routes/admin'));
    app.use('/api/docker', (req, res, next) => perm.need('docker', req.method === 'GET' ? 'view' : 'manage')(req, res, next), require('./routes/docker'));
    const assetsRouter = require('./routes/assets')(db);
    app.use('/api/assets', (req, res, next) => perm.need('assets', req.method === 'GET' ? 'view' : 'manage')(req, res, next), assetsRouter);
    app.use('/api/vuln', (req, res, next) => perm.need('vuln', req.method === 'GET' ? 'view' : 'manage')(req, res, next), require('./routes/vuln')(db));
    app.use('/api/reports', perm.need('reports', 'view'), require('./routes/reports')(db));
    app.use('/api/platforms', perm.need('platforms', 'view'), require('./routes/platforms'));
    app.use('/api/deleg', require('./routes/deleg')(db));
    app.locals.ready = Promise.allSettled([sessionStore.ready, assetsRouter.ready].filter(Boolean));   // chờ các bảng/migration trước khi nhận thao tác
    app.use('/api/dashboard', require('./routes/dashboard')(db));
    app.post('/api/tickets/:id/resolve', perm.need('helpdesk', 'manage'));
    app.use('/api/tickets', perm.need('helpdesk', 'view'));
    app.use('/api', require('./routes/helpdesk')(db));
    app.use('/api/permissions', superOnly, perm.router(db));
    app.get('/api/audit', superOnly, (req, res) => db.all("SELECT username, role, method, path, status, ip, datetime(created_at,'localtime') AS time FROM audit_log ORDER BY id DESC LIMIT 300", (error, rows) => {
        if (error) return res.status(500).json({ error: 'Không đọc được audit log' });
        res.json(rows || []);
    }));

    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        console.error('[http]', err && err.stack ? err.stack : err);
        res.status(500).json({ error: 'Lỗi máy chủ' });
    });
    return app;
}

async function startServer() {
    const dbPath = resolveDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new sqlite3.Database(dbPath);
    db.configure('busyTimeout', 5000);
    // Một câu lệnh db.run không có callback mà lỗi sẽ phát sự kiện 'error' và làm sập Node; ghi log thay vì chết dịch vụ.
    db.on('error', error => console.error('[db] Lỗi SQLite không bắt được:', error && error.message || error));
    try {
        const dbSetup = await initializeDatabase(db);
        await perm.init(db);
        await dbGet(db, 'PRAGMA wal_checkpoint(PASSIVE)').catch(() => {});   // gộp WAL còn tồn từ lần chạy trước
        console.log(`[db] SQLite: ${dbPath} | journal=WAL | audit retention=${dbSetup.retentionDays} days`);
        const retentionTimer = setInterval(() => {
            db.run("DELETE FROM audit_log WHERE datetime(created_at) < datetime('now', ?)", [`-${dbSetup.retentionDays} days`], error => {
                if (error) console.error('[audit] Cleanup failed:', error.message);
            });
        }, 24 * 60 * 60 * 1000);
        retentionTimer.unref();

        const port = parsePort(process.env.PORT);
        const app = createApp(db);
        await app.locals.ready;   // chờ session store + migration tài sản xong trước khi nhận kết nối
        const server = await new Promise((resolve, reject) => {
            const instance = app.listen(port, '0.0.0.0');
            const onError = error => {
                instance.off('listening', onListening);
                if (error.code === 'EADDRINUSE') error.message = `Cổng ${port} đang bị chiếm. Hãy dừng instance/service cũ hoặc đặt PORT trong .env sang cổng trống.`;
                reject(error);
            };
            const onListening = () => { instance.off('error', onError); resolve(instance); };
            instance.once('error', onError);
            instance.once('listening', onListening);
        });
        const actualPort = server.address().port;
        const portSuffix = actualPort === 80 ? '' : `:${actualPort}`;
        console.log(`ROYALGROUP IT Portal v${require('./package.json').version} đang chạy tại http://itportal.royal.local${portSuffix} (cũng truy cập được qua http://localhost${portSuffix})`);

        let closing = false;
        const shutdown = signal => {
            if (closing) return;
            closing = true;
            console.log(`[shutdown] Nhận ${signal}; đang dừng HTTP server và SQLite...`);
            clearInterval(retentionTimer);
            try { app.locals.sessionStore.close(); } catch (_) {}
            const forceTimer = setTimeout(() => {
                console.error('[shutdown] Hết thời gian chờ; buộc thoát.');
                try { server.closeAllConnections?.(); } catch (_) {}
                process.exit(1);
            }, 10000);
            forceTimer.unref();
            server.close(() => db.close(error => {
                clearTimeout(forceTimer);
                if (error) { console.error('[shutdown] SQLite close failed:', error.message); process.exitCode = 1; }
                else console.log('[shutdown] Đã dừng an toàn.');
            }));
        };
        process.once('SIGINT', () => shutdown('SIGINT'));
        process.once('SIGTERM', () => shutdown('SIGTERM'));
        return { app, server, db, shutdown, dbPath };
    } catch (error) {
        console.error('[startup] Không khởi động được Portal:', error.message);
        db.close(() => {});
        throw error;
    }
}

if (require.main === module) {
    // Lỗi bất đồng bộ lẻ (ví dụ SSH/axios bị ngắt giữa chừng) chỉ ghi log, không làm dừng cả Portal.
    process.on('unhandledRejection', reason => console.error('[process] unhandledRejection:', reason && reason.stack || reason));
    process.on('uncaughtException', error => {
        console.error('[process] uncaughtException:', error && error.stack || error);
        if (error && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) process.exit(1);   // lỗi nghiêm trọng khi khởi động thì thoát để service báo rõ
    });
    startServer().catch(error => {
        console.error('[startup] Portal dừng vì lỗi cấu hình hoặc database.');
        process.exitCode = 1;
    });
}

module.exports = { createApp, initializeDatabase, resolveDbPath, parseTrustProxy, parsePort, envBoolean, startServer };
