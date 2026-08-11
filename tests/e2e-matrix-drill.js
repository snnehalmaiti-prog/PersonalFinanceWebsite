// Spend by account & payment method: every figure opens the records behind it.
//
// The account tiles already drilled to the records list. The matrix did not, so
// the one place that says "₹7,793 went on the Diner's card from Snnehal's
// account" was also the one place you could not ask which transactions those
// were. The check that matters is not that a list appears — it is that the list
// is exactly the figure that was clicked: same account, same payment method,
// same month, and the amounts adding back up to it.
//
//     python3 -m http.server 8106 &
//     node tests/e2e-matrix-drill.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8106;

// A month whose every cell is a distinct, checkable figure.
//   Joint  + Card A   30,000      Joint  + Card B   5,000
//   Snnehal+ Card A    7,000      Snnehal+ UPI      1,000
// Column totals: Joint 35,000, Snnehal 8,000. Grand 43,000.
const Y = 2026, M = 5;             // June 2026, month index 5
const D = (d) => Y + "-06-" + String(d).padStart(2, "0");
const ACCOUNTS = [
  { id: "ac-joint", name: "Joint Account", contributing_account: false, sort_order: 1 },
  { id: "ac-sn", name: "Snnehal", contributing_account: true, sort_order: 2 },
];
const PMS = [
  { id: "pm-a", name: "Diners Card", is_credit_card: true, sort_order: 1 },
  { id: "pm-b", name: "Amex Card", is_credit_card: true, sort_order: 2 },
  { id: "pm-upi", name: "UPI", is_credit_card: false, sort_order: 3 },
];
const REC = (id, day, amt, ac, pm, type) => ({
  id: id, txn_date: D(day), txn_at: D(day) + "T09:00:00Z", amount: amt,
  type: type || "expense", account_id: ac, payment_method_id: pm,
  category_id: null, subcategory_id: null, note: id, labels: null,
});
const RECORDS = [
  REC("j-a-1", 3, 20000, "ac-joint", "pm-a"),
  REC("j-a-2", 9, 10000, "ac-joint", "pm-a"),
  REC("j-b-1", 11, 5000, "ac-joint", "pm-b"),
  REC("s-a-1", 14, 7000, "ac-sn", "pm-a"),
  REC("s-upi-1", 18, 1000, "ac-sn", "pm-upi"),
  // Same account and card, a month later: the drill must not reach it.
  { id: "next-month", txn_date: "2026-07-04", txn_at: "2026-07-04T09:00:00Z",
    amount: 99999, type: "expense", account_id: "ac-sn", payment_method_id: "pm-a",
    category_id: null, subcategory_id: null, note: "next-month", labels: null },
  // Income on the same account and card, inside the month. The matrix counts
  // expenses only, so the drill must not show it either.
  REC("income", 20, 50000, "ac-sn", "pm-a", "income"),
];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const eq = (a, b, name) => ok(a === b, name, { got: a, want: b });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => {
    const url = r.request().url();
    if (/expense_accounts/.test(url)) return r.fulfill(j(ACCOUNTS));
    if (/expense_payment_methods/.test(url)) return r.fulfill(j(PMS));
    if (/expense_records/.test(url)) return r.fulfill(j(RECORDS));
    return r.fulfill(j([]));
  });
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/*.json*", (r) => r.fulfill(j({})));

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
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
  });
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  // The tab handlers are bound by script.js, which runs after load — clicking
  // before that does nothing and leaves the panel hidden, which then reads as
  // "the cell is not visible" many lines later.
  await p.waitForTimeout(3000);
  await p.waitForFunction(() => {
    const t = document.querySelector('[data-tab="expense"]');
    if (!t) return false;
    t.click();
    const panel = document.getElementById("panel-expense");
    return panel && !panel.hidden;
  }, null, { timeout: 20000 });
  // The matrix sits under the Accounts sub-tab, alongside the account tiles it
  // breaks down — not under Charts, where the name suggests.
  await p.waitForFunction(() => {
    const t = document.querySelector('[data-dash-exp-subtab="accounts"]');
    if (!t) return false;
    t.click();
    const panel = document.getElementById("dash-exp-subpanel-accounts");
    return panel && !panel.hidden && getComputedStyle(panel).display !== "none";
  }, null, { timeout: 20000 });
  await p.waitForTimeout(2000);

  // Point the matrix at the fixture's month.
  await p.evaluate((args) => {
    const y = document.getElementById("dash-exp-matrix-year");
    const m = document.getElementById("dash-exp-matrix-month");
    if (y) { y.value = String(args.y); y.onchange && y.onchange(); }
    if (m) { m.value = String(args.m); m.onchange && m.onchange(); }
  }, { y: Y, m: M });
  await p.waitForTimeout(1200);

  // The table and the mobile list both carry these attributes — only one of
  // them is on screen at any width — so every selector is scoped to the table.
  const W = "#dash-exp-matrix-wrap ";
  const cell = (ac, pm) => W + "[data-drill-ac='" + ac + "'][data-drill-pm='" + pm + "']";
  const matrix = () => p.evaluate(() => {
    const w = document.getElementById("dash-exp-matrix-wrap");
    return {
      cells: Array.from(w.querySelectorAll("[data-drill-ac],[data-drill-pm],[data-drill-all]"))
        .map((e) => ({ ac: e.getAttribute("data-drill-ac"), pm: e.getAttribute("data-drill-pm"),
                       all: e.getAttribute("data-drill-all"), text: e.textContent.trim() })),
      inert: Array.from(w.querySelectorAll("td.exp-matrix-zero"))
        .map((e) => ({ text: e.textContent.trim(), clickable: e.hasAttribute("role") })),
    };
  });

  const m0 = await matrix();
  console.log("  cells: " + JSON.stringify(m0.cells.map((c) => c.text)));
  ok(m0.cells.length >= 9,
     "M1 every figure in the table is a drill target — cells, row totals, column " +
     "totals and the grand total", m0.cells.length);
  ok(m0.inert.length > 0 && m0.inert.every((c) => !c.clickable),
     "M2 while a dash is left inert: there are no records behind it to open", m0.inert);

  // Reading the list the drill lands on.
  const records = () => p.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("#rec-list .rec-item"));
    return {
      ids: rows.map((r) => r.getAttribute("data-rec-id")),
      onRecordsTab: !document.getElementById("dash-exp-subpanel-records").hidden,
      account: Array.from((document.getElementById("rec-filter-account") || {}).selectedOptions || [])
        .map((o) => o.value),
      payment: Array.from((document.getElementById("rec-filter-payment") || {}).selectedOptions || [])
        .map((o) => o.value),
      type: Array.from((document.getElementById("rec-filter-type") || {}).selectedOptions || [])
        .map((o) => o.value),
    };
  });
  // Drilling switches to the Records sub-tab, which hides the matrix — so each
  // subsequent click has to come back to it first, exactly as a reader would.
  const backToMatrix = async () => {
    await p.evaluate(() => {
      const t = document.querySelector('[data-dash-exp-subtab="accounts"]');
      if (t) t.click();
    });
    await p.waitForTimeout(500);
  };
  const click = async (sel) => {
    await backToMatrix();
    await p.click(sel);
    await p.waitForTimeout(900);
    return records();
  };

  // ── One cell: one account, one payment method, one month ────────────────
  const one = await click(cell("ac-sn", "pm-a"));
  console.log("  Snnehal x Diners: " + JSON.stringify(one));
  ok(one.onRecordsTab, "M3 clicking a figure opens the records list", one);
  eq(one.ids.join(","), "s-a-1",
     "M4 showing exactly the records behind that figure — that account, that card, that month");
  eq(one.account.join(","), "ac-sn", "M5 with the account filter set to it", one.account);
  eq(one.payment.join(","), "pm-a", "M6 and the payment method", one.payment);
  ok(one.ids.indexOf("next-month") === -1,
     "M7 not the same pair a month later — the matrix's own month is the period, " +
     "not today's", one.ids);
  ok(one.ids.indexOf("income") === -1,
     "M8 nor income on the same pair: the matrix counts expenses, so the list must too",
     one.ids);

  // ── A row total: one payment method, every account ──────────────────────
  const row = await click(W + "[data-drill-pm='pm-a']:not([data-drill-ac])");
  console.log("  Diners row total: " + JSON.stringify(row.ids));
  eq(row.ids.slice().sort().join(","), "j-a-1,j-a-2,s-a-1",
     "M9 a row total opens every account's spend on that card");
  eq(row.account.length, 0,
     "M10 with no account filter left over from the cell clicked before it",
     row.account);

  // ── A column total: one account, every payment method ───────────────────
  const col = await click(W + "tr.exp-matrix-footer [data-drill-ac='ac-joint']");
  console.log("  Joint column total: " + JSON.stringify(col.ids));
  eq(col.ids.slice().sort().join(","), "j-a-1,j-a-2,j-b-1",
     "M11 a column total opens that account's spend on every card");
  eq(col.payment.length, 0, "M12 with the previous card filter cleared", col.payment);

  // ── The grand total: the whole month ────────────────────────────────────
  const all = await click(W + "[data-drill-all]");
  console.log("  grand total: " + JSON.stringify(all.ids));
  eq(all.ids.slice().sort().join(","), "j-a-1,j-a-2,j-b-1,s-a-1,s-upi-1",
     "M13 the grand total opens every expense the month counted");
  ok(all.ids.indexOf("income") === -1 && all.ids.indexOf("next-month") === -1,
     "M14 and nothing it did not", all.ids);
  eq(all.account.length + all.payment.length, 0,
     "M15 with neither filter set — the figure holds nothing fixed but the month",
     { ac: all.account, pm: all.payment });

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
