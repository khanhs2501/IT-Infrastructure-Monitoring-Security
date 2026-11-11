#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');

if (!fs.existsSync(envPath)) {
  console.error('FAIL: Missing .env. Restore it from your protected backup; do not publish credentials.');
  process.exit(1);
}
dotenv.config({ path: envPath });
let failed = false;
const pass = label => console.log(`OK   ${label}`);
const fail = label => { failed = true; console.error(`FAIL ${label}`); };
const secret = String(process.env.SESSION_SECRET || '').trim();
if (secret.length >= 32 && !/^(?:REPLACE_|CHANGE_ME|YOUR_SECRET|PUT_YOUR_)/i.test(secret)) pass('SESSION_SECRET is set and long enough');
else fail('SESSION_SECRET must be a non-placeholder random secret of at least 32 characters');
const portText = String(process.env.PORT || '80').trim();
const port = Number(portText);
if (Number.isInteger(port) && port >= 1 && port <= 65535) pass(`PORT is valid (${port})`);
else fail('PORT must be an integer from 1 to 65535');
const retention = Number(process.env.AUDIT_RETENTION_DAYS || 180);
if (Number.isInteger(retention) && retention >= 1 && retention <= 3650) pass('AUDIT_RETENTION_DAYS is valid');
else fail('AUDIT_RETENTION_DAYS must be an integer from 1 to 3650');
const dbPath = String(process.env.DB_PATH || '').trim();
if (!dbPath || path.isAbsolute(dbPath)) pass('DB_PATH is absolute or uses the project-local default');
else fail('DB_PATH must be absolute or empty');

// --- Đăng nhập & phiên (v1.7.0) ---
const intIn = (name, min, max, fallback) => {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return true;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= min && n <= max) return true;
  fail(`${name} must be an integer from ${min} to ${max} (default ${fallback})`);
  return false;
};
if (intIn('SESSION_HOURS', 1, 168, 12) && intIn('LOGIN_MAX_ATTEMPTS', 3, 100, 8) && intIn('LOGIN_WINDOW_MINUTES', 1, 1440, 10) && intIn('LOGIN_IP_MAX_ATTEMPTS', 10, 100000, 120)) pass('Login/session settings are valid');
const cookieSetting = String(process.env.COOKIE_SECURE ?? '').trim().toLowerCase();
if (cookieSetting === 'true') console.warn('WARN COOKIE_SECURE=true: browsers drop the session cookie on plain http:// (login appears to succeed then logs out). Use "auto" or "false" unless the Portal is served over HTTPS.');
else if (!['', 'auto', 'false', '0', 'no', 'off', '1', 'yes', 'on'].includes(cookieSetting)) fail('COOKIE_SECURE must be auto, true or false');
else pass(`COOKIE_SECURE=${cookieSetting || 'auto'} is valid`);
for (const key of ['ZABBIX_URL', 'INDEXER_URL', 'LINUX_SSH_HOST', 'PFSENSE_SSH_HOST']) {
  if (String(process.env[key] || '').trim()) pass(`${key} configured`);
  else console.warn(`WARN ${key} not configured; the related integration will not work until configured.`);
}
if (failed) process.exit(1);
console.log('Environment validation passed. Secret values were not displayed.');
