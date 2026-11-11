'use strict';
// Chống dò mật khẩu theo TỪNG TÀI KHOẢN (+ IP), thay cho giới hạn theo IP trước đây.
// Vì sao: toàn bộ máy trạm đi qua cùng một IP (audit log: ~98% đăng nhập đến từ 192.168.10.254), nên giới hạn theo IP
// khiến một người gõ sai mật khẩu là khóa luôn cả Administrator. Ở đây chỉ đếm lần SAI MẬT KHẨU đã được AD xác nhận,
// không đếm request đang chạy, lỗi form hay lỗi AD/PowerShell.
const num = (name, fallback, min, max) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v >= min && v <= max ? v : fallback;
};

function createLoginGuard(options = {}) {
    const maxAttempts = options.maxAttempts ?? num('LOGIN_MAX_ATTEMPTS', 8, 3, 100);
    const windowMs = (options.windowMinutes ?? num('LOGIN_WINDOW_MINUTES', 10, 1, 1440)) * 60000;
    const ipMax = options.ipMaxAttempts ?? num('LOGIN_IP_MAX_ATTEMPTS', 120, 10, 100000);
    const now = options.now || (() => Date.now());
    const byKey = new Map();   // "user|ip" -> [timestamps]
    const byIp = new Map();    // ip -> [timestamps]

    const keyOf = (username, ip) => `${String(username || '').toLowerCase()}|${ip || ''}`;
    const recent = (map, key, t) => {
        const arr = (map.get(key) || []).filter(x => t - x < windowMs);
        if (arr.length) map.set(key, arr); else map.delete(key);
        return arr;
    };
    const prune = t => {
        if (byKey.size + byIp.size < 5000) return;
        for (const k of [...byKey.keys()]) recent(byKey, k, t);
        for (const k of [...byIp.keys()]) recent(byIp, k, t);
    };
    const retry = (arr, t) => Math.max(1, Math.ceil((arr[0] + windowMs - t) / 1000));

    return {
        maxAttempts,
        windowMs,
        check(username, ip) {
            const t = now();
            const u = recent(byKey, keyOf(username, ip), t);
            if (u.length >= maxAttempts) return { blocked: true, scope: 'user', retryAfterSec: retry(u, t) };
            const i = recent(byIp, ip || '', t);
            if (i.length >= ipMax) return { blocked: true, scope: 'ip', retryAfterSec: retry(i, t) };
            return { blocked: false, remaining: maxAttempts - u.length };
        },
        fail(username, ip) {
            const t = now();
            prune(t);
            const k = keyOf(username, ip);
            byKey.set(k, [...recent(byKey, k, t), t]);
            byIp.set(ip || '', [...recent(byIp, ip || '', t), t]);
            return maxAttempts - byKey.get(k).length;
        },
        success(username, ip) { byKey.delete(keyOf(username, ip)); },
        reset(username) {
            const prefix = `${String(username || '').toLowerCase()}|`;
            for (const k of [...byKey.keys()]) if (k.startsWith(prefix)) byKey.delete(k);
        },
        clear() { byKey.clear(); byIp.clear(); }
    };
}

module.exports = { createLoginGuard };
