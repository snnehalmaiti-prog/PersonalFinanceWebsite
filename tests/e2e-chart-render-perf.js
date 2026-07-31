// Load-time cost of the two value charts, on a portfolio the size of the reported
// one: 18 mapped funds and 6 stocks, daily NAV back to 2018, eight years of monthly
// SIPs into every one of them.
//
// Two things are measured:
//
//  1. The per-point loop called normalizeText per instrument per timeline point and
//     rebuilt Object.keys(seUnitEventsByTicker) each time round — tens of thousands
//     of string normalisations for a chart of a few thousand points, all invariant.
//
//  2. A dozen things ask for a re-render during one load (the initial call, each
//     sheet arriving, the overview flows landing, the exclusion toggle) and every
//     one started its own full async pipeline: NAV history, prices, the whole
//     timeline. Whichever finished last painted, however little it knew — which is
//     how a chart drawn from a partial instrument set could end up on screen.
//
// Debouncing the re-renders was tried and measured WORSE than the generation guard
// alone (13 chart builds against 7): holding runs back on a timer stops them
// superseding each other. The guard is the whole fix.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     node tools/serve.js &
//     node tests/e2e-chart-render-perf.js
//
// The blocked-main-thread figure is machine-dependent, so it is reported but only
// loosely bounded. The chart-build counts are deterministic and are what is asserted.
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const N_FUNDS = 18, N_STOCKS = 6;
const START = "2018-04-01", END = "2026-07-31";
function days(from, to) {
  const o = []; const d = new Date(from + "T00:00:00"), e = new Date(to + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return o;
}
const DAYS = days(START, END);
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

// Monthly SIP into every fund and stock for eight years — the shape that makes the
// traded-units lookups fire on thousands of (instrument, date) pairs.
const equityRows = [TXN], seRows = [TXN];
DAYS.forEach((iso) => {
  if (!iso.endsWith("-05")) return;
  const [y, m, d] = iso.split("-");
  const dt = `${d}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]}-${y}`;
  for (let f = 0; f < N_FUNDS; f++) equityRows.push([dt, "Snnehal", "Fund " + f, "Buy", "10", "50"]);
  for (let s = 0; s < N_STOCKS; s++) seRows.push([dt, "Snnehal", "Stock " + s, "Buy", "5", "200"]);
});

const mfMap = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]];
const isinToCode = {};
for (let f = 0; f < N_FUNDS; f++) {
  mfMap.push(["Fund " + f, "Equity", "Flexi Cap", String(100000 + f), "INF" + f]);
  isinToCode["INF" + f] = String(100000 + f);
}
const seMap = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]];
for (let s = 0; s < N_STOCKS; s++) seMap.push(["Stock " + s, "Equity", "Stock", "Large Cap", "India", "TICK" + s, "Financials"]);

const SHEETS = {
  "wf-equity-data": equityRows,
  "wf-mfmapping-data": mfMap,
  "wf-stocksetf-data": seRows,
  "wf-stocksetfmapping-data": seMap,
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"],
    ["3-Jun-2019", "Snnehal", "HDFC", "Deposit-1", "Fixed Income", "Fixed Deposit", "Deposit", "100000", "4-Jun-2021", "6.25%"],
    ["1-Apr-2018", "Snnehal", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "75000", "", "3%"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"],
    ["1-Apr-2019", "Snnehal", "EPF", "Fixed Income", "Provident Fund", "Deposit", "12000"]],
};

function navBody() {
  let n = 10;
  const data = DAYS.map((iso) => {
    n *= 1.0004;
    const [y, m, d] = iso.split("-");
    return { date: `${d}-${m}-${y}`, nav: n.toFixed(4) };
  }).reverse();
  return JSON.stringify({ data });
}
const NAV_BODY = navBody();
function priceMap() { const o = {}; let n = 100; DAYS.forEach((iso) => { n *= 1.0004; o[iso] = +n.toFixed(2); }); return o; }
const PRICES = priceMap();
const stockHistory = {};
for (let s = 0; s < N_STOCKS; s++) stockHistory["TICK" + s] = { currency: "INR", prices: PRICES };
const livePrices = { __USD_INR__: { price: 84 } };
for (let s = 0; s < N_STOCKS; s++) livePrices["TICK" + s] = { price: 300, currency: "INR" };

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: NAV_BODY }));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: isinToCode }) }));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: {} }) }));
  await p.route("**/stock_prices.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prices: livePrices, usd_inr_history: {}, index_history: { NIFTY50: { prices: PRICES } } }) }));
  await p.route("**/stock_history.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stock_history: stockHistory }) }));

  await p.addInitScript(() => {
    window.__chartBuilds = 0;
    window.Chart = function (ctx, cfg) {
      window.__chartBuilds++;
      const lim = ((((cfg.options || {}).plugins || {}).zoom || {}).limits || {}).x || {};
      this.data = cfg.data; this.options = cfg.options;
      this.scales = { x: { min: lim.min, max: lim.max }, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function (i, r) { this.scales.x.min = r.min; this.scales.x.max = r.max; };
      this.resetZoom = function () {}; this.destroy = function () {}; this.update = function () {};
      this.resize = function () {}; this.getElementsAtEventForMode = function () { return []; };
      if (ctx && ctx.canvas && ctx.canvas.id === "value-chart") {
        window.__growthPoints = (cfg.data.datasets[0].data || []).filter((q) => q && q.y != null).length;
      }
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
  }, SHEETS);

  // Long-task total is the honest number: it is what makes the page feel stuck.
  await p.addInitScript(() => {
    window.__blocked = 0; window.__tasks = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__blocked += e.duration; window.__tasks++; } })
      .observe({ entryTypes: ["longtask"] });
  });
  // Record every DISTINCT chart the user would have seen during the load. A flash
  // is a state that appears and is then replaced by a different one.
  await p.addInitScript(() => {
    window.__seen = [];
    setInterval(() => {
      const ch = window.__wfValueChart;
      if (!ch || !ch.data) return;
      const pts = (ch.data.datasets[0].data || []).filter((q) => q && q.y != null);
      if (!pts.length) return;
      const st = new Date(pts[0].x).getFullYear() + "|" + Math.round(pts[pts.length - 1].y) + "|" + pts.length;
      if (window.__seen[window.__seen.length - 1] !== st) window.__seen.push(st);
    }, 120);
  });
  const t0 = Date.now();
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(14000);
  const m = await p.evaluate(() => ({
    blocked: Math.round(window.__blocked || 0), tasks: window.__tasks || 0,
    chartBuilds: window.__chartBuilds, growthPoints: window.__growthPoints,
    statusVisible: (() => { const e = document.getElementById("value-chart-status");
      return e ? (!e.hidden && e.offsetParent !== null) : null; })(),
    statusText: (document.getElementById("value-chart-status") || {}).textContent,
    period: (document.getElementById("avc-period") || {}).textContent,
    portValue: (document.getElementById("avc-portfolio-value") || {}).textContent,
    seen: window.__seen,
  }));
  // The burst a real load produces: several independent triggers within a few
  // hundred ms. They must collapse rather than each running the whole pipeline.
  const before = await p.evaluate(() => window.__chartBuilds);
  await p.evaluate(() => {
    document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
    document.dispatchEvent(new CustomEvent("wf-exclusion-changed"));
    document.dispatchEvent(new CustomEvent("wf-benchmark-changed"));
    document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
    document.dispatchEvent(new CustomEvent("wf-exclusion-changed"));
  });
  await p.waitForTimeout(6000);
  const burstBuilds = (await p.evaluate(() => window.__chartBuilds)) - before;

  let pass = 0, fail = 0;
  function ok(cond, name, detail) {
    if (cond) { pass++; console.log("  PASS  " + name); }
    else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  \u2192 " + JSON.stringify(detail) : "")); }
  }
  console.log("  " + JSON.stringify(Object.assign({ wallMs: Date.now() - t0, burstBuilds }, m)));

  // Each run builds two charts, so five triggers cost ten builds unless the
  // superseded ones bail. Deterministic: 14 without the generation guard, 2 with it.
  ok(burstBuilds <= 2,
     "A1 five rapid re-render triggers cost one paint, not five", burstBuilds);
  // Load-timing dependent, so bounded loosely. Measured 21 before, 7-11 after.
  ok(m.chartBuilds <= 14,
     "A2 the initial load does not rebuild the charts a dozen times over", m.chartBuilds);

  // Only ONE chart state may ever reach the screen. A second entry means the user
  // saw a chart that was then replaced — the flash on refresh.
  ok((m.seen || []).length === 1,
     "A3 the chart is drawn once, not drawn wrong and then corrected", m.seen);
  ok((m.seen || [])[0] && m.seen[0].indexOf("2018|") === 0,
     "A4 and it is drawn from the true inception, not a partial instrument set", m.seen);

  ok(m.period === "SINCE 2018",
     "A5 the period line agrees with the plotted history", m.period);
  ok(m.statusVisible === false,
     "A6 no progress message is left stranded under the finished chart", [m.statusVisible, m.statusText]);
  ok(errs.length === 0, "A7 no page errors", errs.slice(0, 3));

  console.log("\n  blocked main thread: " + m.blocked + "ms over " + m.tasks + " long tasks");
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
