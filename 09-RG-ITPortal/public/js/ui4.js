// ui4.js - nạp SAU ui3.js. Dùng lại các hàm toàn cục: $, J, send, esc, toast, allow, applyRole...

// ===== 1. ĐỔI MẬT KHẨU: modal cùng kiểu với các modal khác (thay cho prompt() của trình duyệt) =====
document.body.insertAdjacentHTML('beforeend', `
<div class="modal fade" id="resetPassModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">
  <div class="modal-header"><h5 class="modal-title fw-bold text-warning"><i class="fa-solid fa-key"></i> Đổi Mật Khẩu: <span id="rpUser"></span></h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
  <form id="rpForm"><div class="modal-body">
    <label class="form-label small text-secondary">Mật khẩu mới:</label>
    <div class="input-group mb-3">
      <input type="password" id="rpPass" class="form-control bg-transparent" autocomplete="new-password" minlength="8" maxlength="256" required>
      <button type="button" class="btn btn-outline-secondary" id="rpEye" title="Hiện/ẩn"><i class="fa-solid fa-eye"></i></button>
      <button type="button" class="btn btn-outline-info" id="rpGen" title="Tạo mật khẩu ngẫu nhiên"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
    </div>
    <label class="form-label small text-secondary">Nhập lại mật khẩu:</label>
    <input type="password" id="rpPass2" class="form-control bg-transparent mb-3" autocomplete="new-password" minlength="8" maxlength="256" required>
    <div class="progress mb-2" style="height:6px"><div id="rpBar" class="progress-bar" style="width:0"></div></div>
    <div class="small text-secondary">Nên dài từ 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt (theo chính sách mật khẩu của domain).</div>
    <div id="rpErr" class="alert alert-danger small mt-3 mb-0 d-none"></div>
  </div><div class="modal-footer"><button type="submit" class="btn btn-warning fw-bold w-100">Xác Nhận Đổi Mật Khẩu</button></div></form>
</div></div></div>`);

let rpTarget = '';
const rpGen = () => {
    const S = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+'], all = S.join('');
    const r = n => crypto.getRandomValues(new Uint32Array(1))[0] % n, c = S.map(s => s[r(s.length)]);
    while (c.length < 14) c.push(all[r(all.length)]);
    for (let i = c.length - 1; i > 0; i--) { const j = r(i + 1);[c[i], c[j]] = [c[j], c[i]]; }
    return c.join('');
};
const rpStrength = () => {
    const p = $('rpPass').value, s = [p.length >= 8, /[A-Z]/.test(p), /[a-z]/.test(p), /\d/.test(p), /[^\w]/.test(p)].filter(Boolean).length, bar = $('rpBar');
    bar.style.width = (p ? s * 20 : 0) + '%'; bar.className = 'progress-bar bg-' + (s <= 2 ? 'danger' : s <= 3 ? 'warning' : 'success');
};
resetPass = u => {
    rpTarget = u; $('rpUser').innerText = u; $('rpForm').reset(); $('rpErr').classList.add('d-none'); rpStrength();
    $('rpPass').type = $('rpPass2').type = 'password'; bootstrap.Modal.getOrCreateInstance($('resetPassModal')).show();
};
$('rpPass').oninput = rpStrength;
$('rpEye').onclick = () => { const t = $('rpPass').type === 'password' ? 'text' : 'password'; $('rpPass').type = $('rpPass2').type = t; };
$('rpGen').onclick = () => { const p = rpGen(); $('rpPass').value = $('rpPass2').value = p; $('rpPass').type = $('rpPass2').type = 'text'; rpStrength(); toast('Đã tạo mật khẩu - hãy ghi lại trước khi xác nhận', 'info'); };
$('rpForm').onsubmit = async e => {
    e.preventDefault(); const err = $('rpErr'); err.classList.add('d-none');
    if ($('rpPass').value !== $('rpPass2').value) { err.innerText = 'Hai mật khẩu không khớp.'; return err.classList.remove('d-none'); }
    const d = await send(`/api/ad/users/${encodeURIComponent(rpTarget)}/reset-password`, { newPassword: $('rpPass').value });
    if (d.success) { bootstrap.Modal.getInstance($('resetPassModal')).hide(); toast(`Đã đổi mật khẩu cho ${rpTarget}`); }
    else { err.innerText = d.error || 'Đổi mật khẩu thất bại (kiểm tra chính sách mật khẩu của domain).'; err.classList.remove('d-none'); }
};

// ===== 2. pfSense: bảng interface + chọn cổng theo dõi =====
const rate = m => m >= 1 ? m.toFixed(2) + ' Mbps' : (m * 1000).toFixed(1) + ' Kbps';
const pfSel = () => localStorage.getItem('rg_pf_if') || '';
function renderPf(d) {
    if (!d.interfaces) return; const w = d.interfaces.wan, L = d.interfaces.list || [];
    if ($('pfWanName') && w) $('pfWanName').innerText = w.name;
    const sel = $('pfSel'), sig = L.map(i => i.name).join();
    if (sel) {
        if (sel.dataset.sig !== sig) { sel.innerHTML = L.map(i => `<option value="${esc(i.name)}">${esc(i.label ? i.label + ' (' + i.name + ')' : i.name)}${i.isWan ? ' - WAN' : ''}</option>`).join(''); sel.dataset.sig = sig; }
        sel.value = w.name; sel.onchange = () => { localStorage.setItem('rg_pf_if', sel.value); refreshCurrentView(); };
    }
    const cur = L.find(i => i.name === (w && w.name)); if ($('pfHuman') && cur) $('pfHuman').innerText = `\u2248 \u2193 ${rate(cur.in_mbps)}  \u00b7  \u2191 ${rate(cur.out_mbps)}`;
    if (!$('pfIfList')) return;
    $('pfIfList').innerHTML = L.map(i => `<tr><td><b>${esc(i.label || i.name)}</b> <small class="text-secondary">${esc(i.name)}</small>${i.isWan ? ' <span class="badge bg-info text-dark">WAN</span>' : ''}</td><td class="text-success">${rate(i.in_mbps)}</td><td class="text-warning">${rate(i.out_mbps)}</td><td>${i.rx_gb.toFixed(2)} GB</td><td>${i.tx_gb.toFixed(2)} GB</td><td>${i.errors ? `<span class="badge bg-danger">${i.errors}</span>` : '0'}</td></tr>`).join('');
}
const _f4 = window.fetch;
window.fetch = async (...a) => {
    const u = String(a[0]); if (/\/api\/network\/pfsense$/.test(u) && pfSel()) a[0] = u + '?if=' + encodeURIComponent(pfSel());
    const r = await _f4(...a); if (/\/api\/network\/pfsense/.test(u)) r.clone().json().then(renderPf).catch(() => {}); return r;
};

// ===== 3. TỔNG QUAN HỆ THỐNG =====
// Dọn mục được thêm bởi bản giao diện cũ nếu SPA đang được nâng cấp nóng.
document.getElementById('nav-approvals')?.remove();
titles.overview = 'Tổng Quan Hệ Thống';
$('nav-zabbix').insertAdjacentHTML('beforebegin', '<a class="nav-link" id="nav-overview" onclick="navigateTo(\'overview\')"><i class="fa-solid fa-gauge-high me-2"></i> Tổng Quan</a>');

['Employee', 'IT-Staff'].forEach(r => { const g = Object.getOwnPropertyDescriptor(allow, r).get;
    Object.defineProperty(allow, r, { configurable: true, enumerable: true, get: () => { const l = g(), p = (curUser && curUser.perms) || {}; return p.zabbix && p.zabbix !== 'none' ? ['overview', ...l] : l; } }); });
const _ar4 = applyRole; applyRole = () => { _ar4(); const a = allow[curUser && curUser.role], n = $('nav-overview'); if (n) n.classList.toggle('d-none', !!a && !a.includes('overview')); };
let firstNav = true; const _n4 = navigateTo;
const PAGES = ['overview', 'zabbix', 'wazuh', 'pfsense', 'ad', 'admin', 'helpdesk', 'audit', 'perm'];
navigateTo = async s => {
    const first = firstNav; firstNav = false;
    if (!PAGES.includes(s) || (first && !location.hash)) s = 'overview';   // chưa có trang đã lưu thì mở Tổng quan
    await _n4(s);
    // Ghi trang hiện tại vào URL (#...) để F5 vẫn ở lại đúng trang; nút Back/Forward cũng hoạt động
    if (location.hash !== '#' + currentSection) (first ? history.replaceState : history.pushState).call(history, null, '', '#' + currentSection);
};
const _r4 = refreshCurrentView; refreshCurrentView = () => { if (curUser && currentSection === 'overview') return loadOverview(); _r4(); };
setInterval(() => { if (curUser && currentSection === 'overview' && !document.hidden) loadOverview(); }, 30000);

async function loadOverview() {
    if (!$('ovKpi')) return;
    const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    const can = mod => curUser?.role === 'Super-Admin' || ['view', 'manage'].includes(curUser?.perms?.[mod]);
    const urls = [get('/api/dashboard/summary'), can('zabbix') ? get('/api/monitoring/zabbix') : null,
      can('wazuh') ? get('/api/security/wazuh') : null, can('pfsense') ? get('/api/network/pfsense') : null,
      can('helpdesk') ? get('/api/tickets') : null, can('vuln') ? get('/api/vuln') : null];
    const [summary, z, w, p, t, vulnData] = await Promise.all(urls);
    if (!$('ovKpi')) return;
    const m = (z && z.metrics) || {}, open = ((z && z.problems) || []).filter(x => x.status === 'PROBLEM'), tk = (Array.isArray(t) ? t : []).filter(x => ['Open', 'InProgress'].includes(x.status)), wan = p && p.interfaces && p.interfaces.wan;
    const alertCount = open.length + Number(w?.sev?.critical || 0) + Number(summary?.vulnerabilities?.critical || 0);
    const hasAlertSource = !!(can('zabbix') && (z?.metrics || Array.isArray(z?.problems))) || !!(can('wazuh') && w?.sev) || !!summary?.vulnerabilities;
    const kpi = (title, big, sub, col) => `<div class="col-6 col-xl-3"><div class="card gauge-box h-100"><small class="text-secondary">${esc(title)}</small><div class="gauge-val my-2" style="color:${/^#[0-9a-f]{6}$/i.test(String(col)) ? col : '#94a3b8'}">${esc(big)}</div><small class="text-secondary">${esc(sub)}</small></div></div>`;
    $('ovKpi').innerHTML = kpi('Cảnh báo cần chú ý', hasAlertSource ? alertCount : '--', 'Zabbix + Wazuh + lỗ hổng nghiêm trọng', alertCount ? '#ef4444' : '#10b981') +
        kpi('Phiếu hỗ trợ đang mở', summary?.tickets?.open ?? (t ? tk.length : '--'), summary?.tickets ? `${summary.tickets.overdue} phiếu quá hạn` : 'theo quyền Helpdesk', summary?.tickets?.overdue ? '#ef4444' : '#f59e0b') +
        kpi('Tài sản mức nghiêm trọng', summary?.assets?.critical ?? '--', summary?.assets ? `${summary.assets.total} tài sản trong danh mục` : 'theo quyền Asset Management', summary?.assets?.critical ? '#ef4444' : '#60a5fa') +
        kpi('Lỗ hổng nghiêm trọng', summary?.vulnerabilities?.critical ?? '--', summary?.vulnerabilities ? `${summary.vulnerabilities.open} lỗ hổng đang mở` : 'theo quyền Vulnerability', summary?.vulnerabilities?.critical ? '#ef4444' : '#10b981');
    const services = [], devices = [];
    const serviceCard = (name, ok, detail) => `<div class="col-6 col-xl-3"><div class="card p-3 h-100"><div class="d-flex justify-content-between align-items-center"><span class="fw-bold">${esc(name)}</span><span class="badge bg-${ok ? 'success' : 'danger'}">${ok ? 'Đang hoạt động' : 'Chưa kết nối'}</span></div><small class="text-secondary mt-2">${esc(detail)}</small></div></div>`;
    if (summary) services.push(serviceCard('Portal / SQLite', true, `Cập nhật ${new Date(summary.generatedAt).toLocaleTimeString('vi-VN')}`));
    if (can('zabbix')) {
        const deviceCard = (host, prefix) => {
            const metrics = [['CPU', m[`${prefix}_cpu`], '#38bdf8'], ['RAM', m[`${prefix}_mem`], '#a78bfa'], ['Disk', m[`${prefix}_disk`], '#34d399']];
            const parsed = metrics.map(([, value]) => Number(value));
            const complete = !!z && parsed.every(value => Number.isFinite(value) && value >= 0);
            const meters = metrics.map(([label, raw, baseColor]) => {
                const value = Number(raw), valid = Number.isFinite(value) && value >= 0;
                const width = valid ? Math.max(0, Math.min(100, value)) : 0;
                const color = valid && value >= 90 ? '#ef4444' : valid && value >= 75 ? '#f59e0b' : baseColor;
                return `<div class="overview-resource"><div class="d-flex justify-content-between align-items-baseline mb-1"><span class="small text-secondary fw-semibold">${label}</span><span class="overview-resource-value" style="color:${color}">${valid ? `${esc(value.toFixed(1))}%` : '--'}</span></div><div class="overview-resource-track"><div class="overview-resource-fill" style="width:${width}%;background:${color}"></div></div></div>`;
            }).join('');
            const issues = (Array.isArray(z?.errors) ? z.errors : []).filter(error => String(error).startsWith(`${host}:`) || String(error).includes(`host "${host}"`));
            const state = !z ? ['danger', 'Không kết nối'] : complete ? ['success', 'Đủ dữ liệu'] : ['warning text-dark', 'Thiếu dữ liệu'];
            return `<div class="col-12 col-xl-6"><div class="card overview-device-card h-100"><div class="d-flex justify-content-between align-items-center mb-3"><div class="d-flex align-items-center gap-2"><span class="overview-device-icon"><i class="fa-solid fa-server"></i></span><div><div class="overview-device-name">${host}</div><div class="small text-secondary">Zabbix monitoring</div></div></div><span class="badge bg-${state[0]}">${state[1]}</span></div><div class="overview-resource-grid">${meters}</div><div class="overview-device-footer"><i class="fa-regular fa-clock me-1"></i>Uptime <strong>${esc(m[`${prefix}_uptime`] ?? '--')}</strong></div>${issues.length ? `<div class="small text-warning mt-2">${esc(issues.join(' · '))}</div>` : ''}</div></div>`;
        };
        devices.push(deviceCard('ROYAL01', 'royal'), deviceCard('LINUX01', 'linux'));
    }
    if (can('wazuh')) services.push(serviceCard('Wazuh SIEM', !!(w && w.sev), w?.errors?.join('; ') || (w?.sev ? `${Number(w.total || 0).toLocaleString('vi-VN')} cảnh báo trong 24 giờ` : 'Không có dữ liệu')));
    if (can('pfsense')) services.push(serviceCard('pfSense / WAN', !!wan, wan ? `${wan.name} · ↓ ${wan.in_speed} / ↑ ${wan.out_speed} Mbps` : 'Không có dữ liệu giao diện WAN'));
    if (summary?.assets) services.push(serviceCard('Tài sản', true, `${summary.assets.total} tài sản · ${summary.assets.critical} tài sản mức Critical`));
    $('ovDevices').innerHTML = devices.join('') || '<div class="col-12 text-secondary small">Không có quyền xem thông số máy chủ Zabbix.</div>';
    $('ovServices').innerHTML = services.join('') || '<div class="col-12 text-secondary small">Chưa có trạng thái dịch vụ khả dụng.</div>';
    $('ovUpdated').textContent = summary ? `Cập nhật lúc ${new Date(summary.generatedAt).toLocaleString('vi-VN')} · tự làm mới mỗi 30 giây` : 'Không tải được tổng quan; hãy làm mới để thử lại.';
    $('ovProb').innerHTML = ((z && z.problems) || []).slice(0, 6).map(x => `<tr><td><small>${esc(x.time)}</small></td><td><span class="badge bg-${x.status === 'RESOLVED' ? 'success' : 'danger'}">${esc(x.status)}</span></td><td><b>${esc(x.host)}</b></td><td>${esc(x.name)}</td></tr>`).join('') || '<tr><td colspan="4" class="text-secondary">Không có dữ liệu</td></tr>';
    $('ovTk').innerHTML = tk.slice(0, 6).map(x => `<tr><td>#${esc(x.id)}</td><td>${esc(x.requester)}</td><td>${esc(x.title)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-secondary">Không có phiếu đang mở</td></tr>';
    const findings = Array.isArray(vulnData?.findings) ? vulnData.findings.filter(x => ['Open', 'InProgress'].includes(x.status)).slice(0, 6) : [];
    $('ovVuln').innerHTML = findings.map(x => `<tr><td><span class="badge bg-${x.severity === 'Critical' ? 'danger' : x.severity === 'High' ? 'warning text-dark' : 'secondary'}">${esc(x.severity)}</span></td><td>${esc(x.asset_name || '—')}</td><td>${esc(x.title)}</td><td>${esc(x.cve || '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="text-secondary">Không có dữ liệu lỗ hổng hoặc bạn chưa có quyền xem.</td></tr>';
}
