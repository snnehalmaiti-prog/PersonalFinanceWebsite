// The zoom-following readouts on BOTH value charts.
//
// Each already zoomed (wheel/pinch/drag), but the figures beside the title always
// showed the whole-period values, so zooming told you the SHAPE of a period without
// telling you its numbers. Both readouts now follow the visible window: the value
// at its right edge and the change across it, reverting to the full-period figures
// when zoomed back out.
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
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status:200, contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body:"[]" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status:200, contentType:"text/css", body:"" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill({ status:200, contentType:"application/json", headers:{"access-control-allow-origin":"*"}, body: JSON.stringify({ data: navSeries() }) }));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill({ status:200, contentType:"application/json", body: JSON.stringify({fetchedAt:1,data:{INF1:"100033"}}) }));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill({ status:200, contentType:"application/json", body: JSON.stringify({fetchedAt:1,data:{"100033":30}}) }));
  // Chart.js cannot load here (no CDN), so model just enough of it: an x scale with
  // min/max, plus the zoom plugin's zoomScale/resetZoom. Both charts share the stub.
  await p.addInitScript(() => {
    window.Chart = function (ctx, cfg) {
      const self = this;
      const pts = ((cfg.data.datasets || [])[0] || {}).data || [];
      const lim = ((((cfg.options || {}).plugins || {}).zoom || {}).limits || {}).x || {};
      self.data = cfg.data; self.options = cfg.options;
      self.scales = { x: { min: lim.min, max: lim.max }, y: {} };
      // The Growth chart sets its window through options.scales.x.min/max + update(),
      // the Account Value chart through zoomScale; support both.
      const optX = (((cfg.options || {}).scales || {}).x) || {};
      if (self.scales.x.min == null) self.scales.x.min = optX.min;
      if (self.scales.x.max == null) self.scales.x.max = optX.max;
      const baseMin = self.scales.x.min, baseMax = self.scales.x.max;
      self.zoomScale = function (id, range) { self.scales.x.min = range.min; self.scales.x.max = range.max; };
      self.resetZoom = function () { self.scales.x.min = baseMin; self.scales.x.max = baseMax; };
      self.update = function () {
        if (optX.min != null) self.scales.x.min = self.options.scales.x.min;
        if (optX.max != null) self.scales.x.max = self.options.scales.x.max;
      };
      self.destroy = function () {}; self.resize = function () {};
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
  const readGrowth = () => p.evaluate(() => {
    const ch = window.__wfValueChart;
    const sc = ch && ch.scales && ch.scales.x;
    const ce = document.getElementById("avc-range-change");
    return {
      eyebrow: (document.getElementById("avc-eyebrow")||{}).textContent,
      port: (document.getElementById("avc-portfolio-value")||{}).textContent,
      idx: (document.getElementById("avc-index-value")||{}).textContent,
      change: ce && !ce.hidden ? ce.textContent : null,
      spanDays: sc && isFinite(sc.min) && isFinite(sc.max) ? Math.round((sc.max - sc.min) / 864e5) : null,
    };
  });
  const read = () => p.evaluate(() => {
    const ch = window.__wfPortfolioValueChart;
    const sc = ch && ch.scales && ch.scales.x;
    return {
      name: (document.getElementById("pvc-legend-name")||{}).textContent,
      value: (document.getElementById("pvc-current-value")||{}).textContent,
      change: (() => { const e = document.getElementById("pvc-range-change"); return e && !e.hidden ? e.textContent : null; })(),
      spanDays: sc ? Math.round((sc.max - sc.min) / 864e5) : null,
    };
  });
  const initial = await read();
  console.log("  initial " + JSON.stringify(initial));
  ok(initial.spanDays > 0, "A1 the chart rendered with an x range", initial);
  ok(initial.name === "Current Value", "A2 unzoomed, the readout is the current value", initial.name);
  ok(initial.change === null, "A3 and shows no change — there is no window to compare", initial.change);

  // Zoom the Account Value chart to an interior window — what a wheel-zoom or a
  // drag-pan produces. Every whole-period readout looks identical at the right edge,
  // so only a window that does NOT end at today can tell a window-aware readout from
  // one that merely prints the final figure.
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

  await zoomTo("__wfPortfolioValueChart", "2024-05-01", "2024-06-01");
  await p.waitForTimeout(200);
  const pvcMid = await read();
  console.log("  account-value interior " + JSON.stringify(pvcMid));
  ok(/Jun 2024/.test(pvcMid.name || ""),
     "B1 Account Value: an interior window names the month it ends in", pvcMid.name);
  ok(pvcMid.value !== initial.value,
     "B2 Account Value: and reports that window's value, not today's", [pvcMid.value, initial.value]);
  {
    const m = pctOf(pvcMid.change);
    const want = (Math.pow(DAILY, pvcMid.spanDays) - 1) * 100;
    ok(m && Math.abs(parseFloat(m[2]) - want) < 0.05,
       "B3 Account Value: the change matches " + DAILY + "^" + pvcMid.spanDays + " = " + want.toFixed(2) + "%",
       pvcMid.change);
  }

  await p.evaluate(() => document.getElementById("portfolio-value-chart").ondblclick());
  await p.waitForTimeout(200);
  const pvcReset = await read();
  ok(pvcReset.name === "Current Value" && pvcReset.change === null,
     "B4 Account Value: double-click restores the whole-period readout", pvcReset);
  ok(pvcReset.spanDays === initial.spanDays, "B5 and the full range", [pvcReset.spanDays, initial.spanDays]);

  // The Growth chart must behave the same way.
  const growth0 = await readGrowth();
  console.log("  growth full     " + JSON.stringify(growth0));
  ok(/SINCE/.test(growth0.eyebrow || ""), "C1 Growth: unzoomed the eyebrow reads SINCE <year>", growth0.eyebrow);
  ok(growth0.change === null, "C2 Growth: and shows no window change", growth0.change);
  ok(growth0.spanDays > 0, "C3 Growth: the chart has an x range", growth0);

  const zoomed = await zoomTo("__wfValueChart", "2024-05-01", "2024-06-01");
  if (zoomed) {
    await p.waitForTimeout(200);
    const g = await readGrowth();
    console.log("  growth interior " + JSON.stringify(g));
    ok(/TO JUN 2024/i.test(g.eyebrow || ""),
       "C4 Growth: zoomed, the eyebrow names the window's end month", g.eyebrow);
    ok(g.port !== growth0.port,
       "C5 Growth: the portfolio figure follows the window", [g.port, growth0.port]);
    ok(g.change && /%/.test(g.change), "C6 Growth: and the window's change is shown", g.change);
    ok(g.spanDays === 31, "C7 Growth: the window is the one that was asked for", g.spanDays);

    await p.evaluate(() => document.getElementById("value-chart").ondblclick());
    await p.waitForTimeout(200);
    const gReset = await readGrowth();
    ok(/SINCE/.test(gReset.eyebrow || "") && gReset.change === null,
       "C8 Growth: double-click restores the whole-period readout", gReset);
    ok(gReset.port === growth0.port, "C9 and the whole-period figure", [gReset.port, growth0.port]);
  } else {
    ok(false, "C4 Growth: the chart was built");
  }

  // The pills are gone; nothing should be left behind in the markup.
  const strayPills = await p.evaluate(() => document.querySelectorAll("[data-pvc-range]").length);
  ok(strayPills === 0, "D1 the Account Value range pills are removed", strayPills);

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
