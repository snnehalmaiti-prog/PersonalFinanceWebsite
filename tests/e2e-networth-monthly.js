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
  "wf-fd-data": [FD_HDR],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

// May → Jun → Jul. May is a reconstruction; the other two are records.
const SNAPSHOTS = [
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
    await p.waitForFunction(() => document.querySelectorAll("#nwm-list .nwm-row").length > 0 ||
      (document.getElementById("nwm-status") && !document.getElementById("nwm-status").hidden),
      null, { timeout: 25000 }).catch(() => {});
    await p.waitForTimeout(1500);
  };

  const readRows = () => p.evaluate(() => Array.from(document.querySelectorAll("#nwm-list .nwm-row")).map((el) => ({
    month: (el.querySelector(".nwm-month") || {}).textContent || "",
    total: (el.querySelector(".nwm-total") || {}).textContent || "",
    delta: (el.querySelector(".nwm-delta") || {}).textContent || "",
    attr: (el.querySelector(".nwm-attr") || {}).textContent || "",
    estimated: el.classList.contains("is-estimated"),
    tagged: !!el.querySelector(".nwm-tag"),
  })));

  await load();
  const rows = await readRows();
  console.log("  rows: " + JSON.stringify(rows, null, 1));
  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  eq(rows.length, 3, "N1 one row per recorded month");
  ok(/Jul 2025/.test(rows[0].month), "N2 newest first", rows[0].month);
  ok(/May 2025/.test(rows[2].month), "N3 oldest last", rows[2].month);

  eq(money(rows[0].total), 1150000, "N4 the total is the stored total, not a recomputation");
  eq(money(rows[1].total), 1200000, "N5 same for the month before");

  // Jul: 1,150,000 − 1,200,000 = −50,000, of which +30,000 was invested,
  // so the market lost 80,000. This is the number the card exists for.
  eq(money(rows[0].delta), -50000, "N6 the month's change is the difference between two snapshots");
  const jul = rows[0].attr;
  ok(/invested/.test(jul) && /market/.test(jul), "N7 the change is attributed", jul);
  ok(jul.includes("30,000"),
     "N8 contributions come from the transaction sheets — Jul's ₹30,000 buy", jul);
  ok(jul.includes("80,000"),
     "N9 and the market is the remainder: down 50k while adding 30k means the market lost 80k", jul);

  // Jun: 1,200,000 − 1,000,000 = +200,000, of which 50,000 was invested.
  eq(money(rows[1].delta), 200000, "N10 an up month");
  ok(rows[1].attr.includes("50,000") && rows[1].attr.includes("1,50,000"),
     "N11 attributed the same way — 50k invested, 1.5L from the market", rows[1].attr);

  eq(rows[2].delta.trim(), "—",
     "N12 the oldest month has nothing to compare against and invents no attribution");

  // Honesty: a reconstruction must not look like a record.
  ok(rows[2].tagged, "N13 the backfilled month is tagged", rows[2]);
  ok(!rows[0].tagged && !rows[1].tagged, "N14 recorded months are not");
  ok(rows[1].estimated,
     "N15 an attribution measured FROM a reconstruction is marked too — half of it is derived");
  ok(!rows[0].estimated,
     "N16 while a change between two recorded months carries no such caveat");

  const foot = await p.evaluate(() => (document.getElementById("nwm-foot") || {}).textContent || "");
  ok(/reconstruct/i.test(foot), "N17 the footnote says which months are reconstructions", foot);

  // Expanding shows the stored split, which is stored only for recorded months.
  await p.click("#nwm-list .nwm-row .nwm-row-head");
  await p.waitForTimeout(300);
  const detail = await p.evaluate(() => (document.querySelector("#nwm-list .nwm-detail") || {}).textContent || "");
  console.log("  detail: " + JSON.stringify(detail));
  ok(/Equity/.test(detail) && /8,50,000/.test(detail),
     "N18 expanding a row shows the category split as stored", detail);
  ok(/Snnehal/.test(detail), "N19 and the per-portfolio breakdown", detail);
  ok(/2025-07-31/.test(detail), "N20 with the date the figure is as-of", detail);

  // ── The stacked bars ────────────────────────────────────────────────────
  // Read off the Chart config the page actually built, so the bars are asserted
  // to carry the same numbers the rows do rather than merely to exist.
  const chart = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    if (!c) return null;
    return { type: c.type, labels: c.data.labels,
      sets: c.data.datasets.map((d) => ({ label: d.label, data: d.data, stack: d.stack,
        colors: d.backgroundColor })),
      xStacked: !!(c.options.scales.x && c.options.scales.x.stacked),
      yStacked: !!(c.options.scales.y && c.options.scales.y.stacked) };
  });
  console.log("  chart: " + JSON.stringify(chart));
  ok(!!chart, "B1 the card draws a chart");
  if (chart) {
    eq(chart.type, "bar", "B2 bars, not a line — a second net-worth line would just " +
       "restate the Account Value chart");
    ok(chart.xStacked && chart.yStacked, "B3 stacked on both axes, so a bar's extent is the month's change");
    eq(chart.sets.length, 2, "B4 two segments and no category split");
    eq(chart.sets.map((s) => s.label).join(","), "Invested,Market", "B5 the two things that move net worth");
    ok(chart.sets[0].stack === chart.sets[1].stack, "B6 in one stack");

    // Only months with a change get a bar; May has nothing to compare against.
    eq(chart.labels.length, 2, "B7 the first snapshot has no bar — there is nothing to compare it against");
    eq(chart.labels[0], "Jun 2025", "B8 oldest on the left");
    eq(chart.labels[1], "Jul 2025", "B9 newest on the right");

    // Same arithmetic as the rows: Jun +50k invested / +1.5L market, Jul +30k / −80k.
    eq(JSON.stringify(chart.sets[0].data), JSON.stringify([50000, 30000]),
       "B10 the invested segment carries the contributions");
    eq(JSON.stringify(chart.sets[1].data), JSON.stringify([150000, -80000]),
       "B11 and the market segment the remainder, negative when the market lost");

    // A losing month must not be drawn in the gaining colour. Asserted against
    // the specific hues, not merely "the two differ" — Jun is faded and Jul is
    // not, so a difference exists even when both are green.
    const UP = "16,185,129", DOWN = "232,98,58";   // #10B981 / #E8623A
    ok(String(chart.sets[1].colors[0]).includes(UP),
       "B12 the gaining month is drawn in the gain colour", chart.sets[1].colors[0]);
    ok(String(chart.sets[1].colors[1]).toUpperCase() === "#E8623A",
       "B12b and the losing month in the loss colour", chart.sets[1].colors[1]);
    ok(!String(chart.sets[1].colors[1]).includes(UP) && DOWN.length > 0,
       "B12c specifically, a loss is never drawn as a gain", chart.sets[1].colors);
    // Jun is measured from May, which is a reconstruction — so it is faded.
    ok(/rgba/.test(String(chart.sets[0].colors[0])) && !/rgba/.test(String(chart.sets[0].colors[1])),
       "B13 a month measured from a reconstruction is faded, while a fully recorded one is solid",
       chart.sets[0].colors);
  }

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
