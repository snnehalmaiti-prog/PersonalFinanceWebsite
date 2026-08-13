// 10Y rolling returns.
//
// computeRollingReturns has always been generic in windowYears; the 10Y pill was
// excluded by a hardcoded list — ROLLING_PERIODS = {1,2,3,5} — that conflated two
// different things. "All" names no window length, so there is genuinely nothing to
// roll. 10Y names one; it just needs a portfolio old enough to contain it, and a
// twelve-year portfolio contains two dozen such windows.
//
// Whether enough history exists is now decided per portfolio, from the series
// itself. The two outcomes have to be distinguishable on screen, because they were
// not before: a portfolio younger than the window and a portfolio whose data failed
// to load both rendered the same bare dash.
//
// Two fixtures, identical but for age:
//
//   OLD    14 years of monthly SIP  → 10Y windows exist  → a real median
//   YOUNG   4 years of monthly SIP  → none fit           → N/A, and it says why
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-rolling-10y.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const iso = (d) => d.toISOString().slice(0, 10);
const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`;

// A fund compounding at a steady 12%/yr, so every rolling window has the same
// answer and the median is that number — no fixture noise to reason around.
const RATE = 0.12;
function buildFixture(years) {
  const start = new Date(TODAY.getFullYear() - years, TODAY.getMonth(), 1);
  const days = []; { const d = new Date(start); while (d <= TODAY) { days.push(new Date(d)); d.setDate(d.getDate() + 1); } }
  const months = []; { const d = new Date(start); while (d <= TODAY) { months.push(new Date(d)); d.setMonth(d.getMonth() + 1); } }
  const priceAt = (d) => 10 * Math.pow(1 + RATE, (d - start) / (365.25 * 864e5));

  const equity = [TXN];
  months.forEach((d) => equity.push([ddmmyyyy(d), "Snnehal", "Fund A", "Buy", "10", priceAt(d).toFixed(4)]));

  return {
    start, days, priceAt,
    sheets: {
      "wf-equity-data": equity,
      "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
        ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]],
      "wf-stocksetf-data": [TXN],
      "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
      "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"]],
      "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
    },
  };
}

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const pctOf = (s) => (s == null ? null : parseFloat(String(s).replace(/[+%]/g, "")));

async function run(b, years) {
  const fx = buildFixture(years);
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const j = (o) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });

  const navHistory = fx.days.map((d) => ({
    date: `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`,
    nav: String(fx.priceAt(d).toFixed(4)),
  })).reverse();
  const indexSeries = {}; fx.days.forEach((d) => { indexSeries[iso(d)] = 1000 * Math.pow(1.09, (d - fx.start) / (365.25 * 864e5)); });

  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: navHistory })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { 100001: fx.priceAt(TODAY) } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {},
    index_history: { NIFTY50: { prices: indexSeries } },
  })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));
  await p.addInitScript(() => {
    window.Chart = function () {
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.data = {}; this.options = { plugins: { tooltip: {} } }; this.scales = { x: {}, y: {} };
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
    localStorage.setItem("wf-benchmark-period", "10");
  }, fx.sheets);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(14000);

  const read = () => p.evaluate(() => ({
    port: (document.getElementById("rolling-summary-port") || {}).textContent,
    idx: (document.getElementById("rolling-summary-idx") || {}).textContent,
    alpha: (document.getElementById("rolling-summary-alpha") || {}).textContent,
    title: (document.getElementById("rolling-summary-port") || {}).title,
  }));

  const tenY = await read();
  // 1Y on the same page, to show the pill genuinely drives the window.
  await p.click('.bench-period-row .range-pill[data-period="1"]');
  await p.waitForTimeout(6000);
  const oneY = await read();
  // And "All", which has no window length at all.
  await p.click('.bench-period-row .range-pill[data-period="all"]');
  await p.waitForTimeout(4000);
  const all = await read();

  await ctx.close();
  return { tenY, oneY, all, errs };
}

(async () => {
  const b = await chromium.launch();

  const old = await run(b, 14);
  console.log("A. A 14-year portfolio has 10-year windows, so 10Y reports a median");
  ok(/%/.test(old.tenY.port || ""), "A1 Portfolio Rolling Return is a percentage, not N/A", old.tenY.port);
  ok(old.tenY.port !== "N/A", "A2 specifically not the N/A the hardcoded list used to force");
  // The fund compounds at a flat 12%, so every window's answer is 12%.
  ok(Math.abs(pctOf(old.tenY.port) - 12) < 0.6,
     "A3 and it is the fund's own 12%/yr, which every window must give", old.tenY.port);
  ok(Math.abs(pctOf(old.tenY.idx) - 9) < 0.6,
     "A4 the index column is the index's own 9%/yr", old.tenY.idx);
  ok(Math.abs(pctOf(old.tenY.alpha) - 3) < 1.0, "A5 so the rolling alpha is ~3pp", old.tenY.alpha);
  ok(/Median of \d+ rolling 10-year windows/.test(old.tenY.title || ""),
     "A6 and the tooltip says how many windows the median summarises", old.tenY.title);

  console.log("\nB. The pill still drives the window");
  ok(Math.abs(pctOf(old.oneY.port) - 12) < 0.6,
     "B1 1Y rolls a one-year window and still reads 12%", old.oneY.port);
  ok(/rolling 1-year window/.test(old.oneY.title || ""),
     "B2 with a tooltip naming that window", old.oneY.title);
  ok(old.all.port === "N/A", "B3 “All” remains N/A — it names no window to roll", old.all.port);
  ok(/no(ne)?\b/i.test(old.all.title || ""), "B4 and says why", old.all.title);

  const young = await run(b, 4);
  console.log("\nC. A 4-year portfolio cannot fill a 10-year window, and says so");
  ok(young.tenY.port === "N/A", "C1 10Y is N/A", young.tenY.port);
  ok(/Needs 10 years of history/.test(young.tenY.title || ""),
     "C2 the tooltip explains it is the portfolio's age, not a failure", young.tenY.title);
  ok(/this portfolio has 3\.\d|this portfolio has 4\.\d/.test(young.tenY.title || ""),
     "C3 and names the span it does have", young.tenY.title);
  ok(Math.abs(pctOf(young.oneY.port) - 12) < 0.6,
     "C4 while 1Y on the same portfolio works normally", young.oneY.port);

  const errs = old.errs.concat(young.errs);
  ok(errs.length === 0, "no page errors", errs);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
