// Every Fixed Income term deposit is counted, whatever its sub-category.
//
// The FD sheet's value was computed by paths that tested
// `normSubCategory === "fixed deposit"` exactly. A row with any other
// sub-category — Recurring Deposit, Bond, Sovereign Gold Bond — contributed
// NOTHING: absent from the Fixed Income Holding card, absent from Current Value,
// absent from net worth. Not mis-valued, invisible.
//
// This runs the SAME row four times, changing only the sub-category, and asserts
// the four give identical figures. Comparing against a hardcoded number would
// have to encode the accrual maths; comparing the variants against each other
// only encodes the rule that matters — the sub-category name must not decide
// whether money exists.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-fd-subcategories.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

// Identical in every respect but the sub-category.
const VARIANTS = ["Fixed Deposit", "Recurring Deposit", "Bond", "Sovereign Gold Bond"];
const AMOUNT = "500000";

const sheetsFor = (sub) => ({
  "wf-equity-data": [TXN],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [FD_HDR,
    ["1-Apr-2020", "Snnehal", "HDFC", "Instrument One", "Fixed Income", sub, "Deposit", AMOUNT, "1-Apr-2030", "7%", ""]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
});

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const money = (t) => { const m = String(t || "").match(/[\d,]+(?:\.\d+)?/); return m ? Number(m[0].replace(/,/g, "")) : 0; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1400 } });
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

  const measure = async (sub) => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate((s) => { localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, sheetsFor(sub));
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(6500);
    await p.evaluate(() => {
      const top = document.querySelector('[data-tab="investment"]');
      if (top) top.click();
      const t = document.getElementById("subtab-fixedincome");
      if (t) t.click();
    });
    await p.waitForTimeout(1200);
    return p.evaluate(() => {
      const list = document.getElementById("fih-list");
      const rows = list ? [...list.querySelectorAll(".mfh-row")] : [];
      const foot = rows.find((r) => /SUB-TOTAL/i.test((r.children[0] || {}).textContent || ""));
      const named = rows.filter((r) => r.querySelector(".mfh-inst-name"));
      const cat = [...document.querySelectorAll("#iscat-list .isc-row")]
        .find((r) => /Fixed Income/.test((r.querySelector(".isc-row-name") || {}).textContent || ""));
      return {
        holdingRows: named.map((r) => (r.querySelector(".mfh-inst-name") || {}).textContent.trim()),
        subtotalInvested: foot ? (foot.children[1] || {}).textContent.trim() : null,
        subtotalCurrent: foot ? (foot.children[2] || {}).textContent.trim() : null,
        categorySplitFI: cat ? (cat.querySelector(".isc-row-amount") || {}).textContent.trim() : null,
      };
    });
  };

  const seen = {};
  for (const sub of VARIANTS) {
    seen[sub] = await measure(sub);
    console.log("  " + sub.padEnd(22) + JSON.stringify(seen[sub]));
  }

  const base = seen["Fixed Deposit"];
  ok(base.holdingRows.length === 1 && money(base.subtotalCurrent) > money(base.subtotalInvested),
     "F0 the Fixed Deposit baseline is itself sane — one row, accrued above cost",
     base);

  for (const sub of VARIANTS.slice(1)) {
    const v = seen[sub];
    ok(v.holdingRows.length === 1,
       `F1 ${sub}: appears in Fixed Income Holding at all`, v.holdingRows);
    ok(money(v.subtotalCurrent) > 0,
       `F2 ${sub}: carries a current value instead of ₹0`, v.subtotalCurrent);
    // Within ₹5: these are separate page loads and the accrual runs to "now", so
    // demanding an exact match tests the clock, not the valuation. ₹5 on ₹7.77
    // lakh is far tighter than any real difference in treatment would be.
    ok(money(v.subtotalInvested) === money(base.subtotalInvested) &&
       Math.abs(money(v.subtotalCurrent) - money(base.subtotalCurrent)) <= 5,
       `F3 ${sub}: values identically to a Fixed Deposit — the sub-category name ` +
       `must not change what the money is worth`,
       { got: [v.subtotalInvested, v.subtotalCurrent], want: [base.subtotalInvested, base.subtotalCurrent] });
    // Compared WITHIN this variant's own page load, not against the baseline's.
    // The accrual compounds to "now", so two loads minutes apart differ by a
    // rupee — comparing across them made this flake by exactly ₹1 in CI, where
    // the suites run back to back over ten minutes.
    //
    // Still ₹5 rather than exact, because the two figures are produced by
    // different async paths within that one load: the clock advances between
    // them, and how far depends on how much else the page is doing. What is
    // being asserted is that the value REACHES Category Split, not that the
    // second hand stood still — and ₹5 on ₹7.77 lakh cannot hide a real
    // difference in treatment.
    ok(money(v.categorySplitFI) > 0 &&
       Math.abs(money(v.categorySplitFI) - money(v.subtotalCurrent)) <= 5,
       `F4 ${sub}: reaches Category Split too, not just the holdings card`,
       { categorySplit: v.categorySplitFI, holdingsCard: v.subtotalCurrent });
  }

  // A running balance and a provident fund must NOT be swept into the term-deposit
  // path — they have their own valuation, and matching by exclusion could capture
  // them by accident.
  const savings = await measure("Savings Account");
  const pf = await measure("Public Provident Fund");
  console.log("  Savings Account       " + JSON.stringify(savings));
  console.log("  Public Provident Fund " + JSON.stringify(pf));
  // A Savings Account accrues MONTHLY on its own running-balance path, so the
  // right assertion is not "at par" — it is that it did not get swept onto the
  // quarterly term-deposit path. Monthly compounding of the same principal at the
  // same rate lands slightly higher, which is exactly what distinguishes them.
  ok(money(savings.subtotalCurrent) > money(savings.subtotalInvested) &&
     money(savings.subtotalCurrent) !== money(base.subtotalCurrent),
     "F5 a Savings Account keeps its own monthly accrual, not the quarterly one",
     { savings: savings.subtotalCurrent, termDeposit: base.subtotalCurrent });
  ok(money(pf.subtotalCurrent) > 0 && pf.holdingRows.length >= 1,
     "F6 a provident fund still appears and is still valued", pf);

  // The exclusion is load-bearing, not decorative. Overview's fixed-income
  // current value is sumFdCurrentValueAtPar + sumFdActiveCurrentValue + PF; if
  // the term-deposit predicate also matched a running balance, the same savings
  // row would be added by BOTH and the total would double. The holdings card
  // builds from a different list and would look fine, so compare the two.
  ok(money(savings.categorySplitFI) === money(savings.subtotalCurrent),
     "F7 a Savings Account is counted ONCE across the totals, not by the " +
     "at-par path and the term-deposit path both",
     { categorySplit: savings.categorySplitFI, holdingsCard: savings.subtotalCurrent });
  ok(money(pf.categorySplitFI) === money(pf.subtotalCurrent),
     "F8 and so is a provident fund",
     { categorySplit: pf.categorySplitFI, holdingsCard: pf.subtotalCurrent });

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
