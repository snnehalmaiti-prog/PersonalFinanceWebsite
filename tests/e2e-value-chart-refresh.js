// The value charts skip a render whose inputs match the last completed one.
// That saves real work — a refresh used to build each chart four times and three
// of those were byte-identical — but it introduces exactly one new way to be
// wrong: a chart that stops updating when something DID change.
//
// So this suite does not check that the skip happens. It checks that every input
// the skip's key claims to cover actually forces a redraw when it changes, and
// that the redraw lands on the right numbers. An input missing from the key shows
// up here as a chart frozen on the previous portfolio's figures.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-value-chart-refresh.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"];
const FI_HDR = ["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Amount"];

// Two portfolios of deliberately different size, so switching between them moves
// every figure by an amount that cannot be mistaken for noise. Plus fixed income,
// so the exclusion toggles have something to exclude.
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2023", "Alpha", "Fund A", "Buy", "1000", "10"],
    ["1-Jan-2023", "Beta", "Fund A", "Buy", "5000", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  // Both portfolios carry the SAME fixed income on the SAME dates. That matters:
  // it makes Alpha and Beta structurally identical — same instrument, same dates,
  // same row counts — differing only in how many units are held. Every derived
  // length in the render key is then equal between them, so the only thing that
  // can tell them apart is the portfolio name itself. Without that, switching
  // between them leaves the chart showing the other one's money.
  "wf-fd-data": [FD_HDR,
    ["1-Feb-2023", "Alpha", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "400000", "", "3%"],
    ["1-Feb-2023", "Beta", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "400000", "", "3%"]],
  "wf-fixedincome-data": [FI_HDR,
    ["1-Feb-2023", "Alpha", "EPF", "Fixed Income", "Provident Fund", "Deposit", "250000"],
    ["1-Feb-2023", "Beta", "EPF", "Fixed Income", "Provident Fund", "Deposit", "250000"]],
};

const START = "2023-01-01", END = "2024-12-01";
function days() { const o = []; const d = new Date(START + "T00:00:00"), e = new Date(END + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; }
function navSeries() { let n = 10;
  return days().map((iso) => { n *= 1.0005; const [y, m, dd] = iso.split("-");
    return { date: `${dd}-${m}-${y}`, nav: n.toFixed(4) }; }).reverse(); }
function idxPrices(rate) { const o = {}; let n = 1000; days().forEach((iso) => { n *= rate; o[iso] = +n.toFixed(2); }); return o; }

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

const READ = () => {
  const g = window.__wfValueChart, a = window.__wfPortfolioValueChart;
  const pts = g ? (g.data.datasets[0].data || []).filter((q) => q && q.y != null) : [];
  const apts = a ? (a.data.datasets[0].data || []).filter((q) => q && q.y != null) : [];
  return {
    builds: window.__vcBuilds,
    growthLast: pts.length ? Math.round(pts[pts.length - 1].y) : null,
    accountLast: apts.length ? Math.round(apts[apts.length - 1].y) : null,
    idxName: (g && g.data.datasets[1]) ? g.data.datasets[1].label : null,
    idxLast: (() => { const d = g && g.data.datasets[1];
      const q = d ? (d.data || []).filter((x) => x && x.y != null) : [];
      return q.length ? Math.round(q[q.length - 1].y) : null; })(),
    accountValue: (document.getElementById("pvc-current-value") || {}).textContent,
  };
};

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: navSeries() })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: 1, data: { INF1: "100033" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: {} })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {},
    // Two indices that diverge, so switching benchmark must visibly move the dashed line.
    index_history: { NIFTY50: { prices: idxPrices(1.0002) }, NIFTY500: { prices: idxPrices(1.0008) } } })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  await p.addInitScript(() => {
    window.__vcBuilds = 0;
    window.Chart = function (ctx, cfg) {
      const c = ctx && ctx.canvas ? ctx.canvas : ctx;
      if (c && (c.id === "value-chart" || c.id === "portfolio-value-chart")) window.__vcBuilds++;
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(11000);

  const all = await p.evaluate(READ);
  console.log("  all portfolios " + JSON.stringify(all));
  ok(all.growthLast != null && all.accountLast != null, "S1 both charts rendered", all);

  // The skip has to actually be skipping, or the rest of this suite proves nothing
  // about it. Four builds is two renders x two charts; without the skip it is 8-10.
  ok(all.builds <= 6, "S2 a plain load no longer rebuilds the charts over and over",
     all.builds);

  // Calling the renderer again with nothing changed must not rebuild.
  const again = await p.evaluate(async () => {
    const before = window.__vcBuilds;
    document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
    await new Promise((r) => setTimeout(r, 2500));
    return { before, after: window.__vcBuilds };
  });
  ok(again.after === again.before,
     "S3 re-triggering a render with unchanged inputs does no work at all", again);

  // ── every input the key claims to cover must force a redraw ──
  async function change(label, mutate, wait) {
    const before = await p.evaluate(READ);
    await p.evaluate(mutate);
    await p.waitForTimeout(wait || 5000);
    const after = await p.evaluate(READ);
    console.log("  " + label + "  " + JSON.stringify({ before: [before.growthLast, before.accountLast, before.idxLast],
                                                       after: [after.growthLast, after.accountLast, after.idxLast],
                                                       builds: after.builds - before.builds }));
    return { before, after };
  }

  // Portfolio: Beta holds 5x what Alpha does, so the Account Value chart must move.
  {
    // Through the real control: renderValueChart is not exposed on window, and
    // selectPortfolio does more than write the key.
    const r = await change("portfolio Alpha", () => {
      const opt = [...document.querySelectorAll(".portfolio-option")]
        .find((e) => (e.textContent || "").trim() === "Alpha");
      if (opt) opt.click();
    });
    ok(r.after.builds > r.before.builds,
       "P1 switching portfolio redraws — the key must include it", r.after.builds - r.before.builds);
    ok(r.after.accountLast !== r.before.accountLast,
       "P2 and the Account Value chart shows the new portfolio, not the old one",
       [r.before.accountLast, r.after.accountLast]);
  }

  // Alpha -> Beta. Structurally identical, five times the units. This is the case
  // that only the portfolio name in the key can catch.
  {
    const r = await change("portfolio Beta", () => {
      const opt = [...document.querySelectorAll(".portfolio-option")]
        .find((e) => (e.textContent || "").trim() === "Beta");
      if (opt) opt.click();
    });
    ok(r.after.accountLast !== r.before.accountLast,
       "P3 switching between two same-shaped portfolios still redraws — nothing " +
       "but the portfolio name distinguishes them", [r.before.accountLast, r.after.accountLast]);
    ok(r.after.accountLast > r.before.accountLast,
       "P4 and Beta, holding five times the units, reads higher than Alpha",
       [r.before.accountLast, r.after.accountLast]);
  }

  // Benchmark: a different index with a different growth rate.
  {
    const r = await change("benchmark NIFTY500", () => {
      localStorage.setItem("wf-benchmark-index", "NIFTY500");
      document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
    });
    ok(r.after.idxLast !== r.before.idxLast,
       "B1 switching benchmark redraws the index line — the key must include it",
       [r.before.idxLast, r.after.idxLast]);
  }

  // Fixed-income exclusion: Alpha holds ₹6.5L of it, so the Account Value chart
  // must drop by roughly that when it is excluded.
  {
    // The real key is wf-exclude-fixedincome and the value is the string "true";
    // the first version of this test used a plausible-looking key that does not
    // exist, so the toggle never moved and the chart was right to stay put.
    const r = await change("exclude fixed income", () => {
      localStorage.setItem("wf-exclude-fixedincome", "true");
      document.dispatchEvent(new CustomEvent("wf-overview-flows-ready"));
    });
    ok(r.after.accountLast !== r.before.accountLast,
       "E1 excluding fixed income redraws the Account Value chart — the key must include it",
       [r.before.accountLast, r.after.accountLast]);
    ok(r.after.accountLast < r.before.accountLast,
       "E2 and it drops, since fixed income was removed from it",
       [r.before.accountLast, r.after.accountLast]);
  }

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
