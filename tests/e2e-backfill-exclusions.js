// Reconstructed history must not depend on what is hidden on screen.
//
// The snapshot backfill used to refuse outright while an exclusion toggle was
// on, and the refusal was right for the reason given at the time: it rebuilt
// history from the Account Value series, and that series honours the toggles,
// so reconstructing from it would have written a permanently understated past.
//
// The cost was invisible and large. The setting is sticky — it lives in
// localStorage — so switching "Exclude Fixed Income" on once and forgetting
// stopped the live write AND the backfill indefinitely. The only symptom was
// empty months appearing on NET WORTH · MONTHLY weeks later, with nothing on
// screen connecting the two.
//
// The reconstruction now builds its own unfiltered series, so the reason is
// gone. What this suite pins is the property that makes that safe: the rows
// planned with an exclusion ON are IDENTICAL to the rows planned with it off.
// Asserting merely that the backfill "runs" would pass just as well on a
// reconstruction that quietly wrote the understated figures the old refusal
// existed to prevent.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-backfill-exclusions.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FDH = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
             "Instrument Sub Category", "Transaction Type", "Invested Amount",
             "Maturity Date/Sell Date", "Rate of Return", "Grams"];
// Deliberately spans everything the toggles can hide: a term deposit and a
// provident fund (Exclude Fixed Income), parked cash (Exclude Savings), plus
// equity and commodity that neither toggle touches. If the fixture held only
// equity, both toggles would be no-ops and every assertion below would pass on
// a broken implementation.
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Fund A", "Buy", "1000", "10"],
    ["1-Mar-2024", "Trisha", "Fund A", "Buy", "500", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [FDH,
    ["1-Jan-2024", "Snnehal", "HDFC", "FD-1", "Fixed Income", "Fixed Deposit", "Buy", "100000", "1-Jan-2027", "7%", ""],
    ["1-Jan-2024", "Trisha", "EPFO", "PF-1", "Fixed Income", "Provident Fund", "Buy", "50000", "", "", ""],
    ["1-Jan-2024", "Snnehal", "SBI", "Cash", "Fixed Income", "Savings Account", "Buy", "75000", "", "", ""],
    ["1-Jan-2024", "Snnehal", "—", "Physical Gold", "Commodity", "Gold", "Buy", "", "", "", "10"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const DAYS = (() => { const o = []; const d = new Date("2024-01-01T00:00:00"), e = new Date();
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; })();
const dmy = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

  // Capture what the client tries to WRITE, and answer reads with nothing, so
  // every run plans a full backfill from scratch.
  let written = [];
  await p.route("**://*.supabase.co/**", (r) => {
    const req = r.request();
    if (/net_worth_snapshots/.test(req.url()) && req.method() === "POST") {
      try { written = written.concat(JSON.parse(req.postData() || "[]")); } catch (e) {}
      return r.fulfill(j([]));
    }
    return r.fulfill(j([]));
  });
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: DAYS.map((i) => ({ date: dmy(i), nav: "12" })).reverse() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ updated: new Date().toISOString(),
    mf_history: { "100001": Object.fromEntries(DAYS.map((i) => [i, 12])) } })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: "01-Aug-2026", nav: "12" } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } },
    usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));
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

  const load = async (excl) => {
    written = [];
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate(([s, e]) => {
      localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      localStorage.setItem("wf-gold-premium-pct", "0");
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
      if (e.fi) localStorage.setItem("wf-exclude-fixedincome", "true");
      if (e.sav) localStorage.setItem("wf-exclude-savings-investment", "true");
    }, [SHEETS, excl]);
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(14000);
    // Only reconstructions — the live row for today is a different writer and
    // legitimately still refuses while a toggle is on.
    return written.filter((r) => r && r.meta && r.meta.backfilled)
      .map((r) => ({ d: String(r.snapshot_date).slice(0, 10), t: Math.round(Number(r.total) || 0),
                     pf: r.by_portfolio || null }))
      .sort((a, x) => (a.d < x.d ? -1 : 1));
  };

  const none = await load({});
  console.log("  no exclusion:      " + none.length + " rows, last " + JSON.stringify(none[none.length - 1]));
  // Without this the comparisons below are vacuous: two empty lists match.
  ok(none.length >= 12, "B0 a backfill happens at all, with rows to compare", none.length);
  ok(none.some((r) => r.pf && Object.keys(r.pf).length >= 2),
     "B0b and carries a per-portfolio split", none[none.length - 1]);

  const fi = await load({ fi: true });
  console.log("  exclude FI:        " + fi.length + " rows, last " + JSON.stringify(fi[fi.length - 1]));
  ok(fi.length > 0,
     "B1 the backfill still runs with Fixed Income excluded — it used to refuse " +
     "outright, and the setting is sticky, so that stopped history accruing " +
     "until someone noticed months later", fi.length);
  ok(JSON.stringify(fi) === JSON.stringify(none),
     "B2 and writes exactly the same rows — same dates, same totals, same " +
     "portfolio splits. Running is not the point; recording the SAME history is",
     { withExclusion: fi.slice(-2), without: none.slice(-2) });

  const sav = await load({ sav: true });
  console.log("  exclude Savings:   " + sav.length + " rows, last " + JSON.stringify(sav[sav.length - 1]));
  ok(JSON.stringify(sav) === JSON.stringify(none),
     "B3 the same holds for Exclude Savings/Investment, which hides parked cash " +
     "rather than the whole fixed-income leg",
     { withExclusion: sav.slice(-2), without: none.slice(-2) });

  const both = await load({ fi: true, sav: true });
  console.log("  exclude both:      " + both.length + " rows, last " + JSON.stringify(both[both.length - 1]));
  ok(JSON.stringify(both) === JSON.stringify(none),
     "B4 and with both on together", { withExclusion: both.slice(-2), without: none.slice(-2) });

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
