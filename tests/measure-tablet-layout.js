// Measures the Overview stats row and the Benchmark Comparison card across
// phone / tablet / desktop widths.
//
// The reported symptom was tablet-only: seven Overview stats and three Benchmark
// columns are laid out as one flex row that is allowed to shrink each item below
// the width of the text inside it. Below 760px a media query rebuilds both as
// grids, and on desktop there is room — so only the band in between squeezes the
// items until the values run into each other and the labels ellipsize.
//
// Two things are measured, both objective:
//   spill    — text wider than the box holding it (scrollWidth > clientWidth).
//              This is what puts "₹58,41,173" on top of "₹72,69,941".
//   overlap  — two rendered TEXT rectangles in the same row intersecting. Measured
//              with Range rectangles, not element boxes, so it is the ink that is
//              checked rather than the padding.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/measure-tablet-layout.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
// Large figures on purpose: the collision is a function of how wide the rendered
// text is, so a fixture with ₹100 values would hide the very thing being measured.
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2019", "Snnehal", "Fund A", "Buy", "500000", "10"],
    ["1-Jun-2024", "Snnehal", "Fund A", "Sell", "100000", "18"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const START = "2019-01-01", END = "2026-07-01";
function days() { const o = []; const d = new Date(START + "T00:00:00"), e = new Date(END + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; }
const DAYS = days();
function navSeries() { let n = 10;
  return DAYS.map((iso) => { n *= 1.0004; const [y, m, d] = iso.split("-");
    return { date: `${d}-${m}-${y}`, nav: n.toFixed(4) }; }).reverse(); }
function idxPrices() { const o = {}; let n = 1000; DAYS.forEach((iso) => { n *= 1.0003; o[iso] = +n.toFixed(2); }); return o; }

// iPad mini / iPad portrait / iPad Pro portrait / iPad landscape / iPad Pro landscape.
const WIDTHS = [
  { w: 480, kind: "phone" },
  { w: 760, kind: "phone-max" },
  { w: 768, kind: "tablet" },
  { w: 810, kind: "tablet" },
  { w: 834, kind: "tablet" },
  { w: 1024, kind: "tablet" },
  { w: 1080, kind: "tablet" },
  { w: 1194, kind: "tablet" },
  { w: 1280, kind: "desktop" },
  { w: 1500, kind: "desktop" },
];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

const PROBE = () => {
  // The ink of an element's text, not its border box.
  function textRect(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    return (b.width || b.height) ? b : el.getBoundingClientRect();
  }
  function spills(el) {
    // 1px of tolerance: sub-pixel layout rounds either way.
    return el.scrollWidth - el.clientWidth > 1;
  }
  function overlaps(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].rect, b = list[j].rect;
        // Same visual line only — a two-row grid legitimately stacks boxes.
        const sameLine = Math.abs(a.top - b.top) < 6;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (sameLine && ox > 1) out.push([list[i].text, list[j].text, +ox.toFixed(1)]);
      }
    }
    return out;
  }
  function collect(sel) {
    return [...document.querySelectorAll(sel)]
      .filter((e) => e.offsetParent !== null && (e.textContent || "").trim() && (e.textContent || "").trim() !== "—")
      .map((e) => ({ el: e, text: (e.textContent || "").trim().slice(0, 18), rect: textRect(e) }));
  }

  const statVals = collect(".overview-stat-inline .overview-stat-value");
  const statLabels = collect(".overview-stat-inline .overview-stat-label");
  const benchVals = collect("#benchmark-result .benchmark-col-value");
  const benchLabels = collect("#benchmark-result .benchmark-col-label");
  const statBoxes = [...document.querySelectorAll(".overview-stat-inline")].filter((e) => e.offsetParent !== null);
  const benchBoxes = [...document.querySelectorAll("#benchmark-result .benchmark-col")].filter((e) => e.offsetParent !== null);

  const row = document.querySelector(".overview-stats-inline");
  return {
    statSpill: statBoxes.filter(spills).length,
    benchSpill: benchBoxes.filter(spills).length,
    // A label rendered with an ellipsis is a truncated label, whatever the box says.
    labelClipped: benchLabels.filter((o) => spills(o.el)).map((o) => o.text),
    statOverlap: overlaps(statVals).concat(overlaps(statLabels)),
    benchOverlap: overlaps(benchVals).concat(overlaps(benchLabels)),
    rowScrolls: row ? row.scrollWidth - row.clientWidth > 1 : null,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth > 1,
    statCount: statBoxes.length,
  };
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const r = (pat, body, ct) => p.route(pat, (x) => x.fulfill({ status: 200, contentType: ct || "application/json", headers: { "access-control-allow-origin": "*" }, body }));
  await r("**://*.supabase.co/**", "[]");
  await r("**://cdn.jsdelivr.net/**", "", "text/javascript");
  await r("**://fonts.googleapis.com/**", "", "text/css");
  await r("**://api.mfapi.in/**", JSON.stringify({ data: navSeries() }));
  await r("**/amfi_isin_map.json*", JSON.stringify({ fetchedAt: 1, data: { INF1: "100033" } }));
  await r("**/amfi_nav.json*", JSON.stringify({ fetchedAt: 1, data: {} }));
  await r("**/stock_prices.json*", JSON.stringify({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {},
    index_history: { NIFTY50: { prices: idxPrices() } } }));
  await r("**/stock_history.json*", JSON.stringify({ stock_history: {} }));
  await p.addInitScript(() => {
    window.Chart = function (ctx, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.zoomScale = function () {}; this.resetZoom = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(10000);

  const rows = [];
  for (const { w, kind } of WIDTHS) {
    await p.setViewportSize({ width: w, height: 1000 });
    await p.waitForTimeout(500);
    const m = await p.evaluate(PROBE);
    rows.push({ w, kind, m });
    console.log("  " + String(w).padStart(4) + "px " + kind.padEnd(10) +
      " stats[spill " + m.statSpill + "/" + m.statCount + " overlap " + m.statOverlap.length + "]" +
      " bench[spill " + m.benchSpill + " overlap " + m.benchOverlap.length +
      " clipped " + m.labelClipped.length + "]");
    if (m.statOverlap.length) console.log("        stat overlap e.g. " + JSON.stringify(m.statOverlap[0]));
    if (m.benchOverlap.length) console.log("        bench overlap e.g. " + JSON.stringify(m.benchOverlap[0]));
    if (m.labelClipped.length) console.log("        clipped labels " + JSON.stringify(m.labelClipped));
  }

  console.log("");
  rows.forEach(({ w, kind, m }) => {
    const clean = m.statSpill === 0 && m.benchSpill === 0 &&
                  m.statOverlap.length === 0 && m.benchOverlap.length === 0 &&
                  m.labelClipped.length === 0 && !m.pageOverflow;
    ok(clean, "at " + w + "px (" + kind + ") nothing spills, overlaps or is clipped",
       { statSpill: m.statSpill, benchSpill: m.benchSpill,
         statOverlap: m.statOverlap.slice(0, 2), benchOverlap: m.benchOverlap.slice(0, 2),
         clipped: m.labelClipped, pageOverflow: m.pageOverflow });
  });
  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
