#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const { parsePowerShellJson } = require('../routes/utils');

const parserCases = [
  ['compact list after console noise', 'WARNING: harmless message\n[{"Name":"IT"},{"Name":"HR"}]', [{ Name: 'IT' }, { Name: 'HR' }]],
  ['compact object with nested data', 'status: complete\n{"Items":[{"Name":"PC01"}],"Total":1}', { Items: [{ Name: 'PC01' }], Total: 1 }],
  ['pretty object with nested entries', 'text before JSON\n{\n "Items": [\n  {"Name":"PC01"}\n ],\n "Total": 1\n}', { Items: [{ Name: 'PC01' }], Total: 1 }],
  ['boolean false remains a real result', '{"success":false,"error":"access denied"}', { success: false, error: 'access denied' }],
];
for (const [name, input, expected] of parserCases) {
  assert.deepEqual(parsePowerShellJson(input), expected, name);
  console.log(`PASS ${name}`);
}

const ad = fs.readFileSync(path.join(root, 'routes/ad.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/js/ui9.js'), 'utf8');
const computersUI = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
assert.match(ad, /Get-ADOrganizationalUnit -Identity '\$\{psq\(requestedOU\)\}'/);
assert.match(ad, /Get-ADUser -Filter \* -SearchBase \$dept\.DistinguishedName -SearchScope Subtree/);
assert.match(ad, /Get-ADComputer -SearchBase \$searchBase -SearchScope Subtree -Filter \*/);
assert.match(ad, /router\.get\('\/computer-diagnostics'/);
assert.match(ad, /router\.get\('\/ou-groups'/);
assert.match(ad, /Get-ADGroup -Filter \* -SearchBase \$dept\.DistinguishedName -SearchScope Subtree/);
assert.match(ad, /Get-ADGroupMember -Identity \$g -Recursive/);
assert.match(ad, /router\.get\('\/user-diagnostics'/);
assert.match(ad, /okDeptSelection/);
assert.match(ad, /IsManager=\$isManager; ManagerOf=\$managerOf/);
assert.match(ad, /Properties ManagedBy/);
assert.match(ad, /Department = \$ou\.Name/);
assert.match(ui, /const dn = o\.DistinguishedName \|\| o\.Name/);
assert.match(ui, /encodeURIComponent\(AD_SELECTED_OU9\)/);
assert.match(ui, /adEditForm.*onsubmit/s);
assert.doesNotMatch(ui, /location\.reload/);
assert.match(ui, /loadADUsers9\(\)/);
assert.match(ui, /function renderADUserRow9\(u\)/);
assert.match(ui, /row\.outerHTML = renderADUserRow9\(updated\)/);
assert.match(ui, /async function toggleADRow9\(username\)/);
assert.match(ui, /async function deleteADRow9\(username\)/);
const toggleHandler = ui.match(/async function toggleADRow9\(username\) \{([\s\S]*?)\n\}/)?.[1] || '';
const deleteHandler = ui.match(/async function deleteADRow9\(username\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.ok(toggleHandler.length > 0 && !/\b(loadAD9|loadADUsers9|loadAD)\s*\(/.test(toggleHandler), 'Lock/unlock must update only the affected row.');
assert.ok(deleteHandler.length > 0 && !/\b(loadAD9|loadADUsers9|loadAD)\s*\(/.test(deleteHandler), 'Delete must remove only the affected row, not reload the user list.');
assert.match(toggleHandler, /currentADUsers\[index\] = updated/);
assert.match(toggleHandler, /currentRow\.outerHTML = renderADUserRow9\(updated\)/);
assert.match(deleteHandler, /currentADUsers\.splice\(index, 1\)/);
assert.match(deleteHandler, /findADUserRow9\(username\)\?\.remove\(\)/);
assert.match(ui, /fetch\(`\/api\/ad\/ou-groups\?ou=/);
assert.match(ui, /managerBadge = u\.IsManager === true/);
const indexHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const adViewHtml = fs.readFileSync(path.join(root, 'public/views/ad.html'), 'utf8');
// v1.6.0+ sidebar keeps distinct logo/menu/footer regions without decorative outlines; the single right divider separates dashboard content.
assert.match(indexHtml, /id="sidebarPanel"/);
assert.match(indexHtml, /class="[^"]*sidebar-column[^"]*"/);
assert.match(indexHtml, /id="sidebarShell"/);
assert.match(indexHtml, /class="[^"]*sidebar-shell[^"]*"/);
assert.match(indexHtml, /id="sidebarBrandBox"/);
assert.match(indexHtml, /id="sidebarMenuBox"/);
assert.match(indexHtml, /class="[^"]*sidebar-menu-box[^"]*"/);
assert.match(indexHtml, /id="scrollableNav"/);
assert.match(indexHtml, /data-scrollable="true"/);
assert.match(indexHtml, /id="sidebarFooter"/);
assert.match(indexHtml, /id="sidebarClockBox"/);
assert.match(indexHtml, /id="sidebarClockTime"/);
assert.match(indexHtml, /onclick="logout\(\)"/);
assert.match(indexHtml, /id="dashboardMain"/);
assert.match(indexHtml, /id="dashboardToolbar"/);
assert.match(indexHtml, /id="compactDashboardRefresh"/);
assert.ok(indexHtml.indexOf('id="sidebarBrandBox"') < indexHtml.indexOf('id="sidebarMenuBox"'));
assert.ok(indexHtml.indexOf('id="sidebarMenuBox"') < indexHtml.indexOf('id="scrollableNav"'));
assert.ok(indexHtml.indexOf('id="scrollableNav"') < indexHtml.indexOf('</section>', indexHtml.indexOf('id="scrollableNav"')));
assert.ok(indexHtml.indexOf('</section>', indexHtml.indexOf('id="scrollableNav"')) < indexHtml.indexOf('id="sidebarFooter"'));
assert.match(css, /\.sidebar-shell \{[\s\S]*?display:\s*grid(?:\s*!important)?;[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/);
assert.match(css, /#scrollableNav \{[\s\S]*?overflow-y:\s*auto !important;/);
assert.match(css, /#scrollableNav \{[\s\S]*?flex-wrap:\s*nowrap !important;/);
assert.match(css, /\.sidebar-menu-box \{[\s\S]*?overflow:\s*hidden !important;/);
assert.match(css, /\.sidebar-footer \{[\s\S]*?background-color:\s*var\(--bg-card\) !important;[\s\S]*?box-shadow:\s*none;/);
assert.match(css, /\.sidebar-brand-box \{[\s\S]*?border:\s*0 !important;/);
assert.match(css, /\.sidebar-menu-box \{[\s\S]*?border:\s*0 !important;/);
assert.match(css, /\.sidebar-footer \{[\s\S]*?border:\s*0 !important;/);
assert.match(css, /\.sidebar-clock-card \{[\s\S]*?border:\s*1px solid #38bdf8 !important;/);
assert.match(css, /#sidebarBrandBox \.sidebar-brand-content h5 \{ font-size: 1\.55rem !important;/);
assert.match(css, /\.sidebar-clock-card \{[\s\S]*?background-color:\s*var\(--bg-card\) !important;/);
assert.match(css, /\.sidebar-column \{[\s\S]*?border-right:\s*1px solid var\(--border-card\) !important;/);
assert.match(css, /@media \(max-width: 767\.98px\)[\s\S]*?\.sidebar-column/);
assert.match(adViewHtml, /btn btn-outline-secondary btn-sm px-2 text-nowrap[\s\S]*?onclick="loadAD\(\)"/);
assert.doesNotMatch(adViewHtml, /onclick="loadAD\(\)" class="[^"]*w-100/);
assert.doesNotMatch(computersUI, /class=\"btn btn-sm btn-outline-secondary\" onclick=\"document\.getElementById\('adComputersPanel'\)\.classList\.add\('d-none'\)\">Đóng/);
assert.match(computersUI, /ouSel\.value='__ALL__'/);
assert.match(computersUI, /\/api\/ad\/computers\?ou=/);
assert.match(envExample, /DEPT_PARENT_OU="Departments"/);
assert.match(ad, /const gn = \('G_' \+ slug\)\.slice\(0, 40\)/);
assert.match(ad, /New-ADOrganizationalUnit -Name '\$\{psq\(n\)\}' -Path \$par\.DistinguishedName -PassThru -ErrorAction Stop/);
assert.match(ad, /New-ADGroup -Name '\$\{psq\(gn\)\}' -SamAccountName '\$\{psq\(gn\)\}' -GroupScope Global -GroupCategory Security -Path \$ou\.DistinguishedName/);
assert.match(envExample, /COMPUTER_MANAGED_OUS="Client_Computers,IT,Sales,HR,Quarantine"/);
assert.match(envExample, /PFSENSE_SSH_HOST="192\.168\.10\.1"/);
const utils = fs.readFileSync(path.join(root, 'routes/utils.js'), 'utf8');
assert.match(utils, /spawn\('powershell\.exe'/);
assert.match(utils, /'-File', scriptPath/);
assert.match(utils, /fs\.mkdtempSync/);
assert.match(utils, /fs\.rmSync\(tempDir/);
assert.doesNotMatch(utils, /'-EncodedCommand'/);
assert.ok(computersUI.indexOf('var adComputerOUs = [];') < computersUI.indexOf('async function loadADComputers()'));
console.log('PASS AD OU scope/query contract');
console.log('PASS Computer inventory/diagnostics contract');
console.log('PASS environment configuration contract');
console.log('PASS PowerShell temporary script execution');
console.log('PASS OU user list, local row update and department group inventory');
console.log('PASS lock/unlock updates only one user row');
console.log('PASS delete removes only one user row');
console.log('PASS OU manager badges and scrollable fixed sidebar layout');
console.log('AD query tests passed (static + JSON contract checks; no live AD connection performed).');
