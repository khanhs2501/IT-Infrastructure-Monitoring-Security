// Ủy quyền thư mục phòng ban. Nguồn sự thật: thuộc tính ManagedBy của OU (trưởng phòng) và ACL NTFS (ai đang có quyền).
// Super-Admin: thiết lập phòng. Trưởng phòng: chia quyền thư mục con cho nhân viên phòng mình. IT: cấp TẠM THỜI (bắt buộc lý do, tối đa 30 ngày).
const os = require('os'); const express = require('express'); const { runPS, psq } = require('./utils'); const perm = require('./perm');
const okName = v => /^[\w.\-]{1,64}$/.test(v || ''), DAY = 86400000;
const lvl = s => /FullControl|Modify|Write/.test(s || '') ? 'write' : /Read/.test(s || '') ? 'read' : 'none';
const slug = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
const IC = `function ic { & icacls.exe @args | Out-Null; if ($LASTEXITCODE -ne 0) { throw ('icacls thất bại: ' + ($args -join ' ')) } }`;
const MASK = { read: '(OI)(CI)RX', write: '(OI)(CI)M' };
const LVN = { none: 0, read: 1, write: 2 }, LVS = ['none', 'read', 'write'], nm = s => String(s || '').split('\\').pop().toLowerCase();

// Phòng ban = OU con trực tiếp của OU "Departments" (đổi bằng DEPT_PARENT_OU trong .env); bỏ qua OU không phải phòng ban (DEPT_EXCLUDE_OU, mặc định Service Accounts)
const DEPT_PARENT = process.env.DEPT_PARENT_OU || 'Departments', DEPT_EXCLUDE = (process.env.DEPT_EXCLUDE_OU || 'Service Accounts').split(',').map(x => x.trim().toLowerCase());
const reChild = new RegExp('^OU=[^,]+,OU=' + DEPT_PARENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ',', 'i');
let ouCache = { t: 0, list: [] };
async function ous(force) {
    if (!force && Date.now() - ouCache.t < 60000) return ouCache.list;
    const rows = await runPS(`@(Get-ADOrganizationalUnit -Filter * -Properties ManagedBy | ForEach-Object { [PSCustomObject]@{ Name = $_.Name; DN = $_.DistinguishedName; Manager = $(if ($_.ManagedBy) { try { (Get-ADUser $_.ManagedBy).SamAccountName } catch { $null } } else { $null }) } }) | ConvertTo-Json -Compress`, 30000);
    if (rows) {
        const every = rows.filter(o => o.Name !== 'Domain Controllers'), kids = every.filter(o => reChild.test(o.DN) && !DEPT_EXCLUDE.includes(String(o.Name).toLowerCase()));
        ouCache = { t: Date.now(), list: kids.length ? kids : every };   // không có OU Departments thì giữ cách cũ
    }
    return ouCache.list;
}
let shCache = { t: 0, list: [] };   // share đang có trên server, để hiện đường dẫn UNC cho người dùng
async function shares() {
    if (Date.now() - shCache.t < 60000) return shCache.list;
    const r = await runPS(`@(Get-SmbShare | Where-Object { $_.Special -eq $false } | Select-Object Name, Path) | ConvertTo-Json -Compress`, 20000);
    if (r) shCache = { t: Date.now(), list: r }; return shCache.list;
}
const norm = p => String(p || '').replace(/[\\/]+$/, '').toLowerCase();
const managedBy = async u => (await ous()).filter(o => (o.Manager || '').toLowerCase() === String(u || '').toLowerCase()).map(o => o.Name);

const gname = dept => ('G_' + slug(dept)).slice(0, 40);   // nhóm bảo mật của phòng, đặt trong chính OU
// Tạo nhóm phòng ban (nếu chưa có), đặt ManagedBy và đồng bộ thành viên = nhân viên trong OU (+ trưởng phòng)
const groupPs = (o, manager) => `
    $gn = '${gname(o.Name)}'
    $g = Get-ADGroup -Filter "SamAccountName -eq '$gn'" -ErrorAction SilentlyContinue
    if (-not $g) { $g = New-ADGroup -Name $gn -SamAccountName $gn -GroupScope Global -GroupCategory Security -Path '${psq(o.DN)}' -Description 'Nhóm phòng ban - quản lý bởi RG-ITPortal' -PassThru }
    ${manager ? `Set-ADGroup -Identity $g -ManagedBy (Get-ADUser '${psq(manager)}').DistinguishedName` : 'Set-ADGroup -Identity $g -Clear ManagedBy'}
    $want = @(Get-ADUser -Filter * -SearchBase '${psq(o.DN)}' | Select-Object -ExpandProperty DistinguishedName)
    ${manager ? `$want += (Get-ADUser '${psq(manager)}').DistinguishedName` : ''}
    $have = @(Get-ADGroupMember -Identity $g | Where-Object { $_.objectClass -eq 'user' } | Select-Object -ExpandProperty DistinguishedName)
    $add = @($want | Where-Object { $_ -notin $have }); if ($add.Count) { Add-ADGroupMember -Identity $g -Members $add }
    $rem = @($have | Where-Object { $_ -notin $want }); if ($rem.Count) { Remove-ADGroupMember -Identity $g -Members $rem -Confirm:$false }`;

// Thiết lập thư mục gốc phòng: chỉ SYSTEM/Administrators/trưởng phòng/nhóm phòng - KHÔNG còn Authenticated Users.
// Nhóm phòng: xem thư mục gốc (không ghi ở gốc) + quyền mặc định `base` KẾ THỪA xuống mọi thư mục con (trừ thư mục con đặt "Hạn chế")
function setupDept(o, path, manager, base) {
    const bm = { read: 'RX', write: 'M' }[base];   // none -> nhóm phòng chỉ xem được thư mục gốc
    const p = psq(path.replace(/[\\/]+$/, '')), m = manager ? psq(manager) : '', old = o.Manager && o.Manager !== manager ? psq(o.Manager) : '';
    const mgrAcl = m ? `Set-ADOrganizationalUnit -Identity '${psq(o.DN)}' -ManagedBy (Get-ADUser '${m}').DistinguishedName
        ic $p /grant:r ("$dom\\${m}:(OI)(CI)F")` : `Set-ADOrganizationalUnit -Identity '${psq(o.DN)}' -Clear ManagedBy`;
    return runPS(`${IC}
        $p = '${p}'; $dom = $env:USERDOMAIN
        $au = (New-Object Security.Principal.SecurityIdentifier 'S-1-5-11').Translate([Security.Principal.NTAccount]).Value
        ${groupPs(o, manager)}
        New-Item -ItemType Directory -Force -Path $p | Out-Null
        $sh = @(Get-SmbShare -ErrorAction SilentlyContinue | Where-Object { -not $_.Special -and $_.Path -and (($p.TrimEnd('\\') + '\\').StartsWith($_.Path.TrimEnd('\\') + '\\', [StringComparison]::OrdinalIgnoreCase)) })
        if (-not ($sh | Where-Object { $_.Path.TrimEnd('\\') -ieq $p.TrimEnd('\\') })) { $ex = Get-SmbShare -Name '${slug(o.Name)}' -ErrorAction SilentlyContinue; if ($ex) { throw ('Đã có share tên ${slug(o.Name)} trỏ tới ' + $ex.Path + ' - hãy xóa hoặc đổi tên share đó rồi lưu lại') } }
        ic $p /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'
        ic $p /remove:g '*S-1-5-11'
        $gs = '*' + $g.SID.Value
        ic $p /remove:g $gs
        ic $p /grant ("$($gs):(RX)")
        ${bm ? `ic $p /grant ("$($gs):(OI)(CI)(IO)${bm}")` : ''}
        ${mgrAcl}
        ${old ? `try { ic $p /remove:g ("$dom\\${old}") } catch {}` : ''}
        if (-not ($sh | Where-Object { $_.Path.TrimEnd('\\') -ieq $p.TrimEnd('\\') })) { New-SmbShare -Name '${slug(o.Name)}' -Path $p -FolderEnumerationMode AccessBased -ChangeAccess $au | Out-Null }
        foreach ($s in $sh) { Set-SmbShare -Name $s.Name -FolderEnumerationMode AccessBased -Force }
        [PSCustomObject]@{ Success = $true } | ConvertTo-Json -Compress`, 120000);
}
// Tập tin được move vào thư mục (giữ ACL cũ) hoặc đang tắt kế thừa sẽ không nhận quyền mới: bật lại kế thừa cho TẬP TIN (không đụng thư mục con)
function repairFiles(path) {
    return runPS(`$p = '${psq(path)}'; $n = 0
        Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue | Select-Object -First 5000 | ForEach-Object {
            try { $fi = [System.IO.FileInfo]$_.FullName; $a = $fi.GetAccessControl('Access'); $a.SetAccessRuleProtection($false, $true); $fi.SetAccessControl($a); $n++ } catch {}
        }
        [PSCustomObject]@{ Success = $true; Files = $n } | ConvertTo-Json -Compress`, 180000);
}

// Áp quyền cho 1 user trên 1 thư mục; trả về quyền trước đó (Prev) để khôi phục khi hết hạn
function applyLevel(path, user, level) {
    const g = level === 'none' ? 'ic $p /remove:g $id' : `ic $p /grant:r ("$($id):${MASK[level]}")`;
    return runPS(`${IC}
        $p = '${psq(path)}'; $id = "$($env:USERDOMAIN)\\${psq(user)}"
        if (-not (Test-Path -LiteralPath $p -PathType Container)) { throw 'Thư mục không tồn tại' }
        $prev = [string]((Get-Acl -LiteralPath $p).Access | Where-Object { -not $_.IsInherited -and $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -eq $id } | Select-Object -First 1).FileSystemRights
        ${g}
        [PSCustomObject]@{ Success = $true; Prev = $prev } | ConvertTo-Json -Compress`, 30000);
}
// Phạm vi thư mục: 'restricted' = ngắt kế thừa, chỉ SYSTEM/Administrators/trưởng phòng + người được cấp riêng (cả phòng KHÔNG vào được);
// 'inherit' = kế thừa lại quyền từ thư mục cha (mặc định). Áp dụng được ở mọi cấp thư mục con.
function setMode(path, mode, manager) {
    const m = manager ? psq(manager) : '';
    const act = mode === 'restricted'
        ? `ic $p /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'${m ? `\n        ic $p /grant:r ("$dom\\${m}:(OI)(CI)F")` : ''}`
        : 'ic $p /inheritance:e';
    return runPS(`${IC}
        $p = '${psq(path)}'; $dom = $env:USERDOMAIN
        if (-not (Test-Path -LiteralPath $p -PathType Container)) { throw 'Thư mục không tồn tại' }
        ${act}
        [PSCustomObject]@{ Success = $true } | ConvertTo-Json -Compress`, 30000);
}
// Các thư mục nằm giữa thư mục gốc phòng và thư mục đích (không gồm gốc, không gồm đích)
const ancestors = (root, full) => { const r = root.replace(/[\\/]+$/, ''), segs = full.slice(r.length).split(/[\\/]+/).filter(Boolean); return segs.slice(0, -1).map((_, i) => r + '\\' + segs.slice(0, i + 1).join('\\')); };
const psList = a => '@(' + a.map(x => `'${psq(x)}'`).join(',') + ')';
// Thư mục cha đang "Hạn chế" thì người được cấp ở thư mục con cần quyền duyệt (RX, chỉ riêng thư mục cha đó) mới đi tới được
function ensureTraverse(list, user) {
    if (!list.length) return Promise.resolve({ Success: true });
    return runPS(`${IC}
        $id = "$($env:USERDOMAIN)\\${psq(user)}"
        foreach ($a in ${psList(list)}) { if ((Get-Acl -LiteralPath $a).AreAccessRulesProtected) { ic $a /grant ("$($id):(RX)") } }
        [PSCustomObject]@{ Success = $true } | ConvertTo-Json -Compress`, 30000);
}
function dropTraverse(list, user) {
    return runPS(`${IC}
        $id = "$($env:USERDOMAIN)\\${psq(user)}"
        foreach ($a in ${psList(list)}) { try { ic $a /remove:g $id } catch {} }
        [PSCustomObject]@{ Success = $true } | ConvertTo-Json -Compress`, 30000);
}

function subPath(root, rel) {   // chống ../ và ký tự cấm: chỉ cho phép đi xuống thư mục con của thư mục gốc phòng
    const segs = String(rel || '').split(/[\\/]+/).filter(Boolean);
    if (segs.some(s => s === '.' || s === '..' || /[<>:"|?*\x00-\x1f]/.test(s) || /[. ]$/.test(s))) return null;
    return [root.replace(/[\\/]+$/, ''), ...segs].join('\\');
}

module.exports = db => {
    const r = express.Router();
    // base = quyền mặc định của CẢ PHÒNG trên mọi thư mục con (none | read | write), kế thừa xuống, trừ thư mục con bị đặt "Hạn chế"
    db.run('CREATE TABLE IF NOT EXISTS dept_folders (dept TEXT PRIMARY KEY, path TEXT)', () => db.run("ALTER TABLE dept_folders ADD COLUMN base TEXT DEFAULT 'read'", () => {}));
    db.run('CREATE TABLE IF NOT EXISTS grants (id INTEGER PRIMARY KEY AUTOINCREMENT, dept TEXT, path TEXT, username TEXT, level TEXT, prev_level TEXT, by_user TEXT, by_role TEXT, reason TEXT, expires_at INTEGER, revoked_at INTEGER, created_at INTEGER)');
    const all = (s, p = []) => new Promise(ok => db.all(s, p, (e, rows) => ok(rows || [])));
    const exec = (s, p = []) => new Promise(ok => db.run(s, p, () => ok()));
    const deptPath = async d => ((await all('SELECT path FROM dept_folders WHERE dept = ?', [d]))[0] || {}).path;
    // Sau khi thu hồi/hết hạn: gỡ quyền duyệt ở thư mục cha nếu người đó không còn quyền nào ở bên dưới
    const cleanTraverse = async (dept, user, full) => {
        const root = await deptPath(dept); if (!root || !full) return;
        const keep = (await all("SELECT path FROM grants WHERE dept = ? AND username = ? AND revoked_at IS NULL AND level != 'none'", [dept, user])).map(x => norm(x.path));
        const drop = ancestors(root, full).filter(a => !keep.some(k => k === norm(a) || k.startsWith(norm(a) + '\\')));
        if (drop.length) await dropTraverse(drop, user);
    };
    const uncOf = (sh, p) => { const s = sh.find(x => norm(x.Path) === norm(p)); return s ? '\\\\' + os.hostname() + '\\' + s.Name : ''; };
    // Quét cây thư mục của phòng (tối đa 4 cấp / 800 thư mục) kèm cờ "Hạn chế" và ACE riêng; cache 60 giây dùng chung cho mọi nhân viên
    const treeCache = {};
    const scanTree = async dept => {
        const c = treeCache[dept]; if (c && Date.now() - c.t < 60000) return c.rows;
        const root = await deptPath(dept); if (!root) return [];
        const rows = await runPS(`$root = '${psq(root)}'.TrimEnd('\\'); $n = $root.Length + 1
            @(Get-ChildItem -LiteralPath $root -Recurse -Directory -Depth 4 -Force -ErrorAction SilentlyContinue | Select-Object -First 800 | ForEach-Object { $acl = Get-Acl -LiteralPath $_.FullName; [PSCustomObject]@{ Rel = $_.FullName.Substring($n).Replace('\\', '/'); Restricted = [bool]$acl.AreAccessRulesProtected; Aces = @($acl.Access | Where-Object { -not $_.IsInherited -and $_.AccessControlType -eq 'Allow' -and $_.InheritanceFlags -ne 'None' } | ForEach-Object { [PSCustomObject]@{ U = $_.IdentityReference.Value; R = [string]$_.FileSystemRights } }) } }) | ConvertTo-Json -Depth 4 -Compress`, 90000);
        if (rows) treeCache[dept] = { t: Date.now(), rows: [].concat(rows) };
        return rows ? treeCache[dept].rows : [];
    };
    const fail = (res, error, code = 200) => res.status(code).json({ success: false, error });
    const who = async (req, dept) => {
        const u = req.session.user; if (u.role === 'Super-Admin') return 'Super-Admin';
        if ((await managedBy(u.username)).includes(dept)) return 'Manager';
        return perm.can(u, 'deleg', 'view') ? 'IT' : null;
    };

    r.get('/depts', async (req, res) => {
        const rowsD = await all('SELECT * FROM dept_folders'), paths = Object.fromEntries(rowsD.map(x => [x.dept, x.path])), bases = Object.fromEntries(rowsD.map(x => [x.dept, x.base || 'read'])), out = [], sh = await shares();
        for (const o of await ous()) { const role = await who(req, o.Name); if (!role || (role === 'IT' && !paths[o.Name])) continue; const s = sh.find(x => norm(x.Path) === norm(paths[o.Name])); out.push({ name: o.Name, manager: o.Manager, path: paths[o.Name] || '', base: bases[o.Name] || 'read', role, share: s ? s.Name : '', unc: s ? '\\\\' + os.hostname() + '\\' + s.Name : '' }); }
        res.json(out);
    });

    r.post('/depts', async (req, res) => {   // Super-Admin: thư mục gốc + trưởng phòng (Full Control) + nhóm phòng ban + share ẩn thư mục không có quyền
        if (req.session.user.role !== 'Super-Admin') return fail(res, 'Chỉ Super-Admin được thiết lập phòng ban', 403);
        const { dept, path, manager } = req.body, base = ['none', 'read', 'write'].includes(req.body.base) ? req.body.base : 'read', o = (await ous()).find(x => x.Name === dept);
        if (!o || !/^[A-Za-z]:\\/.test(path || '') || /[<>"|?*]/.test(path) || (manager && !okName(manager))) return fail(res, 'Thông tin phòng ban hoặc đường dẫn không hợp lệ');
        const out = await setupDept(o, path, manager, base);
        if (!out) return fail(res, runPS.lastErr || 'PowerShell không phản hồi');
        await exec('INSERT OR REPLACE INTO dept_folders (dept, path, base) VALUES (?,?,?)', [dept, path.replace(/[\\/]+$/, ''), base]); await ous(true); shCache.t = 0;
        res.json({ success: true });
    });

    r.post('/resetup', async (req, res) => {   // áp dụng lại thiết lập mới cho mọi phòng đã cấu hình trước đây
        if (req.session.user.role !== 'Super-Admin') return fail(res, 'Chỉ Super-Admin', 403);
        const list = await ous(true), done = [], bad = [];
        for (const d of await all('SELECT * FROM dept_folders')) {
            const o = list.find(x => x.Name === d.dept); if (!o) continue;
            (await setupDept(o, d.path, o.Manager, d.base || 'read')) ? done.push(d.dept) : bad.push(`${d.dept}: ${runPS.lastErr}`);
        }
        shCache.t = 0; res.json({ success: !bad.length, done, error: bad.join('; ') });
    });

    r.get('/users', async (req, res) => {   // ứng viên được cấp quyền: nhân viên trong OU (IT/Super có thể xem toàn bộ domain)
        const dept = req.query.dept, role = await who(req, dept), o = (await ous()).find(x => x.Name === dept);
        if (!role || !o) return res.status(403).json([]);
        const base = req.query.outside === '1' && role !== 'Manager' ? '' : ` -SearchBase '${psq(o.DN)}'`;
        const list = [].concat(await runPS(`@(Get-ADUser -Filter 'Enabled -eq $true'${base} | Sort-Object Name | Select-Object SamAccountName, Name) | ConvertTo-Json -Compress`, 30000) || []);
        list.unshift({ SamAccountName: gname(dept), Name: '★ Toàn bộ phòng ' + dept });   // cấp quyền cho cả phòng (nhóm phòng ban)
        res.json(list);
    });

    r.get('/folders', async (req, res) => {   // thư mục con + phạm vi + quyền riêng (nhận diện theo SID, gộp trùng, cảnh báo quyền công khai)
        const dept = req.query.dept, sub = req.query.sub || '', role = await who(req, dept), root = await deptPath(dept), full = root && subPath(root, sub);
        if (!role) return fail(res, 'Không đủ quyền hạn', 403); if (!full) return res.json({ folders: [] });
        const o = (await ous()).find(x => x.Name === dept), mgr = (o && o.Manager) || '', chain = sub ? ancestors(root, full) : [];
        const out = await runPS(`$mgr = '${psq(mgr)}'; $wk = @('S-1-5-11', 'S-1-1-0', 'S-1-5-32-545'); $wk += ((Get-ADDomain).DomainSID.Value + '-513')
            $curP = ${sub ? `[bool](Get-Acl -LiteralPath '${psq(full)}').AreAccessRulesProtected` : '$false'}
            $ancP = [bool](@(${chain.map(a => `'${psq(a)}'`).join(',')}) | Where-Object { (Get-Acl -LiteralPath $_).AreAccessRulesProtected }).Count
            $list = @(Get-ChildItem -LiteralPath '${psq(full)}' -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { $acl = Get-Acl -LiteralPath $_.FullName
                $aces = @($acl.Access | Where-Object { -not $_.IsInherited -and $_.AccessControlType -eq 'Allow' } | ForEach-Object {
                    $sid = try { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { '' }
                    if ($sid -ne 'S-1-5-18' -and $sid -ne 'S-1-5-32-544') { [PSCustomObject]@{ User = ($_.IdentityReference.Value -split '\\\\')[-1]; Rights = [string]$_.FileSystemRights; Flow = ($_.InheritanceFlags -ne 'None'); Exposed = ($wk -contains $sid) } } })
                [PSCustomObject]@{ Name = $_.Name; Restricted = [bool]$acl.AreAccessRulesProtected; Aces = $aces } })
            [PSCustomObject]@{ CurP = $curP; AncP = $ancP; List = $list } | ConvertTo-Json -Depth 5 -Compress`, 60000);
        if (!out) return res.json({ folders: [], error: runPS.lastErr || 'PowerShell không phản hồi' });
        const dp = (await all('SELECT base FROM dept_folders WHERE dept = ?', [dept]))[0], parentR = !!(out.AncP || out.CurP);
        res.json({
            base: (dp && dp.base) || 'read', current: sub ? { rel: sub, restricted: !!out.CurP, parentRestricted: !!out.AncP } : null,
            folders: [].concat(out.List || []).map(f => {
                const best = {}, expo = new Set();
                [].concat(f.Aces || []).forEach(a => {
                    if (a.Exposed) return expo.add(a.User);
                    const l = lvl(a.Rights); if (!a.Flow || l === 'none' || a.User.toLowerCase() === mgr.toLowerCase()) return;
                    if (!best[a.User] || LVN[l] > LVN[best[a.User]]) best[a.User] = l;
                });
                return { name: f.Name, rel: [sub, f.Name].filter(Boolean).join('/'), restricted: !!f.Restricted, parentRestricted: parentR, exposed: [...expo], aces: Object.entries(best).map(([user, level]) => ({ user, level })) };
            })
        });
    });

    r.post('/mode', async (req, res) => {   // Super-Admin / Trưởng phòng: đặt thư mục "Hạn chế" (chỉ người được cấp) hoặc "Kế thừa" (theo thư mục cha)
        const { dept, sub, mode } = req.body, role = await who(req, dept), root = await deptPath(dept), full = root && sub && subPath(root, sub);
        if (!role) return fail(res, 'Không đủ quyền hạn', 403);
        if (role === 'IT') return fail(res, 'Chỉ Super-Admin hoặc Trưởng phòng được đổi phạm vi thư mục', 403);
        if (!full || !['inherit', 'restricted'].includes(mode)) return fail(res, 'Thông tin không hợp lệ');
        const o = (await ous()).find(x => x.Name === dept), out = await setMode(full, mode, o && o.Manager);
        if (!out) return fail(res, runPS.lastErr || 'Không áp dụng được');
        repairFiles(full).catch(() => {});
        res.json({ success: true });
    });

    r.post('/unexpose', async (req, res) => {   // gỡ ACE công khai (Authenticated Users / Everyone / Users / Domain Users) đặt trực tiếp trên thư mục
        const { dept, sub } = req.body, role = await who(req, dept), root = await deptPath(dept), full = root && sub && subPath(root, sub);
        if (!role) return fail(res, 'Không đủ quyền hạn', 403);
        if (role === 'IT') return fail(res, 'Chỉ Super-Admin hoặc Trưởng phòng được gỡ quyền công khai', 403);
        if (!full) return fail(res, 'Thông tin không hợp lệ');
        const out = await runPS(`${IC}
            $p = '${psq(full)}'; $dus = (Get-ADDomain).DomainSID.Value + '-513'
            if (-not (Test-Path -LiteralPath $p -PathType Container)) { throw 'Thư mục không tồn tại' }
            foreach ($s in @('S-1-5-11', 'S-1-1-0', 'S-1-5-32-545', $dus)) { try { ic $p /remove:g ("*$s") } catch {} }
            [PSCustomObject]@{ Success = $true } | ConvertTo-Json -Compress`, 30000);
        if (!out) return fail(res, runPS.lastErr || 'Không áp dụng được'); treeCache[dept] = null; res.json({ success: true });
    });

    // Nhân viên: mọi thư mục TRUY CẬP ĐƯỢC thật sự (tính từ ACL + nhóm của chính họ): quyền chung của phòng, cấp cho cả phòng/nhóm, cấp riêng
    r.get('/mine', async (req, res) => {
        try {
            const u = req.session.user, me = String(u.username).toLowerCase(), now = Date.now(), admin = u.role === 'Super-Admin';
            let tg = null, warn = '';
            if (!admin) {
                tg = await runPS(`$u = Get-ADUser -Identity '${psq(u.username)}' -Properties TokenGroups
                    [PSCustomObject]@{ Groups = @($u.TokenGroups | ForEach-Object { try { ($_.Translate([Security.Principal.NTAccount]).Value -split '\\\\')[-1] } catch {} }) } | ConvertTo-Json -Compress`, 30000)
                    || await runPS(`[PSCustomObject]@{ Groups = @(Get-ADPrincipalGroupMembership -Identity '${psq(u.username)}' | ForEach-Object { $_.SamAccountName }) } | ConvertTo-Json -Compress`, 30000);
                if (!tg) warn = 'Không đọc được nhóm của tài khoản: ' + (runPS.lastErr || 'PowerShell không phản hồi');
            }
            const mine = new Set([me, ...[].concat((tg && tg.Groups) || []).map(x => String(x).toLowerCase())]), managed = await managedBy(u.username), sh = await shares(), depts = [], grants = [];
            for (const d of await all('SELECT * FROM dept_folders')) {
                const gd = gname(d.dept).toLowerCase(), isMgr = managed.includes(d.dept); if (!isMgr && !mine.has(gd)) continue;
                const unc = uncOf(sh, d.path), bl = LVN[d.base || 'read'], tree = (await scanTree(d.dept)).slice().sort((a, b) => a.Rel.localeCompare(b.Rel)), A = {};
                const act = await all("SELECT * FROM grants WHERE dept = ? AND revoked_at IS NULL AND level != 'none' AND (expires_at IS NULL OR expires_at > ?)", [d.dept, now]);
                depts.push({ dept: d.dept, unc, base: d.base || 'read' });
                for (const f of tree) {
                    const parts = f.Rel.split('/'), pl = parts.length === 1 ? bl : (A[parts.slice(0, -1).join('/')] || 0);
                    let own = 0, via = '';
                    for (const a of [].concat(f.Aces || [])) { const n = nm(a.U), l = LVN[lvl(a.R)]; if (mine.has(n) && l > own) { own = l; via = n; } }
                    const l = isMgr ? 2 : f.Restricted ? own : Math.max(pl, own); A[f.Rel] = l;
                    if (l > 0 && (parts.length === 1 || l !== pl || own > pl || f.Restricted)) {   // chỉ liệt kê điểm bắt đầu của quyền; thư mục con cùng mức quyền với cha được gộp
                        const full = d.path.replace(/[\\/]+$/, '') + '\\' + parts.join('\\'), m = act.find(x => norm(x.path) === norm(full) && [me, gd].includes(String(x.username).toLowerCase()));
                        const source = isMgr ? 'manager' : own > 0 && own >= pl ? (via === me ? 'user' : 'group') : 'dept';
                        grants.push({ dept: d.dept, rel: f.Rel, level: LVS[l], scope: 'tree', source, via: source === 'group' ? via : '', group: source === 'group', expires_at: m ? m.expires_at : null, by_user: m ? m.by_user : '', by_role: m ? m.by_role : '', unc: unc ? unc + '\\' + parts.join('\\') : '' });
                    }
                }
            }
            res.json({ depts, managed: managed.map(x => ({ dept: x })), grants: grants.slice(0, 300), warn });
        } catch (e) { console.error('[mine]', e); res.status(500).json({ error: e.message }); }
    });

    // Super-Admin: duyệt ổ đĩa và thư mục trên máy chủ (chỉ đọc), kèm thư mục phòng ban và share
    r.get('/browse', async (req, res) => {
        if (req.session.user.role !== 'Super-Admin') return fail(res, 'Chỉ Super-Admin được duyệt ổ đĩa máy chủ', 403);
        const p = String(req.query.path || '').replace(/[\\/]+$/, '').replace(/\//g, '\\'), sh = await shares(), depts = await all('SELECT dept, path FROM dept_folders');
        const info = full => ({ shares: sh.filter(x => norm(x.Path) === norm(full)).map(x => ({ name: x.Name, unc: '\\\\' + os.hostname() + '\\' + x.Name })), dept: (depts.find(x => norm(x.path) === norm(full)) || {}).dept || '' });
        if (!p) {
            const rows = await runPS(`@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [PSCustomObject]@{ Name = $_.DeviceID; Label = $_.VolumeName; Size = [int64]$_.Size; Free = [int64]$_.FreeSpace } }) | ConvertTo-Json -Compress`, 20000);
            if (!rows && runPS.lastErr) return fail(res, runPS.lastErr);
            return res.json({ path: '', items: [].concat(rows || []).map(x => ({ name: x.Name, path: x.Name + '\\', label: x.Label || '', size: x.Size, free: x.Free, ...info(x.Name + '\\') })) });
        }
        if (!/^[A-Za-z]:(\\[^<>"|?*\x00-\x1f]*)?$/.test(p) || p.split('\\').some(x => x === '.' || x === '..')) return fail(res, 'Đường dẫn không hợp lệ');
        const names = await runPS(`@(if (-not (Test-Path -LiteralPath '${psq(p + '\\')}' -PathType Container)) { throw 'Thư mục không tồn tại' }; Get-ChildItem -LiteralPath '${psq(p + '\\')}' -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne '$Recycle.Bin' -and $_.Name -ne 'System Volume Information' } | Sort-Object Name | Select-Object -First 500 -ExpandProperty Name) | ConvertTo-Json -Compress`, 30000);
        if (!names && runPS.lastErr) return fail(res, runPS.lastErr);
        res.json({ path: p, items: [].concat(names || []).map(n => ({ name: n, path: p + '\\' + n, ...info(p + '\\' + n) })) });
    });

    r.get('/profile', async (req, res) => {   // hồ sơ của chính người đăng nhập (chỉ đọc từ AD)
        const p = await runPS(`$u = Get-ADUser -Identity '${psq(req.session.user.username)}' -Properties DisplayName, EmailAddress, Title, OfficePhone, Department, Manager, whenCreated, PasswordLastSet, PasswordNeverExpires, LockedOut, 'msDS-UserPasswordExpiryTimeComputed', MemberOf
            $exp = $u.'msDS-UserPasswordExpiryTimeComputed'
            $iso = { param($d) if ($d) { ([DateTime]$d).ToUniversalTime().ToString('o') } else { $null } }
            [PSCustomObject]@{ Name = $u.Name; Display = $u.DisplayName; Email = $u.EmailAddress; Title = $u.Title; Phone = $u.OfficePhone; Dept = $u.Department
                Manager = $(if ($u.Manager) { try { (Get-ADUser $u.Manager).Name } catch { $null } } else { $null })
                Created = (& $iso $u.whenCreated); PwSet = (& $iso $u.PasswordLastSet)
                PwExpires = $(if ($u.PasswordNeverExpires -or -not $exp -or $exp -le 0 -or $exp -ge 9223372036854775807) { $null } else { [DateTime]::FromFileTimeUtc($exp).ToString('o') })
                NeverExpires = [bool]$u.PasswordNeverExpires; Locked = [bool]$u.LockedOut
                Groups = @($u.MemberOf | ForEach-Object { ($_ -split ',')[0] -replace '^CN=' }) } | ConvertTo-Json -Compress`, 30000);
        if (p) p.Groups = [].concat(p.Groups || []);
        res.json(p || {});
    });

    r.post('/grant', async (req, res) => {
        const { dept, sub, username, level, until, reason } = req.body, u = req.session.user, role = await who(req, dept), root = await deptPath(dept), full = root && sub && subPath(root, sub);
        if (!role) return fail(res, 'Không đủ quyền hạn', 403);
        if (!full || !okName(username) || !['none', 'read', 'write'].includes(level)) return fail(res, 'Thông tin không hợp lệ');
        if (role === 'IT' && !perm.can(u, 'deleg', 'manage')) return fail(res, 'Bạn chỉ có quyền xem mục này', 403);
        if (role !== 'Super-Admin' && username.toLowerCase() === String(u.username).toLowerCase()) return fail(res, 'Không thể tự cấp quyền cho chính mình');
        const exp = until ? Date.parse(until) : null;
        if (until && (isNaN(exp) || exp <= Date.now())) return fail(res, 'Thời hạn phải ở tương lai');
        if (role === 'IT') {
            if (!reason || reason.trim().length < 5) return fail(res, 'IT cần nhập lý do (tối thiểu 5 ký tự)');
            if (level !== 'none' && (!exp || exp - Date.now() > 30 * DAY)) return fail(res, 'IT chỉ được cấp tạm thời, tối đa 30 ngày');
        }
        if (role === 'Manager' && username !== gname(dept)) {   // trưởng phòng chỉ cấp cho người thuộc OU của mình; người khác nhờ IT hỗ trợ
            const o = (await ous()).find(x => x.Name === dept), chk = await runPS(`[PSCustomObject]@{ In = [bool]((Get-ADUser '${psq(username)}').DistinguishedName -like '*,${psq(o.DN)}') } | ConvertTo-Json -Compress`);
            if (!chk || !chk.In) return fail(res, 'Trưởng phòng chỉ cấp quyền cho nhân viên thuộc phòng mình (người khác hãy nhờ IT hỗ trợ)');
        }
        if (level !== 'none' && !(await ensureTraverse(ancestors(root, full), username))) return fail(res, 'Không mở được đường đi tới thư mục: ' + (runPS.lastErr || ''));
        const out = await applyLevel(full, username, level); if (!out) return fail(res, runPS.lastErr || 'Không áp dụng được quyền');
        const act = (await all('SELECT prev_level FROM grants WHERE path = ? AND username = ? AND revoked_at IS NULL AND expires_at IS NOT NULL ORDER BY id DESC LIMIT 1', [full, username]))[0];
        const prev = act ? act.prev_level : lvl(out.Prev), now = Date.now();
        await exec('UPDATE grants SET revoked_at = ? WHERE path = ? AND username = ? AND revoked_at IS NULL', [now, full, username]);
        await exec('INSERT INTO grants (dept,path,username,level,prev_level,by_user,by_role,reason,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [dept, full, username, level, prev, u.username, role, String(reason || '').slice(0, 200), exp, now]);
        if (level === 'none') cleanTraverse(dept, username, full).catch(() => {});
        if (level !== 'none') repairFiles(full).catch(() => {});   // chạy nền: sửa kế thừa cho tập tin trong thư mục
        res.json({ success: true });
    });

    r.get('/history', async (req, res) => {
        const dept = req.query.dept; if (!(await who(req, dept))) return res.status(403).json([]);
        const root = (await deptPath(dept)) || '';
        res.json((await all('SELECT * FROM grants WHERE dept = ? ORDER BY id DESC LIMIT 100', [dept])).map(g => ({ ...g, rel: g.path.slice(root.length), state: g.level === 'none' ? 'Thu hồi' : g.revoked_at ? (g.expires_at && g.revoked_at >= g.expires_at ? 'Hết hạn' : 'Đã thay thế') : 'Đang hiệu lực' })));
    });

    // Tự thu hồi quyền tạm thời khi hết hạn (khôi phục mức quyền trước đó)
    const sweep = async () => {
        try {
            for (const g of await all('SELECT * FROM grants WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?', [Date.now()])) {
                const o = await applyLevel(g.path, g.username, g.prev_level || 'none');
                if (o || /không tồn tại/.test(runPS.lastErr)) {
                    await exec('UPDATE grants SET revoked_at = ? WHERE id = ?', [Date.now(), g.id]);
                    if ((g.prev_level || 'none') === 'none') await cleanTraverse(g.dept, g.username, g.path);
                }
            }
        } catch (e) { console.error('[sweep]', e.message); }
    };
    // Background maintenance must not keep the process alive during graceful shutdown/tests.
    const sweepStartTimer = setTimeout(sweep, 20000); sweepStartTimer.unref?.();
    const sweepInterval = setInterval(sweep, 60000); sweepInterval.unref?.();

    // Đồng bộ thành viên nhóm phòng ban với OU (nhân viên mới/chuyển phòng) mỗi 10 phút
    const syncGroups = async () => {
        try {
            const list = await ous(true);
            for (const d of await all('SELECT dept FROM dept_folders')) { const o = list.find(x => x.Name === d.dept); if (o) await runPS(`${groupPs(o, o.Manager)}\n[PSCustomObject]@{ Success = $true } | ConvertTo-Json -Compress`, 60000); }
        } catch (e) { console.error('[sync]', e.message); }
    };
    const syncStartTimer = setTimeout(syncGroups, 30000); syncStartTimer.unref?.();
    const syncInterval = setInterval(syncGroups, 600000); syncInterval.unref?.();
    return r;
};
module.exports.managedBy = managedBy;