// ui9.js — AD theo OU, trang Computer Management độc lập và công cụ Docker nâng cao.
// Các API thay đổi vẫn kiểm tra quyền phía backend; UI không phải hàng rào bảo mật duy nhất.

titles.computers = 'Quản Lý Computer Domain';
PAGES.push('computers');
PN.computers = 'Computer Management';
PN.laps = 'Windows LAPS';
PS_.computers = 'Computer Management';
PS_.laps = 'Windows LAPS';
PRESETS['Helpdesk'].computers = 'manage';
PRESETS['Quản trị hệ thống'].computers = 'manage';

$('nav-ad').insertAdjacentHTML('afterend', '<a class="nav-link" id="nav-computers" onclick="navigateTo(\'computers\')"><i class="fa-solid fa-computer me-2"></i> Quản Lý Computers</a>');
['Employee', 'IT-Staff'].forEach(role => {
  const desc = Object.getOwnPropertyDescriptor(allow, role);
  if (!desc) return;
  const prior = desc.get ? desc.get.bind(allow) : () => desc.value || [];
  Object.defineProperty(allow, role, { configurable: true, enumerable: true, get: () => {
    const list = prior(), perms = curUser?.perms || {};
    return role === 'IT-Staff' && perms.computers && perms.computers !== 'none' ? [...new Set([...list, 'computers'])] : list.filter(x => x !== 'computers');
  }});
});
const _applyRole9 = applyRole;
applyRole = () => {
  _applyRole9();
  const nav = $('nav-computers');
  if (nav) nav.classList.toggle('d-none', !(curUser?.role === 'Super-Admin' || (curUser?.perms?.computers && curUser.perms.computers !== 'none')));
};
const _refresh9 = refreshCurrentView;
refreshCurrentView = () => {
  if (!curUser) return;
  if (currentSection === 'computers') return loadADComputers();
  return _refresh9();
};

// Active Directory: OU tree on the left, user table on the right. Query only the selected OU.
let AD_SELECTED_OU9 = '__ALL__';
let AD_DEPARTMENTS9 = [];
let AD_USER_QUERY_TIMER9 = null;
async function loadAD9() {
  if (!$('adOuTree') || !$('adUserList')) return;
  $('adOuTree').innerHTML = '<div class="text-secondary small p-2">Đang tải danh sách OU...</div>';
  try {
    const r = await fetch('/api/ad/departments');
    const data = await r.json();
    if (!r.ok || data?.success === false) throw new Error(data.error || 'Không tải được OU');
    AD_DEPARTMENTS9 = Array.isArray(data) ? data : (data ? [data] : []);
    const options = AD_DEPARTMENTS9.map(o => `<option value="${esc(o.DistinguishedName || o.Name)}">${esc(o.Name)}</option>`).join('');
    if ($('mDept')) {
      // This select is only for create-user placement; it must not change the active OU tree filter.
      $('mDept').innerHTML = options;
    }
    if ($('eDept')) $('eDept').innerHTML = options;
    const validScope = ['__ALL__', '__ADMINS__', '__UNKNOWN__'].includes(AD_SELECTED_OU9) || AD_DEPARTMENTS9.some(o => o.DistinguishedName === AD_SELECTED_OU9 || o.Name === AD_SELECTED_OU9);
    if (!validScope) AD_SELECTED_OU9 = '__ALL__';
    if ($('adUserSearch')) $('adUserSearch').oninput = () => { clearTimeout(AD_USER_QUERY_TIMER9); AD_USER_QUERY_TIMER9 = setTimeout(loadADUsers9, 250); };
    const deptSelect = $('mDept');
    if (deptSelect && AD_DEPARTMENTS9.length && (!deptSelect.value || !AD_DEPARTMENTS9.some(o => (o.DistinguishedName || o.Name) === deptSelect.value || o.Name === deptSelect.value))) deptSelect.value = AD_DEPARTMENTS9[0].DistinguishedName || AD_DEPARTMENTS9[0].Name;
    renderADScopeTree9();
    await loadADUsers9();
    await loadADOUGroups9();
  } catch (err) {
    $('adOuTree').innerHTML = `<div class="text-danger small p-2">${esc(err.message)}</div>`;
    $('adUserList').innerHTML = `<tr><td colspan="6" class="text-danger">${esc(err.message)}</td></tr>`;
    if ($('adUserFooter')) $('adUserFooter').textContent = 'Không thể tải danh sách Active Directory.';
  }
}
function renderADScopeTree9() {
  const tree = $('adOuTree'); if (!tree) return;
  const virtual = [
    { Name: 'Tất cả user trong Domain', Value: '__ALL__', Icon: 'fa-users', Hint: 'Tất cả tài khoản' },
    { Name: 'Tài khoản quản trị', Value: '__ADMINS__', Icon: 'fa-user-shield', Hint: 'Thành viên nhóm quản trị' },
    { Name: 'Chưa xác định OU', Value: '__UNKNOWN__', Icon: 'fa-user-question', Hint: 'User nằm trong container, không thuộc OU' }
  ];
  const virtualHtml = virtual.map(o => `<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-2 ${o.Value === AD_SELECTED_OU9 ? 'active' : ''}" data-ad-ou="${o.Value}"><i class="fa-solid ${o.Icon}"></i><span class="text-truncate flex-grow-1">${esc(o.Name)}</span></button>`).join('');
  const deptHtml = AD_DEPARTMENTS9.map(o => { const dn = o.DistinguishedName || o.Name; const active = dn === AD_SELECTED_OU9 || o.Name === AD_SELECTED_OU9; return `<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-2 ${active ? 'active' : ''}" data-ad-ou="${esc(dn)}" title="${esc(dn)}"><i class="fa-regular fa-folder-open"></i><span class="text-truncate">${esc(o.Name)}</span></button>`; }).join('');
  tree.innerHTML = `${virtualHtml}<div class="small fw-bold text-secondary px-3 py-2 border-top mt-2">Departments · OU phòng ban</div>${deptHtml || '<div class="text-secondary small p-2">Không tìm thấy OU con trong Departments.</div>'}`;
  tree.querySelectorAll('[data-ad-ou]').forEach(btn => btn.addEventListener('click', () => {
    AD_SELECTED_OU9 = btn.dataset.adOu || '__ALL__';
    if ($('adDepartmentFilter')) $('adDepartmentFilter').value = AD_SELECTED_OU9;
    const selectedDept = AD_DEPARTMENTS9.find(o => o.DistinguishedName === AD_SELECTED_OU9 || o.Name === AD_SELECTED_OU9);
    if ($('mDept') && selectedDept) $('mDept').value = selectedDept.DistinguishedName || selectedDept.Name;
    renderADScopeTree9();
    loadADUsers9();
    loadADOUGroups9();
  }));
}
function renderADUserRow9(u) {
  const admin = u.IsAdmin === true || u.PrimaryGroup === 'Domain Admins' || u.PrimaryGroup === 'Admin';
  const managerBadge = u.IsManager === true ? ` <span class="mgr-star text-warning" title="Trưởng phòng ${esc(u.ManagerOf || u.Department || '')}" aria-label="Trưởng phòng">★</span>` : '';
  let actions = '';
  if (curUser?.role === 'Super-Admin') {
    const editButton = u.IsInDepartments === true
      ? `<button class="btn btn-sm btn-outline-info me-1" data-ad-user-action="edit" data-user="${esc(u.Username)}" title="Sửa thông tin trong Departments"><i class="fa-solid fa-pen"></i></button>`
      : `<button class="btn btn-sm btn-outline-secondary me-1" disabled title="User ngoài Departments: không cho sửa/move bằng form phòng ban này"><i class="fa-solid fa-pen"></i></button>`;
    actions = `${editButton}<button class="btn btn-sm btn-outline-${u.Enabled?'danger':'success'} me-1" data-ad-user-action="toggle" data-user="${esc(u.Username)}" title="${u.Enabled?'Khóa':'Mở khóa'}"><i class="fa-solid fa-${u.Enabled?'lock':'unlock'}"></i></button><button class="btn btn-sm btn-outline-warning me-1" data-ad-user-action="reset" data-user="${esc(u.Username)}" title="Reset mật khẩu"><i class="fa-solid fa-key"></i></button><button class="btn btn-sm btn-outline-danger" data-ad-user-action="delete" data-user="${esc(u.Username)}" title="Xóa"><i class="fa-solid fa-trash"></i></button>`;
  } else if (curUser?.role === 'IT-Staff' && ['view','manage'].includes(curUser?.perms?.ad)) {
    actions = `<button class="btn btn-sm btn-outline-warning" data-ad-user-action="reset" data-user="${esc(u.Username)}">Reset Pass</button>`;
  }
  return `<tr data-ad-user-row="${esc(u.Username)}"><td class="fw-bold text-warning"><button class="btn btn-link btn-sm p-0 fw-bold text-warning text-decoration-none" data-ad-user-computers="${esc(u.Username)}" title="Xem máy tính được gán">${esc(u.Username)}</button>${admin?' <i class="fa-solid fa-shield-halved text-danger" title="Tài khoản quản trị"></i>':''}${managerBadge}</td><td>${esc(u.FullName)}</td><td><span class="badge bg-secondary">${esc(u.Department || 'Chưa xác định OU')}</span></td><td><code>${esc(u.PrimaryGroup || 'Domain Users')}</code></td><td><span class="badge bg-${u.Enabled?'success':'danger'}">${u.Enabled?'Enabled':'Disabled'}</span></td><td class="text-end text-nowrap">${actions}</td></tr>`;
}
async function loadADOUGroups9() {
  const panel = $('adOUGroupPanel'), body = $('adOUGroupList');
  if (!panel || !body) return;
  const selectedOU = AD_DEPARTMENTS9.find(o => o.DistinguishedName === AD_SELECTED_OU9 || o.Name === AD_SELECTED_OU9);
  if (!selectedOU || !selectedOU.DistinguishedName) {
    panel.classList.add('d-none');
    body.innerHTML = '<tr><td colspan="4" class="text-secondary">Chọn một OU phòng ban để xem group.</td></tr>';
    if ($('adOUGroupCount')) $('adOUGroupCount').textContent = '0 nhóm';
    return;
  }
  panel.classList.remove('d-none');
  body.innerHTML = '<tr><td colspan="4" class="text-secondary"><span class="spinner-border spinner-border-sm me-2"></span>Đang tải group trong OU...</td></tr>';
  try {
    const r = await fetch(`/api/ad/ou-groups?ou=${encodeURIComponent(selectedOU.DistinguishedName)}`, { cache: 'no-store' });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.success === false || !Array.isArray(data)) throw new Error(data.error || 'Không tải được group của OU');
    body.innerHTML = data.map(g => {
      const names = Array.isArray(g.Members) ? g.Members : (g.Members ? [g.Members] : []);
      const memberHtml = names.length ? names.map(n => `<code class="me-1">${esc(n)}</code>`).join('') : '<span class="text-secondary">Chưa có user thành viên</span>';
      return `<tr><td><div class="fw-semibold">${esc(g.Name || g.SamAccountName || '')}</div>${g.Description ? `<div class="small text-secondary">${esc(g.Description)}</div>` : ''}</td><td><span class="badge bg-secondary">${esc(g.Scope || '—')}</span> <span class="badge bg-info text-dark">${esc(g.Category || '—')}</span></td><td>${Number(g.MemberCount || 0)}</td><td class="small" style="min-width:220px">${memberHtml}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="text-secondary">OU này chưa có group object. User vẫn được liệt kê ở bảng bên trên.</td></tr>';
    if ($('adOUGroupCount')) $('adOUGroupCount').textContent = `${data.length} nhóm`;
  } catch (err) {
    body.innerHTML = `<tr><td colspan="4" class="text-danger">${esc(err.message)}</td></tr>`;
    if ($('adOUGroupCount')) $('adOUGroupCount').textContent = 'Lỗi tải';
  }
}
async function loadADUsers9() {
  const body = $('adUserList'); if (!body) return;
  const q = $('adUserSearch')?.value?.trim() || '';
  const labels = { '__ALL__': 'Tất cả user trong Domain', '__ADMINS__': 'Tài khoản quản trị', '__UNKNOWN__': 'Chưa xác định OU' };
  const selectedOU = AD_DEPARTMENTS9.find(o => o.DistinguishedName === AD_SELECTED_OU9 || o.Name === AD_SELECTED_OU9);
  const caption = labels[AD_SELECTED_OU9] || (selectedOU ? `Departments / ${selectedOU.Name}` : `OU / ${AD_SELECTED_OU9}`);
  if ($('adSelectedOUCaption')) $('adSelectedOUCaption').textContent = caption;
  body.innerHTML = `<tr><td colspan="6" class="text-secondary"><span class="spinner-border spinner-border-sm me-2"></span>Đang tải: ${esc(caption)}...</td></tr>`;
  try {
    const r = await fetch(`/api/ad/users?ou=${encodeURIComponent(AD_SELECTED_OU9)}&q=${encodeURIComponent(q)}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.success === false || !Array.isArray(data)) throw new Error(data.error || 'Không tải được user');
    currentADUsers = data;
    body.innerHTML = data.map(renderADUserRow9).join('') || `<tr><td colspan="6" class="text-secondary">Không có user trong nhóm “${esc(caption)}”${q?' khớp điều kiện tìm kiếm':''}.</td></tr>`;
    if ($('adUserFooter')) $('adUserFooter').textContent = `${data.length} user · ${caption}${q ? ` · Bộ lọc: ${q}` : ''}.`;
  } catch (err) {
    body.innerHTML = `<tr><td colspan="6" class="text-danger">${esc(err.message)}</td></tr>`;
    if ($('adUserFooter')) $('adUserFooter').textContent = 'Truy vấn AD thất bại; kiểm tra log Portal và quyền đọc AD.';
  }
}
// User editing stays inside the existing modal and updates only the affected row.
window.openEditModal = function(username) {
  const u = currentADUsers.find(x => String(x.Username).toLowerCase() === String(username).toLowerCase());
  if (!u) return toast('Không tìm thấy user trong danh sách hiện tại; hãy tải lại danh sách.', 'warning');
  $('eUsernameTitle').textContent = u.Username;
  $('eUser').value = u.Username;
  $('eFull').value = u.FullName || '';
  const userOU = AD_DEPARTMENTS9.find(o => o.DistinguishedName && u.DistinguishedName && u.DistinguishedName.toLowerCase().endsWith(',' + o.DistinguishedName.toLowerCase())) || AD_DEPARTMENTS9.find(o => o.Name === u.Department);
  $('eDept').value = userOU ? (userOU.DistinguishedName || userOU.Name) : (u.Department || '');
  $('eGroup').value = ['Domain Users','IT-Helpdesk','Domain Admins'].includes(u.PrimaryGroup) ? u.PrimaryGroup : 'Domain Users';
  bootstrap.Modal.getOrCreateInstance($('editUserModal')).show();
};

if ($('adEditForm')) $('adEditForm').onsubmit = async e => {
  e.preventDefault();
  const form = $('adEditForm'), button = form.querySelector('button[type="submit"]');
  const username = $('eUser').value, oldText = button?.innerHTML;
  const beforeIndex = currentADUsers.findIndex(x => String(x.Username).toLowerCase() === String(username).toLowerCase());
  const before = beforeIndex >= 0 ? currentADUsers[beforeIndex] : null;
  const fullName = $('eFull').value.trim();
  const group = $('eGroup').value;
  const targetDN = $('eDept').value;
  const targetOU = AD_DEPARTMENTS9.find(o => o.DistinguishedName === targetDN || o.Name === targetDN);
  if (button) { button.disabled = true; button.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Đang lưu...'; }
  try {
    const r = await fetch(`/api/ad/users/${encodeURIComponent(username)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({fullname:fullName, department:targetDN, group}) });
    const d = await r.json().catch(()=>({}));
    if (!r.ok || d.success === false || d.Success === false) throw new Error(d.error || d.Error || 'Không cập nhật được user');
    bootstrap.Modal.getOrCreateInstance($('editUserModal')).hide();
    toast(`Đã cập nhật ${username}`, 'success');

    // Update only the changed record; do not query/re-render the complete user list.
    if (before && targetOU) {
      const oldOU = AD_DEPARTMENTS9.find(o => o.DistinguishedName && before.DistinguishedName && before.DistinguishedName.toLowerCase().endsWith(',' + o.DistinguishedName.toLowerCase()));
      const newDN = before.DistinguishedName
        ? `${before.DistinguishedName.split(/,(?=OU=)/i)[0]},${targetOU.DistinguishedName}`
        : before.DistinguishedName;
      const updated = {
        ...before,
        FullName: fullName,
        Department: targetOU.Name,
        DistinguishedName: newDN,
        PrimaryGroup: group === 'Domain Admins' ? 'Domain Admins' : (before.PrimaryGroup === 'Admin' ? 'Admin' : group),
        IsAdmin: group === 'Domain Admins' || (before.IsAdmin === true && before.PrimaryGroup === 'Admin'),
        IsInDepartments: true
      };
      if (oldOU && oldOU.DistinguishedName !== targetOU.DistinguishedName) {
        updated.IsManager = false;
        updated.ManagerOf = null;
      }
      const search = $('adUserSearch')?.value?.trim().toLowerCase() || '';
      const matchesSearch = !search || `${updated.Username} ${updated.FullName}`.toLowerCase().includes(search);
      const visibleInScope = AD_SELECTED_OU9 === '__ALL__'
        || AD_SELECTED_OU9 === targetOU.DistinguishedName
        || (AD_SELECTED_OU9 === '__ADMINS__' && updated.IsAdmin)
        || (AD_SELECTED_OU9 === '__UNKNOWN__' && !updated.IsInDepartments);
      const row = [...($('adUserList')?.querySelectorAll('[data-ad-user-row]') || [])].find(el => el.dataset.adUserRow.toLowerCase() === username.toLowerCase());
      if (visibleInScope && matchesSearch) {
        currentADUsers[beforeIndex] = updated;
        if (row) row.outerHTML = renderADUserRow9(updated);
      } else {
        currentADUsers.splice(beforeIndex, 1);
        if (row) row.remove();
      }
      if ($('adUserFooter')) {
        const scopeName = $('adSelectedOUCaption')?.textContent || 'OU đang chọn';
        $('adUserFooter').textContent = `${currentADUsers.length} user · ${scopeName}${search ? ` · Bộ lọc: ${search}` : ''}.`;
      }
      await loadADOUGroups9();
    }
  } catch (err) { toast(err.message || 'Cập nhật thất bại', 'danger'); }
  finally { if (button) { button.disabled = false; button.innerHTML = oldText || 'Lưu Thông Tin'; } }
};

if ($('adAddForm')) $('adAddForm').onsubmit = async e => {
  e.preventDefault();
  const form=$('adAddForm'), button=form.querySelector('button[type="submit"]'), oldText=button?.innerHTML;
  const username=$('mUser').value.trim();
  if(button){button.disabled=true;button.innerHTML='<span class="spinner-border spinner-border-sm me-2"></span>Đang tạo...';}
  try {
    const r=await fetch('/api/ad/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,fullname:$('mFull').value.trim(),password:$('mPass').value,department:$('mDept').value,group:$('mGroup').value})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false||d.Success===false)throw new Error(d.error||d.Error||'Không tạo được user');
    bootstrap.Modal.getOrCreateInstance($('addUserModal')).hide();form.reset();
    toast(`Đã tạo tài khoản ${username}`,'success');
    await loadAD9();
  } catch(err) { toast(err.message||'Tạo user thất bại','danger'); }
  finally { if(button){button.disabled=false;button.innerHTML=oldText||'Thêm Người Dùng';} }
};

function findADUserIndex9(username) {
  return currentADUsers.findIndex(user => String(user.Username).toLowerCase() === String(username).toLowerCase());
}
function findADUserRow9(username) {
  return [...(document.querySelectorAll('#adUserList [data-ad-user-row]') || [])]
    .find(row => String(row.dataset.adUserRow).toLowerCase() === String(username).toLowerCase()) || null;
}
function updateADUserFooter9() {
  const footer = $('adUserFooter');
  if (!footer) return;
  const search = $('adUserSearch')?.value?.trim() || '';
  const scopeName = $('adSelectedOUCaption')?.textContent || 'OU đang chọn';
  footer.textContent = `${currentADUsers.length} user · ${scopeName}${search ? ` · Bộ lọc: ${search}` : ''}.`;
}
function showEmptyADUsers9() {
  const body = $('adUserList');
  if (!body || body.querySelector('[data-ad-user-row]')) return;
  const caption = $('adSelectedOUCaption')?.textContent || 'OU đang chọn';
  const search = $('adUserSearch')?.value?.trim() || '';
  body.innerHTML = `<tr><td colspan="6" class="text-secondary">Không còn user trong “${esc(caption)}”${search ? ` khớp điều kiện tìm kiếm “${esc(search)}”` : ''}.</td></tr>`;
}

// Lock/unlock updates the current user row locally. It deliberately does not call loadAD/loadADUsers9.
async function toggleADRow9(username) {
  const index = findADUserIndex9(username);
  const user = index >= 0 ? currentADUsers[index] : null;
  const row = findADUserRow9(username);
  const button = row?.querySelector('[data-ad-user-action="toggle"]');
  if (!user) return toast(`Không tìm thấy ${username} trong danh sách hiện tại. Hãy tải lại danh sách nếu dữ liệu đã cũ.`, 'warning');
  const oldHtml = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
  try {
    const response = await fetch(`/api/ad/users/${encodeURIComponent(username)}/toggle`, { method: 'POST' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false || result.Success === false) {
      throw new Error(result.error || result.Error || `Không thể khóa/mở khóa ${username}`);
    }
    const updated = { ...user, Enabled: !Boolean(user.Enabled) };
    currentADUsers[index] = updated;
    const currentRow = findADUserRow9(username);
    if (currentRow) currentRow.outerHTML = renderADUserRow9(updated);
    updateADUserFooter9();
    toast(`${updated.Enabled ? 'Đã mở khóa/kích hoạt' : 'Đã khóa/vô hiệu hóa'} ${username}`, 'success');
  } catch (error) {
    if (button) { button.disabled = false; button.innerHTML = oldHtml || '<i class="fa-solid fa-lock"></i>'; }
    toast(error.message || `Thao tác với ${username} thất bại`, 'danger');
  }
}

// Delete removes only the requested row and cached record; it does not reload the entire user table.
async function deleteADRow9(username) {
  if (!window.confirm(`XÓA VĨNH VIỄN tài khoản [${username}] khỏi hệ thống?`)) return;
  const row = findADUserRow9(username);
  const button = row?.querySelector('[data-ad-user-action="delete"]');
  const oldHtml = button?.innerHTML;
  if (button) { button.disabled = true; button.innerHTML = '<span class="spinner-border spinner-border-sm"></span>'; }
  try {
    const response = await fetch(`/api/ad/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false || result.Success === false) {
      throw new Error(result.error || result.Error || `Không thể xóa ${username}`);
    }
    const index = findADUserIndex9(username);
    if (index >= 0) currentADUsers.splice(index, 1);
    findADUserRow9(username)?.remove();
    showEmptyADUsers9();
    updateADUserFooter9();
    toast(`Đã xóa tài khoản ${username}`, 'success');
    // Refresh only the OU's group/member panel, not the user table.
    await loadADOUGroups9();
  } catch (error) {
    if (button) { button.disabled = false; button.innerHTML = oldHtml || '<i class="fa-solid fa-trash"></i>'; }
    toast(error.message || `Xóa ${username} thất bại`, 'danger');
  }
}
window.toggleAD = toggleADRow9;
window.deleteAD = deleteADRow9;
window.loadAD = loadAD9;
document.addEventListener('click', e => {
  const u = e.target.closest('[data-ad-user-action]');
  if (u) { const name=u.dataset.user, action=u.dataset.adUserAction; if(action==='edit')openEditModal(name); else if(action==='reset')resetPass(name); else if(action==='toggle')toggleADRow9(name); else if(action==='delete')deleteADRow9(name); return; }
  const owner = e.target.closest('[data-ad-user-computers]'); if(owner) { navigateTo('computers').then(()=>openADComputersForOwner(owner.dataset.adUserComputers)); }
});

// ---------- Docker advanced operations ----------
document.body.insertAdjacentHTML('beforeend', `
<div class="modal fade" id="dkNewStackModal" tabindex="-1"><div class="modal-dialog modal-xl"><div class="modal-content"><form id="dkNewStackForm"><div class="modal-header"><h5 class="modal-title">Deploy Docker Compose Stack</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><label class="form-label">Tên stack</label><input id="dkNewStackName" class="form-control mb-3" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,55}" placeholder="royal-app"><label class="form-label">docker-compose.yml</label><textarea id="dkNewStackYaml" class="form-control font-monospace" rows="18" required spellcheck="false" placeholder="services:\n  web:\n    image: nginx:alpine\n    ports:\n      - '8088:80'\n    restart: unless-stopped"></textarea><div class="small text-secondary mt-2">Tối đa 64 KB. Bị chặn: privileged, host network/PID, devices, docker.sock và bind root. Stack mới chỉ Super-Admin triển khai.</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Hủy</button><button class="btn btn-primary">Validate & Deploy</button></div></form></div></div></div>
<div class="modal fade" id="dkNewContainerModal" tabindex="-1"><div class="modal-dialog modal-lg"><div class="modal-content"><form id="dkNewContainerForm"><div class="modal-header"><h5 class="modal-title">Run Container</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="row g-3"><div class="col-md-6"><label class="form-label">Tên container</label><input id="dkRunName" class="form-control" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{0,127}"></div><div class="col-md-6"><label class="form-label">Image</label><input id="dkRunImage" class="form-control" placeholder="nginx:alpine" required></div><div class="col-md-6"><label class="form-label">Port mapping (mỗi dòng host:container[/tcp|udp])</label><textarea id="dkRunPorts" class="form-control" rows="3" placeholder="8088:80"></textarea></div><div class="col-md-6"><label class="form-label">Environment (mỗi dòng KEY=VALUE)</label><textarea id="dkRunEnv" class="form-control" rows="3" placeholder="APP_ENV=lab"></textarea></div><div class="col-md-6"><label class="form-label">Volume (mỗi dòng volume:/path/container)</label><textarea id="dkRunVolumes" class="form-control" rows="3" placeholder="app-data:/data"></textarea></div><div class="col-md-6"><label class="form-label">Network (tùy chọn)</label><input id="dkRunNetwork" class="form-control" placeholder="bridge hoặc network riêng"><label class="form-label mt-3">Restart Policy</label><select id="dkRunRestart" class="form-select"><option>unless-stopped</option><option>always</option><option>on-failure</option><option>no</option></select></div></div><div class="alert alert-warning small mt-3 mb-0">Không hỗ trợ privileged mode hoặc host bind mounts trong form này. Chỉ Super-Admin được tạo container.</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Hủy</button><button class="btn btn-primary">Tạo Container</button></div></form></div></div></div>
<div class="modal fade" id="dkBuildModal" tabindex="-1"><div class="modal-dialog modal-lg"><div class="modal-content"><form id="dkBuildForm"><div class="modal-header"><h5 class="modal-title">Build Docker Image</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><label class="form-label">Image tag</label><input id="dkBuildTag" class="form-control mb-3" required placeholder="royal-app:1.0"><label class="form-label">Chọn Dockerfile và các file trong build context</label><input id="dkBuildFiles" class="form-control" type="file" multiple required><div id="dkBuildFileList" class="small text-secondary mt-2"></div><div class="small text-secondary mt-2">Tối đa 80 file, tổng 6 MB, mỗi file 2 MB. Giữ nguyên cấu trúc thư mục tương đối bằng việc chọn các file cần build; build context được xóa khỏi thư mục tạm sau khi hoàn tất.</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Hủy</button><button class="btn btn-warning">Build Image</button></div></form></div></div></div>
<div class="modal fade" id="dkStackEditorModal" tabindex="-1"><div class="modal-dialog modal-xl"><div class="modal-content"><form id="dkStackEditorForm"><div class="modal-header"><h5 class="modal-title" id="dkStackEditorTitle">Stack Compose</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div id="dkStackEditorPath" class="small text-secondary mb-2"></div><input id="dkStackEditName" type="hidden"><textarea id="dkStackEditorYaml" class="form-control font-monospace" rows="20" spellcheck="false"></textarea><div id="dkStackEditorNotice" class="small text-warning mt-2"></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Đóng</button><button id="dkStackSaveBtn" class="btn btn-primary">Lưu & Redeploy</button></div></form></div></div></div>
<div class="modal fade" id="dkFileModal" tabindex="-1"><div class="modal-dialog modal-xl"><div class="modal-content"><div class="modal-header"><h5 class="modal-title" id="dkFileTitle">File Browser</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="d-flex flex-wrap gap-2 mb-3"><input id="dkFilePath" class="form-control font-monospace" style="max-width:560px" value="/"><button class="btn btn-outline-info" id="dkFileBrowse">Đi tới</button><button class="btn btn-outline-secondary" id="dkFileUp">Thư mục cha</button></div><div class="row g-3"><div class="col-lg-5"><div class="table-responsive" style="max-height:55vh;overflow:auto"><table class="table table-sm"><thead><tr><th>Loại</th><th>Tên</th><th>Kích thước</th></tr></thead><tbody id="dkFileRows"></tbody></table></div></div><div class="col-lg-7"><div class="d-flex justify-content-between align-items-center mb-2"><span id="dkFileEditing" class="small text-secondary">Chọn file để đọc hoặc chỉnh sửa</span><div><button class="btn btn-sm btn-outline-secondary" id="dkFileDownload" disabled>Tải xuống</button><button class="btn btn-sm btn-primary" id="dkFileSave" disabled>Lưu file</button></div></div><textarea id="dkFileEditor" class="form-control font-monospace" rows="16" spellcheck="false" disabled></textarea><div class="small text-warning mt-2">Chỉ Super-Admin. Đọc tối đa 256 KB/file; ghi chỉ cho phép trong mount/volume có quyền ghi. Sao lưu trước khi sửa file cấu hình quan trọng.</div></div></div></div></div></div></div>`);
let DK9_FILES = {type:'container',id:'',path:'/',current:null,readOnly:false};
const modal9 = id => bootstrap.Modal.getOrCreateInstance($(id));
const fieldLines9 = s => String(s||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
function b64utf89(text){const bytes=new TextEncoder().encode(String(text||''));let bin='';for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(bin);}
function openDockerFileBrowser9(type,id,name,path='/') { DK9_FILES={type,id,path,current:null,readOnly:false}; $('dkFileTitle').textContent=`File Browser · ${name}`; $('dkFilePath').value=path; $('dkFileEditor').value=''; $('dkFileEditor').disabled=true; $('dkFileSave').disabled=true; $('dkFileDownload').disabled=true; modal9('dkFileModal').show(); browseDockerFiles9(); }
async function browseDockerFiles9(){ const x=DK9_FILES;const url=x.type==='volume'?`/api/docker/volumes/${encodeURIComponent(x.id)}/files?path=${encodeURIComponent($('dkFilePath').value||'/data')}`:`/api/docker/containers/${encodeURIComponent(x.id)}/files?path=${encodeURIComponent($('dkFilePath').value||'/')}`;const r=await fetch(url);const d=await r.json().catch(()=>({}));if(!r.ok||d.success===false){$('dkFileRows').innerHTML=`<tr><td colspan="3" class="text-danger">${esc(d.error||'Không tải được file')}</td></tr>`;return;}DK9_FILES.path=d.path;DK9_FILES.readOnly=!!d.readOnly;DK9_FILES.canWrite=!!d.canWrite;$('dkFilePath').value=d.path;$('dkFileRows').innerHTML=(d.files||[]).map(f=>`<tr><td>${f.type==='directory'?'📁':'📄'}</td><td>${f.type==='directory'?`<button class="btn btn-link btn-sm p-0" data-dkfile-dir="${esc(f.path)}">${esc(f.name)}</button>`:`<button class="btn btn-link btn-sm p-0" data-dkfile-read="${esc(f.path)}">${esc(f.name)}</button>`}</td><td>${Number(f.size||0).toLocaleString()}</td></tr>`).join('')||'<tr><td colspan="3" class="text-secondary">Thư mục trống</td></tr>';}
async function readDockerFile9(path){const x=DK9_FILES;const url=x.type==='volume'?`/api/docker/volumes/${encodeURIComponent(x.id)}/files/read`:`/api/docker/containers/${encodeURIComponent(x.id)}/files/read`;const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.success)return toast(d.error||'Không đọc được file','danger');DK9_FILES.current=path;$('dkFileEditor').value=d.content||'';$('dkFileEditing').textContent=path+(d.truncated?' (đã cắt ở 256 KB)':'');$('dkFileEditor').disabled=false;$('dkFileDownload').disabled=false;$('dkFileSave').disabled=x.type==='volume' ? false : !d.canWrite;}
$('dkBuildFiles').addEventListener('change',()=>{$('dkBuildFileList').textContent=[...$('dkBuildFiles').files].map(f=>`${f.webkitRelativePath||f.name} (${f.size} B)`).join(' · ');});
// Build-context selector: browser may select multiple files; if directories are not selected, use webkitdirectory where available.
$('dkBuildFiles').setAttribute('webkitdirectory','');
document.addEventListener('click', async e=>{
  const t=e.target.closest('[data-dk-new-stack],[data-dk-new-container],[data-dk-build],[data-dkstackdetail],[data-dkfiles],[data-dkvolfiles],[data-dkfile-dir],[data-dkfile-read]');if(!t)return;
  if(t.hasAttribute('data-dk-new-stack')){if(curUser?.role!=='Super-Admin')return toast('Chỉ Super-Admin được deploy stack','danger');$('dkNewStackName').value='';$('dkNewStackYaml').value="services:\n  web:\n    image: nginx:alpine\n    ports:\n      - '8088:80'\n    restart: unless-stopped\n";modal9('dkNewStackModal').show();}
  else if(t.hasAttribute('data-dk-new-container')){if(curUser?.role!=='Super-Admin')return toast('Chỉ Super-Admin được tạo container','danger');modal9('dkNewContainerModal').show();}
  else if(t.hasAttribute('data-dk-build')){if(curUser?.role!=='Super-Admin')return toast('Chỉ Super-Admin được build image','danger');modal9('dkBuildModal').show();}
  else if(t.dataset.dkstackdetail){const name=t.dataset.dkstackdetail;const r=await fetch(`/api/docker/stacks/${encodeURIComponent(name)}/detail`);const d=await r.json().catch(()=>({}));if(!r.ok||!d.success)return toast(d.error||'Không tải được Stack Detail','danger');$('dkStackEditorTitle').textContent=`Compose · ${name}`;$('dkStackEditorPath').textContent=d.path;$('dkStackEditName').value=name;$('dkStackEditorYaml').value=d.compose;$('dkStackEditorYaml').disabled=!d.editable;$('dkStackSaveBtn').classList.toggle('d-none',!d.editable);$('dkStackEditorNotice').textContent=d.protected?'Stack hệ thống: cần nhập chính xác tên stack trước khi lưu và redeploy.':!d.editable?'Stack đang ở ngoài thư mục quản lý nên chỉ đọc.':'Kiểm tra cấu hình trước khi Redeploy; thao tác có thể khởi động lại dịch vụ.';modal9('dkStackEditorModal').show();}
  else if(t.dataset.dkfiles){const c=DK.list.find(x=>x.id===t.dataset.dkfiles);openDockerFileBrowser9('container',t.dataset.dkfiles,c?.name||t.dataset.dkfiles,'/');}
  else if(t.dataset.dkvolfiles){const name=t.dataset.dkvolfiles;openDockerFileBrowser9('volume',name,name,'/data');}
  else if(t.dataset.dkfileDir){$('dkFilePath').value=t.dataset.dkfileDir;browseDockerFiles9();}
  else if(t.dataset.dkfileRead)readDockerFile9(t.dataset.dkfileRead);
});
$('dkFileBrowse').onclick=browseDockerFiles9;$('dkFileUp').onclick=()=>{const p=$('dkFilePath').value.replace(/\/$/,'');$('dkFilePath').value=p.slice(0,p.lastIndexOf('/'))|| (DK9_FILES.type==='volume'?'/data':'/');browseDockerFiles9();};
$('dkFileDownload').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([$('dkFileEditor').value],{type:'text/plain;charset=utf-8'}));a.download=(DK9_FILES.current||'file').split('/').pop();a.click();};
$('dkFileSave').onclick=async()=>{if(!DK9_FILES.current)return;const x=DK9_FILES;const url=x.type==='volume'?`/api/docker/volumes/${encodeURIComponent(x.id)}/files/write`:`/api/docker/containers/${encodeURIComponent(x.id)}/files/write`;if(!confirm(`Lưu thay đổi vào ${x.current}? Hãy chắc chắn đã backup file.`))return;const r=await send(url,{path:x.current,content64:b64utf89($('dkFileEditor').value)});r.success?toast('Đã lưu file'):toast(r.error||'Lưu thất bại','danger');};
$('dkNewStackForm').onsubmit=async e=>{e.preventDefault();if(!confirm('Validate và triển khai stack Compose mới?'))return;const r=await send('/api/docker/stacks/deploy',{name:$('dkNewStackName').value.trim(),compose64:b64utf89($('dkNewStackYaml').value)});if(r.success){toast(`Đã triển khai stack ${r.name}`);modal9('dkNewStackModal').hide();DK.tab='stacks';dkLoad();}else toast(r.error||'Deploy thất bại','danger');};
$('dkNewContainerForm').onsubmit=async e=>{e.preventDefault();if(!confirm('Tạo container theo cấu hình đã nhập?'))return;const env=fieldLines9($('dkRunEnv').value).map(l=>{const i=l.indexOf('=');return {key:l.slice(0,i),value:l.slice(i+1)}});const volumes=fieldLines9($('dkRunVolumes').value).map(l=>{const i=l.indexOf(':');return {name:l.slice(0,i),path:l.slice(i+1)}});const r=await send('/api/docker/containers/create',{name:$('dkRunName').value.trim(),image:$('dkRunImage').value.trim(),ports:fieldLines9($('dkRunPorts').value),env,volumes,network:$('dkRunNetwork').value.trim(),restart:$('dkRunRestart').value});if(r.success){toast(`Đã tạo container ${r.name}`);modal9('dkNewContainerModal').hide();DK.tab='containers';dkLoad();}else toast(r.error||'Tạo container thất bại','danger');};
$('dkBuildForm').onsubmit=async e=>{e.preventDefault();const list=[...$('dkBuildFiles').files];if(!list.length)return toast('Hãy chọn build context','warning');let total=0;let rels=list.map(f=>f.webkitRelativePath||f.name);const firsts=rels.map(x=>x.split('/')[0]);if(firsts.every(x=>x===firsts[0])&&rels.every(x=>x.includes('/')))rels=rels.map(x=>x.slice(firsts[0].length+1));const files=[];for(let i=0;i<list.length;i++){const f=list[i];total+=f.size;if(total>6*1024*1024)return toast('Build context vượt 6 MB','danger');const buf=await f.arrayBuffer();let bin='';new Uint8Array(buf).forEach(b=>bin+=String.fromCharCode(b));files.push({path:rels[i],content:btoa(bin)});}if(!confirm(`Build image ${$('dkBuildTag').value.trim()} từ ${files.length} file?`))return;const r=await send('/api/docker/images/build',{tag:$('dkBuildTag').value.trim(),files});if(r.success){toast('Build image hoàn tất');modal9('dkBuildModal').hide();DK.tab='images';dkLoad();}else toast(r.error||'Build thất bại','danger');};
$('dkStackEditorForm').onsubmit=async e=>{e.preventDefault();const n=$('dkStackEditName').value;if(!confirm(`Lưu Compose và redeploy stack ${n}?`))return;const body={compose64:b64utf89($('dkStackEditorYaml').value)};if(/zabbix|wazuh|portainer|single-node/i.test(n)){const typed=prompt(`Stack hệ thống. Nhập chính xác tên ${n} để tiếp tục:`);if(typed!==n)return toast('Đã hủy thao tác','warning');body.confirmName=typed;}const r=await send(`/api/docker/stacks/${encodeURIComponent(n)}/compose`,body,'PUT');if(r.success){toast('Đã lưu và redeploy '+n);modal9('dkStackEditorModal').hide();DK.tab='stacks';dkLoad();}else toast(r.error||'Không thể cập nhật stack','danger');};

const _dkLoad9 = dkLoad; dkLoad = async () => { await _dkLoad9(); const canCreate = curUser?.role === 'Super-Admin'; document.querySelectorAll('[data-dk-new-stack],[data-dk-new-container],[data-dk-build]').forEach(b => b.classList.toggle('d-none', !canCreate)); };
