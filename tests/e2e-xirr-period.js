// Period (1Y/2Y/3Y/5Y/10Y) portfolio XIRR, end to end in a real browser.
//
// A period window is measured as: opening mark at the cutoff → cash flows inside
// the window → terminal today. The one invariant that makes it meaningful is that
// BOTH ends value the same holdings by the same rule. Every bug this file guards
// against is a violation of that invariant in the same direction — something that
// gets a terminal but no opening mark, so growth earned long before the window
// lands inside it and is then annualised over the window.
//
// The fixture is a fixed-income-heavy portfolio, because that is where the two
// worst offenders lived:
//
//   FD  : Rs 10,00,000 opened 5 years ago at 8% (quarterly), maturing in 5 more.
//         Marked at PAR in the opening mark and at its ACCRUED value in the
//         terminal, it handed a 1Y window four years of interest.
//   PF  : Rs 1,00,000/yr for 5 years, 8% EPF. The opening mark read contributed
//         PRINCIPAL (deposits minus withdrawals, interest rows skipped) while the
//         terminal read principal PLUS all accrued interest, so the entire accrued
//         balance landed inside whichever window was selected.
//
// Both are still held, neither pays a cash flow inside the last year, so a correct
// 1Y XIRR is just their own ~8% growth rate. The broken one reads far higher.
//
// NOT in run-all.js — needs a static server and Playwright's Chromium.
//
//     node tests/run-browser.js e2e-xirr-period.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const YEAR_MS = 365.25 * 864e5;
const TODAY = new Date();
function shiftYears(y) { return new Date(TODAY.getTime() - y * YEAR_MS); }
function iso(d) { return d.toISOString().slice(0, 10); }
function sheetDate(d) {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d.getDate() + "-" + M[d.getMonth()] + "-" + d.getFullYear();
}

const FD_PRINCIPAL = 1000000, FD_RATE = 0.08;
const FD_OPEN = shiftYears(5), FD_MATURITY = new Date(TODAY.getTime() + 5 * YEAR_MS);
const PF_DEPOSIT = 100000, PF_YEARS = 5;

// A small mutual fund leg, priced flat, so the equity side of the opening mark and
// the terminal exist but contribute no return of their own — anything the card
// reports above ~8% is the fixed-income legs leaking.
const MF_UNITS = 100, MF_NAV = 100; // Rs 10,000, bought 5 years ago, flat ever since

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
                "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"];

const pfRows = [];
for (let i = PF_YEARS; i >= 1; i--) {
  pfRows.push([sheetDate(shiftYears(i)), "Snnehal", "", "EPF Account", "Fixed Income",
               "Provident Fund", "Deposit", String(PF_DEPOSIT), "", ""]);
}

const SHEETS = {
  "wf-equity-data": [TXN, [sheetDate(shiftYears(5)), "Snnehal", "Fund A", "Buy", String(MF_UNITS), String(MF_NAV)]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [FD_HDR,
    [sheetDate(FD_OPEN), "Snnehal", "HDFC", "FD One", "Fixed Income", "Fixed Deposit", "Buy",
     String(FD_PRINCIPAL), sheetDate(FD_MATURITY), "8%"],
    ...pfRows],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

// NAV history: flat at MF_NAV for the whole span, so the fund neither adds nor
// removes return at any cutoff.
function navSeries() {
  const out = [];
  for (let d = new Date(FD_OPEN); d <= TODAY; d.setDate(d.getDate() + 7)) {
    const s = iso(d).split("-");
    out.push({ date: `${s[2]}-${s[1]}-${s[0]}`, nav: String(MF_NAV) });
  }
  return out.reverse();
}
function indexPrices() {
  const o = {};
  for (let d = new Date(FD_OPEN); d <= TODAY; d.setDate(d.getDate() + 1)) o[iso(d)] = 1000;
  return o;
}

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await p.route("**://*.supabase.co/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: navSeries() }) }));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: { INF1: "100033" } }) }));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ fetchedAt: 1, data: { "100033": MF_NAV } }) }));
  await p.route("**/stock_prices.json*", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: { NIFTY50: { prices: indexPrices() } } }) }));
  await p.route("**/stock_history.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stock_history: {} }) }));
  await p.addInitScript(() => {
    window.__charts = {};
    window.Chart = function (c, cfg) { window.__charts[c && c.canvas ? c.canvas.id : "?"] = cfg;
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.data = cfg && cfg.data; this.options = cfg && cfg.options; this.scales = { x: {}, y: {} };
      this.getElementsAtEventForMode = function () { return []; }; };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    localStorage.setItem("wf-benchmark-period", "all");
    // EPF interest only accrues for financial years with a configured rate, so a
    // fixture without this map holds every provident fund at cost and cannot tell
    // the principal-vs-balance bugs apart from correct behaviour.
    const rates = [];
    for (let y = new Date().getFullYear() - 8; y <= new Date().getFullYear(); y++) rates.push({ year: y, rate: 8 });
    localStorage.setItem("wf-epf-interest-rates", JSON.stringify(rates));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
  }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(10000);

  const num = (t) => parseFloat(String(t || "").replace(/[^0-9.\-]/g, ""));
  async function readPeriod(period) {
    await p.evaluate((per) => {
      const btn = document.querySelector('.bench-period-row .range-pill[data-period="' + per + '"]');
      if (btn) btn.click();
    }, period);
    await p.waitForTimeout(4500);
    return p.evaluate(() => ({
      port: (document.getElementById("benchmark-portfolio-xirr") || {}).textContent,
      subtitle: (document.getElementById("benchmark-subtitle") || {}).textContent,
    }));
  }

  let pass = 0, fail = 0;
  function ok(cond, name, detail) {
    if (cond) { pass++; console.log("  PASS  " + name); }
    else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
  }

  // Everything in this fixture compounds at 8%/yr and pays no cash flow inside the
  // last three years, so every window short enough to contain no PF deposit must
  // report ~8%. The MF is flat, which drags very slightly below 8% in proportion to
  // its (tiny) weight — hence a band rather than a point.
  const results = {};
  for (const per of ["1", "2", "3", "5", "all"]) results[per] = await readPeriod(per);
  console.log("\nReported: " + JSON.stringify(results, null, 2) + "\n");

  const oneY = num(results["1"].port);
  ok(isFinite(oneY), "A1 the 1Y window reports a rate at all", results["1"].port);
  ok(oneY > 6 && oneY < 9,
     "A2 1Y on an 8% fixed-income book reads ~8%, not the whole accrued balance", oneY);

  const twoY = num(results["2"].port);
  ok(twoY > 6 && twoY < 9, "A3 2Y likewise", twoY);
  const threeY = num(results["3"].port);
  ok(threeY > 6 && threeY < 9, "A4 3Y likewise", threeY);

  // 5Y reaches back past the PF deposits and the FD's opening, so it is the whole
  // history: still ~8%, and now for the all-time reason rather than the window one.
  const fiveY = num(results["5"].port);
  ok(fiveY > 5 && fiveY < 10, "A5 5Y covers the whole book and stays in range", fiveY);

  // The invariant that ties it together: no window may exceed the all-time figure
  // by a wide margin when the portfolio grew at one steady rate throughout.
  const allT = num(results["all"].port);
  ok(isFinite(allT) && Math.abs(oneY - allT) < 3,
     "A6 a steadily-compounding book reports the same rate on 1Y as all-time", [oneY, allT]);

  // CAGR mode reads the same book off the TWR NAV series instead of cash flows.
  // It had the principal-vs-balance mismatch pointing the OTHER way: the series'
  // fixed-income leg carried a provident fund at contributed principal forever, so
  // its contributions were netted out as external flows while the interest they
  // earned was never added back — a book that grew at 8% reported ~0% growth on
  // its PF share. Both metrics describe the same portfolio and must agree on it.
  await p.evaluate(() => { const b = document.getElementById("bench-mode-cagr"); if (b) b.click(); });
  await p.waitForTimeout(3000);
  const cagr = {};
  for (const per of ["1", "3", "all"]) cagr[per] = await readPeriod(per);
  console.log("CAGR mode: " + JSON.stringify(cagr, null, 2) + "\n");

  const cagr1 = num(cagr["1"].port);
  ok(isFinite(cagr1), "B1 CAGR mode reports a rate for 1Y", cagr["1"].port);
  ok(cagr1 > 7.5 && cagr1 < 8.7,
     "B2 the 1Y CAGR of an 8% book is ~8%, not diluted by a PF held at cost", cagr1);
  ok(Math.abs(cagr1 - oneY) < 1.5,
     "B3 CAGR and XIRR agree on a book with no cash flows inside the window", [cagr1, oneY]);

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
