// GROWTH OF Rs100 — end-to-end, in a real browser, against hand-computable data.
//
// The chart's inputs (NAV history, stock history, FX, AMFI scheme resolution) are
// all stubbed, so every expected figure below is worked out by hand rather than
// by re-running the shipped formula.
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     node tools/serve.js &        # or any static server on :8098
//     node tests/e2e-growth.js
//
// It exists because three separate defects in this chart were invisible to unit
// tests: a period return that let contributions dilute the line, contributions
// taken from instruments the value series cannot price, and US flows counted in
// dollars against rupee values.
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const MAP = [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
  ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]];
const EMPTY = {
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};
const START = "2024-01-01", END = "2024-12-01";
function days() {
  const out = []; const d = new Date(START + "T00:00:00"); const e = new Date(END + "T00:00:00");
  while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}
// navAt: iso -> nav
function navSeries(navAt) {
  return days().map((iso) => { const [y, m, dd] = iso.split("-"); return { date: `${dd}-${m}-${y}`, nav: String(navAt(iso)) }; }).reverse();
}
function idxSeries(f) { const o = {}; days().forEach((iso) => { o[iso] = f(iso); }); return o; }

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const near = (a, b, eps) => a != null && Math.abs(a - b) <= (eps == null ? 0.05 : eps);

const SCENARIOS = [
  { name: "S1 buy once, fund doubles",
    txns: [["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"]],
    nav: (iso) => (iso >= "2024-06-01" ? 20 : 10),
    probe: ["2024-05-31", "2024-06-01", "2024-12-01"] },
  { name: "S2 buy again on the day it doubles",
    txns: [["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"],
           ["1-Jun-2024", "Snnehal", "Fund A", "Buy", "100", "20"]],
    nav: (iso) => (iso >= "2024-06-01" ? 20 : 10),
    probe: ["2024-05-31", "2024-06-01", "2024-12-01"] },
  { name: "S3 buy on a flat day, then it doubles",
    txns: [["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"],
           ["1-Mar-2024", "Snnehal", "Fund A", "Buy", "500", "10"]],
    nav: (iso) => (iso >= "2024-06-01" ? 20 : 10),
    probe: ["2024-03-01", "2024-05-31", "2024-12-01"] },
  { name: "S4 sell half after doubling",
    txns: [["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"],
           ["1-Jul-2024", "Snnehal", "Fund A", "Sell", "50", "20"]],
    nav: (iso) => (iso >= "2024-06-01" ? 20 : 10),
    probe: ["2024-06-30", "2024-07-01", "2024-12-01"] },
  { name: "S5 fund halves",
    txns: [["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "20"]],
    nav: (iso) => (iso >= "2024-06-01" ? 10 : 20),
    probe: ["2024-05-31", "2024-06-01", "2024-12-01"] },
  { name: "S6 monthly SIP into a steadily rising fund",
    txns: (() => {
      const t = [];
      for (let m = 1; m <= 11; m++) {
        const mm = String(m).padStart(2, "0");
        // NAV on the 1st of month m is 10+m-1; buy Rs1000 worth.
        const nav = 10 + m - 1;
        t.push([`1-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov"][m-1]}-2024`,
                "Snnehal", "Fund A", "Buy", String(1000 / nav), String(nav)]);
      }
      return t;
    })(),
    nav: (iso) => 10 + (parseInt(iso.slice(5, 7), 10) - 1),
    probe: ["2024-12-01"] },
  { name: "S7 a fund the chart cannot price",
    // Fund B's ISIN resolves to nothing, so it is absent from the value series.
    // Its purchase must therefore not be counted as a contribution either.
    txns: [["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"],
           ["1-Feb-2024", "Snnehal", "Fund B", "Buy", "30", "10"],
           ["1-Jun-2024", "Snnehal", "Fund A", "Buy", "100", "20"]],
    map: [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
          ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"],
          ["Fund B", "Equity", "Flexi Cap", "999999", "INF-NOPE"]],
    nav: (iso) => (iso >= "2024-06-01" ? 20 : 10),
    probe: ["2024-05-31", "2024-12-01"] },
  { name: "S8 a US holding bought in dollars",
    // QQQ is flat at $100 all year, so it adds no growth of its own. It does
    // dominate the portfolio by value (10 x $100 x 84 = Rs84,000 against Rs1,000
    // of Fund A), so doubling Fund A moves the whole line only slightly.
    txns: [["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"],
           ["1-Jun-2024", "Snnehal", "Fund A", "Buy", "100", "20"]],
    se: [["1-Mar-2024", "Snnehal", "QQQ", "Buy", "10", "100"]],
    seMap: [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
            ["QQQ", "Equity", "ETF", "Large Cap", "US", "QQQ", "Tech"]],
    stockHistory: { QQQ: { currency: "USD", flat: 100 } },
    nav: (iso) => (iso >= "2024-06-01" ? 20 : 10),
    probe: ["2024-03-01", "2024-05-31", "2024-12-01"] },
];

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  for (const sc of SCENARIOS) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
    await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await p.route("**://api.mfapi.in/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: navSeries(sc.nav) }) }));
    await p.route("**/amfi_isin_map.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: { INF1: "100033" } }) }));
    await p.route("**/amfi_nav.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: { "100033": sc.nav(END) } }) }));
    await p.route("**/stock_prices.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ usd_inr_history: {}, prices: Object.assign({ __USD_INR__: { price: 84 } },
          Object.keys(sc.stockHistory || {}).reduce((a, t) => (a[t] = { price: sc.stockHistory[t].flat, currency: sc.stockHistory[t].currency }, a), {})),
        index_history: { NIFTY50: { prices: idxSeries(() => 1000) } } }) }));
    const sh = {};
    Object.keys(sc.stockHistory || {}).forEach((t) => {
      const cfg = sc.stockHistory[t]; const ps = {};
      days().forEach((iso) => { ps[iso] = cfg.flat; });
      sh[t] = { currency: cfg.currency, prices: ps };
    });
    await p.route("**/stock_history.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stock_history: sh }) }));
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
    const sheets = Object.assign({}, EMPTY, {
      "wf-equity-data": [TXN].concat(sc.txns),
      "wf-mfmapping-data": sc.map || MAP,
      "wf-stocksetf-data": [TXN].concat(sc.se || []),
    });
    if (sc.seMap) sheets["wf-stocksetfmapping-data"] = sc.seMap;
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
    }, sheets);
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(8000);
    const res = await p.evaluate((probe) => {
      const cfg = window.__charts["value-chart"];
      if (!cfg) return { err: (document.getElementById("value-chart-status") || {}).textContent || "no chart" };
      const port = (cfg.data.datasets[0].data || []).filter((q) => q && q.y != null);
      const at = (iso) => { const h = port.filter((q) => new Date(q.x).toISOString().slice(0, 10) <= iso).pop(); return h ? +h.y.toFixed(2) : null; };
      const o = {}; probe.forEach((d) => { o[d] = at(d); });
      const first = port[0], last = port[port.length - 1];
      return { vals: o, n: port.length,
               firstDate: new Date(first.x).toISOString().slice(0, 10),
               finalNav: +last.y.toFixed(3), first: port[0] ? +port[0].y.toFixed(2) : null,
               nonFinite: port.filter((q) => !isFinite(q.y)).length,
               tail: (document.getElementById("avc-portfolio-value") || {}).textContent };
    }, sc.probe);
    // Independent cross-check: the CAGR card runs a SECOND, separately written TWR
    // over the same portfolio — different sampling, different code path. Compounding
    // its rate over its own window (inception → today) must land on the chart's
    // final NAV. Two implementations agreeing is worth more than either matching
    // its own expectation.
    if (!res.err) {
      const cg = await p.evaluate(async () => {
        const b = document.getElementById("bench-mode-cagr");
        if (b) b.click();
        await new Promise((r) => setTimeout(r, 4000));
        return (document.getElementById("benchmark-portfolio-xirr") || {}).textContent || "";
      });
      const rate = parseFloat(String(cg).replace(/[^0-9.\-]/g, "")) / 100;
      const yrs = (Date.now() - new Date(res.firstDate + "T00:00:00").getTime()) / 86400000 / 365.25;
      res.cagrImplied = isFinite(rate) ? +(100 * Math.pow(1 + rate, yrs)).toFixed(2) : null;
      res.cagrText = cg;
    }
    console.log("\n" + sc.name + "  " + JSON.stringify(res));
    if (!res.err) {
      ok(res.first === 100, sc.name + " starts at 100", res.first);
      ok(res.nonFinite === 0, sc.name + " has no non-finite point", res.nonFinite);
      // 1% tolerance: the CAGR rate is read from a 2-decimal percentage, and the
      // two paths sample the portfolio at different frequencies.
      ok(res.cagrImplied != null && Math.abs(res.cagrImplied - res.finalNav) <= Math.max(1, res.finalNav * 0.01),
         sc.name + " agrees with the CAGR card's independent TWR",
         [res.finalNav, res.cagrImplied, res.cagrText]);
    } else { ok(false, sc.name + " rendered", res.err); }
    global["R_" + sc.name.split(" ")[0]] = res;
    await ctx.close();
  }
  await b.close();

  console.log("\n=== Expected vs actual ===");
  const R = (k) => global["R_" + k] || {};
  // S1: NAV doubles, no further flows -> 200.
  ok(near(R("S1").vals["2024-05-31"], 100), "S1a flat while the NAV is flat", R("S1").vals);
  ok(near(R("S1").vals["2024-12-01"], 200), "S1b a fund that doubles reads 200", R("S1").vals);
  // S2: same, but bought into on the day it doubled. TWR must be identical to S1.
  ok(near(R("S2").vals["2024-12-01"], 200), "S2a buying on the jump day does not dilute the return", R("S2").vals);
  ok(near(R("S2").vals["2024-12-01"], R("S1").vals["2024-12-01"]),
     "S2b contributions do not change TWR at all", [R("S1").vals, R("S2").vals]);
  // S3: a 6x contribution on a flat day must not move the NAV either.
  ok(near(R("S3").vals["2024-03-01"], 100), "S3a a contribution on a flat day leaves NAV at 100", R("S3").vals);
  ok(near(R("S3").vals["2024-12-01"], 200), "S3b and the later doubling still reads 200", R("S3").vals);
  // S4: selling half after the gain keeps the gain in the series.
  ok(near(R("S4").vals["2024-06-30"], 200), "S4a doubled before the sale", R("S4").vals);
  ok(near(R("S4").vals["2024-12-01"], 200), "S4b selling half does not erase the return", R("S4").vals);
  // S5: halving reads 50.
  ok(near(R("S5").vals["2024-12-01"], 50), "S5 a fund that halves reads 50", R("S5").vals);
  // S6: SIP into a fund whose NAV runs 10 -> 21 (x2.1). TWR is unit-price growth,
  // independent of the SIP schedule.
  ok(near(R("S6").vals["2024-12-01"], 210, 0.5), "S6 an SIP tracks unit-price growth, not money-weighted", R("S6").vals);

  // S7: the unpriceable fund must leave no trace. Counting its Rs300 purchase
  // against a Rs1,000 portfolio knocked 30% off the line, permanently: Rs140.
  ok(near(R("S7").vals["2024-05-31"], 100),
     "S7a a fund the chart cannot price does not dent the line", R("S7").vals);
  ok(near(R("S7").vals["2024-12-01"], 200),
     "S7b and the priced fund's doubling still reads 200", R("S7").vals);
  // S8: value 85,000 -> 86,000 on Fund A's doubling (QQQ is 84,000 of it and flat).
  ok(near(R("S8").vals["2024-03-01"], 100),
     "S8a a $1,000 purchase is not growth", R("S8").vals);
  ok(near(R("S8").vals["2024-12-01"], 100 * 86000 / 85000, 0.05),
     "S8b the US leg is weighted in rupees, not dollars", R("S8").vals);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
