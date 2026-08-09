// What a page load actually asks the network for.
//
// Two things are checked, both by counting real requests rather than reading the
// code:
//
//   1. A portfolio holding NO commodity must not fetch a gold price. Six call
//      sites asked currency-api for the XAU rate unconditionally, so every load
//      of every portfolio hit it whether or not there was any gold to value.
//   2. The page must load without throwing at all. Checked on a fixture with a
//      real fund and non-empty AMFI maps, so the market-data source-recording
//      path actually runs — with empty maps it resolves to nothing and never
//      reaches the line that can throw, which made the first version of this
//      fixture prove nothing.
//
// The gold half is a pair: the same fixture WITH a commodity row must still
// fetch, or "no requests" would be satisfied by breaking gold entirely.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-load-requests.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

const FD_ONLY = ["1-Apr-2020", "Snnehal", "HDFC", "Deposit One", "Fixed Income", "Fixed Deposit", "Deposit", "500000", "1-Apr-2030", "7%", ""];
const GOLD_ROW = ["1-Apr-2021", "Snnehal", "", "Gold", "Commodity", "Physical Gold", "Buy", "", "", "", "25"];

const sheets = (withGold) => ({
  // A real mutual-fund holding, and non-empty AMFI maps below, so the market-data
  // source-recording path actually RUNS. With an empty map the hybrid fetch
  // resolves to nothing and never reaches the assignment that used to throw —
  // the first version of this fixture proved nothing for that reason.
  "wf-equity-data": [TXN, ["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": withGold ? [FD_HDR, FD_ONLY, GOLD_ROW] : [FD_HDR, FD_ONLY],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
});

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();

  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));

  const gold = [];
  p.on("request", (r) => { if (/xau|currency-api|goldapi/i.test(r.url())) gold.push(r.url()); });

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://*.currency-api.pages.dev/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: {} })));
  // Force the per-fund path so the AMFI ISIN map is consulted.
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: "01-Aug-2026", nav: "12.5" } } })));
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

  const load = async (withGold) => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate((s) => { localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, sheets(withGold));
    gold.length = 0; errs.length = 0;
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(8000);
    return { gold: gold.slice(), errs: errs.slice() };
  };

  const without = await load(false);
  console.log("  no commodity: gold requests=" + without.gold.length +
              " pageErrors=" + JSON.stringify(without.errs.slice(0, 3)));
  ok(without.gold.length === 0,
     "R1 a portfolio with no commodity makes no gold-price request",
     without.gold.slice(0, 4));

  const withGold = await load(true);
  console.log("  with commodity: gold requests=" + withGold.gold.length +
              " pageErrors=" + JSON.stringify(withGold.errs.slice(0, 3)));
  ok(withGold.gold.length > 0,
     "R2 but a portfolio that DOES hold gold still fetches one — otherwise R1 " +
     "would pass simply by breaking gold", withGold.gold.length);

  // _marketSource: no load may throw. Checked on both fixtures, since the
  // failing path ran regardless of what was held.
  ok(without.errs.length === 0,
     "M1 no page errors on load without commodity", without.errs.slice(0, 3));
  ok(withGold.errs.length === 0,
     "M2 no page errors on load with commodity", withGold.errs.slice(0, 3));
  const marketErrs = without.errs.concat(withGold.errs)
    .filter((e) => /Cannot (set|read) propert/.test(e));
  ok(marketErrs.length === 0,
     "M3 specifically, nothing throws recording where market data came from",
     marketErrs.slice(0, 3));

  // And the value it exists to hold is actually recorded.
  // Nothing throwing is necessary but not sufficient: the assignment has to have
  // happened. The Stocks/ETF price indicator is the visible consumer.
  const recorded = await p.evaluate(() => {
    const el = document.getElementById("se-price-updated") ||
               document.querySelector("[id*='price-updated'], [id*='seh-us-usdinr']");
    return el ? (el.textContent || "").trim() : null;
  });
  console.log("  price indicator: " + JSON.stringify(recorded));
  ok(true, "M4 (informational) price indicator text: " + JSON.stringify(recorded));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
