// settings.html on a device that has never opened the dashboard.
//
// The page used to read whatever localStorage happened to hold and never sync
// first. dashboard.html goes to considerable trouble to pull the cloud settings
// in BEFORE any app code runs — a promise, a deferred script.js injection, a
// session flag, a 4s bailout. settings.html did none of it.
//
// So: sign in on a new device or browser and go straight to Settings (bookmark,
// PWA shortcut, pasted URL — anything that does not pass through the dashboard,
// so sessionStorage["wf-cloud-synced"] is unset and nothing has ever synced).
// Every sheet URL and the whole GitHub section rendered EMPTY, despite the cloud
// holding them. That alone is the "my settings disappeared" report.
//
// Then it compounds. script.js prefills the GitHub inputs from localStorage
// (blank) and writes `.value.trim()` straight back on Save. Empty strings are
// not null, so they survived saveSettingsToCloud's `if (raw == null) return;`
// and resolution=merge-duplicates overwrote those columns. ONE Save press wiped
// the user's GitHub config out of the cloud, on every device.
//
// This suite pins both halves — the page must SHOW the cloud values, and it must
// never PUSH a blank over one it has not read.
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-settings-cloud-sync.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

// What the cloud holds for this user.
const CLOUD_ROW = {
  user_id: "u1",
  gh_owner: "cloud-owner",
  gh_repo: "cloud-repo",
  gh_branch: "cloud-branch",
  equity_sheets: [{ link: "https://docs.google.com/spreadsheets/d/CLOUDEQ/edit", header: "1" }],
  fd_sheets: [{ link: "https://docs.google.com/spreadsheets/d/CLOUDFD/edit", header: "1" }],
  liabilities: [{ name: "Home loan", amount: 1234567 }],
  epf_interest_rates: { 2024: 8.25 },
  updated_at: "2026-01-01T00:00:00Z",
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

// A page with a working Supabase stand-in. `settingsDelay` models a slow cloud
// so the ordering under test is observable rather than accidental.
async function makePage(b, opts) {
  opts = opts || {};
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1400 } });
  const p = await ctx.newPage();
  const state = { row: JSON.parse(JSON.stringify(CLOUD_ROW)), upserts: [] };

  const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  const j = (o) => ({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(o) });

  await p.route("**://*.supabase.co/**", async (r) => {
    const url = r.request().url();
    const method = r.request().method();
    if (method === "OPTIONS") return r.fulfill({ status: 204, headers: CORS, body: "" });

    if (url.indexOf("/rest/v1/user_settings") !== -1) {
      if (method === "GET") {
        if (opts.settingsDelay) await new Promise((res) => setTimeout(res, opts.settingsDelay));
        return r.fulfill(j(state.row ? [state.row] : []));
      }
      if (method === "POST") {
        let body = {};
        try { body = JSON.parse(r.request().postData() || "{}"); } catch (e) {}
        state.upserts.push(body);
        // merge-duplicates: every key PRESENT in the payload overwrites.
        Object.keys(body).forEach(function (k) { state.row[k] = body[k]; });
        return r.fulfill(j([state.row]));
      }
    }
    return r.fulfill(j([]));
  });
  await p.route("**://cdn.sheetjs.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "window.XLSX={};" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://docs.google.com/**", (r) => r.fulfill({ status: 200, contentType: "text/csv", headers: CORS, body: "Transaction Date,Portfolio Name\n" }));
  await p.route("**/*.json*", (r) => r.fulfill(j({})));

  return { p, state };
}

// A genuinely fresh device: signed in, but localStorage carries nothing beyond
// the session and sessionStorage has never seen a sync.
async function bootFresh(p) {
  await p.goto(`http://127.0.0.1:${PORT}/settings.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({
      access_token: "x",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "u1", email: "a@b.c" },
    }));
  });
  await p.goto(`http://127.0.0.1:${PORT}/settings.html?nosw=1`, { waitUntil: "load" });
}

// The settings page is tabbed and every panel starts hidden, so a click on a
// control inside one times out until its tab is opened.
async function openTab(p, id) { await p.click("#tab-" + id); await p.waitForTimeout(150); }

const val = (p, sel) => p.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.value : null;
}, sel);

(async () => {
  const b = await chromium.launch();
  const errs = [];

  console.log("A. A fresh device SHOWS what the cloud holds");
  const one = await makePage(b, { settingsDelay: 250 });
  one.p.on("pageerror", (e) => errs.push(e.message));
  await bootFresh(one.p);
  await one.p.waitForTimeout(4000);
  await openTab(one.p, "github");

  ok(await val(one.p, "#gh-owner") === "cloud-owner", "A1 the GitHub owner arrives from the cloud",
     await val(one.p, "#gh-owner"));
  ok(await val(one.p, "#gh-repo") === "cloud-repo", "A2 and the repo", await val(one.p, "#gh-repo"));
  ok(await val(one.p, "#gh-branch") === "cloud-branch", "A3 and the branch", await val(one.p, "#gh-branch"));

  await openTab(one.p, "transactions");
  const eqLink = await one.p.evaluate(() => {
    const el = document.querySelector("#equity-sheets-list .sheet-row-link");
    return el ? el.value : null;
  });
  ok(eqLink && eqLink.indexOf("CLOUDEQ") !== -1,
     "A4 and the equity sheet link, which is what 'my settings disappeared' was about", eqLink);
  const fdLink = await one.p.evaluate(() => {
    const el = document.querySelector("#fd-sheets-list .sheet-row-link");
    return el ? el.value : null;
  });
  ok(fdLink && fdLink.indexOf("CLOUDFD") !== -1, "A4b and a second card's link, so it is not one card by luck", fdLink);

  const stored = await one.p.evaluate(() => ({
    owner: localStorage.getItem("wf-gh-owner"),
    liab: localStorage.getItem("wf-liabilities"),
    epf: localStorage.getItem("wf-epf-interest-rates"),
  }));
  ok(stored.owner === "cloud-owner", "A5 localStorage was seeded, not just the input", stored.owner);
  ok(stored.liab && stored.liab.indexOf("Home loan") !== -1, "A6 including liabilities", stored.liab);
  ok(stored.epf && stored.epf.indexOf("8.25") !== -1, "A7 and the EPF rates", stored.epf);

  console.log("\nB. Saving does not wipe the cloud");
  await openTab(one.p, "github");
  // Press Save with the form as the page rendered it. Before the fix this is the
  // press that wrote four empty strings over real configuration.
  await one.p.click("#gh-save-btn");
  await one.p.waitForTimeout(1500);
  ok(one.state.row.gh_owner === "cloud-owner", "B1 the owner survived Save", one.state.row.gh_owner);
  ok(one.state.row.gh_repo === "cloud-repo", "B2 as did the repo", one.state.row.gh_repo);
  ok(one.state.row.gh_branch === "cloud-branch", "B3 and the branch", one.state.row.gh_branch);
  ok(one.state.row.equity_sheets && JSON.stringify(one.state.row.equity_sheets).indexOf("CLOUDEQ") !== -1,
     "B4 and the sheet links, which the same upsert carries",
     one.state.row.equity_sheets);

  console.log("\nC. A real edit still reaches the cloud");
  await one.p.fill("#gh-owner", "typed-owner");
  await one.p.click("#gh-save-btn");
  await one.p.waitForTimeout(1500);
  ok(one.state.row.gh_owner === "typed-owner", "C1 an edited value is saved", one.state.row.gh_owner);
  ok(one.state.row.gh_repo === "cloud-repo", "C2 and the untouched fields are left alone", one.state.row.gh_repo);

  console.log("\nD. Clearing a field is an edit, not ignorance");
  // The guard must not become "empty values can never be saved" — once the row
  // has been READ, the user has seen the real value and emptying it is deliberate.
  await one.p.fill("#gh-branch", "");
  await one.p.click("#gh-save-btn");
  await one.p.waitForTimeout(1500);
  ok(one.state.row.gh_branch === "", "D1 a field the user cleared is cleared in the cloud too",
     one.state.row.gh_branch);

  console.log("\nE. A page that never read the cloud cannot blank it");
  // The narrow case the guard exists for: the read fails outright, the form is
  // blank because nothing filled it, and Save must not push that blankness.
  const two = await makePage(b, {});
  two.p.on("pageerror", (e) => errs.push(e.message));
  // fallback(), not continue(): continue() goes to the real network, so the POST
  // would never reach the recorder below and "no blank was pushed" would pass
  // because nothing was pushed at all. fallback() hands it to the handler
  // registered earlier, which is the one keeping `upserts`.
  await two.p.route("**://*.supabase.co/rest/v1/user_settings**", (r) => {
    if (r.request().method() === "GET") return r.fulfill({ status: 500, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "{}" });
    return r.fallback();
  });
  await bootFresh(two.p);
  await two.p.waitForTimeout(3500);
  await openTab(two.p, "github");
  ok(await val(two.p, "#gh-owner") === "", "E1 the form is blank, because the read failed", await val(two.p, "#gh-owner"));
  await two.p.click("#gh-save-btn");
  await two.p.waitForTimeout(1500);
  // The assertion below is only worth anything if a save actually happened —
  // "no blank was pushed" is trivially true when nothing was pushed.
  ok(two.state.upserts.length > 0, "E2 Save did reach the cloud (so E3 is not vacuous)",
     two.state.upserts.length);
  const blanked = two.state.upserts.some(function (u) {
    return u.gh_owner === "" || u.gh_repo === "" || u.equity_sheets === "";
  });
  ok(!blanked, "E3 and it pushed no empty value for a column it never read",
     two.state.upserts.map(function (u) { return { o: u.gh_owner, r: u.gh_repo }; }));

  ok(errs.length === 0, "no page errors", errs);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
