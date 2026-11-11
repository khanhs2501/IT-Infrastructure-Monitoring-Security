const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Toast thay cho alert()
function toast(msg, type = 'success') {
    let box = document.getElementById('toastBox');
    if (!box) { box = document.createElement('div'); box.id = 'toastBox'; box.className = 'toast-container position-fixed top-0 end-0 p-3'; box.style.zIndex = 2000; document.body.appendChild(box); }
    const el = document.createElement('div'); el.className = `toast align-items-center text-bg-${type} border-0`;
    el.innerHTML = '<div class="d-flex"><div class="toast-body"></div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    el.querySelector('.toast-body').textContent = msg; box.appendChild(el);
    el.addEventListener('hidden.bs.toast', () => el.remove()); new bootstrap.Toast(el, { delay: 3500 }).show();
}
window.alert = m => toast(String(m), /lỗi|không|thất bại/i.test(m) ? 'danger' : 'success');

// Phiên hết hạn / thiếu quyền
const _fetch = window.fetch.bind(window);
window.fetch = async (...a) => {
    const r = await _fetch(...a);
    if (r.status === 401 && !String(a[0]).includes('/auth/')) { toast('Phiên đăng nhập đã hết hạn', 'warning'); }
    else if (r.status === 403) toast('Bạn không đủ quyền thực hiện thao tác này', 'danger');
    return r;
};

// Phân quyền menu theo vai trò (backend vẫn kiểm tra lại)
const allow = { 'Employee': ['helpdesk'], 'IT-Staff': ['zabbix', 'wazuh', 'pfsense', 'ad', 'helpdesk'] };
function applyRole() {
    const a = allow[curUser && curUser.role];
    ['zabbix', 'wazuh', 'pfsense', 'ad', 'admin', 'audit', 'helpdesk'].forEach(s => { const n = document.getElementById('nav-' + s); if (n) n.classList.toggle('d-none', !!a && !a.includes(s)); });
}

// Biểu đồ live (giữ 30 điểm gần nhất)
const Z = { t: [], lc: [], rc: [], lm: [], rm: [] }, P = { t: [], i: [], o: [] }, CH = {};
const num = id => parseFloat((document.getElementById(id) || {}).innerText) || 0;
const keep = o => { for (const k in o) if (o[k].length > 30) o[k].shift(); };
function addCharts(sec) {
    if (document.getElementById('ch-' + sec)) return;
    const defs = sec === 'zabbix' ? [['chCpu', 'CPU (%)'], ['chMem', 'RAM (%)']] : [['chWan', 'Băng thông WAN (Mbps)']];
    document.getElementById('dynamic-content').insertAdjacentHTML('afterbegin', `<div class="row g-3 mb-4" id="ch-${sec}">${defs.map(([id, t]) => `<div class="col-md-${12 / defs.length}"><div class="card p-3"><small class="text-secondary fw-bold">${t}</small><canvas id="${id}" height="90"></canvas></div></div>`).join('')}</div>`);
}
function draw(id, labels, sets) {
    const el = document.getElementById(id); if (!el || typeof Chart === 'undefined') return;
    if (!CH[id] || CH[id].canvas !== el) CH[id] = new Chart(el, { type: 'line', data: { labels, datasets: sets.map(([l, d, c]) => ({ label: l, data: d, borderColor: c, backgroundColor: c + '22', fill: true, tension: .35, pointRadius: 0, borderWidth: 2 })) }, options: { animation: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { labels: { boxWidth: 10 } } } } });
    else CH[id].update('none');
}
const _lz = loadZabbix; loadZabbix = async () => {
    await _lz(); if (!document.getElementById('zbLC')) return;
    Z.t.push(new Date().toLocaleTimeString('vi-VN')); Z.lc.push(num('zbLC')); Z.rc.push(num('zbRC')); Z.lm.push(num('zbLM')); Z.rm.push(num('zbRM')); keep(Z);
    draw('chCpu', Z.t, [['LINUX01', Z.lc, '#38bdf8'], ['ROYAL01', Z.rc, '#f59e0b']]); draw('chMem', Z.t, [['LINUX01', Z.lm, '#10b981'], ['ROYAL01', Z.rm, '#ef4444']]);
};
const _lp = loadPfSense; loadPfSense = async () => {
    await _lp(); if (!document.getElementById('pfWanIn')) return;
    P.t.push(new Date().toLocaleTimeString('vi-VN')); P.i.push(num('pfWanIn')); P.o.push(num('pfWanOut')); keep(P);
    draw('chWan', P.t, [['Tải xuống', P.i, '#10b981'], ['Tải lên', P.o, '#f59e0b']]);
};

// Nhật ký hoạt động
async function loadAudit() {
    const r = await fetch('/api/audit'); if (!r.ok) return; const d = await r.json(); const el = document.getElementById('auditList');
    if (el) el.innerHTML = d.map(a => `<tr><td><small>${esc(a.time)}</small></td><td class="fw-bold text-warning">${esc(a.username)}</td><td>${esc(a.role)}</td><td><span class="badge bg-secondary">${esc(a.method)}</span></td><td><code>${esc(a.path)}</code></td><td><span class="badge bg-${a.status < 400 ? 'success' : 'danger'}">${a.status}</span></td><td><small>${esc(a.ip)}</small></td></tr>`).join('');
}

// Điều hướng + làm mới (tạm dừng khi tab bị ẩn)
const _nav = navigateTo;
navigateTo = async sec => {
    const a = allow[curUser && curUser.role]; if (a && !a.includes(sec)) sec = a[0];
    applyRole(); const s = document.getElementById('globalSearch'); if (s) s.value = '';
    await _nav(sec);
    if (sec === 'audit') document.getElementById('secTitle').innerText = 'Nhật Ký Hoạt Động (Audit Log)';
    if (sec === 'zabbix' || sec === 'pfsense') addCharts(sec);
};
const _rf = refreshCurrentView;
refreshCurrentView = () => { if (currentSection === 'audit') return loadAudit(); if (!document.hidden) _rf(); };

// Thanh công cụ: tìm kiếm trong bảng + xuất CSV
function exportCSV() {
    const t = [...document.querySelectorAll('#dynamic-content table')].sort((a, b) => b.rows.length - a.rows.length)[0];
    if (!t) return toast('Không có bảng để xuất', 'warning');
    const csv = [...t.rows].map(r => [...r.cells].map(c => '"' + c.innerText.replace(/"/g, '""').trim() + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${currentSection}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}
(() => {
    const rb = document.querySelector('button[onclick="refreshCurrentView()"]'); if (!rb) return;
    const box = document.createElement('div'); box.className = 'd-flex gap-2';
    box.innerHTML = '<input id="globalSearch" class="form-control form-control-sm bg-transparent" placeholder="Tìm trong bảng...">' + '<button class="btn btn-sm btn-outline-success fw-bold" onclick="exportCSV()"><i class="fa-solid fa-file-csv me-1"></i> Xuất CSV</button>';
    rb.replaceWith(box); box.appendChild(rb);
})();
const applyFilter = () => { const q = ((document.getElementById('globalSearch') || {}).value || '').toLowerCase(); document.querySelectorAll('#dynamic-content tbody tr').forEach(tr => tr.style.display = !q || tr.innerText.toLowerCase().includes(q) ? '' : 'none'); };
document.addEventListener('input', e => { if (e.target.id === 'globalSearch') applyFilter(); });
new MutationObserver(applyFilter).observe(document.getElementById('dynamic-content'), { childList: true, subtree: true });


