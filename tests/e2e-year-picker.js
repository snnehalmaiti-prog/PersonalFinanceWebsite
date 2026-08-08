// The three monthly cards use a decade-grid year picker, with years that have
// no records shown but greyed out.
//
// A native <select> can only omit a year it has no data for, so a gap in the
// history reads as though those years never existed. The grid shows the whole
// decade and disables the empty years.
//
// The fixture leaves a deliberate HOLE: records exist for YEAR-4 and YEAR, but
// not the years between. A picker that merely listed its options would show two
// entries; the grid must show ten cells with the gap greyed.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-year-picker.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

const THIS_YEAR = new Date().getFullYear();
const OLD_YEAR = THIS_YEAR - 4;          // same decade as THIS_YEAR unless it straddles
const HAVE = [OLD_YEAR, THIS_YEAR];

const CATEGORIES = [
  { id: "c1", name: "Household", parent_id: null },
  { id: "s1", name: "Groceries", parent_id: "c1" },
];
const ACCOUNTS = [{ id: "a1", name: "HDFC Card" }];
const RECORDS = HAVE.flatMap((y) => ([
  { id: `${y}i`, txn_date: `${y}-02-05`, amount: 50000, type: "income",  account_id: "a1" },
  { id: `${y}e`, txn_date: `${y}-02-15`, amount: 20000, type: "expense", account_id: "a1",
    category_id: "c1", subcategory_id: "s1", note: "Shop " + y },
]));

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  // Investment rows in the same two years, so CASH FLOW · MONTHLY has the same
  // shape of history as the two expense cards.
  "wf-equity-data": [TXN].concat(HAVE.map((y) => [`5-Feb-${y}`, "Snnehal", "Fund A", "Buy", "100", "10"])),
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const DAYS = (() => { const o = []; const d = new Date(`${OLD_YEAR}-01-01T00:00:00`), e = new Date();
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; })();

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

const CARDS = [
  { name: "CASH FLOW · MONTHLY",        sel: "monthly-invest-cat-year" },
  { name: "Income & Expenses · MONTHLY", sel: "mcf-year" },
  { name: "EXPENSE BY CATEGORY",         sel: "epc-year" },
];

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1400 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ updated: new Date().toISOString(),
    mf_history: { "100001": Object.fromEntries(DAYS.map((iso) => [iso, 12])) } })));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
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

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(7000);

  await p.evaluate(([records, cats, accts]) => {
    window.dashExpState = window.dashExpState || {};
    window.dashExpState.records = records;
    window.dashExpState.categories = cats;
    window.dashExpState.accounts = accts;
    if (window.renderMonthlyCashFlow) window.renderMonthlyCashFlow();
    if (window.renderExpenseCategoryPie) window.renderExpenseCategoryPie();
  }, [RECORDS, CATEGORIES, ACCOUNTS]);
  await p.waitForTimeout(1200);

  const inspect = (selId) => p.evaluate((id) => {
    const sel = document.getElementById(id);
    if (!sel) return { error: "no select " + id };
    const btn = sel.nextElementSibling;
    return {
      selectHidden: getComputedStyle(sel).display === "none",
      hasBtn: !!(btn && btn.classList.contains("wf-yp-btn")),
      btnText: btn ? btn.textContent.trim() : null,
      options: [...sel.options].map((o) => o.value),
    };
  }, selId);

  const openAndRead = (selId) => p.evaluate((id) => {
    const sel = document.getElementById(id);
    const btn = sel.nextElementSibling;
    btn.click();
    const pop = document.querySelector(".wf-yp-pop");
    if (!pop) return { error: "no popover" };
    const cells = [...pop.querySelectorAll(".wf-yp-year")];
    return {
      range: (pop.querySelector(".wf-yp-range") || {}).textContent.trim(),
      navs: pop.querySelectorAll(".wf-yp-nav").length,
      cells: cells.map((c) => c.textContent.trim()),
      enabled: cells.filter((c) => !c.classList.contains("is-disabled")).map((c) => c.textContent.trim()),
      greyed: cells.filter((c) => c.classList.contains("is-disabled")).map((c) => c.textContent.trim()),
      greyedAreDisabled: cells.filter((c) => c.classList.contains("is-disabled")).every((c) => c.disabled),
      selected: cells.filter((c) => c.classList.contains("is-selected")).map((c) => c.textContent.trim()),
      cols: getComputedStyle(pop.querySelector(".wf-yp-grid")).gridTemplateColumns.split(" ").length,
    };
  }, selId);

  for (const card of CARDS) {
    const info = await inspect(card.sel);
    ok(!info.error && info.hasBtn && info.selectHidden,
       `P1 ${card.name}: the native select is replaced by a picker button`, info);
    if (info.error || !info.hasBtn) continue;

    const popped = await openAndRead(card.sel);
    console.log("  " + card.name + ": " + JSON.stringify(popped));
    ok(popped.cells.length === 10,
       `P2 ${card.name}: the grid shows a full decade, not just the years with data`,
       { cells: popped.cells.length, options: info.options.length });
    ok(popped.cols === 4, `P3 ${card.name}: four years to a row`, popped.cols);
    ok(popped.navs === 2 && /\d{4}\s*–\s*\d{4}/.test(popped.range),
       `P4 ${card.name}: a decade range header with both arrows`, popped);
    ok(popped.enabled.join(",") === info.options.join(","),
       `P5 ${card.name}: exactly the years with records are clickable`,
       { enabled: popped.enabled, options: info.options });
    ok(popped.greyed.length === 10 - info.options.length && popped.greyedAreDisabled,
       `P6 ${card.name}: the rest are greyed AND actually disabled`, popped.greyed);
    ok(popped.selected.join(",") === info.btnText,
       `P7 ${card.name}: the current year is marked selected`,
       { selected: popped.selected, btn: info.btnText });
    await p.evaluate(() => window.WfYearPicker.close());
  }

  // Choosing a year must drive the card, not just relabel the button.
  const before = await p.evaluate(() => (document.getElementById("epc-status") || {}).textContent);
  await p.evaluate((y) => {
    const sel = document.getElementById("epc-year");
    sel.nextElementSibling.click();
    const cell = [...document.querySelectorAll(".wf-yp-year")].find((c) => c.textContent.trim() === String(y));
    cell.click();
  }, OLD_YEAR);
  await p.waitForTimeout(800);
  const after = await p.evaluate(() => ({
    status: (document.getElementById("epc-status") || {}).textContent,
    btn: document.getElementById("epc-year").nextElementSibling.textContent.trim(),
    selValue: document.getElementById("epc-year").value,
    popOpen: !!document.querySelector(".wf-yp-pop"),
  }));
  console.log("  after picking " + OLD_YEAR + ": " + JSON.stringify(after));

  ok(after.btn === String(OLD_YEAR) && after.selValue === String(OLD_YEAR),
     "P8 picking a year updates the button and the underlying select", after);
  ok(new RegExp(String(OLD_YEAR)).test(after.status) && after.status !== before,
     "P9 and re-renders the card for that year — the select's change handler ran",
     { before: before, after: after.status });
  ok(after.popOpen === false, "P10 and closes the popover", after.popOpen);

  // A greyed year must do nothing at all.
  const greyedClick = await p.evaluate(() => {
    const sel = document.getElementById("epc-year");
    sel.nextElementSibling.click();
    const cell = [...document.querySelectorAll(".wf-yp-year.is-disabled")][0];
    const label = cell.textContent.trim();
    cell.click();
    return { label: label, stillOpen: !!document.querySelector(".wf-yp-pop"),
             value: document.getElementById("epc-year").value };
  });
  ok(greyedClick.value === String(OLD_YEAR) && greyedClick.stillOpen,
     "P11 clicking a greyed year changes nothing", greyedClick);
  await p.evaluate(() => window.WfYearPicker.close());

  // ── the popover must stay on screen, at every width ──────────────────────
  // These buttons sit at the right edge of their card. Anchoring the popover's
  // left to the button pushed it past the viewport, and the four-column grid
  // squeezed and clipped instead of moving. Measured, not assumed.
  const geom = (selId) => p.evaluate((id) => {
    const sel = document.getElementById(id);
    const btn = sel.nextElementSibling;
    btn.click();
    const pop = document.querySelector(".wf-yp-pop");
    if (!pop) return { error: "no popover" };
    const r = pop.getBoundingClientRect();
    const cells = [...pop.querySelectorAll(".wf-yp-year")].map((c) => c.getBoundingClientRect());
    const rows = {};
    cells.forEach((c) => { const k = Math.round(c.top); rows[k] = (rows[k] || 0) + 1; });
    const perRow = Object.keys(rows).sort((a, b) => a - b).map((k) => rows[k]);
    return {
      left: Math.round(r.left), right: Math.round(r.right),
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight,
      perRow: perRow,
      // Any cell whose ink is wider than its box means the grid squeezed.
      squeezed: [...pop.querySelectorAll(".wf-yp-year")].some((c) => c.scrollWidth > c.clientWidth + 1),
    };
  }, selId);

  for (const w of [1500, 1280, 1024, 900]) {
    await p.setViewportSize({ width: w, height: 1000 });
    await p.waitForTimeout(400);
    for (const card of CARDS) {
      const g = await geom(card.sel);
      await p.evaluate(() => window.WfYearPicker.close());
      if (g.error) { ok(false, `G0 ${w}px ${card.name}: popover opened`, g); continue; }
      ok(g.left >= 0 && g.right <= g.vw && g.top >= 0 && g.bottom <= g.vh,
         `G1 ${w}px ${card.name}: the popover is fully inside the viewport`, g);
      ok(g.perRow.join(",") === "4,4,2",
         `G2 ${w}px ${card.name}: the grid keeps four columns (4,4,2)`, g.perRow);
      ok(g.squeezed === false,
         `G3 ${w}px ${card.name}: no year cell is squeezed narrower than its text`, g);
    }
  }
  await p.setViewportSize({ width: 1500, height: 1400 });

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
