// Đăng nhập & phiên làm việc (v1.7.0). Nạp CUỐI CÙNG để bọc fetch bên ngoài các lớp ui*.js.
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    let busy = false, expiredShown = false;

    function setAlert(message, kind) {
        const box = $('loginAlert');
        if (!box) return;
        if (!message) { box.classList.add('d-none'); box.textContent = ''; return; }
        box.className = `alert alert-${kind || 'danger'} py-2 small`;
        box.textContent = message;
    }
    window.rgLoginNotice = setAlert;

    function showLogin(message, kind) {
        try { curUser = null; } catch (_) { /* curUser do app.js khai báo */ }
        const main = $('mainApp'), login = $('loginScreen');
        if (main) main.classList.add('d-none');
        if (login) login.classList.remove('d-none');
        const pass = $('loginPass'); if (pass) pass.value = '';
        setAlert(message, kind || 'warning');
        const user = $('loginUser'); if (user) { if (!user.value) user.focus(); else if (pass) pass.focus(); }
    }

    function setBusy(on) {
        busy = on;
        const btn = $('loginBtn'), spin = $('loginBtnSpin'), text = $('loginBtnText');
        if (btn) btn.disabled = on;
        if (spin) spin.classList.toggle('d-none', !on);
        if (text) text.textContent = on ? 'Đang xác thực với Active Directory…' : 'Xác Thực Danh Tính (SSO)';
    }

    async function submitLogin(event) {
        event.preventDefault();
        if (busy) return;   // chống bấm nhiều lần: mỗi lần là một tiến trình PowerShell và có thể tính vào chính sách khóa của AD
        const username = ($('loginUser').value || '').trim(), password = $('loginPass').value || '';
        if (!username || !password) { setAlert('Hãy nhập đủ tài khoản và mật khẩu.', 'warning'); return; }
        setBusy(true); setAlert('');
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 100000);
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST', credentials: 'same-origin', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            let data = null;
            try { data = await res.json(); } catch (_) { /* máy chủ/proxy trả không phải JSON */ }
            if (res.ok && data && data.success) {
                try { localStorage.setItem('rg_last_user', username); } catch (_) {}
                $('loginPass').value = '';
                expiredShown = false;
                await checkAuth();
                if (!curUser) setAlert('Xác thực thành công nhưng trình duyệt không giữ được phiên đăng nhập. Kiểm tra: cookie bị chặn, hoặc Portal đang chạy HTTP trong khi COOKIE_SECURE=true trong .env.', 'danger');
                return;
            }
            const fallback = res.status === 429 ? 'Đăng nhập sai quá nhiều lần, vui lòng đợi rồi thử lại.'
                : res.status === 503 ? 'Active Directory/PowerShell chưa sẵn sàng. Đây không phải sai mật khẩu — thử lại sau ít giây.'
                : `Đăng nhập thất bại (HTTP ${res.status}).`;
            setAlert((data && data.error) || fallback, res.status === 503 || res.status === 429 ? 'warning' : 'danger');
            if (res.status === 401 || res.status === 400) { $('loginPass').value = ''; $('loginPass').focus(); }
        } catch (error) {
            setAlert(error && error.name === 'AbortError'
                ? 'Quá thời gian chờ phản hồi từ Portal. Máy chủ AD có thể đang chậm — hãy thử lại.'
                : 'Không kết nối được tới Portal. Kiểm tra dịch vụ RoyalGroup IT Portal đang chạy rồi thử lại.', 'danger');
        } finally { clearTimeout(timer); setBusy(false); }
    }

    const form = $('loginForm');
    if (form) form.onsubmit = submitLogin;

    const toggle = $('loginTogglePass');
    if (toggle) toggle.onclick = () => {
        const input = $('loginPass'), show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.innerHTML = `<i class="fa-solid fa-eye${show ? '-slash' : ''}"></i>`;
    };

    try { const last = localStorage.getItem('rg_last_user'); if (last && $('loginUser') && !$('loginUser').value) { $('loginUser').value = last; $('loginPass').focus(); } } catch (_) {}

    // Phiên hết hạn / Portal vừa khởi động lại: đưa người dùng về màn hình đăng nhập kèm lời giải thích,
    // thay vì để các bảng dữ liệu trống và toast lặp đi lặp lại.
    const baseFetch = window.fetch;
    window.fetch = async function (...args) {
        const res = await baseFetch.apply(this, args);
        if (res.status === 401 && curUser && !expiredShown) {
            try {
                const target = new URL(String(args[0] && args[0].url ? args[0].url : args[0]), location.origin);
                if (target.pathname.startsWith('/api/') && !target.pathname.startsWith('/api/auth/')) {
                    expiredShown = true;
                    showLogin('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'warning');
                }
            } catch (_) {}
        }
        return res;
    };
})();
