// ui8.js - IT Asset Management, Vulnerability/Patch, KPI/SLA và Network/Cloud/Kubernetes.
// Không tích hợp AI; mọi thao tác thay đổi phải được backend xác thực quyền.
const UI8_MODULES = { assets: 'assets', vuln: 'vuln', reports: 'reports', platforms: 'platforms' };
titles.assets = 'IT Asset Management';
titles.vuln = 'Vulnerability & Patch Management';
titles.reports = 'Báo Cáo KPI / SLA';
titles.platforms = 'Network / Cloud / Kubernetes';
PAGES.push('assets', 'vuln', 'reports', 'platforms');
$('nav-helpdesk').insertAdjacentHTML('afterend', `
<a class="nav-link d-none" id="nav-assets" onclick="navigateTo('assets')"><i class="fa-solid fa-boxes-stacked me-2"></i> IT Asset Management</a>
<a class="nav-link d-none" id="nav-vuln" onclick="navigateTo('vuln')"><i class="fa-solid fa-bug me-2"></i> Vulnerability & Patch</a>
<a class="nav-link d-none" id="nav-reports" onclick="navigateTo('reports')"><i class="fa-solid fa-chart-pie me-2"></i> KPI / SLA Reports</a>
<a class="nav-link d-none" id="nav-platforms" onclick="navigateTo('platforms')"><i class="fa-solid fa-cloud me-2"></i> Network / Cloud / K8s</a>`);
['Employee', 'IT-Staff'].forEach(role => {
    const prior = Object.getOwnPropertyDescriptor(allow, role).get;
    Object.defineProperty(allow, role, { configurable: true, enumerable: true, get: () => {
        const list = prior(), p = curUser?.perms || {};
        const extra = Object.entries(UI8_MODULES).filter(([, mod]) => p[mod] && p[mod] !== 'none').map(([page]) => page);
        return [...new Set([...list, ...extra])];
    }});
});
const _applyRole8 = applyRole;
applyRole = () => {
    _applyRole8();
    Object.entries(UI8_MODULES).forEach(([page, mod]) => {
        const n = $('nav-' + page); if (!n) return;
        const p = curUser?.perms || {};
        n.classList.toggle('d-none', curUser?.role !== 'Super-Admin' && (!p[mod] || p[mod] === 'none'));
    });
};
const _refresh8 = refreshCurrentView;
refreshCurrentView = () => {
    if (!curUser) return;
    if (currentSection === 'assets') return loadAssets8();
    if (currentSection === 'vuln') return loadVuln8();
    if (currentSection === 'reports') return loadReports8();
    if (currentSection === 'platforms') return loadPlatforms8();
    return _refresh8();
};

const hasManage8 = mod => curUser?.role === 'Super-Admin' || curUser?.perms?.[mod] === 'manage';
const fmt8 = v => {
    if (!v) return '—';
    const raw = String(v);
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const d = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : normalized + 'Z');
    return Number.isNaN(d.getTime()) ? esc(raw) : d.toLocaleString('vi-VN');
};
const date8 = v => v ? String(v).slice(0, 10) : '—';
const safeHttpUrl8 = value => { try { const u = new URL(String(value || '').split(',')[0]); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch (_) { return ''; } };
const pill8 = (label, color = 'secondary') => `<span class="badge bg-${color}">${esc(label)}</span>`;
const metric8 = (label, value, sub, color = 'info') => `<div class="col-6 col-xl-3"><div class="card gauge-box h-100"><small class="text-secondary">${esc(label)}</small><div class="gauge-val my-2 text-${color}">${esc(value)}</div><small class="text-secondary">${esc(sub || '')}</small></div></div>`;
const actResult8 = (d, ok, fail) => d?.success ? (toast(ok || 'Đã lưu'), true) : (toast(d?.error || fail || 'Thao tác thất bại', 'danger'), false);

// ---------------- IT ASSET MANAGEMENT ----------------
let ASSET_ROWS8 = [];
async function loadAssets8() {
    if (!$('assetRows')) return;
    const q = encodeURIComponent($('assetSearch')?.value || ''), type = encodeURIComponent($('assetTypeFilter')?.value || ''), status = encodeURIComponent($('assetStatusFilter')?.value || '');
    const d = await J(`/api/assets?q=${q}&type=${type}&status=${status}`);
    if (!Array.isArray(d.assets)) { $('assetRows').innerHTML = `<tr><td colspan="8" class="text-danger">${esc(d.error || 'Không tải được danh mục tài sản')}</td></tr>`; return; }
    ASSET_ROWS8 = d.assets;
    const sm = d.summary || {};
    $('assetKpi').innerHTML = metric8('Tổng tài sản', sm.total || 0, 'Danh mục') + metric8('Đang hoạt động', sm.active || 0, 'Trạng thái vòng đời', 'success') + metric8('Critical', sm.critical || 0, 'Tài sản quan trọng', 'danger') + metric8('Đồng bộ gần nhất', sm.last_sync_at ? fmt8(sm.last_sync_at) : '—', 'Nguồn Zabbix hoặc nhập tay', 'warning');
    const canManageAssets = hasManage8('assets'), canCreateTicket = hasManage8('helpdesk'), superOnly = curUser?.role === 'Super-Admin';
    $('assetRows').innerHTML = d.assets.map(a => `<tr><td><code>${esc(a.asset_tag)}</code></td><td><b>${esc(a.name)}</b><br><small class="text-secondary">${esc(a.hostname || '—')}${a.os ? ' · ' + esc(a.os) : ''}</small></td><td>${a.ip_address ? `<code>${esc(a.ip_address)}</code>` : '—'}</td><td>${pill8(a.asset_type, 'secondary')}<br><small class="text-secondary">${esc(a.environment || '—')}</small></td><td>${pill8(a.criticality, a.criticality === 'Critical' ? 'danger' : a.criticality === 'High' ? 'warning text-dark' : 'info text-dark')}</td><td><small>${esc(a.source || 'Manual')}</small>${a.monitoring_state ? `<br><small class="text-secondary">${esc(a.monitoring_state)}</small>` : ''}</td><td>${pill8(a.status, a.status === 'Active' ? 'success' : a.status === 'Maintenance' ? 'warning text-dark' : 'secondary')}</td><td class="text-end text-nowrap">${canManageAssets ? `<button class="btn btn-sm btn-outline-info" data-asset-edit="${a.id}" title="Sửa"><i class="fa-solid fa-pen"></i></button>` : ''}${canCreateTicket ? ` <button class="btn btn-sm btn-outline-primary" data-asset-ticket="${a.id}" title="Tạo ticket"><i class="fa-solid fa-headset"></i></button>` : ''}${superOnly ? ` <button class="btn btn-sm btn-outline-danger" data-asset-delete="${a.id}" title="Xóa"><i class="fa-solid fa-trash"></i></button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="text-secondary">Chưa có tài sản; thêm thủ công hoặc đồng bộ host từ Zabbix.</td></tr>';
    if ($('assetNew')) $('assetNew').classList.toggle('d-none', !canManageAssets);
    if ($('assetSync')) $('assetSync').classList.toggle('d-none', !canManageAssets);
}
function assetFormOpen8(a = null) {
    if (!$('assetForm')) return;
    $('assetForm').reset(); $('assetId').value = a?.id || '';
    $('assetModalTitle').innerText = a ? 'Chỉnh sửa tài sản' : 'Thêm tài sản';
    const fields = { assetTag: 'asset_tag', assetName: 'name', assetType: 'asset_type', assetHostname: 'hostname', assetIP: 'ip_address', assetOS: 'os', assetEnv: 'environment', assetCriticality: 'criticality', assetOwner: 'owner', assetStatus: 'status', assetNotes: 'notes' };
    Object.entries(fields).forEach(([el, key]) => { if ($(el)) $(el).value = a?.[key] ?? (el === 'assetEnv' ? 'Lab' : el === 'assetCriticality' ? 'Medium' : el === 'assetStatus' ? 'Active' : el === 'assetType' ? 'Server' : ''); });
    bootstrap.Modal.getOrCreateInstance($('assetModal')).show();
}
async function syncAssets8() {
    if (!confirm('Đồng bộ host từ Zabbix vào danh mục tài sản? Owner và ghi chú đã nhập sẽ được giữ nguyên.')) return;
    const d = await send('/api/assets/sync-zabbix', {});
    if (actResult8(d, `Đồng bộ xong: thêm ${d.added || 0}, cập nhật ${d.updated || 0}`, 'Không đồng bộ được')) loadAssets8();
}
async function saveAsset8(e) {
    e.preventDefault(); const id = $('assetId').value;
    const body = { asset_tag: $('assetTag').value, name: $('assetName').value, asset_type: $('assetType').value, hostname: $('assetHostname').value, ip_address: $('assetIP').value, os: $('assetOS').value, environment: $('assetEnv').value, criticality: $('assetCriticality').value, owner: $('assetOwner').value, status: $('assetStatus').value, notes: $('assetNotes').value };
    const d = await send(id ? `/api/assets/${id}` : '/api/assets', body, id ? 'PUT' : 'POST');
    if (actResult8(d, 'Đã lưu tài sản', 'Không thể lưu tài sản')) { bootstrap.Modal.getInstance($('assetModal'))?.hide(); loadAssets8(); }
}

// ---------------- VULNERABILITY / PATCH MANAGEMENT ----------------
let VULN_DATA8 = { findings: [], patches: [] };
async function loadVuln8() {
    if (!$('vulnRows')) return;
    const d = await J('/api/vuln');
    if (!Array.isArray(d.findings)) { $('vulnRows').innerHTML = `<tr><td colspan="8" class="text-danger">${esc(d.error || 'Không tải được dữ liệu')}</td></tr>`; return; }
    VULN_DATA8 = d;
    const sm = d.summary || {};
    $('vulnKpi').innerHTML = metric8('Tổng findings', sm.total || 0, 'Wazuh import + thủ công') + metric8('Open', sm.open || 0, 'Cần phân loại/khắc phục', 'warning') + metric8('In progress', sm.in_progress || 0, 'Đang xử lý', 'info') + metric8('Critical', sm.critical || 0, 'Finding Critical chưa đóng', 'danger');
    const q = ($('vulnSearch')?.value || '').toLowerCase(), sev = $('vulnSeverityFilter')?.value || '', st = $('vulnStatusFilter')?.value || '';
    const rows = d.findings.filter(v => (!q || [v.cve,v.title,v.asset_name,v.package_name,v.source].some(x => String(x || '').toLowerCase().includes(q))) && (!sev || v.severity === sev) && (!st || v.status === st));
    const can = hasManage8('vuln');
    const countNote = document.getElementById('vulnListCount'); if(countNote) countNote.textContent = `Hiển thị ${rows.length} / ${VULN_DATA8.findings.length} bản ghi đã tải · cuộn trong khung để xem danh sách`;
    $('vulnRows').innerHTML = rows.map(v => `<tr><td>${pill8(v.severity, v.severity === 'Critical' ? 'danger' : v.severity === 'High' ? 'warning text-dark' : v.severity === 'Medium' ? 'info text-dark' : 'secondary')}${v.score != null ? `<br><small class="text-secondary">CVSS ${esc(v.score)}</small>` : ''}</td><td>${v.cve ? `<a target="_blank" rel="noopener" href="https://nvd.nist.gov/vuln/detail/${encodeURIComponent(v.cve)}"><code>${esc(v.cve)}</code></a><br>` : ''}<b>${esc(v.title)}</b>${safeHttpUrl8(v.reference) ? `<br><a href="${esc(safeHttpUrl8(v.reference))}" target="_blank" rel="noopener noreferrer" class="small">Reference</a>` : ''}</td><td>${esc(v.asset_name || '—')}${v.linked_asset_tag ? `<br><small class="text-secondary">${esc(v.linked_asset_tag)}</small>` : ''}</td><td>${esc(v.package_name || '—')}<br><small class="text-secondary">${esc(v.installed_version || '')}</small></td><td>${pill8(v.source || 'Manual', v.source === 'Wazuh' ? 'info text-dark' : 'secondary')}</td><td><select class="form-select form-select-sm bg-transparent" data-vuln-status="${v.id}" style="min-width:135px" ${can ? '' : 'disabled'}>${['Open','InProgress','Mitigated','Accepted'].map(x => `<option value="${x}"${v.status===x?' selected':''}>${x}</option>`).join('')}</select></td><td><small>${esc(date8(v.due_date))}</small><br><small class="text-secondary">${esc(date8(v.detected_at))}</small></td><td class="text-nowrap">${can ? `<button class="btn btn-sm btn-outline-info" data-vuln-edit="${v.id}" title="Cập nhật xử lý"><i class="fa-solid fa-pen"></i></button>` : '—'}${v.source === 'Wazuh' ? ` <span class="small text-secondary" title="Được nhập từ Wazuh">Imported</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="text-secondary">Không có finding phù hợp; dùng Đồng bộ Wazuh hoặc thêm thủ công.</td></tr>';
    $('patchRows').innerHTML = (d.patches || []).map(p => `<tr><td>${esc(p.asset_name || '—')}${p.linked_asset_tag ? `<br><small>${esc(p.linked_asset_tag)}</small>` : ''}</td><td><b>${esc(p.title)}</b>${p.finding_id ? `<br><small class="text-secondary">Finding #${esc(p.finding_id)}</small>` : ''}</td><td><code>${esc(p.patch_ref || '—')}</code></td><td>${esc(p.patch_type)}</td><td>${esc(date8(p.planned_date))}</td><td>${esc(p.assigned_to || '—')}</td><td><select class="form-select form-select-sm bg-transparent" data-patch-status="${p.id}" style="min-width:130px" ${can ? '' : 'disabled'}>${['Planned','InProgress','Installed','Failed','Deferred'].map(x => `<option value="${x}"${p.status===x?' selected':''}>${x}</option>`).join('')}</select></td><td><small class="text-secondary">${esc(date8(p.completed_at))}</small></td></tr>`).join('') || '<tr><td colspan="8" class="text-secondary">Chưa có patch task. Dùng Tạo tác vụ bản vá để theo dõi thay đổi.</td></tr>';
    ['vulnNew','patchNew','vulnSync'].forEach(id => { if ($(id)) $(id).classList.toggle('d-none', !can); });
}
function vulnFormOpen8(v = null) {
    if (!$('vulnForm')) return;
    $('vulnForm').reset(); $('vfId').value = v?.id || '';
    $('vfTitle').value = v?.title || ''; $('vfCve').value = v?.cve || ''; $('vfAsset').value = v?.asset_id || ''; $('vfPackage').value = v?.package_name || ''; $('vfVersion').value = v?.installed_version || ''; $('vfFixed').value = v?.fixed_version || ''; $('vfSeverity').value = v?.severity || 'Medium'; $('vfScore').value = v?.score ?? ''; $('vfDue').value = date8(v?.due_date) === '—' ? '' : date8(v?.due_date); $('vfAssignee').value = v?.assigned_to || ''; $('vfRef').value = v?.reference || ''; $('vfRemediation').value = v?.remediation || ''; $('vfNotes').value = v?.notes || ''; $('vfStatus').value = v?.status || 'Open';
    const isEdit = !!v; ['vfTitle','vfCve','vfAsset','vfPackage','vfVersion','vfFixed','vfScore','vfRef'].forEach(id => $(id).disabled = isEdit);
    $('vulnModal').dataset.editId = v?.id || ''; $('vulnModal').querySelector('.modal-title').innerText = v ? 'Cập nhật xử lý lỗ hổng' : 'Ghi nhận phát hiện lỗ hổng';
    bootstrap.Modal.getOrCreateInstance($('vulnModal')).show();
}
async function syncVuln8() {
    if (!confirm('Đọc inventory lỗ hổng từ Wazuh Indexer và đồng bộ vào Portal? Thao tác này không cài hoặc sửa bản vá.')) return;
    toast('Đang đọc Vulnerability Detection inventory từ Wazuh…', 'info');
    const d = await send('/api/vuln/sync-wazuh', {});
    if (actResult8(d, `Wazuh sync xong: ${d.added || 0} mới, ${d.updated || 0} cập nhật`, 'Đồng bộ Wazuh thất bại')) loadVuln8();
}
async function saveVuln8(e) {
    e.preventDefault(); const id = $('vulnModal').dataset.editId;
    const body = id ? { status: $('vfStatus').value, severity: $('vfSeverity').value, assigned_to: $('vfAssignee').value, due_date: $('vfDue').value, remediation: $('vfRemediation').value, notes: $('vfNotes').value } : { title: $('vfTitle').value, cve: $('vfCve').value, asset_id: $('vfAsset').value, package_name: $('vfPackage').value, installed_version: $('vfVersion').value, fixed_version: $('vfFixed').value, severity: $('vfSeverity').value, score: $('vfScore').value, due_date: $('vfDue').value, assigned_to: $('vfAssignee').value, reference: $('vfRef').value, remediation: $('vfRemediation').value, notes: $('vfNotes').value };
    const d = await send(id ? `/api/vuln/findings/${id}` : '/api/vuln/findings', body, id ? 'PUT' : 'POST');
    if (actResult8(d, 'Đã lưu finding', 'Không thể lưu finding')) { bootstrap.Modal.getInstance($('vulnModal'))?.hide(); loadVuln8(); }
}
async function savePatch8(e) {
    e.preventDefault(); const d = await send('/api/vuln/patches', { title: $('pjTitle').value, asset_id: $('pjAsset').value, finding_id: $('pjFinding').value, patch_ref: $('pjRef').value, patch_type: $('pjType').value, planned_date: $('pjDate').value, assigned_to: $('pjAssignee').value, notes: $('pjNotes').value });
    if (actResult8(d, 'Đã tạo patch task', 'Không thể tạo patch task')) { bootstrap.Modal.getInstance($('patchModal'))?.hide(); loadVuln8(); }
}

// ---------------- KPI / SLA REPORTING ----------------
async function loadReports8() {
    if (!$('reportKpi')) return;
    const days = Number($('reportDays')?.value || 30), d = await J(`/api/reports/summary?days=${days}`);
    if (!d.tickets) { $('reportKpi').innerHTML = `<div class="col-12 text-danger">${esc(d.error || 'Không tải được KPI')}</div>`; return; }
    const fmtMinutes = n => n == null ? '—' : n < 60 ? `${Math.round(n)} phút` : `${(n/60).toFixed(1)} giờ`;
    $('reportKpi').innerHTML = metric8('Tài sản', d.assets.total, `${d.assets.active} đang hoạt động`) + metric8('Ticket đang mở', d.tickets.open, `${d.tickets.resolvedPeriod} đã giải quyết trong kỳ`, 'info') + metric8('SLA phản hồi quá hạn', d.tickets.responseBreached, 'Gồm phản hồi trễ và ticket đang chờ quá hạn', d.tickets.responseBreached ? 'danger' : 'success') + metric8('SLA giải quyết quá hạn', d.tickets.resolutionBreached, 'Gồm xử lý trễ và ticket đang mở vượt hạn', d.tickets.resolutionBreached ? 'danger' : 'success') + metric8('Finding còn mở', d.vulnerabilities.open, `${d.vulnerabilities.critical} Critical`, d.vulnerabilities.critical ? 'danger' : 'warning') + metric8('Patch đã cài', d.patches.installed, `${d.patches.pending} tác vụ đang chờ`, 'success') + metric8('Phản hồi trung bình', fmtMinutes(d.tickets.avgResponseMinutes), 'Tính từ ticket có first response') + metric8('Giải quyết trung bình', fmtMinutes(d.tickets.avgResolutionMinutes), 'Tính từ ticket đã resolve', 'info');
    $('reportSla').innerHTML = `<table class="table table-sm"><tbody><tr><th>Ticket tạo trong kỳ</th><td class="text-end">${d.tickets.total}</td></tr><tr><th>Đã xử lý trong kỳ</th><td class="text-end">${d.tickets.resolvedPeriod}</td></tr><tr><th>Quá hạn phản hồi</th><td class="text-end">${d.tickets.responseBreached}</td></tr><tr><th>Quá hạn giải quyết</th><td class="text-end">${d.tickets.resolutionBreached}</td></tr><tr><th>Thời gian phản hồi TB</th><td class="text-end">${fmtMinutes(d.tickets.avgResponseMinutes)}</td></tr><tr><th>Thời gian xử lý TB</th><td class="text-end">${fmtMinutes(d.tickets.avgResolutionMinutes)}</td></tr><tr><th>Audit actions trong kỳ</th><td class="text-end">${d.auditActions}</td></tr></tbody></table>`;
    $('reportRisk').innerHTML = `<div class="row g-3"><div class="col-6"><div class="p-3 border rounded"><small class="text-secondary">Finding</small><div class="fs-3 fw-bold">${d.vulnerabilities.total}</div><div>Open: ${d.vulnerabilities.open}</div><div>Mitigated: ${d.vulnerabilities.mitigated}</div></div></div><div class="col-6"><div class="p-3 border rounded"><small class="text-secondary">Patch tasks</small><div class="fs-3 fw-bold">${d.patches.total}</div><div>Installed: ${d.patches.installed}</div><div>Pending: ${d.patches.pending}</div></div></div></div><table class="table table-sm mt-3"><thead><tr><th>Severity đang mở</th><th class="text-end">Số lượng</th></tr></thead><tbody>${['Critical','High','Medium','Low','Info'].map(s => `<tr><td>${esc(s)}</td><td class="text-end">${(d.vulnerabilities.bySeverity || []).find(x => x.severity === s)?.count || 0}</td></tr>`).join('')}</tbody></table>`;
    $('reportTrend').innerHTML = (d.ticketTrend || []).map(x => `<tr><td>${esc(x.day)}</td><td>${x.created || 0}</td><td>${x.resolved || 0}</td></tr>`).join('') || '<tr><td colspan="3" class="text-secondary">Không có ticket trong khoảng thời gian này.</td></tr>';
}

// ---------------- NETWORK / CLOUD / KUBERNETES ----------------
const statusCard8 = x => {
    const state = !x.configured ? ['Chưa cấu hình', 'secondary'] : x.reachable ? ['TCP reachable', 'success'] : ['Không kết nối', 'danger'];
    return `<div class="col-md-4"><div class="card p-3 h-100"><div class="d-flex justify-content-between gap-2"><h6 class="fw-bold"><i class="${x.id === 'pfsense' ? 'fa-solid fa-network-wired' : x.id === 'wazuh' ? 'fa-solid fa-shield-halved' : 'fa-solid fa-chart-line'} me-2"></i>${esc(x.name)}</h6>${pill8(state[0], state[1])}</div><div class="small text-secondary">${esc(x.detail || '')}</div></div></div>`;
};
async function loadPlatforms8() {
    if (!$('platformLocal')) return;
    const d = await J('/api/platforms');
    if (!Array.isArray(d.local)) { $('platformLocal').innerHTML = `<div class="col-12 text-danger">${esc(d.error || 'Không lấy được trạng thái các integration.')}</div>`; return; }
    $('platformLocal').innerHTML = d.local.map(statusCard8).join('');
    const k = d.kubernetes || {};
    $('platformK8s').innerHTML = !k.configured ? `<div class="mb-2">${pill8('Chưa cấu hình', 'secondary')}</div><div class="small text-secondary">Khi có môi trường Kubernetes, đặt K8S_API_URL và K8S_BEARER_TOKEN trong .env để bật kiểm tra chỉ đọc.</div>` : !k.reachable ? `<div class="mb-2">${pill8('Không kết nối', 'danger')}</div><div class="small text-danger">${esc(k.error || 'Không kết nối được API')}</div>` : `<div class="mb-2">${pill8('Connected', 'success')} <span class="small text-secondary">${esc(k.version || '')}</span></div><div class="row g-2">${metric8('Nodes', k.nodes, `${k.nodesReady} Ready`, 'success')}${metric8('Pods', k.pods, `${k.podsNotRunning} không Running/Succeeded`, k.podsNotRunning ? 'warning' : 'info')}</div><small class="text-secondary">Kiểm tra lúc ${esc(fmt8(k.sampledAt))}</small>`;
    const c = d.cloud || {};
    $('platformCloud').innerHTML = !c.configured ? `<div class="mb-2">${pill8('Chưa cấu hình', 'secondary')}</div><div class="small text-secondary">Cloud connector bật khi CLOUD_PROVIDER=aws và các biến AWS credential/region được cấu hình trên máy chủ.</div>` : !c.reachable ? `<div class="mb-2">${pill8('Lỗi kết nối / API', 'danger')}</div><div class="small text-danger">${esc(c.error || 'Không truy vấn được AWS')}</div>` : `<div class="mb-2">${pill8('AWS connected', 'success')} <span class="small text-secondary">${esc(c.region || '')}</span></div><div class="row g-2">${metric8('Running instances', c.running ?? '—', `Tổng trả về: ${c.instances ?? '—'}`, 'success')}</div><div class="table-responsive mt-2"><table class="table table-sm"><thead><tr><th>Instance</th><th>Name</th><th>State</th><th>Type</th><th>Private IP</th></tr></thead><tbody>${(c.instanceList || []).map(i => `<tr><td><code>${esc(i.id)}</code></td><td>${esc(i.name)}</td><td>${pill8(i.state, i.state === 'running' ? 'success' : 'secondary')}</td><td>${esc(i.type)}</td><td>${esc(i.privateIp)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-secondary">Không có EC2 instance được trả về.</td></tr>'}</tbody></table></div>${c.moreAvailable ? '<div class="small text-warning">AWS trả về hơn 100 instance; danh sách hiện chỉ hiển thị trang đầu. Cần pagination nếu môi trường lớn hơn.</div>' : ''}<div class="small text-secondary">CloudWatch CPU sample: ${(c.cpuSamples || []).map(x => `${esc(x.name || x.id)} ${x.avgCpu == null ? '—' : x.avgCpu + '%'}`).join(' · ')}</div>`;
}

// ---------------- DYNAMIC VIEWS: use delegation because views are inserted on navigation ----------------
document.addEventListener('input', e => {
    if (e.target.id === 'assetSearch') loadAssets8();
    if (e.target.id === 'vulnSearch') loadVuln8();
});
document.addEventListener('change', async e => {
    const el = e.target;
    if (el.id === 'assetTypeFilter' || el.id === 'assetStatusFilter') return loadAssets8();
    if (el.id === 'vulnSeverityFilter' || el.id === 'vulnStatusFilter') return loadVuln8();
    if (el.id === 'reportDays') return loadReports8();
    if (el.matches('[data-vuln-status]')) {
        const id = el.dataset.vulnStatus, f = VULN_DATA8.findings.find(x => String(x.id) === id);
        const d = await send(`/api/vuln/findings/${id}`, { status: el.value, severity: f?.severity, assigned_to: f?.assigned_to, due_date: f?.due_date, remediation: f?.remediation, notes: f?.notes }, 'PUT');
        if (actResult8(d, 'Đã cập nhật trạng thái finding')) loadVuln8();
    } else if (el.matches('[data-patch-status]')) {
        const id = el.dataset.patchStatus, old = (VULN_DATA8.patches || []).find(x => String(x.id) === id);
        const d = await send(`/api/vuln/patches/${id}`, { status: el.value, assigned_to: old?.assigned_to, planned_date: old?.planned_date, notes: old?.notes }, 'PUT');
        if (actResult8(d, 'Đã cập nhật patch task')) loadVuln8();
    }
});
document.addEventListener('submit', e => {
    if (e.target.id === 'assetForm') return saveAsset8(e);
    if (e.target.id === 'vulnForm') return saveVuln8(e);
    if (e.target.id === 'patchForm') return savePatch8(e);
});
document.addEventListener('click', async e => {
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.id === 'assetNew') return assetFormOpen8();
    if (t.id === 'assetSync') return syncAssets8();
    if (t.id === 'vulnNew') return vulnFormOpen8();
    if (t.id === 'vulnSync') return syncVuln8();
    if (t.id === 'patchNew') { $('patchForm')?.reset(); if ($('patchModal')) bootstrap.Modal.getOrCreateInstance($('patchModal')).show(); return; }
    if (t.id === 'reportRefresh') return loadReports8();
    if (t.id === 'reportPrint') { window.print(); return; }
    if (t.id === 'reportOpenDataset') { window.open('/api/reports/dataset?limit=500', '_blank', 'noopener'); return; }
    if (t.id === 'reportExportCsv') { const kind = $('reportCsvType')?.value || 'tickets'; window.location.assign(`/api/reports/export.csv?type=${encodeURIComponent(kind)}&limit=1000`); return; }
    if (t.id === 'platformRefresh') return loadPlatforms8();
    const editAsset = t.closest('[data-asset-edit]');
    if (editAsset) return assetFormOpen8(ASSET_ROWS8.find(a => String(a.id) === editAsset.dataset.assetEdit));
    const delAsset = t.closest('[data-asset-delete]');
    if (delAsset) {
        if (!confirm('Xóa tài sản khỏi danh mục? Các ticket/lịch sử liên quan không tự bị xóa.')) return;
        const d = await send('/api/assets/' + delAsset.dataset.assetDelete, null, 'DELETE');
        if (actResult8(d, 'Đã xóa tài sản')) loadAssets8(); return;
    }
    const assetTicket = t.closest('[data-asset-ticket]');
    if (assetTicket) {
        const a = ASSET_ROWS8.find(x => String(x.id) === assetTicket.dataset.assetTicket);
        window.__tkAssetId = assetTicket.dataset.assetTicket; window.__tkType = 'Sự cố';
        await navigateTo('helpdesk');
        if ($('tkTitle')) $('tkTitle').value = `Sự cố liên quan ${a?.name || 'tài sản'}`;
        if ($('tkDesc')) $('tkDesc').value = `Tài sản: ${a?.asset_tag || ''} — ${a?.name || ''} (${a?.ip_address || a?.hostname || ''})\n\nMô tả sự cố: `;
        if ($('tkAssetId')) $('tkAssetId').value = assetTicket.dataset.assetTicket;
        if ($('tkAssetHint')) { $('tkAssetHint').innerText = `Ticket sẽ liên kết với tài sản ${a?.asset_tag || a?.name || ''}.`; $('tkAssetHint').classList.remove('d-none'); }
        return;
    }
    const editVuln = t.closest('[data-vuln-edit]');
    if (editVuln) return vulnFormOpen8(VULN_DATA8.findings.find(v => String(v.id) === editVuln.dataset.vulnEdit));
    const makeIncident = t.closest('[data-create-incident]');
    if (makeIncident) {
        if (!hasManage8('helpdesk')) return toast('Bạn không có quyền tạo incident từ alert.', 'danger');
        const d = await send('/api/tickets/from-alert', { source: makeIncident.dataset.source || 'Manual', external_id: makeIncident.dataset.externalId || '', title: makeIncident.dataset.title || 'Alert từ hệ thống', description: makeIncident.dataset.description || '', asset_name: makeIncident.dataset.assetName || '', priority: makeIncident.dataset.priority || 'High' });
        if (d.success) toast(d.duplicate ? `Alert đã có ticket #${d.id}` : `Đã tạo Incident #${d.id}`); else toast(d.error || 'Không tạo được incident', 'danger');
    }
});
setInterval(() => {
    if (!curUser || document.hidden || document.querySelector('.modal.show')) return;
    if (currentSection === 'reports') loadReports8();
    else if (currentSection === 'platforms') loadPlatforms8();
}, 60000);
