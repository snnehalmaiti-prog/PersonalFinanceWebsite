// Portfolio Performance chart: the "Include Fixed Income" toggle.
//
// Off (the default) the curve is equity only, so it can be read against an equity
// index. On, it folds in EPF/PF, FDs and parked cash.
//
// The point of the test is the arithmetic, not the button. Folding in a balance
// means folding in its CONTRIBUTIONS too: add the value alone and every deposit
// reads as instant growth — a lump of savings appearing would multiply the line
// on the day it was entered. The fixture is built so that mistake is impossible
// to miss.
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-growth-include-fi.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"];
const FI_HDR = ["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Amount"];

// One fund: ₹1,00,000 in on 1 Jan (10,000 units at ₹10), NAV doubles on 1 Jul.
// Equity alone therefore doubles: ₹100 → ₹200.
//
// Fixed income: a ₹1,00,000 savings balance deposited on 1 Apr and never touched.
// It earns nothing the sheet records, so with it folded in the account is
//   1 Jan–31 Mar : 1,00,000 equity                       (NAV 100)
//   1 Apr        : +1,00,000 cash — a CONTRIBUTION, not a gain (NAV still 100)
//   1 Jul        : equity doubles to 2,00,000, cash 1,00,000 = 3,00,000
// Units bought at NAV 100: 1,000 at the start, 1,000 more on 1 Apr = 2,000.
// NAV on 1 Jul = 3,00,000 / 2,000 = 150.
// So: equity-only ends at 200, with fixed income folded in it ends at 150 —
// dragged down by cash that earned nothing, which is the honest answer.
// Get the contributions wrong and 1 Apr reads as a doubling: 200 by April and 400
// at the end.
const SHEETS = {
  "wf-equity-data": [TXN, ["1-Jan-2024", "Snnehal", "Fund A", "Buy", "10000", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [FD_HDR,
    ["1-Apr-2024", "Snnehal", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "100000", "", "3%"]],
  "wf-fixedincome-data": [FI_HDR],
};

// A second fixture where the fixed income DOES earn: EPF, ₹1,00,000 deposited
// 1 Jan and ₹20,000 of interest credited on 1 Jul. Interest is return, not a
// contribution, so it must lift the curve; a deposit of the same size must not.
const SHEETS_EPF = Object.assign({}, SHEETS, {
  "wf-fd-data": [FD_HDR],
  "wf-fixedincome-data": [FI_HDR,
    ["1-Jan-2024", "Snnehal", "EPF", "Fixed Income", "Provident Fund", "Deposit", "100000"],
    ["1-Jul-2024", "Snnehal", "EPF", "Fixed Income", "Provident Fund", "Interest", "20000"]],
});

const START = "2024-01-01", END = "2024-12-01";
function days() { const o = []; const d = new Date(START + "T00:00:00"), e = new Date(END + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; }
function navSeries() { return days().map((iso) => { const [y, m, dd] = iso.split("-");
  return { date: `${dd}-${m}-${y}`, nav: String(iso >= "2024-07-01" ? 20 : 10) }; }).reverse(); }
function idxPrices() { const o = {}; days().forEach((iso) => { o[iso] = 1000; }); return o; }

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const near = (a, b, eps) => a != null && Math.abs(a - b) <= (eps == null ? 0.5 : eps);

async function readCurve(p) {
  return p.evaluate(() => {
    const ch = window.__wfValueChart;
    if (!ch) return { err: (document.getElementById("value-chart-status") || {}).textContent || "no chart" };
    const pts = (ch.data.datasets[0].data || []).filter((q) => q && q.y != null);
    const at = (iso) => { const h = pts.filter((q) => new Date(q.x).toISOString().slice(0, 10) <= iso).pop();
                          return h ? +h.y.toFixed(2) : null; };
    return {
      first: pts.length ? +pts[0].y.toFixed(2) : null,
      mar: at("2024-03-31"), apr: at("2024-04-02"), jun: at("2024-06-30"), end: at("2024-12-01"),
      n: pts.length,
      title: (document.getElementById("avc-eyebrow") || {}).textContent,
      note: (document.getElementById("avc-note") || {}).textContent,
      btnOn: document.getElementById("avc-include-fi").classList.contains("active"),
      pressed: document.getElementById("avc-include-fi").getAttribute("aria-pressed"),
    };
  });
}

async function boot(b, sheets) {
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const r = (pat, body, ct) => p.route(pat, (x) => x.fulfill({ status: 200, contentType: ct || "application/json", headers: { "access-control-allow-origin": "*" }, body }));
  await r("**://*.supabase.co/**", "[]");
  await r("**://cdn.jsdelivr.net/**", "", "text/javascript");
  await r("**://fonts.googleapis.com/**", "", "text/css");
  await r("**://api.mfapi.in/**", JSON.stringify({ data: navSeries() }));
  await r("**/amfi_isin_map.json*", JSON.stringify({ fetchedAt: 1, data: { INF1: "100033" } }));
  await r("**/amfi_nav.json*", JSON.stringify({ fetchedAt: 1, data: { "100033": 20 } }));
  await r("**/stock_prices.json*", JSON.stringify({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {},
    index_history: { NIFTY50: { prices: idxPrices() } } }));
  await r("**/stock_history.json*", JSON.stringify({ stock_history: {} }));
  await p.addInitScript(() => {
    window.Chart = function (ctx, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.zoomScale = function () {}; this.resetZoom = function () {};
      this.getElementsAtEventForMode = function () { return []; };
      const c = ctx && ctx.canvas ? ctx.canvas : ctx;
      if (c && c.id === "value-chart") window.__wfValueChartCfg = cfg;
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, sheets);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(9000);
  return { p, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  // ── fixture 1: fixed income that earns nothing ──
  const { p, errs } = await boot(b, SHEETS);

  const off = await readCurve(p);
  console.log("  FI off " + JSON.stringify(off));
  ok(off.title === "Portfolio Performance", "T1 the chart is titled Portfolio Performance", off.title);
  ok(off.btnOn === false && off.pressed === "false",
     "T2 Include Fixed Income starts off", [off.btnOn, off.pressed]);
  ok(/excluded/.test(off.note || ""), "T3 and the note says fixed income is excluded", off.note);
  ok(near(off.first, 100), "A1 the curve starts at 100", off.first);
  ok(near(off.mar, 100), "A2 flat while the NAV is flat", off.mar);
  ok(near(off.end, 200), "A3 a fund that doubles reads 200 with fixed income OFF", off.end);

  await p.evaluate(() => document.getElementById("avc-include-fi").click());
  await p.waitForTimeout(6000);
  const on = await readCurve(p);
  console.log("  FI on  " + JSON.stringify(on));
  ok(on.btnOn === true && on.pressed === "true", "T4 clicking turns it on", [on.btnOn, on.pressed]);
  ok(/included/.test(on.note || ""), "T5 and the note follows", on.note);

  ok(near(on.first, 100), "B1 the curve still starts at 100", on.first);
  ok(near(on.mar, 100), "B2 and is unchanged before the cash arrives", on.mar);
  // THE assertion. A ₹1,00,000 deposit into a ₹1,00,000 account is not a 100% gain.
  ok(near(on.apr, 100),
     "B3 the day ₹1,00,000 of cash is deposited, the curve does NOT move — " +
     "a contribution buys units, it does not move the unit price", on.apr);
  ok(near(on.jun, 100), "B4 and stays put until the fund actually moves", on.jun);
  // 3,00,000 over 2,000 units = 150.
  ok(near(on.end, 150),
     "B5 with dead cash folded in, a doubling fund reads 150, not 200 — " +
     "the cash earned nothing and drags the blend down", on.end);
  ok(on.end < off.end, "B6 so including fixed income lowers this curve", [on.end, off.end]);

  // Off again: back to exactly the equity-only curve.
  await p.evaluate(() => document.getElementById("avc-include-fi").click());
  await p.waitForTimeout(6000);
  const back = await readCurve(p);
  ok(near(back.end, off.end) && back.btnOn === false,
     "B7 turning it off restores the equity-only curve exactly", [back.end, off.end]);

  // It is a way of reading the chart, so it survives a reload.
  await p.evaluate(() => document.getElementById("avc-include-fi").click());
  await p.waitForTimeout(4000);
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(9000);
  const reloaded = await readCurve(p);
  ok(reloaded.btnOn === true && near(reloaded.end, 150),
     "B8 and the choice survives a reload", [reloaded.btnOn, reloaded.end]);

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));
  await p.context().close();

  // ── fixture 2: fixed income that DOES earn ──
  const { p: p2, errs: errs2 } = await boot(b, SHEETS_EPF);
  const epfOff = await readCurve(p2);
  await p2.evaluate(() => document.getElementById("avc-include-fi").click());
  await p2.waitForTimeout(6000);
  const epfOn = await readCurve(p2);
  console.log("  EPF off " + JSON.stringify({ end: epfOff.end }) + "  on " + JSON.stringify({ mar: epfOn.mar, end: epfOn.end }));

  ok(near(epfOff.end, 200), "C1 equity alone still doubles", epfOff.end);
  ok(near(epfOn.mar, 100), "C2 the EPF deposit is a contribution, not a gain", epfOn.mar);
  // 1 Jul: equity 2,00,000 + EPF 1,20,000 = 3,20,000 over 2,000 units = 160.
  ok(near(epfOn.end, 160),
     "C3 EPF interest IS return and lifts the curve — 160, not the 150 that dead " +
     "cash of the same size would give", epfOn.end);
  ok(epfOn.end > 150,
     "C4 which is strictly above the no-interest case, so interest is not being " +
     "swallowed as a contribution", epfOn.end);
  ok(errs2.length === 0, "Z2 no page errors", errs2.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
