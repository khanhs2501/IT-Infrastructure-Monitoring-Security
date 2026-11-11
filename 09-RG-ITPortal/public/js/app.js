let curUser = null; let currentSection = 'zabbix'; let currentADUsers = [];
// Initialize computer-management state before any view handler can reference it.
var adComputerOUs = [];
var adComputerInventory = [];
var adComputerPage = 0;
var adComputerTotal = 0;
var adComputerOwnerFilter = '';
var adComputerMacByIp = {};
var adComputerLeaseByName = {};
const adComputerHostKey = value => String(value || '').replace(/\$$/, '').split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
var adMoveModalInstance = null;
var adMoveComputerName = '';
const titles = { 'zabbix': 'Giám Sát Trạng Thái Hạ Tầng (ROYAL IT - Zabbix Monitoring)', 'wazuh': 'Trung Tâm Giám Sát An Ninh (Wazuh SIEM)', 'pfsense': 'Điều Phối Lưu Lượng & Cổng Mạng (pfSense)', 'ad': 'Quản Trị Danh Tính & Thư Mục (Active Directory)', 'admin': 'Quản Trị Hệ Thống (GPO & File Server)', 'helpdesk': 'Cổng Tiếp Nhận Hỗ Trợ Kỹ Thuật (IT Service Desk)' };

setInterval(() => {
    const d = new Date();
    if(document.getElementById('sidebarClockTime')) document.getElementById('sidebarClockTime').innerHTML = `<i class="fa-regular fa-clock me-1"></i>` + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    if(document.getElementById('sidebarClockDate')) document.getElementById('sidebarClockDate').innerText = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
}, 1000);

function toggleTheme() { const html = document.documentElement; const isDark = html.getAttribute('data-bs-theme') === 'dark'; html.setAttribute('data-bs-theme', isDark ? 'light' : 'dark'); document.getElementById('themeIcon').className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun'; localStorage.setItem('rg_theme', isDark ? 'light' : 'dark'); }
document.documentElement.setAttribute('data-bs-theme', localStorage.getItem('rg_theme') || 'dark');

async function navigateTo(sec) {
    const allowedSections = new Set(['overview', 'zabbix', 'wazuh', 'pfsense', 'ad', 'admin', 'helpdesk', 'audit', 'perm', 'deleg', 'profile', 'myfolders', 'docker', 'assets', 'vuln', 'reports', 'platforms', 'computers']);
    if (!allowedSections.has(sec)) sec = 'overview';
    currentSection = sec;
    document.querySelectorAll('.nav-link').forEach(e => e.classList.remove('active'));
    if(document.getElementById(`nav-${sec}`)) document.getElementById(`nav-${sec}`).classList.add('active');
    document.getElementById('secTitle').innerText = titles[sec] || 'Bảng Điều Khiển';
    const res = await fetch(`/views/${encodeURIComponent(sec)}.html?v=1.8.2`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Không tải được trang ${sec} (HTTP ${res.status})`);
    document.getElementById('dynamic-content').innerHTML = await res.text();
    refreshCurrentView();
}

function refreshCurrentView() {
    if (currentSection === 'zabbix') loadZabbix(); else if (currentSection === 'wazuh') loadWazuh(); else if (currentSection === 'pfsense') loadPfSense(); else if (currentSection === 'ad') loadAD(); else if (currentSection === 'admin') loadAdminTools(); else if (currentSection === 'helpdesk') loadTickets();
}
setInterval(() => { if (curUser && !document.hidden && ['zabbix', 'wazuh', 'pfsense'].includes(currentSection)) refreshCurrentView(); }, 10000);

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
        curUser = res.ok ? await res.json() : null;
    } catch (e) {
        curUser = null;
        if (window.rgLoginNotice) window.rgLoginNotice('Không kết nối được tới Portal. Kiểm tra dịch vụ rồi tải lại trang (F5).', 'warning');
    }
    if (curUser) {
        document.getElementById('loginScreen').classList.add('d-none'); document.getElementById('mainApp').classList.remove('d-none');
        document.getElementById('uName').innerText = curUser.fullname; document.getElementById('uRole').innerText = curUser.role;
        navigateTo(window.location.hash.replace('#', '') || 'zabbix').catch(e => console.error('[nav]', e));
    } else { document.getElementById('loginScreen').classList.remove('d-none'); document.getElementById('mainApp').classList.add('d-none'); }
}

async function loadZabbix() {
    const res = await fetch('/api/monitoring/zabbix'); const d = await res.json();
    if (d.metrics) {
        if(document.getElementById('zbLU')) document.getElementById('zbLU').innerText = d.metrics.linux_uptime; if(document.getElementById('zbLM')) document.getElementById('zbLM').innerText = d.metrics.linux_mem + ' %'; if(document.getElementById('zbLC')) document.getElementById('zbLC').innerText = d.metrics.linux_cpu + ' %'; if(document.getElementById('zbLD')) document.getElementById('zbLD').innerText = d.metrics.linux_disk + ' %';
        if(document.getElementById('zbRU')) document.getElementById('zbRU').innerText = d.metrics.royal_uptime; if(document.getElementById('zbRM')) document.getElementById('zbRM').innerText = d.metrics.royal_mem + ' %'; if(document.getElementById('zbRC')) document.getElementById('zbRC').innerText = d.metrics.royal_cpu + ' %'; if(document.getElementById('zbRD')) document.getElementById('zbRD').innerText = d.metrics.royal_disk + ' %';
    }
    if(document.getElementById('zbProbList')) document.getElementById('zbProbList').innerHTML = (Array.isArray(d.problems) ? d.problems : []).map(p => `<tr><td><small>${esc(p.time)}</small></td><td><small>${esc(p.recovery_time)}</small></td><td><span class="badge bg-${p.status === 'RESOLVED' ? 'success' : 'danger'}">${esc(p.status)}</span></td><td><b>${esc(p.host)}</b></td><td><span class="badge bg-${p.severity === 'Disaster' ? 'danger' : 'warning text-dark'} me-1">${esc(p.severity)}</span> ${esc(p.name)}</td><td><small>${esc(p.duration)}</small></td><td>${p.event_id && p.status === 'PROBLEM' && (curUser?.role === 'Super-Admin' || curUser?.perms?.helpdesk === 'manage') ? `<button class="btn btn-sm btn-outline-primary" data-create-incident="1" data-source="Zabbix" data-external-id="${esc(p.event_id)}" data-asset-name="${esc(p.host)}" data-priority="${p.severity === 'Disaster' ? 'Urgent' : p.severity === 'High' ? 'High' : 'Normal'}" data-title="${esc(`${p.host}: ${p.name}`)}" data-description="${esc(`Zabbix event ${p.event_id} | ${p.severity} | ${p.status} | ${p.time} | Duration: ${p.duration}`)}">Tạo incident</button>` : '—'}</td></tr>`).join('');
    if(document.getElementById('zbActList')) document.getElementById('zbActList').innerHTML = (Array.isArray(d.actionsLog) ? d.actionsLog : []).map(a => `<tr><td><small>${esc(a.time)}</small></td><td><b>${esc(a.action)}</b></td><td><span class="badge bg-secondary">${esc(a.media)}</span></td><td><code>${esc(a.recipient)}</code></td><td><small>${esc(a.message)}</small></td><td><span class="badge bg-${a.status === 'Sent' ? 'success' : 'danger'}">${esc(a.status)}</span></td></tr>`).join('');
}

async function loadWazuh() {
    const res = await fetch('/api/security/wazuh'); const d = await res.json();
    if(document.getElementById('wzCatRow')) {
        document.getElementById('wzCatRow').innerHTML = `
            <div class="col-md-3"><div class="p-2"><h6 class="fw-bold mb-1" style="color: #212529;">Critical severity</h6><h2 style="color:#d32f2f;" class="fw-bold">${esc(d.stats?.crit ?? 0)}</h2><small class="text-secondary">Rule level 15 or higher</small></div></div>
            <div class="col-md-3 border-start"><div class="p-2"><h6 class="fw-bold mb-1" style="color: #212529;">High severity</h6><h2 style="color:#fbc02d;" class="fw-bold">${esc(d.stats?.high ?? 0)}</h2><small class="text-secondary">Rule level 12 to 14</small></div></div>
            <div class="col-md-3 border-start"><div class="p-2"><h6 class="fw-bold mb-1" style="color: #212529;">Medium severity</h6><h2 style="color:#1976d2;" class="fw-bold">${esc(d.stats?.med ?? 0)}</h2><small class="text-secondary">Rule level 7 to 11</small></div></div>
            <div class="col-md-3 border-start"><div class="p-2"><h6 class="fw-bold mb-1" style="color: #212529;">Low severity</h6><h2 style="color:#00796b;" class="fw-bold">${esc(d.stats?.low ?? 0)}</h2><small class="text-secondary">Rule level 0 to 6</small></div></div>
        `;
    }
    if(document.getElementById('wzWinAlertList')) document.getElementById('wzWinAlertList').innerHTML = (Array.isArray(d.win) ? d.win : []).map(a => `<tr><td><small class="text-secondary">${esc(new Date(a.ts).toLocaleString('vi-VN'))}</small></td><td>${esc(a.desc)}</td><td><span class="text-primary fw-bold">#${esc(a.rid)}</span></td></tr>`).join('');
    if(document.getElementById('wzLinAlertList')) document.getElementById('wzLinAlertList').innerHTML = (Array.isArray(d.lin) ? d.lin : []).map(a => `<tr><td><small class="text-secondary">${esc(new Date(a.ts).toLocaleString('vi-VN'))}</small></td><td>${esc(a.desc)}</td><td><span class="text-primary fw-bold">#${esc(a.rid)}</span></td></tr>`).join('');
}
async function loadPfSense() {
    const res = await fetch('/api/network/pfsense'); const d = await res.json();
    if(document.getElementById('pfWanIn')) document.getElementById('pfWanIn').innerText = d.interfaces.wan.in_speed + ' Mbps'; if(document.getElementById('pfWanOut')) document.getElementById('pfWanOut').innerText = d.interfaces.wan.out_speed + ' Mbps';
    if(document.getElementById('pfLeaseList')) document.getElementById('pfLeaseList').innerHTML = (Array.isArray(d.dhcpLeases) ? d.dhcpLeases : []).map(l => `<tr><td class="fw-bold text-primary">${esc(l.ip)}</td><td><code>${esc(l.mac)}</code></td><td>${esc(l.hostname)}</td><td><span class="badge bg-secondary">${esc(l.status)}</span></td></tr>`).join('');
}

// ==========================================
// CÁC HÀM XỬ LÝ ACTIVE DIRECTORY FULL uUYỀN
// ==========================================
async function loadAD() {
    const compBtn = document.getElementById('adComputersButton'); if (compBtn) compBtn.classList.toggle('d-none', !(curUser?.role === 'Super-Admin' || (curUser?.perms?.computers && curUser.perms.computers !== 'none')));
    const res = await fetch('/api/ad/users'); currentADUsers = await res.json(); 
    const deptFilter = document.getElementById('adDepartmentFilter')?.value || ''; const search = (document.getElementById('adUserSearch')?.value || '').toLowerCase();
    const visibleUsers = currentADUsers.filter(u => (!deptFilter || u.Department === deptFilter) && (!search || `${u.Username} ${u.FullName}`.toLowerCase().includes(search)));
    if(document.getElementById('adUserList')) document.getElementById('adUserList').innerHTML = visibleUsers.map(u => {
        let actionBtns = '';
        if(curUser.role === 'Super-Admin') {
            actionBtns = `<button onclick="openEditModal('${u.Username}')" class="btn btn-sm btn-outline-info me-1" title="Sửa thông tin"><i class="fa-solid fa-pen"></i></button>
                          <button onclick="toggleAD('${u.Username}')" class="btn btn-sm btn-outline-${u.Enabled ? 'danger' : 'success'} me-1" title="${u.Enabled ? 'Khóa' : 'Kích hoạt'}"><i class="fa-solid fa-${u.Enabled ? 'lock' : 'unlock'}"></i></button>
                          <button onclick="resetPass('${u.Username}')" class="btn btn-sm btn-outline-warning me-1" title="Đổi mật khẩu"><i class="fa-solid fa-key"></i></button>
                          <button onclick="deleteAD('${u.Username}')" class="btn btn-sm btn-outline-danger" title="Xóa tài khoản"><i class="fa-solid fa-trash"></i></button>`;
        } else if(curUser.role === 'IT-Staff') {
            actionBtns = `<button onclick="resetPass('${u.Username}')" class="btn btn-sm btn-outline-warning">Reset Pass</button>`;
        }
        return `<tr><td class="fw-bold text-warning"><button class="btn btn-link btn-sm p-0 fw-bold text-warning text-decoration-none" onclick="openADComputersForOwner('${esc(u.Username)}')" title="Xem máy tính được gán">${esc(u.Username)}</button></td><td>${esc(u.FullName)}</td><td><span class="badge bg-secondary text-white">${esc(u.Department)}</span></td><td><code>${esc(u.PrimaryGroup)}</code></td><td><span class="badge bg-${u.Enabled ? 'success' : 'danger'}">${u.Enabled ? 'Active' : 'Locked'}</span></td><td>${actionBtns}</td></tr>`;
    }).join('');

    const oRes = await fetch('/api/ad/departments'); if(oRes.ok) {
        const ous = await oRes.json(); const opts = ous.map(o => `<option value="${esc(o.Name)}">${esc(o.Name)}</option>`).join('');
        const df = document.getElementById('adDepartmentFilter'); if (df) { const prior=df.value; df.innerHTML='<option value="">Tất cả phòng ban</option>'+opts; if ([...df.options].some(o=>o.value===prior)) df.value=prior; }
        if(document.getElementById('mDept')) document.getElementById('mDept').innerHTML = opts;
        if(document.getElementById('eDept')) document.getElementById('eDept').innerHTML = opts;
    }
}

document.getElementById('adAddForm').onsubmit = async(e) => { e.preventDefault(); const res = await fetch('/api/ad/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('mUser').value, fullname: document.getElementById('mFull').value, password: document.getElementById('mPass').value, department: document.getElementById('mDept').value, group: document.getElementById('mGroup').value }) }); const d = await res.json(); if (d.success) { alert('Tạo User thành công!'); bootstrap.Modal.getInstance(document.getElementById('addUserModal')).hide(); document.getElementById('adAddForm').reset(); loadAD(); } else alert(d.error); };
document.getElementById('adAddOUForm').onsubmit = async(e) => { e.preventDefault(); const res = await fetch('/api/ad/departments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('mOUName').value }) }); const d = await res.json(); if (d.success) { alert('Tạo OU thành công!'); bootstrap.Modal.getInstance(document.getElementById('addOUModal')).hide(); document.getElementById('adAddOUForm').reset(); loadAD(); } else alert(d.error); };

function openEditModal(username) {
    const u = currentADUsers.find(x => x.Username === username); if (!u) return;
    document.getElementById('eUsernameTitle').innerText = u.Username; document.getElementById('eUser').value = u.Username; document.getElementById('eFull').value = u.FullName; document.getElementById('eDept').value = u.Department; document.getElementById('eGroup').value = u.PrimaryGroup;
    new bootstrap.Modal(document.getElementById('editUserModal')).show();
}
document.getElementById('adEditForm').onsubmit = async(e) => { e.preventDefault(); const username = document.getElementById('eUser').value; const res = await fetch(`/api/ad/users/${username}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullname: document.getElementById('eFull').value, department: document.getElementById('eDept').value, group: document.getElementById('eGroup').value }) }); const d = await res.json(); if (d.success) { alert('Cập nhật thành công!'); bootstrap.Modal.getInstance(document.getElementById('editUserModal')).hide(); loadAD(); } else alert('Có lỗi xảy ra!'); };
async function toggleAD(u) { await fetch(`/api/ad/users/${u}/toggle`, { method: 'POST' }); loadAD(); }
async function deleteAD(u) { if (confirm(`XÓA VĨNH VIỄN tài khoản [${u}] khỏi hệ thống?`)) { const res = await fetch(`/api/ad/users/${u}`, { method: 'DELETE' }); const d = await res.json(); if (d.success) loadAD(); else alert('Lỗi: ' + d.error); } }

async function loadAdminTools() {
    const res = await fetch('/api/admin/gpo'); const data = await res.json(); 
    if(document.getElementById('gpoList')) document.getElementById('gpoList').innerHTML = (Array.isArray(data) ? data : []).map(g => `<tr><td class="fw-bold text-warning">${esc(g.DisplayName)}</td><td><code>${esc(g.Id)}</code></td><td><span class="badge bg-success">${esc(g.GpoStatus)}</span></td></tr>`).join('');
    if(document.getElementById('gpoForm')) { document.getElementById('gpoForm').onsubmit = async(e) => { e.preventDefault(); await fetch('/api/admin/gpo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('gpoName').value, rule: document.getElementById('gpoRule').value }) }); alert('Tạo GPO thành công!'); document.getElementById('gpoForm').reset(); loadAdminTools(); }; }
    if(document.getElementById('smbForm')) { document.getElementById('smbForm').onsubmit = async(e) => { e.preventDefault(); await fetch('/api/admin/smb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('smbName').value, path: document.getElementById('smbDrive').value + ':\\\\' + document.getElementById('smbFolder').value }) }); alert('Tạo File Share thành công!'); document.getElementById('smbForm').reset(); }; }
}

async function loadTickets() {
    const res = await fetch('/api/tickets'); const data = await res.json();
    if(document.getElementById('ticketList')) document.getElementById('ticketList').innerHTML = (Array.isArray(data) ? data : []).map(t => `<tr><td>#${esc(t.id)}</td><td>${esc(t.requester)}</td><td><span class="badge bg-secondary text-white">${esc(t.type)}</span></td><td>${esc(t.title)}</td><td><small>${esc(t.local_created)}</small></td><td><span class="badge bg-${t.status === 'Open' ? 'danger' : 'success'}">${esc(t.status)}</span></td><td>${(curUser.role !== 'Employee' && t.status === 'Open') ? `<button onclick="resolveTk(${Number(t.id) || 0})" class="btn btn-sm btn-success">Đóng Phiếu</button>` : 'OK'}</td></tr>`).join('');
    if(document.getElementById('tkForm')) { document.getElementById('tkForm').onsubmit = async(e) => { e.preventDefault(); await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: document.getElementById('tkType').value, title: document.getElementById('tkTitle').value }) }); document.getElementById('tkForm').reset(); loadTickets(); }; }
}
async function resolveTk(id) { await fetch(`/api/tickets/${id}/resolve`, { method: 'POST' }); loadTickets(); }

function logout() { fetch('/api/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => location.reload()); }
window.onhashchange = () => { if (curUser) navigateTo(window.location.hash.replace('#', '') || 'zabbix').catch(e => console.error('[nav]', e)); };
checkAuth();




// Computer Management for permitted workstation OUs. State is initialized at file start.
async function loadADComputers() {
 const panel=document.getElementById('adComputersPanel'); if(!panel)return;
 panel.classList.remove('d-none');
 panel.innerHTML='<div class="text-secondary small py-3"><span class="spinner-border spinner-border-sm me-2"></span>Đang tải Computer Inventory từ Active Directory...</div>';
 try {
  const or=await fetch('/api/ad/computer-ous'); const od=await or.json();
  if(!or.ok || od?.success===false) throw new Error(od.error||'Không lấy được danh sách OU');
  adComputerOUs=Array.isArray(od)?od:(od?[od]:[]);
  adComputerMacByIp={}; adComputerLeaseByName={}; try { const nr=await fetch('/api/network/computer-leases',{signal:AbortSignal.timeout(8000)}); if(nr.ok){const nd=await nr.json(); (nd.leases||[]).forEach(l=>{if(l.ip&&l.mac)adComputerMacByIp[String(l.ip)]=l; if(l.hostname){const key=adComputerHostKey(l.hostname), old=adComputerLeaseByName[key]; if(!old||(!old.arpSeen&&l.arpSeen)||(!!old.arpSeen===!!l.arpSeen&&Number(l.expiresAt||l.startedAt||0)>Number(old.expiresAt||old.startedAt||0)))adComputerLeaseByName[key]=l;}});} } catch(_) {}
  const allowedNames=['Client_Computers','IT','Sales','HR','Quarantine'];
  panel.innerHTML=`
   <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
    <div><strong><i class="fa-solid fa-computer me-2"></i>Computer Management</strong><div class="small text-secondary">Danh mục computer objects trong OU đã chọn</div><div id="adComputerDiagnostics" class="small text-secondary mt-1">Đang kiểm tra kết nối tới Active Directory...</div></div>
    <div class="d-flex gap-2"><button class="btn btn-sm btn-outline-info px-2 py-1 text-nowrap flex-shrink-0" title="Làm mới trạng thái và danh sách computer AD" onclick="loadADComputerDiagnostics9();refreshADComputers()"><i class="fa-solid fa-rotate me-1"></i>Làm mới</button></div>
   </div>
   <div class="row g-2 mb-2">
    <div class="col-lg-5"><label class="form-label small">OU hiển thị</label><select id="adCompOuFilter" class="form-select form-select-sm"></select></div>
    <div class="col-lg-5"><label class="form-label small">Tìm máy / owner / IP</label><input id="adCompSearch" class="form-control form-control-sm" placeholder="Ví dụ: LAP-ROYAL_11, hr01, IP..."></div>
    <div class="col-lg-2 d-flex align-items-end"><button class="btn btn-sm btn-primary w-100" onclick="adComputerPage=0;refreshADComputers()">Tải danh sách</button></div>
   </div>
   <div class="alert alert-info py-2 small mb-2"><i class="fa-solid fa-circle-info me-1"></i>Online/Offline dựa trên ICMP ping từ server Portal; máy chặn ping có thể hiện không phản hồi dù vẫn hoạt động. Restart/trust cần WinRM; làm mới Group Policy cần quyền RPC/WMI và firewall Remote Scheduled Tasks trên máy đích.</div>
   <div class="d-flex justify-content-between align-items-center gap-2 mb-2"><div id="adComputerMessage" class="small text-secondary"></div><div class="btn-group btn-group-sm"><button id="adCompPrev" class="btn btn-outline-secondary" onclick="adComputerPage=Math.max(0,adComputerPage-1);refreshADComputers()">‹ Trước</button><button id="adCompNext" class="btn btn-outline-secondary" onclick="adComputerPage++;refreshADComputers()">Sau ›</button></div></div>
   <div class="table-responsive border rounded" style="max-height:52vh;overflow:auto"><table class="table table-hover table-sm align-middle mb-0"><thead class="table-light" style="position:sticky;top:0;z-index:2"><tr><th>Computer</th><th>OU</th><th>OS</th><th>IPv4</th><th>MAC (pfSense)</th><th>Online</th><th>AD Account</th><th>Last Logon (gần đúng)</th><th>Owner</th><th style="min-width:230px">Thao tác</th></tr></thead><tbody id="adComputerRows"><tr><td colspan="10" class="text-secondary">Đang tải...</td></tr></tbody></table></div>
   <div class="small text-secondary mt-2">MAC chỉ được hiển thị nếu có DHCP lease tương ứng từ pfSense; AD không tự lưu MAC. Restart/trust cần DNS, WinRM và quyền của tài khoản Portal; làm mới Group Policy cần RPC/WMI, firewall Remote Scheduled Tasks và quyền tương ứng. Xem mật khẩu LAPS cần quyền computers và laps riêng; chỉ cấp cho người được ủy quyền.</div>
   <div class="modal fade" id="adComputerMoveModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Chuyển Computer sang OU</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="small text-secondary mb-2" id="adMoveComputerLabel"></div><label class="form-label">OU đích được phép</label><select class="form-select" id="adMoveTargetOU"></select><div class="small text-warning mt-2">Việc chuyển OU có thể làm thay đổi GPO đang áp dụng cho máy.</div></div><div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Hủy</button><button class="btn btn-primary" onclick="submitADComputerMove()">Xác nhận chuyển</button></div></div></div></div>
   <div class="modal fade" id="adComputerLapsModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Mật khẩu Windows LAPS</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="small text-secondary mb-2" id="adLapsTarget"></div><div class="alert alert-warning small">Thông tin nhạy cảm. Chỉ dùng cho tác vụ hỗ trợ được ủy quyền; nội dung sẽ bị xóa khi đóng cửa sổ.</div><label class="form-label">Tài khoản local</label><div id="adLapsAccount" class="mb-2"></div><label class="form-label">Mật khẩu</label><div class="input-group"><input id="adLapsPassword" class="form-control font-monospace" type="password" readonly autocomplete="off"><button class="btn btn-outline-secondary" id="adLapsRevealBtn" onclick="toggleADLapsReveal()">Hiện</button><button class="btn btn-outline-primary" onclick="copyADLapsPassword()">Sao chép</button></div><div id="adLapsUpdated" class="small text-secondary mt-2"></div></div><div class="modal-footer"><button class="btn btn-secondary" data-bs-dismiss="modal">Đóng và xóa mật khẩu</button></div></div></div></div>`;
  const ouSel=document.getElementById('adCompOuFilter');
  ouSel.innerHTML='<option value="__ALL__">Tất cả computers trong Domain</option>'+adComputerOUs.map(o=>`<option value="${esc(o.DistinguishedName)}">${esc(o.Name)} — ${esc(o.DistinguishedName)}</option>`).join('');
  const defaultOU=adComputerOUs.find(o=>o.Name==='Client_Computers'); /* Domain-wide first: don't hide devices residing outside Client_Computers/CN=Computers. */ ouSel.value='__ALL__';
  const moveSel=document.getElementById('adMoveTargetOU');
  moveSel.innerHTML=adComputerOUs.filter(o=>o.AllowedTarget===true).map(o=>`<option value="${esc(o.DistinguishedName)}">${esc(o.Name)} — ${esc(o.DistinguishedName)}</option>`).join('');
  document.getElementById('adCompSearch').addEventListener('input',()=>{if(adComputerOwnerFilter){adComputerOwnerFilter='';adComputerPage=0;refreshADComputers();}else renderADComputers();});
  document.getElementById('adCompOuFilter').addEventListener('change',()=>{adComputerPage=0;refreshADComputers();});
  document.getElementById('adComputerLapsModal').addEventListener('hidden.bs.modal',()=>{const pw=document.getElementById('adLapsPassword');if(pw)pw.value=''; const a=document.getElementById('adLapsAccount');if(a)a.textContent=''; const t=document.getElementById('adLapsTarget');if(t)t.textContent='';});
  await loadADComputerDiagnostics9();
  await refreshADComputers();
 } catch(e) { panel.innerHTML='<div class="text-danger small py-2">'+esc(e.message)+'</div>'; }
}
async function loadADComputerDiagnostics9(){
 const el=document.getElementById('adComputerDiagnostics');if(!el)return;
 try{const r=await fetch('/api/ad/computer-diagnostics');const d=await r.json().catch(()=>({}));if(!r.ok||d.success===false)throw new Error(d.error||'Không kiểm tra được AD');
  if(!d.clientComputersOUFound){el.className='small text-danger mt-1';el.textContent=`Domain ${d.domain||'?'} · Không tìm thấy OU Client_Computers. Kiểm tra tên OU và domain đang được Portal truy vấn.`;return;}
  el.className='small '+(Number(d.computerCount)>0?'text-success':'text-warning')+' mt-1';
  el.textContent=`Domain: ${d.domain} · OU: ${d.clientComputersOUDN} · Computer objects: ${d.computerCount}${Number(d.computerCount)===0?' · OU tồn tại nhưng chưa có computer object; chọn “Tất cả computers trong Domain” để tìm máy đang ở OU/container khác.':''}`;
 }catch(e){el.className='small text-danger mt-1';el.textContent='AD diagnostics: '+e.message+' · Kiểm tra quyền truy vấn AD và log Portal.';}
}
async function refreshADComputers(){
 const ou=document.getElementById('adCompOuFilter')?.value || 'Client_Computers';
 const msg=document.getElementById('adComputerMessage'), tbody=document.getElementById('adComputerRows'); if(!tbody)return;
 tbody.innerHTML='<tr><td colspan="10" class="text-secondary">Đang truy vấn Active Directory và kiểm tra ping...</td></tr>';
 try{const r=await fetch('/api/ad/computers?ou='+encodeURIComponent(ou)+'&limit=25&offset='+(adComputerPage*25)+(adComputerOwnerFilter?'&owner='+encodeURIComponent(adComputerOwnerFilter):''));const d=await r.json();if(!r.ok||d?.success===false)throw new Error(d.error||'Không tải được computers');adComputerInventory=Array.isArray(d.items)?d.items:(d.items?[d.items]:[]);adComputerTotal=Number(d.total||0);renderADComputers();if(msg)msg.textContent=`${adComputerOwnerFilter?'Máy tính được gán cho '+adComputerOwnerFilter+' · ':''}Đang xem ${adComputerInventory.length?adComputerPage*25+1:0}–${adComputerPage*25+adComputerInventory.length} / ${adComputerTotal} computers.`;const prev=document.getElementById('adCompPrev'),next=document.getElementById('adCompNext');if(prev)prev.disabled=adComputerPage<=0;if(next)next.disabled=(adComputerPage+1)*25>=adComputerTotal;}catch(e){tbody.innerHTML=`<tr><td colspan="10" class="text-danger">${esc(e.message)}</td></tr>`;if(msg)msg.textContent='';}
}
function renderADComputers(){
 const tbody=document.getElementById('adComputerRows');if(!tbody)return;
 const q=(document.getElementById('adCompSearch')?.value||'').toLowerCase().trim();
 const list=adComputerInventory.filter(c=>`${c.Name||''} ${c.OU||''} ${c.OperatingSystem||''} ${adComputerLeaseByName[adComputerHostKey(c.Name)]?.ip||c.IPv4Address||''} ${c.OwnerName||''} ${c.OwnerUsername||''}`.toLowerCase().includes(q));
 const canManage=curUser?.role==='Super-Admin'||curUser?.perms?.computers==='manage';const isSuper=curUser?.role==='Super-Admin';
 if(!list.length){tbody.innerHTML='<tr><td colspan="10" class="text-secondary">Không có computer object phù hợp trong OU này.</td></tr>';return;}
 tbody.innerHTML=list.map(c=>{
  const n=String(c.Name||''),hostKey=adComputerHostKey(n),dnsIp=String(c.IPv4Address||''),ipLease=adComputerMacByIp[dnsIp],hostLease=adComputerLeaseByName[hostKey];const lease=hostLease||(ipLease&&(!ipLease.hostname||adComputerHostKey(ipLease.hostname)===hostKey)?ipLease:null);const dnsLeaseConflict=!!(ipLease?.hostname&&adComputerHostKey(ipLease.hostname)!==hostKey),unresolvedDnsConflict=dnsLeaseConflict&&!hostLease;const liveIp=hostLease?.ip||(dnsLeaseConflict?'':dnsIp);const online=unresolvedDnsConflict?'<span class="badge text-bg-warning">DNS lệch DHCP</span>':lease||c.Online===true?'<span class="badge text-bg-success">Online</span>':c.Online===false?'<span class="badge text-bg-danger">Không phản hồi</span>':'<span class="badge text-bg-secondary">Chưa rõ</span>';
  const owner=c.OwnerName?`<button class="btn btn-link btn-sm p-0 text-decoration-none" onclick="openADUserFromComputer('${esc(c.OwnerUsername||'')}')">${esc(c.OwnerName)}</button> <small class="text-secondary">(${esc(c.OwnerUsername||'')})</small>`:'<span class="text-secondary">Chưa gán</span>';
  const canReadLaps=isSuper||['view','manage'].includes(curUser?.perms?.laps);
  const actionButtons=[];
  if(canManage){
   actionButtons.push(`<button class="btn btn-sm btn-outline-primary" onclick="adMoveComputer('${esc(n)}')" title="Move OU"><i class="fa-solid fa-folder-tree"></i></button>`);
   actionButtons.push(`<button class="btn btn-sm btn-outline-info" onclick="adSetComputerOwner('${esc(n)}')" title="Gán owner"><i class="fa-solid fa-user-tag"></i></button>`);
   actionButtons.push(`<button class="btn btn-sm btn-outline-secondary" onclick="adComputerAction('gpupdate','${esc(n)}')" title="Làm mới Group Policy từ xa"><i class="fa-solid fa-rotate"></i></button>`);
   actionButtons.push(`<button class="btn btn-sm btn-outline-warning" onclick="adComputerAction('toggle','${esc(n)}')" title="${c.Enabled?'Disable':'Enable'} AD object"><i class="fa-solid fa-${c.Enabled?'ban':'check'}"></i></button>`);
  }
  if(canReadLaps) actionButtons.push(`<button class="btn btn-sm btn-outline-dark" onclick="adComputerAction('laps','${esc(n)}')" title="Đọc LAPS"><i class="fa-solid fa-key"></i></button>`);
  if(isSuper){
   actionButtons.push(`<button class="btn btn-sm btn-outline-warning" onclick="adComputerAction('repair-trust','${esc(n)}')" title="Repair trust"><i class="fa-solid fa-link"></i></button>`);
   actionButtons.push(`<button class="btn btn-sm btn-outline-danger" onclick="adComputerAction('restart','${esc(n)}')" title="Restart"><i class="fa-solid fa-power-off"></i></button>`);
   actionButtons.push(`<button class="btn btn-sm btn-outline-danger" onclick="adComputerAction('shutdown','${esc(n)}')" title="Shutdown"><i class="fa-solid fa-plug-circle-xmark"></i></button>`);
   actionButtons.push(`<button class="btn btn-sm btn-outline-danger" onclick="adComputerAction('delete','${esc(n)}')" title="Delete object"><i class="fa-solid fa-trash"></i></button>`);
  }
  const actions=actionButtons.length?`<div class="d-flex flex-wrap gap-1">${actionButtons.join('')}</div>`:'—';
  const ipCell=hostLease?`${esc(hostLease.ip)}${dnsLeaseConflict?`<div class="small text-warning">DNS cũ: ${esc(dnsIp)} (${esc(ipLease.hostname)})</div>`:''}`:dnsLeaseConflict?`<span class="text-warning">${esc(dnsIp||'—')}</span><div class="small text-warning">DNS trỏ sang ${esc(ipLease.hostname)}</div>`:esc(liveIp||'—');
  return `<tr><td><strong>${esc(n)}</strong><div class="small text-secondary">${esc(c.DNSHostName||'')}</div></td><td>${esc(c.OU||'—')}</td><td>${esc(c.OperatingSystem||'—')}<div class="small text-secondary">${esc(c.OperatingSystemVersion||'')}</div></td><td>${ipCell}</td><td><code>${esc(lease?.mac||'—')}</code></td><td>${online}</td><td><span class="badge ${c.Enabled?'text-bg-success':'text-bg-danger'}">${c.Enabled?'Enabled':'Disabled'}</span></td><td>${c.LastLogonDate?esc(new Date(c.LastLogonDate).toLocaleString('vi-VN')):'—'}</td><td>${owner}</td><td>${actions}</td></tr>`;
 }).join('');
}
function adMoveComputer(name){adMoveComputerName=name;const label=document.getElementById('adMoveComputerLabel');if(label)label.textContent=`Computer: ${name}`;const sel=document.getElementById('adMoveTargetOU');if(sel){const current=adComputerInventory.find(c=>c.Name===name);if(current){const target=adComputerOUs.find(o=>o.Name===current.OU);if(target)sel.value=target.DistinguishedName;}}adMoveModalInstance=bootstrap.Modal.getOrCreateInstance(document.getElementById('adComputerMoveModal'));adMoveModalInstance.show();}
async function submitADComputerMove(){if(!adMoveComputerName)return;const targetDN=document.getElementById('adMoveTargetOU')?.value;if(!targetDN)return toast('Không có OU đích được phép','warning');if(!confirm(`Chuyển ${adMoveComputerName} sang OU đã chọn? Chính sách GPO có thể thay đổi.`))return;await adComputerPost(adMoveComputerName,'move',{targetDN},'Đã chuyển computer sang OU mới');adMoveModalInstance?.hide();}
async function adSetComputerOwner(name){const cur=adComputerInventory.find(c=>c.Name===name);const username=prompt(`Nhập sAMAccountName chủ sở hữu cho ${name}. Để trống để xóa gán owner.`,cur?.OwnerUsername||'');if(username===null)return;await adComputerPost(name,'owner',{username:username.trim()},username.trim()?'Đã cập nhật owner':'Đã xóa gán owner');}
async function adComputerPost(name,action,body={},successText='Thao tác thành công'){try{const r=await fetch(`/api/ad/computers/${encodeURIComponent(name)}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.success===false)throw new Error(d.error||'Thao tác thất bại');toast(d.message||successText,'success');if(d.output)alert(`${d.message||successText}\n\n${d.output}`);await refreshADComputers();return d;}catch(e){toast(e.message,'danger');return null;}}
async function adComputerAction(action,name){
 const c=adComputerInventory.find(x=>x.Name===name);if(!c)return;
 if(action==='gpupdate'){if(!confirm(`Lên lịch làm mới Group Policy trên ${name}?`))return;return adComputerPost(name,'gpupdate',{},'Đã lên lịch làm mới Group Policy');}
 if(action==='toggle'){const enabled=!c.Enabled;if(!confirm(`${enabled?'Kích hoạt':'Disable'} computer account ${name} trong AD? Máy có thể vẫn đang chạy; hành động này chỉ đổi AD object.`))return;return adComputerPost(name,'toggle',{enabled},enabled?'Đã kích hoạt computer object':'Đã disable computer object');}
 if(action==='repair-trust'){if(!confirm(`Thử sửa secure channel/domain trust của ${name} qua WinRM? Máy phải online và WinRM hoạt động.`))return;return adComputerPost(name,'repair-trust',{},'Đã chạy kiểm tra trust');}
 if(action==='restart'||action==='shutdown'){const verb=action==='restart'?'khởi động lại':'tắt';const typed=prompt(`Thao tác này sẽ ${verb} máy ${name}. Nhập đúng tên máy để xác nhận:`);if(typed!==name)return toast('Tên xác nhận không khớp; đã hủy thao tác.','warning');return adComputerPost(name,action,{confirmName:typed},`Đã gửi lệnh ${verb}`);}
 if(action==='delete'){const typed=prompt(`XÓA COMPUTER OBJECT ${name} KHỎI AD? Đây không tự gỡ máy khỏi domain. Nhập đúng tên máy:`);if(typed!==name)return toast('Tên xác nhận không khớp; đã hủy xóa.','warning');try{const r=await fetch(`/api/ad/computers/${encodeURIComponent(name)}`,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmName:typed})});const d=await r.json();if(!r.ok||d.success===false)throw new Error(d.error||'Xóa thất bại');toast('Đã xóa computer object khỏi AD','success');await refreshADComputers();}catch(e){toast(e.message,'danger');}return;}
 if(action==='laps'){try{const r=await fetch(`/api/ad/computers/${encodeURIComponent(name)}/laps-password`,{cache:'no-store'});const d=await r.json();if(!r.ok||d.success===false)throw new Error(d.error||'Không đọc được LAPS');document.getElementById('adLapsTarget').textContent=`Computer: ${d.computer}`;document.getElementById('adLapsAccount').textContent=d.account||'Administrator';document.getElementById('adLapsPassword').value=d.password||'';document.getElementById('adLapsUpdated').textContent=d.updated?`Cập nhật: ${new Date(d.updated).toLocaleString('vi-VN')}: ${d.warning||''}`:(d.warning||'');bootstrap.Modal.getOrCreateInstance(document.getElementById('adComputerLapsModal')).show();}catch(e){toast(e.message,'danger');}return;}
}
function toggleADLapsReveal(){const i=document.getElementById('adLapsPassword');const b=document.getElementById('adLapsRevealBtn');if(!i)return;i.type=i.type==='password'?'text':'password';if(b)b.textContent=i.type==='password'?'Hiện':'Ẩn';}
async function copyADLapsPassword(){const i=document.getElementById('adLapsPassword');if(!i?.value)return;try{await navigator.clipboard.writeText(i.value);toast('Đã sao chép mật khẩu LAPS','success');}catch(e){toast('Trình duyệt không cho phép clipboard; hãy dùng HTTPS hoặc sao chép thủ công.','warning');}}


window.loadADComputerDiagnostics9 = loadADComputerDiagnostics9;
function openADComputerInventory(){adComputerOwnerFilter='';adComputerPage=0;loadADComputers();}
async function openADComputersForOwner(username){adComputerOwnerFilter=username;adComputerPage=0;await loadADComputers();}
function openADUserFromComputer(username){
 const panel=document.getElementById('adComputersPanel');if(panel)panel.classList.add('d-none');
 const search=document.getElementById('adUserSearch');const dept=document.getElementById('adDepartmentFilter');if(search)search.value=username;if(dept)dept.value='';loadAD();
}
