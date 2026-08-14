// Shared page boot: pull the user's cloud settings into localStorage, then start
// the app against them.
//
// This lived inline in dashboard.html and nowhere else, which was the whole
// problem. settings.html loaded script.js with a plain synchronous <script> tag
// and read whatever localStorage happened to hold — so opening Settings directly
// on a fresh device or browser (a bookmark, the PWA shortcut, a pasted URL — any
// route that does not pass through the dashboard first) showed every sheet URL
// and the entire GitHub section EMPTY, while the cloud held them all along. That
// alone is the "my settings disappeared" report; pressing Save then wrote the
// blanks back over the real values on every device.
//
// One module, used by both pages, so the two cannot drift again.
(function () {
  "use strict";

  var W = window;

  function loggedIn() {
    return !!(W.WfAuth && W.WfAuth.isLoggedIn && W.WfAuth.isLoggedIn());
  }

  // Cloud-first seed of the sheet-data cache. Google Sheets stays the source of
  // truth; this table is a synced cache so a fresh device/browser sees the same
  // rows without re-entering URLs. Fail-safe: a bad/empty/mis-shaped blob is
  // SKIPPED (never clobbers good local data), each prefix is isolated, and any
  // failure falls back to whatever is already in localStorage.
  function seedSheetDataFromCloud() {
    if (!W.WfAuth || !W.WfAuth.loadAllSheetData) return Promise.resolve();
    return W.WfAuth.loadAllSheetData().then(function (list) {
      if (!Array.isArray(list)) return;
      list.forEach(function (entry) {
        try {
          if (!entry || !entry.prefix) return;
          var rows = entry.rows;
          // shape guard: skip null / empty / non-array — keeps local for that prefix
          if (!Array.isArray(rows) || rows.length === 0) return;
          localStorage.setItem("wf-" + entry.prefix + "-data", JSON.stringify(rows));
        } catch (e) { /* one bad prefix never blocks the others */ }
      });
    }).catch(function () { /* offline / error → keep local cache */ });
  }

  // Resolves when the settings are in localStorage (or the attempt has failed —
  // a sync that cannot complete must never stop the page loading). Runs at most
  // once per page; the session flag makes it once per SESSION for the heavy
  // sheet-data seed, while the settings read itself is cheap and always current.
  var _pending = null;

  function cloudSync(opts) {
    if (_pending) return _pending;
    if (!loggedIn()) return (_pending = Promise.resolve());

    var seedDone = false;
    try { seedDone = sessionStorage.getItem("wf-cloud-synced") === "1"; } catch (e) {}

    // Settings are read on EVERY page load, not once per session: they are one
    // small row, and reading them is what lets a page know whether an empty local
    // value is a real edit or just ignorance (see saveSettingsToCloud). The bulky
    // sheet-data seed keeps the once-per-session flag it always had.
    _pending = W.WfAuth.loadSettingsFromCloud().catch(function () {})
      .then(function () { return seedDone ? null : seedSheetDataFromCloud(); })
      .then(function () {
        try { sessionStorage.setItem("wf-cloud-synced", "1"); } catch (e) {}
      })
      .catch(function () { /* a failed sync must never block the app */ });

    return _pending;
  }

  // Start `src` once the sync has landed, or after `timeoutMs` if it has not.
  //
  // The timeout is why the app can still come up wrong: on a slow connection it
  // fires first and the page is built from stale localStorage. script.js listens
  // for "wf-cloud-settings-loaded" and recomputes when the values that arrive
  // afterwards differ from the ones it was built with — that listener is the
  // other half of this, and for a long time it did not exist.
  function injectAfterSync(src, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs == null ? 4000 : opts.timeoutMs;
    var readyEvent = opts.readyEvent || "wf-app-ready";
    var started = false;

    function start(viaTimeout) {
      if (started) return;
      started = true;
      _startedOnTimeout = viaTimeout === true;
      var el = document.createElement("script");
      el.src = src;
      el.onload = function () { document.dispatchEvent(new Event(readyEvent)); };
      el.onerror = function () { document.dispatchEvent(new Event(readyEvent)); };
      document.head.appendChild(el);
    }

    cloudSync().then(function () { start(false); }, function () { start(false); });
    setTimeout(function () { start(true); }, timeoutMs);
  }

  // True when the app was started by the timeout rather than by a completed
  // sync — i.e. the page was built from localStorage that the cloud had not yet
  // confirmed. Only in that case is a second settings read worth a round trip.
  var _startedOnTimeout = false;
  function startedOnTimeout() { return _startedOnTimeout; }

  W.WfBoot = {
    cloudSync: cloudSync,
    injectAfterSync: injectAfterSync,
    startedOnTimeout: startedOnTimeout
  };
})();
