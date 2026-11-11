// ui6.js - nạp SAU ui5.js. Hồ sơ của tôi (chỉ xem), Thư mục của tôi, Phiếu hỗ trợ đầy đủ
titles.profile = 'Hồ Sơ Của Tôi'; titles.myfolders = 'Thư Mục Của Tôi'; PAGES.push('profile', 'myfolders');
$('nav-overview').insertAdjacentHTML('beforebegin', '<a class="nav-link" id="nav-profile" onclick="navigateTo(\'profile\')"><i class="fa-solid fa-id-card me-2"></i> Hồ Sơ Của Tôi</a><a class="nav-link" id="nav-myfolders" onclick="navigateTo(\'myfolders\')"><i class="fa-solid fa-folder-open me-2"></i> Thư Mục Của Tôi</a>');
['Employee', 'IT-Staff'].forEach(r => { const g = Object.getOwnPropertyDescriptor(allow, r).get;
    Object.defineProperty(allow, r, { configurable: true, enumerable: true, get: () => { const l = g(), x = ['profile', 'myfolders'].filter(p => !l.includes(p)); return r === 'Employee' ? [...x, ...l] : [...l, ...x]; } }); });
const _r6 = refreshCurrentView;
refreshCurrentView = () => { if (curUser && currentSection === 'profile') return loadProfile(); if (curUser && currentSection === 'myfolders') return loadMine(); _r6(); };
document.addEventListener('click', e => {
    const c = e.target.closest('[data-cp]'); if (c) return copyText(c.dataset.cp);
    const k = e.target.closest('[data-disk]'); if (k) return loadDisk(k.dataset.disk);
    const g = e.target.closest('[data-tkgo]'); if (g) { window.__tkType = g.dataset.tkgo; navigateTo('helpdesk'); }
});
const dt = s => s ? new Date(s).toLocaleString('vi-VN') : '—', cpBtn = u => u ? `<button class="btn btn-sm btn-outline-secondary ms-1" data-cp="${esc(u)}" title="Sao chép đường dẫn"><i class="fa-regular fa-copy"></i></button>` : '';

// ===== Hồ sơ của tôi (chỉ xem) =====
async function loadProfile() {
    if (!$('profBox')) return;
    const p = await J('/api/deleg/profile');
    if (!p || !p.Name) { $('profBox').innerHTML = '<div class="col-12 text-secondary">Không đọc được hồ sơ từ Active Directory.</div>'; return; }
    const days = p.PwExpires ? Math.ceil((new Date(p.PwExpires) - Date.now()) / 86400000) : null, ROLE = { 'Super-Admin': 'Quản trị viên', 'IT-Staff': 'IT hỗ trợ', 'Employee': 'Nhân viên' };
    const row = (k, v) => `<tr><td class="text-secondary" style="width:38%">${k}</td><td class="fw-semibold">${v ? esc(v) : '—'}</td></tr>`;
    $('profBox').innerHTML = `
    <div class="col-lg-6"><div class="card p-4 h-100"><h6 class="fw-bold text-info mb-3"><i class="fa-solid fa-id-card"></i> Thông tin tài khoản</h6><table class="table table-sm mb-0"><tbody>
        ${row('Họ và tên', p.Display || p.Name)}${row('Tài khoản', curUser.username)}${row('Email', p.Email)}${row('Chức danh', p.Title)}${row('Điện thoại', p.Phone)}${row('Phòng ban', p.Dept)}${row('Trưởng phòng', p.Manager)}${row('Vai trò trên cổng', ROLE[curUser.role] || curUser.role)}${row('Ngày tạo tài khoản', dt(p.Created))}</tbody></table></div></div>
    <div class="col-lg-6"><div class="card p-4 h-100"><h6 class="fw-bold text-warning mb-3"><i class="fa-solid fa-key"></i> Mật khẩu</h6><table class="table table-sm"><tbody>
        ${row('Đặt gần nhất', dt(p.PwSet))}<tr><td class="text-secondary">Hạn mật khẩu</td><td class="fw-semibold">${p.NeverExpires || !p.PwExpires ? 'Không hết hạn' : `${dt(p.PwExpires)} <span class="badge bg-${days <= 7 ? 'danger' : days <= 14 ? 'warning text-dark' : 'success'} ms-1">${days > 0 ? 'còn ' + days + ' ngày' : 'đã hết hạn'}</span>`}</td></tr>
        <tr><td class="text-secondary">Trạng thái</td><td>${p.Locked ? '<span class="badge bg-danger">Đang bị khóa</span>' : '<span class="badge bg-success">Bình thường</span>'}</td></tr></tbody></table>
        <div class="alert alert-secondary small mb-3">Mật khẩu do bộ phận IT cấp và quản lý. Khi quên mật khẩu hoặc bị khóa tài khoản, hãy gửi phiếu để IT xác minh danh tính và xử lý.</div>
        <button class="btn btn-warning fw-bold mt-auto" data-tkgo="Quên mật khẩu / Mở khóa tài khoản"><i class="fa-solid fa-headset"></i> Gửi phiếu quên mật khẩu / mở khóa</button></div></div>
    <div class="col-12"><div class="card p-4"><h6 class="fw-bold text-secondary mb-3"><i class="fa-solid fa-users"></i> Nhóm tôi thuộc về</h6>${p.Groups.map(g => `<span class="badge bg-secondary me-1 mb-1">${esc(g)}</span>`).join('') || '<span class="text-secondary small">Chỉ thuộc nhóm mặc định (Domain Users)</span>'}</div></div>`;
}

// ===== Thư mục của tôi =====
let dkPath = '';   // vị trí đang duyệt (Super-Admin) - giữ lại khi trang tự làm mới
const GB = n => (n / 1073741824).toFixed(1) + ' GB';
async function loadDisk(path) {
    if (!$('dkRows')) return;
    const r = await fetch('/api/deleg/browse' + (path ? '?path=' + encodeURIComponent(path) : '')), d = await r.json().catch(() => ({}));
    if (!r.ok || d.success === false || !d.items) { $('dkRows').innerHTML = `<tr><td colspan="3" class="text-danger">${esc(d.error || 'Không đọc được (HTTP ' + r.status + ')')}</td></tr>`; return; }
    dkPath = d.path; const parts = d.path ? d.path.split('\\') : [];
    $('dkCrumb').innerHTML = `<a href="javascript:void 0" data-disk="">Các ổ đĩa</a>` + parts.map((p, i) => ` / <a href="javascript:void 0" data-disk="${esc(i === 0 ? p + '\\' : parts.slice(0, i + 1).join('\\'))}">${esc(p)}</a>`).join('');
    $('dkRows').innerHTML = d.items.map(x => `<tr><td><a href="javascript:void 0" class="fw-bold text-warning" data-disk="${esc(x.path)}"><i class="fa-solid ${d.path ? 'fa-folder' : 'fa-hard-drive'} me-2"></i>${esc(x.name)}</a>${x.label ? ` <small class="text-secondary">${esc(x.label)}</small>` : ''}</td><td>${x.size ? `<small>${GB(x.size - x.free)} / ${GB(x.size)}</small>` : ''}${x.dept ? ` <span class="badge bg-info text-dark">Thư mục phòng ${esc(x.dept)}</span>` : ''}</td><td>${x.shares.map(s => `<code>${esc(s.unc)}</code>${cpBtn(s.unc)}`).join('<br>') || '<span class="text-secondary small">chưa chia sẻ</span>'}</td></tr>`).join('') || '<tr><td colspan="3" class="text-secondary">Không có thư mục con</td></tr>';
}
async function loadMine() {
    if (!$('mineBox')) return;
    const admin = curUser.role === 'Super-Admin', r = await fetch('/api/deleg/mine'), d = await r.json().catch(() => ({}));
    if (!d.grants && !admin) { $('mineBox').innerHTML = `<div class="alert alert-danger">Không đọc được dữ liệu thư mục: ${esc(d.error || 'HTTP ' + r.status + (r.status === 404 ? ' - máy chủ chưa có API /api/deleg/mine (chưa cập nhật routes/deleg.js hoặc chưa khởi động lại dịch vụ)' : ''))}</div>`; return; }
    d.depts = d.depts || []; d.managed = d.managed || []; d.grants = d.grants || [];
    const SRC = { dept: ['Quyền chung của phòng', 'secondary'], group: ['Cấp cho cả phòng / nhóm', 'primary'], user: ['Cấp riêng cho bạn', 'success'], manager: ['Trưởng phòng', 'warning text-dark'] }, BASEL = { none: 'không có', read: 'chỉ đọc', write: 'đọc / ghi' };
    const diskCard = admin ? `<div class="card p-4 mb-3"><h6 class="fw-bold text-warning mb-3"><i class="fa-solid fa-hard-drive"></i> Ổ đĩa &amp; thư mục trên máy chủ <span class="badge bg-secondary ms-2">chỉ Super-Admin</span></h6><nav id="dkCrumb" class="small mb-2"></nav><div class="table-responsive" style="max-height:50vh;overflow-y:auto"><table class="table table-hover table-sm"><thead><tr><th>Tên</th><th>Thông tin</th><th>Đường dẫn mạng</th></tr></thead><tbody id="dkRows"><tr><td colspan="3" class="text-secondary">Đang tải...</td></tr></tbody></table></div></div>` : '';
    const warn = d.warn ? `<div class="alert alert-warning small">${esc(d.warn)}</div>` : '';
    $('mineBox').innerHTML = diskCard + warn + `
    <div class="card p-4 mb-3"><h6 class="fw-bold text-info mb-3"><i class="fa-solid fa-building"></i> Thư mục chung của phòng</h6>${d.depts.map(x => `<div class="mb-2"><b>${esc(x.dept)}</b>${x.unc ? ` · <code>${esc(x.unc)}</code>${cpBtn(x.unc)}` : ' · <span class="text-warning small">chưa có đường dẫn mạng</span>'} · <span class="small text-secondary">quyền chung của phòng trên thư mục con: <b>${BASEL[x.base] || BASEL.read}</b></span></div>`).join('') || '<span class="text-secondary small">Phòng của bạn chưa được thiết lập thư mục trên cổng.</span>'}
        <div class="small text-secondary mt-2">Bạn vào được các thư mục con của phòng theo quyền chung của phòng, trừ thư mục được đặt <span class="badge bg-danger">Hạn chế</span> (chỉ người được cấp riêng mới vào được).</div></div>
    ${d.managed.length ? `<div class="alert alert-info small"><i class="fa-solid fa-star text-warning"></i> Bạn là trưởng phòng ${d.managed.map(x => `<b>${esc(x.dept)}</b>`).join(', ')}: chia quyền thư mục cho nhân viên tại mục <a href="javascript:void 0" onclick="navigateTo('deleg')">Thư Mục Phòng Ban</a>.</div>` : ''}
    <div class="card p-4 mb-3"><h6 class="fw-bold text-success mb-3"><i class="fa-solid fa-folder-open"></i> Thư mục tôi truy cập được</h6><div class="table-responsive" style="max-height:50vh;overflow-y:auto"><table class="table table-hover table-sm"><thead><tr><th>Thư mục</th><th>Quyền</th><th>Nguồn</th><th>Hết hạn</th><th>Người cấp</th><th>Đường dẫn mạng</th></tr></thead><tbody>
        ${d.grants.map(g => { const sr = SRC[g.source] || SRC.dept; return `<tr><td><b>${esc(g.dept)}</b><code class="ms-1">${esc(g.rel)}</code></td><td><span class="badge bg-${g.level === 'write' ? 'success' : 'info text-dark'}">${g.level === 'write' ? 'Đọc / Ghi' : 'Chỉ đọc'}</span><small class="text-secondary"> (gồm thư mục con)</small></td><td><span class="badge bg-${sr[1]}">${sr[0]}</span>${g.via ? ` <small class="text-secondary">${esc(g.via)}</small>` : ''}</td><td><small>${g.expires_at ? dt(g.expires_at) + ' <span class="badge bg-warning text-dark">tạm thời</span>' : '—'}</small></td><td><small>${g.by_user ? esc(g.by_user) : '—'}${g.by_role === 'IT' ? ' <span class="badge bg-warning text-dark">IT</span>' : ''}</small></td><td>${g.unc ? `<code>${esc(g.unc)}</code>${cpBtn(g.unc)}` : '—'}</td></tr>`; }).join('') || '<tr><td colspan="6" class="text-secondary">Bạn chưa truy cập được thư mục nào trong phòng.</td></tr>'}</tbody></table></div>
        <div class="small text-secondary mt-2">Tính từ quyền thực tế trên máy chủ (làm mới tối đa 1 phút). Thư mục con cùng mức quyền với thư mục cha được gộp vào dòng của thư mục cha.</div></div>
    <div class="card p-4"><h6 class="fw-bold mb-2"><i class="fa-solid fa-circle-info"></i> Cách truy cập</h6><ol class="small mb-0"><li>Máy tính phải đang ở mạng công ty (hoặc VPN) và đăng nhập bằng tài khoản domain.</li><li>Mở File Explorer, dán đường dẫn mạng (nút sao chép bên trên) vào thanh địa chỉ rồi Enter.</li><li>Muốn dùng thường xuyên: chuột phải <b>This PC</b> → <b>Map network drive</b> → dán đường dẫn → chọn <b>Reconnect at sign-in</b>.</li><li>Không vào được thư mục vừa được cấp quyền: đăng xuất rồi đăng nhập lại, nếu vẫn lỗi hãy gửi phiếu "Quyền truy cập thư mục".</li></ol></div>`;
    if (admin) loadDisk(dkPath);
}

// ===== Phiếu hỗ trợ =====
const TK_ST = { Open: ['Mới', 'danger'], InProgress: ['Đang xử lý', 'warning text-dark'], Resolved: ['Đã xử lý', 'success'], Cancelled: ['Đã hủy', 'secondary'] };
const TK_PR = { Urgent: ['Khẩn cấp', 'danger'], High: ['Cao', 'warning text-dark'], Normal: ['Bình thường', 'secondary'], Low: ['Thấp', 'info text-dark'] };
const TK_HINT = { 'Quên mật khẩu / Mở khóa tài khoản': 'IT sẽ xác minh danh tính của bạn (qua trưởng phòng hoặc gọi lại) trước khi cấp mật khẩu mới. KHÔNG ghi mật khẩu vào phiếu.', 'Quyền truy cập thư mục': 'Ghi rõ thư mục cần truy cập và mức quyền (đọc hay ghi). IT sẽ xác nhận với trưởng phòng.' };
let tkRows = [], tkOpen = 0;
const stBadge = s => { const x = TK_ST[s] || [String(s || 'Không rõ'), 'secondary']; return `<span class="badge bg-${x[1]}">${esc(x[0])}</span>`; }, prBadge = p => { const x = TK_PR[p] || TK_PR.Normal; return `<span class="badge bg-${x[1]}">${esc(x[0])}</span>`; };
const isStaff = () => curUser.perms && curUser.perms.helpdesk === 'manage' && curUser.role !== 'Employee';

function renderTickets() {
    const f = $('tkFilter') ? $('tkFilter').value : '', rows = tkRows.filter(t => !f || (f === 'active' ? ['Open', 'InProgress'].includes(t.status) : t.status === f));
    const slaCell = t => {
        const active = ['Open', 'InProgress'].includes(t.status);
        const toDate = value => value ? new Date(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:\d\d$/.test(String(value)) ? '' : 'Z')) : null;
        const responseDue = toDate(t.response_due_at), responded = toDate(t.first_response_at), resolutionDue = toDate(t.resolution_due_at), resolved = toDate(t.resolved_at), now = new Date();
        const responseLate = !!responseDue && (responded ? responded > responseDue : active && responseDue < now);
        const resolutionLate = !!resolutionDue && (resolved ? resolved > resolutionDue : active && resolutionDue < now);
        if (!t.response_due_at && !t.resolution_due_at) return '<span class="badge bg-secondary">Chưa có dữ liệu SLA</span>';
        if (responseLate || resolutionLate) return `<span class="badge bg-danger">Quá SLA</span><br><small>${responseLate ? 'Phản hồi trễ' : ''}${responseLate && resolutionLate ? ' · ' : ''}${resolutionLate ? 'Giải quyết trễ' : ''}</small>`;
        if (t.status === 'Resolved') return '<span class="badge bg-success">Đã xử lý đúng hạn</span>';
        return `<span class="badge bg-info text-dark">Trong hạn</span><br><small>${esc(t.resolution_due_at || t.response_due_at)}</small>`;
    };
    $('ticketList').innerHTML = rows.map(t => `<tr data-tk="${esc(t.id)}" style="cursor:pointer"><td>#${esc(t.id)}</td><td>${esc(t.requester)}</td><td><small>${esc(t.type)}</small></td><td>${esc(t.title)}${t.comments ? ` <span class="badge bg-secondary ms-1"><i class="fa-regular fa-comment"></i> ${esc(t.comments)}</span>` : ''}</td><td>${prBadge(t.priority)}</td><td><small>${esc(t.local_updated || t.local_created)}</small></td><td>${slaCell(t)}</td><td>${stBadge(t.status)}${t.assignee ? `<br><small class="text-secondary">${esc(t.assignee)}</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="text-secondary">Không có phiếu nào</td></tr>';
}
loadTickets = async () => {
    if (!$('tkForm')) return;
    const d = await J('/api/tickets'); tkRows = Array.isArray(d) ? d : []; renderTickets();
    const hint = () => $('tkHint').innerText = TK_HINT[$('tkType').value] || '';
    if (window.__tkType) { $('tkType').value = window.__tkType; window.__tkType = null; }
    if (window.__tkAssetId && $('tkAssetId')) { $('tkAssetId').value = window.__tkAssetId; window.__tkAssetId = null; }
    if ($('tkAssetHint') && $('tkAssetId')?.value) { $('tkAssetHint').innerText = 'Yêu cầu liên quan tới tài sản đã chọn.'; $('tkAssetHint').classList.remove('d-none'); }
    hint(); $('tkType').onchange = hint; $('tkFilter').onchange = renderTickets;
    $('ticketList').onclick = e => { const tr = e.target.closest('[data-tk]'); if (tr) openTicket(+tr.dataset.tk); };
    $('tkForm').onsubmit = async e => {
        e.preventDefault();
        const r = await send('/api/tickets', { type: $('tkType').value, priority: $('tkPrio').value, title: $('tkTitle').value, description: $('tkDesc').value, asset_id: $('tkAssetId')?.value || null });
        if (r.success) { toast('Đã gửi phiếu #' + r.id); $('tkForm').reset(); $('tkAssetHint')?.classList.add('d-none'); hint(); loadTickets(); } else toast(r.error || 'Gửi phiếu thất bại', 'danger');
    };
};
setInterval(() => { if (curUser && currentSection === 'helpdesk' && !document.hidden && !document.querySelector('.modal.show')) loadTickets(); }, 30000);

document.body.insertAdjacentHTML('beforeend', `
<div class="modal fade" id="tkModal" tabindex="-1"><div class="modal-dialog modal-lg"><div class="modal-content">
  <div class="modal-header"><h5 class="modal-title fw-bold text-info" id="tkdTitle"></h5><button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>
  <div class="modal-body"><div id="tkdMeta" class="small text-secondary mb-3"></div><div id="tkdDesc" class="mb-3" style="white-space:pre-wrap"></div><div id="tkdRes"></div>
    <h6 class="fw-bold mt-3">Trao đổi</h6><div id="tkdComments" class="mb-3" style="max-height:240px;overflow-y:auto"></div>
    <div id="tkdReply" class="input-group"><input id="tkdBody" class="form-control bg-transparent" maxlength="1500" placeholder="Nhập nội dung..."><button type="button" class="btn btn-info fw-bold" id="tkdSend">Gửi</button></div>
    <div id="tkdClose" class="mt-3 d-none"><label class="form-label small text-secondary">Kết quả xử lý (bắt buộc):</label><textarea id="tkdNote" class="form-control bg-transparent" rows="2" maxlength="500"></textarea><div id="tkdNoteHint" class="small text-warning mt-1"></div></div></div>
  <div class="modal-footer" id="tkdActions"></div></div></div></div>`);
async function openTicket(id) {
    const r = await fetch('/api/tickets/' + id); if (!r.ok) return toast('Không mở được phiếu', 'danger');
    const { ticket: t, comments } = await r.json(); tkOpen = id;
    const active = ['Open', 'InProgress'].includes(t.status), mineT = t.username ? t.username.toLowerCase() === curUser.username.toLowerCase() : t.requester === curUser.fullname, pw = /mật khẩu/i.test(t.type);
    $('tkdTitle').innerText = `#${t.id} · ${t.title}`;
    const responseDeadline = t.response_due_at ? `Hạn phản hồi: ${esc(t.response_due_at)}${t.first_response_at ? ` (đã phản hồi ${esc(t.first_response_at)})` : ''}` : 'Chưa có mốc SLA phản hồi';
    const resolutionDeadline = t.resolution_due_at ? `Hạn giải quyết: ${esc(t.resolution_due_at)}${t.resolved_at ? ` (hoàn tất ${esc(t.resolved_at)})` : ''}` : 'Chưa có mốc SLA giải quyết';
    $('tkdMeta').innerHTML = `${esc(t.type)} · ${prBadge(t.priority)} · ${stBadge(t.status)}<br>Người gửi: <b>${esc(t.requester)}</b> · ${esc(t.local_created)}${t.assignee ? ' · Phụ trách: <b>' + esc(t.assignee) + '</b>' : ''}<br>${responseDeadline}<br>${resolutionDeadline}`;
    $('tkdDesc').innerText = t.description || '(không có mô tả chi tiết)';
    $('tkdRes').innerHTML = t.resolution ? `<div class="alert alert-success small mb-0"><b>Kết quả xử lý:</b> ${esc(t.resolution)}</div>` : '';
    $('tkdComments').innerHTML = comments.map(c => `<div class="mb-2 p-2 rounded border"><small><b>${esc(c.fullname)}</b> <span class="badge bg-${c.role === 'IT' ? 'warning text-dark' : 'secondary'}">${c.role === 'IT' ? 'IT' : 'Người gửi'}</span> <span class="text-secondary">${esc(c.local_created)}</span></small><div style="white-space:pre-wrap">${esc(c.body)}</div></div>`).join('') || '<div class="text-secondary small">Chưa có trao đổi nào.</div>';
    $('tkdReply').classList.toggle('d-none', !active); $('tkdBody').value = ''; $('tkdClose').classList.add('d-none'); $('tkdNote').value = '';
    $('tkdNoteHint').innerText = pw ? 'Ghi rõ đã xác minh danh tính bằng cách nào (VD: gọi lại trưởng phòng). Mật khẩu mới đặt tại trang Active Directory và bàn giao riêng cho người dùng, không ghi vào phiếu.' : '';
    $('tkdActions').innerHTML = (isStaff() && active ? `<button class="btn btn-outline-warning" data-act="take">Nhận xử lý</button><button class="btn btn-success" data-act="resolve">Đóng phiếu</button>` : '') + (mineT && t.status === 'Open' ? '<button class="btn btn-outline-danger" data-act="cancel">Hủy phiếu</button>' : '') + '<button class="btn btn-secondary" data-bs-dismiss="modal">Đóng</button>';
    bootstrap.Modal.getOrCreateInstance($('tkModal')).show();
}
$('tkdSend').onclick = async () => { const b = $('tkdBody').value.trim(); if (!b) return; const r = await send(`/api/tickets/${tkOpen}/comments`, { body: b }); r.success ? (await openTicket(tkOpen), loadTickets()) : toast(r.error || 'Gửi thất bại', 'danger'); };
$('tkdActions').onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act;
    if (act === 'resolve' && $('tkdClose').classList.contains('d-none')) { $('tkdClose').classList.remove('d-none'); $('tkdNote').focus(); return; }
    if (act === 'cancel' && !confirm('Hủy phiếu này?')) return;
    const r = await send(`/api/tickets/${tkOpen}/${act}`, act === 'resolve' ? { note: $('tkdNote').value } : {});
    if (r.success) { toast('Đã cập nhật phiếu'); await openTicket(tkOpen); loadTickets(); } else toast(r.error || 'Thất bại', 'danger');
};
