// The top bar stays put — on every tab, and while the page scrolls.
//
// .site-header has said `position: sticky; top: 0` for a long time and did not
// stick. `overflow-x: hidden` was set on BOTH <html> and <body>; on <body> that
// computes overflow-y to `auto`, which makes <body> a scroll container, and a
// sticky element then sticks to its nearest scrolling ancestor — <body> — while
// the page actually scrolls on <html>. The header rode <body> straight off the
// top of the screen. The rule now lives on <html> alone, which clips the
// horizontal axis just as well without owning the header's stickiness.
//
// Two traps this suite is built to avoid:
//
//   1. A page shorter than the viewport cannot scroll, so the header trivially
//      stays at top: 0 and the test passes while proving nothing. That is what
//      the first run of this check did on two of the three tabs. Every case here
//      asserts the page ACTUALLY scrolled before it believes the header.
//   2. top === 0 only says where the box is, not whether it is visible. An
//      element painted underneath the content is still at top: 0. So the header
//      is also hit-tested: what is under that point has to BE the header.
//
// The viewport is deliberately short — the fixture is small, and a tall window
// leaves the quieter tabs with nothing to scroll.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-sticky-header.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2019", "Snnehal", "Fund A", "Buy", "5000", "10"],
    ["1-Jan-2019", "Trisha", "Fund A", "Buy", "1000", "10"]],
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

const TABS = [
  { id: "tab-overview", name: "Overview" },
  { id: "tab-investment", name: "Investments" },
  { id: "tab-expense", name: "Expense" },
];

const PROBE = () => {
  const h = document.querySelector(".site-header");
  if (!h) return null;
  const r = h.getBoundingClientRect();
  // Hit-test the middle of the header. If content is painting over it, this
  // comes back as something that is not the header or one of its children.
  const hit = document.elementFromPoint(Math.round(r.left + r.width / 2),
                                        Math.round(r.top + r.height / 2));
  return {
    top: Math.round(r.top), height: Math.round(r.height),
    position: getComputedStyle(h).position,
    scrollY: Math.round(window.scrollY),
    maxScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    covered: !(hit && (hit === h || h.contains(hit))),
    hit: hit ? (hit.id || hit.className || hit.tagName) : "(nothing)",
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth > 1,
  };
};

(async () => {
  const b = await chromium.launch();
  // Short on purpose — see the header comment.
  const ctx = await b.newContext({ viewport: { width: 1400, height: 420 } });
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
  await p.waitForTimeout(9000);

  const first = await p.evaluate(PROBE);
  ok(first && first.position === "sticky",
     "H1 the header is sticky at all", first && first.position);
  ok(first && first.bodyOverflowY !== "auto" && first.bodyOverflowY !== "scroll",
     "H2 <body> is not a scroll container — that is what stole the stickiness, " +
     "and it is invisible from the rendered position alone",
     first && first.bodyOverflowY);

  for (const t of TABS) {
    await p.evaluate((id) => { const el = document.getElementById(id); if (el) el.click(); }, t.id);
    await p.waitForTimeout(2500);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);
    const atTop = await p.evaluate(PROBE);
    await p.evaluate(() => window.scrollTo(0, 100000));   // all the way down
    await p.waitForTimeout(700);
    const down = await p.evaluate(PROBE);
    console.log("  " + t.name.padEnd(12) + " scrollY " + down.scrollY + "/" + down.maxScroll +
      "  headerTop " + down.top + "  hit " + down.hit);

    // The guard that makes the rest mean something.
    ok(down.scrollY > 50,
       t.name + ": S — the page actually scrolled, so the check below is not " +
       "reading a page that never moved", { scrollY: down.scrollY, maxScroll: down.maxScroll });
    ok(atTop.top === 0 && down.top === 0,
       t.name + ": T — the header is still at the top of the viewport after scrolling",
       { before: atTop.top, after: down.top });
    ok(!down.covered,
       t.name + ": V — and still on top of the content, not painted under it",
       { hit: down.hit });
    ok(!down.pageOverflowX,
       t.name + ": X — with no horizontal overflow, which is what the rule that " +
       "broke this was there to prevent", down.pageOverflowX);
  }

  // Switching tabs must not scroll the header out of view either.
  await p.evaluate(() => window.scrollTo(0, 100000));
  await p.waitForTimeout(400);
  await p.evaluate(() => { const el = document.getElementById("tab-overview"); if (el) el.click(); });
  await p.waitForTimeout(2000);
  const afterSwitch = await p.evaluate(PROBE);
  ok(afterSwitch.top === 0 && !afterSwitch.covered,
     "H3 and it is still there immediately after switching tabs while scrolled down",
     afterSwitch);

  // The narrow layout has its own header rules; the same must hold there.
  await p.setViewportSize({ width: 420, height: 420 });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.scrollTo(0, 100000));
  await p.waitForTimeout(600);
  const mobile = await p.evaluate(PROBE);
  console.log("  mobile       scrollY " + mobile.scrollY + "/" + mobile.maxScroll +
    "  headerTop " + mobile.top + "  hit " + mobile.hit);
  ok(mobile.scrollY > 50, "M1 the narrow layout scrolls", mobile);
  ok(mobile.top === 0, "M2 and the header stays at the top there too", mobile.top);
  ok(!mobile.covered, "M3 on top of the content", mobile.hit);
  ok(!mobile.pageOverflowX, "M4 and still no horizontal overflow", mobile.pageOverflowX);

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
