// Measures the Fixed Income Holding sub-total row against its own header.
//
// Reported on a tablet: the sub-total's Unrealized figure broke across two lines
// ("+" alone above "₹11,85,649") and the amount drifted left out of its column,
// so the row no longer lined up with INVESTED / CURRENT / UNREALIZED / RETURN %.
//
// The row and the header declare the same grid, so the columns themselves are
// not the problem — the cell contents are wider than the track they sit in at
// tablet widths, and a numeric cell that is allowed to wrap breaks between the
// sign and the digits. Two objective things are measured:
//
//   wrap   — a numeric cell rendering taller than one line of its own text.
//   drift  — the sub-total cell's right edge not lining up with the header
//            cell's right edge for the same column (both are right-aligned,
//            so equal right edges is exactly what "aligned" means).
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/measure-fi-subtotal-align.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

// Seven-figure values on purpose: the overflow is a function of rendered text
// width, so a fixture with small numbers would hide the very thing being checked.
const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  // Twelve holdings, as in the report: above the fold threshold, so the list
  // renders collapsed behind a "Show N instruments" toggle with the sub-total
  // still visible — the exact state the misalignment was seen in.
  "wf-fd-data": [FD_HDR].concat(
    Array.from({ length: 11 }, (_, i) => ["1-Apr-2015", i % 2 ? "Trisha" : "Snnehal",
      ["HDFC", "ICICI", "SBI", "AXIS"][i % 4], "Long Deposit " + (i + 1),
      "Fixed Income", ["Fixed Deposit", "Public Provident Fund", "Provident Fund"][i % 3], "Deposit", String(300000 - i * 8000), "1-Apr-2030", "7.5%", ""])
  ).concat([["1-Apr-2016", "Snnehal", "SBI", "Savings", "Fixed Income", "Savings Account", "Deposit", "617000", "", "3%", ""]]),
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const WIDTHS = [
  { w: 480, kind: "phone" },
  { w: 760, kind: "phone-max" },
  { w: 768, kind: "tablet" },
  { w: 810, kind: "tablet" },
  { w: 834, kind: "tablet" },
  { w: 900, kind: "tablet" },
  { w: 1024, kind: "tablet" },
  { w: 1100, kind: "tablet-max" },
  { w: 1280, kind: "desktop" },
  { w: 1500, kind: "desktop" },
];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1400 } });
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

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);

  const measure = () => p.evaluate(() => {
    const list = document.getElementById("fih-list");
    if (!list) return { error: "no fih-list" };
    const header = list.querySelector(".mfh-list-header");
    const rows = [...list.querySelectorAll(".mfh-row")];
    // The sub-total is the row whose first cell says SUB-TOTAL.
    const foot = rows.find((r) => /SUB-TOTAL/i.test((r.children[0] || {}).textContent || ""));
    if (!header || !foot) return { error: "no header or sub-total", rows: rows.length };

    const hCells = [...header.children];
    const fCells = [...foot.children];
    // The sub-total's first cell spans two columns, so its numeric cells line up
    // with header cells 2..5 (Invested, Current, Unrealized, Return %).
    const pairs = [];
    for (let i = 1; i < fCells.length; i++) {
      const h = hCells[i + 1], f = fCells[i];
      if (!h || !f) continue;
      const hr = h.getBoundingClientRect(), fr = f.getBoundingClientRect();
      const cs = getComputedStyle(f);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
      pairs.push({
        col: h.textContent.trim().replace(/[↓↑]\s*$/, "").trim(),
        text: f.textContent.trim(),
        rightDrift: Math.round(fr.right - hr.right),
        // Taller than ~1.6 lines means the content broke onto a second line.
        wrapped: fr.height > lh * 1.6,
        spill: f.scrollWidth > f.clientWidth + 1,
        fontSize: cs.fontSize,
      });
    }
    return { pairs, footRight: Math.round(foot.getBoundingClientRect().right),
             headRight: Math.round(header.getBoundingClientRect().right) };
  });

  const results = [];
  for (const { w, kind } of WIDTHS) {
    await p.setViewportSize({ width: w, height: 1400 });
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(6000);
    // The Fixed Income Holding list lives on the Fixed Income/Commodity sub-tab.
    await p.evaluate(() => {
      // The Fixed Income/Commodity list lives inside the Investments tab, so the
      // top-level tab has to be opened first — otherwise the sub-panel resolves
      // to display:none and nothing can be measured.
      const top = document.querySelector('[data-tab="investment"]');
      if (top) top.click();
      const t = document.getElementById("subtab-fixedincome");
      if (t) t.click();
    });
    await p.waitForTimeout(1500);
    const m = await measure();
    results.push({ w, kind, ...m });
    console.log("  " + String(w).padStart(4) + "px " + kind.padEnd(11) + " " +
      (m.error ? "ERROR " + m.error : JSON.stringify(m.pairs)));
  }

  const usable = results.filter((r) => !r.error);
  ok(usable.length === WIDTHS.length, "A0 the sub-total row was found at every width",
     results.filter((r) => r.error).map((r) => r.w + ":" + r.error));

  // 480px is excluded deliberately, not because it passes: the instrument column
  // has a 180px floor, which at phone width leaves the four numeric tracks too
  // narrow for a seven-figure Unrealized value, so it still wraps there. The
  // reported problem was the tablet, and lowering that floor is a phone-layout
  // change with its own consequences — tracked, not silently asserted away.
  const tabletUp = usable.filter((r) => r.w >= 760);
  const wrapped = tabletUp.filter((r) => r.pairs.some((c) => c.wrapped));
  ok(wrapped.length === 0, "A1 no sub-total cell breaks across two lines",
     wrapped.map((r) => ({ w: r.w, cells: r.pairs.filter((c) => c.wrapped).map((c) => c.col + "=" + c.text) })));

  const spilled = tabletUp.filter((r) => r.pairs.some((c) => c.spill));
  ok(spilled.length === 0, "A2 no sub-total cell is wider than the box holding it",
     spilled.map((r) => ({ w: r.w, cells: r.pairs.filter((c) => c.spill).map((c) => c.col + "=" + c.text) })));

  // Both header and sub-total cells are right-aligned, so their right edges must
  // coincide. 1px of sub-pixel rounding is tolerated; a drifting column is not.
  const drifted = tabletUp.filter((r) => r.pairs.some((c) => Math.abs(c.rightDrift) > 1));
  ok(drifted.length === 0, "A3 every sub-total column lines up with its header column",
     drifted.map((r) => ({ w: r.w, cells: r.pairs.filter((c) => Math.abs(c.rightDrift) > 1)
       .map((c) => c.col + " off by " + c.rightDrift + "px") })));

  // The reported symptom was the Unrealized figure breaking across two lines and
  // drifting out of its column. The cause was type size: those cells carried no
  // size class, so they rendered at the inherited 16px beside 11.52px neighbours.
  const mixed = usable.filter((r) => new Set(r.pairs.map((c) => c.fontSize)).size > 1);   // all widths
  ok(mixed.length === 0,
     "A4 every sub-total figure is the same type size — the cause of the break",
     mixed.map((r) => ({ w: r.w, sizes: r.pairs.map((c) => c.col + "=" + c.fontSize) })));

  // And that size must be the one the body rows use, not merely self-consistent.
  const bodySizes = await p.evaluate(() => {
    const list = document.getElementById("fih-list");
    const rows = [...list.querySelectorAll(".mfh-row")];
    const foot = rows.find((r) => /SUB-TOTAL/i.test((r.children[0] || {}).textContent || ""));
    const body = rows.find((r) => r !== foot && r.querySelector(".mfh-inst-name"));
    if (!body || !foot) return null;
    const num = (r) => [...r.children].filter((c) => c.classList.contains("mfh-col-num"))
      .map((c) => getComputedStyle(c).fontSize);
    return { body: num(body), foot: num(foot) };
  });
  ok(bodySizes && JSON.stringify(bodySizes.body) === JSON.stringify(bodySizes.foot),
     "A5 and matches the body rows column for column", bodySizes);

  // Sub-category badges wrap inside ONE tinted box rather than producing a second
  // background fragment on the next line.
  // The list renders folded, so the instrument rows are display:none and have no
  // boxes to measure. Expand it first.
  await p.evaluate(() => {
    const t = document.querySelector("#fih-list .wf-fold-toggle");
    if (t && /Show/.test(t.textContent)) t.click();
  });
  await p.waitForTimeout(400);
  const badge = await p.evaluate(() => {
    // Pick the longest badge — the short ones never wrap and prove nothing.
    const all = [...document.querySelectorAll("#fih-list .mfh-row .mfh-sip-badge")];
    const b = all.sort((x, y) => y.textContent.length - x.textContent.length)[0];
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { display: cs.display, boxes: b.getClientRects().length, text: b.textContent.trim() };
  });
  ok(badge && /inline-block|block/.test(badge.display) && badge.boxes === 1,
     "A6 a wrapped sub-category badge is one continuous box, not two", badge);

  const phone = usable.filter((r) => r.w < 760);
  console.log("  known, out of scope — phone widths still wrap: " +
    JSON.stringify(phone.map((r) => ({ w: r.w,
      wrapped: r.pairs.filter((c) => c.wrapped).map((c) => c.col) }))));

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
