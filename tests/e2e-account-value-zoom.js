// ACCOUNT VALUE · OVER TIME — the range pills and the zoom-following readout.
//
// The chart already zoomed (wheel/pinch/drag), but the readout beside the title
// always showed today's value, so zooming told you the SHAPE of a period without
// telling you its numbers. The readout now follows the visible window: the value at
// its right edge and the change across it. "1M" makes the last month one click.
//
// Chart.js and its zoom plugin cannot load here (no CDN), so this models an x scale
// with min/max plus zoomScale/resetZoom. It therefore covers the wiring and the
// arithmetic, NOT the plugin's own wheel/pinch gestures.
//
// NOT in run-all.js — needs a static server and Playwright's Chromium.
//
//     node tools/serve.js &
//     node tests/e2e-account-value-zoom.js
const { chromium } = require("playwright");
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
const SHORT = process.env.PVC_SHORT === "1";
const NAV_START = SHORT ? "2024-10-15" : "2023-01-01", NAV_END = "2024-12-01";
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
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
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
      spanDays: sc ? Math.round((sc.max - sc.min) / 864e5) : null,
      active: [...document.querySelectorAll("[data-pvc-range]")].filter(b=>b.classList.contains("active")).map(b=>b.textContent),
      disabled: [...document.querySelectorAll("[data-pvc-range]")].filter(b=>b.disabled).map(b=>b.textContent),
    };
  });
  const initial = await read();
  console.log("  initial " + JSON.stringify(initial));
  ok(initial.spanDays > 0, "A1 the chart rendered with an x range", initial);
  ok(initial.name === "Current Value", "A2 unzoomed, the readout is the current value", initial.name);
  ok(initial.change === null, "A3 and shows no change — there is no window to compare", initial.change);
  ok(initial.active.join() === "All", "A4 All is the active pill on load", initial.active);

  const seen = {};
  for (const r of ["1M", "3M", "6M", "1Y", "ALL"]) {
    const btn = await p.evaluate((k) => {
      const b = document.querySelector(`[data-pvc-range="${k}"]`);
      return b ? { disabled: b.disabled } : null;
    }, r);
    if (!btn) { ok(false, "pill " + r + " exists"); continue; }
    if (btn.disabled) { seen[r] = { disabled: true }; console.log("  " + r.padEnd(4) + " disabled"); continue; }
    await p.evaluate((k) => document.querySelector(`[data-pvc-range="${k}"]`).click(), r);
    await p.waitForTimeout(300);
    seen[r] = await read();
    console.log("  " + r.padEnd(4) + " " + JSON.stringify(seen[r]));
  }

  if (SHORT) {
    // Only ~1.5 months of history: a 3M/6M/1Y window would just be the full range
    // wearing a longer label, so those pills must be switched off rather than lying.
    // `seen[k].disabled === true` marks a pill that was skipped; a pill that WAS
    // clicked yields the readout object instead (whose own `disabled` field is the
    // list of other disabled pills, hence the explicit === true).
    ok(seen["1M"] && seen["1M"].disabled !== true && seen["1M"].spanDays === 30,
       "B1 1M is still offered on a short history, and opens a 30-day window", seen["1M"]);
    ok(seen["3M"] && seen["3M"].disabled === true, "B2 3M is disabled — there is not 3 months of data", seen["3M"]);
    ok(seen["6M"] && seen["6M"].disabled === true, "B3 6M is disabled", seen["6M"]);
    ok(seen["1Y"] && seen["1Y"].disabled === true, "B4 1Y is disabled", seen["1Y"]);
  } else {
    ok(seen["1M"].spanDays === 30, "C1 1M opens a 30-day window", seen["1M"].spanDays);
    ok(seen["3M"].spanDays === 91, "C2 3M opens a 91-day window", seen["3M"].spanDays);
    ok(seen["1Y"].spanDays === 366, "C3 1Y opens a one-year window", seen["1Y"].spanDays);
    ok(/^Value · /.test(seen["1M"].name), "C4 zoomed, the readout names the month it ends in", seen["1M"].name);
    ok(seen["1M"].change && seen["1M"].change.indexOf("₹") !== -1,
       "C5 and shows the change across the window", seen["1M"].change);

    // The NAV compounds at a known daily rate, so each window's percentage is
    // arithmetic, not something to take the app's word for.
    ["1M", "3M", "1Y"].forEach(function (k) {
      const m = pctOf(seen[k].change);
      const want = (Math.pow(DAILY, seen[k].spanDays) - 1) * 100;
      ok(m && Math.abs(parseFloat(m[2]) - want) < 0.05,
         "C6 " + k + " change matches " + DAILY + "^" + seen[k].spanDays + " = " + want.toFixed(2) + "%",
         seen[k].change);
      ok(m && m[1] !== "\u2212" && m[1] !== "-", "C7 " + k + " a rising series reads as a gain", seen[k].change);
    });

    ok(seen["ALL"].name === "Current Value" && seen["ALL"].change === null,
       "C8 All returns the readout to the current value", seen["ALL"]);
    ok(seen["ALL"].spanDays === initial.spanDays, "C9 and restores the full range", [seen["ALL"].spanDays, initial.spanDays]);

    // Double-click resets zoom AND the pills — the control must not disagree with
    // the chart it drives.
    await p.evaluate((k) => document.querySelector(`[data-pvc-range="${k}"]`).click(), "1M");
    await p.waitForTimeout(200);
    await p.evaluate(() => document.getElementById("portfolio-value-chart").ondblclick());
    await p.waitForTimeout(200);
    const afterDbl = await read();
    ok(afterDbl.active.join() === "All" && afterDbl.change === null,
       "C10 double-click resets both the zoom and the active pill", afterDbl);

    // The point of the feature: a window that does NOT end at today must report
    // ITS end value, not the current one. Every range pill ends at the last point,
    // so only an interior window — what a wheel-zoom or a drag-pan produces — can
    // tell a window-aware readout from one that just prints the final value.
    const interior = await p.evaluate(() => {
      const ch = window.__wfPortfolioValueChart;
      const pts = ch.data.datasets[0].data;
      const end = new Date("2024-06-01T00:00:00").getTime();
      const start = new Date("2024-05-01T00:00:00").getTime();
      ch.zoomScale("x", { min: start, max: end }, "none");
      // Same path the plugin's gesture callbacks take.
      document.getElementById("portfolio-value-chart").dispatchEvent(new Event("noop"));
      return { finalValue: pts[pts.length - 1].y };
    });
    // Drive the readout the way onZoomComplete would.
    await p.evaluate(() => {
      const b = document.querySelector('[data-pvc-range="1M"]');
      b.click(); // reset to a known state first
    });
    await p.waitForTimeout(200);
    await p.evaluate(() => {
      const ch = window.__wfPortfolioValueChart;
      ch.zoomScale("x", { min: new Date("2024-05-01T00:00:00").getTime(),
                          max: new Date("2024-06-01T00:00:00").getTime() }, "none");
      const z = ch.options.plugins.zoom.zoom.onZoomComplete;
      if (z) z({ chart: ch });
    });
    await p.waitForTimeout(200);
    const mid = await read();
    console.log("  interior " + JSON.stringify(mid));
    ok(/Jun 2024/.test(mid.name || ""),
       "C11 an interior window names the month it ends in, not today", mid.name);
    ok(mid.value !== seen["ALL"].value,
       "C12 and reports that window's value, not the current one",
       [mid.value, seen["ALL"].value, interior.finalValue]);
    ok(mid.change && mid.change.indexOf("₹") !== -1,
       "C13 with the change across that window", mid.change);
  }

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
