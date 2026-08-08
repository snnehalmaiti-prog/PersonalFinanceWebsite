// EXPENSE BY CATEGORY: a third drill level showing the transactions behind a
// sub-category, ordered by month for the selected year.
//
// The card drilled category → sub-category and stopped there, so seeing what
// actually made up a sub-category meant going to the expense tab and filtering
// by hand.
//
// The fixture puts records in three months, deliberately OUT of date order in
// the source array and with a decoy sub-category sharing the same parent, so a
// list that forgot to sort, or that showed the whole category, is distinguishable
// from a correct one.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-expense-txn-drill.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const YEAR = new Date().getFullYear();

const CATEGORIES = [
  { id: "c1", name: "Vacation & Travel", parent_id: null },
  { id: "s1", name: "Food & Drinks",     parent_id: "c1" },
  { id: "s2", name: "Accommodation",     parent_id: "c1" },   // decoy: same parent
  { id: "c2", name: "Household",         parent_id: null },
  { id: "s3", name: "Groceries",         parent_id: "c2" },   // decoy: other parent
];
const ACCOUNTS = [{ id: "a1", name: "HDFC Card" }];

// Deliberately unsorted, and spanning March / January / February.
const TARGET = [
  { id: "t3", txn_date: `${YEAR}-03-11`, amount: 3000, note: "Cafe in March",  cat: "s1" },
  { id: "t1", txn_date: `${YEAR}-01-05`, amount: 1000, note: "Dinner in Jan",  cat: "s1" },
  { id: "t2", txn_date: `${YEAR}-02-20`, amount: 2000, note: "Lunch in Feb",   cat: "s1" },
  { id: "t4", txn_date: `${YEAR}-01-28`, amount: 500,  note: "Snack in Jan",   cat: "s1" },
];
const DECOYS = [
  { id: "d1", txn_date: `${YEAR}-01-09`, amount: 9000, note: "Hotel",          cat: "s2" },
  { id: "d2", txn_date: `${YEAR}-02-09`, amount: 4000, note: "Supermarket",    cat: "s3" },
  { id: "d3", txn_date: `${YEAR - 1}-01-09`, amount: 7000, note: "Last year cafe", cat: "s1" },
];
const toRec = (r) => ({
  id: r.id, txn_date: r.txn_date, amount: r.amount, type: "expense", note: r.note,
  account_id: "a1",
  category_id: CATEGORIES.find((c) => c.id === r.cat).parent_id,
  subcategory_id: r.cat,
});
const RECORDS = TARGET.concat(DECOYS).map(toRec);

const TARGET_TOTAL = TARGET.reduce((s, r) => s + r.amount, 0);           // 6500
const EXPECTED_ORDER = ["Dinner in Jan", "Snack in Jan", "Lunch in Feb", "Cafe in March"];

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1300 } });
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

  // Record what each doughnut was built with, and expose a click on slice N.
  await p.addInitScript(() => {
    window.__charts = [];
    window.Chart = function (ctx, cfg) {
      const canvas = ctx && ctx.canvas ? ctx.canvas : ctx;
      const id = (canvas && canvas.id) || "";
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 400, top: 0, bottom: 240 };
      const entry = { id, labels: (cfg.data && cfg.data.labels) || [], cfg };
      window.__charts.push(entry);
      if (id === "epc-chart") window.__epcCfg = cfg;
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
    // Click a slice by its label, through the chart's real onClick handler.
    window.__epcClickSlice = function (label) {
      const cfg = window.__epcCfg;
      if (!cfg) return "no chart";
      const i = (cfg.data.labels || []).indexOf(label);
      if (i < 0) return "no slice " + label + " in " + JSON.stringify(cfg.data.labels);
      cfg.options.onClick({}, [{ index: i }]);
      return "ok";
    };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(6000);

  await p.evaluate(([records, cats, accts]) => {
    window.dashExpState = window.dashExpState || {};
    window.dashExpState.records = records;
    window.dashExpState.categories = cats;
    window.dashExpState.accounts = accts;
    if (window.renderExpenseCategoryPie) window.renderExpenseCategoryPie();
  }, [RECORDS, CATEGORIES, ACCOUNTS]);
  await p.waitForTimeout(800);

  const view = () => p.evaluate(() => {
    const txns = document.getElementById("epc-txns");
    const wrap = document.getElementById("epc-wrap");
    const legend = document.getElementById("epc-legend");
    const rows = txns ? [...txns.querySelectorAll(".epc-txn-row")] : [];
    return {
      txnsShown: txns ? !txns.hidden : null,
      chartShown: wrap ? !wrap.hidden : null,
      legendShown: legend ? !legend.hidden : null,
      status: (document.getElementById("epc-status") || {}).textContent || "",
      crumb: (document.getElementById("epc-subtitle") || {}).textContent || "",
      backShown: (() => { const b = document.getElementById("epc-back");
        return b ? getComputedStyle(b).display !== "none" : null; })(),
      names: rows.map((r) => (r.querySelector(".epc-txn-name") || {}).textContent || ""),
      amounts: rows.map((r) => (r.querySelector(".epc-txn-amt") || {}).textContent || ""),
      months: txns ? [...txns.querySelectorAll(".epc-txn-month")].map((m) => m.textContent.trim()) : [],
      // Source order of headings and rows interleaved, to prove grouping.
      sequence: txns ? [...txns.children].map((c) => c.className.trim()) : [],
    };
  });

  const top = await view();
  ok(top.chartShown === true && top.txnsShown === false,
     "T1 the card starts on the category doughnut", top);

  // category → sub-category
  ok((await p.evaluate(() => window.__epcClickSlice("Vacation & Travel"))) === "ok",
     "T2 a top-level slice drills to sub-categories");
  await p.waitForTimeout(500);
  const subs = await view();
  ok(subs.chartShown === true && subs.txnsShown === false,
     "T3 which is still a doughnut", subs);

  // sub-category → transactions
  const clicked = await p.evaluate(() => window.__epcClickSlice("Food & Drinks"));
  ok(clicked === "ok", "T4 a sub-category slice is clickable", clicked);
  await p.waitForTimeout(500);
  const txnView = await view();
  console.log("  txn view: " + JSON.stringify(txnView, null, 1));

  ok(txnView.txnsShown === true && txnView.chartShown === false && txnView.legendShown === false,
     "T5 and replaces the doughnut with a transaction list", txnView);
  ok(txnView.names.length === TARGET.length,
     "T6 showing every transaction in that sub-category and nothing else",
     { got: txnView.names, want: EXPECTED_ORDER });
  ok(txnView.names.join("|") === EXPECTED_ORDER.join("|"),
     "T7 ordered by month across the selected year, oldest first — the fixture " +
     "is stored out of order, so an unsorted list fails here",
     { got: txnView.names, want: EXPECTED_ORDER });
  ok(!txnView.names.some((n) => /Hotel|Supermarket|Last year/.test(n)),
     "T8 no other sub-category, no other category, no other year leaks in", txnView.names);
  ok(txnView.months.join("|") === "January|February|March",
     "T9 grouped under month headings in calendar order", txnView.months);
  // A heading must precede its rows, not trail them.
  ok(txnView.sequence[0] === "epc-txn-month",
     "T10 each month heading comes before its transactions", txnView.sequence);
  ok(new RegExp(String(TARGET_TOTAL.toLocaleString("en-IN"))).test(txnView.status) &&
     /4 transactions/.test(txnView.status),
     "T11 the status line reports the count and total for the sub-category",
     txnView.status);
  ok(/Vacation & Travel/.test(txnView.crumb) && /Food & Drinks/.test(txnView.crumb),
     "T12 the breadcrumb shows both levels", txnView.crumb);

  // Back goes one level at a time.
  ok(txnView.backShown === true, "T13 Back is available", txnView.backShown);
  await p.evaluate(() => document.getElementById("epc-back").click());
  await p.waitForTimeout(500);
  const back1 = await view();
  ok(back1.chartShown === true && back1.crumb === "Vacation & Travel",
     "T14 Back returns to the sub-category doughnut, not all the way out", back1);
  await p.evaluate(() => document.getElementById("epc-back").click());
  await p.waitForTimeout(500);
  const back2 = await view();
  ok(back2.chartShown === true && back2.backShown === false,
     "T15 and a second Back returns to the top level", back2);

  // Month mode: a single month needs no month headings.
  await p.evaluate(() => {
    document.getElementById("epc-month-toggle").click();
  });
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const sel = document.getElementById("epc-month");
    sel.value = "0";                       // January
    sel.dispatchEvent(new Event("change"));
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__epcClickSlice("Vacation & Travel"));
  await p.waitForTimeout(400);
  await p.evaluate(() => window.__epcClickSlice("Food & Drinks"));
  await p.waitForTimeout(500);
  const monthView = await view();
  console.log("  month view: " + JSON.stringify({ names: monthView.names, months: monthView.months }));
  ok(monthView.names.join("|") === "Dinner in Jan|Snack in Jan",
     "T16 Month mode lists only that month's transactions, in date order", monthView.names);
  ok(monthView.months.length === 0,
     "T17 and drops the month headings — the period is already one month",
     monthView.months);

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
