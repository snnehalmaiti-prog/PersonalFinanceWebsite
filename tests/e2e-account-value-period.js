// ACCOUNT VALUE's period picker: All time by default, or one month.
//
// The chart is destroyed and rebuilt on every portfolio switch and data
// refresh, so the interesting part is not "does clicking work" but "does the
// choice survive a re-render" — state kept on the chart object resets to All
// time under the user without anything looking broken.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-account-value-period.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2025", "Snnehal", "Fund A", "Buy", "1000", "10"],
    ["1-Jan-2025", "Trisha", "Fund A", "Buy", "500", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]],
  // A stock whose price history STOPS three months before today. It is the
  // gap case: lookupIndexPrice gives up after five days, and the holding used
  // to be dropped from the total outright for every date after that.
  "wf-stocksetf-data": [TXN, ["1-Jan-2025", "Snnehal", "GAPPY", "Buy", "100", "50"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["GAPPY", "Equity", "Large Cap", "Stock", "India", "GAPPY", "Misc"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
    "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};
const DAYS = (() => { const o = []; const d = new Date("2025-01-01T00:00:00"), e = new Date();
  while (d <= e) { const w = d.getDay();
    if (w !== 0 && w !== 6) o.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1); } return o; })();
const dmy = (i) => { const [y, m, d] = i.split("-"); return `${d}-${m}-${y}`; };
const nav = (i) => (10 + (new Date(i).getMonth() + 1) * 0.25).toFixed(4);
// GAPPY is priced up to here and never again.
const GAP_FROM = DAYS[Math.max(0, DAYS.length - 60)];

let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (d !== undefined ? "  → " + JSON.stringify(d) : "")); } };

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const j = (o) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });

  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: DAYS.map((i) => ({ date: dmy(i), nav: nav(i) })).reverse() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ updated: new Date().toISOString(),
    mf_history: { "100001": Object.fromEntries(DAYS.map((i) => [i, +nav(i)])) } })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: "01-Aug-2026", nav: nav("2026-08-01") } } })));
  // No LIVE price for GAPPY either, so the carry-forward is the only thing that
  // can keep it on the chart. With a live price the drop would be masked.
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {
    GAPPY: { currency: "INR", prices: Object.fromEntries(
      DAYS.filter((d) => d <= GAP_FROM).map((d) => [d, 50])) } } })));

  // A stub that REMEMBERS its x-window, so the assertions can read what the
  // picker actually asked the chart to show. A no-op stub would let every
  // assertion below pass without the picker doing anything.
  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.data = cfg.data; this.options = cfg.options;
      this.scales = { x: { min: undefined, max: undefined }, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.__reset = 0;
      this.zoomScale = function (axis, range) {
        if (axis === "x" && range) { this.scales.x.min = range.min; this.scales.x.max = range.max; }
      };
      this.resetZoom = function () { this.__reset++; this.scales.x.min = undefined; this.scales.x.max = undefined; };
      this.destroy = this.update = this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
  }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(12000);

  // Placement and sizing, both asked for explicitly.
  const geom = await p.evaluate(() => {
    const eye = document.getElementById("pvc-eyebrow");
    const per = document.getElementById("pvc-period-picker");
    const sel = document.getElementById("pvc-month");
    const ref = document.getElementById("epc-year");   // Income & Expenses · MONTHLY
    if (!eye || !per || !sel || !ref) return { err: "missing", per: !!per, ref: !!ref };
    const e = eye.getBoundingClientRect(), q = per.getBoundingClientRect(), r = ref.getBoundingClientRect();
    return {
      below: q.top >= e.bottom - 1,
      alignedLeft: Math.abs(q.left - e.left) <= 2,
      // The BUTTON, not the select: WfYearPicker hides the select outright, so
      // measuring it reports a height of 0 and the comparison means nothing.
      selH: Math.round((sel.__wfYpBtn || sel).getBoundingClientRect().height),
      refH: Math.round((ref.__wfYpBtn || ref).getBoundingClientRect().height),
      selFs: getComputedStyle(sel.__wfYpBtn || sel).fontSize,
      refFs: getComputedStyle(ref.__wfYpBtn || ref).fontSize,
    };
  });
  ok(!geom.err && geom.below, "A1 the picker sits below the ACCOUNT VALUE title", geom);
  ok(!geom.err && geom.alignedLeft,
     "A2 left-aligned with it, so the two read as one block", geom);

  const state = () => p.evaluate(() => {
    const c = window.__wfPortfolioValueChart;
    const sel = document.getElementById("pvc-month");
    const btn = sel.__wfYpBtn;
    return {
      value: sel.value,
      allActive: document.getElementById("pvc-alltime").classList.contains("active"),
      options: [...sel.options].map((o) => o.value),
      // What the reader actually sees: the select is hidden once WfYearPicker
      // is attached, and the button beside it carries the label.
      btnText: btn ? btn.textContent.trim() : null,
      btnHidden: btn ? btn.style.display === "none" : null,
      selVisible: getComputedStyle(sel).display !== "none",
      min: c && c.scales.x.min, max: c && c.scales.x.max,
    };
  });

  const first = await state();
  ok(first.allActive, "A4 All time is the default", { active: first.allActive });
  ok(first.btnHidden === true && first.selVisible === false,
     "A5 and the month picker is hidden while it is on. Reported: the toggle " +
     "and the picker BOTH read \"All time\", because the select carried an " +
     "All time option of its own and was never attached to WfYearPicker",
     { btn: first.btnText, btnHidden: first.btnHidden, selVisible: first.selVisible });
  ok(first.options.length > 3 && first.options.every((v) => /^\d{4}-\d{2}$/.test(v)),
     "A6b the options are months the data actually spans, and nothing else",
     first.options.slice(0, 4));
  ok(first.min === undefined && first.max === undefined,
     "A6 and the chart is left at its full range", { min: first.min, max: first.max });

  // Pick a month and check the WINDOW, not just the dropdown.
  // A COMPLETED month, deliberately not the newest one. The newest is the month
  // in progress, where the data stops mid-month and the window is clamped to
  // the last point — correct, but it would not show whether a whole month is
  // covered. That case is asserted separately below.
  // Through the POPUP, the way a reader reaches it: press All time to turn it
  // off, open the picker, step to the month, click the cell.
  const picked = await p.evaluate(() => {
    document.getElementById("pvc-alltime").click();
    const sel = document.getElementById("pvc-month");
    const vals = [...sel.options].map((o) => o.value).filter(Boolean);   // newest first
    const v = vals[2];
    sel.__wfYpBtn.click();
    const pop = document.querySelector(".wf-yp-pop");
    if (!pop) return { err: "no popup" };
    const head = pop.querySelector(".wf-yp-range").textContent.trim();
    let guard = 0;
    while (pop.querySelector('.wf-yp-range').textContent.trim() !== v.slice(0, 4) && guard++ < 24) {
      pop.querySelector('[data-yp-nav="-1"]').click();
    }
    const cell = document.querySelector('.wf-yp-pop [data-yp-year="' + v + '"]');
    const cells = [...document.querySelectorAll(".wf-yp-pop .wf-yp-year")].map((c) => c.textContent.trim());
    if (!cell) return { err: "no cell for " + v, cells };
    cell.click();
    const c = window.__wfPortfolioValueChart;
    return { v, head, cells, min: c.scales.x.min, max: c.scales.x.max };
  });
  ok(!picked.err && (picked.cells || []).length === 12 && picked.cells[0] === "Jan",
     "A6c the popup shows a grid of MONTHS for one year, navigated by year — " +
     "the same popup as the year picker, one step finer",
     picked.err || picked.cells);
  const bounds = (k) => {
    const y = +k.slice(0, 4), m = +k.slice(5, 7);
    return { min: new Date(y, m - 1, 1).getTime(), max: new Date(y, m, 0, 23, 59, 59, 999).getTime() };
  };
  const want = bounds(picked.v);
  ok(picked.min === want.min && picked.max === want.max,
     "A7 choosing a month reorients the chart to that month's first and last " +
     "day — the whole month, not the first and last day that happen to have a " +
     "data point", { got: [picked.min, picked.max], want: [want.min, want.max], month: picked.v });
  // The subtitle names the month's own first and last day. It used to read
  // "FROM 2026 · TO JUL 2026" — a year on one side and a month on the other,
  // which says neither where the window starts nor that it is a single month.
  const sub = await p.evaluate(() =>
    (document.getElementById("pvc-period") || {}).textContent || "");
  ok(/^FROM 1ST [A-Z]+ TO \d{1,2}(ST|ND|RD|TH) [A-Z]+ \d{4}$/.test(sub.trim()),
     "A7b the subtitle names the month's first and last day", sub);
  ok(!/·/.test(sub),
     "A7c and drops the year-versus-month form entirely", sub);

  const afterPick = await state();
  ok(afterPick.allActive === false, "A8 and All time stops being the active one");
  // Measured HERE, not at load: the picker is hidden while All time is on, and
  // a hidden element reports a height of 0 — which would have compared equal to
  // nothing in particular and passed for the wrong reason.
  const size = await p.evaluate(() => {
    const a = document.getElementById("pvc-month").__wfYpBtn;
    const b = document.getElementById("pvc-alltime");
    const r = document.getElementById("epc-year");
    const ref = r.__wfYpBtn || r;
    const h = (el) => Math.round(el.getBoundingClientRect().height);
    return { pick: h(a), all: h(b), ref: h(ref),
             pickFs: getComputedStyle(a).fontSize, refFs: getComputedStyle(ref).fontSize };
  });
  ok(size.pick > 0 && Math.abs(size.pick - size.ref) <= 2 && size.pickFs === size.refFs,
     "A3 at the same size as the Income & Expenses · MONTHLY control", size);
  ok(Math.abs(size.all - size.ref) <= 2,
     "A3b and so is the All time toggle beside it", size);
  ok(/^[A-Z][a-z]{2} \d{4}$/.test(afterPick.btnText || ""),
     "A8b with the picker naming the month in words rather than showing 2026-05",
     afterPick.btnText);

  // THE one that matters: a re-render must not silently drop the choice.
  await p.evaluate(() => {
    const btn = document.querySelector('#portfolio-pills [data-ov-portfolio="Trisha"]');
    if (btn) btn.click();
  });
  await p.waitForTimeout(6000);
  const after = await state();
  ok(after.value === picked.v,
     "A9 the month survives a portfolio switch, which destroys and rebuilds the " +
     "chart — state held on the chart object would have reset to All time here",
     { was: picked.v, now: after.value });
  ok(after.min === want.min && after.max === want.max,
     "A10 and the rebuilt chart is reoriented to it, not merely labelled with it",
     { got: [after.min, after.max], want: [want.min, want.max] });

  // The month in progress: the series stops at the last point that exists, and
  // the window has to stop with it. Zoom limits are pinned to the plotted
  // range, so asking for days past the final point is refused outright — the
  // chart would ignore the whole window and quietly stay where it was.
  const cur = await p.evaluate(() => {
    const sel = document.getElementById("pvc-month");
    const v = [...sel.options].map((o) => o.value).filter(Boolean)[0];   // newest
    sel.value = v; sel.dispatchEvent(new Event("change", { bubbles: true }));
    const c = window.__wfPortfolioValueChart;
    const pts = c.data.datasets[0].data;
    const last = pts[pts.length - 1];
    return { v, min: c.scales.x.min, max: c.scales.x.max,
             lastPoint: new Date(last.x).getTime() };
  });
  ok(cur.max <= cur.lastPoint + 1000 && cur.max >= cur.lastPoint - 86400000,
     "A11 the month in progress is clamped to the last point that exists, not " +
     "extended into days the series does not reach",
     { max: cur.max, lastPoint: cur.lastPoint, month: cur.v });

  await p.evaluate(() => document.getElementById("pvc-alltime").click());
  await p.waitForTimeout(600);
  const back = await state();
  ok(back.allActive && back.min === undefined && back.btnHidden === true,
     "A12 All time puts the full range back and hides the picker again", back);

  // A holding whose price series ends must hold its last value, not vanish.
  //
  // Market movement is a RESIDUAL, so a dropped holding does not read as "we do
  // not know" — it reads as the position becoming worthless, and then as an
  // equal gain when it prices again. One gap, two wrong months, both blamed on
  // the market. GAPPY is 100 units at 50 = 5,000 and has no live price, so the
  // carry-forward is the only thing that can keep it counted.
  const tail = await p.evaluate(() => {
    const c = window.__wfPortfolioValueChart;
    const pts = c.data.datasets[0].data.filter((q) => q && q.y != null);
    const ys = pts.map((q) => q.y);
    return { last: ys[ys.length - 1], min: Math.min(...ys), max: Math.max(...ys), n: ys.length };
  });
  // Back to the household. An earlier step selects Trisha, who does not own
  // GAPPY at all — leaving it selected made every assertion below true of a
  // series the unpriced holding was never in.
  await p.evaluate(() => {
    const btn = document.querySelector('#portfolio-pills [data-ov-portfolio="all"]')
      || document.querySelector("#portfolio-pills button");
    if (btn) btn.click();
  });
  await p.waitForTimeout(6000);
  ok(tail.n > 100, "G1 the series has points to inspect", tail);
  ok(tail.min >= 5000,
     "G2 the value never collapses below the unpriced holding's own worth — a " +
     "drop would take 5,000 out of every date past the end of its history",
     tail);
  // Measured AT the boundary rather than as a worst-case step anywhere: the
  // final point is snapped to the Overview total and legitimately jumps, so a
  // whole-series maximum catches that instead of the thing under test.
  const edge = await p.evaluate((gap) => {
    const pts = window.__wfPortfolioValueChart.data.datasets[0].data
      .filter((q) => q && q.y != null);
    const iso = (x) => new Date(x).toISOString().slice(0, 10);
    let before = null, after = null;
    for (const q of pts) {
      const d = iso(q.x);
      if (d <= gap) before = q.y;
      // Well past lookupIndexPrice's five-day reach, so the price is genuinely
      // gone by here rather than merely a few days stale.
      if (after === null && d > gap && (new Date(d) - new Date(gap)) > 12 * 864e5) after = q.y;
    }
    return { before, after, drop: before != null && after != null ? before - after : null };
  }, GAP_FROM);
  ok(edge.before != null && edge.after != null,
     "G3 there are points either side of the price gap to compare", edge);
  ok(edge.drop != null && Math.abs(edge.drop) < 2500,
     "G3b and the total does not fall by the unpriced holding's 5,000 when its " +
     "prices run out — that fall is what dropping it looks like, and it would " +
     "be reported as a market loss and then an equal market gain", edge);

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
