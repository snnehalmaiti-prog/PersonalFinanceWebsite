// The Account Value chart when a portfolio holds no equity.
//
// renderValueChart gives up when there is no fund, stock or commodity to plot —
// Growth-of-₹100 has nothing to compare against an equity index. It used to
// return from there having destroyed only the Growth chart, so the Account Value
// canvas kept whichever portfolio was selected before, and syncAccountValueTail
// then patched that stale line's last point to the NEW portfolio's total. The
// result read as a plausible chart of the wrong person: right final figure,
// entirely someone else's history.
//
// Snnehal holds a fund and a deposit; Trisha holds only a savings balance and a
// deposit. Switching between them is the whole test.
//
//     python3 -m http.server 8104 &
//     node tests/e2e-value-chart-fi-only.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8104;

const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

const SHEETS = {
  "wf-equity-data": [TXN, ["1-Jan-2024", "Snnehal", "Aurora Fund", "Buy", "1000", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Aurora Fund", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [FD_HDR,
    ["1-Jan-2024", "Snnehal", "HDFC", "Sn Deposit", "Fixed Income", "Fixed Deposit", "Deposit", "500000", "1-Jan-2030", "7%", ""],
    // Trisha: no fund, no stock, no gold. Only a balance and a deposit.
    ["1-Jan-2022", "Trisha", "HDFC", "Tr Savings", "Fixed Income", "Savings Account", "Deposit", "300000", "", "", ""],
    ["1-Jan-2023", "Trisha", "HDFC", "Tr Deposit", "Fixed Income", "Fixed Deposit", "Deposit", "200000", "1-Jan-2030", "7%", ""]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const num = (s) => Number(String(s || "").replace(/[^0-9.-]/g, ""));

const monthlyNav = () => {
  const out = [];
  const now = new Date();
  for (let i = 30; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    if (d < new Date(2024, 0, 1)) continue;
    out.push({ date: String(d.getDate()).padStart(2, "0") + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" + d.getFullYear(), nav: String(10 + i * 0.05) });
  }
  return out;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
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

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    localStorage.setItem("wf-selected-portfolio", "all");
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
  }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(7000);

  const chart = () => p.evaluate(() => {
    const c = window.__wfPortfolioValueChart;
    const d = c && c.data.datasets[0] ? c.data.datasets[0].data : null;
    return {
      exists: !!c,
      points: d ? d.length : 0,
      first: d && d.length ? d[0].y : null,
      last: d && d.length ? d[d.length - 1].y : null,
      firstDate: d && d.length ? new Date(d[0].x).toISOString().slice(0, 10) : null,
      readout: (document.getElementById("pvc-current-value") || {}).textContent,
      current: (document.getElementById("overview-total-current-value") || {}).textContent,
    };
  });
  const pick = async (name) => {
    await p.evaluate((n) => {
      const opt = Array.prototype.slice.call(
        document.querySelectorAll("#portfolio-menu .portfolio-option"))
        .find((e) => (e.textContent || "").trim() === n);
      if (opt) opt.click();
    }, name);
    await p.waitForTimeout(3500);
    return chart();
  };

  const all = await chart();
  console.log("  all: " + JSON.stringify(all));
  ok(all.exists && all.points > 2, "S1 the household charts, as it always did", all);

  const sn = await pick("Snnehal");
  console.log("  Snnehal: " + JSON.stringify(sn));
  ok(sn.exists && sn.points > 2, "S2 so does a portfolio holding a fund", sn);

  // The case that was broken.
  const tr = await pick("Trisha");
  console.log("  Trisha: " + JSON.stringify(tr));
  ok(tr.exists, "S3 a portfolio holding only fixed income still has a chart", tr);
  ok(tr.points > 2, "S4 with a real series, not a single point", tr);
  ok(tr.first !== sn.first || tr.last !== sn.last,
     "S5 and it is Trisha's, not the chart Snnehal left behind",
     { tr: { first: tr.first, last: tr.last }, sn: { first: sn.first, last: sn.last } });
  // Trisha's history starts in Jan 2022 with her savings balance; Snnehal's
  // fund only starts in 2024, so the start date alone tells the two apart.
  ok(tr.firstDate < "2023-01-01",
     "S6 starting when her savings balance did, not when his fund did",
     { tr: tr.firstDate, sn: sn.firstDate });
  ok(Math.abs(num(tr.readout) - num(tr.current)) <= 1,
     "S7 ending on her Current figure — the tail is snapped to a line that is " +
     "actually hers, rather than patched onto someone else's",
     { readout: tr.readout, current: tr.current });
  ok(tr.last > 400000 && tr.last < 700000,
     "S8 a plausible size for ₹3,00,000 saved and ₹2,00,000 on deposit", tr.last);
  // The savings balance predates the deposit, so the line must step up.
  ok(tr.first < tr.last, "S9 and it grows across her history", { first: tr.first, last: tr.last });

  const back = await pick("Snnehal");
  ok(back.exists && back.firstDate >= "2023-06-01",
     "S10 switching back gives Snnehal his own chart again, not hers",
     { first: back.firstDate });

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
