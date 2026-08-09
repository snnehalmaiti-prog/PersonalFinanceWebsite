// Mutual fund NAV history caching.
//
// History is immutable — a NAV published in 2019 is still that number — so it is
// cached in IndexedDB with no clock expiry, and the daily tail comes from
// amfi_nav.json, which is downloaded anyway. That removes 18 requests from every
// refresh. The risk it introduces is the mirror image: a series that never
// refreshes, so a correction from AMFI is never picked up.
//
// This suite is about that risk. It checks the saving happens (no requests on a
// second load), and then that each way a series can legitimately need refetching
// still does: a restated NAV, and a cache older than the backstop.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-nav-cache.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const CODE = "100033";
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN, ["1-Jan-2024", "Snnehal", "Fund A", "Buy", "1000", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", CODE, "INF1"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const START = "2024-01-01", END = "2024-12-01";
function days() { const o = []; const d = new Date(START + "T00:00:00"), e = new Date(END + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; }
const DAYS = days();
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
// The two sources do NOT use the same date format, and getting it wrong is silent:
// parseMfApiDate builds an Invalid Date, the entry survives the truthiness filter,
// and the series is cached with unusable dates.
//   mfapi.in    "01-12-2024"  — numeric month
//   amfi_nav    "01-Dec-2024" — month name
const dmyNum = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
const dmy = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${MON[+m - 1]}-${y}`; };
// A flat, known series: every assertion below is then a single number rather than
// something that has to be recomputed.
const NAV = 12.5;
const LAST_ISO = DAYS[DAYS.length - 1];
function navBody(nav) {
  return { data: DAYS.map((iso) => ({ date: dmyNum(iso), nav: String(nav) })).reverse() };
}

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch();
  // One context throughout: IndexedDB has to survive between loads, which is the
  // whole point. A fresh context per load would measure nothing.
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  let mfapiHits = 0;
  let currentNav = NAV;              // what mfapi serves
  let amfiEntry = { date: dmy(LAST_ISO), nav: String(NAV) };  // what amfi_nav.json says

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => { mfapiHits++; r.fulfill(j(navBody(currentNav))); });
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INF1: CODE } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { [CODE]: amfiEntry } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));
  // No bundle in this suite: everything below is the per-fund fallback path, which
  // is what a repo without the nightly workflow is on. The bundle gets its own file.
  let bundleHits = 0;
  await p.route("**/mf_history.json*", (r) => { bundleHits++; r.fulfill({ status: 404, body: "" }); });

  await p.addInitScript(() => {
    window.Chart = function (ctx, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  const load = async () => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(Number(process.env.WAIT || 8000));
  };
  const readState = () => p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("wf-cache");
    req.onsuccess = () => {
      const db = req.result;
      const names = [...db.objectStoreNames];
      if (!names.length) return resolve({ stores: names, navKeys: [], lastNav: null });
      const tx = db.transaction(names[0], "readonly");
      const all = tx.objectStore(names[0]).getAllKeys();
      all.onsuccess = () => {
        const keys = [...all.result].filter((k) => String(k).indexOf("nav:") === 0);
        if (!keys.length) return resolve({ stores: names, navKeys: [], lastNav: null });
        const g = db.transaction(names[0], "readonly").objectStore(names[0]).get(keys[0]);
        g.onsuccess = () => {
          const v = g.result;
          const d = v && v.data;
          resolve({ stores: names, navKeys: keys,
                    points: d ? d.length : 0,
                    lastNav: d && d.length ? d[d.length - 1].nav : null,
                    fetchedAt: v && v.fetchedAt });
        };
      };
    };
    req.onerror = () => resolve({ error: "idb open failed" });
  }));

  // ── first load: cold, so the network is used and the series is stored ──
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  // Legacy entries as an upgrading user would have them: this is the 2.61 MB the
  // sweep exists to reclaim. Without seeding these, C4 passes whether or not the
  // sweep runs at all.
  await p.evaluate(() => {
    for (let i = 0; i < 6; i++) {
      localStorage.setItem("wf-nav-cache-90000" + i,
        JSON.stringify({ fetchedAt: Date.now(), data: [{ date: "2024-01-01T00:00:00.000Z", nav: 1 }] }));
    }
  });
  const seeded = await p.evaluate(() => {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      if ((localStorage.key(i) || "").indexOf("wf-nav-cache-") === 0) n++;
    }
    return n;
  });
  ok(seeded === 6, "C0 legacy localStorage entries seeded for the sweep to find", seeded);
  mfapiHits = 0;
  await load();
  const cold = mfapiHits;
  const stored = await readState();
  console.log("  cold load: mfapi=" + cold + "  stored=" + JSON.stringify(stored));
  ok(cold >= 1, "C1 a cold load fetches the history", cold);
  ok(stored.navKeys.length === 1 && stored.points === DAYS.length,
     "C2 and stores the whole series in IndexedDB", stored);
  ok(Math.abs((stored.lastNav || 0) - NAV) < 1e-6, "C3 with the NAVs it was served", stored.lastNav);

  // Nothing may be left in localStorage: that is the quota this change reclaims.
  const ls = await p.evaluate(() => {
    let n = 0, bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.indexOf("wf-nav-cache-") === 0) { n++; bytes += (localStorage.getItem(k) || "").length; }
    }
    return { n, bytes };
  });
  ok(ls.n === 0, "C4 and nothing in localStorage — that quota is what ran out before", ls);

  // ── second load: warm. This is the saving. ──
  mfapiHits = 0;
  await load();
  console.log("  warm load: mfapi=" + mfapiHits);
  ok(mfapiHits === 0, "W1 a refresh makes NO NAV requests at all", mfapiHits);
  const warmVals = await p.evaluate(() => ({
    growth: (document.getElementById("avc-portfolio-value") || {}).textContent,
    account: (document.getElementById("pvc-current-value") || {}).textContent,
  }));
  ok(/\d/.test(warmVals.growth) && /\d/.test(warmVals.account),
     "W2 and still renders both charts from the cached series", warmVals);

  // ── AMFI restates a NAV we already hold: must refetch ──
  // amfi_nav.json is itself cached in IndexedDB for six hours, so a correction is
  // only visible once that lapses. Dropping the entry here is what that lapse looks
  // like; without it this would be testing the map's cache policy, not the
  // restatement detector. The six-hour bound is the real worst case for noticing a
  // correction, and the 30-day backstop below covers anything it misses.
  const dropAmfiMapCache = () => p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("wf-cache");
    req.onsuccess = () => {
      const db = req.result;
      const name = [...db.objectStoreNames][0];
      if (!name) return resolve();
      const tx = db.transaction(name, "readwrite");
      tx.objectStore(name).delete("blob:wf-amfi-nav-map");
      tx.oncomplete = resolve; tx.onerror = resolve;
    };
    req.onerror = resolve;
  }));

  currentNav = 99.75;                                   // mfapi now serves the corrected series
  amfiEntry = { date: dmy(LAST_ISO), nav: "99.75" };    // and AMFI reports it for a date we hold
  await dropAmfiMapCache();
  mfapiHits = 0;
  await load();
  const afterFix = await readState();
  console.log("  restated: mfapi=" + mfapiHits + "  storedLastNav=" + afterFix.lastNav);
  ok(mfapiHits >= 1,
     "R1 a NAV restated for a date we already hold triggers a refetch", mfapiHits);
  ok(Math.abs((afterFix.lastNav || 0) - 99.75) < 1e-6,
     "R2 and the corrected series replaces the cached one", afterFix.lastNav);

  // ── a NAV for a NEWER date is an append, not a restatement: no refetch ──
  const NEXT = "2024-12-02";
  amfiEntry = { date: dmy(NEXT), nav: "99.75" };
  await dropAmfiMapCache();
  mfapiHits = 0;
  await load();
  console.log("  newer date: mfapi=" + mfapiHits);
  ok(mfapiHits === 0,
     "N1 a NAV for a date we do not hold is an append — no refetch, that is what " +
     "amfi_nav.json is for", mfapiHits);

  // ── the backstop: a cache older than 30 days is refetched regardless ──
  await p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("wf-cache");
    req.onsuccess = () => {
      const db = req.result;
      const name = [...db.objectStoreNames][0];
      const tx = db.transaction(name, "readwrite");
      const st = tx.objectStore(name);
      const all = st.getAllKeys();
      all.onsuccess = () => {
        const key = [...all.result].find((k) => String(k).indexOf("nav:") === 0);
        // No cached series to age means something upstream is already broken.
        // Resolve so the assertion below reports it, instead of leaving a promise
        // pending until Playwright garbage-collects it and the suite dies with a
        // message about promises rather than about NAVs.
        if (!key) return resolve();
        const g = st.get(key);
        g.onsuccess = () => {
          // The store is created with no keyPath, so keys are out-of-line and put()
          // needs the key passed explicitly.
          const rec = g.result;
          rec.fetchedAt = Date.now() - 31 * 24 * 60 * 60 * 1000;   // just past the backstop
          st.put(rec, key);
          tx.oncomplete = resolve;
        };
      };
    };
    req.onerror = resolve;
  }));
  mfapiHits = 0;
  await load();
  console.log("  backstop: mfapi=" + mfapiHits);
  ok(mfapiHits >= 1,
     "B1 a series older than the backstop is refetched, so a restatement further " +
     "back than AMFI's latest date cannot live forever", mfapiHits);
  ok(mfapiHits === 1,
     "B2 and refetched ONCE for the load, not once per render pass", mfapiHits);

  // ── "Refresh NAV" must actually clear the caches ──
  // The caches moved to IndexedDB; a button that still deletes localStorage keys
  // reports success and serves exactly the same figures. The button lives on
  // settings.html, not the dashboard, so this has to go there to press it.
  const idbNavKeys = () => p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("wf-cache");
    req.onsuccess = () => {
      const db = req.result;
      const name = [...db.objectStoreNames][0];
      if (!name) return resolve({ nav: 0, amfi: 0 });
      const all = db.transaction(name, "readonly").objectStore(name).getAllKeys();
      all.onsuccess = () => {
        const keys = [...all.result];
        const amfi = keys.filter((k) => String(k).indexOf("blob:wf-amfi") === 0);
        if (!amfi.length) return resolve({ nav: keys.filter((k) => String(k).indexOf("nav:") === 0).length, amfi: 0, oldestAmfi: null });
        // Read their stamps: after the button, a surviving AMFI blob is only OK if
        // it was written AFTER the press — i.e. it was cleared and refetched, not
        // left in place.
        const store2 = db.transaction(name, "readonly").objectStore(name);
        let seen = 0, oldest = Infinity;
        amfi.forEach((k) => {
          const g = store2.get(k);
          g.onsuccess = () => {
            const v = g.result;
            if (v && v.fetchedAt) oldest = Math.min(oldest, v.fetchedAt);
            if (++seen === amfi.length) {
              resolve({ nav: keys.filter((q) => String(q).indexOf("nav:") === 0).length,
                        amfi: amfi.length, oldestAmfi: oldest === Infinity ? null : oldest });
            }
          };
        });
      };
      all.onerror = () => resolve({ nav: -1, amfi: -1, oldestAmfi: null });
    };
    req.onerror = () => resolve({ nav: -1, amfi: -1 });
  }));

  const before = await idbNavKeys();
  ok(before.nav > 0, "X0 there are cached NAV entries for the button to clear", before);

  const pressedAt = Date.now();
  await p.goto(`http://127.0.0.1:${PORT}/settings.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(3000);
  const pressed = await p.evaluate(() => {
    const btn = document.getElementById("equity-refresh-nav");
    if (!btn) return false;
    btn.click();
    return true;
  });
  ok(pressed, "X1 the Refresh NAV button is on the settings page and was pressed", pressed);
  await p.waitForTimeout(3000);
  const after = await idbNavKeys();
  console.log("  refresh NAV: nav " + before.nav + " -> " + after.nav +
    ", amfi blobs " + before.amfi + " -> " + after.amfi);
  ok(after.nav === 0,
     "X2 it clears the per-scheme NAV cache — that lives in IndexedDB now, so " +
     "clearing localStorage keys alone would silently do nothing", after.nav);
  // Not "gone": the button clears AND re-renders, so an AMFI map is legitimately
  // fetched again straight away. What must be true is that nothing SURVIVED the
  // clear — any blob present now has to have been written after the press.
  ok(after.amfi === 0 || (after.oldestAmfi && after.oldestAmfi >= pressedAt),
     "X3 and no AMFI map cache survives the clear — one written afterwards is a " +
     "fresh refetch, not a leftover",
     { amfi: after.amfi, oldestAmfi: after.oldestAmfi, pressedAt: pressedAt });

  // The real proof: the next dashboard load has to go back to the network.
  mfapiHits = 0;
  await load();
  console.log("  load after Refresh NAV: mfapi=" + mfapiHits);
  ok(mfapiHits >= 1,
     "X4 so the next load refetches the history instead of serving the cache the " +
     "button claimed to clear", mfapiHits);

  ok(bundleHits >= 1,
     "F1 the bundle is looked for — a 404 must fall through to the per-fund path, " +
     "not break the load", bundleHits);
  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
