// Clicking a month in NET WORTH · MONTHLY says which Instrument Category moved it.
//
// This works at category level for one reason: the split is ALREADY a record.
// Every live snapshot has stored equity / fixed_income / commodity in the same
// write as the total since day one, so the panel reads the same row the bar came
// from. There is no second derivation to reconcile — which is what makes the
// parts sum to the bar rather than approach it.
//
// The fixture carries the traps up front rather than waiting for them to be
// discovered:
//   • a gold ETF in the STOCKS sheet — Commodity by its own Instrument Category,
//     not Equity by the sheet it lives in. Assuming the sheet is the exact
//     double-count e2e-category-split guards.
//   • a debt fund in the EQUITY sheet — Fixed Income for the mirror reason.
//   • a holding with a BLANK Portfolio Name — in the household total and in no
//     named portfolio. One such row previously took a per-portfolio split from
//     179 of 179 rows to 0.
//   • a sale, so a month exists where money leaves.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-nwm-category-drill.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FDH = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
             "Instrument Sub Category", "Transaction Type", "Invested Amount",
             "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Fund A", "Buy", "1000", "10"],
    ["1-Mar-2024", "Trisha", "Debt Fund", "Buy", "500", "20"],
    ["1-Jun-2024", "Snnehal", "Fund A", "Sell", "200", "12"],
    ["1-Jan-2024", "", "Fund A", "Buy", "300", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"],
    ["Debt Fund", "Fixed Income", "Debt Fund", "100002", "INFB"]],
  "wf-stocksetf-data": [TXN, ["1-Feb-2024", "Snnehal", "GOLDBEES", "Buy", "100", "50"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["GOLDBEES", "Commodity", "Gold ETF", "ETF", "India", "GOLDBEES", "Gold"]],
  "wf-fd-data": [FDH,
    ["1-Jan-2024", "Snnehal", "HDFC", "FD-1", "Fixed Income", "Fixed Deposit", "Buy", "100000", "1-Jan-2027", "7%", ""],
    ["1-Jan-2024", "Trisha", "EPFO", "PF-1", "Fixed Income", "Provident Fund", "Buy", "50000", "", "", ""],
    ["1-Jan-2024", "Snnehal", "—", "Physical Gold", "Commodity", "Gold", "Buy", "", "", "", "10"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

// WEEKDAYS ONLY, because that is what NAV and stock history actually are.
// Pricing every calendar day lets a valuation walk look right while silently
// depending on a price existing for whatever date it asks about; here it has to
// fall back to the last close, as it does in production every weekend.
//
// It does NOT make the timeline sparse — the physical gold holding densifies
// that to every calendar day (script.js, "Fill daily dates for commodity").
const DAYS = (() => { const o = []; const d = new Date("2024-01-01T00:00:00"), e = new Date();
  while (d <= e) { const w = d.getDay();
    if (w !== 0 && w !== 6) o.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1); } return o; })();
const dmy = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
// Prices that MOVE, so several categories have something to report. Flat prices
// let "more than one category moved" pass on a single row.
const navA = (iso) => (10 + (new Date(iso).getMonth() + 1) * 0.5).toFixed(4);
const navB = (iso) => (20 - (new Date(iso).getMonth() + 1) * 0.3).toFixed(4);
const pxG  = (iso) => +(50 + (new Date(iso).getMonth() + 1) * 1.2).toFixed(2);

let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (d !== undefined ? "  → " + JSON.stringify(d) : "")); } };
const money = (t) => {
  const s = String(t || "");
  const n = Number(s.replace(/[^0-9.]/g, "")) || 0;
  // formatCurrency renders compact Indian units, so "−₹1.07 CR" is −1,07,00,000.
  // Stripping non-digits alone puts crores and rupees on one scale.
  const m = /\bCR\b/i.test(s) ? 1e7 : /\bL\b/i.test(s) ? 1e5 : /\bK\b/i.test(s) ? 1e3 : 1;
  return (/−|-/.test(s) ? -n : n) * m;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

  let stored = [], posted = [];
  await p.route("**://*.supabase.co/**", (r) => {
    const req = r.request(), u = req.url();
    if (/net_worth_snapshots/.test(u)) {
      if (req.method() === "POST") {
        try { (JSON.parse(req.postData() || "[]")).forEach((row) => {
          posted.push(row);
          const i = stored.findIndex((x) => x.snapshot_date === row.snapshot_date);
          if (i >= 0) stored[i] = Object.assign({}, stored[i], row); else stored.push(row);
        }); } catch (e) {}
        return r.fulfill(j([]));
      }
      return r.fulfill(j(stored));
    }
    return r.fulfill(j([]));
  });
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: DAYS.map((i) => ({ date: dmy(i), nav: navA(i) })).reverse() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ updated: new Date().toISOString(),
    mf_history: { "100001": Object.fromEntries(DAYS.map((i) => [i, +navA(i)])),
                  "100002": Object.fromEntries(DAYS.map((i) => [i, +navB(i)])) } })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001", INFB: "100002" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: "01-Aug-2026", nav: navA("2026-08-01") },
            "100002": { date: "01-Aug-2026", nav: navB("2026-08-01") } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: 84 }, GOLDBEES: { price: pxG("2026-08-01") } },
    usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({
    stock_history: { GOLDBEES: { currency: "INR", prices: Object.fromEntries(DAYS.map((i) => [i, pxG(i)])) } } })));
  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.zoomScale = function () {}; this.resetZoom = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  const load = async () => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate((s) => {
      const keep = localStorage.getItem("wf-sb-session");
      localStorage.clear();
      localStorage.setItem("wf-sb-session", keep || JSON.stringify({ access_token: "x",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      localStorage.setItem("wf-gold-premium-pct", "0");
      // Without a rate the provident fund accrues nothing, and the defect this
      // suite is meant to catch — interest credited that the value never gains —
      // cannot occur at all. Both mutants survived until this was set.
      localStorage.setItem("wf-epf-interest-rates", JSON.stringify(
        [2023, 2024, 2025, 2026].map((y) => ({ year: y, rate: 8.25 }))));
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
    }, SHEETS);
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(14000);
  };

  await load();   // reconstructs month ends and fills their categories
  const withCats = stored.filter((r) => r.equity != null).length;
  console.log("  stored " + stored.length + " rows, " + withCats + " with categories");
  ok(stored.length >= 12, "S0 the backfill wrote rows to work with", stored.length);
  ok(withCats === stored.length,
     "S1 every reconstructed row carries its category columns — planBackfill " +
     "writes them as null, which would leave half the history undrillable",
     { withCats, rows: stored.length });
  const badSums = stored.filter((r) => {
    if (r.equity == null) return false;
    const s = Number(r.equity) + Number(r.fixed_income) + Number(r.commodity);
    return Math.abs(s - Number(r.total)) > Math.max(1, Math.abs(Number(r.total)) * 0.005);
  });
  ok(badSums.length === 0,
     "S2 and they sum to that row's OWN total — the parts and the whole are " +
     "written together, so this is exact rather than approximate",
     badSums.slice(0, 2).map((r) => [r.snapshot_date, r.total, r.equity, r.fixed_income, r.commodity]));
  // The classification traps: every holding must land where its Instrument
  // Category says, not where the sheet it happens to live in says.
  //
  // Asserted DIFFERENTIALLY, on the month the holding arrives. "Commodity > 0"
  // would have been satisfied by the physical gold alone and told us nothing
  // about the ETF — the trap the fixture exists for. The fixture is built so
  // each arrival is isolated: physical gold is the only commodity in January,
  // the ETF is bought on 1 February, the debt fund on 1 March.
  // By MONTH, not by exact date: a month end is whatever the last day with
  // prices was, so March 2024 is recorded on Friday the 29th.
  const at = (m) => stored.find((r) => String(r.snapshot_date).slice(0, 7) === m) || {};
  const jan = at("2024-01"), feb = at("2024-02"), mar = at("2024-03");
  ok(Number(jan.commodity) > 0,
     "S3 physical gold is Commodity — it is the only commodity holding in " +
     "January, so this is the gold grams and nothing else", jan);
  const etfAtFeb = 100 * pxG("2024-02-15");            // 100 units × ₹52.40
  ok(Math.abs((Number(feb.commodity) - Number(jan.commodity)) - etfAtFeb) <= etfAtFeb * 0.02,
     "S3b and buying the gold ETF moves Commodity by exactly its value, not " +
     "Equity — it lives in the STOCKS sheet, so a sheet-based rollup puts it " +
     "in Equity and this difference goes to zero",
     { rise: Number(feb.commodity) - Number(jan.commodity), etfAtFeb,
       equityRise: Number(feb.equity) - Number(jan.equity) });
  const debtAtMar = 500 * +navB("2024-03-15");          // 500 units × ₹19.10
  ok(Math.abs((Number(mar.fixed_income) - Number(feb.fixed_income)) - debtAtMar) <= debtAtMar * 0.35,
     "S4 and the debt fund moves Fixed Income though it lives in the EQUITY " +
     "sheet — loose tolerance because deposit interest accrues into the same " +
     "column over that month, which can only push the gap up, never hide it",
     { rise: Number(mar.fixed_income) - Number(feb.fixed_income), debtAtMar,
       equityRise: Number(mar.equity) - Number(feb.equity) });

  await load();   // rows now exist, so the card and the drill-down can read them

  const drill = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    if (!c) return { err: "no chart" };
    let idx = -1;
    for (let i = c.data.labels.length - 1; i >= 0; i--) {
      if (c.data.datasets.some((d) => d.data[i] != null)) { idx = i; break; }
    }
    if (idx < 0) return { err: "no filled bar" };
    c.options.onClick({}, [{ index: idx, datasetIndex: 0 }], c);
    const ov = document.getElementById("nwm-drill-overlay");
    const totals = {};
    document.querySelectorAll("#nwm-drill-totals .mic-hs-tot").forEach((el) => {
      totals[(el.querySelector(".mic-hs-tot-label") || {}).textContent] =
        (el.querySelector("b") || {}).textContent; });
    return { label: c.data.labels[idx], open: ov && !ov.hidden, totals,
             sub: (document.getElementById("nwm-drill-sub") || {}).textContent,
             headers: [...document.querySelectorAll("#nwm-drill-body thead th")].map((t) => t.textContent.trim()),
             rows: [...document.querySelectorAll("#nwm-drill-body tbody tr")]
               .map((tr) => [...tr.children].map((td) => td.textContent.trim())) };
  });
  console.log("  " + JSON.stringify({ label: drill.label, totals: drill.totals, rows: (drill.rows || []).length }));

  ok(!drill.err && drill.open, "D1 clicking a month opens the drill-down", drill);
  ok((drill.rows || []).length >= 2,
     "D2 with a row per category that moved — more than one, which is what the " +
     "moving fixture is for", drill.rows);
  const cats = (drill.rows || []).map((r) => r[0]);
  ok(cats.indexOf("Equity") !== -1 && cats.indexOf("Fixed Income") !== -1,
     "D3 named by Instrument Category", cats);
  ok((drill.headers || []).join(",").indexOf("Market") !== -1, "D4 with a Market column", drill.headers);

  // The property the whole design turns on.
  const M = money(drill.totals["Market"]);
  const sum = (drill.rows || []).reduce((a, r) => a + money(r[6]), 0);
  ok(Math.abs(sum - M) <= Math.max(2, Math.abs(M) * 0.002),
     "D5 the categories' market figures sum to the bar's — exactly, because both " +
     "are read from the same recorded rows", { rows: sum, market: M });
  ok(drill.totals["Unreconciled"] === undefined,
     "D6 with no Unreconciled line at all", drill.totals);

  // Interest and idle cash belong to Fixed Income and nowhere else.
  const eq = (drill.rows || []).find((r) => r[0] === "Equity");
  const fi = (drill.rows || []).find((r) => r[0] === "Fixed Income");
  ok(eq && eq[4] === "—", "D7 Equity never carries interest — it is Fixed Income by definition", eq);
  ok(fi && money(fi[4]) > 0, "D8 while Fixed Income does", fi);

  // A loss has to LOOK like a loss. The table styles .num.pos / .num.out; the
  // Overview's own .mic-hs-pos / .negative match nothing here, so Market
  // rendered in plain body text and a loss read the same as a gain.
  const paint = await p.evaluate(() =>
    [...document.querySelectorAll("#nwm-drill-body tbody tr")].map((tr) => {
      const td = [...tr.children];
      const m = td[6];
      return { text: m.textContent.trim(), cls: m.className,
               colour: getComputedStyle(m).color,
               dashes: td.filter((c) => c.textContent.trim() === "—")
                         .map((c) => getComputedStyle(c).color) };
    }));
  const signed = paint.filter((r) => /[+−-]/.test(r.text));
  ok(signed.length > 0 && signed.every((r) => /\b(pos|out)\b/.test(r.cls)),
     "D13 every Market figure carries a class the table actually styles",
     paint.map((r) => [r.text, r.cls]));
  ok(signed.every((r) => /^-|−/.test(r.text)
       ? /2[34]\d, ?9[0-9]|232|E8|rgb\(232/.test(r.colour) || r.colour !== "rgb(0, 0, 0)"
       : true),
     "D14 and resolves to a colour rather than falling back to body text",
     signed.map((r) => [r.text, r.colour]));
  const dashColours = paint.flatMap((r) => r.dashes);
  ok(dashColours.every((c) => c !== "rgb(232, 98, 58)"),
     "D15 while an em-dash takes no colour — it is not a loss, and colouring " +
     "the whole column painted the blanks red", dashColours);

  // Invested must mean what it means on CASH FLOW · MONTHLY.
  //
  // That card shows money IN, gross, and does not list withdrawals in its
  // aggregate view at all. This panel used to report the NET under the same
  // word, so a month that bought 86,878 of equity and sold 31,502 read 55,376
  // here and 86,878 there, with nothing on screen accounting for the gap.
  // June 2024 sells 200 units of Fund A at 12 and buys nothing, so the two
  // figures are as far apart as they get: nothing in, 2,400 out.
  const june = await p.evaluate(() => {
    const sel = document.getElementById("nwm-year");
    if (sel) { sel.value = "2024"; if (sel.onchange) sel.onchange(); }
    return new Promise((res) => setTimeout(() => {
      const c = window.__wfNwmChart;
      const i = (c.data.labels || []).findIndex((l) => /Jun/.test(l));
      if (i < 0) return res({ err: "no June bar", labels: c.data.labels });
      c.options.onClick({}, [{ index: i, datasetIndex: 0 }], c);
      res({ label: c.data.labels[i],
            headers: [...document.querySelectorAll("#nwm-drill-body thead th")].map((t) => t.textContent.trim()),
            rows: [...document.querySelectorAll("#nwm-drill-body tbody tr")]
              .map((tr) => [...tr.children].map((td) => td.textContent.trim())) });
    }, 2500));
  });
  const jEq = (june.rows || []).find((r) => r[0] === "Equity");
  ok((june.headers || []).indexOf("Withdrawn") !== -1,
     "D9 the panel has a Withdrawn column — netting a sale into Invested hid " +
     "it entirely, and made a month that bought and sold ten lakh look quiet",
     june.headers);
  ok(jEq && jEq[2] === "—",
     "D10 a month that bought nothing shows nothing invested, rather than a " +
     "negative Invested figure standing in for a sale", jEq);
  ok(jEq && Math.abs(money(jEq[3]) + 2400) <= 5,
     "D11 and reports the 2,400 sold in its own column", jEq);
  // Still reconciles: only the net may reach Market.
  const jSum = (june.rows || []).reduce((a, r) => a + money(r[6]), 0);
  const jMkt = await p.evaluate(() => {
    const el = [...document.querySelectorAll("#nwm-drill-totals .mic-hs-tot")]
      .find((e) => /Market/.test(e.textContent));
    return el ? (el.querySelector("b") || {}).textContent : null;
  });
  ok(Math.abs(jSum - money(jMkt)) <= Math.max(2, Math.abs(money(jMkt)) * 0.002),
     "D12 while Market is still reduced by the NET — reporting both figures " +
     "must not change the arithmetic", { rows: jSum, market: jMkt });

  // A month where money actually went IN, which the latest month has none of.
  // March 2024 is the debt fund purchase — 500 units at ₹20, Fixed Income by
  // its mapping though it sits in the equity sheet. Every assertion above would
  // hold with contributions routed to the wrong category, because the row
  // markets would still sum to the bar: one category over, another under, the
  // total unchanged. This is the one that says WHICH row the money went to.
  await p.evaluate(() => {
    const y = document.getElementById("nwm-year");
    y.value = "2024";
    y.dispatchEvent(new Event("change"));
  });
  await p.waitForTimeout(2500);
  const inv = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    const i = c.data.labels.findIndex((l) => /Mar/.test(l));
    if (i < 0) return { err: "no March bar", labels: c.data.labels };
    c.options.onClick({}, [{ index: i, datasetIndex: 0 }], c);
    const totals = {};
    document.querySelectorAll("#nwm-drill-totals .mic-hs-tot").forEach((el) => {
      totals[(el.querySelector(".mic-hs-tot-label") || {}).textContent] =
        (el.querySelector("b") || {}).textContent; });
    return { label: c.data.labels[i], totals,
             rows: [...document.querySelectorAll("#nwm-drill-body tbody tr")]
               .map((tr) => [...tr.children].map((td) => td.textContent.trim())) };
  });
  const fiMar = (inv.rows || []).find((r) => r[0] === "Fixed Income");
  const eqMar = (inv.rows || []).find((r) => r[0] === "Equity");
  ok(!inv.err && fiMar && Math.abs(money(fiMar[2]) - 10000) <= 500,
     "I1 the debt fund purchase is Invested on the Fixed Income row — ₹10,000 " +
     "of it, not a market gain, and not on Equity because that is the sheet it " +
     "was bought in", { fiMar, err: inv.err });
  ok(eqMar && money(eqMar[2]) === 0,
     "I2 while Equity shows no money in that month — nothing was bought there",
     eqMar);
  ok(inv.totals && inv.totals["Unreconciled"] === undefined,
     "I3 and the month still reconciles, so the contribution was moved to the " +
     "right row rather than merely subtracted from the wrong one", inv.totals);
  await p.evaluate(() => document.getElementById("nwm-drill-close").click());
  await p.evaluate(() => {
    const y = document.getElementById("nwm-year");
    y.value = y.options[y.options.length - 1].value;
    y.dispatchEvent(new Event("change"));
  });
  await p.waitForTimeout(2500);

  // Fixed Income must show NO market movement.
  //
  // The fixture's fixed income is a deposit and a provident fund. Neither has a
  // market price, so neither can have a market gain or loss — but PF is carried
  // at PAR by buildFdValueEvents while _nwmInterestByMonth credits it interest
  // every month, and market is a residual. The interest was being subtracted
  // from a change that never contained it, so every month reported a Fixed
  // Income market LOSS of exactly the interest. Reported from Aug 2023:
  // interest +3,352, market −3,352.
  const fiMarket = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    const out = [];
    for (let i = 0; i < c.data.labels.length; i++) {
      if (!c.data.datasets.some((d) => d.data[i] != null)) continue;
      c.options.onClick({}, [{ index: i, datasetIndex: 0 }], c);
      const row = [...document.querySelectorAll("#nwm-drill-body tbody tr")]
        .map((tr) => [...tr.children].map((td) => td.textContent.trim()))
        .find((r) => r[0] === "Fixed Income");
      if (row) out.push({ month: c.data.labels[i], interest: row[4], market: row[6] });
    }
    return out;
  });
  const mny = (t) => money(t);
  const opposite = fiMarket.filter((r) =>
    Math.abs(mny(r.interest)) > 1 && Math.abs(mny(r.market) + mny(r.interest)) < 2);
  ok(fiMarket.length > 0, "F1 there are Fixed Income rows to inspect", fiMarket.length);
  ok(opposite.length === 0,
     "F2 no month reports a Fixed Income market loss equal and opposite to its " +
     "interest — that signature means the interest was subtracted from a change " +
     "that never contained it", opposite.slice(0, 3));
  // No "Fixed Income never moves" assertion: this fixture holds a DEBT FUND by
  // design — one of the category traps — and a debt fund is priced daily, so it
  // genuinely does move. The equal-and-opposite signature above is the precise
  // test, and it is specific to the defect rather than to the asset class.

  // January, with a year selected. Reported: "This month cannot be broken down"
  // on Jan 2026 — and with no dates named, which is the tell. A missing category
  // column names the date it is missing from; naming nothing means there was no
  // previous row at all. With a year filter on, January is the first bar on the
  // chart, and its opening is the December the filter is hiding.
  const janDrill = await p.evaluate(() => {
    const sel = document.getElementById("nwm-year");
    const years = [...sel.options].map((o) => o.value).sort();
    // A year that is NOT the earliest, so a December genuinely exists before it.
    sel.value = years[years.length - 1]; if (sel.onchange) sel.onchange();
    return new Promise((res) => setTimeout(() => {
      const c = window.__wfNwmChart;
      const i = (c.data.labels || []).findIndex((l) => /Jan/.test(l));
      if (i < 0) return res({ err: "no January bar", labels: c.data.labels });
      c.options.onClick({}, [{ index: i, datasetIndex: 0 }], c);
      res({ label: c.data.labels[i],
            body: (document.getElementById("nwm-drill-body") || {}).textContent || "",
            rows: document.querySelectorAll("#nwm-drill-body tbody tr").length });
    }, 2500));
  });
  ok(!janDrill.err && janDrill.rows > 0,
     "J1 January breaks down like any other month — its opening is the previous " +
     "December, which the year filter hides from the chart but not from the data",
     janDrill);
  ok(!/cannot be broken down/i.test(janDrill.body || ""),
     "J2 rather than refusing for want of a row that exists", (janDrill.body || "").slice(0, 90));

  // Totals, and the ability to actually reach them.
  //
  // Opened explicitly rather than relying on the panel still being up from an
  // earlier step. It was not: every measurement below was being taken on a
  // hidden element, where every width is 0 and "nothing is truncated" is true
  // of nothing at all.
  const opened = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    let i = -1; for (let k = c.data.labels.length - 1; k >= 0; k--) {
      if (c.data.datasets.some((d) => d.data[k] != null)) { i = k; break; } }
    c.options.onClick({}, [{ index: i, datasetIndex: 0 }], c);
    const ov = document.getElementById("nwm-drill-overlay");
    return { hidden: ov.hidden, rows: document.querySelectorAll("#nwm-drill-body tbody tr").length };
  });
  ok(opened.hidden === false && opened.rows > 0,
     "T0 the panel is open, so the measurements below are of something on " +
     "screen rather than of a hidden element with no dimensions", opened);

  const foot = await p.evaluate(() => {
    const body = document.getElementById("nwm-drill-body");
    const tf = body.querySelector("tfoot tr");
    const tbl = body.querySelector("table");
    const rows = [...body.querySelectorAll("tbody tr")]
      .map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    return {
      cells: tf ? [...tf.children].map((td) => td.textContent.trim()) : null,
      rows: rows,
      // Reachability: the scrollport is .mic-txn-body, and the table is allowed
      // to be wider than it.
      scrollable: body.scrollWidth > body.clientWidth + 1,
      overflowX: getComputedStyle(body).overflowX,
      // Does the last column actually come into view when scrolled right?
      // A cell whose content is wider than the cell is being clipped — which is
      // what "make sure the user can view the entire data" is about.
      truncated: [...body.querySelectorAll("td, th")]
        .filter((c) => c.scrollWidth > c.clientWidth + 1)
        .map((c) => c.textContent.trim()),
      firstStickyLeft: getComputedStyle(tbl.querySelector("tbody td")).position,
    };
  });
  ok(foot.cells && foot.cells.length === 8 && /total/i.test(foot.cells[0]),
     "T1 a totals row spans every column", foot.cells);
  const col = (i) => (foot.rows || []).reduce((a, r) => a + money(r[i]), 0);
  ok(Math.abs(money(foot.cells[1]) - col(1)) <= Math.max(2, Math.abs(col(1)) * 0.002),
     "T2 Opening totals the column above it", { foot: foot.cells[1], rows: col(1) });
  ok(Math.abs(money(foot.cells[6]) - col(6)) <= Math.max(2, Math.abs(col(6)) * 0.002),
     "T3 and so does Market", { foot: foot.cells[6], rows: col(6) });
  // The property the row exists to let a reader check.
  const recon = money(foot.cells[1]) + money(foot.cells[2]) + money(foot.cells[3]) +
                money(foot.cells[4]) + money(foot.cells[5]) + money(foot.cells[6]);
  ok(Math.abs(recon - money(foot.cells[7])) <= Math.max(5, Math.abs(money(foot.cells[7])) * 0.002),
     "T4 and opening + invested − withdrawn + interest + idle + market comes " +
     "out at closing — the row states both ends, so the arithmetic can be " +
     "checked rather than taken on trust",
     { computed: recon, closing: money(foot.cells[7]) });
  ok(!foot.truncated.length,
     "T5 no figure is truncated to make the columns fit — the table is sized to " +
     "its content, so eight currency columns push the panel wider instead of " +
     "compressing until a number is unreadable", foot.truncated.slice(0, 3));

  // Force the narrow case. The fixture's figures are small enough to fit a
  // 760px modal; real balances run to lakhs and do not, which is what the
  // report showed. Narrowing the MODAL reproduces that exactly, and unlike
  // narrowing the viewport it does not drag the mobile stylesheet in and change
  // what is on screen at the same time.
  const narrow = await p.evaluate(() => {
    document.querySelector("#nwm-drill-overlay .mic-txn-modal").style.width = "340px";
    const body = document.getElementById("nwm-drill-body");

    const tbl = body.querySelector("table");
    body.scrollLeft = 0;
    const before = tbl.querySelector("tbody tr:last-child td:last-child")
      .getBoundingClientRect().right - body.getBoundingClientRect().right;
    body.scrollLeft = body.scrollWidth;
    const last = tbl.querySelector("tbody tr:last-child td:last-child");
    const lr = last.getBoundingClientRect(), br = body.getBoundingClientRect();
    const firstCell = tbl.querySelector("tbody td").getBoundingClientRect();
    return {
      scrollable: body.scrollWidth > body.clientWidth + 1,
      offscreenBefore: before > 1,
      reachable: lr.right <= br.right + 1 && lr.left >= br.left - 1,
      categoryStillVisible: firstCell.left >= br.left - 1 && firstCell.width > 0,
      truncated: [...body.querySelectorAll("td, th")]
        .filter((c) => c.scrollWidth > c.clientWidth + 1).length,
      _dbg: { ovHidden: document.getElementById("nwm-drill-overlay").hidden,
              bodyW: body.clientWidth, scrollW: body.scrollWidth,
              tblW: tbl ? Math.round(tbl.getBoundingClientRect().width) : null,
              tblCss: tbl ? getComputedStyle(tbl).width : null,
              rows: body.querySelectorAll("tbody tr").length },
    };
  });
  ok(narrow.scrollable && narrow.offscreenBefore,
     "T6 in a narrow window the last column starts off-screen", narrow);
  ok(narrow.reachable,
     "T6b and scrolling right brings it fully into view — the point of the ask",
     narrow);
  ok(narrow.categoryStillVisible,
     "T6c with the category column still pinned in place while it does", narrow);
  ok(narrow.truncated === 0,
     "T6d and still nothing truncated at that width — it scrolls rather than " +
     "squeezing, which is the difference between reachable and lost", narrow);
  await p.evaluate(() => {
    document.querySelector("#nwm-drill-overlay .mic-txn-modal").style.width = "";
  });
  ok(foot.firstStickyLeft === "sticky",
     "T7 while the category stays pinned, so scrolling right does not cost you " +
     "the row you are reading", foot.firstStickyLeft);

  // Closing to the reader, three ways.
  await p.evaluate(() => document.getElementById("nwm-drill-close").click());
  ok(await p.evaluate(() => document.getElementById("nwm-drill-overlay").hidden),
     "C1 the close button closes it");
  await p.evaluate(() => { const c = window.__wfNwmChart;
    let i = -1; for (let k = c.data.labels.length - 1; k >= 0; k--) {
      if (c.data.datasets.some((d) => d.data[k] != null)) { i = k; break; } }
    c.options.onClick({}, [{ index: i, datasetIndex: 0 }], c); });
  await p.evaluate(() => { const m = document.querySelector("#nwm-drill-overlay .mic-txn-modal");
    m.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  ok(!(await p.evaluate(() => document.getElementById("nwm-drill-overlay").hidden)),
     "C2 a click INSIDE the dialog does not — dragging across a figure to select " +
     "it must not dismiss the panel");
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  ok(await p.evaluate(() => document.getElementById("nwm-drill-overlay").hidden),
     "C3 and Escape closes it");

  // Per portfolio is NOT on record — the columns are the household's — so the
  // panel says so instead of inventing one.
  await p.evaluate(() => {
    const btn = document.querySelector('#portfolio-pills [data-ov-portfolio="Snnehal"]');
    if (btn) btn.click();
  });
  await p.waitForTimeout(5000);
  const pf = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    if (!c) return { err: "no chart" };
    let i = -1; for (let k = c.data.labels.length - 1; k >= 0; k--) {
      if (c.data.datasets.some((d) => d.data[k] != null)) { i = k; break; } }
    if (i < 0) return { err: "no filled bar" };
    c.options.onClick({}, [{ index: i, datasetIndex: 0 }], c);
    return { body: (document.getElementById("nwm-drill-body") || {}).textContent || "",
             rows: document.querySelectorAll("#nwm-drill-body tbody tr").length };
  });
  ok(!pf.err && /household/i.test(pf.body),
     "P1 with one portfolio selected it says the split is the household's, rather " +
     "than showing a per-portfolio breakdown that is not on record", pf);
  ok(pf.rows === 0, "P2 and shows no table", pf.rows);

  // A split that does not add up is not recorded.
  //
  // The rows most at risk are ones already stored WITHOUT categories: their
  // total is what the app believed the day it was written, while the category
  // walk values that same date with today's prices. Usually identical, and when
  // it is not, one of the two is wrong and there is no way to tell which from
  // here. So the recorded total stands and the split is withheld — a row keeps
  // its total and loses its categories, never the reverse.
  //
  // Simulated by corrupting one stored row the way a stale reconstruction looks:
  // categories missing, total no longer what the holdings are worth. meta is
  // left null so planRefreshBackfill treats it as a record and leaves it alone,
  // and by_portfolio is kept so planSplitBackfill has nothing to repair —
  // otherwise it never reaches the code under test.
  //
  // Three rows lose their categories, so there is a real batch to be dropped
  // from; only one of the three also has its total corrupted. If the guard threw
  // away the batch instead of the row — which is exactly how the per-portfolio
  // split failed, 179 rows to 0 over one bad one — the other two would come back
  // empty too.
  const mid = Math.floor(stored.length / 2);
  const victim = stored[mid].snapshot_date;
  const bystanders = [stored[mid - 1].snapshot_date, stored[mid + 1].snapshot_date];
  const trueTotal = Number(stored[mid].total);
  const blank = { equity: null, fixed_income: null, commodity: null, meta: null };
  stored = stored.map((r) =>
    r.snapshot_date === victim ? Object.assign({}, r, blank, { total: 12345 })
    : bystanders.indexOf(r.snapshot_date) !== -1 ? Object.assign({}, r, blank)
    : r);
  // A third bystander on a date the backfill would never choose for itself:
  // 31 March 2024, a Sunday, where the app's own reconstruction of that month
  // sits on Friday the 29th. Only an older version, or a live write on a
  // weekend, leaves a row there — and those are precisely the rows that arrive
  // without categories.
  //
  // Note this does not pin down the "last point on or before" lookup: the gold
  // holding gives the timeline a point for every calendar day, so an exact-match
  // lookup finds Sunday too. That branch is reachable only for a portfolio with
  // no daily-priced holding at all, which no fixture here has.
  const marRow = at("2024-03");
  bystanders.push("2024-03-31");
  stored.push(Object.assign({}, marRow, blank,
    { snapshot_date: "2024-03-31", total: marRow.total }));
  posted = [];
  await load();

  const wrote = posted.filter((r) => r.snapshot_date === victim).pop();
  ok(!!wrote, "G0 the mismatched row was visited at all — if the backfill skipped " +
     "it the next three assertions would pass vacuously", { victim, posted: posted.length });
  ok(wrote && Number(wrote.total) === 12345,
     "G1 its recorded total survives — the derived split does not get to overwrite " +
     "the number that was actually recorded", { wrote, trueTotal });
  ok(wrote && wrote.equity == null && wrote.fixed_income == null && wrote.commodity == null,
     "G2 and the split that disagreed with it is withheld, not stored as though " +
     "it were a record", wrote);
  ok(wrote && wrote.meta && wrote.meta.categories === "category-mismatch",
     "G3 with the reason on the row itself, so this is diagnosable from the data " +
     "rather than only from a console line nobody was watching", wrote && wrote.meta);
  const filled = bystanders.filter((d) =>
    (posted.filter((r) => r.snapshot_date === d).pop() || {}).equity != null);
  ok(filled.length === bystanders.length,
     "G4 while the two rows either side of it are filled normally — the guard " +
     "drops the row it doubts, not the batch it arrived in",
     { filled, bystanders, posted: posted.length });

  // With an exclusion on, the panel and the Account Value chart are measuring
  // different things, and it took a report to notice that nothing said so.
  // Set and reload WITHOUT going through load(), which clears localStorage and
  // would take the toggle with it.
  await p.evaluate(() => localStorage.setItem("wf-exclude-fixedincome", "true"));
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(14000);
  const excl = await p.evaluate(() => {
    const c = window.__wfNwmChart;
    if (!c) return { err: "no chart" };
    let i = -1; for (let k = c.data.labels.length - 1; k >= 0; k--) {
      if (c.data.datasets.some((d) => d.data[k] != null)) { i = k; break; } }
    if (i < 0) return { err: "no filled bar" };
    c.options.onClick({}, [{ index: i, datasetIndex: 0 }], c);
    return { body: (document.getElementById("nwm-drill-body") || {}).textContent || "",
             rows: document.querySelectorAll("#nwm-drill-body tbody tr").length };
  });
  ok(!excl.err && excl.rows > 0,
     "X1 an exclusion does not empty the panel — snapshots are recorded " +
     "unfiltered, so the history is all still there", excl);
  ok(/exclusion is switched on/i.test(excl.body),
     "X2 and the panel says the figures include what the toggle hides, rather " +
     "than leaving the reader to find the gap against the Account Value chart",
     excl.body.slice(0, 120));
  await p.evaluate(() => localStorage.removeItem("wf-exclude-fixedincome"));

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
