// Integration smoke: the whole dashboard on ONE realistic portfolio — multiple
// funds, Indian and US stocks, a closed position, an FD, a savings account, an
// investment corpus, EPF, and physical gold.
//
// Every per-feature suite runs on a small isolated fixture. This one checks the
// features do not break each other, and that a portfolio with every asset class
// in it renders at all: physical gold alone pulls in ~90 gold-price requests that
// gate BOTH value charts, which is why they are stubbed below.
//
// Trades are priced at whatever the stubbed price series quotes on that date. That
// matters: with trades at prices the series never had, TWR and XIRR diverge for
// reasons that are the fixture's fault, and V7c cannot mean anything.
//
// Original header:
// Integration smoke: everything this session touched, together, on ONE realistic
// portfolio — multiple funds, Indian and US stocks, an FD, a savings account,
// EPF, and physical gold. The per-feature suites each run on a small isolated
// fixture; this checks the features do not break each other.
//
// Exercises: both value charts (hover readout, zoom, drag, period line), all
// three CASH FLOW · MONTHLY modes and the switches between them, the idle-cash
// legend, and the year / all-time controls. Asserts zero page errors throughout.
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const FI_HDR = ["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Amount"];

const START = "2019-01-01", END = "2026-07-01";
function days() { const o = []; const d = new Date(START + "T00:00:00"), e = new Date(END + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; }
const DAYS = days();

const N_FUNDS = 4;
const equity = [TXN], se = [TXN];
DAYS.forEach((iso) => {
  if (!iso.endsWith("-05")) return;
  const [y, m, d] = iso.split("-");
  const dt = `${d}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m - 1]}-${y}`;
  const navHere = (10 * Math.pow(1.0004, DAYS.indexOf(iso))).toFixed(4);
  const inHere = (100 * Math.pow(1.0004, DAYS.indexOf(iso))).toFixed(2);
  const usHere = (20 * Math.pow(1.0005, DAYS.indexOf(iso))).toFixed(2);
  for (let f = 0; f < N_FUNDS; f++) equity.push([dt, "Snnehal", "Fund " + f, "Buy", "10", navHere]);
  se.push([dt, "Snnehal", "INDIA CO", "Buy", "5", inHere]);
  se.push([dt, "Snnehal", "US CO", "Buy", "2", usHere]);
});
// A closed position, so FIFO/realized paths are exercised too.


// A closed position, at the market price on that date, so the FIFO and realized-
// P&L paths are exercised without putting a trade in at a price the series never had.
equity.push(["5-Jun-2024", "Snnehal", "Fund 0", "Sell", "100",
  (10 * Math.pow(1.0004, DAYS.indexOf("2024-06-05"))).toFixed(4)]);

const mfMap = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]];
const isin = {};
for (let f = 0; f < N_FUNDS; f++) { mfMap.push(["Fund " + f, "Equity", "Flexi Cap", String(100000 + f), "INF" + f]); isin["INF" + f] = String(100000 + f); }

const SHEETS = {
  "wf-equity-data": equity,
  "wf-mfmapping-data": mfMap,
  "wf-stocksetf-data": se,
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["INDIA CO", "Equity", "Stock", "Large Cap", "India", "INDCO", "Financials"],
    ["US CO", "Equity", "Stock", "Large Cap", "US", "USCO", "Technology"]],
  "wf-fd-data": [FD_HDR,
    ["3-Jun-2020", "Snnehal", "HDFC", "Deposit-1", "Fixed Income", "Fixed Deposit", "Deposit", "100000", "4-Jun-2023", "6.25%", ""],
    ["1-Apr-2019", "Snnehal", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "300000", "", "3%", ""],
    ["1-Jul-2021", "Snnehal", "ICICI", "Corpus", "Fixed Income", "Investment Corpus", "Deposit", "150000", "", "3%", ""],
    ["2-Apr-2019", "Snnehal", "", "Gold", "Commodity", "Physical Gold", "Buy", "50000", "", "", "20"]],
  "wf-fixedincome-data": [FI_HDR,
    ["1-Apr-2019", "Snnehal", "EPF", "Fixed Income", "Provident Fund", "Deposit", "12000"]],
};

function navBody() { let n = 10;
  return JSON.stringify({ data: DAYS.map((iso) => { n *= 1.0004; const [y, m, d] = iso.split("-");
    return { date: `${d}-${m}-${y}`, nav: n.toFixed(4) }; }).reverse() }); }
const NAV_BODY = navBody();
function priceMap(base, rate) { const o = {}; let n = base; DAYS.forEach((iso) => { n *= rate; o[iso] = +n.toFixed(2); }); return o; }
const IN_PRICES = priceMap(100, 1.0004), US_PRICES = priceMap(20, 1.0005), IDX = priceMap(1000, 1.00035);
const USD_HIST = {}; DAYS.forEach((iso) => { USD_HIST[iso] = 80; });

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1200 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const r = (pat, body, ct) => p.route(pat, (x) => x.fulfill({ status: 200, contentType: ct || "application/json", headers: { "access-control-allow-origin": "*" }, body }));
  await r("**://*.supabase.co/**", "[]");
  await r("**://cdn.jsdelivr.net/**", "", "text/javascript");
  await r("**://fonts.googleapis.com/**", "", "text/css");
  await r("**://api.mfapi.in/**", NAV_BODY);
  await r("**/amfi_isin_map.json*", JSON.stringify({ fetchedAt: 1, data: isin }));
  await r("**/amfi_nav.json*", JSON.stringify({ fetchedAt: 1, data: {} }));
  await r("**/stock_prices.json*", JSON.stringify({
    prices: { __USD_INR__: { price: 80 },
              INDCO: { price: +(100 * Math.pow(1.0004, DAYS.length - 1)).toFixed(2), currency: "INR" },
              USCO: { price: +(20 * Math.pow(1.0005, DAYS.length - 1)).toFixed(2), currency: "USD" } },
    usd_inr_history: USD_HIST, index_history: { NIFTY50: { prices: IDX } } }));
  await r("**/stock_history.json*", JSON.stringify({ stock_history: {
    INDCO: { currency: "INR", prices: IN_PRICES }, USCO: { currency: "USD", prices: US_PRICES } } }));
  // Gold: ~90 monthly samples gate BOTH value charts, so these must be answered.
  await r("**/currency-api**", JSON.stringify({ xau: { inr: 600000 } }));
  await r("**/*.pages.dev/**", JSON.stringify({ xau: { inr: 600000 } }));

  await p.addInitScript(() => {
    window.__charts = {}; window.__micCfg = null;
    window.Chart = function (ctx, cfg) {
      const canvas = ctx && ctx.canvas ? ctx.canvas : ctx;
      const lim = ((((cfg.options || {}).plugins || {}).zoom || {}).limits || {}).x || {};
      this.data = cfg.data; this.options = cfg.options; this.canvas = canvas;
      const xs = [];
      (cfg.data.datasets || []).forEach((d) => (d.data || []).forEach((q) => { if (q && q.x != null) xs.push(+q.x); }));
      this.scales = { x: { min: xs.length ? Math.min.apply(null, xs) : lim.min,
                           max: xs.length ? Math.max.apply(null, xs) : lim.max }, y: {} };
      this.chartArea = { left: 0, right: 900, top: 0, bottom: 320 };
      this.zoomScale = function (i, rg) { this.scales.x.min = rg.min; this.scales.x.max = rg.max; };
      this.resetZoom = function () {}; this.destroy = function () {}; this.update = function () {};
      this.resize = function () {}; this.getElementsAtEventForMode = function () { return []; };
      if (canvas && canvas.id) window.__charts[canvas.id] = cfg;
      if (canvas && canvas.parentNode && canvas.parentNode.id === "monthly-invest-cat-wrap") {
        window.__micCfg = cfg; window.__micChart = this;
      }
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(16000);

  // ── both value charts rendered, on a portfolio with every asset class ──
  const base = await p.evaluate(() => {
    const g = window.__wfValueChart, a = window.__wfPortfolioValueChart;
    const gd = g ? (g.data.datasets[0].data || []) : [];
    let headNulls = 0; while (headNulls < gd.length && gd[headNulls].y == null) headNulls++;
    return {
      growth: !!g, account: !!a,
      gPeriod: (document.getElementById("avc-period") || {}).textContent,
      aPeriod: (document.getElementById("pvc-period") || {}).textContent,
      gPort: (document.getElementById("avc-portfolio-value") || {}).textContent,
      gIdx: (document.getElementById("avc-index-value") || {}).textContent,
      aVal: (document.getElementById("pvc-current-value") || {}).textContent,
      headNulls,
      gAxisStart: g ? new Date(g.scales.x.min).getFullYear() : null,
      gDataStart: gd.length ? new Date(gd[0].x).getFullYear() : null,
      gTipOff: g ? g.options.plugins.tooltip.enabled === false : null,
      aTipOff: a ? a.options.plugins.tooltip.enabled === false : null,
      ovXirr: (document.getElementById("overview-xirr") || {}).textContent,
      benchPort: (document.getElementById("benchmark-portfolio-xirr") || {}).textContent,
      benchIdx: (document.getElementById("benchmark-index-xirr") || {}).textContent,
    };
  });
  console.log("  base " + JSON.stringify(base));
  ok(base.growth && base.account, "V1 both value charts rendered", base);
  ok(base.headNulls === 0 && base.gAxisStart === base.gDataStart,
     "V2 the Growth chart opens flush against its own data", [base.headNulls, base.gAxisStart, base.gDataStart]);
  ok(/^SINCE \d{4}$/.test(base.gPeriod || "") &&
     String(base.gAxisStart) === (base.gPeriod || "").slice(-4),
     "V3 and its period line names that same year", [base.gPeriod, base.gAxisStart]);
  ok(base.aPeriod === "OVER TIME", "V4 Account Value rests on OVER TIME", base.aPeriod);
  ok(base.gTipOff && base.aTipOff, "V5 neither chart uses a floating tooltip", base);
  ok(/^₹\d/.test(base.gPort) && /^₹\d/.test(base.gIdx) && /^₹\d/.test(base.aVal),
     "V6 every legend figure is populated", [base.gPort, base.gIdx, base.aVal]);
  ok(/%/.test(base.ovXirr || ""), "V7 the overview XIRR resolved", base.ovXirr);
  ok(/%/.test(base.benchPort || "") && /%/.test(base.benchIdx || ""),
     "V7b and both benchmark XIRRs did", [base.benchPort, base.benchIdx]);
  // The Overview's XIRR and the Benchmark card's portfolio XIRR are the same
  // quantity shown in two places; they must never disagree.
  ok(base.ovXirr === base.benchPort,
     "V7c the two places the portfolio XIRR is shown agree", [base.ovXirr, base.benchPort]);

  // NOT asserted, deliberately: that Growth-of-Rs100 and XIRR agree on who beat
  // the index. On this fixture they do not — Growth says the portfolio is ahead
  // (Rs372 vs Rs260) while XIRR says behind (+9% vs +13%) — and that is not a
  // defect in either. They measure different universes: the Growth chart excludes
  // fixed income by design ("Fixed Income Instruments are excluded" is printed
  // under it), while the XIRR cards cover the whole portfolio, idle savings and
  // all. Strip the fixed income out of this fixture and the two agree again
  // (+18.7% vs +13.3%, portfolio ahead on both). Worth knowing before reading the
  // two cards side by side; not worth asserting, since the disagreement is real
  // and expected.

  // hover both charts, then leave
  const hov = await p.evaluate(() => {
    const g = window.__wfValueChart, a = window.__wfPortfolioValueChart;
    g.options.onHover(null, [{ index: 200 }], g);
    a.options.onHover(null, [{ index: 200 }], a);
    const out = { gPeriod: (document.getElementById("avc-period") || {}).textContent,
                  aPeriod: (document.getElementById("pvc-period") || {}).textContent,
                  gPort: (document.getElementById("avc-portfolio-value") || {}).textContent };
    document.getElementById("value-chart").onmouseleave();
    document.getElementById("portfolio-value-chart").onmouseleave();
    out.gAfter = (document.getElementById("avc-period") || {}).textContent;
    out.aAfter = (document.getElementById("pvc-period") || {}).textContent;
    return out;
  });
  ok(/^\d{1,2} [A-Z]{3} \d{4}$/.test(hov.gPeriod) && /^\d{1,2} [A-Z]{3} \d{4}$/.test(hov.aPeriod),
     "V8 hovering names the date on both charts", hov);
  ok(/^SINCE \d{4}$/.test(hov.gAfter) && hov.aAfter === "OVER TIME",
     "V9 and leaving restores both", hov);

  // ── CASH FLOW · MONTHLY: every mode, and the switches between them ──
  async function micState() {
    return p.evaluate(() => {
      const cfg = window.__micCfg || {};
      const legend = document.getElementById("monthly-invest-cat-legend");
      return {
        datasets: (cfg.data.datasets || []).length,
        tipOff: (((cfg.options || {}).plugins || {}).tooltip || {}).enabled === false,
        hasOnHover: typeof (cfg.options || {}).onHover === "function",
        mode: ((cfg.options || {}).interaction || {}).mode,
        split: (document.getElementById("mic-hover-split") || {}).innerHTML || "",
        stats: (document.getElementById("monthly-invest-cat-stats") || {}).textContent || "",
        clickable: legend ? legend.querySelectorAll("[data-mic-cat],[data-mic-idle]").length : 0,
      };
    });
  }
  const seq = [];
  for (const btn of ["monthly-invest-cat-net", "monthly-invest-cat-split", "monthly-invest-cat-idle",
                     "monthly-invest-cat-split", "monthly-invest-cat-idle", "monthly-invest-cat-net"]) {
    await p.evaluate((id) => document.getElementById(id).click(), btn);
    await p.waitForTimeout(1100);
    seq.push(Object.assign({ btn }, await micState()));
  }
  seq.forEach((s, i) => console.log("  mic[" + i + "] " + s.btn.replace("monthly-invest-cat-", "") +
    " ds=" + s.datasets + " tipOff=" + s.tipOff + " clickable=" + s.clickable));

  ok(seq.every((s) => s.datasets > 0), "M1 every mode plots something", seq.map((s) => s.datasets));
  ok(seq.every((s) => s.tipOff === true), "M2 no mode uses a floating tooltip", seq.map((s) => s.tipOff));
  ok(seq.every((s) => s.hasOnHover && s.mode === "index"),
     "M3 every mode reads out on hover, index-wide", seq.map((s) => [s.hasOnHover, s.mode]));
  ok(seq.every((s) => /mic-hs-row/.test(s.split)),
     "M4 and every mode populates the panel under the stats row", seq.map((s) => s.split.slice(0, 30)));
  const idleStates = seq.filter((s) => s.btn.endsWith("idle"));
  ok(idleStates.every((s) => s.clickable > 0),
     "M5 Idle Cash offers a selectable legend, every time it is entered", idleStates.map((s) => s.clickable));
  ok(seq.filter((s) => s.btn.endsWith("split")).every((s) => s.clickable > 0),
     "M6 By instrument still does too", seq.filter((s) => s.btn.endsWith("split")).map((s) => s.clickable));

  // year / all-time controls, in the mode most likely to break on them
  await p.evaluate(() => document.getElementById("monthly-invest-cat-idle").click());
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.getElementById("monthly-invest-cat-alltime").click());
  await p.waitForTimeout(1200);
  const allTime = await micState();
  await p.evaluate(() => document.getElementById("monthly-invest-cat-alltime").click());
  await p.waitForTimeout(1200);
  const backToYear = await micState();
  ok(allTime.datasets > 0 && /mic-hs-row/.test(allTime.split),
     "M7 Idle Cash survives the All time switch", [allTime.datasets, allTime.split.slice(0, 40)]);
  ok(backToYear.datasets > 0, "M8 and the switch back", backToYear.datasets);

  // select a legend entry in Idle Cash, then leave and re-enter
  const selOk = await p.evaluate(() => {
    const e = document.querySelector("[data-mic-idle]");
    if (!e) return null; e.click(); return true;
  });
  await p.waitForTimeout(1100);
  const afterSel = await micState();
  ok(selOk && afterSel.datasets > 0, "M9 selecting an idle instrument keeps a chart on screen", afterSel.datasets);

  ok(errs.length === 0, "Z1 no page errors anywhere in the run", errs.slice(0, 5));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
