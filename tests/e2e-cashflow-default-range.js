// Income & Expenses · MONTHLY opens on the current year, not All time.
//
// With several years of history the All-time view compressed this year's bars to
// slivers, and the months anyone is actually reconciling are the recent ones.
//
// The fixture spans the current year AND the two before it, so "current year",
// "latest year with records" and "all time" produce three different month counts
// — an assertion that only counted bars would pass on the wrong one otherwise.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-cashflow-default-range.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const NOW = new Date();
const THIS_YEAR = NOW.getFullYear();
const PREV_YEAR = THIS_YEAR - 1;
const OLD_YEAR = THIS_YEAR - 2;

// One income + one expense record in each of three months per year, so a year
// view is 3 bars wide and All time is 9 — different enough that a bar count
// tells them apart.
const MONTHS = ["01", "02", "03"];
const rec = (y, m, i) => ([
  { id: `${y}${m}i`, txn_date: `${y}-${m}-05`, amount: 50000, type: "income",  category: "Salary",  account_id: "a1" },
  { id: `${y}${m}e`, txn_date: `${y}-${m}-15`, amount: 20000, type: "expense", category: "Grocery", account_id: "a1" },
]);
const RECORDS = [OLD_YEAR, PREV_YEAR, THIS_YEAR].flatMap((y) => MONTHS.flatMap((m) => rec(y, m)));

// All time plots the months that actually carry records rather than filling the
// gaps between them, so it is 3 years x 3 months, not 27.
const ALLTIME_MONTHS = 3 * MONTHS.length;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: {} })));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: {} })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: {} })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  // Capture what the bar chart was actually given, per construction.
  await p.addInitScript(() => {
    window.__charts = [];
    window.Chart = function (ctx, cfg) {
      this.canvas = ctx && ctx.canvas ? ctx.canvas : ctx;
      const id = (this.canvas && this.canvas.id) || "";
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      window.__charts.push({ id, labels: (cfg.data && cfg.data.labels) || [] });
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate(([s, records]) => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
    localStorage.setItem("wf-exp-records-cache", JSON.stringify(records));
  }, [SHEETS, RECORDS]);

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(6000);

  // Feed the records the way the expense tab does, then render the card.
  await p.evaluate((records) => {
    window.dashExpState = window.dashExpState || {};
    window.dashExpState.records = records;
    if (window.renderMonthlyCashFlow) window.renderMonthlyCashFlow();
  }, RECORDS);
  await p.waitForTimeout(1200);

  const read = () => p.evaluate(() => {
    const sel = document.getElementById("mcf-year");
    const btn = document.getElementById("mcf-alltime");
    const last = (window.__charts || []).filter((c) => c.id === "mcf-chart").pop()
              || (window.__charts || []).pop();
    return {
      yearValue: sel ? sel.value : null,
      // The native select is permanently hidden now that the decade-grid picker
      // drives it; the button beside it is the visible control.
      yearVisible: (() => {
        const btn = sel && sel.nextElementSibling;
        if (btn && btn.classList.contains("wf-yp-btn")) return getComputedStyle(btn).display !== "none";
        return sel ? getComputedStyle(sel).display !== "none" : null;
      })(),
      allTimeActive: btn ? btn.classList.contains("active") : null,
      labels: last ? last.labels : null,
      count: last && last.labels ? last.labels.length : 0,
    };
  });

  const initial = await read();
  console.log("  initial: " + JSON.stringify(initial));

  ok(initial.allTimeActive === false,
     "D1 the card does not open on All time", initial.allTimeActive);
  ok(initial.yearVisible === true,
     "D2 the year selector is shown, not hidden behind All time", initial.yearVisible);
  ok(initial.yearValue === String(THIS_YEAR),
     "D3 and is set to the current year", { got: initial.yearValue, want: String(THIS_YEAR) });
  // 3 bars, not 9 — this is what distinguishes a year view from All time.
  ok(initial.count === MONTHS.length,
     "D4 the chart plots only the current year's months",
     { got: initial.count, wantYear: MONTHS.length, wantAllTime: ALLTIME_MONTHS });
  ok((initial.labels || []).every((l) => !new RegExp(String(PREV_YEAR)).test(String(l))),
     "D5 and no earlier year leaks into the labels", initial.labels);

  // All time must still be reachable, and must genuinely differ.
  await p.evaluate(() => { const b = document.getElementById("mcf-alltime"); if (b) b.click(); });
  await p.waitForTimeout(800);
  const allTime = await read();
  console.log("  after All time: " + JSON.stringify({ ...allTime, labels: undefined }));

  ok(allTime.allTimeActive === true && allTime.yearVisible === false,
     "D6 All time is still one click away", allTime);
  ok(allTime.count > initial.count,
     "D7 and shows strictly more months — otherwise D4 proved nothing",
     { allTime: allTime.count, year: initial.count });

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
