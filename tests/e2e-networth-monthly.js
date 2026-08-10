// Net Worth · Monthly — the card that reads snapshots back.
//
// Seeded with fixed snapshot rows and fixed transactions, so every figure on
// screen has a known right answer. The attribution is the point: Δ net worth =
// contributions + market, and the contributions half comes from the sheets
// while the change comes from the stored rows. If either leg is wired to the
// wrong source the arithmetic stops reconciling, which is what these assert.
//
// Also asserts the honesty of the display: a reconstructed month has to look
// different from a recorded one, or the card claims more than it knows.
//
//     python3 -m http.server 8097 &
//     node tests/e2e-networth-monthly.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8097;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];

// Two buys, in two different months, at known amounts. These are the
// "contributions" leg of every attribution below.
const JUN_BUY = 100 * 500;    // 50,000 in Jun 2025
const JUL_BUY = 100 * 300;    // 30,000 in Jul 2025

const SHEETS = {
  "wf-equity-data": [TXN,
    ["10-Jun-2025", "Snnehal", "Aurora Fund", "Buy", "100", "500"],
    ["10-Jul-2025", "Snnehal", "Aurora Fund", "Buy", "100", "300"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Aurora Fund", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  // Savings balances: running snapshots, ₹2L at end-May rising to ₹2.5L in Jul.
  // The Jul rise is money moved, not money earned — the case that used to be
  // attributed to the market.
  "wf-fd-data": [FD_HDR,
    ["31-May-2025", "Snnehal", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "200000", "", "12%", ""],
    ["10-Jul-2025", "Snnehal", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "250000", "", "12%", ""],
    // A second savings account, opened long before the window and never changed,
    // paying 12%. Its balance contributes nothing (it does not move), but it
    // WOULD accrue visibly if savings interest were counted as interest — which
    // it must not be, since a typed balance already contains it.
    ["1-Jan-2024", "Snnehal", "SBI", "Savings Two", "Fixed Income", "Savings Account", "Deposit", "500000", "", "12%", ""],
    // A term deposit opened well before the window, so it accrues through both
    // months with no principal movement — pure interest, which must not be
    // reported as the market.
    ["1-Jan-2020", "Snnehal", "HDFC", "Deposit One", "Fixed Income", "Fixed Deposit", "Deposit", "1000000", "1-Jan-2030", "8%", ""],
    // And one opened DURING the window. Its ₹1,00,000 principal is a
    // contribution; counting it as interest because it appeared between two
    // valuations is the mistake the open-date filter exists to prevent.
    ["10-Jul-2025", "Snnehal", "ICICI", "Deposit Two", "Fixed Income", "Fixed Deposit", "Deposit", "100000", "1-Jul-2030", "8%", ""]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

// May → Jun → Jul. May is a reconstruction; the other two are records.
const SNAPSHOTS = [
  // Two years, so the year picker has something to choose between. The 2024
  // rows are what a wrong filter drops or a broken one leaks.
  { snapshot_date: "2024-11-30", total: 800000, meta: { source: "backfill", backfilled: true } },
  { snapshot_date: "2024-12-31", total: 850000, meta: { source: "backfill", backfilled: true } },
  { snapshot_date: "2025-05-31", total: 1000000, meta: { source: "backfill", backfilled: true } },
  { snapshot_date: "2025-06-30", total: 1200000, equity: 900000, fixed_income: 300000, commodity: 0,
    by_portfolio: { Snnehal: { equity: 900000, fixed_income: 300000, commodity: 0 } },
    meta: { source: "live" } },
  { snapshot_date: "2025-07-31", total: 1150000, equity: 850000, fixed_income: 300000, commodity: 0,
    by_portfolio: { Snnehal: { equity: 850000, fixed_income: 300000, commodity: 0 } },
    meta: { source: "live" } },
];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const eq = (a, b, name) => ok(a === b, name, { got: a, want: b });
// "+₹50,000" / "−₹1,40,000" → signed number. The minus is U+2212, not a hyphen.
const money = (t) => {
  const s = String(t || "");
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!isFinite(n) || !s.replace(/[^0-9]/g, "")) return null;
  return /[−-]/.test(s) ? -n : n;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1400 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  let snapshotRows = SNAPSHOTS;
  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

  await p.route("**://*.supabase.co/**", (r) => {
    const req = r.request();
    if (/net_worth_snapshots/.test(req.url())) {
      if (req.method() === "POST") return r.fulfill({ status: 201, contentType: "application/json",
        headers: { "access-control-allow-origin": "*" }, body: "[]" });
      return r.fulfill(j(snapshotRows));
    }
    return r.fulfill(j([]));
  });
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://*.currency-api.pages.dev/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: {} })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: "01-Aug-2025", nav: "600" } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.type = cfg.type; this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  const load = async () => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate((s) => { localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
    errs.length = 0;
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    // Any of the three end states: a chart, the explanatory status, or a count
    // with no chart (one snapshot). Waiting only on the chart stalls the full
    // timeout on the cases that correctly draw nothing.
    await p.waitForFunction(() => !!window.__wfNwmChart ||
      (document.getElementById("nwm-status") && !document.getElementById("nwm-status").hidden) ||
      ((document.getElementById("nwm-count") || {}).textContent || "").length > 0,
      null, { timeout: 25000 }).catch(() => {});
    await p.waitForTimeout(1500);
  };

  // The card is the chart — there is no row list — so everything is read off the
  // Chart config the page actually built, plus the tooltip callbacks it wired,
  // which are the only place the stored totals surface to a reader.
  const readChart = () => p.evaluate(() => {
    const c = window.__wfNwmChart;
    if (!c) return null;
    return {
      type: c.type,
      labels: c.data.labels,
      sets: c.data.datasets.map((d) => ({ label: d.label, data: d.data, stack: d.stack,
        colors: d.backgroundColor })),
      xStacked: !!(c.options.scales.x && c.options.scales.x.stacked),
      yStacked: !!(c.options.scales.y && c.options.scales.y.stacked),
      interaction: c.options.interaction || null,
      tooltipEnabled: !!(c.options.plugins.tooltip && c.options.plugins.tooltip.enabled),
      hasOnHover: typeof c.options.onHover === "function",
    };
  });

  const readStats = () => p.evaluate(() => {
    const out = {};
    document.querySelectorAll("#nwm-stats .mic-stat").forEach((el) => {
      out[(el.querySelector(".mic-stat-label") || {}).textContent] =
        (el.querySelector(".mic-stat-value") || {}).textContent;
    });
    return out;
  });

  const num = (s) => {
    const n = Number(String(s).replace(/[^0-9.]/g, ""));
    return /−/.test(String(s)) ? -n : n;
  };

  // Hovering is what surfaces a month's figures now, so the test drives the
  // handler Chart.js would call and reads the header it updates. Passing an
  // empty list is the "cursor left the chart" case.
  const hover = async (monthLabel) => {
    await p.evaluate((m) => {
      const c = window.__wfNwmChart;
      const i = m == null ? -1 : c.data.labels.indexOf(m);
      c.options.onHover({}, i < 0 ? [] : [{ index: i, datasetIndex: 0 }], c);
    }, monthLabel);
    return readStats();
  };

  await load();
  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  const chart = await readChart();
  console.log("  chart: " + JSON.stringify(chart));
  ok(!!chart, "N0 the card draws a chart");

  // The card opens on a year, so this is 2025's three comparable months — the
  // 2024 rows are in the data and excluded by the filter (asserted under Y).
  eq(chart.labels.join(","), "May 2025,Jun 2025,Jul 2025",
     "N1 one bar per comparable month in the selected year, oldest on the left");

  // No tooltip at all: the figures go to the header, where they hold still.
  ok(!chart.tooltipEnabled && chart.hasOnHover,
     "N2 hovering updates the header rather than opening a tooltip", chart);

  // Hovering a month replaces the period's five figures with that month's, in
  // the same five slots — the header must not change shape as the cursor moves.
  const julH = await hover("Jul 2025");
  console.log("  hover Jul: " + JSON.stringify(julH));
  eq(Object.keys(julH).join(","), "Opening,Closing,Invested,Interest,Market loss",
     "N3 the same five labels, so the header keeps its shape");
  // Totals are net of parked cash: Jun's ₹12,00,000 less the ₹7,00,000 held in
  // the two savings accounts, Jul's ₹11,50,000 less ₹7,50,000 after the ₹50,000
  // moved in. That move is why the card excludes cash — it changed nothing.
  eq(julH.Opening, "₹5,00,000",
     "N4 opening is the previous month's stored total, net of parked cash");
  eq(julH.Closing, "₹4,00,000", "N5 closing is this month's, on the same basis");
  ok(/^\+₹1,30,000$/.test(julH.Invested),
     "N8 contributions are the fund buy and the new deposit — NOT the ₹50,000 that " +
     "merely moved into savings", julH.Invested);
  ok(/^\+₹1[0-9],[0-9]{3}$/.test(julH.Interest),
     "N9 deposit interest is named rather than credited to the market", julH.Interest);
  ok(/^−₹2,4[0-9],[0-9]{3}$/.test(julH["Market loss"]),
     "N9c and the market is what is left: down 50k after putting in 1.8L and earning " +
     "10k of interest means prices took 2.4L", julH["Market loss"]);

  const junH = await hover("Jun 2025");
  eq(junH.Opening, "₹3,00,000", "N10 an up month, measured from May's close");
  ok(/^\+₹1,3[0-9],[0-9]{3}$/.test(junH["Market gain"]),
     "N11 a gaining month is labelled a gain", junH);

  const scope = () => p.evaluate(() => (document.getElementById("nwm-scope") || {}).textContent || "");
  await hover("Jun 2025");
  ok(/Jun 2025/.test(await scope()),
     "N12 the header names the month it is describing");
  ok(/reconstructed/i.test(await scope()),
     "N15 and says when that month is measured from a reconstruction");
  await hover("Jul 2025");
  ok(!/reconstructed/i.test(await scope()),
     "N16 while a change between two recorded months carries no such caveat");

  // Leaving the chart restores the period's own totals.
  const back = await hover(null);
  eq(back.Opening, "₹3,50,000",
     "N17 moving off the chart puts the period's figures back", back);
  eq(await scope(), "2025", "N18 and the header names the period again");

  // ── The stacked bars ────────────────────────────────────────────────────
  // Read off the Chart config the page actually built, so the bars are asserted
  // to carry real numbers rather than merely to exist.
  if (chart) {
    eq(chart.type, "bar", "B2 bars, not a line — a second net-worth line would just " +
       "restate the Account Value chart");
    ok(chart.xStacked && chart.yStacked, "B3 stacked on both axes, so a bar's extent is the month's change");

    // Hover behaviour: the whole month, from anywhere in its column.
    ok(chart.interaction && chart.interaction.mode === "index" &&
       chart.interaction.intersect === false,
       "B3a hovering picks the month, not the individual segment — at 150 months a " +
       "bar is a few pixels wide and intersect made the tooltip unreachable",
       chart.interaction);
    ok(!chart.tooltipEnabled,
       "B3b with no tooltip — the column's figures go to the header instead");
    eq(chart.sets.length, 3, "B4 three segments and no category split");
    eq(chart.sets.map((s) => s.label).join(","), "Invested,Interest,Market",
       "B5 the three things that move net worth");
    ok(chart.sets.every((s) => s.stack === chart.sets[0].stack), "B6 in one stack");

    // Only months with a change get a bar; May has nothing to compare against.
    eq(chart.labels.join(","), "May 2025,Jun 2025,Jul 2025",
       "B7 the selected year's months, oldest on the left");
    const at = (m) => chart.labels.indexOf(m);
    const seg = (name) => chart.sets.find((s) => s.label === name);
    eq(seg("Invested").data[at("Jun 2025")], 50000,
       "B8 the invested segment carries the fund buy");
    eq(seg("Invested").data[at("Jul 2025")], 130000,
       "B9 and in Jul the buy and the new deposit's principal — not the savings move");

    // The ₹10L deposit at 8% accrues roughly ₹10,300 a month. Bounded rather
    // than pinned: the accrual runs to "now", so an exact figure would drift
    // with the date the suite happens to run.
    const int = seg("Interest").data;
    // Bounded, not pinned: accrual runs to "now", so an exact figure would drift
    // with the date the suite runs. The ceiling is what does the work — the
    // savings account pays 12% here, so if its interest were counted as well
    // (it is already inside the parked-cash flow) the figure would clear it.
    // Bounded on the single-month gaps only. May's row spans Jan–May (there is no
    // snapshot between Dec 2024 and it), so its accrual is five months' worth —
    // correct, and a reason not to bound every bar the same way.
    ["Jun 2025", "Jul 2025"].forEach((m) => {
      ok(int[at(m)] > 8000 && int[at(m)] < 12000,
         "B11a " + m + ": the deposit's accrual is measured, and only the deposits'", int[at(m)]);
    });
    ok(int[at("May 2025")] > 4 * 8000,
       "B11a-gap May spans five months with no snapshot, so it carries five months of accrual",
       int[at("May 2025")]);

    // The invariant that matters: the segments are the change, exactly. If any
    // leg is double-counted or dropped, this is what catches it.
    const inv = seg("Invested").data, mkt = seg("Market").data;
    const deltas = { "May 2025": -50000, "Jun 2025": 200000, "Jul 2025": -100000 };
    Object.keys(deltas).forEach((m) => {
      const i = at(m);
      const sum = inv[i] + int[i] + mkt[i];
      ok(Math.abs(sum - deltas[m]) < 1,
         "B11b " + m + ": invested + interest + market equals the month's change",
         { sum, want: deltas[m], inv: inv[i], int: int[i], mkt: mkt[i] });
    });
    ok(mkt[at("Jun 2025")] > 0 && mkt[at("Jul 2025")] < 0,
       "B11c the market leg keeps its sign — a gaining month and a losing one", mkt);

    // A losing month must not be drawn in the gaining colour. Asserted against
    // the specific hues, not merely "the two differ" — Jun is faded and Jul is
    // not, so a difference exists even when both are green.
    const UP = "16,185,129";   // #10B981
    ok(String(seg("Market").colors[at("Jun 2025")]).includes(UP),
       "B12 the gaining month is drawn in the gain colour", seg("Market").colors[at("Jun 2025")]);
    ok(String(seg("Market").colors[at("Jul 2025")]).toUpperCase() === "#E8623A",
       "B12b and the losing month in the loss colour", seg("Market").colors[at("Jul 2025")]);
    ok(!String(seg("Market").colors[at("Jul 2025")]).includes(UP),
       "B12c specifically, a loss is never drawn as a gain", seg("Market").colors);
    // Jun is measured from May, a reconstruction, so it is faded; Jul is measured
    // from Jun and both are records, so it is solid.
    ok(/rgba/.test(String(seg("Invested").colors[at("Jun 2025")])) &&
       !/rgba/.test(String(seg("Invested").colors[at("Jul 2025")])),
       "B13 a month measured from a reconstruction is faded, while a fully recorded one is solid",
       seg("Invested").colors);
  }

  // ── The header figures ──────────────────────────────────────────────────
  // Five numbers for the period on show. Opening is the close of the month
  // BEFORE the first bar, which is what makes the row reconcile: everything
  // that happened in the period, applied to what it started with, is what it
  // ended with.
  const stats = await readStats();
  console.log("  stats: " + JSON.stringify(stats));
  eq(Object.keys(stats).join(","), "Opening,Closing,Invested,Interest,Market loss",
     "H1 exactly the five figures asked for, and no others");

  // 2025 on show: May, Jun, Jul. Opening is Dec 2024's close (₹8,50,000), since
  // that is what May was measured against — NOT May's own total.
  eq(stats.Opening, "₹3,50,000",
     "H2 opening is the close of the month before the first bar");
  eq(stats.Closing, "₹4,00,000", "H3 closing is the newest month's stored total");

  ok(Math.abs((num(stats.Opening) + num(stats.Invested) + num(stats.Interest) +
               num(stats["Market loss"])) - num(stats.Closing)) < 1,
     "H4 and the five reconcile: opening + invested + interest + market = closing",
     stats);

  // A negative market is labelled as a loss, not a negative gain.
  ok(/^−/.test(stats["Market loss"]),
     "H5 the market figure is signed", stats["Market loss"]);

  // ── Parked cash is out of the card entirely ─────────────────────────────
  // Out of the totals as well as the contributions. Out of one side only, the
  // ₹50,000 moved into savings in July would resurface in Market as a price
  // movement that never happened.
  const julSum = num(julH.Opening) + num(julH.Invested) + num(julH.Interest) +
                 num(julH["Market loss"]);
  ok(Math.abs(julSum - num(julH.Closing)) < 1,
     "K1 a hovered month's five figures reconcile on the cash-excluded basis",
     { julH, julSum });
  const note = await p.evaluate(() => {
    const el = document.getElementById("nwm-note");
    return { hidden: el.hidden, text: el.textContent };
  });
  ok(!note.hidden && /Savings Account/.test(note.text) && /Investment Corpus/.test(note.text),
     "K2 and the card says so, since its totals now sit below the Overview's", note);

  // ── Year selection ──────────────────────────────────────────────────────
  // Same control as Income & Expenses · MONTHLY: a decade-grid picker plus an
  // All time toggle. The card opens on a year rather than every month it has.
  const yearState = () => p.evaluate(() => {
    const sel = document.getElementById("nwm-year");
    const btn = sel && sel.__wfYpBtn;
    return {
      value: sel ? sel.value : null,
      options: sel ? Array.from(sel.options).map((o) => o.value) : [],
      pickerLabel: btn ? btn.textContent.trim() : null,
      pickerVisible: btn ? btn.style.display !== "none" : false,
      // The real question is what is ON SCREEN, so this reads the computed
      // style rather than the inline one a render might have set.
      selectOnScreen: sel ? getComputedStyle(sel).display !== "none" : false,
      controlCount: document.querySelectorAll("#nwm-year, #nwm-year + .wf-yp-btn")
        .length,
      // The card IS the chart, so "what is on show" is its x axis.
      months: ((window.__wfNwmChart || {}).data || {}).labels || [],
      count: (document.getElementById("nwm-count") || {}).textContent || "",
    };
  });

  const y1 = await yearState();
  console.log("  year: " + JSON.stringify(y1));
  eq(y1.options.join(","), "2024,2025",
     "Y1 only years that HAVE a comparable month are offered");
  eq(y1.value, "2025",
     "Y2 opens on the current year, or the most recent with data — never an empty chart");
  ok(y1.pickerVisible && y1.pickerLabel === "2025",
     "Y3 through the same decade-grid picker the cash-flow card uses", y1);
  ok(!y1.selectOnScreen,
     "Y3b and ONLY through it — the native select it replaces stays hidden, or the " +
     "card shows two year controls side by side", y1);
  ok(y1.months.length === 3 && y1.months.every((m) => /2025/.test(m)),
     "Y4 and the chart shows only that year", y1.months);
  // (the year on show is named by the picker button itself — Y3)

  // Switching year. Driven through the select, which is what the picker sets.
  await p.evaluate(() => {
    const sel = document.getElementById("nwm-year");
    sel.value = "2024"; sel.onchange();
  });
  await p.waitForTimeout(400);
  const y2 = await yearState();
  console.log("  after 2024: " + JSON.stringify(y2.months));
  ok(y2.months.length > 0 && y2.months.every((m) => /2024/.test(m)),
     "Y6 selecting an earlier year shows that year's months", y2.months);
  const chart2024 = await p.evaluate(() => (window.__wfNwmChart || {}).data.labels);
  ok(chart2024.every((l) => /2024/.test(l)),
     "Y7 and the chart moves with it — the two never show different years", chart2024);

  // All time.
  await p.click("#nwm-alltime");
  await p.waitForTimeout(400);
  const y3 = await yearState();
  console.log("  all time: " + JSON.stringify(y3.months));
  ok(y3.months.some((m) => /2024/.test(m)) && y3.months.some((m) => /2025/.test(m)),
     "Y8 All time shows every month again", y3.months);
  // Uncapped: the header counts every month it has, so the chart must draw
  // every comparable one. It used to draw the most recent 24 while claiming
  // 150, contradicting the count and putting the early years out of reach.
  eq(y3.months.length, parseInt(y3.count, 10) - 1,
     "Y8b as many bars as months counted, less the first — which has nothing " +
     "before it to compare against", { bars: y3.months.length, header: y3.count });
  ok(!y3.pickerVisible, "Y9 and hides the year picker, which no longer applies");
  ok(!y3.selectOnScreen,
     "Y9b including the select behind it — hiding one and not the other is how a " +
     "stray dropdown appears", y3);
  eq(y3.months[0], "Dec 2024",
     "Y10 starting at the oldest month that HAS a comparison — Nov 2024 is the " +
     "first snapshot, so it has no bar", y3.months[0]);

  await p.click("#nwm-alltime");     // back out of All time before switching years
  await p.waitForTimeout(300);

  // Switching year twice must not narrow the data: each re-render must start
  // from the full set, not from the slice the previous one produced.
  await p.evaluate(() => { const s = document.getElementById("nwm-year"); s.value = "2024"; s.onchange(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => { const s = document.getElementById("nwm-year"); s.value = "2025"; s.onchange(); });
  await p.waitForTimeout(300);
  const y4 = await yearState();
  eq(y4.options.join(","), "2024,2025",
     "Y11 switching years leaves every year still available", y4.options);
  eq(y4.months.length, 3,
     "Y12 and going back to 2025 shows all three of its months again", y4.months);
     // back to a single year for what follows
  await p.waitForTimeout(300);

  // ── A long history under All time ───────────────────────────────────────
  // The five-month fixture above can never reach a cap, so it cannot tell an
  // uncapped chart from a capped one. This one is deliberately longer than the
  // 24 bars the chart used to draw: with 150 months of real history the card
  // counted them all in the header and charted only the most recent two years,
  // leaving every earlier year unreachable.
  const LONG = [];
  for (let y = 2022; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) {
      const eom = new Date(y, m, 0);
      LONG.push({
        snapshot_date: y + "-" + String(m).padStart(2, "0") + "-" + String(eom.getDate()).padStart(2, "0"),
        total: 1000000 + (y - 2022) * 12 * 10000 + m * 10000,
        meta: { source: "backfill", backfilled: true },
      });
    }
  }
  snapshotRows = LONG;
  await load();
  await p.click("#nwm-alltime");
  await p.waitForTimeout(600);
  const long = await p.evaluate(() => ({
    bars: (window.__wfNwmChart || {}).data.labels.length,
    first: ((window.__wfNwmChart || {}).data.labels || [])[0],
    count: (document.getElementById("nwm-count") || {}).textContent || "",
  }));
  console.log("  long history: " + JSON.stringify(long));
  eq(long.bars, 47, "L2 all 47 comparable months are charted — no recent-slice cap");
  eq(long.first, "Feb 2022",
     "L3 starting at the oldest, not two years back from the newest");
  ok(long.count.indexOf("48") === 0,
     "L4 and the header count agrees with what is drawn rather than contradicting it",
     long.count);
  await p.click("#nwm-alltime");
  await p.waitForTimeout(300);
  snapshotRows = SNAPSHOTS;

  // ── The month in progress ───────────────────────────────────────────────
  // Today's snapshot is a real row and is written every day, but the month it
  // belongs to has not finished. Charting it would put a part-month beside full
  // ones and give a bar that grows between visits.
  const today = new Date();
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
                     "-" + String(d.getDate()).padStart(2, "0");
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const twoMonthEnd = new Date(today.getFullYear(), today.getMonth() - 1, 0);
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  snapshotRows = [
    { snapshot_date: iso(twoMonthEnd), total: 1000000, meta: { source: "backfill", backfilled: true } },
    { snapshot_date: iso(lastMonthEnd), total: 1100000, meta: { source: "backfill", backfilled: true } },
    { snapshot_date: iso(today), total: 1500000, meta: { source: "live" } },
  ];
  await load();
  const cur = await p.evaluate(() => ({
    labels: ((window.__wfNwmChart || {}).data || {}).labels || [],
    count: (document.getElementById("nwm-count") || {}).textContent || "",
  }));
  const thisMonth = MON[today.getMonth()] + " " + today.getFullYear();
  const prevMonth = MON[lastMonthEnd.getMonth()] + " " + lastMonthEnd.getFullYear();
  console.log("  in-progress month: " + JSON.stringify(cur) + " (this=" + thisMonth + ")");
  ok(cur.labels.indexOf(thisMonth) === -1,
     "P1 the month in progress is not charted", { labels: cur.labels, thisMonth });
  eq(cur.labels[cur.labels.length - 1], prevMonth,
     "P2 the newest bar is the last COMPLETED month");
  ok(cur.count.indexOf("2 month") === 0,
     "P3 and it is not counted in the header either", cur.count);
  snapshotRows = SNAPSHOTS;

  // ── Exactly one snapshot ────────────────────────────────────────────────
  // The state on the day you start recording: a row to show, but nothing to
  // compare it against. No year has a comparable month, so both year controls
  // must go — leaving the picker button behind would offer a choice that
  // changes nothing, showing a stale year next to a single row.
  snapshotRows = [SNAPSHOTS[SNAPSHOTS.length - 1]];
  await load();
  const one = await p.evaluate(() => {
    const sel = document.getElementById("nwm-year");
    const btn = sel && sel.__wfYpBtn;
    const all = document.getElementById("nwm-alltime");
    return {
      count: (document.getElementById("nwm-count") || {}).textContent || "",
      chart: !!window.__wfNwmChart,
      selectOnScreen: sel ? getComputedStyle(sel).display !== "none" : false,
      pickerOnScreen: btn ? getComputedStyle(btn).display !== "none" : false,
      allTimeOnScreen: all ? getComputedStyle(all).display !== "none" : false,
      chartHidden: (document.getElementById("nwm-chart-wrap") || {}).hidden,
    };
  });
  console.log("  single snapshot: " + JSON.stringify(one));
  ok(one.count.indexOf("1 month") === 0,
     "S1 the one snapshot is counted", one.count);
  ok(!one.chart,
     "S2 but nothing is charted — with nothing to compare against there is no change to draw",
     one);
  ok(!one.selectOnScreen && !one.pickerOnScreen,
     "S3 no year control, since no year has anything to compare", one);
  ok(!one.allTimeOnScreen, "S4 nor an All time toggle", one);
  ok(one.chartHidden, "S5 and no chart — a bar needs two snapshots to have a height", one);
  snapshotRows = SNAPSHOTS;

  // ── Empty state ─────────────────────────────────────────────────────────
  // The state every user is in before the migration is run. It must explain
  // itself rather than render an empty box.
  snapshotRows = [];
  await load();
  const empty = await p.evaluate(() => ({
    rows: document.querySelectorAll("#nwm-list .nwm-row").length,
    status: (document.getElementById("nwm-status") || {}).textContent || "",
    hidden: (document.getElementById("nwm-status") || {}).hidden,
  }));
  console.log("  empty: " + JSON.stringify(empty));
  eq(empty.rows, 0, "N21 no snapshots, no rows");
  ok(!empty.hidden && /no snapshots/i.test(empty.status),
     "N22 and the card says so instead of sitting on 'Loading…'", empty.status);

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
