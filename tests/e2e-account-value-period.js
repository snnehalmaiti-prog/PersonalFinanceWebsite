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
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
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
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

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
      sameLine: Math.abs((e.top + e.height / 2) - (q.top + q.height / 2)) <= 6,
      after: q.left >= e.right - 1,
      selH: Math.round(sel.getBoundingClientRect().height), refH: Math.round(r.height),
      selFs: getComputedStyle(sel).fontSize, refFs: getComputedStyle(ref).fontSize,
    };
  });
  ok(!geom.err && geom.sameLine, "A1 the picker sits on the same line as ACCOUNT VALUE", geom);
  ok(!geom.err && geom.after, "A2 and after it, not before or below", geom);
  ok(Math.abs(geom.selH - geom.refH) <= 2 && geom.selFs === geom.refFs,
     "A3 at the same size as the Income & Expenses · MONTHLY control", geom);

  const state = () => p.evaluate(() => {
    const c = window.__wfPortfolioValueChart;
    const sel = document.getElementById("pvc-month");
    return {
      value: sel.value,
      allActive: document.getElementById("pvc-alltime").classList.contains("active"),
      options: [...sel.options].map((o) => o.textContent),
      min: c && c.scales.x.min, max: c && c.scales.x.max,
    };
  });

  const first = await state();
  ok(first.value === "" && first.allActive,
     "A4 All time is the default", { value: first.value, active: first.allActive });
  ok(first.options[0] === "All time" && first.options.length > 3,
     "A5 with the months the data actually spans beneath it — built from the " +
     "points, so there is no month to pick that would draw an empty chart",
     first.options.slice(0, 4));
  ok(first.min === undefined && first.max === undefined,
     "A6 and the chart is left at its full range", { min: first.min, max: first.max });

  // Pick a month and check the WINDOW, not just the dropdown.
  // A COMPLETED month, deliberately not the newest one. The newest is the month
  // in progress, where the data stops mid-month and the window is clamped to
  // the last point — correct, but it would not show whether a whole month is
  // covered. That case is asserted separately below.
  const picked = await p.evaluate(() => {
    const sel = document.getElementById("pvc-month");
    const vals = [...sel.options].map((o) => o.value).filter(Boolean);   // newest first
    const v = vals[2];
    sel.value = v; sel.dispatchEvent(new Event("change"));
    const c = window.__wfPortfolioValueChart;
    return { v, min: c.scales.x.min, max: c.scales.x.max };
  });
  const bounds = (k) => {
    const y = +k.slice(0, 4), m = +k.slice(5, 7);
    return { min: new Date(y, m - 1, 1).getTime(), max: new Date(y, m, 0, 23, 59, 59, 999).getTime() };
  };
  const want = bounds(picked.v);
  ok(picked.min === want.min && picked.max === want.max,
     "A7 choosing a month reorients the chart to that month's first and last " +
     "day — the whole month, not the first and last day that happen to have a " +
     "data point", { got: [picked.min, picked.max], want: [want.min, want.max], month: picked.v });
  ok((await state()).allActive === false, "A8 and All time stops being the active one");

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
    sel.value = v; sel.dispatchEvent(new Event("change"));
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
  ok(back.value === "" && back.allActive && back.min === undefined,
     "A12 All time puts the full range back", back);

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
