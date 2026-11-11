// ui5.js - nạp SAU ui4.js. Trang "Thư Mục Phòng Ban" + vai trò riêng từng IT-Staff
titles.deleg = 'Phân Quyền Thư Mục Phòng Ban'; PAGES.push('deleg');
$('nav-ad').insertAdjacentHTML('afterend', '<a class="nav-link" id="nav-deleg" onclick="navigateTo(\'deleg\')"><i class="fa-solid fa-folder-tree me-2"></i> Thư Mục Phòng Ban</a>');

// Trưởng phòng (kể cả Employee) vẫn vào được trang này; IT thì theo quyền cá nhân (perms.deleg)
['Employee', 'IT-Staff'].forEach(r => { const g = Object.getOwnPropertyDescriptor(allow, r).get;
    Object.defineProperty(allow, r, { configurable: true, enumerable: true, get: () => { const l = g(); return curUser && curUser.managed && curUser.managed.length && !l.includes('deleg') ? [...l, 'deleg'] : l; } }); });
const _ar5 = applyRole; applyRole = () => { _ar5(); const a = allow[curUser && curUser.role], n = $('nav-deleg'); if (n) n.classList.toggle('d-none', !!a && !a.includes('deleg')); };
const _r5 = refreshCurrentView; refreshCurrentView = () => { if (curUser && currentSection === 'deleg') return loadDeleg(); _r5(); };

// ===== Thư Mục Phòng Ban =====
const D = { depts: [], dept: '', sub: '' }, LV = { read: 'Đọc', write: 'Ghi', none: 'Thu hồi' }, BASE = { none: 'Không (chỉ thấy thư mục gốc)', read: 'Chỉ đọc', write: 'Đọc / Ghi' };
document.body.insertAdjacentHTML('beforeend', `
<div class="modal fade" id="dgModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content">
  <div class="modal-header"><h5 class="modal-title fw-bold text-success"><i class="fa-solid fa-user-lock"></i> Cấp Quyền Thư Mục: <span id="dgTitle"></span></h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
  <form id="dgForm"><div class="modal-body">
    <label class="form-label small text-secondary">Người nhận:</label><select id="dgUser" class="form-select bg-transparent mb-1" required></select><div id="dgAllWrap" class="form-check mb-3 d-none"><input type="checkbox" id="dgAll" class="form-check-input"><label class="form-check-label small text-secondary" for="dgAll">Hiện cả người ngoài phòng (chỉ Super-Admin / IT)</label></div>
    <label class="form-label small text-secondary">Mức quyền:</label><select id="dgLevel" class="form-select bg-transparent mb-3"><option value="read">Chỉ đọc</option><option value="write">Đọc / Ghi</option><option value="none">Thu hồi quyền</option></select>
    <label class="form-label small text-secondary">Hết hạn lúc: <span id="dgUntilReq"></span></label>
    <div class="input-group mb-3"><input type="datetime-local" id="dgUntil" class="form-control bg-transparent"><button type="button" class="btn btn-outline-secondary" data-days="1">1 ngày</button><button type="button" class="btn btn-outline-secondary" data-days="3">3 ngày</button><button type="button" class="btn btn-outline-secondary" data-days="7">7 ngày</button></div>
    <label class="form-label small text-secondary">Lý do: <span id="dgReasonReq"></span></label><input id="dgReason" class="form-control bg-transparent" maxlength="200" placeholder="VD: Trưởng phòng đi công tác, cần xử lý hồ sơ gấp">
    <div id="dgHint" class="small text-secondary mt-3"></div>
  </div><div class="modal-footer"><button type="submit" class="btn btn-success fw-bold w-100">Xác Nhận</button></div></form>
</div></div></div>`);
let dgRel = '';
function copyText(t) {   // trang chạy http nên navigator.clipboard có thể không dùng được -> dự phòng execCommand
    const done = () => toast('Đã sao chép: ' + t, 'info');
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(done);
    const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); a.remove(); done();
}
const curDept = () => D.depts.find(x => x.name === D.dept) || {};
const dtLocal = ms => { const d = new Date(ms - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

async function loadDeleg() {
    if (!$('dgDept')) return;
    const d = await J('/api/deleg/depts'); D.depts = Array.isArray(d) ? d : [];
    const sel = $('dgDept'); sel.innerHTML = D.depts.map(x => `<option value="${esc(x.name)}">${esc(x.name)}${x.path ? '' : ' (chưa thiết lập)'}</option>`).join('');
    if (!D.depts.some(x => x.name === D.dept)) { D.dept = (D.depts.find(x => x.path) || D.depts[0] || {}).name || ''; D.sub = ''; }
    sel.value = D.dept; sel.onchange = () => { D.dept = sel.value; D.sub = ''; loadDeleg(); };
    const c = curDept(), isSuper = curUser.role === 'Super-Admin';
    $('dgInfo').innerHTML = !c.name ? 'Bạn chưa được giao phòng ban nào.' : `Vai trò của bạn: <b>${{ 'Super-Admin': 'Super-Admin', Manager: 'Trưởng phòng', IT: 'IT hỗ trợ (cấp tạm thời, ghi lý do)' }[c.role]}</b> · Trưởng phòng: <b>${esc(c.manager || 'chưa đặt')}</b> · Thư mục gốc: <code>${esc(c.path || '--')}</code>` + (c.path ? (c.unc ? `<br>Nhân viên truy cập qua: <code>${esc(c.unc)}</code> <a href="javascript:void 0" data-copy="${esc(c.unc)}">Sao chép</a>` : '<br><span class="text-warning">Chưa thấy share cho thư mục này - Super-Admin bấm Lưu để tạo share.</span>') : '');
    $('dgCfg').classList.toggle('d-none', !(isSuper && c.name));
    if (c.name) $('dgInfo').innerHTML += `<br>Quyền mặc định của cả phòng trên thư mục con: <b>${BASE[c.base] || 'Chỉ đọc'}</b> (thư mục đặt <span class="badge bg-danger">Hạn chế</span> thì cả phòng không vào được)`;
    if (isSuper && c.name) {
        $('dgPath').value = c.path || ''; $('dgBase').value = c.base || 'read';
        const us = await J(`/api/deleg/users?dept=${encodeURIComponent(c.name)}`);
        $('dgMgr').innerHTML = '<option value="">(Không đặt trưởng phòng)</option>' + (Array.isArray(us) ? us : []).filter(u => !/^G_/.test(u.SamAccountName)).map(u => `<option value="${esc(u.SamAccountName)}">${esc(u.Name)} (${esc(u.SamAccountName)})</option>`).join('');
        $('dgMgr').value = c.manager || '';
    }
    if (c.path) await Promise.all([loadFolders(), loadHistory()]); else { $('dgFolders').innerHTML = '<tr><td colspan="4" class="text-secondary">Phòng này chưa được thiết lập thư mục gốc</td></tr>'; $('dgHist').innerHTML = ''; $('dgCrumb').innerHTML = ''; }
}
async function loadFolders() {
    const d = await J(`/api/deleg/folders?dept=${encodeURIComponent(D.dept)}&sub=${encodeURIComponent(D.sub)}`), rows = d.folders || [], parts = D.sub ? D.sub.split('/') : [], c = curDept(), canMode = c.role !== 'IT';
    const DL = { none: 'Không', read: 'Đọc', write: 'Đọc/Ghi' }, cur = d.current;
    if (d.error) toast('Không đọc được thư mục: ' + d.error, 'danger');
    const lock = '<span class="badge bg-danger"><i class="fa-solid fa-lock me-1"></i>Hạn chế</span>', modeLink = (rel, restricted, txt) => canMode ? ` <a href="javascript:void 0" class="small ms-1" data-mode="${esc(rel)}|${restricted ? 'inherit' : 'restricted'}">${txt}</a>` : '';
    $('dgCrumb').innerHTML = `<a href="javascript:void 0" data-sub="">${esc(D.dept)}</a>` + parts.map((p, i) => ` / <a href="javascript:void 0" data-sub="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</a>`).join('')
        + (cur ? ` <span class="ms-3 text-nowrap">· Thư mục này: ${cur.restricted ? lock : cur.parentRestricted ? '<span class="badge bg-warning text-dark">Theo thư mục cha (Hạn chế)</span>' : `<span class="badge bg-secondary">Cả phòng: ${DL[d.base]}</span>`}${modeLink(cur.rel, cur.restricted, cur.restricted ? 'Mở lại' : 'Hạn chế thư mục này')}</span>` : '');
    $('dgFolders').innerHTML = rows.map(f => `<tr><td><a href="javascript:void 0" class="fw-bold text-warning" data-sub="${esc(f.rel)}"><i class="fa-regular fa-folder me-2"></i>${esc(f.name)}</a></td>
        <td class="text-nowrap">${f.restricted ? lock : f.parentRestricted ? '<span class="badge bg-warning text-dark" title="Thư mục cha đang Hạn chế nên thư mục này cũng không mở cho cả phòng">Theo thư mục cha</span>' : `<span class="badge bg-secondary" title="Kế thừa quyền chung của phòng">Cả phòng: ${DL[d.base]}</span>`}${modeLink(f.rel, f.restricted, f.restricted ? 'Mở lại' : 'Hạn chế')}</td>
        <td>${f.exposed.map(x => `<span class="badge bg-danger me-1" title="Ai trong domain cũng truy cập được thư mục này">⚠ ${esc(x)}</span>`).join('')}${f.exposed.length && canMode ? `<a href="javascript:void 0" class="small me-2" data-unexpose="${esc(f.rel)}">Gỡ quyền công khai</a>` : ''}${f.aces.map(a => `<span class="badge bg-${a.level === 'write' ? 'success' : 'info text-dark'} me-1">${/^G_/.test(a.user) ? 'Cả phòng' : esc(a.user)} · ${a.level === 'write' ? 'Ghi' : 'Đọc'} <a href="javascript:void 0" class="text-reset ms-1" data-revoke="${esc(f.rel)}|${esc(a.user)}" title="Thu hồi">✕</a></span>`).join('') || (f.exposed.length ? '' : '<span class="text-secondary small">chưa chia riêng</span>')}</td>
        <td class="text-end text-nowrap">${c.unc ? `<button class="btn btn-sm btn-outline-secondary me-1" title="Sao chép đường dẫn mạng" data-copy="${esc(c.unc + '\\' + f.rel.replace(/\//g, '\\'))}"><i class="fa-regular fa-copy"></i></button>` : ''}<button class="btn btn-sm btn-outline-success" data-grant="${esc(f.rel)}"><i class="fa-solid fa-user-plus"></i> Cấp quyền</button></td></tr>`).join('') || '<tr><td colspan="4" class="text-secondary">Không có thư mục con</td></tr>';
}
async function unexpose(rel) {
    if (!confirm(`Gỡ quyền công khai (Authenticated Users / Everyone / Users / Domain Users) khỏi [${rel}]?\nSau đó chỉ những ai được cấp riêng hoặc theo quyền chung của phòng mới vào được.`)) return;
    const d = await send('/api/deleg/unexpose', { dept: D.dept, sub: rel });
    d.success ? (toast('Đã gỡ quyền công khai'), loadFolders()) : toast(d.error || 'Thất bại', 'danger');
}
async function setMode(rel, mode) {
    if (!confirm(mode === 'restricted' ? `Đặt [${rel}] là HẠN CHẾ?\nCả phòng sẽ KHÔNG vào được; chỉ trưởng phòng, quản trị và người được cấp riêng. Quyền đã cấp ở thư mục cha không còn áp dụng cho thư mục này.` : `Cho [${rel}] kế thừa quyền từ thư mục cha?\n(Mặc định: cả phòng vào được theo quyền chung của phòng.)`)) return;
    const d = await send('/api/deleg/mode', { dept: D.dept, sub: rel, mode });
    d.success ? (toast('Đã đổi phạm vi thư mục'), loadFolders()) : toast(d.error || 'Thất bại', 'danger');
}
async function loadHistory() {
    const h = await J('/api/deleg/history?dept=' + encodeURIComponent(D.dept));
    $('dgHist').innerHTML = (Array.isArray(h) ? h : []).map(g => `<tr><td><small>${new Date(g.created_at).toLocaleString('vi-VN')}</small></td><td><b>${esc(g.by_user)}</b> <span class="badge bg-${g.by_role === 'IT' ? 'warning text-dark' : 'secondary'}">${g.by_role === 'IT' ? 'IT' : g.by_role === 'Manager' ? 'Trưởng phòng' : 'Admin'}</span></td><td>${esc(g.username)}</td><td><code>${esc(g.rel)}</code></td><td>${LV[g.level]}</td><td><small>${g.expires_at ? new Date(g.expires_at).toLocaleString('vi-VN') : '—'}</small></td><td><small>${esc(g.reason)}</small></td><td>${esc(g.state)}</td></tr>`).join('') || '<tr><td colspan="8" class="text-secondary">Chưa có lịch sử</td></tr>';
}
async function fillUsers(all, keep) {
    const us = await J(`/api/deleg/users?dept=${encodeURIComponent(D.dept)}${all ? '&outside=1' : ''}`), list = Array.isArray(us) ? us : [];
    if (keep && !list.some(u => String(u.SamAccountName).toLowerCase() === keep.toLowerCase())) list.push({ SamAccountName: keep, Name: keep });   // thu hồi quyền của người ngoài phòng vẫn chọn được
    $('dgUser').innerHTML = list.map(u => `<option value="${esc(u.SamAccountName)}">${esc(u.Name)} (${esc(u.SamAccountName)})</option>`).join('');
    if (keep) $('dgUser').value = keep;
}
async function openGrant(rel, user, level) {
    const c = curDept(), isIT = c.role === 'IT'; dgRel = rel; $('dgTitle').innerText = rel;
    $('dgAllWrap').classList.toggle('d-none', c.role === 'Manager'); $('dgAll').checked = false;   // mặc định chỉ người trong phòng; tick để thấy cả domain
    $('dgAll').onchange = () => fillUsers($('dgAll').checked, $('dgUser').value);
    await fillUsers(false, user);
    $('dgLevel').value = level || 'read'; $('dgReason').value = ''; $('dgUntil').value = '';
    $('dgUntilReq').innerText = isIT ? '(bắt buộc, tối đa 30 ngày)' : '(để trống = vĩnh viễn)'; $('dgReasonReq').innerText = isIT ? '(bắt buộc)' : '(tuỳ chọn)';
    $('dgHint').innerText = isIT ? 'Quyền tạm thời tự thu hồi khi hết hạn. Trưởng phòng sẽ thấy thao tác này trong lịch sử.' : c.role === 'Manager' ? 'Chỉ cấp được cho nhân viên thuộc phòng của bạn. Thu hồi chỉ gỡ quyền gán riêng tại thư mục này; quyền kế thừa từ thư mục cha phải xử lý ở thư mục cha.' : '';
    bootstrap.Modal.getOrCreateInstance($('dgModal')).show();
}
document.addEventListener('click', e => {
    const t = e.target.closest('[data-sub],[data-grant],[data-revoke],[data-days],[data-copy],[data-mode],[data-unexpose]'); if (!t || !$('dgFolders')) return;
    if (t.dataset.unexpose) return unexpose(t.dataset.unexpose);
    if (t.dataset.mode) { const [rel, mode] = t.dataset.mode.split('|'); return setMode(rel, mode); }
    if (t.dataset.copy) return copyText(t.dataset.copy);
    if (t.dataset.days) { $('dgUntil').value = dtLocal(Date.now() + t.dataset.days * 86400000); return; }
    if (t.dataset.sub !== undefined && (t.closest('#dgFolders') || t.closest('#dgCrumb'))) { D.sub = t.dataset.sub; loadFolders(); }
    else if (t.dataset.grant) openGrant(t.dataset.grant);
    else if (t.dataset.revoke) { const [rel, user] = t.dataset.revoke.split('|'); openGrant(rel, user, 'none'); }
});
$('dgForm').onsubmit = async e => {
    e.preventDefault(); const c = curDept();
    if (c.role === 'IT' && $('dgLevel').value !== 'none' && !$('dgUntil').value) return toast('IT cần chọn thời hạn hết hạn', 'warning');
    const d = await send('/api/deleg/grant', { dept: D.dept, sub: dgRel, username: $('dgUser').value, level: $('dgLevel').value, until: $('dgUntil').value ? new Date($('dgUntil').value).toISOString() : '', reason: $('dgReason').value });
    if (d.success) { bootstrap.Modal.getInstance($('dgModal')).hide(); toast('Đã cập nhật quyền thư mục'); loadFolders(); loadHistory(); } else toast(d.error || 'Thất bại', 'danger');
};
document.addEventListener('submit', async e => {
    if (e.target.id !== 'dgCfgForm') return; e.preventDefault();
    const d = await send('/api/deleg/depts', { dept: D.dept, path: $('dgPath').value, manager: $('dgMgr').value, base: $('dgBase').value });
    d.success ? (toast('Đã thiết lập phòng ban'), loadDeleg()) : toast(d.error || 'Thất bại', 'danger');
});

// ===== Phân quyền: mặc định theo vai trò + vai trò riêng từng IT-Staff =====
const PN = { zabbix: 'Giám sát hạ tầng (Zabbix)', wazuh: 'Giám sát SOC (Wazuh)', pfsense: 'Gateway (pfSense)', ad: 'Active Directory', admin: 'Quản trị hệ thống (GPO, File Server)', helpdesk: 'Hỗ trợ kỹ thuật', deleg: 'Cấp quyền thư mục (tạm thời)', docker: 'Quản trị Docker', assets: 'IT Asset Management', vuln: 'Vulnerability & Patch', reports: 'KPI / SLA Reports', platforms: 'Network / Cloud / Kubernetes' };
const PS_ = { zabbix: 'Zabbix', wazuh: 'Wazuh', pfsense: 'pfSense', ad: 'AD (Users/OU)', computers: 'Computers Domain', laps: 'Windows LAPS', admin: 'Hệ thống', helpdesk: 'Hỗ trợ', deleg: 'Thư mục', docker: 'Docker', assets: 'Tài sản', vuln: 'Lỗ hổng', reports: 'Báo cáo', platforms: 'Nền tảng' };
const PRESETS = {
    'Helpdesk': { ad: 'view', helpdesk: 'manage', deleg: 'manage', zabbix: 'none', wazuh: 'none', pfsense: 'none', admin: 'none', assets: 'view', vuln: 'none', reports: 'none', platforms: 'none', docker: 'none' },
    'Giám sát mạng (NOC)': { zabbix: 'view', pfsense: 'view', helpdesk: 'view', ad: 'none', wazuh: 'none', admin: 'none', deleg: 'none', assets: 'view', vuln: 'none', reports: 'view', platforms: 'view', docker: 'none' },
    'An ninh (SOC)': { wazuh: 'view', zabbix: 'view', helpdesk: 'view', ad: 'none', pfsense: 'none', admin: 'none', deleg: 'none', assets: 'view', vuln: 'manage', reports: 'view', platforms: 'none', docker: 'none' },
    'Quản trị hệ thống': { ad: 'manage', admin: 'manage', deleg: 'manage', zabbix: 'view', wazuh: 'view', pfsense: 'view', helpdesk: 'manage', assets: 'manage', vuln: 'manage', reports: 'view', platforms: 'view', docker: 'manage' }
};
const PL = { none: 'Không', view: 'Xem', manage: 'Quản lý' };
const opts = (cur, def) => (def ? `<option value="default"${cur === 'default' ? ' selected' : ''}>Mặc định</option>` : '') + Object.keys(PL).map(k => `<option value="${k}"${cur === k ? ' selected' : ''}>${PL[k]}</option>`).join('');
async function setStaff(user, levels) { const d = await send('/api/permissions/user', { username: user, levels }, 'PUT'); d.success ? toast('Đã lưu vai trò') : toast('Lưu thất bại', 'danger'); return d.success; }
async function presetStaff(user, name) { if (name && await setStaff(user, PRESETS[name])) loadPerm(); }
loadPerm = async () => {
    const d = await J('/api/permissions'); if (!d.matrix || !$('permBody')) return;
    $('permBody').innerHTML = d.modules.map(m => `<tr><td class="fw-bold">${PN[m]}</td>${['IT-Staff', 'Employee'].map(r => `<td><select class="form-select form-select-sm bg-transparent" onchange="setPerm('${r}','${m}',this.value)">${opts(d.matrix[r][m], false)}</select></td>`).join('')}</tr>`).join('');
    const us = await J('/api/ad/users'), staff = (Array.isArray(us) ? us : []).filter(u => u.PrimaryGroup === 'IT-Helpdesk');
    $('permStaff').innerHTML = staff.length ? `<table class="table table-sm align-middle"><thead><tr><th>Tài khoản</th><th>Vai trò mẫu</th>${d.modules.map(m => `<th>${PS_[m]}</th>`).join('')}</tr></thead><tbody>${staff.map(u => { const o = d.users[u.Username.toLowerCase()] || {}; return `<tr><td class="fw-bold text-warning">${esc(u.Username)}<br><small class="text-secondary fw-normal">${esc(u.FullName)}</small></td><td><select class="form-select form-select-sm bg-transparent" onchange="presetStaff('${esc(u.Username)}', this.value)"><option value="">Chọn...</option>${Object.keys(PRESETS).map(p => `<option>${p}</option>`).join('')}</select></td>${d.modules.map(m => `<td><select class="form-select form-select-sm bg-transparent" onchange="setStaff('${esc(u.Username)}', {${m}: this.value})">${opts(o[m] || 'default', true)}</select></td>`).join('')}</tr>`; }).join('')}</tbody></table>` : '<div class="text-secondary small">Chưa có tài khoản nào trong nhóm IT-Helpdesk.</div>';
};

// Nút áp dụng lại thiết lập cho mọi phòng đã cấu hình
document.addEventListener('click', async e => {
    if (!e.target.closest('#dgResetup') || !confirm('Áp dụng lại cho TẤT CẢ phòng đã cấu hình?\n\nLƯU Ý: cả phòng sẽ được quyền mặc định (theo ô "Quyền cả phòng") trên MỌI thư mục con đang kế thừa. Hãy đặt "Hạn chế" cho các thư mục nhạy cảm TRƯỚC khi bấm.')) return;
    toast('Đang áp dụng, có thể mất vài chục giây...', 'info');
    const d = await send('/api/deleg/resetup', {}); d.success ? toast('Đã áp dụng cho ' + d.done.length + ' phòng') : toast(d.error || 'Có lỗi', 'danger'); loadDeleg();
});

