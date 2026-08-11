// The Overview's portfolio picker is the same control the holdings cards use.
//
// It used to be a dropdown — a button reading "All Portfolios" that opened a
// listbox — while every holdings card picked a portfolio with segmented pills.
// Two controls for one job, in one app. This is the pills, and the assertions
// are of two kinds:
//
//   size   — measured against #mfh-portfolio-toggle with BOTH on screen, so
//            "same size" is a comparison and not a number copied into a fixture.
//            The Investments tab has to be opened first: a card inside a hidden
//            panel measures 0×0, and 0 === 0 would pass while proving nothing.
//   wiring — the pills actually drive the selection. A control that looks right
//            and filters nothing is worse than the dropdown it replaced.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-overview-portfolio-pills.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
// Two portfolios of different sizes: switching between them has to move the
// Overview's total, which is how the wiring is checked.
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
const num = (t) => Number(String(t || "").replace(/[^0-9.]/g, "")) || 0;

const SHAPE = (sel) => {
  const box = document.querySelector(sel);
  if (!box) return null;
  const btns = [...box.querySelectorAll("button")];
  if (!btns.length) return null;
  const bcs = getComputedStyle(box), br = box.getBoundingClientRect();
  const b0 = btns[0], cs = getComputedStyle(b0), r = b0.getBoundingClientRect();
  return {
    boxH: Math.round(br.height), boxRadius: bcs.borderRadius, boxPad: bcs.padding,
    boxBorder: bcs.borderWidth, btnH: Math.round(r.height), fs: cs.fontSize,
    pad: cs.padding, weight: cs.fontWeight, transform: cs.textTransform,
    labels: btns.map((b) => b.textContent.trim()),
  };
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
  await p.waitForTimeout(9000);

  // ── The dropdown is gone, not merely hidden ────────────────────────────────
  const legacy = await p.evaluate(() => ({
    toggle: !!document.getElementById("portfolio-toggle"),
    menu: !!document.getElementById("portfolio-menu"),
    label: !!document.getElementById("portfolio-label"),
    pills: !!document.getElementById("portfolio-pills"),
  }));
  ok(!legacy.toggle && !legacy.menu && !legacy.label,
     "L1 the old dropdown, its menu and its label are removed rather than left " +
     "in the page unused", legacy);
  ok(legacy.pills, "L2 and the pills are there in their place", legacy);

  // ── Size, against the real thing ───────────────────────────────────────────
  const ovHidden = await p.evaluate(SHAPE, "#portfolio-pills");
  ok(ovHidden && ovHidden.labels.length >= 3,
     "S1 the Overview pills carry All plus every portfolio", ovHidden && ovHidden.labels);

  // Open Investments so the Mutual Fund Holding card is actually laid out.
  await p.evaluate(() => {
    const t = [...document.querySelectorAll("[data-tab], .settings-tab, nav a, button")]
      .find((e) => /investment/i.test(e.textContent || "") ||
                   /investment/i.test(e.getAttribute("data-tab") || ""));
    if (t) t.click();
  });
  await p.waitForTimeout(4000);

  const mfh = await p.evaluate(SHAPE, "#mfh-portfolio-toggle");
  ok(mfh && mfh.btnH > 0,
     "S2 the Mutual Fund Holding pills are on screen and measurable — a hidden " +
     "card measures 0 and would make every comparison below vacuous", mfh);

  if (mfh && mfh.btnH > 0) {
    // Back to Overview and measure ours with the page in the same state.
    await p.evaluate(() => {
      const t = [...document.querySelectorAll("[data-tab], .settings-tab, nav a, button")]
        .find((e) => /overview/i.test(e.textContent || "") ||
                     /overview/i.test(e.getAttribute("data-tab") || ""));
      if (t) t.click();
    });
    await p.waitForTimeout(3000);
    const ov = await p.evaluate(SHAPE, "#portfolio-pills");
    console.log("  overview: " + JSON.stringify(ov));
    console.log("  mfh:      " + JSON.stringify(mfh));

    eq(ov.btnH, mfh.btnH, "S3 same pill height");
    eq(ov.fs, mfh.fs, "S4 same text size");
    eq(ov.pad, mfh.pad, "S5 same padding");
    eq(ov.weight, mfh.weight, "S6 same weight");
    eq(ov.transform, mfh.transform, "S7 same casing");
    eq(ov.boxH, mfh.boxH, "S8 same overall height");
    eq(ov.boxRadius, mfh.boxRadius, "S9 same corner radius");
    eq(ov.boxPad, mfh.boxPad, "S10 same track padding");
    eq(ov.boxBorder, mfh.boxBorder, "S11 same border");
    eq(JSON.stringify(ov.labels), JSON.stringify(mfh.labels),
       "S12 and the same portfolios, named the same way",
       { overview: ov.labels, mfh: mfh.labels });
  }

  // ── Wiring: the pills select, and the Overview follows ─────────────────────
  const readTotal = () => p.evaluate(() =>
    (document.getElementById("overview-total-current-value") || {}).textContent);
  const press = async (name) => {
    await p.evaluate((n) => {
      const b = document.querySelector('#portfolio-pills [data-ov-portfolio="' + n + '"]');
      if (b) b.click();
    }, name);
    await p.waitForTimeout(3000);
    return {
      total: num(await readTotal()),
      stored: await p.evaluate(() => localStorage.getItem("wf-selected-portfolio")),
      active: await p.evaluate(() => [...document.querySelectorAll("#portfolio-pills button")]
        .filter((b) => b.classList.contains("active"))
        .map((b) => b.getAttribute("data-ov-portfolio"))),
    };
  };

  const all = await press("all");
  const sn = await press("Snnehal");
  const tr = await press("Trisha");
  console.log("  totals: " + JSON.stringify({ all: all.total, sn: sn.total, tr: tr.total }));

  eq(sn.stored, "Snnehal", "W1 pressing a pill stores that portfolio");
  eq(JSON.stringify(sn.active), JSON.stringify(["Snnehal"]),
     "W2 and exactly one pill reads as active", sn.active);
  ok(sn.total > 0 && tr.total > 0 && sn.total !== tr.total,
     "W3 the Overview total actually changes between portfolios — a picker that " +
     "looks right and filters nothing is worse than the dropdown it replaced",
     { snnehal: sn.total, trisha: tr.total });
  // Snnehal holds 5x Trisha, and together they are the household.
  ok(Math.abs(all.total - (sn.total + tr.total)) <= 2,
     "W4 and All is the two of them together", { all: all.total, sum: sn.total + tr.total });
  ok(sn.total > tr.total,
     "W5 with the larger portfolio reading larger — the pills are not swapped",
     { snnehal: sn.total, trisha: tr.total });

  // The selection has to survive a reload, as the dropdown's did.
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(9000);
  const afterReload = await p.evaluate(() =>
    [...document.querySelectorAll("#portfolio-pills button")]
      .filter((b) => b.classList.contains("active"))
      .map((b) => b.getAttribute("data-ov-portfolio")));
  eq(JSON.stringify(afterReload), JSON.stringify(["Trisha"]),
     "W6 and the choice survives a reload", afterReload);

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
