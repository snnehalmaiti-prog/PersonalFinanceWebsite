// One instrument held in several portfolios = ONE row on "All".
//
// Viewing All used to list the same fund once per portfolio, so a holding split
// across two portfolios read as two unrelated positions and neither row showed
// what was actually held. This checks the merge adds up, re-derives the per-unit
// figures from the merged totals rather than averaging them, names the portfolios
// it came from, and leaves a single-portfolio view untouched.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-holdings-merge.js
const { chromium } = require("playwright");
const PORT = process.env.PORT || 8098;

// Deliberately unequal quantities at unequal prices: a plain average of the two
// average costs would differ from the true blended cost, so the assertion on
// avg-cost distinguishes a correct merge from a lazy one.
const MF_NAV = 50;
const MF = [{ p: "Alpha", u: 100, px: 40 }, { p: "Beta", u: 50, px: 60 }];
const MF_UNITS = 150, MF_INV = 100 * 40 + 50 * 60, MF_CUR = MF_UNITS * MF_NAV;   // 7000, 7500
const MF_AVG = MF_INV / MF_UNITS;                                                 // 46.67, NOT 50

const IN_PX = 150;
const IND = [{ p: "Alpha", u: 10, px: 100 }, { p: "Beta", u: 5, px: 200 }];
const IND_UNITS = 15, IND_INV = 10 * 100 + 5 * 200, IND_CUR = IND_UNITS * IN_PX;  // 2000, 2250
const IND_AVG = IND_INV / IND_UNITS;                                              // 133.33

const US_PX = 10, USD_INR = 84;
const US_UNITS = 20, US_INV_USD = 20 * 5;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN].concat(MF.map((h) => ["1-Jan-2024", h.p, "Fund A", "Buy", String(h.u), String(h.px)])),
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN]
    .concat(IND.map((h) => ["1-Jan-2024", h.p, "INDIA CO", "Buy", String(h.u), String(h.px)]))
    .concat([["1-Jan-2024", "Alpha", "US CO", "Buy", String(US_UNITS), "5"]]),
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["INDIA CO", "Equity", "Stock", "Large Cap", "India", "INDCO", "Financials"],
    ["US CO", "Equity", "Stock", "Large Cap", "US", "USCO", "Technology"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const DAYS = (() => { const o = []; const d = new Date("2024-01-01T00:00:00"), e = new Date("2024-12-01T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; })();
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dmyMon = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${MON[+m - 1]}-${y}`; };
const LAST = DAYS[DAYS.length - 1];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const money = (t) => { const m = String(t || "").match(/[\d,]+(?:\.\d+)?/); return m ? Number(m[0].replace(/,/g, "")) : 0; };
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1 : tol);

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ updated: new Date().toISOString(),
    mf_history: { "100001": Object.fromEntries(DAYS.map((iso) => [iso, MF_NAV])) } })));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: dmyMon(LAST), nav: String(MF_NAV) } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: {
    __USD_INR__: { price: USD_INR },
    INDCO: { price: IN_PX, prev_close: IN_PX },
    USCO: { price: US_PX, prev_close: US_PX } }, usd_inr_history: {}, index_history: {} })));
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
  await p.waitForTimeout(Number(process.env.WAIT || 12000));

  // Each row: name, sub-line, and the numeric cells in column order.
  const readList = (id) => p.evaluate((listId) => {
    const list = document.getElementById(listId);
    if (!list) return null;
    // The subtotal shares .mfh-row but has no instrument name — drop it.
    return [...list.querySelectorAll(".mfh-row")].filter((r) => {
      const n = r.querySelector(".mfh-inst-name");
      return n && n.textContent.trim();
    }).map((r) => ({
      name: (r.querySelector(".mfh-inst-name") || {}).textContent || "",
      sub: (r.querySelector(".mfh-inst-sub") || {}).textContent || "",
      nums: [...r.querySelectorAll(".mfh-col-num")].map((c) => c.textContent.trim()),
    }));
  }, id);

  const mf = await readList("mfh-list");
  console.log("  MF rows: " + JSON.stringify(mf));
  const fundA = (mf || []).filter((r) => /Fund/.test(r.name));

  ok(fundA.length === 1, "M1 Fund A, held in two portfolios, is ONE row", (mf || []).map((r) => r.name));
  if (fundA.length === 1) {
    const r = fundA[0];
    ok(near(money(r.nums[0]), MF_INV, 2), "M2 invested is the sum across both portfolios",
       { got: money(r.nums[0]), want: MF_INV });
    ok(near(money(r.nums[1]), MF_CUR, 2), "M3 current is the sum across both portfolios",
       { got: money(r.nums[1]), want: MF_CUR });
    ok(/150\.0 units/.test(r.sub), "M4 units add up", r.sub);
    // 46.67, not the 50.00 that averaging the two average costs would give.
    ok(new RegExp("@ ₹" + MF_AVG.toFixed(2)).test(r.sub),
       "M5 average cost is re-derived from merged totals, not an average of averages",
       { sub: r.sub, want: MF_AVG.toFixed(2), naiveAverage: "50.00" });
    ok(/Alpha/.test(r.sub) && /Beta/.test(r.sub),
       "M6 the sub-line names every portfolio the row was summed from", r.sub);
  }

  const india = await readList("seh-india-list");
  const us = await readList("seh-us-list");
  console.log("  India rows: " + JSON.stringify(india));
  console.log("  US rows: " + JSON.stringify(us));
  const indco = (india || []).filter((r) => /INDIA CO/.test(r.name));

  ok(indco.length === 1, "I1 INDIA CO, held in two portfolios, is ONE row", (india || []).map((r) => r.name));
  if (indco.length === 1) {
    const r = indco[0];
    ok(near(money(r.nums[0]), IND_INV, 2), "I2 invested is the sum", { got: money(r.nums[0]), want: IND_INV });
    ok(near(money(r.nums[1]), IND_CUR, 2), "I3 current is the sum", { got: money(r.nums[1]), want: IND_CUR });
    ok(new RegExp("@ ₹" + IND_AVG.toFixed(2)).test(r.sub),
       "I4 average cost re-derived from merged totals", { sub: r.sub, want: IND_AVG.toFixed(2) });
    ok(/Alpha/.test(r.sub) && /Beta/.test(r.sub), "I5 sub-line names both portfolios", r.sub);
  }

  // A holding in ONE portfolio must be left exactly as it was — no merge
  // artefacts, and no portfolio prefix cluttering a row that needs no tracing.
  const usco = (us || []).filter((r) => /US CO/.test(r.name));
  ok(usco.length === 1, "U1 the US holding is untouched", (us || []).map((r) => r.name));
  if (usco.length === 1) {
    ok(near(money(usco[0].nums[0]), US_INV_USD * USD_INR, 5),
       "U2 and still values in INR at the USD rate", { got: money(usco[0].nums[0]) });
    ok(!/Alpha \+/.test(usco[0].sub), "U3 with no portfolio-merge prefix", usco[0].sub);
  }

  // Picking one portfolio must show THAT portfolio's figures, not the merged ones.
  const picked = await p.evaluate(() => {
    const btn = document.querySelector('[data-mfh-portfolio="Alpha"]');
    if (!btn) return null;
    btn.click();
    return true;
  });
  if (picked) {
    await p.waitForTimeout(1500);
    const mfAlpha = await readList("mfh-list");
    const a = (mfAlpha || []).filter((r) => /Fund/.test(r.name));
    console.log("  MF rows (Alpha only): " + JSON.stringify(a));
    ok(a.length === 1 && near(money(a[0].nums[0]), 100 * 40, 2),
       "P1 selecting one portfolio shows only that portfolio's invested, unmerged",
       a.length ? { got: money(a[0].nums[0]), want: 100 * 40 } : a);
    ok(a.length === 1 && !/Beta/.test(a[0].sub),
       "P2 and does not name the other portfolio", a.length ? a[0].sub : a);
  } else {
    ok(false, "P1 the portfolio pill could not be found");
  }

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
