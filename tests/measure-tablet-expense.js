// Measures the Expense tab's BREAKDOWN table and SETTLEMENT cards across
// phone / tablet / desktop widths.
//
// Both sit in .acc-charts-grid, which is two equal columns above the 760px phone
// breakpoint. On a tablet that gives each card about half of ~1000px — and the
// breakdown table wants a column per account while the settlement card puts TWO
// person cards side by side inside its half. So the table is cut off mid-figure
// ("₹1,4", "₹46,7") and the settlement's transfer amounts and percentage chips
// are clipped.
//
// What is measured:
//   clipped  — an element whose content is wider than its box (scrollWidth >
//              clientWidth). For the matrix that means the table is cut off; for
//              a settlement value it means the number is not fully readable.
//   overflow — a card whose content escapes the card's own box.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/measure-tablet-expense.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const UID = "u1";
// The settlement calculator needs exactly this shape: two accounts flagged
// contributing_account and at least one that is not (the joint one).
const ACCOUNTS = [
  { id: "a1", user_id: UID, name: "Common", sort_order: 1, contributing_account: false },
  { id: "a2", user_id: UID, name: "Snnehal", sort_order: 2, contributing_account: true },
  { id: "a3", user_id: UID, name: "Trisha", sort_order: 3, contributing_account: true },
];
const PMS = [
  { id: "p1", user_id: UID, name: "Joint Account", color: "#10B981", sort_order: 1 },
  { id: "p2", user_id: UID, name: "Snnehal's Account", color: "#B91C1C", sort_order: 2 },
  { id: "p3", user_id: UID, name: "Trisha's Account", color: "#CA8A04", sort_order: 3 },
  { id: "p4", user_id: UID, name: "Diner's Credit Card", color: "#4338CA", sort_order: 4, is_credit_card: true },
  { id: "p5", user_id: UID, name: "Amex Credit Card", color: "#DC2626", sort_order: 5, is_credit_card: true },
];
const CATS = [{ id: "c1", user_id: UID, name: "Household", sort_order: 1 }];

// Figures the size of the ones in the report, so the columns are as wide as they
// really are — a fixture of ₹100s would hide the clipping entirely.
const now = new Date();
const YM = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
const RECORDS = [];
let rid = 0;
function rec(acct, pm, amount) {
  RECORDS.push({ id: "r" + (++rid), type: "expense", amount: amount,
    txn_date: YM + "-05", txn_at: YM + "-05T00:00:00Z", created_at: YM + "-05T00:00:00Z",
    account_id: acct, category_id: "c1", subcategory_id: null, payment_method_id: pm,
    note: "", labels: null });
}
rec("a1", "p1", 50250);
rec("a1", "p4", 38993); rec("a2", "p4", 44300);
rec("a1", "p5", 6722);  rec("a2", "p5", 9000);
rec("a2", "p2", 1400);
const NEXT = new Date(now.getFullYear(), now.getMonth() + 1, 1);
const NYM = NEXT.getFullYear() + "-" + String(NEXT.getMonth() + 1).padStart(2, "0");
[["a2", 63200], ["a3", 16800]].forEach(function (pair, i) {
  RECORDS.push({ id: "b" + i, type: "budget", amount: pair[1], txn_date: NYM + "-01",
    txn_at: NYM + "-01T00:00:00Z", created_at: NYM + "-01T00:00:00Z",
    account_id: pair[0], category_id: "c1", subcategory_id: null,
    payment_method_id: "p1", note: "", labels: null });
});
RECORDS.push({ id: "i1", type: "income", amount: 250000, txn_date: YM + "-01",
  txn_at: YM + "-01T00:00:00Z", created_at: YM + "-01T00:00:00Z",
  account_id: "a1", category_id: null, subcategory_id: null, payment_method_id: "p1", note: "", labels: null });

const WIDTHS = [
  { w: 480, kind: "phone" },
  { w: 760, kind: "phone-max" },
  { w: 768, kind: "tablet" },
  { w: 834, kind: "tablet" },
  { w: 1024, kind: "tablet" },
  { w: 1100, kind: "tablet" },
  { w: 1280, kind: "desktop" },
  { w: 1500, kind: "desktop" },
];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

const PROBE = () => {
  const vis = (e) => e && e.offsetParent !== null;
  // scrollWidth misses text that simply spills with overflow:visible, which is
  // exactly what a squeezed flex row does. Compare the rendered TEXT rectangle
  // against the box instead — that is the ink, and the ink is what gets cut off.
  function inkWidth(e) {
    const r = document.createRange(); r.selectNodeContents(e);
    const b = r.getBoundingClientRect();
    return b.width || e.getBoundingClientRect().width;
  }
  const clipped = (e) => inkWidth(e) - e.getBoundingClientRect().width > 1
                      || e.scrollWidth - e.clientWidth > 1;
  // A label and its value drawn on top of each other in the same flex row.
  function rowCollisions(sel) {
    return [...document.querySelectorAll(sel)].filter(vis).map((row) => {
      const kids = [...row.children].filter(vis);
      if (kids.length < 2) return null;
      const a = kids[0].getBoundingClientRect(), b = kids[1].getBoundingClientRect();
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      return ox > 1 ? [(kids[0].textContent || "").trim().slice(0, 14), +ox.toFixed(1)] : null;
    }).filter(Boolean);
  }

  const matrixWrap = document.getElementById("dash-exp-matrix-wrap");
  const table = matrixWrap ? matrixWrap.querySelector("table") : null;

  // Values that must be readable in full. A clipped rupee figure is worse than
  // useless — "₹1,20,5" reads as a smaller number than it is.
  const money = [...document.querySelectorAll(
    ".settlement-transfer-val, .settlement-row-val, .settlement-person-pct, .settlement-person-name")]
    .filter(vis);

  return {
    rendered: !!(table && vis(matrixWrap)),
    // The wrap scrolls (overflow-x:auto) so it is not "clipped" in the CSS sense;
    // what matters is whether the table needs more room than it has been given.
    matrixOverflowPx: table && matrixWrap ? Math.max(0, Math.round(table.scrollWidth - matrixWrap.clientWidth)) : null,
    settlementCards: [...document.querySelectorAll(".settlement-person-card")].filter(vis).length,
    clippedMoney: money.filter(clipped).map((e) => (e.textContent || "").trim().slice(0, 16)),
    rowCollisions: rowCollisions(".settlement-transfer").concat(rowCollisions(".settlement-row")),
    // How many lines the TRANSFER AMOUNT label is forced onto. One is the design;
    // more means the card has been squeezed narrower than its own content.
    transferLabelLines: (() => {
      const l = document.querySelector(".settlement-transfer-label");
      if (!l) return null;
      const lh = parseFloat(getComputedStyle(l).lineHeight) ||
                 parseFloat(getComputedStyle(l).fontSize) * 1.2;
      return Math.max(1, Math.round(l.getBoundingClientRect().height / lh));
    })(),
    // Settlement person cards side by side inside half a grid column is the
    // squeeze; record how wide they actually end up.
    personCardWidth: (() => { const c = [...document.querySelectorAll(".settlement-person-card")].filter(vis)[0];
                             return c ? Math.round(c.getBoundingClientRect().width) : null; })(),
    gridCols: (() => { const g = document.querySelector(".acc-charts-grid");
                       return g ? getComputedStyle(g).gridTemplateColumns : null; })(),
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth > 1,
  };
};

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1100 } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const json = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

  // Catch-all FIRST: Playwright matches the most recently registered route first,
  // so registering it last would shadow every specific route below it and the
  // expense tab would load with no data at all.
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(json([])));
  await p.route("**/rest/v1/expense_accounts*", (r) => r.fulfill(json(ACCOUNTS)));
  await p.route("**/rest/v1/expense_payment_methods*", (r) => r.fulfill(json(PMS)));
  await p.route("**/rest/v1/expense_categories*", (r) => r.fulfill(json(CATS)));
  await p.route("**/rest/v1/expense_records*", (r) => r.fulfill(json(RECORDS)));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(json({ data: [] })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(json({ fetchedAt: 1, data: {} })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(json({ fetchedAt: 1, data: {} })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(json({ prices: {}, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(json({ stock_history: {} })));
  await p.addInitScript(() => {
    window.Chart = function (ctx, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.zoomScale = function () {}; this.resetZoom = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate(() => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } })); });
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(6000);

  // Open the Expense tab, then its Accounts sub-tab where these two cards live.
  await p.evaluate(() => {
    const t = document.querySelector('[data-tab="expense"]');
    if (t) t.click();
  });
  await p.waitForTimeout(3000);
  await p.evaluate(() => {
    const t = document.querySelector('[data-dash-exp-subtab="accounts"]');
    if (t) t.click();
  });
  await p.waitForTimeout(4000);
  const nav = await p.evaluate(() => ({
    panel: !!document.getElementById("dash-exp-subpanel-accounts"),
    panelHidden: (document.getElementById("dash-exp-subpanel-accounts") || {}).hidden,
    wrapHtml: ((document.getElementById("dash-exp-matrix-wrap") || {}).innerHTML || "").slice(0, 60),
    status: (document.getElementById("dash-exp-matrix-status") || {}).textContent,
    jointHtml: ((document.getElementById("dash-exp-joint-wrap") || {}).innerHTML || "").slice(0, 60),
    records: (window.dashExpState && (window.dashExpState.records || []).length),
    accounts: (window.dashExpState && (window.dashExpState.accounts || []).length),
  }));
  console.log("  NAV " + JSON.stringify(nav));

  const rows = [];
  for (const { w, kind } of WIDTHS) {
    await p.setViewportSize({ width: w, height: 1100 });
    await p.waitForTimeout(600);
    const m = await p.evaluate(PROBE);
    rows.push({ w, kind, m });
    console.log("  " + String(w).padStart(4) + "px " + kind.padEnd(10) +
      " matrixOverflow " + String(m.matrixOverflowPx).padStart(4) + "px" +
      "  personCard " + String(m.personCardWidth).padStart(4) + "px" +
      "  transferLines " + m.transferLabelLines +
      "  clipped " + m.clippedMoney.length + "  collide " + m.rowCollisions.length +
      (m.clippedMoney.length ? " " + JSON.stringify(m.clippedMoney.slice(0, 2)) : ""));
  }

  console.log("");
  const anyRendered = rows.some((r) => r.m.rendered);
  ok(anyRendered, "the breakdown table rendered — otherwise nothing below means anything",
     rows.map((r) => r.m.rendered));
  rows.forEach(({ w, kind, m }) => {
    const clean = m.matrixOverflowPx === 0 && m.clippedMoney.length === 0 &&
                  m.rowCollisions.length === 0 && !m.pageOverflow &&
                  (m.transferLabelLines === null || m.transferLabelLines === 1);
    ok(clean, "at " + w + "px (" + kind + ") the breakdown fits and no settlement figure is clipped",
       { matrixOverflowPx: m.matrixOverflowPx, clipped: m.clippedMoney,
         collisions: m.rowCollisions.slice(0, 3), transferLabelLines: m.transferLabelLines,
         personCard: m.personCardWidth, pageOverflow: m.pageOverflow });
  });
  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
