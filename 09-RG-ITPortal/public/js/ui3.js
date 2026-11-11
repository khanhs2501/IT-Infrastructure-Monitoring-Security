// 1) Không gọi API khi chưa đăng nhập: trước đây bộ đếm 5 giây gọi API ngay ở màn hình đăng nhập -> 401 -> tải lại trang liên tục
const _r3 = refreshCurrentView;
refreshCurrentView = () => { if (!curUser) return; if (currentSection === 'perm') return loadPerm(); _r3(); };

// 2) Quyền lấy từ máy chủ (curUser.perms), không còn cố định trong mã giao diện
['Employee', 'IT-Staff'].forEach(r => Object.defineProperty(allow, r, { configurable: true, enumerable: true, get: () => {
    const p = (curUser && curUser.perms) || {}, l = Object.keys(p).filter(m => p[m] !== 'none'); return l.length ? l : ['helpdesk'];
} }));
const _ar = applyRole; applyRole = () => { _ar(); const n = $('nav-perm'); if (n) n.classList.toggle('d-none', !(curUser && curUser.role === 'Super-Admin')); };
const _n3 = navigateTo; navigateTo = async s => { await _n3(s); if (currentSection === 'perm') $('secTitle').innerText = 'Phân Quyền Theo Vai Trò'; };

// 3) Báo lỗi khi khóa/mở khóa bị từ chối (giao diện cũ không hiện lỗi này)
const _f3 = window.fetch;
window.fetch = async (...a) => { const r = await _f3(...a); if (/\/toggle$/.test(String(a[0]))) r.clone().json().then(d => d.success === false && toast(d.error || 'Thao tác thất bại', 'danger')).catch(() => {}); return r; };

async function loadPerm() {
    const d = await J('/api/permissions'); if (!d.matrix || !$('permBody')) return;
    const L = { none: 'Không truy cập', view: 'Xem', manage: 'Quản lý' };
    const N = { zabbix: 'Giám sát hạ tầng (Zabbix)', wazuh: 'Giám sát SOC (Wazuh)', pfsense: 'Điều phối Gateway (pfSense)', ad: 'Active Directory (Users/OU)', computers: 'Quản trị máy tính Domain', laps: 'Đọc mật khẩu Windows LAPS', admin: 'Quản trị hệ thống (GPO, File Server)', helpdesk: 'Hỗ trợ kỹ thuật' };
    $('permBody').innerHTML = d.modules.map(m => `<tr><td class="fw-bold">${N[m]}</td>${['IT-Staff', 'Employee'].map(r => `<td><select class="form-select form-select-sm bg-transparent" onchange="setPerm('${r}','${m}',this.value)">${Object.keys(L).map(k => `<option value="${k}" ${d.matrix[r][m] === k ? 'selected' : ''}>${L[k]}</option>`).join('')}</select></td>`).join('')}</tr>`).join('');
}
async function setPerm(role, module, level) { const d = await send('/api/permissions', { role, module, level }, 'PUT'); d.success ? toast('Đã lưu phân quyền') : toast('Lưu thất bại', 'danger'); }
