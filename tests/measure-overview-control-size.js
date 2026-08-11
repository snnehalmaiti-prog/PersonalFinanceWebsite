// One size of control across the Overview's monthly chart cards.
//
// Four cards run down the Overview, each with a range pill and a year picker in
// its header: CASH FLOW · MONTHLY, NET WORTH · MONTHLY, Income & Expenses ·
// MONTHLY and EXPENSE BY CATEGORY. Cash Flow's are compact because it carries
// five controls and the default size crowded them out; the other three inherited
// the default and came out 27px tall against Cash Flow's 20px. Adjacent cards at
// two sizes read as two designs stacked, not one column.
//
// This has now been reported three times, once per card, so the assertion is
// written over the whole set rather than the pair that happened to be raised:
// a fifth card added to the Overview should join the list here and fail until it
// matches.
//
// Everything is measured against Cash Flow, and from computed style rather than
// the stylesheet — a card can pick up the compact rule and still be overridden
// by something more specific.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/measure-overview-control-size.js
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

// Cash Flow first: it is the reference every other card is compared against.
const CARDS = [
  { id: "monthly-invest-cat-card", name: "CASH FLOW · MONTHLY" },
  { id: "net-worth-monthly-card", name: "NET WORTH · MONTHLY" },
  { id: "monthly-cashflow-card", name: "Income & Expenses · MONTHLY" },
  { id: "expense-pie-card", name: "EXPENSE BY CATEGORY" },
];

const PROBE = (cards) => {
  // A year picker hides its <select> and puts a button on screen in its place,
  // so measuring the select compares two zero-height boxes and proves nothing.
  const shown = (el) => (el.tagName === "SELECT" && el.__wfYpBtn) ? el.__wfYpBtn : el;
  const measure = (el) => {
    const t = shown(el), r = t.getBoundingClientRect(), cs = getComputedStyle(t);
    return { id: el.id || "(anon)", h: Math.round(r.height), fs: cs.fontSize, pad: cs.padding };
  };
  const out = {};
  cards.forEach((c) => {
    const card = document.getElementById(c.id);
    if (!card) { out[c.id] = null; return; }
    const ctr = card.querySelector(".mic-controls");
    out[c.id] = {
      gap: ctr ? getComputedStyle(ctr).gap : null,
      pills: [...card.querySelectorAll(".mic-dropdown-btn")]
        .filter((e) => shown(e).getBoundingClientRect().height > 0)
        .map(measure),
    };
  });
  return out;
};

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

  const m = await p.evaluate(PROBE, CARDS);
  CARDS.forEach((c) => console.log("  " + c.name.padEnd(28) +
    (m[c.id] ? "gap " + m[c.id].gap + "  " + JSON.stringify(m[c.id].pills.map((x) => [x.id, x.h, x.fs])) : "(absent)")));
  console.log("");

  const ref = m[CARDS[0].id];
  ok(ref && ref.pills.length >= 2, "S0 the reference card is on screen with its controls", ref);
  // A card whose own pills disagree is broken before any comparison.
  ok(ref.pills.every((x) => x.h === ref.pills[0].h), "S1 Cash Flow's own controls agree",
     ref.pills.map((x) => [x.id, x.h]));

  CARDS.slice(1).forEach((c, i) => {
    const g = m[c.id], n = "S" + (i + 2);
    if (!g || !g.pills.length) { ok(false, n + " " + c.name + " has measurable controls", g); return; }
    ok(g.pills.every((x) => x.h === ref.pills[0].h),
       n + "a " + c.name + " — pills the same height as Cash Flow's",
       { want: ref.pills[0].h, got: g.pills.map((x) => [x.id, x.h]) });
    ok(g.pills.every((x) => x.fs === ref.pills[0].fs),
       n + "b " + c.name + " — at the same text size",
       { want: ref.pills[0].fs, got: g.pills.map((x) => [x.id, x.fs]) });
    ok(g.pills.every((x) => x.pad === ref.pills[0].pad),
       n + "c " + c.name + " — with the same padding",
       { want: ref.pills[0].pad, got: g.pills.map((x) => [x.id, x.pad]) });
    ok(g.gap === ref.gap, n + "d " + c.name + " — spaced apart the same way",
       { want: ref.gap, got: g.gap });
  });

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
