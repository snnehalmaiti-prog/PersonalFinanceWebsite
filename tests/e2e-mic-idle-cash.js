// CASH FLOW · MONTHLY, "Idle Cash" view: it must read out a hovered month the
// same way Net and By instrument do — in the panel under the stats row, not in a
// floating tooltip — and its legend must be selectable the same way By
// instrument's is.
//
// Idle Cash is a BALANCE, not a flow, so the resting state is the latest month
// with a balance rather than a sum over the period: adding up twelve month-end
// balances would state a number that was never held.
//
// NOT picked up by run-all.js: needs a static server and Playwright's Chromium.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-mic-idle-cash.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"];
const FI_HDR = ["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Amount"];

// Two parked-cash instruments with clearly different balances, so a legend
// selection changes a figure by an amount the test can name.
const SHEETS = {
  "wf-equity-data": [TXN, ["10-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  // Idle cash is read from the FD sheet only, and only from the two parked
  // sub-categories. Savings starts in February, the corpus in March, so the two
  // months differ in how many instruments they list.
  "wf-fd-data": [FD_HDR,
    ["1-Feb-2024", "Snnehal", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "400000", "", "3%"],
    ["1-Mar-2024", "Snnehal", "ICICI", "Corpus", "Fixed Income", "Investment Corpus", "Deposit", "100000", "", "3%"]],
  "wf-fixedincome-data": [FI_HDR],
};

const START = "2024-01-01", END = "2024-12-01";
function days() { const o = []; const d = new Date(START + "T00:00:00"), e = new Date(END + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; }
function navSeries() { return days().map((iso) => { const [y, m, dd] = iso.split("-");
  return { date: `${dd}-${m}-${y}`, nav: "10" }; }).reverse(); }
function idxPrices() { const o = {}; days().forEach((iso) => { o[iso] = 1000; }); return o; }

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1200 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: navSeries() }) }));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: { INF1: "100033" } }) }));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: { "100033": 10 } }) }));
  await p.route("**/stock_prices.json*", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: { NIFTY50: { prices: idxPrices() } } }) }));
  await p.route("**/stock_history.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stock_history: {} }) }));

  // Record every chart config by canvas, and keep the LAST one built in the
  // monthly-invest wrap — that is the one on screen.
  await p.addInitScript(() => {
    window.__micCfg = null;
    window.Chart = function (ctx, cfg) {
      const canvas = ctx && ctx.canvas ? ctx.canvas : ctx;
      this.data = cfg.data; this.options = cfg.options;
      this.scales = { x: {}, y: {} };
      this.canvas = canvas;
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.zoomScale = function () {}; this.resetZoom = function () {};
      this.getElementsAtEventForMode = function () { return []; };
      if (canvas && canvas.parentNode && canvas.parentNode.id === "monthly-invest-cat-wrap") {
        window.__micCfg = cfg; window.__micChart = this;
      }
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(9000);

  // Reference: what the FLOW views do, so "the same as Net and By instrument" is
  // measured against them rather than against a remembered description.
  const flow = await p.evaluate(() => {
    const cfg = window.__micCfg || {};
    return {
      tooltipOff: (((cfg.options || {}).plugins || {}).tooltip || {}).enabled === false,
      mode: ((cfg.options || {}).interaction || {}).mode,
      intersect: ((cfg.options || {}).interaction || {}).intersect,
      hasOnHover: typeof (cfg.options || {}).onHover === "function",
      splitHtml: (document.getElementById("mic-hover-split") || {}).innerHTML || "",
    };
  });
  ok(flow.tooltipOff && flow.hasOnHover && flow.mode === "index" && flow.intersect === false,
     "F1 the flow view reads out in the panel, with no floating tooltip", flow);
  ok(/mic-hs-row/.test(flow.splitHtml), "F2 and its panel is populated at rest", flow.splitHtml.slice(0, 80));

  // Switch to Idle Cash.
  await p.evaluate(() => document.getElementById("monthly-invest-cat-idle").click());
  await p.waitForTimeout(1200);

  const idle = await p.evaluate(() => {
    const cfg = window.__micCfg || {};
    const legend = document.getElementById("monthly-invest-cat-legend");
    return {
      active: document.getElementById("monthly-invest-cat-idle").classList.contains("active"),
      datasets: (cfg.data.datasets || []).map((d) => d.label),
      tooltipOff: (((cfg.options || {}).plugins || {}).tooltip || {}).enabled === false,
      mode: ((cfg.options || {}).interaction || {}).mode,
      intersect: ((cfg.options || {}).interaction || {}).intersect,
      hasOnHover: typeof (cfg.options || {}).onHover === "function",
      splitHtml: (document.getElementById("mic-hover-split") || {}).innerHTML || "",
      legendHtml: legend ? legend.innerHTML : "",
      clickable: legend ? legend.querySelectorAll("[data-mic-idle]").length : 0,
      roles: legend ? [...legend.querySelectorAll("[data-mic-idle]")].map((e) => e.getAttribute("role")) : [],
      tabindex: legend ? [...legend.querySelectorAll("[data-mic-idle]")].map((e) => e.getAttribute("tabindex")) : [],
    };
  });
  console.log("  idle " + JSON.stringify({ ds: idle.datasets, clickable: idle.clickable }));

  ok(idle.active, "I1 Idle Cash is the active view", idle.active);
  ok(idle.datasets.length === 2, "I2 both parked-cash instruments are plotted", idle.datasets);
  // Colour per instrument while everything is shown — the baseline L10 compares to.
  const idleColors = await p.evaluate(() => {
    const o = {};
    ((window.__micCfg || {}).data.datasets || []).forEach((d) => { o[d.label] = d.borderColor; });
    return o;
  });

  // — hover parity —
  ok(idle.tooltipOff, "H1 the floating tooltip is off, as in the flow views", idle.tooltipOff);
  ok(idle.hasOnHover && idle.mode === "index" && idle.intersect === false,
     "H2 and hovering picks the whole month column, as in the flow views", idle);
  ok(/mic-hs-row/.test(idle.splitHtml) && /mic-hs-cap/.test(idle.splitHtml),
     "H3 the panel under the stats row is populated at rest", idle.splitHtml.slice(0, 120));
  ok(/Latest/.test(idle.splitHtml),
     "H4 and names the latest month — a balance cannot be summed over a period", idle.splitHtml.slice(0, 120));

  // Drive onHover the way Chart.js does. The stub has no hit-testing, so the
  // element list is supplied; what is under test is the readout.
  const hoverAt = (i) => p.evaluate((idx) => {
    const cfg = window.__micCfg;
    cfg.options.onHover({}, idx < 0 ? [] : [{ index: idx }], window.__micChart);
    return (document.getElementById("mic-hover-split") || {}).innerHTML || "";
  }, i);

  // Feb (index 1) has only Savings; Mar (index 2) has both.
  const feb = await hoverAt(1);
  const mar = await hoverAt(2);
  ok(/February 2024/.test(feb), "H5 hovering a month names that month", feb.slice(0, 100));
  ok(/March 2024/.test(mar) && mar !== feb, "H6 and a different month reads out differently", mar.slice(0, 100));
  ok((feb.match(/mic-hs-item/g) || []).length === 1,
     "H7 February lists only the instrument that had a balance then",
     (feb.match(/mic-hs-item/g) || []).length);
  ok((mar.match(/mic-hs-item/g) || []).length === 2,
     "H8 March lists both", (mar.match(/mic-hs-item/g) || []).length);
  ok(/Idle Cash/.test(mar) && /mic-hs-tot/.test(mar),
     "H9 and states the month's total in the same markup the flow views use", mar.slice(0, 160));

  // Leaving restores the resting state rather than stranding the last month.
  const left = await p.evaluate(() => {
    document.querySelector("#monthly-invest-cat-wrap canvas").dispatchEvent(new MouseEvent("mouseleave"));
    return (document.getElementById("mic-hover-split") || {}).innerHTML || "";
  });
  ok(/Latest/.test(left), "H10 leaving the chart restores the resting readout", left.slice(0, 100));

  // — legend parity —
  ok(idle.clickable === 2, "L1 every legend entry is clickable", idle.clickable);
  ok(idle.roles.every((r) => r === "button") && idle.tabindex.every((t) => t === "0"),
     "L2 and reachable by keyboard", [idle.roles, idle.tabindex]);
  ok(!/mic-legend-clear/.test(idle.legendHtml),
     "L3 with no Show all offered while everything is already shown", idle.legendHtml.slice(0, 80));

  // Select one instrument: the other's bars go, the stats follow, "Show all" appears.
  const before = await p.evaluate(() => (document.getElementById("monthly-invest-cat-stats") || {}).textContent);
  // Click the SECOND entry. Selecting the first would leave it in palette slot 0
  // either way, so a filtered-index colour bug would go unnoticed.
  await p.evaluate(() => {
    document.querySelectorAll("[data-mic-idle]")[1].click();
  });
  await p.waitForTimeout(900);
  const sel = await p.evaluate(() => {
    const cfg = window.__micCfg || {};
    const legend = document.getElementById("monthly-invest-cat-legend");
    return {
      datasets: (cfg.data.datasets || []).map((d) => d.label),
      dimmed: legend.querySelectorAll(".mic-legend-dimmed").length,
      pressed: [...legend.querySelectorAll("[data-mic-idle]")].map((e) => e.getAttribute("aria-pressed")),
      hasClear: !!legend.querySelector("[data-mic-idle-clear]"),
      stats: (document.getElementById("monthly-invest-cat-stats") || {}).textContent,
      splitHtml: (document.getElementById("mic-hover-split") || {}).innerHTML || "",
      colors: (cfg.data.datasets || []).map((d) => d.borderColor),
    };
  });
  console.log("  selected " + JSON.stringify({ ds: sel.datasets, dimmed: sel.dimmed }));

  ok(sel.datasets.length === 1, "L4 selecting one instrument plots only that one", sel.datasets);
  ok(sel.dimmed === 1, "L5 and dims the one that is off", sel.dimmed);
  ok(sel.pressed.filter((x) => x === "true").length === 1,
     "L6 and marks the selected one pressed", sel.pressed);
  ok(sel.hasClear, "L7 and offers Show all", sel.hasClear);
  ok(sel.stats !== before, "L8 the stats row follows the selection", [before, sel.stats]);
  ok((sel.splitHtml.match(/mic-hs-item/g) || []).length === 1,
     "L9 and so does the hover panel", (sel.splitHtml.match(/mic-hs-item/g) || []).length);

  // Colour stability. The instrument left showing must keep the colour it had
  // when both were on screen. Index-based palettes get this wrong by taking the
  // position in the FILTERED list, which hands the survivor the colour of the
  // instrument that was just switched off.
  ok(sel.colors[0] === idleColors[sel.datasets[0]],
     "L10 the instrument left showing keeps its own colour",
     [sel.datasets[0], sel.colors[0], idleColors]);

  // Show all restores everything.
  await p.evaluate(() => document.querySelector("[data-mic-idle-clear]").click());
  await p.waitForTimeout(900);
  const cleared = await p.evaluate(() => {
    const cfg = window.__micCfg || {};
    const legend = document.getElementById("monthly-invest-cat-legend");
    return { datasets: (cfg.data.datasets || []).map((d) => d.label),
             dimmed: legend.querySelectorAll(".mic-legend-dimmed").length,
             hasClear: !!legend.querySelector("[data-mic-idle-clear]") };
  });
  ok(cleared.datasets.length === 2 && cleared.dimmed === 0 && !cleared.hasClear,
     "L11 Show all brings every instrument back", cleared);

  // Keyboard toggles too.
  await p.evaluate(() => {
    const el = document.querySelector("[data-mic-idle]");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await p.waitForTimeout(900);
  const kb = await p.evaluate(() => ((window.__micCfg || {}).data.datasets || []).length);
  ok(kb === 1, "L12 Enter toggles an instrument the same way a click does", kb);

  // Switching back to a flow view must not carry the idle selection across, and
  // must leave the flow view's own panel — not a stale idle one — on screen.
  await p.evaluate(() => document.getElementById("monthly-invest-cat-split").click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById("monthly-invest-cat-idle").click());
  await p.waitForTimeout(1200);
  const back = await p.evaluate(() => ({
    datasets: ((window.__micCfg || {}).data.datasets || []).map((d) => d.label),
    hasClear: !!document.querySelector("[data-mic-idle-clear]"),
  }));
  ok(back.datasets.length === 2 && !back.hasClear,
     "L13 leaving and re-entering Idle Cash starts from every instrument shown", back);

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
