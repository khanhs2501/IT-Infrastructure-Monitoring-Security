'use strict';
const express = require('express');

const sessionCall = (sessionObject, method) => new Promise((resolve, reject) => {
    sessionObject[method](error => error ? reject(error) : resolve());
});

// Thông báo cho người dùng. Mã `code` giúp giao diện phân biệt từng tình huống.
const MESSAGES = {
    invalid_credentials: 'Tên tài khoản hoặc mật khẩu không chính xác.',
    locked_out: 'Tài khoản đang bị KHÓA trong Active Directory (thường do nhập sai mật khẩu nhiều lần). Hãy đợi hết thời gian khóa của domain hoặc nhờ IT mở khóa (Unlock-ADAccount).',
    disabled: 'Tài khoản đã bị vô hiệu hóa trong Active Directory.',
    password_expired: 'Mật khẩu không đúng hoặc đã hết hạn. Nếu chắc chắn đúng mật khẩu, hãy liên hệ IT để đặt lại.',
    bad_format: 'Tên tài khoản hoặc mật khẩu không đúng định dạng. Có thể nhập: tên, DOMAIN\\tên hoặc tên@domain.',
    unavailable: 'Không thể xác thực với Active Directory lúc này (PowerShell/AD chưa sẵn sàng). Đây KHÔNG phải sai mật khẩu — hãy thử lại sau ít giây.'
};

module.exports = function createAuthRouter({ authenticate, guard, normalizeLogin, verbose = true } = {}) {
    const router = express.Router();

    router.post('/login', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const rawUser = typeof req.body?.username === 'string' ? req.body.username : '';
        const password = req.body?.password;
        const parsed = normalizeLogin(rawUser);
        req.auditUsername = parsed ? parsed.sam : String(rawUser).trim().slice(0, 64);   // ghi nhật ký cả tên đã thử khi đăng nhập thất bại
        if (!parsed || typeof password !== 'string' || password.length < 1 || password.length > 256 || password.includes('\u0000')) {
            return res.status(400).json({ error: MESSAGES.bad_format, code: 'bad_format' });
        }

        const gate = guard.check(parsed.sam, req.ip);
        if (gate.blocked) {
            const minutes = Math.ceil(gate.retryAfterSec / 60);
            res.set('Retry-After', String(gate.retryAfterSec));
            return res.status(429).json({
                error: gate.scope === 'user'
                    ? `Tài khoản "${parsed.sam}" đã nhập sai quá ${guard.maxAttempts} lần. Thử lại sau khoảng ${minutes} phút. (Các tài khoản khác không bị ảnh hưởng.)`
                    : `Có quá nhiều lần đăng nhập sai từ địa chỉ này. Thử lại sau khoảng ${minutes} phút.`,
                code: 'rate_limited', retryAfter: gate.retryAfterSec
            });
        }

        const outcome = await authenticate(rawUser, password);

        if (!outcome.ok) {
            if (outcome.reason === 'bad_format') return res.status(400).json({ error: MESSAGES.bad_format, code: 'bad_format' });
            if (outcome.reason === 'unavailable') {
                // Lỗi hạ tầng: KHÔNG tính vào số lần sai mật khẩu.
                console.error(`[auth] AD/PowerShell không khả dụng khi đăng nhập "${parsed.sam}": ${outcome.detail || 'no detail'}`);
                return res.status(503).json({
                    error: MESSAGES.unavailable,
                    code: outcome.timedOut ? 'ad_timeout' : 'ad_unavailable',
                    detail: verbose ? String(outcome.detail || '').slice(0, 300) : undefined
                });
            }
            const left = guard.fail(parsed.sam, req.ip);
            console.warn(`[auth] Đăng nhập thất bại "${parsed.sam}" (${outcome.reason}) từ ${req.ip}; còn ${Math.max(0, left)} lần trước khi Portal tạm chặn.`);
            const reason = MESSAGES[outcome.reason] ? outcome.reason : 'invalid_credentials';
            const shown = !verbose && reason !== 'invalid_credentials' ? 'invalid_credentials' : reason;
            return res.status(401).json({ error: MESSAGES[shown], code: shown, attemptsLeft: Math.max(0, left) });
        }

        try {
            await sessionCall(req.session, 'regenerate');   // chống session fixation
            req.session.user = outcome.user;
            await sessionCall(req.session, 'save');          // chỉ trả thành công SAU KHI phiên đã được lưu bền vững
        } catch (error) {
            console.error('[auth] Không lưu được phiên đăng nhập:', error.message);
            return res.status(500).json({ error: 'Đăng nhập hợp lệ nhưng không tạo được phiên làm việc. Vui lòng thử lại.', code: 'session_error' });
        }
        guard.success(parsed.sam, req.ip);
        req.auditUsername = outcome.user.username;
        try { Promise.resolve(require('./deleg').managedBy(outcome.user.username)).catch(() => {}); } catch (_) {}   // làm nóng đệm OU để /me trả nhanh
        return res.json({ success: true, user: outcome.user });
    });

    router.get('/me', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const user = req.session?.user;
        if (!user) return res.json(null);
        // managedBy chạy PowerShell (có đệm 60 giây). Không để AD chậm làm treo cả trang sau đăng nhập: tối đa 5 giây.
        let managed = [];
        try {
            managed = await Promise.race([
                require('./deleg').managedBy(user.username),
                new Promise(resolve => setTimeout(() => resolve([]), 5000).unref?.())
            ]);
        } catch (_) {}
        res.json({ ...user, perms: require('./perm').forUser(user), managed });
    });

    router.post('/logout', (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!req.session) return res.json({ success: true });
        req.session.destroy(error => {
            if (error) return res.status(500).json({ success: false, error: 'Không thể kết thúc phiên hiện tại.' });
            res.clearCookie('rg.sid', { httpOnly: true, sameSite: 'lax', secure: !!req.secure });
            res.json({ success: true });
        });
    });

    return router;
};
