// Liabilities against the Overview's Current figure.
//
// A loan is money that still has to leave the account, so Current shows assets
// net of what is left to pay on it. Whose debt it is comes from the account it
// is charged to: a personal account makes it that person's in full, a joint one
// makes it theirs only in the proportion the split records.
//
// The other half of the feature is what does NOT move. Current is a display,
// and the deduction stops there: the snapshot writer, the Account Value chart's
// tail and the P&L are all still about assets. If a liability could reach the
// snapshot table it would rewrite what past months were worth, permanently.
//
//     python3 -m http.server 8101 &
//     node tests/e2e-liability-networth.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8101;

const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

// Round numbers, so the arithmetic is checkable by hand:
//   Snnehal  ₹6,00,000 savings      Trisha  ₹4,00,000 savings
//   household ₹10,00,000
const SHEETS = {
  "wf-equity-data": [TXN],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [FD_HDR,
    ["1-Jan-2024", "Snnehal", "HDFC", "Savings A", "Fixed Income", "Savings Account", "Deposit", "600000", "", "", ""],
    ["1-Jan-2024", "Trisha", "HDFC", "Savings B", "Fixed Income", "Savings Account", "Deposit", "400000", "", "", ""]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const ACCOUNTS = [
  { id: "acc-sn", name: "Snnehal", contributing_account: true, sort_order: 1 },
  { id: "acc-tr", name: "Trisha", contributing_account: true, sort_order: 2 },
  { id: "acc-joint", name: "Joint", contributing_account: false, sort_order: 3 },
];

// The Account Value chart needs a priced holding to have a timeline at all, so
// the liability-line block below runs on a fixture with a fund in it. The
// earlier blocks keep the savings-only sheets, where every figure is a round
// number that can be checked by hand.
const SHEETS_MF = Object.assign({}, SHEETS, {
  "wf-equity-data": [TXN, ["1-Jan-2024", "Snnehal", "Aurora Fund", "Buy", "100", "10"],
    // Trisha needs a priced holding too: renderValueChart does not redraw for a
    // portfolio that has none, and would leave the previous one's chart up.
    ["1-Jan-2024", "Trisha", "Aurora Fund", "Buy", "50", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Aurora Fund", "Equity", "Flexi Cap", "100001", "INFA"]],
});
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

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const num = (s) => Number(String(s || "").replace(/[^0-9.-]/g, ""));

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const snapPosts = [];
  const posted = [];   // expense_records the schedule processor inserts
  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => {
    const req = r.request(), url = req.url();
    if (/net_worth_snapshots/.test(url) && req.method() === "POST") {
      let body = null;
      try { body = JSON.parse(req.postData() || "null"); } catch (e) {}
      (Array.isArray(body) ? body : [body]).forEach((row) => row && snapPosts.push(row));
      return r.fulfill({ status: 201, contentType: "application/json",
        headers: { "access-control-allow-origin": "*" }, body: "[]" });
    }
    if (/expense_records/.test(url) && req.method() === "POST") {
      let body = null;
      try { body = JSON.parse(req.postData() || "null"); } catch (e) {}
      (Array.isArray(body) ? body : [body]).forEach((row) => row && posted.push(row));
      return r.fulfill({ status: 201, contentType: "application/json",
        headers: { "access-control-allow-origin": "*" }, body: JSON.stringify([body]) });
    }
    if (/expense_accounts/.test(url)) return r.fulfill(j(ACCOUNTS));
    return r.fulfill(j([]));
  });
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

  const boot = async (liabilities, sheetSet) => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate(([s, l]) => {
      localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      localStorage.setItem("wf-selected-portfolio", "all");
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
      if (l) localStorage.setItem("wf-liabilities", JSON.stringify(l));
    }, [sheetSet || SHEETS, liabilities || null]);
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForFunction(
      () => { const e = document.getElementById("overview-total-current-value");
        return e && e.textContent && e.textContent !== "—"; }, null, { timeout: 25000 }).catch(() => {});
    await p.waitForTimeout(2500);
  };

  const read = () => p.evaluate(() => {
    const cur = document.getElementById("overview-total-current-value");
    return {
      current: cur ? cur.textContent : null,
      title: cur ? cur.getAttribute("title") : null,
      hero: (document.getElementById("ov-hero-current") || {}).textContent,
      invested: (document.getElementById("overview-total-investment") || {}).textContent,
      pnl: (document.getElementById("overview-unrealized-return") || {}).textContent,
      tail: (document.getElementById("pvc-current-value") || {}).textContent,
      liability: (document.getElementById("overview-total-liability") || {}).textContent,
      liabilityTitle: (document.getElementById("overview-total-liability") || {}).title || null,
      liabilityShown: Array.prototype.every.call(
        document.querySelectorAll(".overview-stat-liability"), (e) => !e.hidden) &&
        document.querySelectorAll(".overview-stat-liability").length > 0,
      // Where the cell sits: the labels of the stats actually on screen.
      labels: Array.prototype.filter.call(
        document.querySelectorAll(".overview-stat-inline"), (e) => !e.hidden)
        .map((e) => ((e.querySelector(".overview-stat-label") || {}).textContent || "").trim()),
    };
  });
  // Through the real control. Writing the key alone would move the deduction
  // while leaving the assets on the household's numbers, which is not a state
  // the app can actually be in — and would make the arithmetic below meaningless.
  const pick = async (name) => {
    await p.evaluate((n) => {
      const opt = Array.prototype.slice.call(
        document.querySelectorAll("#portfolio-pills [data-ov-portfolio]"))
        .find((e) => e.getAttribute("data-ov-portfolio") === n);
      if (opt) opt.click();
    }, name);
    await p.waitForTimeout(2500);
    return read();
  };

  // ── 1. no liabilities: the baseline the rest is measured against ────────
  await boot(null);
  const base = await read();
  console.log("  baseline: " + JSON.stringify(base));
  ok(num(base.current) === 1000000,
     "N1 with no liabilities Current is the assets themselves", base.current);
  ok(!base.title, "N2 and carries no deduction note", base.title);

  // ── 2. a personal account: the whole debt is that person's ──────────────
  // 10 instalments of ₹20,000, two already paid → ₹1,60,000 left to pay.
  await boot([{ id: "lb-1", name: "Car loan", row: {
    type: "expense", amount: 20000, frequency: "monthly", next_due: "2026-09-01",
    num_payments: 10, installments_done: 2, account_id: "acc-sn" } }]);
  const own = await read();
  console.log("  personal: " + JSON.stringify(own));
  ok(num(own.current) === 1000000 - 160000,
     "N3 Current drops by what is left to pay — eight instalments of ₹20,000",
     own.current);
  ok(/10,00,000/.test(own.title || "") && /1,60,000/.test(own.title || ""),
     "N4 and says what was taken off, so the card is not just quietly short",
     own.title);
  ok(num(own.hero) === num(own.current),
     "N5 the mobile hero shows the same figure", { hero: own.hero, cur: own.current });

  // The part that must not move.
  ok(num(own.invested) === 1000000,
     "N6 Invested is untouched — a loan is not a disinvestment", own.invested);
  ok(num(own.tail) === 1000000,
     "N7 and the Account Value chart still plots assets, so its tail does not " +
     "step down away from the series behind it", own.tail);
  ok(!snapPosts.some((r) => Number(r.total) < 1000000),
     "N8 nothing below the asset total was written to the snapshot table — a " +
     "liability must never rewrite what a past month was worth",
     snapPosts.map((r) => r.total));

  const snOwn = await pick("Snnehal");
  const trOwn = await pick("Trisha");
  ok(num(snOwn.current) === 600000 - 160000,
     "N9 the person who pays it carries all of it", snOwn.current);
  ok(num(trOwn.current) === 400000,
     "N10 and the other carries none of it", trOwn.current);

  // ── 3. a joint account: split, or nobody's in particular ────────────────
  await boot([{ id: "lb-2", name: "Home loan", row: {
    type: "expense", amount: 10000, frequency: "monthly", next_due: "2026-09-01",
    num_payments: 10, installments_done: 0, account_id: "acc-joint",
    contribution_split: { "acc-sn": 70, "acc-tr": 30 } } }]);
  const all = await read();
  const sn = await pick("Snnehal");
  const tr = await pick("Trisha");
  console.log("  joint: " + JSON.stringify({ all: all.current, sn: sn.current, tr: tr.current }));
  ok(num(all.current) === 1000000 - 100000,
     "N11 the household owes the whole ₹1,00,000", all.current);
  ok(num(sn.current) === 600000 - 70000,
     "N12 and 70% of it lands on the account that carries 70% of the split", sn.current);
  ok(num(tr.current) === 400000 - 30000, "N13 the remaining 30% on the other", tr.current);
  ok((1000000 - num(all.current)) === (600000 - num(sn.current)) + (400000 - num(tr.current)),
     "N14 the two shares add back up to the household's deduction",
     { all: all.current, sn: sn.current, tr: tr.current });

  // A joint liability with no split is the household's but nobody's in
  // particular — it must not be handed to whichever account sorts first.
  await boot([{ id: "lb-3", name: "Unsplit", row: {
    type: "expense", amount: 10000, frequency: "monthly", next_due: "2026-09-01",
    num_payments: 5, installments_done: 0, account_id: "acc-joint" } }]);
  const uAll = await read();
  const uSn = await pick("Snnehal");
  ok(num(uAll.current) === 1000000 - 50000,
     "N15 an unsplit joint liability still comes off the household", uAll.current);
  ok(num(uSn.current) === 600000,
     "N16 but off nobody in particular — it is not silently assigned to one person",
     uSn.current);

  // ── 4. an open-ended schedule has no last payment to count back from ────
  await boot([{ id: "lb-4", name: "Open ended", row: {
    type: "expense", amount: 10000, frequency: "monthly", next_due: "2026-09-01",
    account_id: "acc-sn" } }]);
  const open = await read();
  ok(num(open.current) === 1000000,
     "N17 an open-ended liability moves nothing rather than guessing a total",
     open.current);

  // A deleted liability is not a debt.
  await boot([{ id: "lb-5", _deleted: true, updated_at: 1, row: {
    type: "expense", amount: 99999, num_payments: 99, account_id: "acc-sn" } }]);
  const del = await read();
  ok(num(del.current) === 1000000, "N18 a tombstoned liability is not owed", del.current);

  // ── The Liability cell ──────────────────────────────────────────────────
  // It exists only where there is a liability to name. Snnehal's loan is not
  // Trisha's, so her card does not carry the cell at all — not a zero, which
  // would read as a debt she has finished paying.
  ok(!base.liabilityShown,
     "C1 with no liabilities there is no Liability cell", base.labels);
  ok(base.labels.indexOf("Liability") === -1,
     "C2 specifically, it is absent from the row rather than blank", base.labels);

  await boot([{ id: "lb-6", name: "Car loan", row: {
    type: "expense", amount: 20000, frequency: "monthly", next_due: "2026-09-01",
    num_payments: 10, installments_done: 2, account_id: "acc-sn" } }]);
  const cAll = await read();
  console.log("  cell (all): " + JSON.stringify({ labels: cAll.labels, v: cAll.liability }));
  ok(cAll.liabilityShown, "C3 adding one brings the cell out", cAll.labels);
  ok(num(cAll.liability) === 160000,
     "C4 showing what is owed, not what Current was reduced to", cAll.liability);
  ok(cAll.labels.indexOf("Liability") === cAll.labels.indexOf("Invested") + 1,
     "C5 immediately after Invested", cAll.labels);

  const cSn = await pick("Snnehal");
  ok(cSn.liabilityShown && num(cSn.liability) === 160000,
     "C6 the portfolio that carries the loan shows it",
     { shown: cSn.liabilityShown, v: cSn.liability });

  const cTr = await pick("Trisha");
  ok(!cTr.liabilityShown,
     "C7 and a portfolio that carries none of it does not show the cell at all",
     { shown: cTr.liabilityShown, labels: cTr.labels });
  ok(cTr.labels.indexOf("Liability") === -1,
     "C8 the row closes up around it rather than leaving a gap", cTr.labels);

  // Hovering the cell names the loans behind the figure. A lone total leaves
  // the reader to work out which debts it is made of from the settings page.
  ok(/Car loan/.test(cAll.liabilityTitle || ""),
     "C10 hovering the cell names the liability behind the figure", cAll.liabilityTitle);
  ok(/1,60,000/.test(cAll.liabilityTitle || ""),
     "C11 with what it contributes", cAll.liabilityTitle);
  ok(!cTr.liabilityTitle,
     "C12 and a portfolio carrying none of it is told nothing", cTr.liabilityTitle);

  // Two loans, one of them shared: the tooltip must name both and show each at
  // the share THIS selection carries, not at its full size.
  await boot([
    { id: "lb-a", name: "Car loan", row: { type: "expense", amount: 20000,
      frequency: "monthly", next_due: "2026-09-01", num_payments: 10,
      installments_done: 2, account_id: "acc-sn" } },
    { id: "lb-b", name: "Home loan", row: { type: "expense", amount: 10000,
      frequency: "monthly", next_due: "2026-09-01", num_payments: 10,
      installments_done: 0, account_id: "acc-joint",
      contribution_split: { "acc-sn": 70, "acc-tr": 30 } } },
  ]);
  const twoAll = await read();
  console.log("  tooltip (all): " + JSON.stringify(twoAll.liabilityTitle));
  ok(/Car loan/.test(twoAll.liabilityTitle || "") && /Home loan/.test(twoAll.liabilityTitle || ""),
     "C13 both loans are named", twoAll.liabilityTitle);
  ok((twoAll.liabilityTitle || "").indexOf("\n") > 0,
     "C14 one per line, not run together", twoAll.liabilityTitle);
  ok(/Car loan ₹1,60,000/.test(twoAll.liabilityTitle || ""),
     "C15 the household sees each at its full size", twoAll.liabilityTitle);

  const twoTr = await pick("Trisha");
  console.log("  tooltip (Trisha): " + JSON.stringify(twoTr.liabilityTitle));
  ok(!/Car loan/.test(twoTr.liabilityTitle || ""),
     "C16 a portfolio is not shown a debt that is not its own", twoTr.liabilityTitle);
  ok(/Home loan ₹30,000/.test(twoTr.liabilityTitle || ""),
     "C17 and sees the shared one at its own 30% share, not its full ₹1,00,000",
     twoTr.liabilityTitle);
  ok(num(twoTr.liability) === 30000,
     "C18 which is the whole of the figure the tooltip is explaining", twoTr.liability);

  await boot([{ id: "lb-6", name: "Car loan", row: {
    type: "expense", amount: 20000, frequency: "monthly", next_due: "2026-09-01",
    num_payments: 10, installments_done: 2, account_id: "acc-sn" } }]);
  const cBack = await pick("all");
  ok(cBack.liabilityShown && num(cBack.liability) === 160000,
     "C9 and it comes back when the household is selected again",
     { shown: cBack.liabilityShown, v: cBack.liability });

  // ── Paying an instalment pays the liability down ────────────────────────
  // Recording an EMI as an expense is what actually reduces the debt: one
  // fewer instalment left to pay, so what is owed falls by the instalment and
  // Current rises by the same amount. The schedule processor posts the record
  // on this very load, so both figures have to move without a reload.
  posted.length = 0;
  await boot([{ id: "lb-7", name: "Car loan", row: {
    type: "expense", amount: 20000, frequency: "monthly",
    // Instalments already behind: the processor will post them.
    next_due: "2026-07-01", num_payments: 10, installments_done: 0,
    account_id: "acc-sn", category_id: null, payment_method_id: null } }]);
  const beforePay = await read();
  ok(num(beforePay.liability) === 200000,
     "E0 ten instalments of ₹20,000 are owed before any is paid", beforePay.liability);

  // The schedule processor lives on the settings page — that is where an
  // instalment actually becomes an expense record. Same origin, so the
  // dashboard reads the advanced counter back out of localStorage.
  await p.goto(`http://127.0.0.1:${PORT}/settings.html?nosw=1`, { waitUntil: "load" });
  await p.waitForFunction(() => {
    try {
      const l = JSON.parse(localStorage.getItem("wf-liabilities") || "[]")[0];
      return l && l.row && (l.row.installments_done || 0) > 0;
    } catch (e) { return false; }
  }, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForFunction(
    () => { const e = document.getElementById("overview-total-current-value");
      return e && e.textContent && e.textContent !== "—"; }, null, { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const afterPay = await read();
  const doneCount = await p.evaluate(() =>
    (JSON.parse(localStorage.getItem("wf-liabilities") || "[]")[0].row.installments_done) || 0);
  console.log("  after paying: " + JSON.stringify({ posted: posted.length, done: doneCount,
    liability: afterPay.liability, current: afterPay.current }));

  ok(posted.length > 0 && posted.every((r) => r.labels && r.labels[0] === "liability"),
     "E1 the due instalments were recorded as expenses",
     posted.map((r) => ({ d: r.txn_date, a: r.amount })));
  ok(doneCount === posted.length,
     "E2 and the liability's paid counter advanced once per instalment recorded",
     { done: doneCount, posted: posted.length });

  const expectedOwed = (10 - doneCount) * 20000;
  ok(num(afterPay.liability) === expectedOwed,
     "E3 so what is owed has fallen by an instalment for each one paid",
     { shown: afterPay.liability, want: expectedOwed });
  ok(num(afterPay.liability) < num(beforePay.liability),
     "E3b which is less than was owed before the instalments were recorded",
     { before: beforePay.liability, after: afterPay.liability });
  ok(num(afterPay.current) === 1000000 - expectedOwed,
     "E4 and Current has risen by exactly that much",
     { shown: afterPay.current, want: 1000000 - expectedOwed });
  ok(num(afterPay.current) - num(beforePay.current) ===
     num(beforePay.liability) - num(afterPay.liability),
     "E4b rupee for rupee: what came off the debt went onto the value",
     { curBefore: beforePay.current, curAfter: afterPay.current,
       owedBefore: beforePay.liability, owedAfter: afterPay.liability });
  ok(num(afterPay.current) + num(afterPay.liability) === 1000000,
     "E5 the two still account for the whole of the assets between them",
     { cur: afterPay.current, owed: afterPay.liability });

  // And it is durable: the reduced figure is what a later load reads.
  await p.reload({ waitUntil: "load" });
  await p.waitForTimeout(4000);
  const reloaded = await read();
  ok(num(reloaded.liability) <= expectedOwed,
     "E6 a later load does not resurrect the instalments already paid",
     { then: expectedOwed, now: reloaded.liability });

  // ── The liability-adjusted line on the Account Value chart ──────────────
  // A second, dashed line: the same assets seen after the debt, starting at the
  // first instalment and never reaching back before it. It follows the
  // portfolio selector on the same attribution as the Overview figure, so the
  // chart and the card cannot disagree about the same selection.
  const chart = () => p.evaluate(() => {
    const c = window.__wfPortfolioValueChart;
    if (!c) return null;
    const ds = c.data.datasets || [];
    // The net-of-liabilities line is located by label, not by index: an always-on
    // "Invested" (cost basis) line now sits between it and the Current-Value line.
    const netDs = ds.find((d) => d.label === "Net of liabilities") || null;
    const net = netDs ? netDs.data : null;
    const nonNull = net ? net.filter((d) => d && d.y != null) : [];
    return {
      count: ds.length,
      hasNet: !!netDs,
      label: netDs ? netDs.label : null,
      dashed: netDs ? !!netDs.borderDash : false,
      spanGaps: netDs ? netDs.spanGaps : null,
      leadingNulls: net ? net.findIndex((d) => d && d.y != null) : -1,
      // Where the net line starts, and what the asset line reads there: the two
      // must coincide, and the very next point must be lower by the debt.
      joinIdx: net ? net.findIndex((d) => d && d.y != null) : -1,
      joinsAtStart: (() => {
        if (!net || !ds[0]) return false;
        const k = net.findIndex((d) => d && d.y != null);
        if (k < 0 || !ds[0].data[k]) return false;
        return Math.abs(net[k].y - ds[0].data[k].y) < 1;
      })(),
      assetAtJoin: (() => {
        if (!net || !ds[0]) return null;
        const k = net.findIndex((d) => d && d.y != null);
        return k >= 0 && ds[0].data[k] ? ds[0].data[k].y : null;
      })(),
      dropAtStart: (() => {
        if (!net || !ds[0]) return 0;
        const k = net.findIndex((d) => d && d.y != null);
        if (k < 0 || !net[k + 1] || net[k + 1].y == null) return 0;
        return net[k].y - net[k + 1].y;
      })(),
      total: net ? net.length : 0,
      firstNet: nonNull.length ? nonNull[0].y : null,
      lastNet: nonNull.length ? nonNull[nonNull.length - 1].y : null,
      lastAsset: ds[0] && ds[0].data.length ? ds[0].data[ds[0].data.length - 1].y : null,
      // What the two lines imply is owed at each point. A debt being paid down
      // never grows — the net line itself can fall, because assets do.
      owedFalls: (() => {
        const a = ds[0] ? ds[0].data : [];
        let owed = [];
        (net || []).forEach((d, i) => {
          if (d && d.y != null && a[i] && a[i].y != null) owed.push(a[i].y - d.y);
        });
        // The anchor is a zero, and the step off it is the drop the line exists
        // to show. Monotonicity is a claim about the debt once it exists.
        while (owed.length && owed[0] === 0) owed = owed.slice(1);
        return owed.every((v, i) => i === 0 || v <= owed[i - 1] + 0.5);
      })(),
      legendShown: !(document.getElementById("pvc-net-legend") || {}).hidden,
      legendValue: (document.getElementById("pvc-net-value") || {}).textContent,
    };
  });

  await boot(null, SHEETS_MF);
  const noLine = await chart();
  ok(noLine && noLine.count === 2 && !noLine.hasNet,
     "V1 with no liabilities the chart has the value + invested lines and no net line", noLine);
  ok(noLine && !noLine.legendShown, "V2 and no net legend entry", noLine);

  // Ten monthly instalments of ₹20,000 from 1 Jan 2026; four recorded, so the
  // schedule started four months before next_due.
  const LOAN = [{ id: "lb-8", name: "Car loan", row: {
    type: "expense", amount: 20000, frequency: "monthly", next_due: "2026-05-01",
    num_payments: 10, installments_done: 4, account_id: "acc-sn" } }];
  await boot(LOAN, SHEETS_MF);
  const withLine = await chart();
  console.log("  net line: " + JSON.stringify(withLine));
  ok(withLine && withLine.count === 3 && withLine.hasNet, "V3 a liability adds the net line", withLine);
  ok(withLine && withLine.label === "Net of liabilities", "V4 named for what it is", withLine);
  ok(withLine && withLine.dashed && withLine.spanGaps === false,
     "V5 dashed, and not spanning its own gaps — absent before the debt, not " +
     "stretched back to the start of the chart", withLine);
  ok(withLine && withLine.leadingNulls > 0,
     "V6 it begins after the chart does, at the first instalment", withLine);
  // The drop is the point. The line starts ON the asset line, where nothing was
  // owed yet, then falls away by the size of the debt — so taking the loan on
  // reads as an event rather than as a line appearing partway down the chart.
  ok(withLine && withLine.joinsAtStart,
     "V6a starting on the asset line, where nothing was owed yet",
     { at: withLine.joinIdx, net: withLine.firstNet, asset: withLine.assetAtJoin });
  ok(withLine && withLine.dropAtStart > 100000,
     "V6b and dropping away from it by the whole debt at the first instalment",
     { drop: withLine.dropAtStart });
  ok(withLine && withLine.owedFalls,
     "V7 and the gap between the two lines only ever narrows — a debt being " +
     "paid down cannot grow, even where the assets above it fall", withLine);
  if (withLine && withLine.hasNet) {
  ok(withLine.lastNet === withLine.lastAsset - 120000,
     "V8 its last point is the assets less the ₹1,20,000 still owed",
     { net: withLine.lastNet, asset: withLine.lastAsset });

  // The point of the whole thing: the line's end meets the Overview's Current.
  const withLineStats = await read();
  ok(num(withLineStats.current) === Math.round(withLine.lastNet),
     "V9 which is exactly the Current figure on the card beside it — the gap " +
     "between chart and card is what this line exists to close",
     { card: withLineStats.current, line: withLine.lastNet });
  ok(withLine.legendShown && num(withLine.legendValue) === Math.round(withLine.lastNet),
     "V10 and the legend reports the same number", withLine);

  // Portfolio selection drives it, exactly as it drives the figure.
  await pick("Trisha");
  const trLine = await chart();
  ok(trLine && trLine.count === 2 && !trLine.hasNet,
     "V11 a portfolio carrying none of the debt gets no net line", trLine);
  ok(trLine && !trLine.legendShown, "V12 nor its legend entry", trLine);

  await pick("Snnehal");
  const snLine = await chart();
  const snStats = await read();
  ok(snLine && snLine.count === 3 && snLine.hasNet, "V13 the one that carries it gets the net line back", snLine);
  ok(snLine && num(snStats.current) === Math.round(snLine.lastNet),
     "V14 still meeting its own Current figure, for that portfolio",
     { card: snStats.current, line: snLine.lastNet });
  } else { ok(false, "V8-V14 skipped: no second line to measure", withLine); }

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
