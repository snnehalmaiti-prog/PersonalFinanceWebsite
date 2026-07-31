// Portfolio XIRR, end to end in a real browser, against an XIRR written here from
// the definition rather than by calling the shipped solver.
//
// Does it include CLOSED positions, and does it treat mutual funds and stocks the
// same way? It did not: the stocks/ETF flows were gathered from the OPEN holdings,
// so a position that had been fully sold contributed neither its cost nor its
// proceeds, while mutual funds had no such filter.
//
// NOT in run-all.js — needs a static server and Playwright's Chromium.
//
//     node tools/serve.js &
//     node tests/e2e-xirr.js
//
// Fixture is chosen so the two answers are far apart:
//   Fund A : buy Rs1,000 on 1-Jan, sell for Rs2,000 on 1-Jul  (+100% in 6 months)
//   Stock S: buy Rs10,000 on 1-Jan, sell for Rs5,000 on 1-Jul (-50% in 6 months)
// Both are fully closed. Nothing is held at the end.
//
// If both are counted: Rs11,000 in, Rs7,000 out six months later => a heavy loss.
// If the stock is dropped: only the fund remains => a large gain.
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"],
    ["1-Jul-2024", "Snnehal", "Fund A", "Sell", "100", "20"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]],
  "wf-stocksetf-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Stock S", "Buy", "100", "100"],
    ["1-Jul-2024", "Snnehal", "Stock S", "Sell", "100", "50"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["Stock S", "Equity", "Stock", "Large Cap", "India", "STOCKS", "Financials"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};
const START = "2024-01-01", END = "2024-12-01";
function days() { const o = []; const d = new Date(START + "T00:00:00"), e = new Date(END + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; }
function navSeries() { return days().map((iso) => { const [y, m, dd] = iso.split("-");
  return { date: `${dd}-${m}-${y}`, nav: String(iso >= "2024-07-01" ? 20 : 10) }; }).reverse(); }
function priceMap(before, after) { const o = {}; days().forEach((iso) => { o[iso] = iso >= "2024-07-01" ? after : before; }); return o; }

// Independent XIRR, written here from the definition, on the flows the fixture implies.
function xirr(flows) {
  const t0 = Math.min(...flows.map((f) => +new Date(f.d)));
  const yrs = (d) => (+new Date(d) - t0) / (365.25 * 864e5);
  const npv = (r) => flows.reduce((s, f) => s + f.a / Math.pow(1 + r, yrs(f.d)), 0);
  let lo = -0.9999, hi = 100;
  for (let i = 0; i < 300; i++) { const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: navSeries() }) }));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: { INF1: "100033" } }) }));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: { "100033": 20 } }) }));
  await p.route("**/stock_prices.json*", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ prices: { __USD_INR__: { price: 84 }, STOCKS: { price: 50, currency: "INR" } }, usd_inr_history: {},
      index_history: { NIFTY50: { prices: priceMap(1000, 1100) } } }) }));
  await p.route("**/stock_history.json*", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ stock_history: { STOCKS: { currency: "INR", prices: priceMap(100, 50) } } }) }));
  await p.addInitScript(() => {
    window.__charts = {};
    window.Chart = function (c, cfg) { window.__charts[c && c.canvas ? c.canvas.id : "?"] = cfg;
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.data = cfg && cfg.data; this.options = cfg && cfg.options; this.scales = { x: {}, y: {} };
      this.getElementsAtEventForMode = function () { return []; }; };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(10000);
  const out = await p.evaluate(() => ({
    overviewXirr: (document.getElementById("overview-xirr") || {}).textContent,
    portXirr: (document.getElementById("benchmark-portfolio-xirr") || {}).textContent,
    idxXirr: (document.getElementById("benchmark-index-xirr") || {}).textContent,
    ids: [...document.querySelectorAll('[id*="xirr"]')].map((e) => e.id + "=" + e.textContent.trim()),
  }));
  const both = 100 * xirr([{ d: "2024-01-01", a: -11000 }, { d: "2024-07-01", a: 7000 }]);
  const fundOnly = 100 * xirr([{ d: "2024-01-01", a: -1000 }, { d: "2024-07-01", a: 2000 }]);
  const num = (t) => parseFloat(String(t || "").replace(/[^0-9.\-]/g, ""));

  let pass = 0, fail = 0;
  function ok(cond, name, detail) {
    if (cond) { pass++; console.log("  PASS  " + name); }
    else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  \u2192 " + JSON.stringify(detail) : "")); }
  }
  console.log("\nExpected from the fixture's real flows: both " + both.toFixed(2) +
              "%, fund alone " + fundOnly.toFixed(2) + "%");
  console.log("Reported: " + JSON.stringify(out) + "\n");

  ok(Math.abs(num(out.portXirr) - both) < 0.1,
     "A1 the benchmark card's portfolio XIRR counts the closed stock", [out.portXirr, both]);
  ok(Math.abs(num(out.overviewXirr) - both) < 0.1,
     "A2 the Overview XIRR agrees with it", [out.overviewXirr, both]);
  ok(Math.abs(num(out.portXirr) - fundOnly) > 1,
     "A3 and is not the fund-only figure, which is what dropping the stock gave", out.portXirr);
  ok(num(out.portXirr) < 0,
     "A4 a portfolio that put in 11,000 and took out 7,000 shows a loss", out.portXirr);
  // The index replays the same money, so it must be priced off the full amount too.
  ok(out.idxXirr && num(out.idxXirr) > 0,
     "A5 the index replay produced a rate", out.idxXirr);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
