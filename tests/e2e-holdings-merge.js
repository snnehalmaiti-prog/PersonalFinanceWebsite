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

// Second holdings, so the invested-share column has something to divide.
const MF_B_NAV = 100, MF_B = { p: "Alpha", u: 30, px: 100 };
const MF_B_INV = 30 * 100;                       // 3000 → A 70%, B 30% on All
const IND_B_PX = 100, IND_B = { p: "Alpha", u: 10, px: 100 };
const IND_B_INV = 10 * 100;                      // 1000 → CO 67%, CO2 33% on All

const US_PX = 10, USD_INR = 84;
const US_UNITS = 20, US_INV_USD = 20 * 5;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN].concat(MF.map((h) => ["1-Jan-2024", h.p, "Aurora Fund", "Buy", String(h.u), String(h.px)]))
    .concat([["1-Jan-2024", MF_B.p, "Borealis Fund", "Buy", String(MF_B.u), String(MF_B.px)]]),
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Aurora Fund", "Equity", "Flexi Cap", "100001", "INFA"],
    ["Borealis Fund", "Equity", "Flexi Cap", "100002", "INFB"]],
  "wf-stocksetf-data": [TXN]
    .concat(IND.map((h) => ["1-Jan-2024", h.p, "INDIA CO", "Buy", String(h.u), String(h.px)]))
    .concat([["1-Jan-2024", IND_B.p, "INDIA CO 2", "Buy", String(IND_B.u), String(IND_B.px)]])
    .concat([["1-Jan-2024", "Alpha", "US CO", "Buy", String(US_UNITS), "5"]]),
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["INDIA CO", "Equity", "Stock", "Large Cap", "India", "INDCO", "Financials"],
    ["INDIA CO 2", "Equity", "Stock", "Large Cap", "India", "INDCO2", "Energy"],
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

let mfAlphaRows = null;
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
    mf_history: { "100001": Object.fromEntries(DAYS.map((iso) => [iso, MF_NAV])),
                  "100002": Object.fromEntries(DAYS.map((iso) => [iso, MF_B_NAV])) } })));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001", INFB: "100002" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: dmyMon(LAST), nav: String(MF_NAV) },
            "100002": { date: dmyMon(LAST), nav: String(MF_B_NAV) } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: {
    __USD_INR__: { price: USD_INR },
    INDCO: { price: IN_PX, prev_close: IN_PX },
    INDCO2: { price: IND_B_PX, prev_close: IND_B_PX },
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
      nums: [...r.querySelectorAll(".mfh-col-num")].map((c) => {
        const prim = c.querySelector(".mfh-num-primary, .mfh-num-pnl-value");
        return (prim || c).textContent.trim();
      }),
      share: (r.querySelector(".mfh-share-pct") || {}).textContent || "",
      investedCell: (r.querySelectorAll(".mfh-col-num")[0] || {}).textContent || "",
    }));
  }, id);

  const mfAll = await readList("mfh-list");
  const mf = mfAll;
  console.log("  MF rows: " + JSON.stringify(mf));
  const fundA = (mf || []).filter((r) => /Aurora/.test(r.name));

  ok(fundA.length === 1, "M1 Aurora Fund, held in two portfolios, is ONE row", (mf || []).map((r) => r.name));
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
  const indco = (india || []).filter((r) => /^INDIA CO$/.test(r.name.trim()));

  ok(indco.length === 1, "I1 INDIA CO, held in two portfolios, is ONE row", (india || []).map((r) => r.name));
  if (indco.length === 1) {
    const r = indco[0];
    ok(near(money(r.nums[0]), IND_INV, 2), "I2 invested is the sum", { got: money(r.nums[0]), want: IND_INV });
    ok(near(money(r.nums[1]), IND_CUR, 2), "I3 current is the sum", { got: money(r.nums[1]), want: IND_CUR });
    ok(new RegExp("@ ₹" + IND_AVG.toFixed(2)).test(r.sub),
       "I4 average cost re-derived from merged totals", { sub: r.sub, want: IND_AVG.toFixed(2) });
    ok(/Alpha/.test(r.sub) && /Beta/.test(r.sub), "I5 sub-line names both portfolios", r.sub);
    // The merged row must show a REAL rate, recomputed from the combined flows.
    // There are two Stocks/ETF row builders and only the per-portfolio one feeds
    // this list; carrying the flows on the wrong one left this cell at "—".
    // Both lots were bought on the same date, so the whole position is
    // 2000 out on 1-Jan-2024 worth 2250 today — a closed-form check.
    const yrs = (Date.now() - new Date("2024-01-01T00:00:00").getTime()) / (365.25 * 24 * 3600 * 1000);
    const wantXirr = (Math.pow(IND_CUR / IND_INV, 1 / yrs) - 1) * 100;
    const gotXirr = parseFloat(String(r.nums[5]).replace(/[^0-9.\-]/g, ""));
    ok(/%/.test(r.nums[5] || "") && isFinite(gotXirr) && near(gotXirr, wantXirr, 0.5),
       "I6 XIRR is recomputed from the combined cash flows, not dropped",
       { cell: r.nums[5], got: gotXirr, want: Number(wantXirr.toFixed(2)) });
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
    mfAlphaRows = await readList("mfh-list");
    const mfAlpha = mfAlphaRows;
    const a = (mfAlpha || []).filter((r) => /Aurora/.test(r.name));
    console.log("  MF rows (Alpha only): " + JSON.stringify(a));
    ok(a.length === 1 && near(money(a[0].nums[0]), 100 * 40, 2),
       "P1 selecting one portfolio shows only that portfolio's invested, unmerged",
       a.length ? { got: money(a[0].nums[0]), want: 100 * 40 } : a);
    ok(a.length === 1 && !/Beta/.test(a[0].sub),
       "P2 and does not name the other portfolio", a.length ? a[0].sub : a);
  } else {
    ok(false, "P1 the portfolio pill could not be found");
  }

  // ── share of invested, under each Invested figure ───────────────────────
  // The base is the FILTERED set, so every list reads 100% on its own and the
  // figures re-scale when the portfolio pill changes. Computing it from the
  // subtotal the render loop accumulates would leave the first row at 0%.
  const shares = (rows) => (rows || []).map((r) => r.share);
  const sumShare = (rows) => (rows || []).reduce((s, r) => s + (parseFloat(r.share) || 0), 0);

  // On All: Aurora 7000, Borealis 3000 → 70 / 30.
  ok(mfAll && mfAll.length === 2 && shares(mfAll).join(",") === "70%,30%",
     "S1 MF invested shares are each holding's share of the list total",
     shares(mfAll));
  // India: INDIA CO 2000, INDIA CO 2 1000 → 67 / 33.
  ok(india && india.length === 2 && shares(india).join(",") === "67%,33%",
     "S2 India shares likewise", shares(india));
  ok(near(sumShare(india), 100, 1), "S3 and add up to 100%", sumShare(india));
  // The US list is scoped to itself, so its single holding is the whole of it.
  // US rows carry the share on the native-USD line rather than a third line.
  ok(us && us.length === 1 && /100%/.test(us[0].investedCell),
     "S4 the US list is its own base — one holding there is 100% of US, " +
     "not a slice of the India total", us && us[0] && us[0].investedCell);

  // The recompute that matters: picking a portfolio re-bases the column.
  // Alpha holds 4000 of Aurora and 3000 of Borealis → 57 / 43, not 70 / 30.
  ok(mfAlphaRows && mfAlphaRows.length === 2 && shares(mfAlphaRows).join(",") === "57%,43%",
     "S5 selecting a portfolio recomputes the shares against THAT portfolio",
     shares(mfAlphaRows));
  ok(shares(mfAlphaRows).join(",") !== shares(mfAll).join(","),
     "S6 and they genuinely differ from the All figures — otherwise S5 proves nothing",
     { all: shares(mfAll), alpha: shares(mfAlphaRows) });

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
