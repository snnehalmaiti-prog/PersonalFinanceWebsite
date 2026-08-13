// Switching the benchmark index must redraw ONLY the benchmark line — and must
// draw exactly the line a full render would have drawn.
//
// The portfolio curve on the Growth chart is built from the sheets: which index
// is selected cannot move it. So an index change re-runs just the index tail
// against the artifacts the last render produced, instead of re-entering the
// whole render — the timeline, the forward fills, the per-instrument valuation,
// the Account Value chart and the snapshot series. On an 8-year, 22-instrument
// portfolio that took a benchmark switch from ~250 ms to ~40 ms.
//
// The risk that buys is a stale or half-updated chart, so this suite pins the
// invariant that makes the shortcut safe:
//
//   fast-path redraw (dropdown)  ===  full render (reload with that index saved)
//
// point for point, with the portfolio line untouched throughout.
//
// The fixture gives the two indexes clearly different shapes — NIFTY50 doubles
// over the window, NIFTY500 is flat — so "the line changed" cannot pass by
// accident.
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-benchmark-index-switch.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const MF_MAP = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
  ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]];
const SE_MAP = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
  ["Acme Ltd", "Equity", "Large Cap", "Stocks", "India", "ACME", "Industrials"]];

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const START = new Date(TODAY.getFullYear() - 3, TODAY.getMonth(), 1);
const MID = new Date(TODAY.getFullYear() - 1, TODAY.getMonth(), 1);
const iso = (d) => d.toISOString().slice(0, 10);
const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`;

const ALL_DAYS = (() => { const o = []; const d = new Date(START); while (d <= TODAY) { o.push(new Date(d)); d.setDate(d.getDate() + 1); } return o; })();
const doubles = (d) => (d >= MID ? 20 : 10);
function navHistory(priceAt) {
  return ALL_DAYS.map((d) => ({ date: `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`, nav: String(priceAt(d)) })).reverse();
}
function seriesByIso(priceAt) { const o = {}; ALL_DAYS.forEach((d) => { o[iso(d)] = priceAt(d); }); return o; }

const SHEETS = {
  "wf-equity-data": [TXN, [ddmmyyyy(START), "Snnehal", "Fund A", "Buy", "1000", "10"]],
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
const sameSeries = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function makePage(b) {
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1200 } });
  const p = await ctx.newPage();
  const j = (o) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: navHistory(doubles) })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { 100001: 20 } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: 84 }, ACME: { price: 200, prev_close: 200, currency: "INR" } },
    usd_inr_history: {},
    index_history: {
      // Doubles over the window.
      NIFTY50: { prices: seriesByIso((d) => 1000 * (1 + (d - START) / (TODAY - START))) },
      // Dead flat — a shape nothing else in the fixture has.
      NIFTY500: { prices: seriesByIso(() => 1500) },
    },
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
  return p;
}

// The Growth chart's two lines, rounded so float noise can't fail an equality.
const readChart = (p) => p.evaluate(() => {
  const cfg = window.__charts["value-chart"];
  if (!cfg || !cfg.data) return null;
  const pick = (re) => {
    const ds = (cfg.data.datasets || []).find((d) => re.test(String(d.label || "")));
    if (!ds) return null;
    return (ds.data || []).map((pt) => (pt && typeof pt === "object" ? (pt.y == null ? null : Math.round(pt.y * 100) / 100) : pt));
  };
  return {
    portfolio: pick(/portfolio/i),
    index: pick(/nifty|index/i),
    indexLabel: (document.getElementById("avc-index-name") || {}).textContent,
    indexValue: (document.getElementById("avc-index-value") || {}).textContent,
    portValue: (document.getElementById("avc-portfolio-value") || {}).textContent,
  };
});

async function boot(p, indexKey) {
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate(([s, k]) => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const key in s) localStorage.setItem(key, JSON.stringify(s[key]));
    localStorage.setItem("wf-benchmark-index", k);
  }, [SHEETS, indexKey]);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(10000);
}

(async () => {
  const b = await chromium.launch();
  const errs = [];

  // (1) Full render on NIFTY50, then the FAST PATH to NIFTY500 via the dropdown.
  const p1 = await makePage(b);
  p1.on("pageerror", (e) => errs.push(e.message));
  await boot(p1, "NIFTY50");
  const n50 = await readChart(p1);

  await p1.click("#benchmark-toggle");
  await p1.click('#benchmark-menu [data-value="NIFTY500"]');
  await p1.waitForTimeout(5000);
  const fast = await readChart(p1);

  // (2) A cold load with NIFTY500 already saved — the full render, for comparison.
  const p2 = await makePage(b);
  p2.on("pageerror", (e) => errs.push(e.message));
  await boot(p2, "NIFTY500");
  const full = await readChart(p2);

  console.log("A. The chart drew both lines in every state");
  ok(n50 && n50.portfolio && n50.portfolio.length, "A1 NIFTY50 full render has a portfolio line", n50 && n50.portfolio && n50.portfolio.length);
  ok(n50 && n50.index && n50.index.length, "A2 and a benchmark line", n50 && n50.index && n50.index.length);
  ok(fast && fast.index && fast.index.length, "A3 the fast-path redraw has one too", fast && fast.index && fast.index.length);
  ok(full && full.index && full.index.length, "A4 and so does the NIFTY500 full render", full && full.index && full.index.length);

  console.log("\nB. The index line actually changed — the shortcut is not a no-op");
  ok(!sameSeries(n50.index, fast.index),
     "B1 switching NIFTY50 → NIFTY500 moved the benchmark line");
  ok(fast.indexLabel === "Nifty 500", "B2 and the legend renamed with it", fast.indexLabel);
  ok(n50.indexValue !== fast.indexValue, "B3 and its legend figure changed", [n50.indexValue, fast.indexValue]);

  console.log("\nC. …to exactly what a full render would have drawn");
  ok(sameSeries(fast.index, full.index),
     "C1 the fast-path benchmark line matches the full render's, point for point",
     [fast.index && fast.index.slice(-3), full.index && full.index.slice(-3)]);
  ok(fast.indexValue === full.indexValue, "C2 as does its legend figure", [fast.indexValue, full.indexValue]);
  ok(fast.indexLabel === full.indexLabel, "C3 and its name", [fast.indexLabel, full.indexLabel]);

  console.log("\nD. The portfolio line is untouched by any of it");
  ok(sameSeries(n50.portfolio, fast.portfolio),
     "D1 the fast path left the portfolio curve exactly as it was",
     [n50.portfolio && n50.portfolio.slice(-3), fast.portfolio && fast.portfolio.slice(-3)]);
  ok(sameSeries(fast.portfolio, full.portfolio),
     "D2 and it equals the one a full render builds — the index never fed it",
     [fast.portfolio && fast.portfolio.slice(-3), full.portfolio && full.portfolio.slice(-3)]);
  ok(n50.portValue === fast.portValue && fast.portValue === full.portValue,
     "D3 its legend figure is the same in all three", [n50.portValue, fast.portValue, full.portValue]);

  ok(errs.length === 0, "no page errors", errs);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
