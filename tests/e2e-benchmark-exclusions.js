// BENCHMARK COMPARISON must describe the portfolio the Overview is showing.
//
// The reported bug: with "Exclude Equity" on, the Overview header dropped every
// equity holding but this card kept valuing the whole equity book — so Portfolio
// CAGR, Portfolio XIRR and the alpha beside them belonged to a portfolio that was
// not on screen. Nothing in the card read the exclusion at all; only the
// aggregator did.
//
// The fixture is built so the right answer is a round number rather than something
// only the shipped formula can produce:
//
//   Debt Fund   NAV flat at 10 for the whole window  → its own return is EXACTLY 0
//   Fund A      NAV 10 → 20 halfway through          → clearly positive
//   ACME        stock 100 → 200 halfway through      → clearly positive (SE leg)
//   NIFTY50     1000 → 1200 over the window          → a positive index CAGR
//
// So with Exclude Equity on, Portfolio CAGR and Portfolio XIRR must both read
// 0.00%: the only holding left is the flat debt fund. Before the fix they read the
// blended equity figure — the assertion that fails on the old code.
//
// The index side must NOT move: its window is anchored to the same start sample,
// so the same index CAGR appears under every exclusion. That is what makes the
// alpha comparable, and it separates "the card was rescoped" from "the card broke".
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-benchmark-exclusions.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const MF_MAP = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
  ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"],
  ["Debt Fund", "Fixed Income", "Debt Fund", "100002", "INFB"]];
const SE_MAP = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
  ["Acme Ltd", "Equity", "Large Cap", "Stocks", "India", "ACME", "Industrials"]];

// A two-year window ending today, so the card's "All" period covers it entirely.
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
// AMFI-style history: newest first, dd-mm-yyyy.
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
    localStorage.setItem("wf-benchmark-period", "all");
    localStorage.setItem("wf-benchmark-mode", "cagr");
  }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });

  // Read the card in both modes for whichever exclusion is in force.
  async function readCard() {
    await p.waitForFunction(() => {
      const el = document.getElementById("benchmark-portfolio-xirr");
      const status = document.getElementById("benchmark-status");
      return el && el.textContent.trim() !== "—" && el.textContent.trim() !== "" &&
             (!status || status.hidden || status.textContent.indexOf("Calculating") === -1);
    }, null, { timeout: 30000 });
    const grab = () => p.evaluate(() => ({
      port: (document.getElementById("benchmark-portfolio-xirr") || {}).textContent,
      idx: (document.getElementById("benchmark-index-xirr") || {}).textContent,
      alpha: (document.getElementById("benchmark-alpha") || {}).textContent,
      overviewCurrent: (document.getElementById("overview-current-value") || {}).textContent,
    }));
    await p.click("#bench-mode-cagr");
    const cagr = await grab();
    await p.click("#bench-mode-xirr");
    const xirr = await grab();
    await p.click("#bench-mode-cagr");
    return { cagr, xirr };
  }

  async function setExclusion(id) {
    await p.click("#exclusions-toggle");
    await p.click("#" + id);
    await p.waitForTimeout(6000);
  }

  await p.waitForTimeout(9000);
  const none = await readCard();
  console.log("A. No exclusion — the whole book, unchanged behaviour");
  ok(pctOf(none.cagr.port) > 10, "A1 Portfolio CAGR is the blended (mostly doubling) return", none.cagr.port);
  ok(pctOf(none.cagr.idx) > 5 && pctOf(none.cagr.idx) < 15, "A2 the index CAGR is the fixture's ~9.5%", none.cagr.idx);
  ok(pctOf(none.xirr.port) > 10, "A3 Portfolio XIRR likewise", none.xirr.port);

  await setExclusion("exclude-equity-toggle");
  const eqEx = await readCard();
  console.log("\nB. Exclude Equity — only the flat debt fund is left, so the return is 0");
  ok(pctOf(eqEx.cagr.port) === 0, "B1 Portfolio CAGR is the debt fund's own 0.00%, not the equity book's", eqEx.cagr.port);
  ok(pctOf(eqEx.xirr.port) === 0, "B2 Portfolio XIRR too — flows and terminal cover the same holding", eqEx.xirr.port);
  ok(pctOf(eqEx.cagr.idx) === pctOf(none.cagr.idx),
     "B3 the index side is unmoved: same window, same start sample, same CAGR", [eqEx.cagr.idx, none.cagr.idx]);
  ok(pctOf(eqEx.cagr.alpha) === -pctOf(eqEx.cagr.idx),
     "B4 so the alpha is exactly the index's return, given up by holding the flat fund", eqEx.cagr.alpha);

  await setExclusion("exclude-fixedincome-toggle");
  const fiEx = await readCard();
  console.log("\nC. Exclude Fixed Income — the mirror image, equity only");
  ok(pctOf(fiEx.cagr.port) > 10, "C1 Portfolio CAGR is the equity holdings' own return", fiEx.cagr.port);
  ok(pctOf(fiEx.cagr.port) > pctOf(none.cagr.port),
     "C2 and it beats the blend, since the flat debt fund is no longer dragging it", [fiEx.cagr.port, none.cagr.port]);
  ok(pctOf(fiEx.xirr.port) > 10, "C3 Portfolio XIRR likewise", fiEx.xirr.port);

  ok(errs.length === 0, "no page errors", errs);
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
