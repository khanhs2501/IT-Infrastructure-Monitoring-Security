'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/ui9.js'), 'utf8');
const start = source.indexOf('function findADUserIndex9(username)');
const end = source.indexOf('window.loadAD = loadAD9;', start);
assert.ok(start >= 0 && end > start, 'Could not locate local AD row-action handlers');
const handlerSource = source.slice(start, end);

function makeRow(username) {
  const button = { disabled: false, innerHTML: '<i class="fa-solid fa-action"></i>' };
  return {
    dataset: { adUserRow: username },
    removed: false,
    lastOuterHTML: '',
    querySelector(selector) {
      if (selector.includes('data-ad-user-action="toggle"') || selector.includes('data-ad-user-action="delete"')) return button;
      return null;
    },
    set outerHTML(value) { this.lastOuterHTML = value; },
    remove() { this.removed = true; },
    button
  };
}

async function main() {
  const rows = [makeRow('alice')];
  const footer = { textContent: '' };
  const search = { value: '' };
  const caption = { textContent: 'Tất cả user trong Domain' };
  const body = {
    innerHTML: '',
    querySelector(selector) {
      if (selector === '[data-ad-user-row]') return rows.find(row => !row.removed) || null;
      return null;
    }
  };
  const elements = { adUserFooter: footer, adUserSearch: search, adSelectedOUCaption: caption, adUserList: body };
  const user = { Username: 'alice', FullName: 'Alice Nguyen', Department: 'IT', PrimaryGroup: 'Domain Users', Enabled: true, IsInDepartments: true };
  const users = [user];
  const fetchCalls = [];
  const notices = [];
  let groupPanelRefreshes = 0;
  let rowRenders = 0;
  const windowObj = { confirm: () => true };
  const context = {
    currentADUsers: users,
    document: { querySelectorAll: () => rows.filter(row => !row.removed) },
    window: windowObj,
    $: id => elements[id] || null,
    esc: value => String(value),
    toast: (message, type) => notices.push({ message, type }),
    renderADUserRow9: value => { rowRenders++; return `<tr data-ad-user-row="${value.Username}">${value.Enabled ? 'Enabled' : 'Disabled'}</tr>`; },
    loadADOUGroups9: async () => { groupPanelRefreshes++; },
    fetch: async (url, options) => { fetchCalls.push({ url, options }); return { ok: true, json: async () => ({ Success: true }) }; },
    console
  };
  vm.createContext(context);
  vm.runInContext(handlerSource, context, { filename: 'ui9-local-action-handlers.js' });

  await context.window.toggleAD('alice');
  assert.equal(users.length, 1, 'Lock/unlock should preserve the current list');
  assert.equal(users[0].Enabled, false, 'Lock should update the cached Enabled state');
  assert.equal(rows[0].lastOuterHTML.includes('Disabled'), true, 'Lock should rerender only the affected row');
  assert.equal(fetchCalls.length, 1, 'Lock should make only the action API request');
  assert.match(fetchCalls[0].url, /\/api\/ad\/users\/alice\/toggle$/);
  assert.equal(rowRenders, 1);
  assert.equal(groupPanelRefreshes, 0, 'Lock should not reload the user/group lists');
  assert.match(footer.textContent, /^1 user/);

  await context.window.deleteAD('alice');
  assert.equal(users.length, 0, 'Delete should remove only the deleted user from the cache');
  assert.equal(rows[0].removed, true, 'Delete should remove only the selected row');
  assert.match(body.innerHTML, /Không còn user/);
  assert.equal(fetchCalls.length, 2, 'Delete should make only the action API request, not a user-list query');
  assert.equal(fetchCalls[1].options.method, 'DELETE');
  assert.equal(groupPanelRefreshes, 1, 'Delete can refresh the OU group/member panel only');
  assert.match(footer.textContent, /^0 user/);
  console.log('PASS lock/unlock updates one row without reloading the user list');
  console.log('PASS delete removes one row without reloading the user list');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
