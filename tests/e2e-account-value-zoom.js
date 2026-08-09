// ACCOUNT VALUE · OVER TIME — the zoom-following readout.
//
// The chart zooms (wheel/pinch/drag), but the readout beside the title used to show
// today's value whatever was on screen, so zooming told you the SHAPE of a period
// without telling you its numbers. It now follows the visible window: the value at
// its right edge and the change across it.
//
// The range pills that used to drive these windows have been removed, so the test
// opens each one directly — which is also the only way a user can now reach them.
//
// Chart.js and its zoom plugin cannot load here (no CDN), so this models an x scale
// with min/max plus zoomScale/resetZoom. It therefore covers the wiring and the
// arithmetic, NOT the plugin's own wheel/pinch gestures.
//
// NOT in run-all.js — needs a static server and Playwright's Chromium.
//
//     node tools/serve.js &
//     node tests/e2e-account-value-zoom.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN, ["1-Jan-2023", "Snnehal", "Fund A", "Buy", "1000", "10"]],
  "wf-mfmapping-data": [["Instrument Name","Instrument Category","Instrument Sub Category","Scheme Code","ISIN"],
    ["Fund A","Equity","Flexi Cap","100033","INF1"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name","Instrument Category","Instrument Sub Category","Market Segment","Region","Identifier","Sector"]],
  "wf-fd-data": [["Transaction Date","Portfolio Name","Bank","Instrument Name","Instrument Category","Instrument Sub Category","Transaction Type","Invested Amount","Maturity Date/Sell Date","Rate of Return"]],
  "wf-fixedincome-data": [["Transaction Date","Portfolio Name","Instrument Name","Instrument Category","Instrument Sub Category","Transaction Type","Amount"]],
};
// NAV compounds at a fixed 0.16%/day, so every window's expected change is
// 1.0016^days - 1 and can be checked against the readout without trusting the app.
const DAILY = 1.0016;
const NAV_START = "2023-01-01", NAV_END = "2024-12-01";
function navSeries() {
  const out = []; const d = new Date(NAV_START + "T00:00:00"); const e = new Date(NAV_END + "T00:00:00");
  let n = 10;
  while (d <= e) { const iso = d.toISOString().slice(0,10); const [y,m,dd] = iso.split("-");
    out.push({ date: `${dd}-${m}-${y}`, nav: n.toFixed(6) }); n *= DAILY; d.setDate(d.getDate()+1); }
  return out.reverse();
}
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  \u2192 " + JSON.stringify(detail) : "")); }
}
const pctOf = (t) => String(t || "").match(/\(([+\u2212-]?)([\d.]+)%\)/);
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status:200, contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:"[]" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status:200, contentType:"text/css", body:"" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill({ status:200, contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body: JSON.stringify({ data: navSeries() }) }));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill({ status:200, contentType:"application/json", body: JSON.stringify({fetchedAt:1,data:{INF1:"100033"}}) }));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill({ status:200, contentType:"application/json", body: JSON.stringify({fetchedAt:1,data:{"100033":30}}) }));
  // Chart.js cannot load here (no CDN), so model just enough of it: an x scale with
  // min/max, plus the zoom plugin's zoomScale/resetZoom.
  await p.addInitScript(() => {
    window.Chart = function (ctx, cfg) {
      const self = this;
      const pts = ((cfg.data.datasets || [])[0] || {}).data || [];
      const lim = ((((cfg.options || {}).plugins || {}).zoom || {}).limits || {}).x || {};
      self.data = cfg.data; self.options = cfg.options;
      self.scales = { x: { min: lim.min, max: lim.max }, y: {} };
      self.zoomScale = function (id, range) { self.scales.x.min = range.min; self.scales.x.max = range.max; };
      self.resetZoom = function () { self.scales.x.min = lim.min; self.scales.x.max = lim.max; };
      self.destroy = function () {}; self.update = function () {}; self.resize = function () {};
      self.getElementsAtEventForMode = function () { return []; };
      window.__charts = window.__charts || {};
      window.__charts[(ctx && ctx.canvas && ctx.canvas.id) || "?"] = { cfg: cfg, n: pts.length };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({access_token:"x",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"u1",email:"a@b.c"}}));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(11000);
  const read = () => p.evaluate(() => {
    const ch = window.__wfPortfolioValueChart;
    const sc = ch && ch.scales && ch.scales.x;
    return {
      name: (document.getElementById("pvc-legend-name")||{}).textContent,
      value: (document.getElementById("pvc-current-value")||{}).textContent,
      change: (() => { const e = document.getElementById("pvc-range-change"); return e && !e.hidden ? e.textContent : null; })(),
      period: (document.getElementById("pvc-period")||{}).textContent,
      eyebrow: (document.getElementById("pvc-eyebrow")||{}).textContent,
      gEyebrow: (document.getElementById("avc-eyebrow")||{}).textContent,
      gPeriod: (document.getElementById("avc-period")||{}).textContent,
      gPort: (document.getElementById("avc-portfolio-value")||{}).textContent,
      gIdx: (document.getElementById("avc-index-value")||{}).textContent,
      spanDays: sc ? Math.round((sc.max - sc.min) / 864e5) : null,
    };
  });
  const initial = await read();
  console.log("  initial " + JSON.stringify(initial));
  ok(initial.spanDays > 0, "A1 the chart rendered with an x range", initial);
  ok(initial.name === "Current Value", "A2 unzoomed, the readout is the current value", initial.name);
  ok(initial.change === null, "A3 and shows no change — there is no window to compare", initial.change);
  // The title and the period are two lines, not one run-on string.
  ok(initial.eyebrow === "ACCOUNT VALUE",
     "A3a the Account Value title is the title alone", initial.eyebrow);
  ok(initial.period === "OVER TIME",
     "A3b with OVER TIME on the period line beneath it", initial.period);
  ok(initial.gEyebrow === "Portfolio Performance",
     "A3c the Growth title is the title alone", initial.gEyebrow);
  ok(/^SINCE \d{4}$/.test(initial.gPeriod || ""),
     "A3d with SINCE <year> on the period line beneath it", initial.gPeriod);
  ok(await p.evaluate(() => document.querySelectorAll("[data-pvc-range]").length) === 0,
     "A4 the range pills are gone from the markup");

  // The pills used to drive these windows. They are gone, so the test opens each
  // one the way a wheel-zoom does — which is also the only thing a user can now do.
  async function zoomDays(days) {
    return p.evaluate((d) => {
      const ch = window.__wfPortfolioValueChart;
      const max = ch.options.plugins.zoom.limits.x.max;
      const min = max - d * 864e5;
      ch.zoomScale("x", { min: min, max: max }, "none");
      const cb = ch.options.plugins.zoom.zoom.onZoomComplete;
      if (cb) cb({ chart: ch });
    }, days);
  }

  const seen = {};
  for (const d of [30, 91, 366]) {
    await zoomDays(d);
    await p.waitForTimeout(200);
    seen[d] = await read();
    console.log("  " + String(d).padStart(3) + "d " + JSON.stringify(seen[d]));
  }

  ok(seen[30].spanDays === 30, "C1 a 30-day window is 30 days wide", seen[30].spanDays);
  ok(seen[30].name === "Value",
     "C2 zoomed, the legend label does not repeat the month — the period line has it", seen[30].name);
  ok(/^FROM \d{4} · TO [A-Z]{3} \d{4}$/.test(seen[30].period || ""),
     "C2b and the period line names the window", seen[30].period);
  ok(seen[30].change && seen[30].change.indexOf("₹") !== -1,
     "C3 and shows the change across the window", seen[30].change);

  // The NAV compounds at a known daily rate, so each window's percentage is
  // arithmetic, not something to take the app's word for.
  [30, 91, 366].forEach(function (d) {
    const m = pctOf(seen[d].change);
    const want = (Math.pow(DAILY, seen[d].spanDays) - 1) * 100;
    ok(m && Math.abs(parseFloat(m[2]) - want) < 0.05,
       "C4 " + d + "d change matches " + DAILY + "^" + seen[d].spanDays + " = " + want.toFixed(2) + "%",
       seen[d].change);
    ok(m && m[1] !== "\u2212" && m[1] !== "-", "C5 " + d + "d a rising series reads as a gain", seen[d].change);
  });

  // Double-click resets the zoom and the readout with it.
  await p.evaluate(() => document.getElementById("portfolio-value-chart").ondblclick());
  await p.waitForTimeout(200);
  const afterDbl = await read();
  ok(afterDbl.name === "Current Value" && afterDbl.change === null && afterDbl.period === "OVER TIME",
     "C6 double-click restores the whole-period readout", afterDbl);
  ok(afterDbl.spanDays === initial.spanDays, "C7 and the full range", [afterDbl.spanDays, initial.spanDays]);

  // The point of the feature: a window that does NOT end at today must report ITS
  // end value, not the current one. A window ending at the last point looks the
  // same either way, so only an interior one discriminates.
  await p.evaluate(() => {
    const ch = window.__wfPortfolioValueChart;
    ch.zoomScale("x", { min: new Date("2024-05-01T00:00:00").getTime(),
                        max: new Date("2024-06-01T00:00:00").getTime() }, "none");
    const cb = ch.options.plugins.zoom.zoom.onZoomComplete;
    if (cb) cb({ chart: ch });
  });
  await p.waitForTimeout(200);
  const mid = await read();
  console.log("  interior " + JSON.stringify(mid));
  ok(/^FROM 2024 · TO JUN 2024$/.test(mid.period || ""),
     "C8 an interior window's period line names it, ending in its own month not today", mid.period);
  ok(mid.eyebrow === "ACCOUNT VALUE",
     "C8b and the title never changes with the zoom", mid.eyebrow);
  ok(mid.value !== initial.value,
     "C9 and reports that window's value, not the current one", [mid.value, initial.value]);

  async function zoomTo(chartVar, fromIso, toIso) {
    return p.evaluate(([v, a, z]) => {
      const ch = window[v];
      if (!ch) return null;
      ch.zoomScale("x", { min: new Date(a).getTime(), max: new Date(z).getTime() }, "none");
      const cb = ch.options.plugins.zoom.zoom.onZoomComplete;
      if (cb) cb({ chart: ch });
      return true;
    }, [chartVar, fromIso, toIso]);
  }

  // The Growth chart's period line must behave the same way: the title stays put,
  // the line under it follows the window and comes back on reset.
  if (await zoomTo("__wfValueChart", "2024-05-01", "2024-06-01")) {
    await p.waitForTimeout(200);
    const g = await read();
    console.log("  growth interior " + JSON.stringify({ e: g.gEyebrow, p: g.gPeriod }));
    ok(g.gEyebrow === "Portfolio Performance",
       "D1 Growth: the title never changes with the zoom", g.gEyebrow);
    ok(/^FROM 2024 · TO JUN 2024$/.test(g.gPeriod || ""),
       "D2 Growth: the period line names the window", g.gPeriod);
    // The legend must describe the chart on screen, not today.
    ok(/^₹\d/.test(g.gPort || "") && g.gPort !== initial.gPort,
       "D2a Growth: Portfolio Value follows the window", [g.gPort, initial.gPort]);
    // Not just "different" — the right number. One buy and no later flows, so
    // growth of ₹100 is exactly the NAV ratio, and the NAV compounds at a known
    // rate from a known date. The window ends 2024-06-01, 517 days in.
    {
      const days = Math.round((new Date("2024-06-01") - new Date("2023-01-01")) / 864e5);
      const want = Math.round(100 * Math.pow(DAILY, days));
      ok(g.gPort === "₹" + want,
         "D2c Growth: and it is 100 × " + DAILY + "^" + days + " = ₹" + want, g.gPort);
    }
    ok(/^₹\d/.test(g.gIdx || "") && g.gIdx !== initial.gIdx,
       "D2b Growth: Index Value follows the window", [g.gIdx, initial.gIdx]);
    // The Growth chart has no dblclick reset; put the window back where it
    // started, which is what the reset button and a pan-to-the-edge both do.
    await p.evaluate(() => {
      const ch = window.__wfValueChart;
      const lim = ch.options.plugins.zoom.limits.x;
      ch.zoomScale("x", { min: lim.min, max: lim.max }, "none");
      const cb = ch.options.plugins.zoom.zoom.onZoomComplete;
      if (cb) cb({ chart: ch });
    });
    await p.waitForTimeout(200);
    const gr = await read();
    ok(/^SINCE \d{4}$/.test(gr.gPeriod || ""),
       "D3 Growth: double-click restores SINCE <year>", gr.gPeriod);
    ok(gr.gPort === initial.gPort && gr.gIdx === initial.gIdx,
       "D3a and both legend figures come back to the whole-period ones",
       [gr.gPort, initial.gPort, gr.gIdx, initial.gIdx]);
  }

  // Hover: the figures belong in the card header, not in a floating tooltip that
  // has to be chased across the plot. Both charts read out the hovered point and
  // both put it back when the pointer leaves.
  {
    const tips = await p.evaluate(() => ({
      pvc: window.__wfPortfolioValueChart.options.plugins.tooltip.enabled,
      avc: window.__wfValueChart.options.plugins.tooltip.enabled,
      pvcMode: (window.__wfPortfolioValueChart.options.interaction || {}).mode,
      avcMode: (window.__wfValueChart.options.interaction || {}).mode,
    }));
    ok(tips.pvc === false && tips.avc === false,
       "H1 the floating tooltip is off on both charts", tips);
    ok(tips.pvcMode === "index" && tips.avcMode === "index",
       "H2 and hovering picks the nearest point along x, not a 0px-radius hit", tips);

    // Drive the handler the way Chart.js does. The stub has no hit-testing, so
    // the element list is supplied — what is under test is the readout, not
    // Chart.js's geometry.
    const hoverPvc = (i) => p.evaluate((idx) => {
      const ch = window.__wfPortfolioValueChart;
      ch.options.onHover(null, idx < 0 ? [] : [{ index: idx }], ch);
      const pts = ch.data.datasets[0].data;
      return { shown: (document.getElementById("pvc-current-value")||{}).textContent,
               period: (document.getElementById("pvc-period")||{}).textContent,
               want: idx < 0 ? null : Math.round(pts[idx].y).toLocaleString("en-IN") };
    }, i);

    // What the header says before any hovering — the chart is still zoomed to the
    // interior window from earlier, so this is a window readout, not the full one.
    const preHover = await read();
    const h0 = await hoverPvc(5);
    ok(h0.shown === "₹" + h0.want,
       "H3 Account Value: hovering shows THAT point's value in the header", h0);
    ok(/^\d{1,2} [A-Z]{3} \d{4}$/.test(h0.period || ""),
       "H4 and the period line names the date it belongs to", h0.period);

    // A different point must give a different figure, or the readout could be
    // reporting a constant and H3 would still pass.
    const h1 = await hoverPvc(300);
    ok(h1.shown === "₹" + h1.want && h1.shown !== h0.shown,
       "H5 and a different point reads out differently", [h0.shown, h1.shown]);

    // Leaving restores the zoom-window readout rather than stranding the last
    // hovered value in the header.
    await p.evaluate(() => document.getElementById("portfolio-value-chart").onmouseleave());
    const afterLeave = await read();
    ok(afterLeave.value === preHover.value && afterLeave.period === preHover.period &&
       afterLeave.name === preHover.name && afterLeave.change === preHover.change,
       "H6 and leaving the chart restores exactly what it said before", [afterLeave, preHover]);
    ok(afterLeave.value !== h1.shown,
       "H6b — which is not the last hovered value left stranded", [afterLeave.value, h1.shown]);

    // The Growth chart reads out BOTH series, since both are plotted.
    const hoverAvc = (i) => p.evaluate((idx) => {
      const ch = window.__wfValueChart;
      ch.options.onHover(null, [{ index: idx }], ch);
      const idxSeries = (ch.data.datasets[1] || {}).data || [];
      // What the index series itself says at the hovered DATE, under the same
      // "last non-null at or before" rule the readout must be following.
      const t = ch.data.datasets[0].data[idx].x.getTime();
      let wantIdx = null;
      for (const q of idxSeries) { if (!q || q.x.getTime() > t) break; if (q.y != null) wantIdx = q.y; }
      return { port: (document.getElementById("avc-portfolio-value")||{}).textContent,
               idx: (document.getElementById("avc-index-value")||{}).textContent,
               period: (document.getElementById("avc-period")||{}).textContent,
               want: Math.round(ch.data.datasets[0].data[idx].y),
               wantIdx: wantIdx == null ? null : Math.round(wantIdx) };
    }, i);
    const g0 = await hoverAvc(5);
    ok(g0.port === "₹" + g0.want,
       "H7 Growth: hovering shows that point's Portfolio value", g0);
    ok(g0.wantIdx != null && g0.idx === "₹" + g0.wantIdx,
       "H8 and the Index value at that same date alongside it", g0);
    // Both figures must MOVE with the pointer. Without this, a readout that never
    // updated the index would still satisfy H8 by leaving the old value in place.
    const g1 = await hoverAvc(300);
    ok(g1.idx === "₹" + g1.wantIdx && g1.idx !== g0.idx,
       "H8b and both follow the pointer to a different date", [g0.idx, g1.idx]);
    ok(g1.port === "₹" + g1.want && g1.port !== g0.port,
       "H8c — the Portfolio figure too", [g0.port, g1.port]);
    ok(/^\d{1,2} [A-Z]{3} \d{4}$/.test(g0.period || ""),
       "H9 and the period line names the date", g0.period);

    await p.evaluate(() => document.getElementById("value-chart").onmouseleave());
    const gLeave = await read();
    ok(/^SINCE \d{4}$/.test(gLeave.gPeriod || ""),
       "H10 Growth: leaving restores the whole-period readout", gLeave.gPeriod);
    ok(gLeave.gPort === initial.gPort,
       "H11 and the whole-period figure with it", [gLeave.gPort, initial.gPort]);
  }

  // Click-and-drag, with real mouse events, on both charts. This is the whole point
  // of owning the pan rather than leaving it to a plugin we cannot load here.
  async function dragChart(canvasId, dx) {
    const box = await p.evaluate((id) => {
      const c = document.getElementById(id);
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, canvasId);
    if (!box) return null;
    await p.mouse.move(box.x, box.y);
    await p.mouse.down();
    // Several steps: the handler ignores the first few pixels as a click.
    for (let i = 1; i <= 5; i++) await p.mouse.move(box.x + (dx * i) / 5, box.y);
    await p.mouse.up();
    await p.waitForTimeout(200);
    return true;
  }
  async function xWindow(v) {
    return p.evaluate((k) => {
      const ch = window[k];
      const sc = ch && ch.scales && ch.scales.x;
      return sc ? { min: sc.min, max: sc.max } : null;
    }, v);
  }

  for (const c of [
    { name: "Account Value", canvas: "portfolio-value-chart", chart: "__wfPortfolioValueChart" },
    { name: "Growth", canvas: "value-chart", chart: "__wfValueChart" },
  ]) {
    // Zoom in first: with the whole range on screen there is nowhere to pan to,
    // and a drag correctly does nothing.
    await zoomTo(c.chart, "2024-03-01", "2024-06-01");
    await p.waitForTimeout(150);
    const before = await xWindow(c.chart);
    await dragChart(c.canvas, 200);       // drag right → window moves back in time
    const after = await xWindow(c.chart);
    console.log("  drag " + c.name + " " + JSON.stringify({ before, after }));
    ok(after && before && after.min < before.min,
       "E " + c.name + ": dragging right moves the window back in time",
       [before && before.min, after && after.min]);
    ok(after && Math.abs((after.max - after.min) - (before.max - before.min)) < 1000,
       "E " + c.name + ": the window keeps its width — a drag pans, it does not zoom",
       [before && before.max - before.min, after && after.max - after.min]);

    // Drag past the start. One gesture cannot get there — the pointer is clamped to
    // the viewport, so a single "huge" drag only ever moves a screen's worth, which
    // is why asking for 5000px silently tested nothing. Repeat until it piles up.
    for (let i = 0; i < 12; i++) await dragChart(c.canvas, 700);
    const clamped = await xWindow(c.chart);
    const limit = await p.evaluate((k) => {
      const z = window[k].options.plugins.zoom.limits.x;
      return { min: z.min, max: z.max };
    }, c.chart);
    ok(clamped.min >= limit.min - 1,
       "E " + c.name + ": dragging past the first point stops at it",
       [clamped.min, limit.min]);

    // And back the other way, to the last point.
    for (let i = 0; i < 24; i++) await dragChart(c.canvas, -700);
    const clampedR = await xWindow(c.chart);
    ok(clampedR.max <= limit.max + 1,
       "E " + c.name + ": dragging past the last point stops at it",
       [clampedR.max, limit.max]);

    // A click with the tiny wobble a real hand produces must not shift the chart.
    // Dispatching down+up with no move at all would pass whether or not the guard
    // exists, since the move handler never runs — the wobble is the whole test.
    const beforeClick = await xWindow(c.chart);
    const box = await p.evaluate((id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, c.canvas);
    await p.mouse.move(box.x, box.y);
    await p.mouse.down();
    await p.mouse.move(box.x + 2, box.y);
    await p.mouse.up();
    await p.waitForTimeout(150);
    const afterClick = await xWindow(c.chart);
    ok(afterClick.min === beforeClick.min && afterClick.max === beforeClick.max,
       "E " + c.name + ": a click with a 2px wobble leaves the window alone",
       [beforeClick, afterClick]);
  }

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
