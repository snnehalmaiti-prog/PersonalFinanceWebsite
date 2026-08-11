// Every card on the Overview is drawn with the same edge.
//
// The three split cards had a dashed border and everything else on the tab had a
// solid one, so a card's edge recorded which batch it was built in rather than
// anything about the card. Portfolio Split's dashed edge is now the rule for the
// whole tab.
//
// Portfolio Split is the reference rather than a hard-coded "1.5px dashed": if
// the house style changes, it changes in one place and this suite keeps holding
// the rest to it. Radius is deliberately NOT asserted — the cards genuinely
// differ there (12 / 14 / 16px) and that is a separate decision from the stroke,
// which is the part that read as inconsistent.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/measure-overview-card-edges.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2019", "Snnehal", "Fund A", "Buy", "5000", "10"],
    ["1-Jan-2019", "Trisha", "Fund A", "Buy", "1000", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};
const START = "2019-01-01", END = "2026-07-01";
function days() { const o = []; const d = new Date(START + "T00:00:00"), e = new Date(END + "T00:00:00");
  while (d <= e) { o.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); } return o; }
const DAYS = days();
function navSeries() { let n = 10;
  return DAYS.map((iso) => { n *= 1.0004; const [y, m, d] = iso.split("-");
    return { date: `${d}-${m}-${y}`, nav: n.toFixed(4) }; }).reverse(); }

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

const PROBE = () => {
  const panel = document.getElementById("panel-overview");
  const edge = (el) => {
    const cs = getComputedStyle(el);
    return { id: el.id || "." + String(el.className).split(" ")[0],
             style: cs.borderTopStyle, width: cs.borderTopWidth, color: cs.borderTopColor };
  };
  // Every bordered card on the tab. A card with no border at all is a wrapper
  // (#ov-charts-card is one) and is not part of this question.
  const cards = [...panel.querySelectorAll(
      ".overview-header-bar, .benchmark-card, .avc-card, .isc-card, .value-chart-card")]
    .filter((el) => getComputedStyle(el).borderTopStyle !== "none" &&
                    getComputedStyle(el).borderTopWidth !== "0px")
    .map(edge);
  const ref = (() => {
    const el = document.getElementById("investment-split-card");
    return el ? edge(el) : null;
  })();
  // Cards on the other tabs are outside this decision and must be untouched.
  const others = [];
  document.querySelectorAll("section.settings-panel:not(#panel-overview)")
    .forEach((s) => s.querySelectorAll(".value-chart-card, .benchmark-card, .avc-card")
      .forEach((el) => others.push(Object.assign({ panel: s.id }, edge(el)))));
  return { ref: ref, cards: cards, others: others };
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const r = (pat, body, ct) => p.route(pat, (x) => x.fulfill({ status: 200, contentType: ct || "application/json", headers: { "access-control-allow-origin": "*" }, body }));
  await r("**://*.supabase.co/**", "[]");
  await r("**://cdn.jsdelivr.net/**", "", "text/javascript");
  await r("**://fonts.googleapis.com/**", "", "text/css");
  await r("**://api.mfapi.in/**", JSON.stringify({ data: navSeries() }));
  await r("**/amfi_isin_map.json*", JSON.stringify({ fetchedAt: 1, data: { INF1: "100033" } }));
  await r("**/amfi_nav.json*", JSON.stringify({ fetchedAt: 1, data: {} }));
  await r("**/stock_prices.json*", JSON.stringify({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} }));
  await r("**/stock_history.json*", JSON.stringify({ stock_history: {} }));
  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      this.zoomScale = function () {}; this.resetZoom = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k])); }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(9000);

  const m = await p.evaluate(PROBE);
  m.cards.forEach((c) => console.log("  " + c.id.padEnd(26) + c.style.padEnd(8) + c.width.padEnd(8) + c.color));
  console.log("");

  ok(m.ref && m.ref.style === "dashed",
     "E1 Portfolio Split — the reference — still has the dashed edge", m.ref);
  // Enough cards to make "they all agree" a real claim rather than a tautology
  // over one element.
  ok(m.cards.length >= 8,
     "E2 and the tab has the full set of bordered cards on screen", m.cards.length);

  const odd = m.cards.filter((c) => c.style !== m.ref.style);
  ok(odd.length === 0,
     "E3 every bordered card on the Overview uses the same border style as it",
     { want: m.ref.style, offenders: odd });
  const oddW = m.cards.filter((c) => c.width !== m.ref.width);
  ok(oddW.length === 0,
     "E4 at the same width", { want: m.ref.width, offenders: oddW });
  const oddC = m.cards.filter((c) => c.color !== m.ref.color);
  ok(oddC.length === 0,
     "E5 and the same colour", { want: m.ref.color, offenders: oddC });

  // The rule is scoped to #panel-overview on purpose. If a card class ever gets
  // reused on another tab, this says whether it was dragged along.
  console.log("  other tabs: " + JSON.stringify(m.others));
  ok(true, "E6 (informational) cards outside the Overview: " + m.others.length);

  ok(errs.length === 0, "no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
