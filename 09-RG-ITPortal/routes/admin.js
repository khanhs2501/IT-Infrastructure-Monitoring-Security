const express = require('express'); const router = express.Router(); const { runPS, psq } = require('./utils');
const CU = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies', FW = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsFirewall', SD = 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop';
const POLICIES = {
    DisableUSB: { label: 'Khóa ổ lưu trữ USB', s: [['HKLM\\SYSTEM\\CurrentControlSet\\Services\\USBSTOR', 'Start', 'DWord', 4]] },
    DenyRemovableWrite: { label: 'Chặn ghi dữ liệu ra ổ di động', s: [['HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\RemovableStorageDevices\\{53f5630d-b6bf-11d0-94f2-00a0c91efb8b}', 'Deny_Write', 'DWord', 1]] },
    DisableAutoRun: { label: 'Tắt AutoRun trên mọi ổ đĩa', s: [['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', 'NoDriveTypeAutoRun', 'DWord', 255]] },
    DisableControlPanel: { label: 'Khóa Control Panel & Settings', s: [[CU + '\\Explorer', 'NoControlPanel', 'DWord', 1]] },
    DisableRun: { label: 'Ẩn hộp thoại Run (Win+R)', s: [[CU + '\\Explorer', 'NoRun', 'DWord', 1]] },
    DisableCMD: { label: 'Khóa Command Prompt', s: [['HKCU\\Software\\Policies\\Microsoft\\Windows\\System', 'DisableCMD', 'DWord', 1]] },
    DisableRegedit: { label: 'Khóa Registry Editor', s: [[CU + '\\System', 'DisableRegistryTools', 'DWord', 1]] },
    DisableTaskMgr: { label: 'Khóa Task Manager', s: [[CU + '\\System', 'DisableTaskMgr', 'DWord', 1]] },
    ScreenLock: { label: 'Tự khóa màn hình sau 10 phút', s: [[SD, 'ScreenSaveActive', 'String', '1'], [SD, 'ScreenSaverIsSecure', 'String', '1'], [SD, 'ScreenSaveTimeOut', 'String', '600']] },
    LockWallpaper: { label: 'Cấm đổi hình nền', s: [[CU + '\\ActiveDesktop', 'NoChangingWallPaper', 'DWord', 1]] },
    FirewallOn: { label: 'Bật Windows Firewall (cả 3 profile)', s: ['DomainProfile', 'StandardProfile', 'PublicProfile'].map(p => [FW + '\\' + p, 'EnableFirewall', 'DWord', 1]) },
    DisableSMB1: { label: 'Tắt giao thức SMBv1', s: [['HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters', 'SMB1', 'DWord', 0]] },
    RdpNLA: { label: 'Bắt buộc NLA cho Remote Desktop', s: [['HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\Terminal Services', 'UserAuthentication', 'DWord', 1]] },
    BlockStore: { label: 'Chặn Microsoft Store', s: [['HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsStore', 'RemoveWindowsStore', 'DWord', 1]] }
};
const wrap = body => `try { ${body}; [PSCustomObject]@{ Success = $true } | ConvertTo-Json -Compress } catch { [PSCustomObject]@{ Success = $false; Error = $_.Exception.Message } | ConvertTo-Json -Compress }`;

router.get('/gpo/catalog', (req, res) => res.json(Object.entries(POLICIES).map(([key, p]) => ({ key, label: p.label }))));
router.get('/gpo', async (req, res) => res.json(await runPS(`Import-Module GroupPolicy; @(Get-GPO -All | Select-Object DisplayName, Id, @{n='GpoStatus';e={[string]$_.GpoStatus}}) | ConvertTo-Json -Compress`) || []));
router.post('/gpo', async (req, res) => {
    const { name, rules, target } = req.body; const keys = (Array.isArray(rules) ? rules : []).filter(k => POLICIES[k]);
    if (!/^[\w\-. ]{1,64}$/.test(name || '') || !keys.length) return res.json({ success: false, error: 'Tên GPO không hợp lệ hoặc chưa chọn chính sách' });
    const n = psq(name);
    const sets = keys.flatMap(k => POLICIES[k].s).map(([key, vn, t, v]) => `Set-GPRegistryValue -Name '${n}' -Key '${key}' -ValueName '${vn}' -Type ${t} -Value ${t === 'String' ? `'${v}'` : v} | Out-Null`).join('; ');
    const link = target ? `; New-GPLink -Name '${n}' -Target ${target === 'DOMAIN' ? '(Get-ADDomain).DistinguishedName' : `'${psq(target)}'`} | Out-Null` : '';
    res.json(await runPS(`Import-Module GroupPolicy; ${wrap(`New-GPO -Name '${n}' -Comment 'Tạo bởi RG-ITPortal' | Out-Null; ${sets}${link}`)}`, 60000) || { success: false, error: 'PowerShell không phản hồi' });
});
router.delete('/gpo/:id', async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.json({ success: false, error: 'GUID không hợp lệ' });
    res.json(await runPS(`Import-Module GroupPolicy; ${wrap(`Remove-GPO -Guid '${req.params.id}'`)}`) || { success: false });
});

router.get('/drives', async (req, res) => res.json(await runPS(`@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { [PSCustomObject]@{ Name = $_.DeviceID; Label = $_.VolumeName; SizeGB = [math]::Round($_.Size/1GB,1); FreeGB = [math]::Round($_.FreeSpace/1GB,1) } }) | ConvertTo-Json -Compress`) || []));
router.get('/folders', async (req, res) => {
    const p = String(req.query.path || ''); if (!/^[A-Za-z]:\\/.test(p) || /[<>"|?*]/.test(p)) return res.json([]);
    res.json(await runPS(`@(Get-ChildItem -LiteralPath '${psq(p)}' -Directory -Force -ErrorAction SilentlyContinue | Select-Object -First 300 Name, FullName) | ConvertTo-Json -Compress`) || []);
});
router.get('/smb', async (req, res) => res.json(await runPS(`@(Get-SmbShare | Where-Object { $_.Special -eq $false } | Select-Object Name, Path) | ConvertTo-Json -Compress`) || []));
router.post('/smb', async (req, res) => {
    const { name, path, sub, group, perm } = req.body; const full = sub ? String(path).replace(/\\$/, '') + '\\' + sub : path;
    if (!/^[\w\-]{1,60}$/.test(name || '') || !/^[A-Za-z]:\\/.test(full || '') || /[<>"|?*]/.test(full) || (sub && /[\\/:]/.test(sub))) return res.json({ success: false, error: 'Tên chia sẻ hoặc đường dẫn không hợp lệ' });
    const flag = { Read: '-ReadAccess', Change: '-ChangeAccess', Full: '-FullAccess' }[perm] || '-ReadAccess', g = ['Domain Users', 'IT-Helpdesk', 'Domain Admins'].includes(group) ? group : 'Domain Users';
    res.json(await runPS(wrap(`New-Item -ItemType Directory -Force -Path '${psq(full)}' | Out-Null; New-SmbShare -Name '${psq(name)}' -Path '${psq(full)}' ${flag} "$env:USERDOMAIN\\${g}" | Out-Null`)) || { success: false, error: 'PowerShell không phản hồi' });
});
router.delete('/smb/:name', async (req, res) => {
    if (!/^[\w\-]{1,60}$/.test(req.params.name)) return res.json({ success: false, error: 'Tên không hợp lệ' });
    res.json(await runPS(wrap(`Remove-SmbShare -Name '${req.params.name}' -Force`)) || { success: false });
});
module.exports = router;
