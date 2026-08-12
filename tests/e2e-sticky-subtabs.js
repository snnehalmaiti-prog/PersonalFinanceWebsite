// The sub-tab bars stay under the header while their tab scrolls.
//
// Which section you are in is worth as much at the bottom of a long holdings
// list as at the top, so Investments' Mutual Fund / Stocks-ETF / Fixed Income
// bar and Expense's Accounts / Records / Analytics bar pin below the header
// instead of scrolling away with the content.
//
// What made this more than one line of CSS: the panels live inside
// <main class="container settings-main">, which had `overflow-x: hidden`. That
// computes overflow-y to auto and makes main a scroll container, which steals
// position:sticky from everything inside it — the same trap that kept the site
// header from sticking, one level down. It is `overflow-x: clip` now: clip
// still stops a wide child widening the page but establishes no scrollport.
// C1 asserts that directly, because nothing about the rendered position tells
// you the difference until it breaks.
//
// The traps this suite is built to avoid, both learned the hard way on the
// header suite:
//   • a page shorter than the viewport cannot scroll, so a bar trivially stays
//     put and the test proves nothing — every case checks the page moved first;
//   • a top offset says where the box is, not whether it can be seen, so each
//     bar is hit-tested and its background checked for opacity. A transparent
//     sticky bar has rows sliding through the letters.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-sticky-subtabs.js
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
const eq = (a, b, name, detail) => ok(a === b, name, detail !== undefined ? detail : { got: a, want: b });

const BOX = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  // Probe near the left, where the pills are, rather than dead centre — the
  // Expense bar's middle column is empty on some sub-tabs.
  const hit = document.elementFromPoint(Math.round(r.left + Math.min(r.width / 2, 60)),
                                        Math.round(r.top + r.height / 2));
  return {
    top: Math.round(r.top), height: Math.round(r.height),
    position: cs.position, z: cs.zIndex, bg: cs.backgroundColor,
    covered: !(hit && (hit === el || el.contains(hit))),
    hit: hit ? (hit.id || String(hit.className).slice(0, 28) || hit.tagName) : "(nothing)",
  };
};
const SIZE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return { h: Math.round(r.height), fs: cs.fontSize, pad: cs.padding };
};
const PAGE = () => ({
  scrollY: Math.round(window.scrollY),
  headerH: Math.round(document.querySelector(".site-header").getBoundingClientRect().height),
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth > 1,
  mainOverflowY: getComputedStyle(document.querySelector("main.container")).overflowY,
  mainOverflowX: getComputedStyle(document.querySelector("main.container")).overflowX,
});

// A sticky bar has to be painted, not see-through.
const opaque = (bg) => {
  const m = /rgba?\(([^)]+)\)/.exec(bg || "");
  if (!m) return false;
  const parts = m[1].split(",").map((s) => parseFloat(s));
  return parts.length < 4 || parts[3] >= 0.99;
};

(async () => {
  const b = await chromium.launch();
  // Short viewport so the quieter tabs have something to scroll.
  const ctx = await b.newContext({ viewport: { width: 1400, height: 500 } });
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

  const page0 = await p.evaluate(PAGE);
  console.log("  header " + page0.headerH + "px, main overflow " +
    page0.mainOverflowX + "/" + page0.mainOverflowY);
  ok(page0.mainOverflowY !== "auto" && page0.mainOverflowY !== "scroll",
     "C1 <main> is not a scroll container — overflow-x:hidden there would take " +
     "the stickiness of everything inside it, and nothing on screen would say why",
     { x: page0.mainOverflowX, y: page0.mainOverflowY });
  ok(page0.mainOverflowX === "clip" || page0.mainOverflowX === "visible",
     "C2 while still clipping a too-wide child rather than letting it widen the page",
     page0.mainOverflowX);

  const CASES = [
    { tab: "tab-investment", bar: ".invest-sub-tabs", pill: ".invest-sub-tab", name: "Investments" },
    { tab: "tab-expense", bar: ".exp-top-bar", pill: ".exp-subtab", name: "Expense" },
  ];

  for (const c of CASES) {
    await p.evaluate((id) => { const e = document.getElementById(id); if (e) e.click(); }, c.tab);
    await p.waitForTimeout(2500);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(400);
    const atTop = await p.evaluate(BOX, c.bar);
    await p.evaluate(() => window.scrollTo(0, 100000));
    await p.waitForTimeout(700);
    const down = await p.evaluate(BOX, c.bar);
    const pg = await p.evaluate(PAGE);
    console.log("  " + c.name.padEnd(12) + " scrollY " + pg.scrollY +
      "  top " + atTop.top + " → " + down.top + " (header " + pg.headerH + ")" +
      "  hit " + down.hit);

    ok(pg.scrollY > 50,
       c.name + ": S — the page actually scrolled, so what follows is not " +
       "reading a page that never moved", { scrollY: pg.scrollY });
    eq(down.position, "sticky", c.name + ": P — the bar is sticky");
    eq(down.top, pg.headerH,
       c.name + ": T — and parks exactly at the header's lower edge, leaving " +
       "neither a gap nor an overlap", { top: down.top, headerH: pg.headerH });
    ok(!down.covered,
       c.name + ": V — painted above the content, not under it", { hit: down.hit });
    ok(opaque(down.bg),
       c.name + ": O — with an opaque background, or rows slide through the " +
       "letters", down.bg);
    ok(Number(down.z) > 0 && Number(down.z) < 50,
       c.name + ": Z — above the content and below the header, which owns 50",
       down.z);
    ok(!pg.overflowX, c.name + ": X — no horizontal overflow", pg.overflowX);
  }

  // ── Sizes ────────────────────────────────────────────────────────────────
  await p.evaluate(() => { const e = document.getElementById("tab-expense"); if (e) e.click(); });
  await p.waitForTimeout(2000);
  const sub = await p.evaluate(SIZE, ".exp-subtab");
  const add = await p.evaluate(SIZE, "#rec-open-btn");
  await p.evaluate(() => { const e = document.getElementById("tab-investment"); if (e) e.click(); });
  await p.waitForTimeout(2000);
  const inv = await p.evaluate(SIZE, ".invest-sub-tab");
  console.log("  sizes  subtab " + JSON.stringify(sub) + "  add " + JSON.stringify(add) +
    "  invest " + JSON.stringify(inv));

  eq(sub.h, 28, "B1 the Expense sub-tab pills are the reduced height", sub);
  eq(inv.h, 28, "B2 and the Investments ones match them", inv);
  eq(add.h, sub.h,
     "B3 Add record is the same height as the pills it shares a row with — it " +
     "sat taller and broke the line", { add: add.h, subtab: sub.h });

  // ── The gap under the bar ────────────────────────────────────────────────
  // Measured, per sub-tab, because it used to be set in four different places:
  // the Investments bar left 10px of its own, while each Expense sub-panel
  // opened its own with an inline margin-top — three chose 20px and the fourth
  // chose none. The distance from the tabs to the content depended on which tab
  // you were standing on. The bar owns it now, so every sub-tab reads the same.
  const gapUnder = (barSel) => p.evaluate((sel) => {
    const bar = document.querySelector(sel);
    if (!bar) return null;
    const bottom = bar.getBoundingClientRect().bottom + window.scrollY;
    const panel = [...document.querySelectorAll("section.invest-panel, section.settings-panel")]
      .find((s) => !s.hidden);
    if (!panel) return null;
    // The topmost thing rendered below the bar, whatever it happens to be —
    // asserting against a named element would miss a wrapper growing a margin.
    const below = [...panel.querySelectorAll("*")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.height > 8 && e.offsetParent !== null && (r.top + window.scrollY) > bottom + 0.5;
    }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    if (!below) return null;
    return { gap: Math.round(below.getBoundingClientRect().top + window.scrollY - bottom),
             first: (below.id || String(below.className)).slice(0, 32) };
  }, barSel);

  await p.evaluate(() => window.scrollTo(0, 0));
  await p.evaluate(() => { const e = document.getElementById("tab-investment"); if (e) e.click(); });
  await p.waitForTimeout(2000);
  const invGaps = {};
  for (const st of ["subtab-equity", "subtab-stocksetf", "subtab-fixedincome"]) {
    await p.evaluate((id) => { const e = document.getElementById(id); if (e) e.click(); }, st);
    await p.waitForTimeout(1500);
    invGaps[st] = await gapUnder(".invest-sub-tabs");
  }
  await p.evaluate(() => { const e = document.getElementById("tab-expense"); if (e) e.click(); });
  await p.waitForTimeout(2500);
  const expGaps = {};
  for (const st of ["accounts", "records", "analytics"]) {
    await p.evaluate((k) => {
      const e = document.querySelector('[data-dash-exp-subtab="' + k + '"]'); if (e) e.click();
    }, st);
    await p.waitForTimeout(1800);
    expGaps[st] = await gapUnder(".exp-top-bar");
  }
  console.log("  gaps  investments " + JSON.stringify(invGaps));
  console.log("  gaps  expense     " + JSON.stringify(expGaps));

  const all = Object.assign({}, invGaps, expGaps);
  const names = Object.keys(all);
  ok(names.every((k) => all[k] && all[k].gap != null),
     "G0 every sub-tab has something measurable below its bar", all);
  const GAP = 10;
  const wrong = names.filter((k) => !all[k] || all[k].gap !== GAP);
  ok(wrong.length === 0,
     "G1 the same " + GAP + "px sits under the bar on every sub-tab of both tabs — " +
     "Expense used to open a 20px gap of its own on top of it",
     wrong.map((k) => [k, all[k] && all[k].gap]));

  // ── Narrow ───────────────────────────────────────────────────────────────
  // The Expense bar becomes three stacked rows below 760px; pinned, that is a
  // third of a phone screen spent on chrome, so it is deliberately let go.
  await p.setViewportSize({ width: 420, height: 500 });
  await p.waitForTimeout(900);
  const mInv = await p.evaluate(BOX, ".invest-sub-tabs");
  await p.evaluate(() => { const e = document.getElementById("tab-expense"); if (e) e.click(); });
  await p.waitForTimeout(2000);
  const mExp = await p.evaluate(BOX, ".exp-top-bar");
  console.log("  mobile  invest " + mInv.position + ", expense " + mExp.position);
  eq(mInv.position, "sticky", "M1 the Investments bar still pins on a phone");
  eq(mExp.position, "static",
     "M2 the Expense bar does not — three stacked rows pinned would eat the " +
     "screen, so this is a choice and not an accident", mExp.position);

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
