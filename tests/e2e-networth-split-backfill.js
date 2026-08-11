// Net Worth · Monthly, filtered by portfolio, against a table that predates the
// filter.
//
// e2e-networth-monthly.js proves the filter works when every snapshot carries a
// by_portfolio split. Every real table has months that do not: the rows were
// written before the card could filter, and planBackfill will never revisit them
// — it writes only dates it does not already have. Against that table the
// selector does nothing, which is exactly what it looked like from the outside.
//
// The fixture reproduces that state rather than describing it: run one load to
// let the backfill write real history, strip the splits back out the way an
// older build would have left them, and reload.
//
//     python3 -m http.server 8100 &
//     node tests/e2e-networth-split-backfill.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8100;

const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

const sheets = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Aurora Fund", "Buy", "100", "10"],
    ["1-Jan-2024", "Trisha", "Aurora Fund", "Buy", "50", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Aurora Fund", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [FD_HDR,
    ["1-Apr-2020", "Snnehal", "HDFC", "Deposit One", "Fixed Income", "Fixed Deposit", "Deposit", "500000", "1-Apr-2030", "7%", ""],
    ["1-Apr-2021", "Trisha", "HDFC", "Deposit Two", "Fixed Income", "Fixed Deposit", "Deposit", "200000", "1-Apr-2030", "7%", ""]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

const monthlyNav = () => {
  const out = [];
  const now = new Date();
  for (let i = 30; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    if (d < new Date(2024, 0, 1)) continue;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    out.push({ date: dd + "-" + mm + "-" + d.getFullYear(), nav: String(10 + i * 0.05) });
  }
  return out;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  // A table that remembers what was written to it, so the second load sees the
  // first load's history — the whole point of the fixture.
  let table = [];
  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

  await p.route("**://*.supabase.co/**", (r) => {
    const req = r.request(), url = req.url();
    if (/net_worth_snapshots/.test(url)) {
      if (req.method() === "POST") {
        let body = null;
        try { body = JSON.parse(req.postData() || "null"); } catch (e) {}
        const rows = Array.isArray(body) ? body : [body];
        rows.forEach((row) => {
          if (!row || !row.snapshot_date) return;
          const at = table.findIndex((t) => t.snapshot_date === row.snapshot_date);
          if (at === -1) table.push(Object.assign({}, row));
          else table[at] = Object.assign({}, table[at], row);
        });
        return r.fulfill({ status: 201, contentType: "application/json",
          headers: { "access-control-allow-origin": "*" }, body: "[]" });
      }
      // The reader asks for select=*; the backfill asks for the dates only.
      const datesOnly = /select=snapshot_date(&|$)/.test(url);
      return r.fulfill(j(datesOnly
        ? table.map((t) => ({ snapshot_date: t.snapshot_date }))
        : table.slice().sort((a, x) => (a.snapshot_date < x.snapshot_date ? -1 : 1))));
    }
    return r.fulfill(j([]));
  });
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://*.currency-api.pages.dev/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: monthlyNav() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: { "100001": monthlyNav() } })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: "01-Aug-2026", nav: "12.5" } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  const load = async () => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      localStorage.setItem("wf-selected-portfolio", "all");
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
    }, sheets);
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    // The backfill fires 800ms after the Account Value chart renders, which
    // itself waits on NAV history.
    await p.waitForTimeout(9000);
  };

  const pick = async (name) => {
    await p.evaluate((n) => { localStorage.setItem("wf-selected-portfolio", n); }, name);
    await p.evaluate(() => window.renderNetWorthMonthly && window.renderNetWorthMonthly());
    await p.waitForTimeout(1200);
    return p.evaluate(() => {
      const c = window.__wfNwmChart;
      const tot = {};
      document.querySelectorAll("#nwm-split .mic-hs-tot").forEach((el) => {
        tot[(el.querySelector(".mic-hs-tot-label") || {}).textContent] =
          (el.querySelector("b") || {}).textContent;
      });
      const bars = c && c.data.datasets
        ? c.data.datasets.reduce((n, d) => n + d.data.filter((v) => v != null && v !== 0).length, 0)
        : 0;
      return { labels: c ? c.data.labels : [], bars: bars, stats: tot };
    });
  };
  const num = (s) => Number(String(s || "").replace(/[^0-9.]/g, ""));

  // ── 1. a normal load, writing history from scratch ──────────────────────
  await load();
  ok(table.length > 2, "S1 the backfill wrote a history to work with", table.length);
  const withSplit = table.filter((r) => r.by_portfolio && Object.keys(r.by_portfolio).length);
  ok(withSplit.length > 0,
     "S2 and today's build records each portfolio's share on the rows it writes",
     table.slice(0, 2));

  // ── 2. the table as an older build left it ──────────────────────────────
  // Strip every split. This is the state of any table whose history was written
  // before the card could filter — which is every real one.
  const total = table.length;
  table = table.map((r) => Object.assign({}, r, { by_portfolio: null }));
  ok(table.every((r) => !r.by_portfolio),
     "S3 the fixture now holds history with no split, as a real table does");

  await load();

  const all = await pick("all");
  const sn = await pick("Snnehal");
  const tr = await pick("Trisha");
  console.log("  months: " + JSON.stringify({ all: all.bars, Snnehal: sn.bars, Trisha: tr.bars }));
  console.log("  closing: " + JSON.stringify({ all: all.stats.Closing,
    Snnehal: sn.stats.Closing, Trisha: tr.stats.Closing }));

  ok(all.bars > 0, "S4 the household still charts", all);

  // The bug: with no split stored, forPortfolio drops every row and the card
  // goes blank for a portfolio — the selector appears to do nothing.
  ok(sn.bars > 0,
     "S5 selecting a portfolio still charts its history, rather than emptying " +
     "the card because the stored rows carry no split", sn);
  ok(tr.bars > 0, "S6 and so does the other portfolio", tr);
  ok(num(sn.stats.Closing) > 0 && num(tr.stats.Closing) > 0,
     "S7 each has its own closing figure", { sn: sn.stats, tr: tr.stats });
  ok(num(sn.stats.Closing) < num(all.stats.Closing),
     "S8 which is smaller than the household's",
     { sn: sn.stats.Closing, all: all.stats.Closing });
  // The property the reconstruction stands on: a month's portfolios add up to
  // that month's household total.
  //
  // Exact for every month but the newest. That one is the series' final point,
  // which renderValueChart snaps to the Overview's current total — a figure
  // computed by a different path from the chart's own arithmetic, so the two
  // can differ slightly at the tail. The size of that difference is checked
  // separately below, because it is the thing FD accrual was fixed to shrink.
  const allReconstructed = table
    .filter((r) => r.meta && r.meta.source === "backfill" && r.by_portfolio)
    .sort((a, x) => (a.snapshot_date < x.snapshot_date ? -1 : 1));
  const reconstructed = allReconstructed.slice(0, -1);
  const offBy = reconstructed
    .map((r) => ({ date: r.snapshot_date, total: Number(r.total),
      sum: Object.keys(r.by_portfolio).reduce((s, k) => s + Number(r.by_portfolio[k]), 0) }))
    .filter((r) => Math.abs(r.total - r.sum) > 2);
  ok(reconstructed.length > 3 && offBy.length === 0,
     "S9 and in every repaired month the portfolios sum to the household — if " +
     "they do not, the reconstruction has drifted from the series it patches",
     { checked: reconstructed.length, off: offBy.slice(0, 3) });

  // The newest month, where the chart's arithmetic meets the Overview's total.
  // The fixture holds two FDs opened in 2020 and 2021, so before the chart
  // valued deposits with their accrued interest this row was out by ~34% — the
  // entire interest earned since. What is left is the small residue of two
  // valuation paths meeting, not a missing term.
  const tail = allReconstructed[allReconstructed.length - 1];
  const tailSum = Object.keys(tail.by_portfolio)
    .reduce((s2, k) => s2 + Number(tail.by_portfolio[k]), 0);
  const tailGapPct = Math.abs(Number(tail.total) - tailSum) / Number(tail.total) * 100;
  console.log("  tail gap: " + tailGapPct.toFixed(2) + "%");
  ok(tailGapPct < 1,
     "S9b and the newest month is within 1% of reconciling, where it used to be " +
     "out by every rupee of interest the deposits had ever earned",
     { date: tail.snapshot_date, total: tail.total, sum: tailSum, pct: tailGapPct });

  // The repair has to be durable — the next load must not have to redo it.
  const repaired = table.filter((r) => r.by_portfolio && Object.keys(r.by_portfolio).length);
  ok(repaired.length >= total - 1,
     "S10 the splits were written back to the table — nearly every row, not " +
     "just the one today's load recorded live",
     { repaired: repaired.length, total: total });
  ok(table.length === total,
     "S11 without inventing rows: the repair patches history, it does not extend it",
     { now: table.length, before: total });
  // A recorded total is a record. A reconstruction may fill in its missing
  // split, but must never restate what the row says the net worth was.
  ok(table.every((r) => r.total != null && Number(r.total) > 0),
     "S12 and every row still carries the total it was written with");

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
