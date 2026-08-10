// US holdings: how much of the INR return was the stock, and how much the rupee.
//
// An INR return is two moves at once. A holding up 34% can be 20% stock and 12%
// currency, and until now the row could not say which. The fixture pins both
// legs to arithmetic that is checkable by hand:
//
//   ALPHA  100 @ $5 on 1-Jan-2024, rate 75 → cost $500 / ₹37,500
//          now $6, rate 84                 → now  $600 / ₹50,400
//          stock +20%, fx 84/75−1 = +12%
//
//   BETA    50 @ $10 on 1-Jul-2024, rate 80 → cost $500 / ₹40,000
//          now $12, rate 84                 → now  $600 / ₹50,400
//          stock +20%, fx 84/80−1 = +5%
//
// The subtotal is the point of the second holding: its reference rate is the
// cost-weighted 77.50, so fx reads +8.4% — a figure that is neither row's and
// cannot be produced by averaging the two.
//
//     python3 -m http.server 8095 &
//     node tests/e2e-fx-attribution.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8095;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"]],
  "wf-stocksetf-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Alpha Corp", "Buy", "100", "5"],
    ["1-Jul-2024", "Snnehal", "Beta Corp", "Buy", "50", "10"],
    // An India holding, to confirm the split is shown only where it means
    // something: a rupee-denominated stock has no currency leg.
    ["1-Jan-2024", "Snnehal", "Desi Ltd", "Buy", "100", "50"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["Alpha Corp", "Equity", "Stock", "Large Cap", "US", "ALPHA", "Tech"],
    ["Beta Corp", "Equity", "Stock", "Large Cap", "US", "BETA", "Tech"],
    ["Desi Ltd", "Equity", "Stock", "Large Cap", "India", "DESI", "Tech"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
    "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const RATE_NOW = 84;
const RATES = { "2024-01-01": 75, "2024-07-01": 80 };

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const eq = (a, b, name) => ok(a === b, name, { got: a, want: b });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1400 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: [] })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: {} })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: {} })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: {} })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: {
      __USD_INR__: { price: RATE_NOW },
      ALPHA: { price: 6, prev_close: 6, currency: "USD" },
      BETA: { price: 12, prev_close: 12, currency: "USD" },
      DESI: { price: 60, prev_close: 60 },
    },
    usd_inr_history: RATES, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.type = cfg.type; this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.click('[data-tab="investment"]').catch(() => {});
  await p.waitForFunction(() => document.querySelectorAll("#seh-us-list .mfh-row").length > 0,
    null, { timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(1500);

  const read = (listId) => p.evaluate((id) => {
    const out = [];
    document.querySelectorAll("#" + id + " .mfh-row, #" + id + " .mfh-list-footer").forEach((el) => {
      const name = (el.querySelector(".mfh-inst-name") || el.querySelector("div")) || {};
      const fx = el.querySelector(".mfh-fx-split");
      out.push({
        name: (name.textContent || "").trim().slice(0, 24),
        // The P&L cell specifically. .mfh-num-pnl-pct is also used for the USD
        // sub-line in the amount columns, so the first match is "$500.00".
        pct: (() => {
          const v = el.querySelector(".mfh-num-pnl-value");
          const cell = v && v.parentElement;
          return cell ? ((cell.querySelector(".mfh-num-pnl-pct") || {}).textContent || "") : "";
        })(),
        fx: fx ? fx.textContent.replace(/\s+/g, " ").trim() : null,
        fxTitle: fx ? fx.getAttribute("title") : null,
      });
    });
    return out;
  }, listId);

  const us = await read("seh-us-list");
  const india = await read("seh-india-list");
  console.log("  US: " + JSON.stringify(us, null, 1));
  console.log("  India: " + JSON.stringify(india.map((r) => ({ name: r.name, fx: r.fx }))));
  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  const alpha = us.find((r) => /Alpha/.test(r.name));
  const beta = us.find((r) => /Beta/.test(r.name));
  const sub = us.find((r) => /subtotal/i.test(r.name));

  ok(alpha && alpha.fx, "F1 a US holding shows the stock/currency split", alpha);
  if (alpha && alpha.fx) {
    ok(/stock \+20\.0%/.test(alpha.fx),
       "F2 Alpha's stock leg is +20% — $5 to $6, in dollars", alpha.fx);
    ok(/fx \+12\.0%/.test(alpha.fx),
       "F3 and its currency leg +12% — bought at 75, valued at 84", alpha.fx);
    ok(/\+34\.40%/.test(alpha.pct),
       "F4 which compound to the row's own INR return, rather than adding to 32%",
       alpha.pct);
    ok(/75\.00/.test(alpha.fxTitle || "") && /84\.00/.test(alpha.fxTitle || ""),
       "F5 the tooltip names the two rates it is comparing", alpha.fxTitle);
  }

  if (beta && beta.fx) {
    ok(/stock \+20\.0%/.test(beta.fx), "F6 Beta's stock leg is also +20%", beta.fx);
    ok(/fx \+5\.0%/.test(beta.fx),
       "F7 but its currency leg is +5% — bought later, at 80, not 75", beta.fx);
  } else { ok(false, "F6/F7 Beta row has no split", beta); }

  // The subtotal is the assertion that matters most: its reference rate is the
  // cost-weighted 77.50, so fx is +8.4% — neither row's figure, and not the
  // average of the two (+8.5%).
  ok(sub && sub.fx, "F8 the subtotal carries a split too", sub);
  if (sub && sub.fx) {
    ok(/stock \+20\.0%/.test(sub.fx), "F9 both holdings rose 20% in dollars", sub.fx);
    ok(/fx \+8\.4%/.test(sub.fx),
       "F10 and the combined currency leg is weighted by cost, not averaged " +
       "across the rows", sub.fx);
    ok(!/\+8\.5%/.test(sub.fx),
       "F11 specifically, it is not the mean of +12% and +5%", sub.fx);
    ok(/77\.50/.test(sub.fxTitle || ""),
       "F12 from a cost-weighted reference rate of 77.50", sub.fxTitle);
  }

  // India rows are already in rupees: there is no currency leg to attribute.
  ok(india.length > 0 && india.every((r) => !r.fx),
     "F13 India holdings show no split — nothing was converted",
     india.map((r) => ({ name: r.name, fx: r.fx })));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
