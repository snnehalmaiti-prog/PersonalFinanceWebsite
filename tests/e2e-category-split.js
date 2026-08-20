// Category Split — a gold ETF must be counted in Commodity exactly once.
//
// computePortfolioCurrentBreakdown already moves commodity-category funds/ETFs
// out of Equity and into Commodity. renderInstrumentSplitChart used to apply that
// same move a second time, which double-counted the ETF in Commodity and
// subtracted it twice from Equity. The error was net-zero on the grand total, so
// the card still reconciled and nothing looked wrong — the only way to catch it
// is to assert the per-category figures against known holdings.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-category-split.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

// ₹10,000/gram exactly: 311035 / 31.1035.
const XAU_INR = 311035;
const GRAMS = 5;
const PHYSICAL = GRAMS * 10000;          // 50,000

const ETF_UNITS = 270, ETF_PRICE = 100;
const ETF = ETF_UNITS * ETF_PRICE;       // 27,000

const EQ_UNITS = 100, EQ_NAV = 50;
const EQUITY = EQ_UNITS * EQ_NAV;        // 5,000

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN, ["1-Jan-2024", "Snnehal", "Fund A", "Buy", String(EQ_UNITS), "40"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN, ["1-Jan-2024", "Snnehal", "GOLDBEES", "Buy", String(ETF_UNITS), "80"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    // Commodity in the MAPPING sheet — the whole point: it lives in the equity
    // sheet but is not Equity.
    ["GOLDBEES", "Commodity", "Gold", "ETF", "India", "GOLDBEES", "Gold"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"],
    ["1-Jan-2024", "Snnehal", "—", "Physical Gold", "Commodity", "Gold", "Buy", "", "", "", String(GRAMS)]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const DAYS = (() => { const o = []; const d = new Date("2024-01-01T00:00:00"), e = new Date("2024-12-01T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; })();
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dmyNum = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
const dmyMon = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${MON[+m - 1]}-${y}`; };
const LAST = DAYS[DAYS.length - 1];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1 : tol);

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  // Both the live and the dated gold URLs end in xau.min.json — one rate for
  // every date keeps physical current == physical invested, so any drift in the
  // Commodity figure can only come from the ETF leg.
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: XAU_INR } })));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: XAU_INR } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({
    data: DAYS.map((iso) => ({ date: dmyNum(iso), nav: String(EQ_NAV) })).reverse() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ updated: new Date().toISOString(),
    mf_history: { "100001": Object.fromEntries(DAYS.map((iso) => [iso, EQ_NAV])) } })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: dmyMon(LAST), nav: String(EQ_NAV) } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: 84 }, GOLDBEES: { price: ETF_PRICE } },
    usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  await p.addInitScript(() => {
    window.Chart = function (ctx, cfg) {
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
    // Explicit 0% premium: this suite is about double-counting, not the premium.
    localStorage.setItem("wf-gold-premium-pct", "0");
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(Number(process.env.WAIT || 10000));

  // Wait for the card to SETTLE rather than trusting the fixed timeout above.
  // The total renders before the rows do, so a slower machine read a correct
  // total against a partly-built list — one category present, another still at
  // ₹0 — which looks exactly like the double-count bug this suite exists to
  // catch. Waiting for "at least one row" was not enough: it accepts the list
  // mid-render, which is how this failed in CI while passing locally.
  //
  // "Rows add up to the total" is not enough either: the card re-renders as each
  // data source lands — the ETF price first, then gold, then the NAV — and it is
  // self-consistent at every one of those intermediate stages. It shows ₹27,000
  // over a single Commodity row long before the ₹82,000 answer exists.
  //
  // So the predicate is quiescence: the list and total stop changing. That is
  // the only signal here that means "every source has landed", and it bakes in
  // no expected value, so it cannot paper over a wrong figure — a card that
  // settles on the wrong number still fails the assertions below.
  //
  // gate is an optional MODE guard, not a value guard. In Region mode the card
  // first paints the Portfolio breakdown (a "Snnehal" row) from cached data and
  // only THEN swaps in the Region rows once _renderRegionSplit runs — so under
  // CI load the portfolio paint can go quiescent and be read before the region
  // swap ever happens, which is exactly how this suite failed in CI while
  // passing locally (the list showed "Snnehal", India scored ₹0, and that reads
  // identically to the double-count bug). Passing gate=/India|US/ holds the
  // settle off until the region view is on screen. It keys on the row NAME the
  // mode produces, never on an amount, so a wrong figure — a double-counted
  // India of ₹104,000, or a genuine failure to render that leaves India at ₹0
  // (times out, then fails) — still fails the assertions below.
  const rowsReady = async (listId, totalId, gate) => {
    const read = () => p.evaluate(([lid, tid]) => {
      const l = document.getElementById(lid), t = document.getElementById(tid);
      return (l ? l.textContent.replace(/\s+/g, " ").trim() : "") +
             " | " + (t ? t.textContent.trim() : "");
    }, [listId, totalId]);
    let prev = null, stable = 0;
    // ~50s ceiling. A settled card returns in the first second or two, so this
    // bound only bites when a source is genuinely slow — a loaded CI runner
    // resolving the region breakdown behind the initial portfolio paint — and
    // the extra headroom there is what keeps a slow-but-correct render from
    // being scored as a missing row.
    for (let i = 0; i < 100; i++) {
      const cur = await read();
      // A figure has to be on screen: an empty card is trivially unchanging. And
      // when a mode gate is given, the mode's content has to be up first.
      const ready = /\d/.test(cur) && (!gate || gate.test(cur));
      if (cur === prev && ready) { if (++stable >= 2) return; }
      else stable = 0;
      prev = cur;
      await p.waitForTimeout(500);
    }
    console.log("  (timed out waiting for #" + listId + " to settle; last: " + prev + ")");
  };

  const money = (t) => Number(String(t || "").replace(/[^0-9.]/g, "")) || 0;
  await rowsReady("iscat-list", "iscat-total-value");
  const split = await p.evaluate(() => {
    const out = { total: (document.getElementById("iscat-total-value") || {}).textContent, rows: {} };
    document.querySelectorAll("#iscat-list .isc-row").forEach((r) => {
      const n = r.querySelector(".isc-row-name"), v = r.querySelector(".isc-row-amount");
      if (n && v) out.rows[n.textContent.trim()] = v.textContent;
    });
    return out;
  });
  console.log("  Category Split: " + JSON.stringify(split));

  const comm = money(split.rows["Commodity"]);
  const eq = money(split.rows["Equity"]);
  const total = money(split.total);

  ok(near(comm, PHYSICAL + ETF, 5),
     "C1 Commodity = physical gold + the gold ETF, counted ONCE",
     { got: comm, want: PHYSICAL + ETF, doubleCounted: PHYSICAL + ETF * 2 });
  ok(comm < PHYSICAL + ETF * 1.5,
     "C2 and is nowhere near the double-counted figure", { got: comm });
  ok(near(eq, EQUITY, 5),
     "C3 Equity keeps the non-commodity fund and loses the ETF exactly once",
     { got: eq, want: EQUITY });
  ok(near(total, PHYSICAL + ETF + EQUITY, 5),
     "C4 the grand total reconciles — it did before the fix too, which is why " +
     "the per-category figures are the assertions that matter",
     { got: total, want: PHYSICAL + ETF + EQUITY });
  // ── Region Split: the same double-apply, in the other consumer ──────────
  // _renderRegionSplit rebuilt an "MF only" figure as b.equity − SE total. But
  // computePortfolioCurrentBreakdown had already taken the commodity ETF out of
  // b.equity, so subtracting the full SE total removed it twice, and
  // Math.max(0, …) hid the negative. With no mutual fund to absorb it the clamp
  // fires and the ETF lands in India twice — here the grand total IS wrong,
  // unlike in Category Split.
  await p.evaluate((s) => {
    localStorage.setItem("wf-isc-mode", "region");
    localStorage.setItem("wf-equity-data", JSON.stringify(s));   // no MF holdings
  }, [TXN]);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(Number(process.env.WAIT || 10000));

  await rowsReady("isc-list", "isc-total-value", /India|US/);
  const region = await p.evaluate(() => {
    const out = { total: (document.getElementById("isc-total-value") || {}).textContent, rows: {} };
    document.querySelectorAll("#isc-list .isc-row").forEach((r) => {
      const n = r.querySelector(".isc-row-name"), v = r.querySelector(".isc-row-amount");
      if (n && v) out.rows[n.textContent.trim()] = v.textContent;
    });
    return out;
  });
  console.log("  Region Split (no MF): " + JSON.stringify(region));
  if (!region.rows["India"]) {
    // Say what was actually on the page. A missing row scores as ₹0, which reads
    // exactly like the double-count bug this suite exists to catch, so the
    // failure has to distinguish the two rather than leave it to guesswork.
    console.log("  DIAG " + JSON.stringify(await p.evaluate(() => ({
      iscList: (document.getElementById("isc-list") || {}).innerHTML || "(no #isc-list)",
      iscatList: ((document.getElementById("iscat-list") || {}).innerHTML || "").slice(0, 300),
      mode: localStorage.getItem("wf-isc-mode"),
      status: (document.getElementById("portfolio-split-status") || {}).textContent || ""
    }))));
  }

  ok(near(money(region.rows["India"]), PHYSICAL + ETF, 5),
     "R1 India = physical gold + the India-listed gold ETF, counted ONCE",
     { got: money(region.rows["India"]), want: PHYSICAL + ETF, doubleCounted: PHYSICAL + ETF * 2 });
  ok(near(money(region.total), PHYSICAL + ETF, 5),
     "R2 and the grand total is right — the clamp used to inflate it, so unlike " +
     "Category Split the total IS a real assertion here",
     { got: money(region.total), want: PHYSICAL + ETF });

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
