'use strict';
// Xác thực tài khoản domain qua PowerShell/Active Directory. Dùng chung cho đăng nhập Portal và scripts/diagnose-login.js.
const crypto = require('crypto');
const { runPS } = require('./utils');

const SAM = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';
const RE_PLAIN = new RegExp(`^${SAM}$`);
const RE_DOMAIN_USER = new RegExp(`^[A-Za-z0-9][A-Za-z0-9.-]{0,62}\\\\(${SAM})$`);
const RE_UPN = new RegExp(`^(${SAM})@([A-Za-z0-9][A-Za-z0-9.-]{0,120})$`);

// Chấp nhận: admin | ROYAL\admin | admin@royal.local. Chỉ ký tự an toàn nên không thể chèn lệnh vào PowerShell.
function normalizeLogin(raw) {
    const s = String(raw ?? '').trim();
    if (!s || s.length > 190) return null;
    let m;
    if (RE_PLAIN.test(s)) return { sam: s, login: s, form: 'sam' };
    if ((m = RE_DOMAIN_USER.exec(s))) return { sam: m[1], login: m[1], form: 'domain\\user' };
    if ((m = RE_UPN.exec(s))) return { sam: m[1], login: s, form: 'upn' };
    return null;
}

const list = (name, fallback) => String(process.env[name] || fallback).split(',').map(x => x.trim().toLocaleLowerCase('en-US')).filter(Boolean);
// Khớp TUYỆT ĐỐI tên nhóm (không phân biệt hoa thường), không khớp chuỗi con.
function roleFromGroups(groups) {
    const names = new Set((groups || []).map(g => String(g).trim().toLocaleLowerCase('en-US')));
    if (list('SUPER_ADMIN_GROUPS', 'Domain Admins').some(g => names.has(g))) return 'Super-Admin';
    if (list('IT_STAFF_GROUPS', 'IT-Helpdesk').some(g => names.has(g))) return 'IT-Staff';
    return 'Employee';
}

const b64 = v => Buffer.from(String(v), 'utf8').toString('base64');
function buildScript(login, sam, password) {
    // Mọi giá trị đi vào PowerShell đều mã hóa base64: dấu nháy, $, backtick, xuống dòng không thể đổi cú pháp.
    return `
        Add-Type -AssemblyName System.DirectoryServices.AccountManagement -ErrorAction Stop
        function Dec($s) { [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($s)) }
        $loginName = Dec '${b64(login)}'
        $samName = Dec '${b64(sam)}'
        $password = Dec '${b64(password)}'
        Import-Module ActiveDirectory -ErrorAction Stop
        $context = New-Object System.DirectoryServices.AccountManagement.PrincipalContext([System.DirectoryServices.AccountManagement.ContextType]::Domain)
        $valid = $false
        try {
            $valid = [bool]$context.ValidateCredentials($loginName, $password)
        } catch {
            # Dưới Windows Service (LocalSystem trên DC) ValidateCredentials có thể lỗi "The server cannot handle directory requests"
            # (FastConcurrentBind). Dự phòng: LDAP bind trực tiếp bằng Negotiate; mã LDAP 49 = sai thông tin đăng nhập.
            Add-Type -AssemblyName System.DirectoryServices.Protocols -ErrorAction Stop
            $dcHost = [string]((Get-ADDomainController -Discover -ErrorAction Stop).HostName | Select-Object -First 1)
            $conn = New-Object System.DirectoryServices.Protocols.LdapConnection((New-Object System.DirectoryServices.Protocols.LdapDirectoryIdentifier($dcHost, 389)))
            $conn.AuthType = [System.DirectoryServices.Protocols.AuthType]::Negotiate
            $conn.SessionOptions.ProtocolVersion = 3
            if ($loginName -like '*@*') { $cred = New-Object System.Net.NetworkCredential($loginName, $password) }
            else { $cred = New-Object System.Net.NetworkCredential($samName, $password, (Get-ADDomain).NetBIOSName) }
            try { $conn.Bind($cred); $valid = $true }
            catch {
                $inner = $_.Exception
                while ($inner.InnerException) { $inner = $inner.InnerException }
                if ($inner -is [System.DirectoryServices.Protocols.LdapException] -and $inner.ErrorCode -eq 49) { $valid = $false } else { throw }
            }
            finally { $conn.Dispose() }
        }
        if (-not $valid) {
            # Mật khẩu bị AD từ chối: tra thêm lý do để báo đúng nguyên nhân (khóa tài khoản do nhập sai nhiều lần, bị vô hiệu hóa, hết hạn mật khẩu).
            $reason = 'invalid_credentials'
            try {
                $acc = Get-ADUser -Identity $samName -Properties LockedOut, Enabled, PasswordExpired -ErrorAction Stop
                if ($acc.LockedOut) { $reason = 'locked_out' }
                elseif (-not $acc.Enabled) { $reason = 'disabled' }
                elseif ($acc.PasswordExpired) { $reason = 'password_expired' }
            } catch { }
            [PSCustomObject]@{ Success = $false; Reason = $reason } | ConvertTo-Json -Compress
        } else {
            $u = $null
            if ($loginName -like '*@*') { $u = Get-ADUser -Filter "UserPrincipalName -eq '$loginName'" -Properties DisplayName, Department, MemberOf -ErrorAction SilentlyContinue | Select-Object -First 1 }
            if (-not $u) { $u = Get-ADUser -Identity $samName -Properties DisplayName, Department, MemberOf -ErrorAction Stop }
            try {
                $groups = @(Get-ADPrincipalGroupMembership -Identity $u -ErrorAction Stop | Select-Object -ExpandProperty Name)
            } catch {
                # Dự phòng khi Get-ADPrincipalGroupMembership/ADWS chập chờn: lấy tên nhóm trực tiếp từ thuộc tính MemberOf.
                $groups = @($u.MemberOf | ForEach-Object { (($_ -split ',')[0]) -replace '^CN=', '' })
            }
            [PSCustomObject]@{
                Success = $true
                Username = $u.SamAccountName
                FullName = if ($u.DisplayName) { $u.DisplayName } else { $u.SamAccountName }
                Department = if ($u.Department) { $u.Department } else { 'Users' }
                Groups = @($groups)
            } | ConvertTo-Json -Compress -Depth 4
        }
    `;
}

const cleanDisplayName = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 128);

// Hạn chế số PowerShell chạy song song (mỗi lần đăng nhập mở 1 tiến trình powershell.exe, mất vài giây).
const MAX_PARALLEL = 3;
let active = 0;
const waiters = [];
const acquire = () => new Promise(resolve => { if (active < MAX_PARALLEL) { active++; resolve(); } else waiters.push(resolve); });
const release = () => { const next = waiters.shift(); if (next) next(); else active--; };
const inflight = new Map();   // cùng tài khoản + cùng mật khẩu bấm nhiều lần => chỉ hỏi AD một lần

async function queryAD(parsed, password, timeoutMs) {
    await acquire();
    try {
        const script = buildScript(parsed.login, parsed.sam, password);
        let result = await runPS(script, timeoutMs);
        let detail = runPS.lastErr || '';
        if (result == null && !/timed out/i.test(detail)) {   // lỗi thoáng qua (ADWS/PowerShell khởi động chậm): thử lại đúng 1 lần
            result = await runPS(script, timeoutMs);
            detail = runPS.lastErr || detail;
        }
        return { result, detail };
    } finally { release(); }
}

async function authenticate(rawLogin, password, options = {}) {
    const parsed = normalizeLogin(rawLogin);
    if (!parsed) return { ok: false, reason: 'bad_format' };
    if (typeof password !== 'string' || password.length < 1 || password.length > 256 || password.includes('\u0000')) return { ok: false, reason: 'bad_format' };

    const key = parsed.login.toLowerCase() + '|' + crypto.createHash('sha256').update(password).digest('hex');
    if (inflight.has(key)) return inflight.get(key);
    const job = (async () => {
        let outcome;
        try { outcome = await queryAD(parsed, password, options.timeoutMs || 45000); }
        catch (error) { return { ok: false, reason: 'unavailable', detail: String(error && error.message || error).slice(0, 300) }; }
        const { result, detail } = outcome;
        if (result == null) return { ok: false, reason: 'unavailable', detail: detail || 'no detail', timedOut: /timed out/i.test(detail) };
        if (result.Success === false || result.success === false) {
            const reason = ['locked_out', 'disabled', 'password_expired'].includes(result.Reason) ? result.Reason : 'invalid_credentials';
            return { ok: false, reason };
        }
        if (result.Success !== true || !result.Username) return { ok: false, reason: 'unavailable', detail: 'Kết quả PowerShell không hợp lệ' };
        const groups = (Array.isArray(result.Groups) ? result.Groups : result.Groups ? [result.Groups] : []).map(g => String(g).trim()).filter(Boolean);
        const username = String(result.Username).slice(0, 64);
        return {
            ok: true,
            user: { username, fullname: cleanDisplayName(result.FullName) || username, department: String(result.Department || 'Users').slice(0, 128), groups, role: roleFromGroups(groups) }
        };
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
}

module.exports = { authenticate, normalizeLogin, roleFromGroups, buildScript };