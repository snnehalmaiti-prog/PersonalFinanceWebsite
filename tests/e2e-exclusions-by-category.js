// The exclusion filters hide by Instrument Category, not by sheet.
//
// This is the same distinction the NET WORTH · MONTHLY breakdown is built on,
// arriving at the toggles. "Exclude Fixed Income" used to mean "hide the FD
// sheet", so a debt fund typed into the equity sheet and a gold ETF typed into
// the stocks sheet both stayed on screen while the physical gold beside them
// disappeared. The toggle is now named for what it hides — Fixed Income AND
// Commodity — and reaches those holdings wherever they are kept. Exclude Equity
// is its mirror image.
//
// So the fixture puts every category in the WRONG sheet on purpose. A version
// that filters by sheet passes nothing here.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-exclusions-by-category.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  // Equity sheet: one real equity fund, one DEBT fund, one GOLD fund.
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Equity Fund", "Buy", "1000", "10"],
    ["1-Jan-2024", "Snnehal", "Debt Fund", "Buy", "500", "20"],
    ["1-Jan-2024", "Snnehal", "Gold Fund", "Buy", "200", "25"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Equity Fund", "Equity", "Flexi Cap", "100001", "INFA"],
    ["Debt Fund", "Fixed Income", "Debt Fund", "100002", "INFB"],
    ["Gold Fund", "Commodity", "Gold Fund", "100003", "INFC"]],
  // Stocks sheet: one real stock, one GOLD ETF.
  "wf-stocksetf-data": [TXN,
    ["1-Jan-2024", "Snnehal", "RELIANCE", "Buy", "100", "100"],
    ["1-Jan-2024", "Snnehal", "GOLDBEES", "Buy", "100", "50"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["RELIANCE", "Equity", "Large Cap", "Stock", "India", "RELIANCE", "Energy"],
    ["GOLDBEES", "Commodity", "Gold ETF", "ETF", "India", "GOLDBEES", "Gold"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
    "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"],
    ["1-Jan-2024", "Snnehal", "HDFC", "FD-1", "Fixed Income", "Fixed Deposit", "Buy", "100000", "1-Jan-2030", "0%", ""]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const DAYS = (() => { const o = []; const d = new Date("2024-01-01T00:00:00"), e = new Date();
  while (d <= e) { const w = d.getDay();
    if (w !== 0 && w !== 6) o.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1); } return o; })();
const dmy = (i) => { const [y, m, d] = i.split("-"); return `${d}-${m}-${y}`; };
// Flat prices, so every figure below is a round number and a wrong bucket is
// obvious rather than arithmetic.
const NAV = { "100001": 10, "100002": 20, "100003": 25 };
const PX = { RELIANCE: 100, GOLDBEES: 50 };
// Equity fund 10,000 · RELIANCE 10,000        → Equity        20,000
// Debt fund   10,000 · FD 100,000 at 0%       → Fixed Income 110,000
// Gold fund    5,000 · GOLDBEES 5,000         → Commodity     10,000
// The deposit pays 0% on purpose: accrual would make every figure here a
// function of how long ago the fixture starts, and the point being tested is
// which bucket a holding lands in, not what it earned.
const EQUITY = 20000, FIXED = 110000, GOLD = 10000;

let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (d !== undefined ? "  → " + JSON.stringify(d) : "")); } };
const money = (t) => {
  const s = String(t || "");
  const n = Number(s.replace(/[^0-9.]/g, "")) || 0;
  const m = /\bCR\b/i.test(s) ? 1e7 : /\bL\b/i.test(s) ? 1e5 : /\bK\b/i.test(s) ? 1e3 : 1;
  return (/−|-/.test(s) ? -n : n) * m;
};

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const j = (o) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(o) });

  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: DAYS.map((i) => ({ date: dmy(i), nav: "10" })).reverse() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ updated: new Date().toISOString(),
    mf_history: Object.fromEntries(Object.keys(NAV).map((c) =>
      [c, Object.fromEntries(DAYS.map((i) => [i, NAV[c]]))])) })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { INFA: "100001", INFB: "100002", INFC: "100003" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: Object.fromEntries(Object.keys(NAV).map((c) =>
      [c, { date: "01-Aug-2026", nav: NAV[c] }])) })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: 84 },
              RELIANCE: { price: PX.RELIANCE, prev_close: PX.RELIANCE },
              GOLDBEES: { price: PX.GOLDBEES, prev_close: PX.GOLDBEES } },
    usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history:
    Object.fromEntries(Object.keys(PX).map((t) =>
      [t, { currency: "INR", prices: Object.fromEntries(DAYS.map((i) => [i, PX[t]])) }])) })));
  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.destroy = this.update = this.resize = this.zoomScale = this.resetZoom = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    localStorage.setItem("wf-gold-premium-pct", "0");
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
  }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(13000);

  // Menu order is part of the ask: the reader scans it top to bottom.
  const order = await p.evaluate(() =>
    [...document.querySelectorAll("#exclusions-menu [role='option']")].map((o) => o.textContent.trim()));
  ok(JSON.stringify(order) === JSON.stringify([
    "No Exclusion", "Exclude Equity", "Exclude Fixed Income and Commodity", "Exclude Savings/Investment"]),
     "M1 the four options read in the order asked for", order);

  const pick = async (id) => {
    await p.evaluate((i) => document.getElementById(i).click(), id);
    await p.waitForTimeout(6000);
    return p.evaluate(() => ({
      current: (document.getElementById("overview-total-current-value") || {}).textContent,
      label: (document.getElementById("exclusions-label") || {}).textContent,
      // The two split cards below the charts break the SAME total down, so an
      // exclusion the Overview honours and they do not is visible as two
      // different net worths on one screen.
      splitTotal: (document.getElementById("isc-total-value") || {}).textContent,
      catTotal: (document.getElementById("iscat-total-value") || {}).textContent,
      cats: [...document.querySelectorAll("#iscat-list .isc-row-name, #iscat-list .isc-name")]
        .map((e) => e.textContent.trim()),
      catText: (document.getElementById("iscat-list") || {}).textContent || "",
    }));
  };

  const none = await pick("exclusions-reset");
  const ALL = EQUITY + FIXED + GOLD;
  ok(Math.abs(money(none.current) - ALL) <= 50,
     "E1 with no exclusion the Overview totals every holding", { got: none.current, want: ALL });

  const noEq = await pick("exclude-equity-toggle");
  ok(noEq.label === "Exclude Equity", "E2 the button reads back the exclusion in force", noEq.label);
  ok(Math.abs(money(noEq.current) - (FIXED + GOLD)) <= 50,
     "E3 Exclude Equity leaves fixed income and commodity — and takes RELIANCE " +
     "with the equity fund, since both are Equity", { got: noEq.current, want: FIXED + GOLD });

  const noFi = await pick("exclude-fixedincome-toggle");
  ok(noFi.label === "Exclude Fixed Income and Commodity",
     "E4 and reads back the renamed one in full", noFi.label);
  ok(Math.abs(money(noFi.current) - EQUITY) <= 50,
     "E5 Exclude Fixed Income and Commodity leaves ONLY equity. This is the " +
     "assertion a sheet-based filter fails: the debt fund and the gold fund are " +
     "in the equity sheet and the gold ETF is in the stocks sheet, so all three " +
     "used to survive it", { got: noFi.current, want: EQUITY });

  // Selecting one must clear the other, or two exclusions silently stack.
  const back = await pick("exclude-equity-toggle");
  ok(Math.abs(money(back.current) - (FIXED + GOLD)) <= 50,
     "E6 choosing another exclusion replaces the first rather than adding to it",
     { got: back.current, want: FIXED + GOLD });
  const reset = await pick("exclusions-reset");
  ok(Math.abs(money(reset.current) - ALL) <= 50,
     "E7 and No Exclusion clears whichever was on — including the newest, which " +
     "a reset written as a list of two keys would have missed",
     { got: reset.current, want: ALL });

  // Portfolio Split and Category Split break the same total down, so they have
  // to honour the same exclusions. Reported: with Exclude Equity on, the
  // Overview dropped equity and both cards carried on showing all of it —
  // two different net worths on one screen. They read their sheet list from
  // the fixed-income toggle alone, and no sheet list can express "Equity"
  // anyway, since a gold fund and a debt fund live in the equity sheet too.
  const sNone = await pick("exclusions-reset");
  ok(Math.abs(money(sNone.splitTotal) - ALL) <= 50,
     "S1 Portfolio Split totals everything when nothing is excluded",
     { got: sNone.splitTotal, want: ALL });
  ok(Math.abs(money(sNone.catTotal) - ALL) <= 50,
     "S2 and so does Category Split", { got: sNone.catTotal, want: ALL });

  const sEq = await pick("exclude-equity-toggle");
  ok(Math.abs(money(sEq.splitTotal) - (FIXED + GOLD)) <= 50,
     "S3 Exclude Equity filters Portfolio Split — the reported bug",
     { got: sEq.splitTotal, want: FIXED + GOLD });
  ok(Math.abs(money(sEq.catTotal) - (FIXED + GOLD)) <= 50,
     "S4 and Category Split", { got: sEq.catTotal, want: FIXED + GOLD });
  ok(!/Equity/.test(sEq.catText),
     "S5 with no Equity row at all — an excluded category has no row, no chip " +
     "and no share of the bar, rather than a zero one", sEq.catText.slice(0, 120));
  ok(Math.abs(money(sEq.splitTotal) - money(sEq.current)) <= 50,
     "S6 and the cards agree with the Overview above them, which is the thing " +
     "that was actually wrong on screen",
     { split: sEq.splitTotal, overview: sEq.current });

  const sFi = await pick("exclude-fixedincome-toggle");
  ok(Math.abs(money(sFi.splitTotal) - EQUITY) <= 50,
     "S7 Exclude Fixed Income and Commodity filters Portfolio Split by CATEGORY " +
     "— the gold fund and debt fund in the equity sheet go too",
     { got: sFi.splitTotal, want: EQUITY });
  ok(Math.abs(money(sFi.catTotal) - EQUITY) <= 50,
     "S8 and Category Split", { got: sFi.catTotal, want: EQUITY });
  ok(!/Commodity|Fixed Income/.test(sFi.catText),
     "S9 leaving neither a Commodity nor a Fixed Income row", sFi.catText.slice(0, 120));
  await pick("exclusions-reset");

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
