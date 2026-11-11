// ui7.js - nạp SAU ui6.js. Quản lý Docker (kiểu Portainer) trên LINUX01
titles.docker = 'Quản Lý Docker (LINUX01)'; PAGES.push('docker');
PN.docker = 'Quản lý Docker (container, image, volume)'; PS_.docker = 'Docker'; PRESETS['Quản trị hệ thống'].docker = 'manage';
$('nav-admin').insertAdjacentHTML('afterend', '<a class="nav-link" id="nav-docker" onclick="navigateTo(\'docker\')"><i class="fa-brands fa-docker me-2"></i> Quản Lý Docker</a>');
const _ar7 = applyRole; applyRole = () => { _ar7(); const a = allow[curUser && curUser.role], n = $('nav-docker'); if (n) n.classList.toggle('d-none', !!a && !a.includes('docker')); };
const _r7 = refreshCurrentView; refreshCurrentView = () => { if (curUser && currentSection === 'docker') return dkLoad(); _r7(); };

const DK = { tab: 'dash', list: [], host: '', cid: '', logText: '', sel: new Set(), state: '' };
const dkCan = () => curUser && curUser.perms && curUser.perms.docker === 'manage';
const dkErr = m => { const b = $('dkErr'); if (b) { b.textContent = m || ''; b.classList.toggle('d-none', !m); } };
const bytes = n => { n = +n || 0; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const stBadge7 = c => c.health === 'unhealthy' ? '<span class="badge bg-danger">unhealthy</span>' : c.health === 'healthy' ? '<span class="badge bg-success">healthy</span>' : `<span class="badge bg-${{ running: 'success', paused: 'warning text-dark', restarting: 'info text-dark', exited: 'secondary', created: 'dark', dead: 'danger' }[c.state] || 'secondary'}">${esc(c.state)}</span>`;
const dkGet = async u => { const r = await fetch('/api/docker' + u); if (!r.ok) { dkErr('Không có quyền hoặc máy chủ lỗi (' + r.status + ')'); return null; } const d = await r.json(); if (d.error) { dkErr(d.error); return null; } dkErr(''); return d; };

async function dkLoad() {
    if (!$('dkBody')) return;
    document.querySelectorAll('[data-dktab]').forEach(a => a.classList.toggle('active', a.dataset.dktab === DK.tab));
    ({ dash: dkDash, containers: dkContainers, stacks: dkStacks, images: dkImages, volumes: dkVolumes, networks: dkNetworks })[DK.tab]();
}
const tbl = (head, rows, empty) => `<div class="card p-3"><div class="table-responsive" style="max-height:68vh;overflow-y:auto"><table class="table table-hover table-sm align-middle"><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="12" class="text-secondary">${empty}</td></tr>`}</tbody></table></div></div>`;

async function dkDash() {
    const [i, c] = await Promise.all([dkGet('/info'), dkGet('/containers')]); if (!i || !c) return;
    const unh = c.containers.filter(x => x.health === 'unhealthy').length, kpi = (t, v, col, s) => `<div class="col-6 col-xl-3"><div class="card gauge-box h-100"><small class="text-secondary">${t}</small><div class="gauge-val my-2" style="color:${col}">${v}</div><small class="text-secondary">${s || ''}</small></div></div>`;
    $('dkBody').innerHTML = `<div class="row g-3 mb-3">${kpi('Đang chạy', i.running, '#10b981', 'containers')}${kpi('Đã dừng', i.stopped, '#94a3b8', i.paused ? i.paused + ' tạm dừng' : 'containers')}${kpi('Không khỏe', unh, unh ? '#ef4444' : '#10b981', 'unhealthy')}${kpi('Images', i.images, '#38bdf8', '')}</div>
    <div class="row g-3"><div class="col-lg-6"><div class="card p-3 h-100"><h6 class="fw-bold text-info mb-3"><i class="fa-brands fa-docker"></i> Máy chủ Docker</h6><table class="table table-sm mb-0"><tbody>
        ${[['Tên máy', i.name], ['Docker Engine', i.version], ['Hệ điều hành', i.os], ['Kernel', i.kernel], ['Kiến trúc', i.arch], ['CPU', i.cpus], ['RAM', bytes(i.mem)], ['Thư mục dữ liệu', i.root]].map(([k, v]) => `<tr><td class="text-secondary" style="width:35%">${k}</td><td class="fw-semibold">${esc(v)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="col-lg-6"><div class="card p-3 h-100"><h6 class="fw-bold text-warning mb-3"><i class="fa-solid fa-hard-drive"></i> Dung lượng Docker</h6><table class="table table-sm mb-0"><thead><tr><th>Loại</th><th>Tổng</th><th>Đang dùng</th><th>Kích thước</th><th>Có thể dọn</th></tr></thead><tbody>${i.df.map(x => `<tr><td>${esc(x.type)}</td><td>${esc(x.total)}</td><td>${esc(x.active)}</td><td>${esc(x.size)}</td><td>${esc(x.reclaimable)}</td></tr>`).join('')}</tbody></table><button class="btn btn-sm btn-outline-warning mt-3" data-dkprune="builder">Dọn Build Cache</button><div class="small text-secondary mt-1">Chỉ Super-Admin; thao tác không thể hoàn tác.</div></div></div></div>`;
}

// ===== Containers =====
async function dkContainers() {
    const d = await dkGet('/containers'); if (!d) return; DK.list = d.containers; DK.host = d.host; dkDrawContainers();
}
function dkDrawContainers() {
    const can = dkCan(), f = DK.state, rows = DK.list.filter(c => !f || (f === 'stopped' ? c.state !== 'running' : f === 'unhealthy' ? c.health === 'unhealthy' : c.state === f));
    const sup = curUser?.role === 'Super-Admin'; const bulk = can ? [['start', 'play', 'success', 'Start'], ['stop', 'stop', 'warning', 'Stop'], ['restart', 'rotate', 'info', 'Restart'], ...(sup ? [['kill', 'skull-crossbones', 'danger', 'Kill']] : []), ['pause', 'pause', 'secondary', 'Pause'], ['unpause', 'forward', 'secondary', 'Resume'], ...(sup ? [['remove', 'trash', 'danger', 'Remove']] : [])].map(([a, ic, col, t]) => `<button class="btn btn-sm btn-outline-${col}" data-dkbulk="${a}"><i class="fa-solid fa-${ic} me-1"></i>${t}</button>`).join(' ') : '';
    const act = c => { const b = (a, ic, col, t) => `<button class="btn btn-sm btn-outline-${col} py-0 px-1" data-dkact="${c.id}|${a}" title="${t}"><i class="fa-solid fa-${ic}"></i></button>`; return `<button class="btn btn-sm btn-outline-info py-0 px-1" data-dkopen="${c.id}|logs" title="Logs"><i class="fa-solid fa-file-lines"></i></button> <button class="btn btn-sm btn-outline-secondary py-0 px-1" data-dkopen="${c.id}|info" title="Chi tiết"><i class="fa-solid fa-circle-info"></i></button>` + (curUser.role === 'Super-Admin' ? ` <button class="btn btn-sm btn-outline-primary py-0 px-1" data-dkfiles="${c.id}" title="File Browser"><i class="fa-solid fa-folder-open"></i></button>` : '') + (can && (!c.protected || curUser?.role === 'Super-Admin') ? ' ' + (c.state === 'running' ? b('restart', 'rotate', 'info', 'Restart') + ' ' + b('stop', 'stop', 'warning', 'Stop') : c.state === 'paused' ? b('unpause', 'forward', 'success', 'Resume') : b('start', 'play', 'success', 'Start')) : ''); };
    $('dkBody').innerHTML = `<div class="d-flex flex-wrap gap-2 align-items-center mb-2"><select id="dkState" class="form-select form-select-sm bg-transparent" style="width:auto"><option value="">Tất cả (${DK.list.length})</option><option value="running">Đang chạy</option><option value="stopped">Đã dừng</option><option value="paused">Tạm dừng</option><option value="unhealthy">Unhealthy</option></select>${bulk}<span class="ms-auto small text-secondary">Tự làm mới 15 giây · <i class="fa-solid fa-shield-halved text-warning"></i> = container hệ thống</span></div>` +
    tbl(`<th><input type="checkbox" class="form-check-input" id="dkAll"></th><th>Tên</th><th>Trạng thái</th><th>Stack</th><th>Image</th><th>Tạo lúc</th><th>IP</th><th>CPU</th><th>RAM</th><th>Cổng</th><th></th>`,
        rows.map(c => `<tr><td><input type="checkbox" class="form-check-input dk-sel" value="${esc(c.id)}"${DK.sel.has(c.id) ? ' checked' : ''}></td><td class="text-nowrap"><a href="javascript:void 0" class="fw-bold text-info" data-dkopen="${esc(c.id)}|info">${esc(c.name)}</a>${c.protected ? ' <i class="fa-solid fa-shield-halved text-warning" title="Container hệ thống"></i>' : ''}</td><td>${stBadge7(c)}${c.restarts ? ` <span class="badge bg-secondary" title="Số lần khởi động lại">↻${c.restarts}</span>` : ''}</td><td><small>${esc(c.stack || '-')}</small></td><td><small>${esc(c.image)}</small></td><td><small>${esc(c.created)}</small></td><td><small>${esc(c.ip || '-')}</small></td><td><small>${esc(c.cpu || '-')}</small></td><td><small>${esc(c.mem ? c.mem.split(' / ')[0] : '-')}</small></td><td class="text-nowrap">${c.ports.map(p => `<a href="${/^(443|8443|9443|9200)$/.test(p.pub) ? 'https' : 'http'}://${esc(DK.host)}:${p.pub}" target="_blank" rel="noopener"><small>${p.pub}:${p.priv}</small></a>`).join(' ') || '-'}</td><td class="text-nowrap text-end">${act(c)}</td></tr>`).join(''), 'Không có container nào');
    $('dkState').value = f;
}
async function dkDo(id, action, extra) {
    const c = DK.list.find(x => x.id === id) || {}, label = { start: 'khởi động', stop: 'dừng', restart: 'khởi động lại', kill: 'KILL', pause: 'tạm dừng', unpause: 'tiếp tục', remove: 'XÓA' }[action];
    const r = await send(`/api/docker/containers/${encodeURIComponent(id)}/${action}`, extra || {}); r.success ? null : toast((c.name || id.slice(0, 12)) + ': ' + (r.error || 'thất bại'), 'danger'); return r.success;
}
async function dkBulk(action) {
    const ids = [...DK.sel]; if (!ids.length) return toast('Hãy tick chọn container trước', 'warning');
    const names = ids.map(id => (DK.list.find(c => c.id === id) || {}).name || id.slice(0, 12)), running = ids.some(id => (DK.list.find(c => c.id === id) || {}).state === 'running');
    if (['stop', 'kill', 'remove', 'restart'].includes(action) && !confirm(`${action.toUpperCase()} ${ids.length} container?\n\n${names.join('\n')}${action === 'remove' && running ? '\n\nCó container đang chạy: sẽ bị dừng cưỡng bức rồi xóa.' : ''}`)) return;
    let ok = 0; for (const id of ids) if (await dkDo(id, action, action === 'remove' ? { force: true } : {})) ok++;
    DK.sel.clear(); toast(`${ok}/${ids.length} container đã ${action}`, ok === ids.length ? 'success' : 'warning'); dkContainers();
}

// ===== Stacks / Images / Volumes / Networks =====
async function dkStacks() {
    const d = await dkGet('/stacks'); if (!d) return; const can = dkCan(), sup = curUser?.role === 'Super-Admin';
    $('dkBody').innerHTML = tbl('<th>Stack</th><th>Containers</th><th>Trạng thái</th><th></th>', d.stacks.map(x => `<tr><td class="fw-bold">${esc(x.name)}${x.protected ? ' <i class="fa-solid fa-shield-halved text-warning" title="Stack hệ thống"></i>' : ''}</td><td>${x.running}/${x.total} đang chạy</td><td><span class="badge bg-${x.running === x.total ? 'success' : x.running ? 'warning text-dark' : 'secondary'}">${x.running === x.total ? 'Chạy đủ' : x.running ? 'Chạy một phần' : 'Đã dừng'}</span></td><td class="text-end text-nowrap">${sup ? `<button class="btn btn-sm btn-outline-secondary" data-dkstackdetail="${esc(x.name)}">Compose</button> ` : ''}${can && (!x.protected || sup) ? ['start|play|success|Start', 'restart|rotate|info|Restart', 'stop|stop|warning|Stop'].map(a => { const [act, ic, col, t] = a.split('|'); return `<button class="btn btn-sm btn-outline-${col}" data-dkstack="${esc(x.name)}|${act}"><i class="fa-solid fa-${ic} me-1"></i>${t}</button>`; }).join(' ') : ''}</td></tr>`).join(''), 'Chưa có stack (docker compose) nào');
}
async function dkImages() {
    const d = await dkGet('/images'); if (!d) return; const can = dkCan(), sup = curUser?.role === 'Super-Admin';
    $('dkBody').innerHTML = (can ? `<form id="dkPullForm" class="input-group mb-2" style="max-width:640px"><input id="dkPull" class="form-control bg-transparent" placeholder="Kéo image mới, VD: nginx:latest hoặc mysql:8.0" required><button class="btn btn-info fw-bold">Pull</button>${sup ? '<button type="button" class="btn btn-outline-warning" data-dkprune="image">Dọn image không gắn thẻ</button>' : ''}</form>` : '') +
        tbl('<th>Image</th><th>ID</th><th>Kích thước</th><th>Tạo</th><th>Sử dụng</th><th></th>', d.images.map(i => `<tr><td class="fw-bold">${esc(i.repo)}<span class="text-secondary">:${esc(i.tag)}</span></td><td><code>${esc(i.short)}</code></td><td>${esc(i.size)}</td><td><small>${esc(i.created)}</small></td><td><span class="badge bg-${i.used ? 'success' : 'secondary'}">${i.used ? 'Đang dùng' : 'Không dùng'}</span></td><td class="text-end">${sup && !i.used ? `<button class="btn btn-sm btn-outline-danger py-0 px-1" data-dkrmi="${esc(i.id)}|${esc(i.repo)}:${esc(i.tag)}" title="Xóa image"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`).join(''), 'Chưa có image nào');
}
async function dkVolumes() {
    const d = await dkGet('/volumes'); if (!d) return; const can = dkCan(), sup = curUser.role === 'Super-Admin';
    $('dkBody').innerHTML = (sup ? '<form id="dkVolumeCreate" class="input-group mb-2" style="max-width:520px"><input id="dkVolumeName" class="form-control bg-transparent" placeholder="Tên volume mới" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,127}"><button class="btn btn-outline-info">Tạo Volume</button></form><div class="mb-2"><button class="btn btn-sm btn-outline-danger" data-dkprune="volume"><i class="fa-solid fa-broom me-1"></i>Dọn volume không dùng (xóa vĩnh viễn)</button></div>' : '') +
        tbl('<th>Tên volume</th><th>Driver</th><th>Sử dụng</th><th></th>', d.volumes.map(v => `<tr><td><code>${esc(v.name.length > 40 ? v.name.slice(0, 40) + '…' : v.name)}</code></td><td>${esc(v.driver)}</td><td><span class="badge bg-${v.used ? 'success' : 'secondary'}">${v.used ? 'Đang dùng' : 'Không dùng'}</span></td><td class="text-end">${sup ? `<button class="btn btn-sm btn-outline-primary py-0 px-1 me-1" data-dkvolfiles="${esc(v.name)}" title="Duyệt file volume"><i class="fa-solid fa-folder-open"></i></button>` : ''}${sup && !v.used ? `<button class="btn btn-sm btn-outline-danger py-0 px-1" data-dkrmv="${esc(v.name)}" title="Xóa volume (mất dữ liệu)"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`).join(''), 'Chưa có volume nào');
}
async function dkNetworks() {
    const d = await dkGet('/networks'); if (!d) return; const sup=curUser.role==='Super-Admin';
    $('dkBody').innerHTML = (sup ? '<form id="dkNetworkCreate" class="row g-2 mb-3 align-items-end"><div class="col-lg-4"><label class="form-label small">Tên network</label><input id="dkNetworkName" class="form-control bg-transparent" placeholder="network-name" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,127}"></div><div class="col-lg-2"><label class="form-label small">Driver</label><select id="dkNetworkDriver" class="form-select bg-transparent"><option value="bridge">Bridge</option><option value="macvlan">Macvlan</option></select></div><div class="col-lg-2 dk-macvlan-field d-none"><label class="form-label small">Parent NIC</label><input id="dkNetworkParent" class="form-control bg-transparent" placeholder="ens33"></div><div class="col-lg-2 dk-macvlan-field d-none"><label class="form-label small">Subnet CIDR</label><input id="dkNetworkSubnet" class="form-control bg-transparent" placeholder="192.168.50.0/24"></div><div class="col-lg-2 dk-macvlan-field d-none"><label class="form-label small">Gateway</label><input id="dkNetworkGateway" class="form-control bg-transparent" placeholder="192.168.50.1"></div><div class="col-12"><button class="btn btn-outline-info">Tạo Network</button><small class="text-secondary ms-2">Macvlan chỉ tạo network; cần bảo đảm subnet/parent phù hợp hạ tầng trước khi gắn container.</small></div></form>' : '') + tbl('<th>Tên</th><th>ID</th><th>Driver</th><th>Phạm vi</th><th></th>', d.networks.map(n => `<tr><td class="fw-bold">${esc(n.name)}</td><td><code>${esc(n.id)}</code></td><td>${esc(n.driver)}</td><td>${esc(n.scope)}</td><td class="text-end">${sup && !['bridge','host','none'].includes(n.name) ? `<button class="btn btn-sm btn-outline-danger" data-dknetrm="${esc(n.name)}">Xóa</button>` : ''}</td></tr>`).join(''), 'Không có network nào');
}

// ===== Chi tiết container: Logs + Thông tin =====
document.body.insertAdjacentHTML('beforeend', `
<div class="modal fade" id="dkModal" tabindex="-1"><div class="modal-dialog modal-xl"><div class="modal-content">
  <div class="modal-header"><h5 class="modal-title fw-bold text-info" id="dkTitle"></h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
  <div class="modal-body"><ul class="nav nav-tabs mb-3"><li class="nav-item"><a class="nav-link active" href="javascript:void 0" data-dkpane="logs">Logs</a></li><li class="nav-item"><a class="nav-link" href="javascript:void 0" data-dkpane="info">Chi tiết</a></li></ul>
    <div id="dkPaneLogs"><div class="d-flex flex-wrap gap-2 align-items-center mb-2"><select id="dkTail" class="form-select form-select-sm bg-transparent" style="width:auto"><option value="100">100 dòng</option><option value="200" selected>200 dòng</option><option value="500">500 dòng</option><option value="1000">1000 dòng</option></select><input id="dkFilter" class="form-control form-control-sm bg-transparent" style="max-width:240px" placeholder="Lọc dòng chứa..."><div class="form-check mb-0"><input type="checkbox" class="form-check-input" id="dkAuto"><label class="form-check-label small" for="dkAuto">Tự làm mới 3 giây</label></div><button class="btn btn-sm btn-outline-secondary ms-auto" id="dkRefresh"><i class="fa-solid fa-rotate"></i></button><button class="btn btn-sm btn-outline-secondary" id="dkDl"><i class="fa-solid fa-download"></i> Tải .txt</button></div>
      <pre id="dkLog" class="p-2 rounded border" style="height:55vh;overflow:auto;font-size:.78rem;white-space:pre-wrap;word-break:break-all;background:rgba(0,0,0,.25)"></pre></div>
    <div id="dkPaneInfo" class="d-none"></div></div></div></div></div>`);
function dkRenderLog() {
    const f = $('dkFilter').value.toLowerCase(), pre = $('dkLog'), atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    pre.textContent = f ? DK.logText.split('\n').filter(l => l.toLowerCase().includes(f)).join('\n') : DK.logText; if (atBottom) pre.scrollTop = pre.scrollHeight;
}
async function dkLogs() { const r = await fetch(`/api/docker/containers/${encodeURIComponent(DK.cid)}/logs?tail=${$('dkTail').value}`); const d = await r.json().catch(() => ({})); DK.logText = d.log !== undefined ? d.log : (d.error || 'Không đọc được log'); dkRenderLog(); }
async function dkInfo(reveal) {
    const box = $('dkPaneInfo'); box.innerHTML = '<div class="text-secondary">Đang tải...</div>';
    const r = await fetch(`/api/docker/containers/${encodeURIComponent(DK.cid)}/inspect${reveal ? '?reveal=1' : ''}`), d = await r.json().catch(() => ({})); if (d.error || !d.name) { box.innerHTML = `<div class="text-danger">${esc(d.error || 'Không đọc được thông tin')}</div>`; return; }
    const row = (k, v) => `<tr><td class="text-secondary" style="width:30%">${k}</td><td class="fw-semibold">${esc(v)}</td></tr>`;
    box.innerHTML = `<div class="row g-3"><div class="col-lg-6"><table class="table table-sm">${row('Tên', d.name)}${row('Image', d.image)}${row('Lệnh', d.cmd || '-')}${row('Tạo lúc', d.created)}${row('Trạng thái', d.state.status + (d.state.health ? ' (' + d.state.health + ')' : ''))}${row('Bắt đầu', d.state.started)}${row('Mã thoát', d.state.exitCode)}${row('Chính sách restart', d.restart || 'no')}${row('Số lần restart', d.state.restarts)}${row('Privileged', d.privileged ? 'CÓ' : 'không')}</table>
      <h6 class="fw-bold">Mạng</h6><table class="table table-sm"><thead><tr><th>Network</th><th>IP</th><th>Gateway</th></tr></thead><tbody>${d.networks.map(n => `<tr><td>${esc(n.name)}</td><td>${esc(n.ip)}</td><td>${esc(n.gw)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-secondary">-</td></tr>'}</tbody></table>
      <h6 class="fw-bold">Volume / Mount</h6><table class="table table-sm"><thead><tr><th>Nguồn</th><th>Đích</th><th>Ghi</th></tr></thead><tbody>${d.mounts.map(m => `<tr><td><small>${esc(m.src)}</small></td><td><small>${esc(m.dst)}</small></td><td>${m.rw ? 'RW' : 'RO'}</td></tr>`).join('') || '<tr><td colspan="3" class="text-secondary">-</td></tr>'}</tbody></table></div>
      <div class="col-lg-6"><div class="d-flex justify-content-between align-items-center"><h6 class="fw-bold">Biến môi trường</h6>${curUser.role === 'Super-Admin' && !d.revealed ? '<button class="btn btn-sm btn-outline-warning" id="dkReveal">Hiện giá trị nhạy cảm</button>' : ''}</div><table class="table table-sm"><tbody>${d.env.map(x => `<tr><td class="text-secondary" style="width:38%"><small>${esc(x.k)}</small></td><td><small>${esc(x.v)}</small></td></tr>`).join('') || '<tr><td class="text-secondary">-</td></tr>'}</tbody></table></div></div>`;
}
function dkOpen(id, pane) {
    DK.cid = id; const c = DK.list.find(x => x.id === id) || {}; $('dkTitle').innerText = c.name || id.slice(0, 12); dkPane(pane || 'logs');
    bootstrap.Modal.getOrCreateInstance($('dkModal')).show();
}
function dkPane(p) {
    document.querySelectorAll('[data-dkpane]').forEach(a => a.classList.toggle('active', a.dataset.dkpane === p));
    $('dkPaneLogs').classList.toggle('d-none', p !== 'logs'); $('dkPaneInfo').classList.toggle('d-none', p !== 'info'); p === 'logs' ? dkLogs() : dkInfo(false);
}
$('dkFilter').oninput = dkRenderLog; $('dkTail').onchange = dkLogs; $('dkRefresh').onclick = dkLogs;
$('dkDl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([DK.logText], { type: 'text/plain' })); a.download = `${($('dkTitle').innerText || 'container')}.log.txt`; a.click(); };
setInterval(() => { if ($('dkAuto').checked && $('dkModal').classList.contains('show') && !$('dkPaneLogs').classList.contains('d-none')) dkLogs(); }, 3000);
setInterval(() => { if (curUser && currentSection === 'docker' && DK.tab === 'containers' && !document.hidden && !document.querySelector('.modal.show')) dkContainers(); }, 15000);

// ===== Sự kiện =====
document.addEventListener('change', e => {
    if(e.target.id==='dkNetworkDriver'){document.querySelectorAll('.dk-macvlan-field').forEach(x=>x.classList.toggle('d-none',e.target.value!=='macvlan'));}
    if (e.target.id === 'dkState') { DK.state = e.target.value; dkDrawContainers(); }
    else if (e.target.id === 'dkAll') { document.querySelectorAll('.dk-sel').forEach(c => { c.checked = e.target.checked; e.target.checked ? DK.sel.add(c.value) : DK.sel.delete(c.value); }); }
    else if (e.target.classList.contains('dk-sel')) e.target.checked ? DK.sel.add(e.target.value) : DK.sel.delete(e.target.value);
});
document.addEventListener('submit', async e => {
    if (e.target.id === 'dkVolumeCreate') { e.preventDefault(); const r=await send('/api/docker/volumes/create',{name:$('dkVolumeName').value.trim()}); r.success ? (toast('Đã tạo volume'),dkVolumes()) : toast(r.error||'Tạo volume thất bại','danger'); return; }
    if (e.target.id === 'dkNetworkCreate') { e.preventDefault(); const driver=$('dkNetworkDriver').value; const r=await send('/api/docker/networks/create',{name:$('dkNetworkName').value.trim(),driver,parent:$('dkNetworkParent')?.value.trim(),subnet:$('dkNetworkSubnet')?.value.trim(),gateway:$('dkNetworkGateway')?.value.trim()}); r.success ? (toast('Đã tạo network'),dkNetworks()) : toast(r.error||'Tạo network thất bại','danger'); return; }
    if (e.target.id !== 'dkPullForm') return; e.preventDefault(); const img = $('dkPull').value.trim(); toast('Đang kéo image ' + img + '...', 'info');
    const r = await send('/api/docker/images/pull', { image: img }); r.success ? (toast('Đã pull ' + img), dkImages()) : toast(r.error || 'Pull thất bại', 'danger');
});
document.addEventListener('click', async e => {
    const t = e.target.closest('[data-dktab],[data-dkopen],[data-dkact],[data-dkbulk],[data-dkpane],[data-dkstack],[data-dkrmi],[data-dkrmv],[data-dkprune],[data-dknetrm],#dkReveal'); if (!t) return;
    const d = t.dataset;
    if (d.dktab) { DK.tab = d.dktab; DK.sel.clear(); dkLoad(); }
    else if (d.dkopen) { const [id, pane] = d.dkopen.split('|'); dkOpen(id, pane); }
    else if (d.dkpane) dkPane(d.dkpane);
    else if (t.id === 'dkReveal') { if (confirm('Hiện giá trị nhạy cảm (mật khẩu, token) của container này?')) dkInfo(true); }
    else if (d.dkbulk) dkBulk(d.dkbulk);
    else if (d.dkact) { const [id, a] = d.dkact.split('|'), c = DK.list.find(x => x.id === id) || {}; if (['stop', 'restart'].includes(a) && !confirm(`${a === 'stop' ? 'Dừng' : 'Khởi động lại'} container "${c.name}"?`)) return; if (await dkDo(id, a)) { toast(`Đã ${a} ${c.name}`); dkContainers(); } }
    else if (d.dkstack) { const [n, a] = d.dkstack.split('|'); if (a !== 'start' && !confirm(`${a === 'stop' ? 'DỪNG' : 'Khởi động lại'} toàn bộ stack "${n}"?`)) return; toast('Đang xử lý stack...', 'info'); const r = await send(`/api/docker/stacks/${encodeURIComponent(n)}/${a}`, {}); r.success ? (toast(`Đã ${a} ${r.count} container của ${n}`), dkStacks()) : toast(r.error || 'Thất bại', 'danger'); }
    else if (d.dknetrm) { if(!confirm(`Xóa network ${d.dknetrm}? Network đang được dùng sẽ bị từ chối.`)) return; const r=await send('/api/docker/networks/remove',{name:d.dknetrm}); r.success ? (toast('Đã xóa network'),dkNetworks()) : toast(r.error||'Không thể xóa network','danger'); }
    else if (d.dkrmi) { const [id, name] = d.dkrmi.split('|'); if (!confirm(`Xóa image ${name}?`)) return; const r = await send('/api/docker/images/remove', { id }); r.success ? (toast('Đã xóa image'), dkImages()) : toast(r.error || 'Thất bại', 'danger'); }
    else if (d.dkrmv) { if (!confirm(`Xóa volume "${d.dkrmv}"?\nDữ liệu trong volume sẽ MẤT vĩnh viễn.`)) return; const r = await send('/api/docker/volumes/remove', { name: d.dkrmv }); r.success ? (toast('Đã xóa volume'), dkVolumes()) : toast(r.error || 'Thất bại', 'danger'); }
    else if (d.dkprune) {
        const v = d.dkprune === 'volume', b = d.dkprune === 'builder'; if (!confirm(v ? 'XÓA MỌI volume không có container nào dùng?\nKhông thể hoàn tác.' : b ? 'Dọn Docker Build Cache? Cache sẽ cần build lại khi cần.' : 'Xóa các image không gắn thẻ (dangling)?')) return;
        const r = b ? await send('/api/docker/builder/prune',{confirm:'PRUNE_BUILD_CACHE'}) : await send(`/api/docker/${v ? 'volumes' : 'images'}/prune`, {}); r.success ? (toast(r.log || 'Đã dọn'), v ? dkVolumes() : b ? dkDash() : dkImages()) : toast(r.error || 'Thất bại', 'danger');
    }
});
