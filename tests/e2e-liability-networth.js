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
    if (/expense_accounts/.test(url)) return r.fulfill(j(ACCOUNTS));
    return r.fulfill(j([]));
  });
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: {} })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: {} })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: {} })));
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

  const boot = async (liabilities) => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate(([s, l]) => {
      localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      localStorage.setItem("wf-selected-portfolio", "all");
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
      if (l) localStorage.setItem("wf-liabilities", JSON.stringify(l));
    }, [SHEETS, liabilities || null]);
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
      // Scoped to the portfolio menu: the exclusions and benchmark dropdowns
      // reuse the same class.
      const opt = Array.prototype.slice.call(
        document.querySelectorAll("#portfolio-menu .portfolio-option"))
        .find((e) => (e.textContent || "").trim() === n);
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

  const cBack = await pick("All Portfolios");
  ok(cBack.liabilityShown && num(cBack.liability) === 160000,
     "C9 and it comes back when the household is selected again",
     { shown: cBack.liabilityShown, v: cBack.liability });

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
