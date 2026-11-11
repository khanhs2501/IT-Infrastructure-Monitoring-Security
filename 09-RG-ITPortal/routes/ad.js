const express = require('express'); const router = express.Router(); const { runPS, psq } = require('./utils'); const permissions = require('./perm');
const wrap = body => `try { ${body}; [PSCustomObject]@{ Success = $true } | ConvertTo-Json -Compress } catch { [PSCustomObject]@{ Success = $false; Error = $_.Exception.Message } | ConvertTo-Json -Compress }`;
const GROUPS = ['Domain Users', 'IT-Helpdesk', 'Domain Admins'], SYSTEM = ['administrator', 'krbtgt', 'guest'];
const okDept = v => !v || /^[^<>"\\\/,=+;#&$`]{1,64}$/.test(v), okDeptSelection = v => /^OU=/i.test(String(v || '')) ? String(v).length <= 512 && !/[<>\u0000]/.test(String(v)) : okDept(v), okName = v => /^[\w.\-]{1,64}$/.test(v || ''), okFullName = v => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 128 && !/[\u0000-\u001f\u007f]/.test(v), okPassword = v => typeof v === 'string' && v.length >= 1 && v.length <= 256 && !v.includes('\u0000'), isSuper = req => req.session.user.role === 'Super-Admin', self = req => String(req.session.user.username).toLowerCase();
const deny = (res, error) => res.json({ success: false, error }), fail = res => ({ success: false, error: 'PowerShell không phản hồi' });
const isAdminTarget = async u => { const r = await runPS(`[PSCustomObject]@{ Admin = [bool]((Get-ADUser '${psq(u)}' -Properties MemberOf).MemberOf -match 'CN=(Domain Admins|Administrators|Enterprise Admins|Schema Admins),') } | ConvertTo-Json -Compress`); return !r || r.Admin; };

const DEPT_PARENT = process.env.DEPT_PARENT_OU || 'Departments';
const PARENT_PS = `$parentOuName = '${psq(DEPT_PARENT)}'; $par = Get-ADOrganizationalUnit -Filter { Name -eq $parentOuName } -SearchBase (Get-ADDomain).DistinguishedName -SearchScope OneLevel -ErrorAction Stop | Select-Object -First 1`;   // OU gốc chứa các phòng ban
router.get('/departments', async (req, res) => {
    const script = `Import-Module ActiveDirectory -ErrorAction Stop; ${PARENT_PS}; if(-not $par){throw 'Không tìm thấy OU gốc Departments. Kiểm tra DEPT_PARENT_OU trong .env và cấu trúc AD.'}; $rows=@(Get-ADOrganizationalUnit -Filter * -SearchBase $par.DistinguishedName -SearchScope OneLevel -ErrorAction Stop | Select-Object Name,DistinguishedName); ConvertTo-Json -InputObject @($rows) -Compress -Depth 4`;
    const result = await runPS(script, 60000);
    if (!result) return res.status(500).json({success:false,error:runPS.lastErr || 'Không tải được OU Departments. Kiểm tra quyền đọc AD và OU gốc.'});
    if (result.Success === false || result.success === false) return res.status(400).json({success:false,error:result.Error || result.error || 'Không truy vấn được Departments'});
    return res.json(Array.isArray(result) ? result : (result ? [result] : []));
});
router.post('/departments', async (req, res) => {
    const n = String(req.body?.name || '').trim();
    if (!/^[^<>"\\\/,=+;#&]{1,64}$/.test(n)) return deny(res, 'Tên phòng ban không hợp lệ');

    // Keep the same G_<OU> naming convention as routes/deleg.js.
    const slug = n.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/Đ/g, 'D')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    const gn = ('G_' + slug).slice(0, 40);
    if (gn === 'G_') return deny(res, 'Không thể tạo nhóm G_ cho tên OU này. Hãy dùng tên OU có chữ cái hoặc chữ số.');

    const script = wrap(`
        Import-Module ActiveDirectory -ErrorAction Stop
        ${PARENT_PS}
        if (-not $par) { throw 'Không tìm thấy OU gốc Departments; không tạo OU ở root để tránh sai cấu trúc.' }

        $targetOuName = '${psq(n)}'
        $existingOU = Get-ADOrganizationalUnit -Filter { Name -eq $targetOuName } -SearchBase $par.DistinguishedName -SearchScope OneLevel -ErrorAction Stop | Select-Object -First 1
        if ($existingOU) { throw "OU '${psq(n)}' đã tồn tại trong $($par.DistinguishedName)." }

        # Check name conflict before creating the OU, so a collision won't leave an empty OU behind.
        $targetGroupSam = '${psq(gn)}'
        $existingGroup = Get-ADGroup -Filter { SamAccountName -eq $targetGroupSam } -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($existingGroup) { throw "Không thể tạo OU: nhóm '${psq(gn)}' đã tồn tại tại $($existingGroup.DistinguishedName). Hãy đổi tên nhóm hoặc OU rồi thử lại." }

        $ou = New-ADOrganizationalUnit -Name '${psq(n)}' -Path $par.DistinguishedName -PassThru -ErrorAction Stop
        try {
            New-ADGroup -Name '${psq(gn)}' -SamAccountName '${psq(gn)}' -GroupScope Global -GroupCategory Security -Path $ou.DistinguishedName -Description 'Nhóm phòng ban - quản lý bởi RG-ITPortal' -ErrorAction Stop | Out-Null
        } catch {
            throw "Đã tạo OU '$($ou.Name)' nhưng tạo nhóm '${psq(gn)}' thất bại: $($_.Exception.Message)"
        }
    `);
    const result = await runPS(script, 60000);
    if (!result) return res.status(500).json({ success: false, error: runPS.lastErr || 'PowerShell không phản hồi khi tạo OU và nhóm.' });
    if (result.Success === false || result.success === false) {
        return res.status(400).json({ success: false, error: result.Error || result.error || 'Không tạo được OU và nhóm bảo mật.' });
    }
    return res.json({ success: true, groupName: gn, message: `Đã tạo OU '${n}' và nhóm bảo mật '${gn}'.` });
});

// Read-only group inventory for the selected departmental OU. Group objects are
// stored in each department OU in ADUC; show them separately from user accounts.
router.get('/ou-groups', async (req, res) => {
    const requestedOU = String(req.query.ou || '').trim();
    if (!/^OU=/i.test(requestedOU) || requestedOU.length > 512 || /[<>\u0000]/.test(requestedOU)) {
        return res.status(400).json({ success: false, error: 'Hãy chọn một OU phòng ban hợp lệ.' });
    }
    const script = `Import-Module ActiveDirectory -ErrorAction Stop; ${PARENT_PS}; if(-not $par){throw 'Không tìm thấy OU gốc Departments.'}; $dept=Get-ADOrganizationalUnit -Identity '${psq(requestedOU)}' -ErrorAction Stop; if(-not $dept.DistinguishedName.EndsWith(','+$par.DistinguishedName,[System.StringComparison]::OrdinalIgnoreCase)){throw 'OU được chọn không nằm dưới Departments.'}; $groups=@(Get-ADGroup -Filter * -SearchBase $dept.DistinguishedName -SearchScope Subtree -Properties Description,GroupScope,GroupCategory,ManagedBy -ErrorAction Stop | Sort-Object Name | ForEach-Object { $g=$_; $members=@(Get-ADGroupMember -Identity $g -Recursive -ErrorAction SilentlyContinue | Where-Object { $_.objectClass -eq 'user' } | ForEach-Object { if($_.SamAccountName){$_.SamAccountName}else{$_.Name} } | Where-Object { $_ } | Sort-Object -Unique); [PSCustomObject]@{Name=$g.Name;SamAccountName=$g.SamAccountName;DistinguishedName=$g.DistinguishedName;Description=$g.Description;Scope=[string]$g.GroupScope;Category=[string]$g.GroupCategory;MemberCount=$members.Count;Members=@($members)} }); ConvertTo-Json -InputObject @($groups) -Compress -Depth 6`;
    const result = await runPS(script, 90000);
    if (!result) return res.status(500).json({ success: false, error: runPS.lastErr || 'Không tải được group trong OU.' });
    if (result.Success === false || result.success === false) return res.status(400).json({ success: false, error: result.Error || result.error || 'Không truy vấn được group của OU.' });
    res.set('Cache-Control', 'no-store');
    return res.json(Array.isArray(result) ? result : (result ? [result] : []));
});

// User inventory supports synthetic scopes (__ALL__, __ADMINS__, __UNKNOWN__) and real OUs under Departments.
router.get('/users', async (req, res) => {
    const requestedOU = String(req.query.ou || '__ALL__').trim();
    const searchTerm = String(req.query.q || '').trim().slice(0, 80);
    const synthetic = ['__ALL__', '__ADMINS__', '__UNKNOWN__'];
    const isOUDN = /^OU=/i.test(requestedOU);
    if (!synthetic.includes(requestedOU) && (
        /[<>\u0000]/.test(requestedOU) ||
        (isOUDN ? requestedOU.length > 512 : (!okDept(requestedOU) || requestedOU.length > 64))
    )) {
        return res.status(400).json({ success:false, error:'OU hoặc bộ lọc user không hợp lệ' });
    }
    const commonProps = 'DisplayName,Enabled,MemberOf,DistinguishedName,Department,SamAccountName';
    let loadUsers = '';
    if (requestedOU === '__ADMINS__') {
        loadUsers = `
          $domainDN=(Get-ADDomain).DistinguishedName
          $adminGroupNames=@('Domain Admins','Enterprise Admins','Schema Admins','Administrators','Account Operators','Backup Operators','Server Operators','Print Operators','DNSAdmins','Group Policy Creator Owners')
          $adminDNs=@()
          foreach($groupName in $adminGroupNames) {
            try { $group=Get-ADGroup -Identity $groupName -ErrorAction Stop; $adminDNs += @(Get-ADGroupMember -Identity $group -Recursive -ErrorAction SilentlyContinue | Where-Object { $_.objectClass -eq 'user' } | ForEach-Object { $_.DistinguishedName }) } catch {}
          }
          $adminDNs=@($adminDNs | Where-Object { $_ } | Sort-Object -Unique)
          $adUsers=@(foreach($dn in $adminDNs) { Get-ADUser -Identity $dn -Properties @(${commonProps.split(',').map(s=>`'${s}'`).join(',')} ) -ErrorAction SilentlyContinue })
          $adminDNs=@($adUsers | ForEach-Object { $_.DistinguishedName })
        `;
    } else if (requestedOU === '__UNKNOWN__') {
        loadUsers = `
          $domainDN=(Get-ADDomain).DistinguishedName
          $adUsers=@(Get-ADUser -Filter * -SearchBase $domainDN -SearchScope Subtree -Properties @(${commonProps.split(',').map(s=>`'${s}'`).join(',')} ) -ErrorAction Stop | Where-Object { $_.DistinguishedName -notmatch '(?i)(^|,)OU=' })
          $adminGroupNames=@('Domain Admins','Enterprise Admins','Schema Admins','Administrators','Account Operators','Backup Operators','Server Operators','Print Operators','DNSAdmins','Group Policy Creator Owners')
          $adminDNs=@()
          foreach($groupName in $adminGroupNames) { try { $group=Get-ADGroup -Identity $groupName -ErrorAction Stop; $adminDNs += @(Get-ADGroupMember -Identity $group -Recursive -ErrorAction SilentlyContinue | Where-Object { $_.objectClass -eq 'user' } | ForEach-Object { $_.DistinguishedName }) } catch {} }
          $adminDNs=@($adminDNs | Where-Object { $_ } | Sort-Object -Unique)
        `;
    } else if (requestedOU === '__ALL__') {
        loadUsers = `
          $domainDN=(Get-ADDomain).DistinguishedName
          $adUsers=@(Get-ADUser -Filter * -SearchBase $domainDN -SearchScope Subtree -Properties @(${commonProps.split(',').map(s=>`'${s}'`).join(',')} ) -ErrorAction Stop)
          $adminGroupNames=@('Domain Admins','Enterprise Admins','Schema Admins','Administrators','Account Operators','Backup Operators','Server Operators','Print Operators','DNSAdmins','Group Policy Creator Owners')
          $adminDNs=@()
          foreach($groupName in $adminGroupNames) {
            try { $group=Get-ADGroup -Identity $groupName -ErrorAction Stop; $adminDNs += @(Get-ADGroupMember -Identity $group -Recursive -ErrorAction SilentlyContinue | Where-Object { $_.objectClass -eq 'user' } | ForEach-Object { $_.DistinguishedName }) } catch {}
          }
          $adminDNs=@($adminDNs | Where-Object { $_ } | Sort-Object -Unique)
        `;
    } else {
        // Modern UI sends the exact OU distinguishedName to avoid duplicate OU-name ambiguity.
        // Legacy clients may still send the OU's short name; keep that form temporarily supported.
        const resolveOU = isOUDN
          ? `$dept=Get-ADOrganizationalUnit -Identity '${psq(requestedOU)}' -ErrorAction Stop;`
          : `$dept=Get-ADOrganizationalUnit -LDAPFilter '(ou=${psq(requestedOU)})' -SearchBase $par.DistinguishedName -SearchScope OneLevel -ErrorAction Stop | Select-Object -First 1;`;
        loadUsers = `
          ${PARENT_PS}
          if(-not $par) { throw 'Không tìm thấy OU gốc Departments. Kiểm tra DEPT_PARENT_OU và domain đang được Portal truy vấn.' }
          ${resolveOU}
          if(-not $dept) { throw 'Không tìm thấy OU phòng ban được chọn.' }
          if(-not $dept.DistinguishedName.EndsWith(','+$par.DistinguishedName,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'OU được chọn không nằm dưới OU gốc Departments.' }
          $domainDN=(Get-ADDomain).DistinguishedName
          $adUsers=@(Get-ADUser -Filter * -SearchBase $dept.DistinguishedName -SearchScope Subtree -Properties @(${commonProps.split(',').map(s=>`'${s}'`).join(',')} ) -ErrorAction Stop)
          $adminDNs=@()
          $adminGroupNames=@('Domain Admins','Enterprise Admins','Schema Admins','Administrators','Account Operators','Backup Operators','Server Operators','Print Operators','DNSAdmins','Group Policy Creator Owners')
          foreach($groupName in $adminGroupNames) { try { $group=Get-ADGroup -Identity $groupName -ErrorAction Stop; $adminDNs += @(Get-ADGroupMember -Identity $group -Recursive -ErrorAction SilentlyContinue | Where-Object { $_.objectClass -eq 'user' } | ForEach-Object { $_.DistinguishedName }) } catch {} }
          $adminDNs=@($adminDNs | Where-Object { $_ } | Sort-Object -Unique)
        `;
    }
    const filter = searchTerm ? ` | Where-Object { $_.SamAccountName -like '*${psq(searchTerm)}*' -or $_.DisplayName -like '*${psq(searchTerm)}*' -or $_.Name -like '*${psq(searchTerm)}*' }` : '';
    const script = `Import-Module ActiveDirectory -ErrorAction Stop; ${loadUsers}; $deptRootDN=$null; try { ${PARENT_PS}; if($par){$deptRootDN=$par.DistinguishedName} } catch {}; $managerOUs=@(); if($deptRootDN){ try { $managerOUs=@(Get-ADOrganizationalUnit -Filter * -SearchBase $deptRootDN -SearchScope Subtree -Properties ManagedBy -ErrorAction Stop | Where-Object { $_.ManagedBy }) } catch {} }; $filtered=@($adUsers${filter}); $rows=@(foreach($u in $filtered) { $parts=@($u.DistinguishedName -split '(?<!\\\\),'); $ouNames=@($parts | Where-Object { $_ -like 'OU=*' } | ForEach-Object { $_ -replace '^OU=','' }); $ouName=if($ouNames.Count -gt 0){$ouNames[0]}else{'Chưa xác định OU'}; $isAdmin=($adminDNs -contains $u.DistinguishedName); $inDepartments=[bool]($deptRootDN -and $u.DistinguishedName.EndsWith(','+$deptRootDN,[System.StringComparison]::OrdinalIgnoreCase)); $managedOU=$managerOUs | Where-Object { $_.ManagedBy -eq $u.DistinguishedName } | Select-Object -First 1; $isManager=[bool]$managedOU; $managerOf=if($managedOU){$managedOU.Name}else{$null}; $m=($u.MemberOf -join ';'); $primary=if($isAdmin){'Admin'}elseif($m -match 'CN=Domain Admins,'){'Domain Admins'}elseif($m -match 'CN=IT-Helpdesk,'){'IT-Helpdesk'}else{'Domain Users'}; [PSCustomObject]@{ Username=$u.SamAccountName; FullName=$(if($u.DisplayName){$u.DisplayName}else{$u.Name}); Department=$ouName; DistinguishedName=$u.DistinguishedName; Enabled=[bool]$u.Enabled; IsAdmin=[bool]$isAdmin; IsManager=$isManager; ManagerOf=$managerOf; IsInDepartments=$inDepartments; PrimaryGroup=$primary } }); ConvertTo-Json -InputObject @($rows) -Compress -Depth 5`;
    const result = await runPS(script, 90000);
    if (!result) return res.status(500).json({success:false,error:runPS.lastErr || 'Không tải được user từ Active Directory. Kiểm tra tài khoản chạy Portal, RSAT/ActiveDirectory module và kết nối Domain Controller.'});
    if (result.Success === false || result.success === false) return res.status(400).json({success:false,error:result.Error || result.error || 'Không truy vấn được danh sách user'});
    res.json(Array.isArray(result) ? result : (result ? [result] : []));
});

// Read-only diagnostics for empty OU user lists. Exposes counts and execution identity, never credentials.
router.get('/user-diagnostics', async (req, res) => {
  const script = `Import-Module ActiveDirectory -ErrorAction Stop; $d=Get-ADDomain -ErrorAction Stop; $parentOuName='${psq(DEPT_PARENT)}'; $par=Get-ADOrganizationalUnit -Filter { Name -eq $parentOuName } -SearchBase $d.DistinguishedName -SearchScope OneLevel -ErrorAction Stop | Select-Object -First 1; $ous=@(); if($par){$ous=@(Get-ADOrganizationalUnit -Filter * -SearchBase $par.DistinguishedName -SearchScope OneLevel -ErrorAction Stop | Sort-Object Name | ForEach-Object { $ouItem=$_; [PSCustomObject]@{Name=$ouItem.Name;DistinguishedName=$ouItem.DistinguishedName;UserCount=@(Get-ADUser -Filter * -SearchBase $ouItem.DistinguishedName -SearchScope Subtree -ErrorAction Stop).Count} })}; [PSCustomObject]@{success=$true;domain=$d.DNSRoot;domainDN=$d.DistinguishedName;domainController=(Get-ADDomainController -Discover -ErrorAction SilentlyContinue).HostName;windowsIdentity=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;activeDirectoryModuleAvailable=[bool](Get-Module -ListAvailable ActiveDirectory);departmentRootFound=[bool]$par;departmentRootDN=if($par){$par.DistinguishedName}else{$null};departmentOUs=@($ous);totalDomainUsers=@(Get-ADUser -Filter * -SearchBase $d.DistinguishedName -SearchScope Subtree -ErrorAction Stop).Count} | ConvertTo-Json -Compress -Depth 6`;
  const result=await runPS(script,90000);
  if(!result) return res.status(500).json({success:false,error:runPS.lastErr||'Không chạy được User diagnostics. Kiểm tra PowerShell/RSAT và quyền đọc AD.'});
  if(result.Success===false||result.success===false) return res.status(400).json({success:false,error:result.Error||result.error||'User diagnostics thất bại'});
  res.set('Cache-Control','no-store');
  return res.json(result);
});

// Computer Management: inventory and controlled actions for workstation OUs only.
const computerNameOk = v => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}\$?$/.test(String(v || ''));
const allowedComputerOUs = (process.env.COMPUTER_MANAGED_OUS || 'Client_Computers,IT,Sales,HR,Quarantine')
  .split(',').map(v => v.trim()).filter(Boolean);
const protectedComputers = new Set((process.env.COMPUTER_PROTECTED_NAMES || 'ROYAL01,LINUX01').split(',').map(v => v.trim().toUpperCase()).filter(Boolean));
const psArray = values => '@(' + values.map(v => "'" + psq(v) + "'").join(',') + ')';
const computerLookup = name => `
  $computer = Get-ADComputer -Identity '${psq(String(name).replace(/\$$/, ''))}' -Properties DistinguishedName,DNSHostName,Enabled,OperatingSystem,OperatingSystemVersion,LastLogonDate,IPv4Address,ManagedBy -ErrorAction Stop
  if ($computer.Name.ToUpperInvariant() -in ${psArray([...protectedComputers])}) { throw 'Thao tác bị chặn đối với server được bảo vệ.' }
  $dnParts = @($computer.DistinguishedName -split '(?<!\\\\),')
  $firstOU = ($dnParts | Where-Object { $_ -like 'OU=*' } | Select-Object -First 1) -replace '^OU=', ''
  $allowedOUs = ${psArray(allowedComputerOUs)}
  if ($firstOU -eq 'Domain Controllers') { throw 'Không cho phép thao tác với Domain Controllers.' }
  if ($allowedOUs -notcontains $firstOU) { throw 'Computer phải nằm trực tiếp trong một OU máy trạm được phép quản lý.' }
`;
const psReply = extra => `${extra}\n[PSCustomObject]@{ success = $true } | ConvertTo-Json -Compress`;
const sendPS = async (res, script, timeout=60000) => {
  const result = await runPS(script, timeout);
  if (!result) return res.status(500).json({ success:false, error: runPS.lastErr || 'PowerShell không phản hồi hoặc thao tác thất bại' });
  if (result.Success === false || result.success === false) return res.status(400).json({ success:false, error: result.Error || result.error || 'Thao tác không thành công' });
  return res.json(result);
};
const needSuper = (req, res) => { if (!isSuper(req)) { res.status(403).json({success:false,error:'Chỉ Super-Admin được thực hiện thao tác này'}); return false; } return true; };
const readComputerName = (req, res) => { const n=String(req.params.name||'').replace(/\$$/,''); if(!computerNameOk(n)) { res.status(400).json({success:false,error:'Tên computer không hợp lệ'}); return null; } return n; };

router.get('/computer-ous', async (req, res) => {
  const script = `Import-Module ActiveDirectory -ErrorAction Stop; $domain=(Get-ADDomain).DistinguishedName; $allowed=${psArray(allowedComputerOUs)}; $rows=@(Get-ADOrganizationalUnit -Filter * -SearchBase $domain -SearchScope Subtree -ErrorAction Stop | Where-Object { $_.Name -ne 'Domain Controllers' } | ForEach-Object { [PSCustomObject]@{Name=$_.Name;DistinguishedName=$_.DistinguishedName;AllowedTarget=($allowed -contains $_.Name)} } | Sort-Object DistinguishedName); ConvertTo-Json -InputObject @($rows) -Compress -Depth 4`;
  const result = await runPS(script, 60000);
  if (!result) return res.status(500).json({success:false,error:runPS.lastErr||'Không lấy được OU từ AD. Kiểm tra tài khoản chạy Portal, RSAT/ActiveDirectory module và quyền đọc AD.'});
  if (result.Success === false || result.success === false) return res.status(400).json({success:false,error:result.Error||result.error||'Không lấy được danh sách OU'});
  res.json(Array.isArray(result) ? result : (result ? [result] : []));
});

// Diagnose whether the expected OU exists and whether it contains computer objects.
router.get('/computer-diagnostics', async (req, res) => {
  const script = `Import-Module ActiveDirectory -ErrorAction Stop; $d=Get-ADDomain -ErrorAction Stop; $ou=Get-ADOrganizationalUnit -Filter "Name -eq 'Client_Computers'" -SearchBase $d.DistinguishedName -SearchScope OneLevel -ErrorAction SilentlyContinue | Select-Object -First 1; $count=0; if($ou){$count=@(Get-ADComputer -SearchBase $ou.DistinguishedName -SearchScope Subtree -Filter * -ErrorAction Stop).Count}; $dc=$null; try{$dc=(Get-ADDomainController -Discover -ErrorAction Stop).HostName}catch{}; [PSCustomObject]@{success=$true;domain=$d.DNSRoot;domainDN=$d.DistinguishedName;domainController=$dc;portalExecutionUser=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;activeDirectoryModule=[bool](Get-Module -ListAvailable ActiveDirectory);clientComputersOUFound=[bool]$ou;clientComputersOUDN=if($ou){$ou.DistinguishedName}else{$null};computerCount=$count} | ConvertTo-Json -Compress -Depth 4`;
  const result = await runPS(script, 60000);
  if (!result) return res.status(500).json({success:false,error:runPS.lastErr || 'Không truy vấn được AD diagnostics. Kiểm tra RSAT, domain connectivity và Windows identity chạy Portal.'});
  if (result.Success === false || result.success === false) return res.status(400).json({success:false,error:result.Error || result.error || 'AD diagnostics thất bại'});
  res.json(result);
});

// Inventory: Client_Computers is a root-level OU next to Departments in the current domain.
// Accept the OU name, its distinguished name, or __ALL__ for diagnosis/discovery.
router.get('/computers', async (req, res) => {
  const ou = String(req.query.ou || 'Client_Computers').trim();
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit || '25', 10) || 25));
  const ownerName = String(req.query.owner || '').trim();
  if (ownerName && !okName(ownerName)) return res.status(400).json({success:false,error:'Owner username không hợp lệ'});
  const offset = Math.max(0, Number.parseInt(req.query.offset || '0', 10) || 0);
  if (!ou || ou.length > 512 || /[<>\u0000]/.test(ou)) return res.status(400).json({success:false,error:'OU không hợp lệ'});
  let searchBase = '$domainDN', ouResolve = '$domainDN=(Get-ADDomain).DistinguishedName; $searchBase=$domainDN;';
  if (ou !== '__ALL__') {
    if (/^OU=/i.test(ou)) {
      ouResolve += `$targetOU=Get-ADOrganizationalUnit -Identity '${psq(ou)}' -ErrorAction Stop; if(-not $targetOU){throw 'Không tìm thấy OU có Distinguished Name đã chọn.'}; $searchBase=$targetOU.DistinguishedName;`;
    } else {
      ouResolve += `$targetComputerOuName='${psq(ou)}'; $targetOU=Get-ADOrganizationalUnit -Filter { Name -eq $targetComputerOuName } -SearchBase $domainDN -SearchScope OneLevel -ErrorAction Stop | Select-Object -First 1; if(-not $targetOU){throw 'Không tìm thấy OU đích ở cấp domain. Xác nhận OU được cấu hình và thử lại.'}; $searchBase=$targetOU.DistinguishedName;`;
    }
  }
  const ownerFilter = ownerName ? `$ownerFilter=Get-ADUser -Identity '${psq(ownerName)}' -Properties DistinguishedName -ErrorAction Stop; ` : '';
  const ownerWhere = ownerName ? ` | Where-Object { $_.ManagedBy -eq $ownerFilter.DistinguishedName }` : '';
  const script = `Import-Module ActiveDirectory -ErrorAction Stop; ${ouResolve} $domain=(Get-ADDomain).DNSRoot; ${ownerFilter}$allComputers=@(Get-ADComputer -SearchBase $searchBase -SearchScope Subtree -Filter * -Properties @('Enabled','OperatingSystem','OperatingSystemVersion','LastLogonDate','DNSHostName','ManagedBy','DistinguishedName') -ErrorAction Stop${ownerWhere} | Sort-Object Name); $total=$allComputers.Count; $computers=@($allComputers | Select-Object -Skip ${offset} -First ${limit}); $rows=@(foreach($c in $computers) { $owner=$null; if($c.ManagedBy) { $owner=Get-ADUser -Identity $c.ManagedBy -Properties DisplayName,SamAccountName -ErrorAction SilentlyContinue }; $parts=@($c.DistinguishedName -split '(?<!\\\\),'); $ouName=($parts | Where-Object { $_ -like 'OU=*' } | Select-Object -First 1) -replace '^OU=', ''; $target=$c.DNSHostName; if(-not $target) { $target=$c.Name+'.'+$domain }; $ipv4=$null; try { $dnsResult=Resolve-DnsName -Name $target -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -First 1; if($dnsResult){$ipv4=$dnsResult.IPAddress} } catch {}; $online=$false; try { $ping=New-Object System.Net.NetworkInformation.Ping; $reply=$ping.Send($target,400); $online=($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success); $ping.Dispose() } catch { $online=$false }; [PSCustomObject]@{ Name=$c.Name; Enabled=[bool]$c.Enabled; OperatingSystem=$c.OperatingSystem; OperatingSystemVersion=$c.OperatingSystemVersion; LastLogonDate=if($c.LastLogonDate){$c.LastLogonDate.ToString('o')}else{$null}; IPv4Address=$ipv4; DNSHostName=$c.DNSHostName; DistinguishedName=$c.DistinguishedName; OU=$ouName; Online=$online; ManagedBy=$c.ManagedBy; OwnerName=if($owner){if($owner.DisplayName){$owner.DisplayName}else{$owner.SamAccountName}}else{$null}; OwnerUsername=if($owner){$owner.SamAccountName}else{$null} } }); [PSCustomObject]@{Items=@($rows);Total=$total;Limit=${limit};Offset=${offset};Domain=(Get-ADDomain).DNSRoot;SearchOU='${psq(ou)}'} | ConvertTo-Json -Compress -Depth 6`;
  const result = await runPS(script, 90000);
  if (!result) return res.status(500).json({success:false,error:runPS.lastErr || 'Không truy vấn được computer objects. Kiểm tra tài khoản chạy Portal có quyền đọc AD, RSAT ActiveDirectory module và OU Client_Computers.'});
  if (result.Success === false || result.success === false) return res.status(400).json({success:false,error:result.Error || result.error || 'Không tải được computers'});
  if (!Object.prototype.hasOwnProperty.call(result, 'Items')) return res.status(500).json({success:false,error:'AD trả về dữ liệu không đúng định dạng (thiếu Items). Hãy xem log Portal.'});
  res.json({ items: Array.isArray(result.Items) ? result.Items : (result.Items ? [result.Items] : []), total: Number(result.Total||0), limit: Number(result.Limit||limit), offset: Number(result.Offset||offset), domain: result.Domain || null, searchOU: result.SearchOU || ou });
});

router.post('/computers/:name/move', async (req,res) => {
  const name=readComputerName(req,res); if(!name)return;
  const targetDN=String(req.body.targetDN||'').trim();
  if(!targetDN || targetDN.length>512 || !/^OU=/i.test(targetDN) || /[<>\u0000]/.test(targetDN)) return res.status(400).json({success:false,error:'Phải chọn OU đích hợp lệ'});
  const script=`Import-Module ActiveDirectory; ${computerLookup(name)}; $target=Get-ADOrganizationalUnit -Identity '${psq(targetDN)}' -ErrorAction Stop; if($target.Name -eq 'Domain Controllers') { throw 'Không được chuyển computer vào Domain Controllers' }; if($target.Name -notin ${psArray(allowedComputerOUs)}) { throw 'OU đích không nằm trong danh sách OU được phép quản lý' }; Move-ADObject -Identity $computer.DistinguishedName -TargetPath $target.DistinguishedName -Confirm:$false -ErrorAction Stop; [PSCustomObject]@{success=$true;computer=$computer.Name;targetOU=$target.Name;message='Đã chuyển computer sang OU đích'} | ConvertTo-Json -Compress`;
  return sendPS(res,script);
});

router.post('/computers/:name/owner', async (req,res) => {
  const name=readComputerName(req,res); if(!name)return;
  const username=String(req.body.username||'').trim();
  if(username && !okName(username)) return res.status(400).json({success:false,error:'Username không hợp lệ'});
  const ownerScript = username ? `$owner=Get-ADUser -Identity '${psq(username)}' -ErrorAction Stop; Set-ADComputer -Identity $computer -ManagedBy $owner.DistinguishedName -ErrorAction Stop; $ownerName=$owner.SamAccountName` : `Set-ADComputer -Identity $computer -Clear ManagedBy -ErrorAction Stop; $ownerName=$null`;
  return sendPS(res,`Import-Module ActiveDirectory; ${computerLookup(name)}; ${ownerScript}; [PSCustomObject]@{success=$true;computer=$computer.Name;owner=$ownerName} | ConvertTo-Json -Compress`);
});

router.post('/computers/:name/toggle', async (req,res) => {
  const name=readComputerName(req,res); if(!name)return;
  const enabled=req.body.enabled === true || req.body.enabled === 'true';
  return sendPS(res,`Import-Module ActiveDirectory; ${computerLookup(name)}; if(${enabled ? '$true' : '$false'}) { Enable-ADAccount -Identity $computer -ErrorAction Stop } else { Disable-ADAccount -Identity $computer -ErrorAction Stop }; [PSCustomObject]@{success=$true;computer=$computer.Name;enabled=${enabled ? '$true' : '$false'}} | ConvertTo-Json -Compress`);
});

router.delete('/computers/:name', async (req,res) => {
  if(!needSuper(req,res))return;
  const name=readComputerName(req,res); if(!name)return;
  if(String(req.body.confirmName||'') !== name) return res.status(400).json({success:false,error:'Để xóa, hãy nhập chính xác tên computer vào confirmName'});
  return sendPS(res,`Import-Module ActiveDirectory; ${computerLookup(name)}; Remove-ADComputer -Identity $computer -Confirm:$false -ErrorAction Stop; [PSCustomObject]@{success=$true;computer='${psq(name)}';message='Đã xóa computer object khỏi AD'} | ConvertTo-Json -Compress`);
});

router.post('/computers/:name/gpupdate', async (req,res) => {
  const name=readComputerName(req,res); if(!name)return;
  const script=`Import-Module ActiveDirectory -ErrorAction Stop; try { Import-Module GroupPolicy -ErrorAction Stop } catch { throw 'Không nạp được GroupPolicy/Invoke-GPUpdate trên máy Portal. Cài RSAT Group Policy Management rồi khởi động lại Portal.' }; if(-not(Get-Command Invoke-GPUpdate -ErrorAction SilentlyContinue)){throw 'Máy Portal thiếu lệnh Invoke-GPUpdate. Cài RSAT Group Policy Management rồi khởi động lại Portal.'}; ${computerLookup(name)}; $target=$computer.DNSHostName; if(-not $target){$target=$computer.Name+'.'+(Get-ADDomain).DNSRoot}; Invoke-GPUpdate -Computer $target -Force -RandomDelayInMinutes 0 -ErrorAction Stop; [PSCustomObject]@{success=$true;computer=$computer.Name;message='Đã lên lịch làm mới Group Policy từ xa'} | ConvertTo-Json -Compress`;
  return sendPS(res,script,90000);
});

router.post('/computers/:name/repair-trust', async (req,res) => {
  if(!needSuper(req,res))return;
  const name=readComputerName(req,res); if(!name)return;
  const script=`Import-Module ActiveDirectory; ${computerLookup(name)}; $target=$computer.DNSHostName; if(-not $target){$target=$computer.Name+'.'+(Get-ADDomain).DNSRoot}; $dc=(Get-ADDomainController -Discover -ErrorAction Stop).HostName; $result=Invoke-Command -ComputerName $target -ArgumentList $dc -ErrorAction Stop -ScriptBlock { param($domainController); $before=Test-ComputerSecureChannel -ErrorAction SilentlyContinue; if(-not $before){ Reset-ComputerMachinePassword -Server $domainController -ErrorAction Stop }; $after=Test-ComputerSecureChannel -ErrorAction Stop; [PSCustomObject]@{Before=[bool]$before;After=[bool]$after} }; [PSCustomObject]@{success=[bool]$result.After;computer=$computer.Name;before=$result.Before;after=$result.After;message=if($result.After){'Secure channel đã hợp lệ'}else{'Chưa khôi phục được secure channel'}} | ConvertTo-Json -Compress`;
  return sendPS(res,script,90000);
});

router.post('/computers/:name/restart', async (req,res) => {
  if(!needSuper(req,res))return;
  const name=readComputerName(req,res); if(!name)return;
  const confirm=String(req.body.confirmName||''); if(confirm!==name)return res.status(400).json({success:false,error:'Nhập chính xác tên computer để xác nhận khởi động lại'});
  return sendPS(res,`Import-Module ActiveDirectory; ${computerLookup(name)}; $target=$computer.DNSHostName; if(-not $target){$target=$computer.Name+'.'+(Get-ADDomain).DNSRoot}; Invoke-Command -ComputerName $target -ErrorAction Stop -ScriptBlock { shutdown.exe /r /t 10 /f /c 'Restart initiated by authorized ROYAL IT Portal administrator' }; [PSCustomObject]@{success=$true;computer=$computer.Name;message='Đã gửi yêu cầu restart; máy sẽ khởi động lại sau 10 giây'} | ConvertTo-Json -Compress`,90000);
});

router.post('/computers/:name/shutdown', async (req,res) => {
  if(!needSuper(req,res))return;
  const name=readComputerName(req,res); if(!name)return;
  const confirm=String(req.body.confirmName||''); if(confirm!==name)return res.status(400).json({success:false,error:'Nhập chính xác tên computer để xác nhận shutdown'});
  return sendPS(res,`Import-Module ActiveDirectory; ${computerLookup(name)}; $target=$computer.DNSHostName; if(-not $target){$target=$computer.Name+'.'+(Get-ADDomain).DNSRoot}; Invoke-Command -ComputerName $target -ErrorAction Stop -ScriptBlock { shutdown.exe /s /t 10 /f /c 'Shutdown initiated by authorized ROYAL IT Portal administrator' }; [PSCustomObject]@{success=$true;computer=$computer.Name;message='Đã gửi yêu cầu shutdown; máy sẽ tắt sau 10 giây'} | ConvertTo-Json -Compress`,90000);
});

router.get('/computers/:name/laps-password', async (req,res) => {
  if(!permissions.can(req.session.user, 'laps', 'view')) return res.status(403).json({success:false,error:'Bạn chưa được cấp quyền đọc mật khẩu LAPS'});
  const name=readComputerName(req,res); if(!name)return;
  res.set('Cache-Control','no-store, no-cache, must-revalidate, private');
  const script=`Import-Module ActiveDirectory; ${computerLookup(name)}; $password=$null; $account=$null; $updated=$null; if(Get-Command Get-LapsADPassword -ErrorAction SilentlyContinue){ $laps=Get-LapsADPassword -Identity $computer.Name -AsPlainText -ErrorAction Stop; $password=$laps.Password; $account=$laps.Account; $updated=$laps.PasswordUpdateTime } else { $old=Get-ADComputer -Identity $computer -Properties 'ms-Mcs-AdmPwd','ms-Mcs-AdmPwdExpirationTime' -ErrorAction Stop; $password=$old.'ms-Mcs-AdmPwd'; $account='Administrator'; if($old.'ms-Mcs-AdmPwdExpirationTime'){$updated=[DateTime]::FromFileTime([Int64]$old.'ms-Mcs-AdmPwdExpirationTime').ToString('o')} }; if(-not $password){throw 'Không có mật khẩu LAPS hoặc tài khoản Portal không được phép đọc. Hãy kiểm tra chính sách LAPS và quyền đọc AD.'}; [PSCustomObject]@{success=$true;computer=$computer.Name;account=$account;password=$password;updated=$updated;warning='Mật khẩu nhạy cảm: chỉ hiển thị cho phiên quản trị hiện tại.'} | ConvertTo-Json -Compress`;
  const result=await runPS(script,60000);
  if(!result)return res.status(500).json({success:false,error:runPS.lastErr||'Không đọc được mật khẩu LAPS'});
  if(result.Success===false||result.success===false)return res.status(400).json({success:false,error:result.Error||result.error||'Không đọc được mật khẩu LAPS'});
  res.json(result);
});

router.post('/users', async (req, res) => {
    const { username, fullname, password, department, group } = req.body, g = GROUPS.includes(group) ? group : 'Domain Users';
    const cleanFullName = typeof fullname === 'string' ? fullname.trim() : '';
    if (!okName(username) || !okFullName(cleanFullName) || !okPassword(password)) return res.status(400).json({ success: false, error: 'Tài khoản, họ tên (tối đa 128 ký tự) hoặc mật khẩu (tối đa 256 ký tự) không hợp lệ.' });
    if (!okDeptSelection(department)) return deny(res, 'Phòng ban/OU không hợp lệ');
    if (g === 'Domain Admins' && !isSuper(req)) return deny(res, 'Chỉ Super-Admin được tạo tài khoản Domain Admins');
    const departmentResolve = /^OU=/i.test(String(department || ''))
      ? `$ou=Get-ADOrganizationalUnit -Identity '${psq(department)}' -ErrorAction Stop;`
      : `$departmentName = '${psq(department)}'; $ou=Get-ADOrganizationalUnit -Filter { Name -eq $departmentName } -SearchBase $par.DistinguishedName -SearchScope OneLevel -ErrorAction Stop | Select-Object -First 1;`;
    res.json(await runPS(wrap(`${PARENT_PS}
        if (-not $par) { throw 'Không tìm thấy OU gốc Departments' }
        ${departmentResolve}
        if (-not $ou) { throw 'Không tìm thấy OU phòng ban bên trong Departments' }
        if (-not $ou.DistinguishedName.EndsWith(','+$par.DistinguishedName,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'OU đích không nằm dưới OU gốc Departments' }
        $p = @{ Name = '${psq(cleanFullName)}'; DisplayName = '${psq(cleanFullName)}'; SamAccountName = '${psq(username)}'; AccountPassword = (ConvertTo-SecureString '${psq(password)}' -AsPlainText -Force); Enabled = $true; Department = $ou.Name; Path = $ou.DistinguishedName }
        New-ADUser @p -ErrorAction Stop
        if ('${g}' -ne 'Domain Users') { Add-ADGroupMember -Identity '${g}' -Members '${psq(username)}' -ErrorAction Stop }`)) || fail());
});

router.put('/users/:u', async (req, res) => {
    const u = req.params.u, { fullname, department, group } = req.body, g = GROUPS.includes(group) ? group : 'Domain Users';
    const cleanFullName = typeof fullname === 'string' ? fullname.trim() : '';
    if (!okName(u) || !okFullName(cleanFullName)) return res.status(400).json({ success: false, error: 'Họ tên không hợp lệ (từ 1 đến 128 ký tự).'});
    if (!okDeptSelection(department)) return deny(res, 'Phòng ban/OU không hợp lệ');
    if (!isSuper(req) && (g === 'Domain Admins' || await isAdminTarget(u))) return deny(res, 'Chỉ Super-Admin được thay đổi tài khoản hoặc nhóm quản trị');
    if (u.toLowerCase() === self(req) && g !== 'Domain Admins') return deny(res, 'Không thể tự hạ quyền của chính mình');
    const departmentResolve = /^OU=/i.test(String(department || ''))
      ? `$ou=Get-ADOrganizationalUnit -Identity '${psq(department)}' -ErrorAction Stop;`
      : `$departmentName = '${psq(department)}'; $ou=Get-ADOrganizationalUnit -Filter { Name -eq $departmentName } -SearchBase $par.DistinguishedName -SearchScope OneLevel -ErrorAction Stop | Select-Object -First 1;`;
    res.json(await runPS(wrap(`${PARENT_PS}
        if (-not $par) { throw 'Không tìm thấy OU gốc Departments' }
        ${departmentResolve}
        if (-not $ou) { throw 'Không tìm thấy OU phòng ban bên trong Departments' }
        if (-not $ou.DistinguishedName.EndsWith(','+$par.DistinguishedName,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'OU đích không nằm dưới OU gốc Departments' }
        $usr = Get-ADUser '${psq(u)}' -Properties DistinguishedName -ErrorAction Stop
        Set-ADUser -Identity $usr -DisplayName '${psq(cleanFullName)}' -Department $ou.Name -ErrorAction Stop
        if (($usr.DistinguishedName -split '(?<!\\\\),', 2)[1] -ne $ou.DistinguishedName) { Move-ADObject -Identity $usr.DistinguishedName -TargetPath $ou.DistinguishedName -ErrorAction Stop }
        foreach ($grp in 'IT-Helpdesk', 'Domain Admins') { if ($grp -eq '${g}') { Add-ADGroupMember -Identity $grp -Members $usr -ErrorAction Stop } else { try { Remove-ADGroupMember -Identity $grp -Members $usr -Confirm:$false -ErrorAction Stop } catch {} } }`)) || fail());
});

router.post('/users/:u/reset-password', async (req, res) => {
    const u = req.params.u, pw = req.body.newPassword; if (!okName(u) || !okPassword(pw)) return res.status(400).json({ success: false, error: 'Mật khẩu phải dài từ 1 đến 256 ký tự.' });
    if (!isSuper(req) && await isAdminTarget(u)) return deny(res, 'Chỉ Super-Admin được đặt lại mật khẩu tài khoản quản trị');
    res.json(await runPS(wrap(`Set-ADAccountPassword -Identity '${psq(u)}' -Reset -NewPassword (ConvertTo-SecureString '${psq(pw)}' -AsPlainText -Force); Set-ADUser -Identity '${psq(u)}' -ChangePasswordAtLogon $false; Unlock-ADAccount -Identity '${psq(u)}'`)) || fail());
});
router.post('/users/:u/toggle', async (req, res) => {
    const u = req.params.u; if (!okName(u) || SYSTEM.includes(u.toLowerCase()) || u.toLowerCase() === self(req)) return deny(res, 'Không thể khóa tài khoản hệ thống hoặc chính bạn');
    if (!isSuper(req) && await isAdminTarget(u)) return deny(res, 'Chỉ Super-Admin được khóa tài khoản quản trị');
    res.json(await runPS(wrap(`$x = Get-ADUser '${psq(u)}'; if ($x.Enabled) { Disable-ADAccount $x } else { Enable-ADAccount $x }`)) || fail());
});
router.delete('/users/:u', async (req, res) => {
    const u = req.params.u; if (!okName(u) || SYSTEM.includes(u.toLowerCase()) || u.toLowerCase() === self(req)) return deny(res, 'Không thể xóa tài khoản hệ thống hoặc chính bạn');
    if (!isSuper(req) && await isAdminTarget(u)) return deny(res, 'Chỉ Super-Admin được xóa tài khoản quản trị');
    res.json(await runPS(wrap(`Remove-ADUser -Identity '${psq(u)}' -Confirm:$false`)) || fail());
});
module.exports = router;
