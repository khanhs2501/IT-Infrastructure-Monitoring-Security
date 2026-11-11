#!/usr/bin/env node
'use strict';
// Chẩn đoán đăng nhập Portal bằng chính đường xác thực thật (PowerShell + Active Directory).
// Dùng:  node scripts/diagnose-login.js [tài_khoản]        (mặc định: Administrator)
//        Mật khẩu được hỏi ẩn (không hiển thị, không ghi file). Bỏ qua bước thử mật khẩu bằng cách để trống.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env'), quiet: true });
const { runPS } = require('../routes/utils');
const adAuth = require('../routes/ad-auth');

const target = process.argv[2] || 'Administrator';
const parsed = adAuth.normalizeLogin(target);
const ok = (m) => console.log('\x1b[32m✔\x1b[0m', m), warn = (m) => console.log('\x1b[33m!\x1b[0m', m), bad = (m) => console.log('\x1b[31m✘\x1b[0m', m);

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); };   // không in ký tự mật khẩu
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  console.log(`RG-ITPortal — chẩn đoán đăng nhập cho "${target}"\n`);
  if (!parsed) { bad('Tên tài khoản không hợp lệ (chỉ chữ, số, . _ -; hoặc DOMAIN\\tên, tên@domain).'); process.exit(1); }

  // 1. Môi trường chạy
  console.log(`Node ${process.version} | ${process.platform} | NODE_ENV=${process.env.NODE_ENV || '(trống)'} | PORT=${process.env.PORT || '80'}`);
  if (process.platform !== 'win32') warn('Không phải Windows: PowerShell/Active Directory sẽ không chạy được trên máy này.');
  const cookie = String(process.env.COOKIE_SECURE || '').trim().toLowerCase();
  if (cookie === 'true') warn('COOKIE_SECURE=true: nếu truy cập Portal bằng http:// trình duyệt sẽ vứt cookie phiên => đăng nhập xong bị đá ra. Đặt "auto" hoặc "false".');
  else ok(`COOKIE_SECURE=${cookie || '(trống → auto)'} hợp lệ cho HTTP`);

  // 2. Sức khỏe PowerShell/AD và chính sách khóa tài khoản
  const info = await runPS(`Import-Module ActiveDirectory -ErrorAction Stop
    $pol = Get-ADDefaultDomainPasswordPolicy
    [PSCustomObject]@{ Domain = (Get-ADDomain).DNSRoot; DC = (Get-ADDomainController -Discover).HostName; RunAs = [Environment]::UserDomainName + '\\' + [Environment]::UserName
      LockoutThreshold = $pol.LockoutThreshold; LockoutDuration = $pol.LockoutDuration.ToString(); ObservationWindow = $pol.LockoutObservationWindow.ToString() } | ConvertTo-Json -Compress`, 40000);
  if (!info) { bad(`PowerShell/AD không phản hồi: ${runPS.lastErr}`); console.log('  → Cài RSAT (ActiveDirectory module), chạy Portal bằng tài khoản domain có quyền đọc AD, kiểm tra dịch vụ ADWS trên DC.'); process.exit(2); }
  ok(`AD: domain ${info.Domain}, DC ${info.DC}, Portal chạy bằng ${info.RunAs}`);
  const th = Number(info.LockoutThreshold);
  console.log(`   Chính sách khóa: ${th === 0 ? 'KHÔNG khóa' : th + ' lần sai'} | thời gian khóa ${info.LockoutDuration} | cửa sổ đếm ${info.ObservationWindow}`);
  if (th > 0 && th <= Number(process.env.LOGIN_MAX_ATTEMPTS || 8)) warn(`LOGIN_MAX_ATTEMPTS (${process.env.LOGIN_MAX_ATTEMPTS || 8}) >= ngưỡng khóa của domain (${th}): AD có thể khóa tài khoản trước khi Portal kịp chặn. Hãy đặt LOGIN_MAX_ATTEMPTS nhỏ hơn ${th}.`);

  // 3. Trạng thái tài khoản
  const acc = await runPS(`Import-Module ActiveDirectory -ErrorAction Stop
    $a = Get-ADUser -Identity '${parsed.sam}' -Properties LockedOut, Enabled, PasswordExpired, PasswordLastSet, LastBadPasswordAttempt, BadLogonCount, AccountExpirationDate, MemberOf
    [PSCustomObject]@{ Sam = $a.SamAccountName; Enabled = $a.Enabled; LockedOut = $a.LockedOut; PasswordExpired = $a.PasswordExpired; PasswordLastSet = [string]$a.PasswordLastSet
      LastBadPasswordAttempt = [string]$a.LastBadPasswordAttempt; BadLogonCount = $a.BadLogonCount; AccountExpirationDate = [string]$a.AccountExpirationDate
      Groups = @($a.MemberOf | ForEach-Object { (($_ -split ',')[0]) -replace '^CN=', '' }) } | ConvertTo-Json -Compress`, 30000);
  if (!acc) bad(`Không đọc được tài khoản "${parsed.sam}" trong AD: ${runPS.lastErr}`);
  else {
    (acc.Enabled ? ok : bad)(`Enabled: ${acc.Enabled}`);
    (acc.LockedOut ? bad : ok)(`LockedOut: ${acc.LockedOut}${acc.LockedOut ? '  → Unlock-ADAccount -Identity ' + acc.Sam : ''}`);
    (acc.PasswordExpired ? bad : ok)(`PasswordExpired: ${acc.PasswordExpired} (đổi lần cuối: ${acc.PasswordLastSet || '?'})`);
    if (acc.AccountExpirationDate) warn(`Tài khoản có ngày hết hạn: ${acc.AccountExpirationDate}`);
    console.log(`   Lần sai mật khẩu gần nhất: ${acc.LastBadPasswordAttempt || '(chưa có)'} | BadLogonCount: ${acc.BadLogonCount}`);
    const groups = Array.isArray(acc.Groups) ? acc.Groups : acc.Groups ? [acc.Groups] : [];
    console.log(`   Vai trò trong Portal: ${adAuth.roleFromGroups(groups)} (nhóm trực tiếp: ${groups.join(', ') || 'không có'})`);
  }

  // 4. Nhật ký đăng nhập gần đây trong database của Portal
  try {
    const sqlite3 = require('sqlite3');
    const dbFile = process.env.DB_PATH ? path.resolve(root, process.env.DB_PATH) : path.join(root, 'itportal.db');
    if (fs.existsSync(dbFile)) {
      const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY);
      await new Promise(resolve => db.all("SELECT datetime(created_at,'localtime') AS t, status, ip FROM audit_log WHERE path LIKE '%/auth/login' AND lower(username) = lower(?) ORDER BY id DESC LIMIT 10", [parsed.sam], (e, rows) => {
        if (!e && rows.length) { console.log('\nĐăng nhập gần đây của tài khoản này (audit log):'); rows.forEach(r => console.log(`   ${r.t}  HTTP ${r.status}  ${r.ip}`)); }
        db.close(); resolve();
      }));
    }
  } catch (_) { /* không bắt buộc */ }

  // 5. Thử mật khẩu thật (tùy chọn)
  const pass = process.env.DIAG_PASSWORD || await askHidden(`\nNhập mật khẩu của "${parsed.sam}" để thử xác thực (Enter để bỏ qua): `);
  if (!pass) { console.log('Bỏ qua bước thử mật khẩu.'); return; }
  const t0 = Date.now();
  const result = await adAuth.authenticate(target, pass);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (result.ok) ok(`XÁC THỰC THÀNH CÔNG sau ${secs}s → vai trò ${result.user.role}, nhóm: ${result.user.groups.join(', ')}`);
  else if (result.reason === 'unavailable') bad(`AD/PowerShell lỗi (không phải sai mật khẩu) sau ${secs}s: ${result.detail}`);
  else bad(`Bị từ chối sau ${secs}s: ${result.reason}`);
  if (Number(secs) > 15) warn('Xác thực chậm (>15s): kiểm tra DNS/DC, ADWS và việc PowerShell khởi động chậm (antivirus quét powershell.exe).');
})().catch(error => { bad(error && error.stack || String(error)); process.exit(1); });
