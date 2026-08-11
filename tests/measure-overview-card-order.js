// Where the Overview's cards actually land on screen, at desktop and phone.
//
// Portfolio Split / Category Split / Realized Profit all break down the same
// current total the two charts above them end at, so they belong directly under
// those charts. They used to sit further down, sharing #monthly-invest-row with
// the income/expense charts, and the phone layout papered over that with an
// `order: -1` on Portfolio Split — which reordered exactly one of the three and
// left the other two below the cash-flow card.
//
// Order is read from rendered geometry, not from the DOM. That is the only way
// this catches what it exists to catch: a stray `order` or `flex-direction`
// rule can put the cards anywhere while the markup still reads top to bottom.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/measure-overview-card-order.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2019", "Snnehal", "Fund A", "Buy", "5000", "10"],
    ["1-Jun-2024", "Snnehal", "Fund A", "Sell", "1000", "18"]],
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

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

// Every Overview block that stacks down the page, in the order it should appear.
// #monthly-invest-row and #overview-cashflow-row are rows rather than cards, so
// they are probed as rows — what matters is where the band of them sits.
const IDS = [
  "ov-charts-card",
  "investment-split-card",
  "instrument-split-card",
  "profit-cat-card",
  "net-worth-monthly-card",
  "monthly-invest-row",
  "overview-cashflow-row",
];

const PROBE = (ids) => {
  const out = {};
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.offsetParent === null) { out[id] = null; return; }   // not rendered here
    const r = el.getBoundingClientRect();
    out[id] = { top: Math.round(r.top + window.scrollY), bottom: Math.round(r.bottom + window.scrollY),
                left: Math.round(r.left), right: Math.round(r.right) };
  });
  out.__pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth > 1;
  return out;
};

// Visual reading order: down the page, then across. 8px of slack absorbs the
// sub-pixel differences between cards that are genuinely on the same row.
const readingOrder = (m) => Object.keys(m).filter((k) => !k.startsWith("__") && m[k])
  .sort((a, b) => (Math.abs(m[a].top - m[b].top) < 8 ? m[a].left - m[b].left : m[a].top - m[b].top));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const r = (pat, body, ct) => p.route(pat, (x) => x.fulfill({ status: 200, contentType: ct || "application/json", headers: { "access-control-allow-origin": "*" }, body }));
  await r("**://*.supabase.co/**", "[]");
  await r("**://cdn.jsdelivr.net/**", "", "text/javascript");
  await r("**://fonts.googleapis.com/**", "", "text/css");
  await r("**://api.mfapi.in/**", JSON.stringify({ data: navSeries() }));
  await r("**/amfi_isin_map.json*", JSON.stringify({ fetchedAt: 1, data: { INF1: "100033" } }));
  await r("**/amfi_nav.json*", JSON.stringify({ fetchedAt: 1, data: {} }));
  await r("**/stock_prices.json*", JSON.stringify({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} }));
  await r("**/stock_history.json*", JSON.stringify({ stock_history: {} }));
  // Charts are stubbed: this suite measures card boxes, and a real Chart.js
  // canvas only adds animation frames to wait on.
  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
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
  await p.waitForTimeout(8000);

  console.log("Desktop (1500px)");
  const d = await p.evaluate(PROBE, IDS);
  console.log("  " + readingOrder(d).join(" → "));

  ok(d["ov-charts-card"] && d["investment-split-card"] &&
     d["investment-split-card"].top >= d["ov-charts-card"].bottom - 1,
     "D1 the splits start below Portfolio Performance and ACCOUNT VALUE",
     { charts: d["ov-charts-card"], split: d["investment-split-card"] });
  ok(d["net-worth-monthly-card"] && d["profit-cat-card"] &&
     d["net-worth-monthly-card"].top >= d["profit-cat-card"].bottom - 1,
     "D2 and end above NET WORTH · MONTHLY, which they used to sit below",
     { profit: d["profit-cat-card"], nwm: d["net-worth-monthly-card"] });
  const trio = ["investment-split-card", "instrument-split-card", "profit-cat-card"];
  ok(trio.every((id) => d[id]) &&
     Math.abs(d[trio[0]].top - d[trio[1]].top) < 8 && Math.abs(d[trio[1]].top - d[trio[2]].top) < 8,
     "D3 all three share one row", trio.map((id) => d[id] && d[id].top));
  ok(trio.every((id) => d[id]) &&
     d[trio[0]].left < d[trio[1]].left && d[trio[1]].left < d[trio[2]].left,
     "D4 left to right in document order", trio.map((id) => d[id] && d[id].left));
  // The row stretches its cards, so the last one's right edge meets the chart
  // above it. A max-width creeping back in would show up here as a short row.
  ok(d["profit-cat-card"] && d["ov-charts-card"] &&
     Math.abs(d["profit-cat-card"].right - d["ov-charts-card"].right) <= 2,
     "D5 and the row's right edge lines up with the charts above",
     { profitRight: d["profit-cat-card"] && d["profit-cat-card"].right,
       chartsRight: d["ov-charts-card"] && d["ov-charts-card"].right });
  ok(JSON.stringify(readingOrder(d)) === JSON.stringify(IDS),
     "D6 the whole Overview reads top to bottom in the intended order", readingOrder(d));
  ok(!d.__pageOverflow, "D7 nothing pushes the page sideways");

  console.log("\nPhone (700px)");
  await p.setViewportSize({ width: 700, height: 1000 });
  await p.waitForTimeout(600);
  const m = await p.evaluate(PROBE, IDS);
  console.log("  " + readingOrder(m).join(" → "));

  // Realized Profit and the cash-flow row are display:none below 760px; the two
  // that remain still have to stack under the charts and above NET WORTH.
  ok(m["profit-cat-card"] === null && m["overview-cashflow-row"] === null,
     "P1 Realized Profit and the cash-flow row stay off the phone layout",
     { profit: m["profit-cat-card"], cashflow: m["overview-cashflow-row"] });
  ok(m["investment-split-card"] && m["instrument-split-card"] &&
     m["investment-split-card"].top >= m["ov-charts-card"].bottom - 1 &&
     m["instrument-split-card"].top >= m["investment-split-card"].bottom - 1,
     "P2 the splits stack under the charts, in document order",
     { charts: m["ov-charts-card"], a: m["investment-split-card"], b: m["instrument-split-card"] });
  ok(m["net-worth-monthly-card"] &&
     m["net-worth-monthly-card"].top >= m["instrument-split-card"].bottom - 1,
     "P3 with NET WORTH · MONTHLY below both — no `order` pulling one card out " +
     "of the group and stranding the rest",
     { split: m["instrument-split-card"], nwm: m["net-worth-monthly-card"] });
  ok(JSON.stringify(readingOrder(m)) === JSON.stringify(IDS.filter((id) => m[id])),
     "P4 and the visible cards read top to bottom in the same order", readingOrder(m));
  ok(!m.__pageOverflow, "P5 nothing pushes the page sideways");

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
