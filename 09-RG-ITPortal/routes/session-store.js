'use strict';
// Session store bền vững trên SQLite (thay cho MemoryStore mặc định).
// Lý do: MemoryStore mất sạch phiên mỗi khi Windows Service/Node restart (deploy, crash, node-windows tự khởi động lại)
// => người dùng (nhất là Administrator) bị đá ra và phải đăng nhập lại liên tục, đồng thời MemoryStore còn bị rò bộ nhớ.
const session = require('express-session');

class SQLiteSessionStore extends session.Store {
    constructor(db, options = {}) {
        super();
        this.db = db;
        this.ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : 12 * 60 * 60 * 1000;
        this.ready = new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)', e => e && reject(e));
                db.run('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)', e => e ? reject(e) : resolve());
            });
        });
        this.ready.catch(() => {});   // lỗi khởi tạo được báo qua await store.ready; không để thành unhandledRejection
        this.prune = this.prune.bind(this);
        this.timer = setInterval(this.prune, 15 * 60 * 1000);
        if (this.timer.unref) this.timer.unref();
    }

    _expiry(sess) {
        const exp = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : NaN;
        return Number.isFinite(exp) ? exp : Date.now() + this.ttlMs;
    }

    get(sid, cb) {
        this.ready.then(() => this.db.get('SELECT sess, expires FROM sessions WHERE sid = ?', [sid], (err, row) => {
            if (err) return cb(err);
            if (!row) return cb(null, null);
            if (row.expires <= Date.now()) return this.destroy(sid, () => cb(null, null));
            try { cb(null, JSON.parse(row.sess)); } catch (e) { this.destroy(sid, () => cb(null, null)); }
        }), cb);
    }

    set(sid, sess, cb = () => {}) {
        let payload;
        try { payload = JSON.stringify(sess); } catch (e) { return cb(e); }
        this.ready.then(() => this.db.run('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?,?,?)', [sid, payload, this._expiry(sess)], err => cb(err || null)), cb);
    }

    touch(sid, sess, cb = () => {}) {
        this.ready.then(() => this.db.run('UPDATE sessions SET expires = ? WHERE sid = ?', [this._expiry(sess), sid], err => cb(err || null)), cb);
    }

    destroy(sid, cb = () => {}) {
        this.ready.then(() => this.db.run('DELETE FROM sessions WHERE sid = ?', [sid], err => cb(err || null)), cb);
    }

    // Đăng xuất mọi phiên của một tài khoản (dùng khi cần thu hồi quyền ngay).
    destroyByUser(username, cb = () => {}) {
        const needle = `"username":${JSON.stringify(String(username))}`;
        this.ready.then(() => this.db.run('DELETE FROM sessions WHERE instr(sess, ?) > 0', [needle], function (err) { cb(err || null, this && this.changes); }), cb);
    }

    length(cb) {
        this.ready.then(() => this.db.get('SELECT COUNT(*) AS n FROM sessions WHERE expires > ?', [Date.now()], (err, row) => cb(err || null, row ? row.n : 0)), cb);
    }

    prune(cb = () => {}) {
        this.ready.then(() => this.db.run('DELETE FROM sessions WHERE expires <= ?', [Date.now()], err => {
            if (err && !/closed|MISUSE/i.test(String(err.message))) console.error('[session] Dọn phiên hết hạn thất bại:', err.message);
            cb(err || null);
        }), cb);
    }

    close() { clearInterval(this.timer); }
}

module.exports = SQLiteSessionStore;
