#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
process.stdout.write(`INFO RG-ITPortal version ${packageInfo.version} | test root: ${root}\n`);
if (packageInfo.main !== 'server.js' || packageInfo.version !== '1.7.0') {
  process.stderr.write('FAIL package metadata: expected main=server.js and version=1.7.0\n');
  process.exitCode = 1;
}
const folders = ['routes', path.join('public', 'js'), 'scripts'];
const files = ['server.js', 'check.js', 'install-service.js', 'uninstall-service.js'];
for (const folder of folders) {
  const dir = path.join(root, folder);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(folder, entry.name));
  }
}
let failed = false;
for (const file of files) {
  const full = path.join(root, file);
  const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`FAIL ${file}\n${result.stderr || result.stdout}`);
  } else process.stdout.write(`OK   ${file}\n`);
}
const required = [
  'server.js', 'package.json', 'package-lock.json', '.env.example', 'START_PORTAL.cmd',
  'routes/ad.js', 'routes/auth.js', 'routes/ad-auth.js', 'routes/login-guard.js', 'routes/session-store.js', 'routes/docker.js', 'routes/utils.js',
  'public/index.html', 'public/css/style.css', 'public/js/app.js', 'public/js/ui9.js', 'public/js/auth.js',
  'public/views/ad.html', 'scripts/test-ad-query.js', 'scripts/test-ad-row-actions.js', 'scripts/test-flow.js',
  'scripts/check-env.js', 'scripts/test-login.js', 'scripts/diagnose-login.js', 'docs/CONFIGURATION.md', 'docs/SECURITY_OPERATIONS.md',
  'docs/AD_COMPUTER_MANAGEMENT.md', 'docs/CHANGELOG_v1.6.0.md', 'docs/CHANGELOG_v1.7.0.md', 'docs/LOGIN_TROUBLESHOOTING.md', 'README.md'
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) { failed = true; process.stderr.write(`FAIL missing ${file}\n`); }
}

// Validate the real HTML structure using element IDs and nested boxes, not attribute order.
const sidebarHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
function tagById(html, tagName, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${tagName}\\b(?=[^>]*\\bid=["']${escaped}["'])[^>]*>`, 'i');
  return html.match(re)?.[0] || '';
}
const sidebarChecks = {
  sidebarPanel: /class=["'][^"']*\bsidebar-column\b/i.test(tagById(sidebarHtml, 'aside', 'sidebarPanel')),
  sidebarShell: /class=["'][^"']*\bsidebar-shell\b/i.test(tagById(sidebarHtml, 'div', 'sidebarShell')),
  brandBox: /data-sidebar-section=["']brand["']/i.test(tagById(sidebarHtml, 'div', 'sidebarBrandBox')),
  menuBox: /class=["'][^"']*\bsidebar-menu-box\b/i.test(tagById(sidebarHtml, 'section', 'sidebarMenuBox')),
  scrollableNav: /class=["'][^"']*\bsidebar-nav\b/i.test(tagById(sidebarHtml, 'nav', 'scrollableNav')) && /data-scrollable=["']true["']/i.test(tagById(sidebarHtml, 'nav', 'scrollableNav')),
  footer: /class=["'][^"']*\bsidebar-footer\b/i.test(tagById(sidebarHtml, 'div', 'sidebarFooter')) && /data-sidebar-section=["']footer["']/i.test(tagById(sidebarHtml, 'div', 'sidebarFooter')),
  clockBox: /data-sidebar-section=["']clock["']/i.test(tagById(sidebarHtml, 'div', 'sidebarClockBox')),
  clock: /id=["']sidebarClockTime["']/.test(sidebarHtml),
  logout: /onclick=["']\s*logout\(\)\s*["']/.test(sidebarHtml),
  dashboardColumn: /class=["'][^"']*\bcol-md-10\b/i.test(tagById(sidebarHtml, 'main', 'dashboardMain')),
};
const sidebarOrder = ['sidebarBrandBox','sidebarMenuBox','scrollableNav','sidebarFooter','sidebarClockBox','dashboardMain']
  .map(id => sidebarHtml.indexOf(`id="${id}"`));
const sidebarOrderValid = sidebarOrder.every(i => i >= 0) && sidebarOrder.every((i, n) => n === 0 || sidebarOrder[n - 1] < i);
const menuBoxOpen = sidebarHtml.indexOf('id="sidebarMenuBox"');
const navPos = sidebarHtml.indexOf('id="scrollableNav"');
const menuBoxClose = sidebarHtml.indexOf('</section>', navPos);
const navInsideMenuBox = menuBoxOpen >= 0 && navPos > menuBoxOpen && menuBoxClose > navPos && menuBoxClose < sidebarHtml.indexOf('id="sidebarFooter"');
const sidebarMissing = Object.entries(sidebarChecks).filter(([, ok]) => !ok).map(([name]) => name);
if (sidebarMissing.length || !sidebarOrderValid || !navInsideMenuBox) {
  failed = true;
  const extra = [...sidebarMissing, ...(!sidebarOrderValid ? ['sections-in-order'] : []), ...(!navInsideMenuBox ? ['scrollableNav-inside-sidebarMenuBox'] : [])];
  process.stderr.write(`FAIL feature Fixed sidebar nav and footer: missing ${extra.join(', ')} in ${path.join(root, 'public/index.html')}\n`);
} else process.stdout.write('OK   feature Fixed sidebar nav and footer (separate brand/menu-box/scrollable nav/clock-footer sections)\n');

// Check compact dashboard and AD refresh controls using attribute-order-independent marker checks.
const adViewHtml = fs.readFileSync(path.join(root, 'public/views/ad.html'), 'utf8');
const dashboardToolbarTag = tagById(sidebarHtml, 'div', 'dashboardToolbar');
const dashboardRefreshTag = tagById(sidebarHtml, 'button', 'compactDashboardRefresh');
const adRefreshTagMatch = adViewHtml.match(/<button\b(?=[^>]*onclick=["']loadAD\(\)["'])[^>]*>/i);
const adRefreshTag = adRefreshTagMatch ? adRefreshTagMatch[0] : '';
const hasCompactToolbarRefresh = /data-dashboard-toolbar=["']true["']/i.test(dashboardToolbarTag)
  && /data-compact-dashboard-refresh=["']true["']/i.test(dashboardRefreshTag)
  && /class=["'][^"']*\bbtn-sm\b[^"']*\bpx-2\b[^"']*\btext-nowrap\b/i.test(dashboardRefreshTag)
  && /onclick=["']refreshCurrentView\(\)["']/i.test(dashboardRefreshTag)
  && /Làm mới/i.test(sidebarHtml);
const hasCompactADRefresh = /class=["'][^"']*\bbtn-sm\b[^"']*\bpx-2\b[^"']*\btext-nowrap\b/i.test(adRefreshTag)
  && /Làm mới/i.test(adRefreshTag);
if (!hasCompactToolbarRefresh || !hasCompactADRefresh) {
  failed = true;
  const missing = [!hasCompactToolbarRefresh ? 'dashboard toolbar/refresh marker in public/index.html' : null, !hasCompactADRefresh ? 'compact AD refresh marker in public/views/ad.html' : null].filter(Boolean);
  process.stderr.write(`FAIL feature Compact refresh button: missing ${missing.join(' and ')}\n`);
} else process.stdout.write('OK   feature Compact refresh button (dashboard toolbar + AD view)\n');

const featureChecks = [
  ['AD all-user scope', path.join(root, 'routes/ad.js'), "req.query.ou || '__ALL__'"],
  ['AD admin/unknown scopes', path.join(root, 'routes/ad.js'), "'__ADMINS__', '__UNKNOWN__'"],
  ['Computer diagnostics API', path.join(root, 'routes/ad.js'), "router.get('/computer-diagnostics'"],
  ['Computer diagnostics UI', path.join(root, 'public/js/app.js'), "adComputerDiagnostics"],
  ['Department OU parent config', path.join(root, '.env.example'), 'DEPT_PARENT_OU="Departments"'],
  ['Create OU and matching security group', path.join(root, 'routes/ad.js'), "New-ADGroup -Name '${psq(gn)}' -SamAccountName '${psq(gn)}' -GroupScope Global -GroupCategory Security -Path $ou.DistinguishedName"],
  ['Exact OU DistinguishedName lookup', path.join(root, 'routes/ad.js'), 'Get-ADOrganizationalUnit -Identity'],
  ['Computer inventory uses resolved search base', path.join(root, 'routes/ad.js'), 'Get-ADComputer -SearchBase $searchBase'],
  ['PowerShell JSON parser robustness', path.join(root, 'routes/utils.js'), 'function parsePowerShellJson(stdout)'],
  ['PowerShell runs complete script through temporary .ps1', path.join(root, 'routes/utils.js'), "spawn('powershell.exe'"],
  ['PowerShell temporary script cleanup', path.join(root, 'routes/utils.js'), 'fs.rmSync(tempDir'],
  ['Department OU groups API', path.join(root, 'routes/ad.js'), "router.get('/ou-groups'"],
  ['OU group member inventory UI', path.join(root, 'public/js/ui9.js'), 'loadADOUGroups9'],
  ['Edit user updates only row', path.join(root, 'public/js/ui9.js'), 'row.outerHTML = renderADUserRow9(updated)'],
  ['Lock/unlock uses local row update', path.join(root, 'public/js/ui9.js'), 'async function toggleADRow9(username)'],
  ['Delete user uses local row removal', path.join(root, 'public/js/ui9.js'), 'async function deleteADRow9(username)'],
  ['AD manager badge source fields', path.join(root, 'routes/ad.js'), 'IsManager=$isManager; ManagerOf=$managerOf'],
  ['Sidebar scroll overflow', path.join(root, 'public/css/style.css'), 'overflow-y: auto !important;'],
  ['Sidebar links do not wrap into columns', path.join(root, 'public/css/style.css'), 'flex-wrap: nowrap !important;'],
  ['Sidebar menu box and independent scroll area', path.join(root, 'public/css/style.css'), '#scrollableNav {'],
  ['Sidebar footer opaque separation', path.join(root, 'public/css/style.css'), 'background-color: var(--bg-card) !important;'],
  ['Sidebar decorative box borders removed', path.join(root, 'public/css/style.css'), 'border: 0 !important;'],
  ['Sidebar clock blue outline', path.join(root, 'public/css/style.css'), 'border: 1px solid #38bdf8 !important;'],
  ['Larger top-left logo', path.join(root, 'public/css/style.css'), 'font-size: 1.55rem !important;'],
  ['SQLite absolute path and WAL', path.join(root, 'server.js'), 'PRAGMA journal_mode = WAL'],
  ['Database-backed health endpoint', path.join(root, 'server.js'), 'SELECT 1 AS ok'],
  ['Configurable server port', path.join(root, 'server.js'), 'parsePort(process.env.PORT)'],
  ['Smart quote PowerShell escaping', path.join(root, 'routes/utils.js'), ".replace(/’/g, '’’')"],
  ['Sidebar divider between menu and dashboard', path.join(root, 'public/css/style.css'), 'border-right: 1px solid var(--border-card) !important;'],
  ['Sidebar menu scroll layout', path.join(root, 'public/css/style.css'), 'grid-template-rows: auto minmax(0, 1fr) auto;'],
  ['AD refresh is not stretched full width', path.join(root, 'public/views/ad.html'), 'btn btn-outline-secondary btn-sm px-2 text-nowrap'],
  ['Computer panel close action removed', path.join(root, 'public/js/app.js'), 'loadADComputerDiagnostics9();refreshADComputers()'],
  ['Computer state initialized before handlers', path.join(root, 'public/js/app.js'), 'var adComputerOUs = [];'],
  ['Persistent SQLite session store', path.join(root, 'server.js'), 'new SQLiteSessionStore('],
  ['Per-account login guard', path.join(root, 'server.js'), 'createLoginGuard()'],
  ['Login UI handles AD errors', path.join(root, 'public/js/auth.js'), 'Đang xác thực với Active Directory'],
  ['ENV preserves pfSense stable target', path.join(root, '.env.example'), 'PFSENSE_SSH_HOST=\"192.168.10.1\"'],
];
for (const [label, file, needle] of featureChecks) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes(needle)) { failed = true; process.stderr.write(`FAIL feature ${label}: missing marker\n`); }
  else process.stdout.write(`OK   feature ${label}\n`);
}
// This is a private recovery bundle by user request: .env and itportal.db are intentionally included.
if (!fs.existsSync(path.join(root, '.env'))) { failed = true; process.stderr.write('FAIL missing .env (private ready-to-run bundle)\n'); }
if (!fs.existsSync(path.join(root, 'itportal.db'))) { failed = true; process.stderr.write('FAIL missing itportal.db (private ready-to-run bundle)\n'); }
process.stdout.write('INFO private bundle includes .env and itportal.db; keep the ZIP confidential.\n');
if (failed) process.exit(1);
console.log('Source smoke-check passed (syntax/required files/static feature checks).');
