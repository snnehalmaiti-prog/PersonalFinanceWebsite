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
    // An Investment Corpus balance that moves in a different month from the
    // savings one, so the two buckets cannot be conflated without a test noticing.
    ["1-Jan-2024", "Snnehal", "ICICI", "Corpus One", "Fixed Income", "Investment Corpus", "Deposit", "300000", "", "0%", ""],
    ["5-Jun-2025", "Snnehal", "ICICI", "Corpus One", "Fixed Income", "Investment Corpus", "Deposit", "340000", "", "0%", ""],
    // A term deposit opened well before the window, so it accrues through both
    // months with no principal movement — pure interest, which must not be
    // reported as the market.
    ["1-Jan-2020", "Snnehal", "HDFC", "Deposit One", "Fixed Income", "Fixed Deposit", "Deposit", "1000000", "1-Jan-2030", "8%", ""],
    // And one opened DURING the window. Its ₹1,00,000 principal is a
    // contribution; counting it as interest because it appeared between two
    // valuations is the mistake the open-date filter exists to prevent.
    ["10-Jul-2025", "Snnehal", "ICICI", "Deposit Two", "Fixed Income", "Fixed Deposit", "Deposit", "100000", "1-Jul-2030", "8%", ""],
    // Provident fund, opened long before the window and never added to, so its
    // whole movement is interest. It used to contribute nothing to the Interest
    // figure — buildFdHoldingsList values PF at par whatever the date, so both
    // ends of the comparison agreed and its growth surfaced as a market gain.
    ["1-Apr-2020", "Snnehal", "", "EPF Account", "Fixed Income", "Provident Fund", "Deposit", "1200000", "", "", ""],
    // A second provident fund that IS added to inside the window. Its ₹50,000
    // June contribution is money in, counted by the contributions leg — so the
    // interest leg must difference what the account EARNED, not what it is
    // worth. Differencing worth would book that ₹50,000 twice and take it out of
    // the market residual twice over, which is more than the interest ceiling
    // below allows. Kept small enough that June stays a gaining month: the
    // fixture needs one of each sign.
    ["1-Apr-2020", "Snnehal", "", "EPF Two", "Fixed Income", "Provident Fund", "Deposit", "400000", "", "", ""],
    ["12-Jun-2025", "Snnehal", "", "EPF Two", "Fixed Income", "Provident Fund", "Deposit", "50000", "", "", ""]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

// May → Jun → Jul. May is a reconstruction; the other two are records.
const SNAPSHOTS = [
  // Two years, so the year picker has something to choose between. The 2024
  // rows are what a wrong filter drops or a broken one leaks.
  // Backfilled rows carry a plain total per portfolio; the live ones below carry
  // a category object. Both shapes are read, and both sum to the household.
  { snapshot_date: "2024-11-30", total: 800000,
    by_portfolio: { Snnehal: 500000, Trisha: 300000 },
    meta: { source: "backfill", backfilled: true } },
  { snapshot_date: "2024-12-31", total: 850000,
    by_portfolio: { Snnehal: 530000, Trisha: 320000 },
    meta: { source: "backfill", backfilled: true } },
  { snapshot_date: "2025-05-31", total: 1000000,
    by_portfolio: { Snnehal: 620000, Trisha: 380000 },
    meta: { source: "backfill", backfilled: true } },
  { snapshot_date: "2025-06-30", total: 1200000, equity: 900000, fixed_income: 300000, commodity: 0,
    by_portfolio: { Snnehal: { equity: 700000, fixed_income: 200000, commodity: 0 },
                    Trisha: { equity: 200000, fixed_income: 100000, commodity: 0 } },
    meta: { source: "live" } },
  { snapshot_date: "2025-07-31", total: 1150000, equity: 850000, fixed_income: 300000, commodity: 0,
    by_portfolio: { Snnehal: { equity: 650000, fixed_income: 200000, commodity: 0 },
                    Trisha: { equity: 200000, fixed_income: 100000, commodity: 0 } },
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
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
    // Settings → EPF Interest. PF accrual is a function of these rates, so a
    // fixture without them measures a fund that pays nothing.
    localStorage.setItem("wf-epf-interest-rates", JSON.stringify(
      [2020, 2021, 2022, 2023, 2024, 2025].map((y) => ({ year: y, rate: 8.25 })))); }, SHEETS);
    errs.length = 0;
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    // Any of the three end states: a chart, the explanatory status, or a count
    // with no chart (one snapshot). Waiting only on the chart stalls the full
    // timeout on the cases that correctly draw nothing.
    await p.waitForFunction(() => !!window.__wfNwmChart ||
      (document.getElementById("nwm-status") && !document.getElementById("nwm-status").hidden) ||
      ((document.querySelector("#nwm-split .mic-hs-month") || {}).textContent || "").length > 0,
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
      // Slots vs data: every month of the period gets a label, but only months
      // with a snapshot get bars. Confusing the two is how a placeholder would
      // be mistaken for a month that really moved by zero.
      filled: c.data.labels.filter((_, i) => c.data.datasets[0].data[i] != null),
      tooltipEnabled: !!(c.options.plugins.tooltip && c.options.plugins.tooltip.enabled),
      hasOnHover: typeof c.options.onHover === "function",
    };
  });

  // The header uses CASH FLOW · MONTHLY's own markup, so this reads it the same
  // way that card's split would be read.
  const readStats = () => p.evaluate(() => {
    const out = {};
    document.querySelectorAll("#nwm-split .mic-hs-tot").forEach((el) => {
      out[(el.querySelector(".mic-hs-tot-label") || {}).textContent] =
        (el.querySelector("b") || {}).textContent;
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
  eq(chart.labels.join(","),
     "Jan 2025,Feb 2025,Mar 2025,Apr 2025,May 2025,Jun 2025,Jul 2025,Aug 2025,Sep 2025,Oct 2025,Nov 2025,Dec 2025",
     "N1 every month of the year gets a slot, oldest on the left");
  eq(chart.filled.join(","), "May 2025,Jun 2025,Jul 2025",
     "N1b but only the months with a snapshot carry bars");

  // No tooltip at all: the figures go to the header, where they hold still.
  ok(!chart.tooltipEnabled && chart.hasOnHover,
     "N2 hovering updates the header rather than opening a tooltip", chart);

  // Hovering a month replaces the period's five figures with that month's, in
  // the same five slots — the header must not change shape as the cursor moves.
  // Rupee figures as numbers, for arithmetic rather than pattern-matching.
  const rupees = (x) => Number(String(x || "").replace(/[^0-9.]/g, ""));
  const julH = await hover("Jul 2025");
  console.log("  hover Jul: " + JSON.stringify(julH));
  // Opening and Closing always; the movement terms in between appear only when
  // they moved, so the row stays readable rather than carrying dead zeros.
  eq(Object.keys(julH).join(","),
     "Opening,Closing,Change,Invested,Market loss,Interest,Idle Cash",
     "N3 where the month stood and how far it moved, then what accounts for the move");
  // Totals are net of parked cash: Jun's ₹12,00,000 less the ₹7,00,000 held in
  // the two savings accounts, Jul's ₹11,50,000 less ₹7,50,000 after the ₹50,000
  // moved in. That move is why the card excludes cash — it changed nothing.
  // Totals are the stored ones, cash included, so they reconcile with the
  // Overview. The cash MOVEMENT is named separately instead.
  eq(julH.Opening, "₹12,00,000", "N4 opening is the previous month's stored total");
  eq(julH.Closing, "₹11,50,000", "N5 closing is this month's");
  ok(/^\+₹1,30,000$/.test(julH.Invested),
     "N8 contributions are the fund buy and the new deposit — NOT the ₹50,000 that " +
     "merely moved into savings", julH.Invested);
  // The ₹10L deposit at 8% accrues ~₹10,300 a month and the two provident funds
  // at 8.25% about ₹16,500 between them. Bounded
  // rather than pinned: both accrue to "now", so an exact figure would drift
  // with the date the suite runs.
  const julInt = rupees(julH.Interest);
  ok(julInt > 20000 && julInt < 40000,
     "N9 the deposit's AND the provident fund's interest are named rather than " +
     "credited to the market", julH.Interest);
  // Whatever the interest comes to, the market is exactly what is left of the
  // month's change once the other three terms are taken out. Derived from the
  // figures on screen rather than hardcoded, so it cannot go stale the next time
  // a term is measured better.
  const julMkt = -rupees(julH["Market loss"]);
  const julWant = -50000 - 130000 - julInt - 50000;
  ok(Math.abs(julMkt - julWant) < 1,
     "N9c and the market is what is left: down 50k after putting in 1.8L, moving " +
     "50k into savings and earning that interest",
     { shown: julH["Market loss"], want: julWant });

  const junH = await hover("Jun 2025");
  eq(junH.Opening, "₹10,00,000", "N10 an up month, measured from May's close");
  const junMkt = rupees(junH["Market gain"]);
  // Jun: the ₹50,000 fund buy plus the ₹50,000 paid into the second provident
  // fund, the ₹40,000 corpus move, and the interest — the market is the rest.
  const junWant = 200000 - 100000 - rupees(junH.Interest) - 40000;
  ok(junMkt > 0 && Math.abs(junMkt - junWant) < 1,
     "N11 a gaining month is labelled a gain, with the corpus move and the " +
     "interest taken out of it", { shown: junH["Market gain"], want: junWant });

  const scope = () => p.evaluate(() =>
    ((document.querySelector("#nwm-split .mic-hs-month") || {}).textContent || ""));
  await hover("Jun 2025");
  ok(/Jun 2025/.test(await scope()),
     "N12 the header names the month it is describing");
  // The reconstruction caveat is no longer written out — the faded bar is what
  // carries it now (B13). Nothing here should reintroduce the wording.
  ok(!/reconstruct/i.test(await scope()),
     "N15 the header does not spell out the reconstruction caveat", await scope());
  await hover("Jul 2025");

  // A slot with no snapshot has nothing of its own to report, so the header goes
  // back to describing the period — what CASH FLOW · MONTHLY does when a hovered
  // month has no chips. Naming the empty month with the figures left blank, as
  // this card used to, spent the whole block on saying nothing.
  // Read at rest, which means leaving the chart first — the line above hovered
  // Jul, and a baseline taken there is Jul's figures, not the period's.
  await p.evaluate(() => {
    const cv = document.getElementById("nwm-chart");
    if (cv && typeof cv.onmouseleave === "function") cv.onmouseleave();
  });
  await p.waitForTimeout(300);
  const periodBefore = await readStats();
  const emptyH = await hover("Feb 2025");
  ok(Object.keys(emptyH).length > 0,
     "N16b hovering a month with no snapshot falls back to the period's figures " +
     "rather than emptying the header", emptyH);
  eq(JSON.stringify(emptyH), JSON.stringify(periodBefore),
     "N16b2 exactly the figures shown at rest", { hovered: emptyH, rest: periodBefore });
  ok(/Year to date|^20\d\d$|All time/.test(await scope()),
     "N16c and the label names the period, not the empty month", await scope());

  // The two ways out, both of which CASH FLOW · MONTHLY handles and this card
  // did not. onHover can pass no elements while the cursor is still over the
  // chart, and can fail to fire at all on a quick exit.
  await hover("Jul 2025");
  const viaFallback = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    // No elements, but the chart can still identify the column: the readout
    // must stay on that month rather than snapping back to the period.
    // Restored afterwards — left stubbed, every later "cursor left" in this
    // suite resolved through it and the readout stuck on Jun.
    const real = c.getElementsAtEventForMode;
    c.getElementsAtEventForMode = () => [{ index: c.data.labels.indexOf("Jun 2025") }];
    c.options.onHover({}, [], c);
    const seen = (document.querySelector("#nwm-split .mic-hs-month") || {}).textContent || "";
    c.getElementsAtEventForMode = real;
    return seen;
  });
  eq(viaFallback, "Jun 2025",
     "N16d an empty element list is re-queried before giving up on the hover");

  const viaLeave = await p.evaluate(() => {
    const cv = document.getElementById("nwm-chart");
    if (typeof cv.onmouseleave !== "function") return "(no handler)";
    cv.onmouseleave();
    return (document.querySelector("#nwm-split .mic-hs-month") || {}).textContent || "";
  });
  eq(viaLeave, "2025",
     "N16e and leaving the canvas restores the period, even if onHover never fires");

  // Leaving the chart restores the period's own totals.
  const back = await hover(null);
  eq(back.Opening, "₹8,50,000",
     "N17 moving off the chart puts the period's figures back", back);
  // The fixture's newest year is 2025, which is in the past, so it needs no
  // "year to date" qualifier. The current year gets one — asserted below.
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
    eq(chart.sets.map((s) => s.label).join(","),
       "Interest,Market gain,Market loss",
       "B4 a segment for what only this card can say — what the deposits earned " +
       "and what the market did");
    ok(!chart.sets.some((s) => /Invested|Idle/.test(s.label)),
       "B5 and nothing for contributions or idle cash: those are CASH FLOW · " +
       "MONTHLY's subject, drawn there against their own axis",
       chart.sets.map((s) => s.label));
    ok(chart.sets.every((s) => s.stack === chart.sets[0].stack), "B6 in one stack");

    // Only months with a change get a bar; May has nothing to compare against.
    eq(chart.filled.join(","), "May 2025,Jun 2025,Jul 2025",
       "B7 bars for the year's comparable months, oldest on the left");
    const at = (m) => chart.labels.indexOf(m);
    const seg = (name) => chart.sets.find((s) => s.label === name);

    // Gain and loss are separate series, so a month appears in exactly one of
    // them. One series with two colours could not be toggled a half at a time.
    const gain = seg("Market gain").data, loss = seg("Market loss").data;
    ok(gain[at("Jun 2025")] > 0 && gain[at("Jul 2025")] == null,
       "B8 a gaining month is carried by the gain series alone", gain);
    ok(loss[at("Jul 2025")] < 0 && loss[at("Jun 2025")] == null,
       "B9 and a losing month by the loss series alone", loss);
    ok(chart.labels.every((_, i) => !(gain[i] != null && loss[i] != null)),
       "B9b never both — a month that appeared in each would be counted twice",
       { gain, loss });

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
      // The ₹10L deposit at 8% is ~₹10,300 and the PF ~₹8,250, so a single
      // month lands near ₹18,500. The ceiling is what does the work: the two
      // savings accounts pay 12% here, and if their interest were counted as
      // well (it is already inside the parked-cash flow) the figure would clear
      // it by a wide margin.
      // ~10,300 from the deposit and ~16,500 from the two provident funds. The
      // ceiling does the work twice over: the savings accounts pay 12% here and
      // would clear it if their interest were counted (it is already inside the
      // parked-cash flow), and so would the ₹50,000 PF contribution if the
      // interest leg differenced the accounts' worth instead of their earnings.
      ok(int[at(m)] > 20000 && int[at(m)] < 40000,
         "B11a " + m + ": the deposit and both provident funds are measured, and " +
         "only what they EARNED — not the savings accounts, not the PF top-up",
         int[at(m)]);
    });
    // The provident funds pay 8.25% on ₹16,00,000 between them. Before PF was
    // accrued the deposit alone put each single-month bar near ₹10,300; the
    // floor below is what separates "the PF is counted" from "it is not".
    ["Jun 2025", "Jul 2025"].forEach((m) => {
      ok(int[at(m)] > 20000,
         "B11a-pf " + m + ": the provident funds' interest is counted too, not " +
         "left to surface as a market gain", int[at(m)]);
    });

    ok(int[at("May 2025")] > 4 * 8000,
       "B11a-gap May spans five months with no snapshot, so it carries five months of accrual",
       int[at("May 2025")]);

    // The bars no longer sum to the month's change — contributions and idle cash
    // are deliberately absent — so the invariant moves to the header, which does
    // still have to reconcile (H4c). What must hold here is that the two market
    // series and the interest are the SAME figures the header names.
    const mktOf = (i) => (gain[i] != null ? gain[i] : (loss[i] != null ? loss[i] : 0));
    ok(mktOf(at("Jun 2025")) > 0 && mktOf(at("Jul 2025")) < 0,
       "B11c the market keeps its sign — a gaining month and a losing one",
       { jun: mktOf(at("Jun 2025")), jul: mktOf(at("Jul 2025")) });

    // A losing month must not be drawn in the gaining colour. Asserted against
    // the specific hues, not merely "the two differ" — Jun is faded and Jul is
    // not, so a difference exists even when both are green.
    const UP = "16,185,129";   // #10B981
    ok(String(seg("Market gain").colors[at("Jun 2025")]).includes(UP),
       "B12 the gaining month is drawn in the gain colour", seg("Market gain").colors[at("Jun 2025")]);
    ok(String(seg("Market loss").colors[at("Jul 2025")]).toUpperCase() === "#E8623A",
       "B12b and the losing month in the loss colour", seg("Market loss").colors[at("Jul 2025")]);
    ok(!String(seg("Market loss").colors[at("Jul 2025")]).includes(UP),
       "B12c specifically, a loss is never drawn as a gain", seg("Market loss").colors);
    // Jun is measured from May, a reconstruction, so it is faded; Jul is measured
    // from Jun and both are records, so it is solid.
    ok(/rgba/.test(String(seg("Interest").colors[at("Jun 2025")])) &&
       !/rgba/.test(String(seg("Interest").colors[at("Jul 2025")])),
       "B13 a month measured from a reconstruction is faded, while a fully recorded one is solid",
       seg("Interest").colors);
  }

  // ── The header's three lines ────────────────────────────────────────────
  // Label, then where the period stood, then what happened to it. Seven figures
  // on one row ran off the card at anything narrower than a desktop.
  const lines = await p.evaluate(() => Array.from(
    document.querySelectorAll("#nwm-split .mic-hs-row")).map((r) => ({
      month: (r.querySelector(".mic-hs-month") || {}).textContent || "",
      labels: Array.from(r.querySelectorAll(".mic-hs-tot-label")).map((e) => e.textContent),
    })));
  console.log("  lines: " + JSON.stringify(lines));
  eq(lines.length, 3, "L1 three rows: the period, then two lines of figures");
  ok(lines[0].month.length > 0 && lines[0].labels.length === 0,
     "L2 the period is named on its own line, above the figures", lines[0]);
  eq(lines[1].labels.join(","), "Opening,Closing,Change",
     "L3 where the period stood and how far it moved, on the first figure line");
  ok(lines[2].labels.indexOf("Invested") === 0 &&
     /^Market (gain|loss)$/.test(lines[2].labels[1]),
     "L4 and what accounts for that move on the second, investing first",
     lines[2].labels);
  ok(lines[2].labels.indexOf("Interest") > 1,
     "L4b with the smaller terms after it", lines[2].labels);

  // ── The header figures ──────────────────────────────────────────────────
  // Five numbers for the period on show. Opening is the close of the month
  // BEFORE the first bar, which is what makes the row reconcile: everything
  // that happened in the period, applied to what it started with, is what it
  // ended with.
  const stats = await readStats();
  console.log("  stats: " + JSON.stringify(stats));
  ok(Object.keys(stats).join(",").indexOf("Opening,Closing,Change,Invested") === 0,
     "H1 the figures in order: the period, its movement, then the movement explained",
     Object.keys(stats));

  // 2025 on show: May, Jun, Jul. Opening is Dec 2024's close (₹8,50,000), since
  // that is what May was measured against — NOT May's own total.
  eq(stats.Opening, "₹8,50,000",
     "H2 opening is the close of the month before the first bar");
  eq(stats.Closing, "₹11,50,000", "H3 closing is the newest month's stored total");

  const moved = num(stats.Invested) + num(stats.Interest) + num(stats["Idle Cash"] || 0) +
                num(stats["Market loss"] ?? stats["Market gain"]);
  ok(Math.abs((num(stats.Opening) + moved) - num(stats.Closing)) < 1,
     "H4 and they reconcile: opening plus everything that moved is closing", stats);
  // Change is the headline of the second line, so it has to be both: the
  // distance between the two figures beside it, and the sum of the four below.
  ok(Math.abs(num(stats.Change) - (num(stats.Closing) - num(stats.Opening))) < 1,
     "H4b Change is exactly closing less opening", stats);
  ok(Math.abs(num(stats.Change) - moved) < 1,
     "H4c and the four terms under it add up to it — the second line explains the first",
     stats);

  // A negative market is labelled as a loss, not a negative gain.
  ok(/^[+−]/.test(stats["Market loss"] ?? stats["Market gain"]),
     "H5 the market figure is signed", stats);

  // ── Parked cash is counted, and named ───────────────────────────────────
  // Cash is IN the totals and named among the movements. Counted in only one of
  // those places, the ₹50,000 moved into savings in July would either break the
  // reconciliation or resurface in Market as a price move that never happened.
  const julSum = num(julH.Opening) + num(julH.Invested) + num(julH.Interest) +
                 num(julH["Idle Cash"] || 0) + num(julH["Market loss"]);
  ok(Math.abs(julSum - num(julH.Closing)) < 1,
     "K1 a hovered month reconciles with cash counted in the totals and named " +
     "among the movements", { julH, julSum });

  // ── Spacing matches the Cash Flow card ──────────────────────────────────
  // Measured against that card in the same page rather than against fixed
  // numbers, so the two cannot drift apart when either is restyled. The gap
  // under the title was 40px adrift when this card carried its own padding on
  // top of the header's, and reserved three rows' height for its one row.
  const spacing = await p.evaluate(() => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { top: r.top, bottom: r.bottom, left: r.left, h: Math.round(r.height),
               gap: cs.columnGap, fs: cs.fontSize }; };
    const nwmEye = box("#net-worth-monthly-card .mic-eyebrow");
    const nwmRow = box("#nwm-split .mic-hs-row");
    const cfEye = box("#monthly-invest-cat-card .mic-eyebrow");
    const cfRow = box("#mic-hover-split .mic-hs-row");
    if (!nwmEye || !nwmRow || !cfEye || !cfRow) return null;
    return {
      nwmGap: Math.round(nwmRow.top - nwmEye.bottom),
      cfGap: Math.round(cfRow.top - cfEye.bottom),
      rowH: [nwmRow.h, cfRow.h], colGap: [nwmRow.gap, cfRow.gap], fs: [nwmRow.fs, cfRow.fs],
      monthFs: [box("#nwm-split .mic-hs-month").fs, box("#mic-hover-split .mic-hs-month").fs],
      // Left inset from the card edge. A card carrying its own padding on top of
      // the header's indents everything twice — invisible in the gap above,
      // obvious as a text block that does not line up with its neighbour.
      inset: [
        Math.round(box("#nwm-split .mic-hs-row").left -
                   document.getElementById("net-worth-monthly-card").getBoundingClientRect().left),
        Math.round(box("#mic-hover-split .mic-hs-row").left -
                   document.getElementById("monthly-invest-cat-card").getBoundingClientRect().left),
      ],
      eyebrowInset: [
        Math.round(box("#net-worth-monthly-card .mic-eyebrow").left -
                   document.getElementById("net-worth-monthly-card").getBoundingClientRect().left),
        Math.round(box("#monthly-invest-cat-card .mic-eyebrow").left -
                   document.getElementById("monthly-invest-cat-card").getBoundingClientRect().left),
      ],
    };
  });
  console.log("  spacing: " + JSON.stringify(spacing));
  if (!spacing) {
    ok(false, "G0 both cards rendered a split row to compare");
  } else {
    ok(Math.abs(spacing.nwmGap - spacing.cfGap) <= 2,
       "G1 the gap between title and figures matches the Cash Flow card", spacing);
    eq(spacing.rowH[0], spacing.rowH[1], "G2 the row is the same height");
    eq(spacing.colGap[0], spacing.colGap[1], "G3 with the same spacing between figures");
    eq(spacing.fs[0], spacing.fs[1], "G4 at the same size");
    eq(spacing.monthFs[0], spacing.monthFs[1], "G5 and the same label size");
    eq(spacing.inset[0], spacing.inset[1],
       "G6 the figures start the same distance in from the card edge", spacing.inset);
    eq(spacing.eyebrowInset[0], spacing.eyebrowInset[1],
       "G7 as does the title above them", spacing.eyebrowInset);
  }

  // ── The portfolio selector ──────────────────────────────────────────────
  // The card follows the Overview's selector like every other card. One
  // portfolio's share comes from the stored split — including on reconstructed
  // months, which is why the backfill records one.
  const pickPortfolio = async (name) => {
    // Through the real control where the menu offers it, so every card that
    // follows the selector is refreshed — comparing this card's title against
    // CASH FLOW's is meaningless if only one of them re-rendered.
    const clicked = await p.evaluate((n) => {
      const opt = Array.prototype.slice.call(
        document.querySelectorAll("#portfolio-pills [data-ov-portfolio]"))
        .find((e) => (e.getAttribute("data-ov-portfolio") || "").toLowerCase() ===
          n.toLowerCase());
      if (!opt) return false;
      opt.click();
      return true;
    }, name);
    if (!clicked) {
      await p.evaluate((n) => { localStorage.setItem("wf-selected-portfolio", n); }, name);
      await p.evaluate(() => window.renderNetWorthMonthly && window.renderNetWorthMonthly());
    }
    await p.waitForTimeout(1800);
    return p.evaluate(() => {
      const c = window.__wfNwmChart;
      const tot = {};
      document.querySelectorAll("#nwm-split .mic-hs-tot").forEach((el) => {
        tot[(el.querySelector(".mic-hs-tot-label") || {}).textContent] =
          (el.querySelector("b") || {}).textContent;
      });
      const eyebrow = (el) => {
        const e = el && el.querySelector(".mic-eyebrow");
        return e ? e.textContent.replace(/\s+/g, " ").trim() : null;
      };
      return { labels: c ? c.data.labels : [], stats: tot,
        // The card names the selection in its title, and must name it the way
        // CASH FLOW · MONTHLY does — same markup, same separator, same casing.
        eyebrow: eyebrow(document.getElementById("net-worth-monthly-card")),
        cashflowEyebrow: eyebrow(document.getElementById("monthly-invest-cat-card")),
        named: (document.getElementById("nwm-portfolio-name") || {}).textContent };
    });
  };

  const household = await pickPortfolio("all");
  const sn = await pickPortfolio("Snnehal");
  const tr = await pickPortfolio("Trisha");
  console.log("  by portfolio: " + JSON.stringify({ all: household.stats.Closing,
    Snnehal: sn.stats.Closing, Trisha: tr.stats.Closing }));

  ok(sn.labels.length > 0, "Q1 a portfolio selection still draws a chart", sn.labels);
  const n = (s) => Number(String(s || "").replace(/[^0-9.]/g, ""));
  ok(n(sn.stats.Closing) > 0 && n(tr.stats.Closing) > 0,
     "Q2 each portfolio has its own closing figure", { sn: sn.stats, tr: tr.stats });
  ok(n(sn.stats.Closing) < n(household.stats.Closing),
     "Q3 and it is smaller than the household's", { sn: sn.stats.Closing, all: household.stats.Closing });

  // The property the whole reconstruction stands on. Jul 2025's split is
  // 650k+200k for one and 200k+100k for the other, against a household total of
  // 1,150,000 — less the parked cash, which comes off every one of them.
  ok(Math.abs((n(sn.stats.Closing) + n(tr.stats.Closing)) - n(household.stats.Closing)) <= 2,
     "Q4 the portfolios sum to the household — if they do not, one of the two " +
     "valuation paths has drifted from the other",
     { sn: sn.stats.Closing, tr: tr.stats.Closing, all: household.stats.Closing });

  // ── The card names the selection ────────────────────────────────────────
  // Same treatment CASH FLOW · MONTHLY gives it: the portfolio appended to the
  // eyebrow, so a card showing one person's figures says whose they are.
  ok(/GAIN . MONTHLY . Snnehal$/.test(sn.eyebrow || ""),
     "R1 a portfolio selection is named in the title", sn.eyebrow);
  ok(/Trisha$/.test(tr.eyebrow || ""), "R2 the other one too", tr.eyebrow);
  ok(/GAIN . MONTHLY$/.test(household.eyebrow || ""),
     "R3 and the household is not — 'All' would be noise on every load",
     household.eyebrow);
  ok(sn.named === " \u00b7 Snnehal",
     "R4 appended with the same separator, not baked into the title", sn.named);
  // The two cards sit one above the other, so a difference in how they name the
  // same selection is visible at a glance.
  ok(sn.cashflowEyebrow && sn.eyebrow &&
     sn.cashflowEyebrow.replace(/^CASH FLOW/, "") === sn.eyebrow.replace(/^GAIN/, ""),
     "R5 named identically to CASH FLOW · MONTHLY, which sits right below it",
     { nwm: sn.eyebrow, cf: sn.cashflowEyebrow });

  // Both cards ignore the exclusion filters — this one because snapshots are
  // recorded unfiltered, CASH FLOW because it reads the sheets directly. With a
  // filter on they will not match the Overview, and nothing said so.
  const notes = await p.evaluate(() => {
    const note = (id) => {
      const el = document.querySelector("#" + id + " .mic-exclusion-note");
      return el ? el.textContent.replace(/\s+/g, " ").trim() : null;
    };
    return { nwm: note("net-worth-monthly-card"), cf: note("monthly-invest-cat-card") };
  });
  ok(/exclusion filters are not applied/i.test(notes.nwm || ""),
     "R8 GAIN · MONTHLY says the exclusion filters do not reach it", notes);
  ok(notes.cf === notes.nwm,
     "R9 and CASH FLOW · MONTHLY says it identically — the two sit one above " +
     "the other, so a difference in wording reads as a difference in meaning",
     notes);

  const backToAll = await pickPortfolio("all");
  ok(/GAIN . MONTHLY$/.test(backToAll.eyebrow || ""),
     "R6 and the name is dropped again on returning to the household",
     backToAll.eyebrow);

  // ── Parked cash is named, not hidden ────────────────────────────────────
  // The fixture moves ₹50,000 into savings in July. That money is in net worth,
  // so it stays in the totals — and it is not investing, so it is named on its
  // own rather than inflating Invested or being blamed on the market. It is not
  // charted: CASH FLOW · MONTHLY draws cash movements, and drawing them here too
  // told that card's story worse and buried this one's.
  ok(/^\+₹50,000$/.test(julH["Idle Cash"]),
     "C1 the cash movement is named in its own figure", julH["Idle Cash"]);
  ok(!(await p.evaluate(() => (window.__wfNwmChart.data.datasets || [])
        .some((d) => /Idle|Invested/.test(d.label)))),
     "C1b and is not a bar here, where it would be a second telling of CASH FLOW");
  ok(/^\+₹1,30,000$/.test(julH.Invested),
     "C2 and is not counted as investing", julH.Invested);
  // No explanatory note: the totals reconcile with the Overview, so there is
  // nothing left for one to explain away. Asserted so a future change does not
  // quietly reintroduce prose the card no longer needs.
  const noteEl = await p.evaluate(() => !!document.getElementById("nwm-note"));
  ok(!noteEl, "C3 and the card carries no note explaining itself");

  // ── The controls match the card below ───────────────────────────────────
  // Cash Flow scopes its controls smaller than the .mic-dropdown-btn default,
  // and Net Worth was not in that rule — so its pills came out 27px tall
  // against Cash Flow's 20px. Two cards stacked with the same two controls at
  // different sizes read as two designs, not one page.
  const ctlSizes = await p.evaluate(() => {
    const m = (id) => {
      const e = document.getElementById(id);
      if (!e) return null;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { h: Math.round(r.height), fs: cs.fontSize, pad: cs.padding };
    };
    const gap = (sel) => {
      const e = document.querySelector(sel);
      return e ? getComputedStyle(e).gap : null;
    };
    return { nwm: m("nwm-alltime"), cf: m("monthly-invest-cat-alltime"),
      // The year <select> is hidden and a custom picker button stands in for it,
      // so measuring the select compares two zero-height elements and proves
      // nothing. __wfYpBtn is what is actually on screen.
      nwmYear: (() => { const sel = document.getElementById("nwm-year");
        const btn = sel && sel.__wfYpBtn; if (!btn) return null;
        const r = btn.getBoundingClientRect(), cs = getComputedStyle(btn);
        return { h: Math.round(r.height), fs: cs.fontSize, pad: cs.padding }; })(),
      cfYear: (() => { const sel = document.getElementById("monthly-invest-cat-year");
        const btn = sel && sel.__wfYpBtn; if (!btn) return null;
        const r = btn.getBoundingClientRect(), cs = getComputedStyle(btn);
        return { h: Math.round(r.height), fs: cs.fontSize, pad: cs.padding }; })(),
      nwmGap: gap("#net-worth-monthly-card .mic-controls"),
      cfGap: gap("#monthly-invest-cat-card .mic-controls") };
  });
  console.log("  controls: " + JSON.stringify(ctlSizes));
  ok(ctlSizes.nwm && ctlSizes.cf && ctlSizes.nwm.h === ctlSizes.cf.h,
     "CTL1 the All time pill is the same height as Cash Flow's", ctlSizes);
  eq(ctlSizes.nwm.fs, ctlSizes.cf.fs, "CTL2 at the same text size");
  eq(ctlSizes.nwm.pad, ctlSizes.cf.pad, "CTL3 with the same padding");
  ok(ctlSizes.nwmYear && ctlSizes.cfYear && ctlSizes.nwmYear.h > 0 &&
     ctlSizes.nwmYear.h === ctlSizes.cfYear.h,
     "CTL4 and so is the year picker beside it — the button on screen, not the " +
     "hidden select behind it", ctlSizes);
  eq(ctlSizes.nwmGap, ctlSizes.cfGap, "CTL5 spaced apart the same way");

  // ── The gap to the card below ───────────────────────────────────────────
  // .value-chart-card carries a 22px top margin and the row it sits in adds
  // another 16px, so the two stacked and the pair sat 38px apart — wider than
  // anything else on the page. The row owns the spacing now.
  const cardGap = await p.evaluate(() => {
    const a = document.getElementById("net-worth-monthly-card");
    const b2 = document.getElementById("monthly-invest-cat-card");
    if (!a || !b2) return null;
    return Math.round(b2.getBoundingClientRect().top - a.getBoundingClientRect().bottom);
  });
  console.log("  gap to Cash Flow: " + cardGap + "px");
  ok(cardGap != null && cardGap <= 20,
     "GAP1 the two charts sit close enough to read as a pair, not two screens",
     cardGap);
  ok(cardGap != null && cardGap > 0,
     "GAP2 while still being two cards rather than one", cardGap);

  // The same trap, anywhere on the page: a row that spaces itself from what is
  // above it, holding cards that each add their own 22px on top. That is what
  // opened the 38px gap this pair used to have, and a new row of chart cards
  // would reintroduce it silently.
  const doubled = await p.evaluate(() =>
    Array.from(document.querySelectorAll(".value-chart-card"))
      .map((c) => {
        const par = c.parentElement;
        return { card: c.id || "?", parent: par.id || String(par.className).split(" ")[0],
          cardMt: getComputedStyle(c).marginTop, parentMt: getComputedStyle(par).marginTop };
      })
      .filter((x) => x.cardMt !== "0px" && x.parentMt !== "0px"));
  ok(doubled.length === 0,
     "GAP3 and no card on the page stacks its own top margin on a row that " +
     "already has one", doubled);

  // ── The selectable legend ───────────────────────────────────────────────
  // Same contract as CASH FLOW · MONTHLY's: clicking picks a series out rather
  // than hiding one, several can be picked at once, the rest dim, and "Show all"
  // clears — otherwise picking one means clicking the others off again.
  const legend = () => p.evaluate(() => {
    const el = document.getElementById("nwm-chart-legend");
    return {
      keys: Array.from(el.querySelectorAll("[data-nwm-series]"))
        .map((e) => e.textContent.trim()),
      dimmed: Array.from(el.querySelectorAll("[data-nwm-series]"))
        .filter((e) => e.classList.contains("mic-legend-dimmed"))
        .map((e) => e.textContent.trim()),
      clickable: Array.from(el.querySelectorAll("[data-nwm-series]"))
        .every((e) => e.classList.contains("mic-legend-clickable") &&
                      e.getAttribute("role") === "button"),
      showAll: !!el.querySelector("[data-nwm-series-clear]"),
      drawn: (window.__wfNwmChart.data.datasets || []).map((d) => d.label),
    };
  });
  const clickKey = async (name) => {
    await p.evaluate((n) => {
      const el = Array.from(document.querySelectorAll("[data-nwm-series]"))
        .find((e) => e.textContent.trim() === n);
      if (el) el.click();
    }, name);
    await p.waitForTimeout(400);
    return legend();
  };

  const l0 = await legend();
  console.log("  legend: " + JSON.stringify(l0));
  eq(l0.keys.join(","), "Interest,Market gain,Market loss",
     "LG1 a key per series the period actually contains");
  eq(l0.drawn.join(","), "Interest,Market gain,Market loss",
     "LG2 all of them drawn until something is picked");
  ok(l0.clickable, "LG3 each key is a button, reachable by keyboard as well as pointer");
  ok(!l0.showAll, "LG4 with no 'Show all' until there is a selection to clear");
  ok(l0.dimmed.length === 0, "LG5 and nothing dimmed", l0.dimmed);

  const l1 = await clickKey("Market loss");
  console.log("  after picking Market loss: " + JSON.stringify(l1));
  eq(l1.drawn.join(","), "Market loss", "LG6 picking one series draws only it");
  eq(l1.dimmed.sort().join(","), "Interest,Market gain",
     "LG7 and dims the ones left out", l1.dimmed);
  ok(l1.showAll, "LG8 'Show all' appears once a selection exists");

  const l2 = await clickKey("Interest");
  eq(l2.drawn.sort().join(","), "Interest,Market loss",
     "LG9 a second click adds to the selection rather than replacing it", l2.drawn);

  const l3 = await clickKey("Interest");
  eq(l3.drawn.join(","), "Market loss",
     "LG10 and clicking a picked series again removes it", l3.drawn);

  await p.evaluate(() => {
    const el = document.querySelector("[data-nwm-series-clear]");
    if (el) el.click();
  });
  await p.waitForTimeout(400);
  const l4 = await legend();
  eq(l4.drawn.join(","), "Interest,Market gain,Market loss",
     "LG11 'Show all' brings every series back", l4.drawn);
  ok(!l4.showAll && l4.dimmed.length === 0,
     "LG12 and takes itself away again, with nothing left dimmed", l4);

  // ── What the figures say while a series is picked ───────────────────────
  // Picking a series narrows the question, so the figures narrow with it: the
  // period's total for that series on the first line, and the hovered month's
  // on the second — beneath the period rather than replacing it, so a month is
  // always read against the period it sits in.
  const splitLines = () => p.evaluate(() =>
    Array.from(document.querySelectorAll("#nwm-split .mic-hs-row")).map((r) => ({
      month: (r.querySelector(".mic-hs-month") || {}).textContent || "",
      labels: Array.from(r.querySelectorAll(".mic-hs-tot-label")).map((e) => e.textContent),
      values: Array.from(r.querySelectorAll("b")).map((e) => e.textContent),
    })));

  await clickKey("Interest");
  const selOne = await splitLines();
  console.log("  one series: " + JSON.stringify(selOne));
  eq(selOne[1].labels.join(","), "Interest",
     "SEL1 one series picked, one figure — the period's total for it", selOne[1]);
  ok(!/Opening|Closing|Change/.test(JSON.stringify(selOne)),
     "SEL2 and not the whole-net-worth figures, which are no longer the question",
     selOne);
  ok(selOne[1].labels.indexOf("Total") === -1,
     "SEL3 with no 'Total' beside it: a total of one number is that number twice",
     selOne[1].labels);
  eq(selOne[2].labels.length, 0,
     "SEL4 the second line is empty until the cursor is over a month", selOne[2]);

  // The period total has to be the sum of the months, not one of them.
  const monthsShown = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    const d = (c.data.datasets.find((s) => s.label === "Interest") || {}).data || [];
    return d.filter((v) => v != null && v !== 0);
  });
  const sumOfMonths = monthsShown.reduce((a, b) => a + b, 0);
  ok(Math.abs(rupees(selOne[1].values[0]) - Math.round(sumOfMonths)) <= 2,
     "SEL5 and it is the months added up, not a single month or the whole year's",
     { shown: selOne[1].values[0], sum: sumOfMonths, months: monthsShown.length });

  const hoveredSel = await hover("Jul 2025");
  const selHover = await splitLines();
  console.log("  hovered: " + JSON.stringify(selHover));
  ok(/Jul 2025/.test(selHover[2].month),
     "SEL6 hovering names the month on the second line", selHover[2]);
  eq(selHover[2].labels.join(","), "Interest",
     "SEL7 with that month's figure for the picked series", selHover[2]);
  eq(selHover[1].labels.join(","), "Interest",
     "SEL8 while the period's total stays put above it", selHover[1]);
  ok(rupees(selHover[1].values[0]) > rupees(selHover[2].values[0]),
     "SEL9 and is larger, being every month rather than one",
     { period: selHover[1].values[0], month: selHover[2].values[0] });

  // Two picked: each on its own, plus what they come to together.
  await clickKey("Market loss");
  const selBoth = await splitLines();
  console.log("  two series: " + JSON.stringify(selBoth[1]));
  eq(selBoth[1].labels.join(","), "Interest,Market loss,Total",
     "SEL10 two series picked: each one's total, and the total of the two",
     selBoth[1]);
  const [a, b2, t] = selBoth[1].values.map((v) => Number(String(v).replace(/[^0-9.]/g, "")) *
    (/−/.test(v) ? -1 : 1));
  ok(Math.abs((a + b2) - t) < 2,
     "SEL11 and the total is the two added, not something else", { a, b2, t });

  await p.evaluate(() => {
    const el = document.querySelector("[data-nwm-series-clear]");
    if (el) el.click();
  });
  await p.waitForTimeout(400);
  const cleared = await splitLines();
  ok(/Opening/.test(JSON.stringify(cleared)) && /Closing/.test(JSON.stringify(cleared)),
     "SEL12 clearing the selection brings the whole-net-worth figures back",
     cleared[1]);

  // Left showing everything: the selection is sticky across redraws, so a block
  // that ends mid-selection changes what every later assertion is looking at.
  const l5 = await legend();
  eq(l5.drawn.length, 3, "LG13 the card is left with every series showing", l5.drawn);

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
  ok(y1.months.length === 12 && y1.months.every((m) => /2025/.test(m)),
     "Y4 and the chart shows that year and no other", y1.months);
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
  const filledAll = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    return c.data.labels.filter((_, i) => c.data.datasets[0].data[i] != null).length;
  });
  // Five snapshots, so four months have one before them to be compared against;
  // the oldest has nothing behind it.
  eq(filledAll, SNAPSHOTS.length - 1,
     "Y8b a bar for every month that has one to compare against, and no more",
     { bars: filledAll, snapshots: SNAPSHOTS.length });
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
  eq(y4.months.length, 12,
     "Y12 and going back to 2025 shows its full axis again", y4.months);
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
  }));
  console.log("  long history: " + JSON.stringify(long));
  eq(long.bars, 47, "L2 all 47 comparable months are charted — no recent-slice cap");
  eq(long.first, "Feb 2022",
     "L3 starting at the oldest, not two years back from the newest");
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
  const cur = await p.evaluate(() => {
    const c = window.__wfNwmChart || { data: { labels: [], datasets: [{ data: [] }] } };
    return {
      labels: c.data.labels,
      filled: c.data.labels.filter((_, i) => c.data.datasets[0].data[i] != null),
    };
  });
  const thisMonth = MON[today.getMonth()] + " " + today.getFullYear();
  const prevMonth = MON[lastMonthEnd.getMonth()] + " " + lastMonthEnd.getFullYear();
  console.log("  in-progress month: " + JSON.stringify(cur) + " (this=" + thisMonth + ")");
  ok(cur.labels.indexOf(thisMonth) !== -1,
     "P1 the month in progress keeps its slot on the axis", { labels: cur.labels, thisMonth });
  ok(cur.filled.indexOf(thisMonth) === -1,
     "P1b but carries no bar — it is not a month end", { filled: cur.filled, thisMonth });
  eq(cur.filled[cur.filled.length - 1], prevMonth,
     "P2 the newest bar is the last COMPLETED month");
  eq(cur.filled.length, 1,
     "P3 leaving one bar — the completed month that has one before it", cur.filled);
  const curScope = await p.evaluate(() =>
    ((document.querySelector("#nwm-split .mic-hs-month") || {}).textContent || ""));
  console.log("  scope: " + JSON.stringify(curScope));
  eq(curScope, String(new Date().getFullYear()) + " · Year to date",
     "P4 the current year's resting figures are labelled year to date — they cover " +
     "the year so far, and only its completed months");
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
      chart: !!window.__wfNwmChart,
      label: (document.querySelector("#nwm-split .mic-hs-month") || {}).textContent || "",
      figures: document.querySelectorAll("#nwm-split .mic-hs-tot").length,
      selectOnScreen: sel ? getComputedStyle(sel).display !== "none" : false,
      pickerOnScreen: btn ? getComputedStyle(btn).display !== "none" : false,
      allTimeOnScreen: all ? getComputedStyle(all).display !== "none" : false,
      chartHidden: (document.getElementById("nwm-chart-wrap") || {}).hidden,
    };
  });
  console.log("  single snapshot: " + JSON.stringify(one));
  // One snapshot, and it is 2025's — but with no comparable month there is no
  // year to select, so the card falls back to naming the whole span.
  eq(one.label, "All time", "S1 the header still names the period", one.label);
  eq(one.figures, 0, "S1b with no figures, since nothing can be compared", one.figures);
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
