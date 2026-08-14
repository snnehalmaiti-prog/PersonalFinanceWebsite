#!/usr/bin/env node
// Guard: the dashboard's load path.
//
// Two things here are easy to undo by accident and expensive when undone.
//
// 1. The first-of-session cloud settings sync used to end in location.reload(),
//    which meant a second FULL page load — HTML, CSS, the 687 KB script.js, all
//    four expense tables and the market JSON, fetched and parsed twice. Measured
//    at 4x CPU / 4 Mbps that was 3842 KB of Supabase payload instead of 1682 KB.
//    script.js is now injected after the sync resolves instead.
//
// 2. expense_records is fetched with an explicit column projection. select=*
//    ships user_id — a 36-char UUID on every row — which the client never reads.
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
// The sync + injection moved out of dashboard.html into a module both pages
// share, because settings.html had none of it and rendered a blank settings form
// on any device that had not visited the dashboard first. The invariants below
// are unchanged — only where they live — so they are asserted over both files.
const BOOT = fs.readFileSync(path.join(ROOT, "wf-boot.js"), "utf8");
const SETTINGS = fs.readFileSync(path.join(ROOT, "settings.html"), "utf8");
const LOAD = HTML + "\n" + BOOT;

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

// ── 1. no reload in the sync path ──────────────────────────────────────────
const syncBlock = LOAD.slice(LOAD.indexOf("wf-cloud-synced"), LOAD.indexOf("wf-cloud-synced") + 2500);
check(!/location\.reload\(\)/.test(syncBlock),
  "the cloud-sync path must not end in location.reload() — that is a second full page load per session");
check(/window\.__wfCloudSync\s*=/.test(HTML),
  "the sync must publish a promise (__wfCloudSync) for the script injection to wait on");
check(/WfBoot\.injectAfterSync\("script\.js\?v=__ASSET_VERSION__"\)/.test(HTML) && /el\.src = src/.test(BOOT),
  "script.js must be injected after the sync resolves");
check(!/<script src="script\.js\?v=__ASSET_VERSION__"><\/script>/.test(HTML),
  "script.js must NOT also be declared as a static tag, or it loads and runs twice");
check(/<link rel="preload" as="script" href="script\.js\?v=__ASSET_VERSION__">/.test(HTML),
  "script.js must be preloaded, or injecting it late costs a serial download");
// The injection must not be able to hang forever on a stalled sync.
check(/setTimeout\(function \(\) \{ start\(true\); \}, timeoutMs\)/.test(BOOT),
  "the injection needs a timeout fallback so a hung sync cannot strand the app");
check(/document\.dispatchEvent\(new Event\(readyEvent\)\)/.test(BOOT) &&
      /el\.onerror = function \(\) \{ document\.dispatchEvent/.test(BOOT),
  "wf-app-ready must fire on error too, or a failed script.js leaves the user menu unwired");

// ── 1b. BOTH pages sync before reading settings ────────────────────────────
// settings.html used to read whatever localStorage held. On a device that had
// never opened the dashboard, sessionStorage["wf-cloud-synced"] was unset and
// nothing had ever synced, so every sheet URL and the whole GitHub section
// rendered EMPTY while the cloud held them — and Save wrote the blanks back,
// because an empty string is not null and survived saveSettingsToCloud's skip.
check(/wf-boot\.js\?v=__ASSET_VERSION__/.test(HTML),
  "dashboard.html must load the shared boot module");
check(/wf-boot\.js\?v=__ASSET_VERSION__/.test(SETTINGS),
  "settings.html must load the shared boot module — without it a fresh device shows a blank settings form");
check(/WfBoot\.cloudSync\(\)/.test(SETTINGS),
  "settings.html must start the cloud sync itself, not rely on the dashboard having run first");
check(SETTINGS.indexOf("WfBoot.cloudSync()") < SETTINGS.indexOf('src="script.js'),
  "settings.html must start the sync BEFORE script.js reads localStorage");
check(/dispatchEvent\(new Event\("wf-cloud-settings-loaded"\)\)/.test(SETTINGS),
  "settings.html must announce the sync so the sheet cards and GitHub panel refill");

// ── 1c. the recovery event has a listener ──────────────────────────────────
// The dispatch existed for a long time with nothing listening anywhere in the
// repo, so the recompute its own comment promised never ran: on any load where
// the sync lost the 4-second race, every tab rendered stale numbers and stayed
// that way until a manual reload.
const SCRIPT = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
check(/addEventListener\("wf-cloud-settings-loaded"/.test(SCRIPT),
  "script.js must LISTEN for wf-cloud-settings-loaded — a dispatch with no listener is a recovery path that does not exist");
// Named specifically, because script.js grew several listeners for this event
// (the GitHub panel refill, the sheet-card rebuild) and any one of them satisfies
// the check above while the RECOMPUTE — the thing the dispatch exists for —
// stays missing.
check(/function _cloudSettingsFingerprint\(\)/.test(SCRIPT),
  "the recompute must compare what arrived against what the page was built with");
const recompute = SCRIPT.slice(SCRIPT.indexOf("var _cloudSettingsSeen = _cloudSettingsFingerprint();"));
const recomputeBody = recompute.slice(0, recompute.indexOf("\n  });"));
check(/addEventListener\("wf-cloud-settings-loaded"/.test(recomputeBody),
  "the fingerprint must be consumed by a wf-cloud-settings-loaded listener");
["updateDashboardStats()", "renderValueChart()", "renderInvestmentSplitChart()",
 "renderInstrumentSplitChart()", "renderMonthlyCashFlow()"].forEach(function (call) {
  check(recomputeBody.indexOf(call) !== -1,
    "the recompute must re-run " + call + " — stale numbers are the whole reason the event exists");
});
check(/_invalidateSheetRows/.test(recomputeBody),
  "the recompute must drop the cached sheet rows first, or it re-renders the same stale data");
check(/if \(now === _cloudSettingsSeen\) return;/.test(recomputeBody),
  "the recompute must no-op when nothing changed, or every load pays a second full render");
// Every event this app dispatches should have a listener somewhere. Cheap sweep.
const ALL = HTML + BOOT + SETTINGS + SCRIPT +
  fs.readFileSync(path.join(ROOT, "expense.js"), "utf8") +
  fs.readFileSync(path.join(ROOT, "supabase-client.js"), "utf8");
const dispatched = new Set();
(ALL.match(/new (?:Custom)?Event\("([a-z-]+)"/g) || []).forEach(function (m) {
  dispatched.add(m.replace(/.*"([a-z-]+)"/, "$1"));
});
dispatched.forEach(function (name) {
  check(ALL.indexOf('addEventListener("' + name + '"') !== -1,
    'nothing listens for the dispatched event "' + name + '"');
});

// ── 2. the expense projection covers every column the client reads ─────────
const m = HTML.match(/WfDb\.select\("expense_records",\s*([\s\S]*?)\)\s*\n/);
check(!!m, "the expense_records select could not be found");
if (m) {
  const projection = m[1];
  check(projection.indexOf("select=*") === -1,
    "expense_records must not use select=* — user_id alone is 36 chars on every row");
  // Columns the record row is written with, plus the server-assigned ones. If a
  // new column is added to the insert, it must be added here too or reads of it
  // silently return undefined.
  ["id", "type", "amount", "txn_date", "txn_at", "created_at", "account_id",
   "category_id", "subcategory_id", "payment_method_id", "note", "labels"].forEach(function (col) {
    check(projection.indexOf(col) !== -1,
      "expense_records projection is missing '" + col + "' — the client reads it");
  });
  // Anything the save path writes must be selected back.
  const rowBlock = HTML.slice(HTML.indexOf("var row = {"), HTML.indexOf("var btn = document.getElementById(\"rec-modal-save\")"));
  const written = (rowBlock.match(/^\s{10}(\w+):/gm) || []).map(function (x) { return x.trim().replace(":", ""); });
  written.forEach(function (col) {
    check(projection.indexOf(col) !== -1,
      "the save path writes '" + col + "' but the projection does not read it back");
  });
}

// ── 3. the cache paint must not be gated behind auth ───────────────────────
check(/function paintExpenseFromCache\(\)/.test(HTML),
  "the cached snapshot paint must be its own step, not sequenced behind the auth wait");
const loadFn = HTML.slice(HTML.indexOf("function loadDashAccounts(forceNetwork)"),
                          HTML.indexOf("function loadDashAccounts(forceNetwork)") + 900);
check(loadFn.indexOf("paintExpenseFromCache()") < loadFn.indexOf("WfAuth.isLoggedIn()"),
  "the cache paint must start BEFORE the auth gate — it needs no auth and the data is already local");
check(/wf-idb\.js\?v=__ASSET_VERSION__"><\/script>\s*<\/head>/.test(HTML.replace(/\n/g, "")) ||
      HTML.indexOf('wf-idb.js') < HTML.indexOf("function paintExpenseFromCache"),
  "wf-idb.js must load before the expense inline script, or the cache paint no-ops on first call");

if (failed) { console.error("\n" + failed + " load-path check(s) failed"); process.exit(1); }
console.log("dashboard load path OK");
