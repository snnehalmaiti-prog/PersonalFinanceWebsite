// Selecting a portfolio must re-measure the Benchmark Comparison card against
// THAT portfolio's Stocks/ETF cash flows.
//
// Selecting a portfolio clears the Overview's INR-converted Stocks/ETF flows and
// kicks off a fresh Stocks/ETF render. The benchmark card refreshes on the
// wf-overview-flows-ready that fires in between — when those flows are empty —
// so it falls back to the raw sheet rows, whose US amounts are in DOLLARS while
// the terminal it pays them out against is in rupees. On this fixture that
// reported roughly +300% where the money actually earned ~+30%.
//
// The re-run that fixes it arrives with wf-se-xirr-ready. It used to be gated on
// a boolean — "has this card ever seen SE flows?" — which was still true from the
// PREVIOUS portfolio, so the handler returned early and the wrong figure stayed
// on screen until a full reload. Hence the invariant pinned here:
//
//   navigate to a portfolio  ===  reload with that portfolio selected
//
// WHICH ORDER the two async legs finish in is a race, and on a fixture this small
// the Stocks/ETF leg usually wins — so this suite passes against the old code
// too. It is the end-state invariant that is worth pinning; the guard logic that
// makes it hold whichever leg lands first is asserted directly in
// test-benchmark-card.js (section G), which runs in CI.
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     python3 -m http.server 8099 &
//     node tests/e2e-benchmark-portfolio-nav.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8099;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const START = new Date(TODAY.getFullYear() - 3, TODAY.getMonth(), 1);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, "0")}-${d.toLocaleString("en-US", { month: "short" })}-${d.getFullYear()}`;

const ALL_DAYS = (() => { const o = []; const d = new Date(START); while (d <= TODAY) { o.push(new Date(d)); d.setDate(d.getDate() + 1); } return o; })();
const seriesByIso = (priceAt) => { const o = {}; ALL_DAYS.forEach((d) => { o[iso(d)] = priceAt(d); }); return o; };
const navHistory = (priceAt) => ALL_DAYS.map((d) =>
  ({ date: `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`, nav: String(priceAt(d)) })).reverse();

// P1 is a plain rupee mutual fund. P2 is a single US stock — bought at $10 when
// the rupee was 75, worth $20 at 84 today. Its rupee return is real but modest;
// its DOLLAR flows against a rupee terminal are not, which is what makes the
// stale-leg bug impossible to miss.
const RATE_THEN = 75, RATE_NOW = 84;
const SHEETS = {
  "wf-equity-data": [TXN, [ddmmyyyy(START), "P1", "Fund A", "Buy", "1000", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]],
  // P1 holds a RUPEE stock as well as its fund: the card must have seen a
  // Stocks/ETF leg before the switch, or the stale-leg path never opens.
  "wf-stocksetf-data": [TXN,
    [ddmmyyyy(START), "P1", "Desi Ltd", "Buy", "100", "50"],
    [ddmmyyyy(START), "P2", "Alpha Corp", "Buy", "100", "10"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["Alpha Corp", "Equity", "Stock", "Large Cap", "US", "ALPHA", "Tech"],
    ["Desi Ltd", "Equity", "Stock", "Large Cap", "India", "DESI", "Tech"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const pctOf = (s) => (s == null ? null : parseFloat(String(s).replace(/[+%]/g, "")));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const j = (o) => ({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });

  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: navHistory(() => 20) })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: {} })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { 100001: 20 } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: RATE_NOW }, ALPHA: { price: 20, prev_close: 20, currency: "USD" }, DESI: { price: 60, prev_close: 60 } },
    usd_inr_history: { [iso(START)]: RATE_THEN },
    index_history: { NIFTY50: { prices: seriesByIso((d) => 1000 + 200 * ((d - START) / (TODAY - START))) } },
  })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({
    stock_history: {
      ALPHA: { currency: "USD", prices: seriesByIso(() => 20) },
      DESI: { currency: "INR", prices: seriesByIso(() => 60) } } })));

  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.data = cfg && cfg.data; this.options = cfg && cfg.options; this.scales = { x: {}, y: {} };
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  async function seed(selectedPortfolio) {
    await p.evaluate(([s, sel]) => {
      localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
      localStorage.setItem("wf-portfolio-names", JSON.stringify(["P1", "P2"]));
      localStorage.setItem("wf-selected-portfolio", sel);
      localStorage.setItem("wf-benchmark-index", "NIFTY50");
      localStorage.setItem("wf-benchmark-period", "all");
      localStorage.setItem("wf-benchmark-mode", "xirr");
    }, [SHEETS, selectedPortfolio]);
  }

  async function readCard() {
    await p.waitForFunction(() => {
      const el = document.getElementById("benchmark-portfolio-xirr");
      const status = document.getElementById("benchmark-status");
      return el && el.textContent.trim() !== "—" && el.textContent.trim() !== "" &&
             (!status || status.hidden || status.textContent.indexOf("Calculating") === -1);
    }, null, { timeout: 30000 });
    return p.evaluate(() => ({
      port: (document.getElementById("benchmark-portfolio-xirr") || {}).textContent,
      idx: (document.getElementById("benchmark-index-xirr") || {}).textContent,
      alpha: (document.getElementById("benchmark-alpha") || {}).textContent,
    }));
  }

  const url = `http://127.0.0.1:${PORT}/dashboard.html?nosw=1`;

  // Reference: load straight into P2. Nothing is stale on a cold load, so this is
  // the figure navigation has to reproduce.
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await seed("P2");
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(9000);
  const reloaded = await readCard();

  console.log("A. A cold load of the US-stock portfolio measures it in rupees");
  ok(pctOf(reloaded.port) > 10 && pctOf(reloaded.port) < 60,
     "A1 Portfolio XIRR is the rupee return (~30%/yr), not a dollar/rupee mix", reloaded.port);
  ok(pctOf(reloaded.idx) != null && isFinite(pctOf(reloaded.idx)),
     "A2 the index leg has data", reloaded.idx);

  // Now the same portfolio reached by navigation, starting from P1.
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await seed("P1");
  await p.goto(url, { waitUntil: "load" });
  await p.waitForTimeout(9000);
  const onP1 = await readCard();

  await p.evaluate(() => {
    const btn = document.querySelector('#portfolio-pills [data-ov-portfolio="P2"]');
    if (btn) btn.click();
  });
  await p.waitForTimeout(9000);
  const navigated = await readCard();

  console.log("\nB. Reaching it by portfolio navigation reports the same thing");
  ok(onP1.port !== navigated.port, "B1 the card actually moved off P1's figure", [onP1.port, navigated.port]);
  ok(Math.abs(pctOf(navigated.port) - pctOf(reloaded.port)) < 0.5,
     "B2 Portfolio XIRR matches the cold load — the new portfolio's INR flows, not the old leg",
     [navigated.port, reloaded.port]);
  ok(Math.abs(pctOf(navigated.alpha) - pctOf(reloaded.alpha)) < 0.5,
     "B3 and so does the alpha built on it", [navigated.alpha, reloaded.alpha]);
  ok(pctOf(navigated.port) < 100,
     "B4 no dollar-flows-against-a-rupee-terminal blow-up", navigated.port);

  ok(errs.length === 0, "no page errors", errs);
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
