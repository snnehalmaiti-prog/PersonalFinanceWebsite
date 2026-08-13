// PORTFOLIO PERFORMANCE (Growth of ₹100) must ignore the exclusion filter.
//
// The ₹100 line answers "what would ₹100 left alone have become", measured
// against an equity index. That is not a question about which slice of the book
// is currently on screen, so the exclusion dropdown has no business reshaping it.
// It did: the series was derived from the same filtered value series the ACCOUNT
// VALUE chart draws, so "Exclude Equity" left the ₹100 line tracking the debt
// fund alone against the Nifty, and "Exclude Fixed Income and Commodity" dropped
// the debt fund out of it.
//
// The Account Value chart keeps honouring the filter — it shows what the book is
// worth right now, which IS a question about the current scope, and it has to
// agree with the Overview header beside it.
//
// The fixture makes the two curves separable by construction:
//
//   Fund A      NAV 10 → 20 halfway   equity, doubles
//   Debt Fund   NAV flat at 10        fixed income, returns exactly 0
//   ACME        stock 100 → 200       equity (Stocks/ETF leg), doubles
//
// So the ₹100 line must read the SAME under all three exclusion states, while the
// Account Value chart's last point must fall when a category is excluded.
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-growth-unfiltered.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const MF_MAP = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
  ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"],
  ["Debt Fund", "Fixed Income", "Debt Fund", "100002", "INFB"]];
const SE_MAP = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
  ["Acme Ltd", "Equity", "Large Cap", "Stocks", "India", "ACME", "Industrials"]];

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const START = new Date(TODAY.getFullYear() - 2, TODAY.getMonth(), 1);
const MID = new Date(TODAY.getFullYear() - 1, TODAY.getMonth(), 1);
const iso = (d) => d.toISOString().slice(0, 10);
const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`;

function days() {
  const out = []; const d = new Date(START);
  while (d <= TODAY) { out.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return out;
}
const ALL_DAYS = days();
const doubles = (d) => (d >= MID ? 20 : 10);
const flat10 = () => 10;
function navHistory(priceAt) {
  return ALL_DAYS.map((d) => ({ date: `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`, nav: String(priceAt(d)) })).reverse();
}
function seriesByIso(priceAt) {
  const o = {}; ALL_DAYS.forEach((d) => { o[iso(d)] = priceAt(d); }); return o;
}

const SHEETS = {
  "wf-equity-data": [TXN,
    [ddmmyyyy(START), "Snnehal", "Fund A", "Buy", "1000", "10"],
    [ddmmyyyy(START), "Snnehal", "Debt Fund", "Buy", "1000", "10"]],
  "wf-mfmapping-data": MF_MAP,
  "wf-stocksetf-data": [TXN, [ddmmyyyy(START), "Snnehal", "Acme Ltd", "Buy", "100", "100"]],
  "wf-stocksetfmapping-data": SE_MAP,
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const near = (a, b, eps) => a != null && b != null && Math.abs(a - b) <= (eps == null ? 0.5 : eps);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const j = (o) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });

  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => {
    const isDebt = /100002/.test(r.request().url());
    r.fulfill(j({ data: navHistory(isDebt ? flat10 : doubles) }));
  });
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { INFA: "100001", INFB: "100002" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { 100001: 20, 100002: 10 } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: 84 }, ACME: { price: 200, prev_close: 200, currency: "INR" } },
    usd_inr_history: {},
    index_history: { NIFTY50: { prices: seriesByIso((d) => 1000 + 200 * ((d - START) / (TODAY - START))) } },
  })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: { ACME: { currency: "INR", prices: seriesByIso((d) => (d >= MID ? 200 : 100)) } } })));
  await p.addInitScript(() => {
    window.__charts = {};
    window.Chart = function (c, cfg) {
      window.__charts[c && c.canvas ? c.canvas.id : "?"] = cfg;
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.data = cfg && cfg.data; this.options = cfg && cfg.options; this.scales = { x: {}, y: {} };
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
    localStorage.setItem("wf-benchmark-index", "NIFTY50");
  }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });

  // The Growth chart's portfolio dataset (₹100-based) and the Account Value
  // chart's last point, as drawn.
  async function readCharts() {
    return p.evaluate(() => {
      function lastY(cfg, wanted) {
        if (!cfg || !cfg.data || !cfg.data.datasets) return null;
        const ds = cfg.data.datasets.find((d) => wanted.test(String(d.label || "")));
        if (!ds || !ds.data || !ds.data.length) return null;
        const pt = ds.data[ds.data.length - 1];
        return typeof pt === "object" ? pt.y : pt;
      }
      const growth = window.__charts["value-chart"] || window.__charts["account-value-chart"];
      const account = window.__charts["portfolio-value-chart"];
      return {
        growthLast: lastY(growth, /portfolio/i),
        accountLast: lastY(account, /portfolio|value|worth/i),
        overviewCurrent: (document.getElementById("overview-current-value") || {}).textContent,
      };
    });
  }

  async function setExclusion(id) {
    await p.click("#exclusions-toggle");
    await p.click("#" + id);
    await p.waitForTimeout(6000);
  }

  await p.waitForTimeout(10000);
  const none = await readCharts();
  console.log("A. No exclusion — the baseline both curves are measured against");
  ok(none.growthLast != null, "A1 the Growth chart drew a portfolio line", none);
  ok(none.accountLast != null, "A2 and so did Account Value", none);
  // Fund A 1000u ×20 = 20,000; Debt 1000u ×10 = 10,000; ACME 100 ×200 = 20,000.
  ok(near(none.accountLast, 50000, 1),
     "A3 Account Value totals every holding: 20,000 + 10,000 + 20,000", none.accountLast);

  await setExclusion("exclude-equity-toggle");
  const eqEx = await readCharts();
  console.log("\nB. Exclude Equity — Account Value drops, the ₹100 line does not");
  ok(near(eqEx.accountLast, 10000, 1),
     "B1 Account Value keeps only the debt fund, as the Overview beside it does", eqEx.accountLast);
  ok(near(eqEx.growthLast, none.growthLast),
     "B2 the Growth curve is UNCHANGED — the filter does not reach it",
     [eqEx.growthLast, none.growthLast]);

  await setExclusion("exclude-fixedincome-toggle");
  const fiEx = await readCharts();
  console.log("\nC. Exclude Fixed Income and Commodity — the mirror image");
  ok(near(fiEx.accountLast, 40000, 1),
     "C1 Account Value keeps the two equity holdings", fiEx.accountLast);
  ok(near(fiEx.growthLast, none.growthLast),
     "C2 the Growth curve is unchanged here too", [fiEx.growthLast, none.growthLast]);

  console.log("\nD. Which means the ₹100 line is the same under every filter");
  ok(near(eqEx.growthLast, fiEx.growthLast),
     "D1 all three states agree", [none.growthLast, eqEx.growthLast, fiEx.growthLast]);
  ok(eqEx.accountLast !== fiEx.accountLast,
     "D2 while Account Value genuinely moved, so the test can tell them apart",
     [eqEx.accountLast, fiEx.accountLast]);

  ok(errs.length === 0, "no page errors", errs);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
