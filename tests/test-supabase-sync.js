// Executable tests for supabase-client.js settings sync — loads the REAL file
// under Node with stubbed browser APIs, then drives saveSettingsToCloud /
// loadSettingsFromCloud / signOut through scripted fetch responses.
"use strict";
const fs = require("fs");
const path = require("path");
const REPO = require("path").join(__dirname, "..");

// ── browser stubs ───────────────────────────────────────────────────────────
function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    get size() { return m.size; },
    keys: () => [...m.keys()],
  };
}
global.window = {};
global.localStorage = makeStorage();
global.sessionStorage = makeStorage();
global.document = { addEventListener() {}, dispatchEvent() {} };
global.btoa = s => Buffer.from(s, "binary").toString("base64");
global.atob = s => Buffer.from(s, "base64").toString("binary");

// Scripted fetch: queue of {status, json} responses; records calls.
const fetchCalls = [];
let fetchQueue = [];
global.fetch = function (url, opts) {
  fetchCalls.push({ url, opts });
  const next = fetchQueue.length ? fetchQueue.shift() : { status: 200, json: [] };
  return Promise.resolve({
    ok: next.status >= 200 && next.status < 300,
    status: next.status,
    json: () => Promise.resolve(next.json),
  });
};

const warns = [];
const realWarn = console.warn;
console.warn = (...a) => { warns.push(a.join(" ")); };

// ── load the real file ──────────────────────────────────────────────────────
eval(fs.readFileSync(path.join(REPO, "supabase-client.js"), "utf8"));
const WfAuth = global.window.WfAuth;
if (!WfAuth) { console.error("FATAL: WfAuth not exported"); process.exit(1); }

// Valid, non-expiring session
function setSession() {
  localStorage.setItem("wf-sb-session", JSON.stringify({
    access_token: "tokentokentoken",
    refresh_token: "refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-uuid-1", email: "t@t.com" },
  }));
}

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  → " + detail : "")); }
}
function lastBody() { return JSON.parse(fetchCalls[fetchCalls.length - 1].opts.body); }
function reset() { fetchCalls.length = 0; fetchQueue = []; warns.length = 0; }

const PGRST204 = col => ({
  status: 400,
  json: { code: "PGRST204", message: "Could not find the '" + col + "' column of 'user_settings' in the schema cache" },
});

(async function run() {
  console.log("A. saveSettingsToCloud");

  // Seed localStorage with representative synced keys
  setSession();
  localStorage.setItem("wf-equity-sheets", JSON.stringify([{ link: "https://docs.google.com/spreadsheets/d/AAA/edit#gid=0", headerRow: "1" }]));
  localStorage.setItem("wf-stocksetfmapping-sheets", JSON.stringify([{ link: "https://docs.google.com/spreadsheets/d/MAP/edit", headerRow: "1" }]));
  localStorage.setItem("wf-gh-owner", "snnehalmaiti-prog");
  localStorage.setItem("wf-gh-token", "SECRET-PAT"); // must NEVER be uploaded
  localStorage.setItem("wf-expense-templates", JSON.stringify([{ id: 1 }]));
  localStorage.setItem("wf-recurring-payments", JSON.stringify([{ id: 2 }]));

  // A1: clean success on first try
  reset();
  fetchQueue = [{ status: 201, json: [{ user_id: "user-uuid-1" }] }];
  await WfAuth.saveSettingsToCloud();
  ok(fetchCalls.length === 1, "A1 single upsert on success");
  const b1 = lastBody();
  ok(b1.expense_templates && b1.recurring_payments && b1.gh_owner === "snnehalmaiti-prog",
    "A1 payload contains synced keys");
  ok(!("gh_token" in b1) && JSON.stringify(b1).indexOf("SECRET-PAT") === -1,
    "A1 PAT never uploaded");
  ok(warns.length === 0, "A1 no warnings", warns.join("|"));

  // A2: two missing columns → strip one at a time, then succeed
  reset();
  fetchQueue = [PGRST204("expense_templates"), PGRST204("recurring_payments"), { status: 201, json: [{ ok: 1 }] }];
  const r2 = await WfAuth.saveSettingsToCloud();
  ok(fetchCalls.length === 3, "A2 retried twice then succeeded", "calls=" + fetchCalls.length);
  const b2 = lastBody();
  ok(!("expense_templates" in b2) && !("recurring_payments" in b2),
    "A2 offending columns stripped from final payload");
  ok("equity_sheets" in b2 && "stocksetfmapping_sheets" in b2 && "gh_owner" in b2,
    "A2 sheet + mapping configs still present");
  ok(r2 && r2[0] && r2[0].ok === 1, "A2 resolves with server data");
  ok(warns.filter(w => w.includes("missing in DB")).length === 2, "A2 two migration warnings", warns.join("|"));

  // A3: non-column 4xx (e.g. RLS) → no retry storm, single warn
  reset();
  fetchQueue = [{ status: 403, json: { code: "42501", message: "new row violates row-level security policy" } }];
  await WfAuth.saveSettingsToCloud();
  ok(fetchCalls.length === 1, "A3 no retry on non-column error", "calls=" + fetchCalls.length);
  ok(warns.some(w => w.startsWith("Settings sync failed")), "A3 failure surfaced");

  // A4: PGRST204 naming a column NOT in the payload → no infinite loop
  reset();
  fetchQueue = [PGRST204("some_other_column"), { status: 201, json: [] }];
  await WfAuth.saveSettingsToCloud();
  ok(fetchCalls.length === 1, "A4 no retry when named column absent from body", "calls=" + fetchCalls.length);

  // A5: pathological — server keeps returning PGRST204 for a present column each time.
  // Bounded by payload key count; must terminate.
  reset();
  const cols = ["equity_sheets", "stocksetfmapping_sheets", "gh_owner", "expense_templates", "recurring_payments"];
  fetchQueue = cols.map(PGRST204).concat(Array(20).fill(PGRST204("user_id")));
  await WfAuth.saveSettingsToCloud();
  ok(fetchCalls.length <= 12, "A5 retry loop is bounded", "calls=" + fetchCalls.length);

  console.log("B. loadSettingsFromCloud");
  reset();
  fetchQueue = [{
    status: 200,
    json: [{
      user_id: "user-uuid-1",
      equity_sheets: [{ link: "https://docs.google.com/spreadsheets/d/CLOUD/edit", headerRow: "1" }],
      mfmapping_sheets: [{ link: "https://docs.google.com/spreadsheets/d/MFMAP/edit", headerRow: "2" }],
      stocksetfmapping_sheets: null, // null column must NOT clobber local
      gh_owner: "snnehalmaiti-prog",
      gh_branch: "main",
    }],
  }];
  localStorage.setItem("wf-stocksetfmapping-sheets", "LOCAL-KEEP");
  await WfAuth.loadSettingsFromCloud();
  ok(localStorage.getItem("wf-equity-sheets").includes("CLOUD"), "B1 transaction-sheet URL pulled from cloud");
  ok(localStorage.getItem("wf-mfmapping-sheets").includes("MFMAP"), "B2 mapping-sheet URL pulled from cloud");
  ok(localStorage.getItem("wf-stocksetfmapping-sheets") === "LOCAL-KEEP", "B3 null cloud column leaves local intact");
  ok(localStorage.getItem("wf-gh-owner") === "snnehalmaiti-prog" && localStorage.getItem("wf-gh-branch") === "main",
    "B4 GH owner/branch pulled");
  ok(localStorage.getItem("wf-gh-token") === "SECRET-PAT", "B5 PAT untouched by cloud load");

  console.log("C. signOut");
  reset();
  fetchQueue = [{ status: 204, json: {} }];
  sessionStorage.setItem("wf-cloud-synced", "1");
  await WfAuth.signOut();
  ok(localStorage.getItem("wf-equity-sheets") === null && localStorage.getItem("wf-mfmapping-sheets") === null,
    "C1 synced configs cleared on sign-out");
  ok(localStorage.getItem("wf-gh-token") === null, "C2 PAT cleared on sign-out");
  ok(sessionStorage.getItem("wf-cloud-synced") === null, "C3 cloud-synced flag cleared");

  console.log("D. saveSheetData (write path)");
  setSession();

  // D1: full-array upsert — one call, correct URL + body shape
  reset();
  fetchQueue = [{ status: 201, json: [] }];
  const rowsA = [["Header"], ["r1"], ["r2"]];
  const d1 = await WfAuth.saveSheetData("equity", rowsA);
  ok(fetchCalls.length === 1, "D1 single upsert", "calls=" + fetchCalls.length);
  ok(fetchCalls[0].url.indexOf("user_sheet_data") !== -1 &&
     fetchCalls[0].url.indexOf("on_conflict=user_id,prefix") !== -1,
     "D1 upserts on (user_id,prefix)");
  const bd1 = lastBody();
  ok(bd1.prefix === "equity" && Array.isArray(bd1.rows) && bd1.rows.length === 3 && bd1.user_id === "user-uuid-1",
     "D1 body carries prefix + full rows + user_id");
  ok(d1 === true, "D1 resolves truthy on success");

  // D2: sync the SAME data twice → each is an independent full-replace upsert,
  // never an append; row count is identical, so the cache cannot duplicate.
  reset();
  fetchQueue = [{ status: 201, json: [] }, { status: 201, json: [] }];
  await WfAuth.saveSheetData("equity", rowsA);
  await WfAuth.saveSheetData("equity", rowsA);
  ok(fetchCalls.length === 2, "D2 two upserts (no batching)", "calls=" + fetchCalls.length);
  ok(lastBody().rows.length === JSON.parse(fetchCalls[0].opts.body).rows.length,
     "D2 re-sync sends identical row count (no duplication)");

  // D3: non-array rows → no request, returns null (guards the append/shape contract)
  reset();
  const d3 = await WfAuth.saveSheetData("equity", "not-an-array");
  ok(fetchCalls.length === 0 && d3 === null, "D3 non-array rows never written");

  // D4: over-cap payload (>2MB) → skipped with a warning, no request
  reset();
  const huge = [["h"]];
  const big = "x".repeat(1024);
  for (let i = 0; i < 2200; i++) { const r = []; for (let j = 0; j < 2; j++) r.push(big); huge.push(r); }
  const d4 = await WfAuth.saveSheetData("equity", huge);
  ok(fetchCalls.length === 0 && d4 === null, "D4 over-2MB prefix skipped");
  ok(warns.some(w => w.indexOf("over the 2MB cap") !== -1), "D4 over-cap warned", warns.join("|"));

  // D5: server rejects (4xx) → resolves null, single warn, never throws
  reset();
  fetchQueue = [{ status: 403, json: { code: "42501", message: "RLS" } }];
  const d5 = await WfAuth.saveSheetData("equity", rowsA);
  ok(fetchCalls.length === 1 && d5 === null, "D5 server error resolves null");
  ok(warns.some(w => w.startsWith("Sheet-data sync failed")), "D5 failure surfaced");

  console.log("E. loadAllSheetData (read path)");

  // E1: happy path → array of {prefix, rows} straight through
  reset();
  fetchQueue = [{ status: 200, json: [
    { prefix: "equity", rows: [["H"], ["a"]], updated_at: "2026-01-01" },
    { prefix: "fd", rows: null, updated_at: "2026-01-02" },
  ] }];
  const e1 = await WfAuth.loadAllSheetData();
  ok(Array.isArray(e1) && e1.length === 2, "E1 returns rows array");
  ok(e1[0].prefix === "equity" && Array.isArray(e1[0].rows), "E1 passes prefix+rows through");

  // E2: HTTP error → [] (never throws, caller falls back to local cache)
  reset();
  fetchQueue = [{ status: 500, json: { message: "boom" } }];
  const e2 = await WfAuth.loadAllSheetData();
  ok(Array.isArray(e2) && e2.length === 0, "E2 error yields empty array");

  // E3: seed guard contract (mirrors dashboard.html seedSheetDataFromCloud) —
  // null / empty / non-array rows must be SKIPPED so they can't clobber local.
  function seedGuardKeeps(rows) {
    return !(Array.isArray(rows) && rows.length > 0); // true = skip (keep local)
  }
  ok(seedGuardKeeps(null) && seedGuardKeeps([]) && seedGuardKeeps("x") === true &&
     seedGuardKeeps([["H"], ["a"]]) === false,
     "E3 seed guard skips null/empty/non-array, accepts real rows");

  console.warn = realWarn;
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.warn = realWarn; console.error("HARNESS ERROR", e); process.exit(2); });
