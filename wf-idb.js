/* wf-idb.js — minimal promise-based IndexedDB key/value store.
 *
 * WHY INDEXEDDB AND NOT localStorage
 * The expense snapshot can run to hundreds of KB. localStorage is synchronous:
 * reading or writing a payload that size blocks the main thread, which on a
 * mid-range phone is exactly the jank this cache exists to remove. IndexedDB is
 * async, so a large snapshot never stalls rendering.
 *
 * Scope: one object store, string keys, structured-cloneable values. No schema
 * migrations, no indexes — this is a cache, and a cache miss is always safe.
 *
 * Every method resolves rather than rejects on failure (private browsing, quota
 * exceeded, IDB disabled). Callers treat an error as a cache miss and fall back
 * to the network, so a broken cache degrades to today's behaviour instead of
 * breaking the page.
 */
(function () {
  "use strict";

  var DB_NAME = "wf-cache";
  var STORE = "kv";
  var DB_VERSION = 1;
  var _dbPromise = null;

  function openDb() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve) {
      if (typeof indexedDB === "undefined") { resolve(null); return; }
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    });
    return _dbPromise;
  }

  function withStore(mode, fn) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx, store;
        try {
          tx = db.transaction(STORE, mode);
          store = tx.objectStore(STORE);
        } catch (e) { resolve(null); return; }
        var out = null;
        try { out = fn(store); } catch (e) { resolve(null); return; }
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : null); };
        tx.onerror = function () { resolve(null); };
        tx.onabort = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function idbGet(key) {
    return withStore("readonly", function (store) { return store.get(key); });
  }

  function idbSet(key, value) {
    return withStore("readwrite", function (store) { return store.put(value, key); });
  }

  function idbDelete(key) {
    return withStore("readwrite", function (store) { return store.delete(key); });
  }

  // Drop everything. Used on sign-out so the next user on a shared device cannot
  // read the previous user's cached records.
  function idbClear() {
    return withStore("readwrite", function (store) { return store.clear(); });
  }

  window.WfIdb = { get: idbGet, set: idbSet, remove: idbDelete, clear: idbClear };
})();
