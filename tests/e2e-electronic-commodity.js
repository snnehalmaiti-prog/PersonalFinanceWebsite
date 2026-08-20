// Electronic Holding — commodity funds/ETFs land in the Commodity card's
// Electronic sub-section, drawn from BOTH mapping sheets, and leave the
// India/Mutual-Fund lists (one instrument, one table).
//
//     PORT=8098 node tests/run-browser.js e2e-electronic-commodity.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const XAU_INR = 311035;                    // ₹10,000/gram
const GRAMS = 5;
const ETF_UNITS = 270, ETF_PRICE = 100;    // GOLDBEES (Stocks/ETF sheet, Commodity)
const GF_UNITS = 100, GF_NAV = 50;         // Gold Fund (equity sheet, Commodity)
const EQ_UNITS = 100, EQ_NAV = 50;         // Fund A (equity sheet, Equity)

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Fund A", "Buy", String(EQ_UNITS), "40"],
    ["1-Jan-2024", "Snnehal", "Gold Fund", "Buy", String(GF_UNITS), "40"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100001", "INFA"],
    ["Gold Fund", "Commodity", "Gold", "100002", "INFG"]],
  // Two portfolios hold GOLDBEES so the "All" view MERGES them — the case where
  // a merged row must still recompute XIRR from the combined flows.
  "wf-stocksetf-data": [TXN,
    ["1-Jan-2024", "Snnehal", "GOLDBEES", "Buy", "170", "80"],
    ["1-Jan-2024", "Trisha", "GOLDBEES", "Buy", "100", "80"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["GOLDBEES", "Commodity", "Gold", "ETF", "India", "GOLDBEES", "Gold"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"],
    ["1-Jan-2024", "Snnehal", "—", "Physical Gold", "Commodity", "Gold", "Buy", "", "", "", String(GRAMS)]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

const DAYS = (() => { const o = []; const d = new Date("2024-01-01T00:00:00"), e = new Date("2024-12-01T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; })();
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const dmyNum = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
const dmyMon = (iso) => { const [y, m, d] = iso.split("-"); return `${d}-${MON[+m - 1]}-${y}`; };
const LAST = DAYS[DAYS.length - 1];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1400 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**/xau.min.json*", (r) => r.fulfill(j({ xau: { inr: XAU_INR } })));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: XAU_INR } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({
    data: DAYS.map((iso) => ({ date: dmyNum(iso), nav: String(GF_NAV) })).reverse() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ updated: new Date().toISOString(),
    mf_history: { "100001": Object.fromEntries(DAYS.map((iso) => [iso, EQ_NAV])),
                  "100002": Object.fromEntries(DAYS.map((iso) => [iso, GF_NAV])) } })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001", INFG: "100002" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: dmyMon(LAST), nav: String(EQ_NAV) }, "100002": { date: dmyMon(LAST), nav: String(GF_NAV) } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: 84 }, GOLDBEES: { price: ETF_PRICE } },
    usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  await p.addInitScript(() => {
    window.Chart = function (ctx, cfg) { this.data = cfg.data; this.options = cfg.options;
      this.scales = { x: {}, y: {} }; this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function () {}; this.resetZoom = function () {};
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; }; };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    localStorage.setItem("wf-gold-premium-pct", "0");
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(Number(process.env.WAIT || 9000));

  // Visit the MF and Stocks/ETF sub-tabs so both pipelines populate the commodity
  // rows, then open Fixed Income/Commodity where the card lives.
  async function clickTab(id) { await p.evaluate((i) => { const e = document.getElementById(i); if (e) e.click(); }, id); await p.waitForTimeout(1800); }
  await clickTab("subtab-equity");
  await clickTab("subtab-stocksetf");
  await clickTab("subtab-fixedincome");

  // Wait for the Electronic list to settle with both commodity instruments.
  let elec = "";
  for (let i = 0; i < 40; i++) {
    elec = await p.evaluate(() => {
      const w = document.getElementById("cmh-elec-wrap");
      const l = document.getElementById("cmh-elec-list");
      return (w && !w.hidden ? "SHOWN " : "HIDDEN ") + (l ? l.textContent.replace(/\s+/g, " ") : "");
    });
    if (/SHOWN/.test(elec) && /GOLDBEES/.test(elec) && /Gold Fund/.test(elec)) break;
    await p.waitForTimeout(500);
  }

  const view = await p.evaluate(() => ({
    elecWrapShown: !!(document.getElementById("cmh-elec-wrap") && !document.getElementById("cmh-elec-wrap").hidden),
    elecList: (document.getElementById("cmh-elec-list") || {}).textContent || "",
    physList: (document.getElementById("cmh-list") || {}).textContent || "",
    indiaList: (document.getElementById("seh-india-list") || {}).textContent || "",
    mfList: (document.getElementById("mfh-list") || {}).textContent || "",
    elecEyebrow: (document.getElementById("cmh-elec-eyebrow") || {}).textContent || "",
    // XIRR cell text of the GOLDBEES row (merged across Snnehal + Trisha).
    goldbeesXirr: (function () {
      var rows = document.querySelectorAll("#cmh-elec-list .mfh-row");
      for (var i = 0; i < rows.length; i++) {
        if (/GOLDBEES/.test(rows[i].textContent)) {
          var cells = rows[i].querySelectorAll(".mfh-col-num");
          return cells.length ? cells[cells.length - 1].textContent.trim() : "";
        }
      }
      return "";
    })(),
    elecPills: document.querySelectorAll("#cmh-elec-portfolio-toggle [data-dbth-portfolio]").length,
    elecOpenBtns: document.querySelectorAll("#cmh-elec-open-toggle [data-elec-open]").length,
  }));

  ok(view.elecWrapShown, "E1 the Electronic Holding sub-section is visible", elec);
  ok(/GOLDBEES/.test(view.elecList), "E2 the commodity ETF (Stocks/ETF sheet) shows in Electronic Holding");
  ok(/Gold Fund/.test(view.elecList), "E3 the commodity fund (Mutual Fund sheet) shows in Electronic Holding");
  ok(!/GOLDBEES/.test(view.indiaList), "E4 the commodity ETF has left the India Stocks/ETF list");
  ok(!/Gold Fund/.test(view.mfList), "E5 the commodity fund has left the Mutual Fund list");
  ok(/Physical Gold/.test(view.physList), "E6 physical gold still shows in the Physical Commodity list");
  ok(view.elecOpenBtns === 2, "E7 Electronic Holding has an Open/Closed toggle (India-holdings feature)", view.elecOpenBtns);
  ok(view.elecPills >= 1, "E8 Electronic Holding has a portfolio pill", view.elecPills);
  ok(/HOLDINGS/.test(view.elecEyebrow), "E9 and a holdings-count eyebrow", view.elecEyebrow);
  ok(/%/.test(view.goldbeesXirr), "E10 the merged (multi-portfolio) row shows an XIRR, not a dash", view.goldbeesXirr);
  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  console.log("RESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
