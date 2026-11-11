'use strict';
// Helper dùng chung cho test: nạp sqlite3 thật; nếu binary sqlite3 không chạy được trên máy test (khác nền tảng) thì dùng node:sqlite (Node 22+).
function loadSqliteForFlowTest() {
  try {
    return require('sqlite3').verbose();
  } catch (error) {
    // The production app still requires the sqlite3 package. On Node 22+, a test-only
    // adapter lets us exercise SQL and HTTP flow tests when npm registry access is
    // temporarily unavailable in the build container. It never ships into the app.
    const isMissingPackage = error.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'sqlite3'");
    const isForeignNativeBinary = process.platform !== 'win32' && error.code === 'ERR_DLOPEN_FAILED' && /node_sqlite3\.node/i.test(String(error.message));
    if (!isMissingPackage && !isForeignNativeBinary) throw error;
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 22) throw error;
    const { DatabaseSync } = require('node:sqlite');
    class FlowTestDatabase {
      constructor(filename) { this.inner = new DatabaseSync(filename); }
      configure() { return this; }
      serialize(callback) { callback(); return this; }
      run(sql, params, callback) {
        let values = params, done = callback;
        if (typeof values === 'function') { done = values; values = []; }
        if (!Array.isArray(values)) values = values == null ? [] : [values];
        try {
          const result = this.inner.prepare(sql).run(...values);
          if (done) queueMicrotask(() => done.call({ changes: Number(result.changes), lastID: Number(result.lastInsertRowid) }, null));
        } catch (err) {
          if (done) queueMicrotask(() => done.call({ changes: 0, lastID: undefined }, err));
          else throw err;
        }
        return this;
      }
      get(sql, params, callback) {
        let values = params, done = callback;
        if (typeof values === 'function') { done = values; values = []; }
        if (!Array.isArray(values)) values = values == null ? [] : [values];
        try { const row = this.inner.prepare(sql).get(...values); if (done) queueMicrotask(() => done(null, row)); }
        catch (err) { if (done) queueMicrotask(() => done(err)); else throw err; }
        return this;
      }
      all(sql, params, callback) {
        let values = params, done = callback;
        if (typeof values === 'function') { done = values; values = []; }
        if (!Array.isArray(values)) values = values == null ? [] : [values];
        try { const rows = this.inner.prepare(sql).all(...values); if (done) queueMicrotask(() => done(null, rows)); }
        catch (err) { if (done) queueMicrotask(() => done(err)); else throw err; }
        return this;
      }
      close(callback) {
        try { this.inner.close(); if (callback) queueMicrotask(() => callback(null)); }
        catch (err) { if (callback) queueMicrotask(() => callback(err)); else throw err; }
      }
    }
    const adapter = { Database: FlowTestDatabase, verbose() { return this; } };
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === 'sqlite3') return adapter;
      return Reflect.apply(originalLoad, this, [request, parent, isMain]);
    };
    console.warn('INFO flow-test: sqlite3 package not installed in this environment; using Node built-in node:sqlite test adapter because the bundled sqlite3 native binary targets Windows. Production uses the platform-native sqlite3 package.');
    return adapter;
  }
}

module.exports = { loadSqliteForFlowTest };
