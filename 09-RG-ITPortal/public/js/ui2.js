const $ = id => document.getElementById(id);
const J = async u => { const r = await fetch(u); return r.ok ? r.json() : []; };
const send = (u, b, m = 'POST') => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json());
document.querySelector('button[onclick="exportCSV()"]')?.remove(); // đã bỏ mục xuất CSV

// Báo lỗi nguồn dữ liệu thay vì hiện số 0 im lặng
const _f2 = window.fetch;
window.fetch = async (...a) => {
    const r = await _f2(...a);
    if (/\/api\/(monitoring|network|security)\//.test(String(a[0]))) r.clone().json().then(d => {
        $('srcErr')?.remove();
        if (d.errors && d.errors.length) $('dynamic-content').insertAdjacentHTML('afterbegin', `<div id="srcErr" class="alert alert-danger small"><b>Không lấy được dữ liệu thật:</b><br>${d.errors.map(x => esc(x)).join('<br>')}</div>`);
    }).catch(() => {});
    return r;
};

loadWazuh = async () => {
    const d = await J('/api/security/wazuh'); if (!d.sev || !$('wzTotal')) return;
    $('wzTotal').innerText = d.total.toLocaleString('vi-VN');
    ['critical', 'high', 'medium', 'low'].forEach(k => $('wz-' + k).innerText = (d.sev[k] || 0).toLocaleString('vi-VN'));
    $('wzAgents').innerHTML = (Array.isArray(d.agents) ? d.agents : []).map(a => `<span class="badge bg-secondary me-1">${esc(a.name)}: ${a.count}</span>`).join('');
    $('wzEvents').innerHTML = (Array.isArray(d.events) ? d.events : []).map(e => `<tr><td><small class="text-secondary">${esc(e.time)}</small></td><td><b>${esc(e.agent)}</b></td><td><span class="badge bg-${Number(e.level) >= 15 ? 'danger' : Number(e.level) >= 12 ? 'warning text-dark' : 'info text-dark'}">${esc(e.level)}</span></td><td>${esc(e.desc)}</td><td class="text-primary fw-bold">#${esc(e.id)}</td><td>${e.eventId && (curUser?.role === 'Super-Admin' || curUser?.perms?.helpdesk === 'manage') ? `<button class="btn btn-sm btn-outline-primary" data-create-incident="1" data-source="Wazuh" data-external-id="${esc(e.eventId)}" data-asset-name="${esc(e.agent)}" data-priority="${e.level >= 15 ? 'Urgent' : e.level >= 12 ? 'High' : 'Normal'}" data-title="${esc(`Wazuh ${e.agent}: ${e.desc}`)}" data-description="${esc(`Wazuh alert ${e.eventId} | Agent ${e.agent} | Rule ${e.id} | Level ${e.level} | ${e.time}`)}">Tạo incident</button>` : '—'}</td></tr>`).join('');
};

let curPath = '';
async function showFolders(p) {
    curPath = p; $('smbPath').value = p;
    const f = await J('/api/admin/folders?path=' + encodeURIComponent(p)), up = p.length > 3 ? p.replace(/\\[^\\]+\\?$/, '\\') : '';
    $('smbFolders').innerHTML = (up ? `<a class="list-group-item list-group-item-action py-1" data-p="${esc(up)}"><i class="fa-solid fa-turn-up me-2"></i>..</a>` : '') + f.map(x => `<a class="list-group-item list-group-item-action py-1" data-p="${esc(x.FullName)}"><i class="fa-regular fa-folder me-2 text-warning"></i>${esc(x.Name)}</a>`).join('');
}
async function delGpo(id) { if (!confirm('Xóa GPO này?')) return; const d = await send('/api/admin/gpo/' + encodeURIComponent(id), null, 'DELETE'); d.success ? toast('Đã xóa GPO') : toast('Lỗi: ' + (d.error || ''), 'danger'); loadAdminTools(); }
async function delShare(n) { if (!confirm(`Ngừng chia sẻ [${n}]? (dữ liệu trong thư mục vẫn giữ nguyên)`)) return; const d = await send('/api/admin/smb/' + encodeURIComponent(n), null, 'DELETE'); d.success ? toast('Đã ngừng chia sẻ') : toast('Lỗi: ' + (d.error || ''), 'danger'); loadAdminTools(); }

document.addEventListener('click', e => {
    const gpoButton = e.target.closest('[data-gpo-delete]');
    if (gpoButton) return delGpo(gpoButton.dataset.gpoDelete);
    const shareButton = e.target.closest('[data-smb-delete]');
    if (shareButton) return delShare(shareButton.dataset.smbDelete);
});

loadAdminTools = async () => {
    if (!$('gpoForm')) return;
    const [cat, gpos, ous, drives, shares] = await Promise.all(['/api/admin/gpo/catalog', '/api/admin/gpo', '/api/ad/departments', '/api/admin/drives', '/api/admin/smb'].map(J));
    $('gpoRules').innerHTML = (Array.isArray(cat) ? cat : []).map(p => `<div class="form-check"><input class="form-check-input" type="checkbox" value="${esc(p.key)}" id="r-${esc(p.key)}"><label class="form-check-label small" for="r-${esc(p.key)}">${esc(p.label)}</label></div>`).join('');
    $('gpoTarget').innerHTML = '<option value="">Không liên kết (chỉ tạo GPO)</option><option value="DOMAIN">Toàn bộ domain</option>' + (Array.isArray(ous) ? ous : []).map(o => `<option value="${esc(o.DistinguishedName)}">OU: ${esc(o.Name)}</option>`).join('');
    $('gpoList').innerHTML = (Array.isArray(gpos) ? gpos : []).map(g => `<tr><td class="fw-bold text-warning">${esc(g.DisplayName)}</td><td><code>${esc(g.Id)}</code></td><td><span class="badge bg-success">${esc(g.GpoStatus)}</span></td><td><button type="button" class="btn btn-sm btn-outline-danger" data-gpo-delete="${esc(g.Id)}" title="Xóa GPO"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('');
    $('smbList').innerHTML = (Array.isArray(shares) ? shares : []).map(s => `<tr><td class="fw-bold text-success">${esc(s.Name)}</td><td><code>${esc(s.Path)}</code></td><td><button type="button" class="btn btn-sm btn-outline-danger" data-smb-delete="${esc(s.Name)}" title="Ngừng chia sẻ"><i class="fa-solid fa-ban"></i></button></td></tr>`).join('');
    $('smbDrive').innerHTML = (Array.isArray(drives) ? drives : []).map(d => `<option value="${esc(d.Name)}\\">${esc(d.Name)} (${d.FreeGB}/${d.SizeGB} GB trống)</option>`).join('');
    $('smbDrive').onchange = () => showFolders($('smbDrive').value);
    $('smbFolders').onclick = e => { const a = e.target.closest('a'); if (a) showFolders(a.dataset.p); };
    if (drives.length) showFolders($('smbDrive').value); else toast('Không đọc được danh sách ổ đĩa của server', 'danger');
    $('gpoForm').onsubmit = async e => {
        e.preventDefault(); const rules = [...document.querySelectorAll('#gpoRules input:checked')].map(i => i.value);
        if (!rules.length) return toast('Hãy chọn ít nhất một chính sách', 'warning');
        const d = await send('/api/admin/gpo', { name: $('gpoName').value, rules, target: $('gpoTarget').value });
        if (d.success) { toast('Đã tạo GPO với ' + rules.length + ' chính sách'); loadAdminTools(); } else toast('Lỗi: ' + (d.error || 'không rõ'), 'danger');
    };
    $('smbForm').onsubmit = async e => {
        e.preventDefault(); if (!curPath) return toast('Hãy chọn ổ đĩa và thư mục', 'warning');
        const d = await send('/api/admin/smb', { name: $('smbName').value, path: curPath, sub: $('smbSub').value, group: $('smbGroup').value, perm: $('smbPerm').value });
        if (d.success) { toast('Đã tạo thư mục chia sẻ'); loadAdminTools(); } else toast('Lỗi: ' + (d.error || 'không rõ'), 'danger');
    };
};
