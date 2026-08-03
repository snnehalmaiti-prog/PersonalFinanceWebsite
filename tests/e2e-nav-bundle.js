// mf_history.json — every mapped fund's NAV history in one same-origin file,
// built nightly by fetch_mf_history.py.
//
// Without it a cold load asks api.mfapi.in for one fund at a time: eighteen
// requests for an eighteen-fund portfolio, per user, per day, against a free
// community service. This checks the bundle actually replaces those requests, and
// — more importantly — that it is only ever an optimisation: a fund missing from
// it, or no bundle at all, must fall through to the per-fund path with the same
// numbers on screen.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-nav-bundle.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const A = "100001", B = "100002", C = "100003";   // C is deliberately NOT bundled
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Fund A", "Buy", "1000", "10"],
    ["1-Jan-2024", "Snnehal", "Fund B", "Buy", "1000", "10"],
    ["1-Jan-2024", "Snnehal", "Fund C", "Buy", "1000", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", A, "INFA"],
    ["Fund B", "Equity", "Flexi Cap", B, "INFB"],
    ["Fund C", "Equity", "Flexi Cap", C, "INFC"]],
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
const dmyNum = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };   // mfapi: numeric
const dmyMon = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${MON[+m - 1]}-${y}`; }; // amfi: name
const NAV = 12.5;
const LAST = DAYS[DAYS.length - 1];

// The bundle's shape: ISO date keys, bare numbers.
const bundleFor = (nav) => Object.fromEntries(DAYS.map((iso) => [iso, nav]));
const mfapiFor = (nav) => ({ data: DAYS.map((iso) => ({ date: dmyNum(iso), nav: String(nav) })).reverse() });

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const mfapiFor_ = [];               // which scheme codes were requested per-fund
  let bundleHits = 0;
  let serveBundle = true;

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => {
    const code = (r.request().url().match(/\/mf\/(\d+)/) || [])[1];
    mfapiFor_.push(code);
    r.fulfill(j(mfapiFor(NAV)));
  });
  await p.route("**/mf_history.json*", (r) => {
    bundleHits++;
    if (!serveBundle) return r.fulfill({ status: 404, body: "" });
    // A and B only. C is mapped but absent — the "just added a fund" case.
    r.fulfill(j({ updated: new Date().toISOString(),
                  mf_history: { [A]: bundleFor(NAV), [B]: bundleFor(NAV) } }));
  });
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { INFA: A, INFB: B, INFC: C } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: {
    // Same value mfapi and the bundle carry for the same date, or the app would
    // correctly read the difference as a restatement and refetch everything.
    [A]: { date: dmyMon(LAST), nav: String(NAV) },
    [B]: { date: dmyMon(LAST), nav: String(NAV) },
    [C]: { date: dmyMon(LAST), nav: String(NAV) } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

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

  const WAIT = Number(process.env.WAIT || 8000);
  const load = async () => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(WAIT);
  };
  const readValue = () => p.evaluate(() => (document.getElementById("pvc-current-value") || {}).textContent);

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);

  // ── cold load WITH a bundle covering two of the three funds ──
  mfapiFor_.length = 0; bundleHits = 0;
  await load();
  const withBundle = { bundle: bundleHits, perFund: [...new Set(mfapiFor_)].sort(), value: await readValue() };
  console.log("  cold, bundle covers A+B: " + JSON.stringify(withBundle));

  ok(withBundle.bundle >= 1, "S1 the bundle is fetched", withBundle.bundle);
  ok(!withBundle.perFund.includes(A) && !withBundle.perFund.includes(B),
     "S2 the bundled funds are NOT requested one by one — that is the whole point",
     withBundle.perFund);
  ok(withBundle.perFund.includes(C),
     "S3 a mapped fund the bundle does not carry still falls through to mfapi",
     withBundle.perFund);
  ok(withBundle.perFund.length === 1,
     "S4 and only that one does", withBundle.perFund);
  ok(/\d/.test(withBundle.value), "S5 the dashboard renders", withBundle.value);

  // ── refresh: the per-fund cache now covers everything, bundle included ──
  mfapiFor_.length = 0; bundleHits = 0;
  await load();
  const refreshed = { bundle: bundleHits, perFund: [...new Set(mfapiFor_)], value: await readValue() };
  console.log("  refresh: " + JSON.stringify(refreshed));
  ok(refreshed.perFund.length === 0,
     "R1 a refresh makes no per-fund requests", refreshed.perFund);
  ok(refreshed.bundle === 0,
     "R2 and does not refetch the bundle either — the per-fund cache already has it",
     refreshed.bundle);

  // R2 alone is not evidence: the bundle has its own 12-hour blob cache, so it
  // would stay at zero even if nothing were written per fund. Drop that blob and
  // refresh again — only a per-fund cache can keep this at zero now.
  await p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("wf-cache");
    req.onsuccess = () => {
      const db = req.result;
      const name = [...db.objectStoreNames][0];
      if (!name) return resolve();
      const tx = db.transaction(name, "readwrite");
      tx.objectStore(name).delete("blob:wf-mf-history-static");
      tx.oncomplete = resolve; tx.onerror = resolve;
    };
    req.onerror = resolve;
  }));
  mfapiFor_.length = 0; bundleHits = 0;
  await load();
  const noBlob = { bundle: bundleHits, perFund: [...new Set(mfapiFor_)], value: await readValue() };
  console.log("  refresh, bundle blob dropped: " + JSON.stringify(noBlob));
  ok(noBlob.bundle === 0 && noBlob.perFund.length === 0,
     "R4 with the bundle's own cache dropped, a refresh STILL fetches nothing — " +
     "the series were written per fund when the bundle was first read", noBlob);
  ok(noBlob.value === withBundle.value, "R5 and the figure is unchanged", noBlob.value);
  ok(refreshed.value === withBundle.value,
     "R3 and shows the same figure it did from the bundle", [withBundle.value, refreshed.value]);

  // ── the same portfolio with NO bundle at all must agree exactly ──
  // This is the check that matters: the bundle is an optimisation, so it must not
  // change a single number. A different figure here means the two paths disagree
  // about dates or parsing.
  serveBundle = false;
  await p.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("wf-cache");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  mfapiFor_.length = 0; bundleHits = 0;
  await load();
  const noBundle = { perFund: [...new Set(mfapiFor_)].sort(), value: await readValue() };
  console.log("  cold, no bundle (404): " + JSON.stringify(noBundle));
  ok(noBundle.perFund.length === 3,
     "N1 with no bundle every fund is fetched individually — the old behaviour",
     noBundle.perFund);
  ok(noBundle.value === withBundle.value,
     "N2 and the dashboard shows EXACTLY the same figure as it did from the bundle",
     [withBundle.value, noBundle.value]);

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
