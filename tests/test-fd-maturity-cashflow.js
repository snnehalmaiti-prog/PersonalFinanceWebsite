// A maturing fixed deposit is a withdrawal in CASH FLOW · MONTHLY.
//
// The fd sheet has no sell row for an FD: it records the deposit and a maturity
// date, and the money comes back on that date. The chart only ever read the
// deposit, so an FD showed as an outflow with nothing ever coming in, and a year
// whose only event was an FD maturing drew an empty chart.
//
// The maturity is now booked in the month it matured, for the amount actually
// received (principal + quarterly-compounded interest, pro-rated over the part
// quarter) — the same engine the XIRR flows use, so the two cannot disagree.
//
// Runs the real buildMonthlyInvestCatData against synthetic sheets.

var window = {};
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function extract(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error("marker not found: " + marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
  }
  let end = i + 1;
  if (SRC[end] === ";") end++;
  return SRC.slice(start, end);
}

let sheets = {};
var _dateParseMemo = Object.create(null);
var _dateParseMemoSize = 0;
const SELECTED_PORTFOLIO_KEY = "wf-portfolio";
let storage = {};
var localStorage = { getItem: (k) => (k in storage ? storage[k] : null) };
function getSheetRows(prefix) { return sheets[prefix] || null; }
// USD/INR the chart reads synchronously from the price cache.
let stockPrices = null;
function getCachedStockPrices() { return stockPrices; }

eval([
  "function normalizeText(value)",
  "function parseNumber(value)",
  "function parseFlexibleDate(value)",
  "function _parseFlexibleDateUncached(str)",
  "function parsePercentRate(value)",
  "function formatDateISO(date)",
  "function lookupUsdInrRate(rateMap, dateStr, fallback)",
  "function _addMonthsClamped(base, n)",
  "function countElapsedQuarters(start, asOf)",
  "function elapsedQuartersFractional(start, asOf)",
  "function fdMaturityValue(principal, startDate, maturityDate, rate)",
  // Which FD-sheet sub-categories are term deposits. buildMonthlyInvestCatData
  // consults it to decide whether a maturity books an inflow, so it has to come
  // along — and isProvidentFundSub with it, since the predicate calls it.
  "function isProvidentFundSub(sub)",
  "function _fiIsTermDeposit(normSub)",
  "function buildMonthlyInvestCatData(portfolioOverride)",
].map(extract).join("\n\n"));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.5 : eps); }

// Dates are chosen relative to today so "already matured" stays true forever.
const TODAY = new Date();
function ago(months) {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - months, 15);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-15";
}
function ahead(months) { return ago(-months); }
function mk(dateStr) { return dateStr.slice(0, 7); }

const FD_HEADER = ["Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Transaction Date",
  "Maturity Date/Sell Date", "Rate of Return"];
function fdRow(o) {
  return ["Snnehal", "HDFC", o.name || "Deposit-1", o.cat || "Fixed Income",
    o.sub || "Fixed Deposit", o.type || "Deposit", o.amount, o.date, o.maturity || "", o.rate || ""];
}
function build(rows, portfolio) {
  sheets = { fd: [FD_HEADER].concat(rows) };
  return buildMonthlyInvestCatData(portfolio);
}

console.log("A. A matured FD books a withdrawal in its maturity month");
{
  const dep = ago(30), mat = ago(6);
  const d = build([fdRow({ amount: 100000, date: dep, maturity: mat, rate: "6.25%" })]);
  ok(!!(d.byMonthCat[mk(dep)] && d.byMonthCat[mk(dep)]["Fixed Deposit"] === 100000),
     "A1 the deposit is still an inflow in its own month", d.byMonthCat[mk(dep)]);
  ok(!!(d.byMonthCatOut[mk(mat)] && d.byMonthCatOut[mk(mat)]["Fixed Deposit"] > 0),
     "A2 the maturity is an outflow in the maturity month", d.byMonthCatOut[mk(mat)]);
  ok(!d.byMonthCatOut[mk(dep)], "A3 nothing flows out in the deposit month", d.byMonthCatOut[mk(dep)]);

  // Independently computed: 2 years of quarterly compounding at 6.25%.
  const q = elapsedQuartersFractional(new Date(dep + "T00:00:00"), new Date(mat + "T00:00:00"));
  const expected = 100000 * Math.pow(1 + 0.0625 / 4, q);
  const got = (d.byMonthCatOut[mk(mat)] || {})["Fixed Deposit"] || 0;
  ok(near(got, expected),
     "A4 the amount is principal plus quarterly-compounded interest, not the principal",
     [got, expected]);
  ok(got > 100000,
     "A5 more comes back than went in");
  ok(!!(d.byMonthGrpOut[mk(mat)] && near(d.byMonthGrpOut[mk(mat)]["Fixed Income"], expected)),
     "A6 the Instrument Category rollup gets it too", d.byMonthGrpOut[mk(mat)]);
}

console.log("\nB. Only deposits that have actually matured");
{
  const dep = ago(3), mat = ahead(9);
  const d = build([fdRow({ amount: 50000, date: dep, maturity: mat, rate: "7%" })]);
  ok(Object.keys(d.byMonthCatOut).length === 0,
     "B1 a future maturity is not a cash flow yet", d.byMonthCatOut);
  ok(!!d.byMonthCat[mk(dep)], "B2 but the deposit itself still counts");

  const d2 = build([fdRow({ amount: 50000, date: ago(20), maturity: "", rate: "7%" })]);
  ok(Object.keys(d2.byMonthCatOut).length === 0,
     "B3 a blank maturity date books nothing", d2.byMonthCatOut);
}

console.log("\nC. Only fixed deposits");
{
  // Provident Fund rows carry no maturity date; a Commodity row's date column is
  // a SELL date, and that sale is already its own row.
  const d = build([
    fdRow({ sub: "Provident Fund", amount: 20000, date: ago(24), maturity: ago(2), rate: "8%" }),
    fdRow({ cat: "Commodity", sub: "Gold", amount: 30000, date: ago(24), maturity: ago(2), rate: "" }),
  ]);
  ok(Object.keys(d.byMonthCatOut).length === 0,
     "C1 non-FD sub categories book no maturity outflow", d.byMonthCatOut);
}

console.log("\nD. A withdrawal row is not double-counted");
{
  // If the sheet ever carries an explicit redemption row, that row is the
  // outflow — the maturity must not add a second one on top of it.
  const d = build([fdRow({ type: "Withdrawal", amount: 40000, date: ago(4),
                           maturity: ago(4), rate: "6%" })]);
  const out = d.byMonthCatOut[mk(ago(4))] || {};
  ok(near(out["Fixed Deposit"] || 0, 40000),
     "D1 an explicit withdrawal row books once, at its own amount", out);
}

console.log("\nE. The maturity respects the portfolio filter and the year list");
{
  const mat = ago(8);
  const rows = [fdRow({ amount: 100000, date: ago(26), maturity: mat, rate: "6.25%" })];
  rows[0][0] = "Someone Else";
  const d = build(rows, "Snnehal");
  ok(Object.keys(d.byMonthCatOut).length === 0,
     "E1 another portfolio's FD does not appear when one portfolio is selected", d.byMonthCatOut);

  // A year whose ONLY event is a maturity must still be offered in the year
  // selector, or the chart cannot be navigated to it.
  const dep = ago(26);
  const d2 = build([fdRow({ amount: 100000, date: dep, maturity: mat, rate: "6.25%" })]);
  ok(d2.yearList.indexOf(mk(mat).slice(0, 4)) !== -1,
     "E2 the maturity year is in the year list", d2.yearList);
}

console.log("\nF. The drill-down rows match the bars");
{
  const dep = ago(30), mat = ago(6);
  const d = build([fdRow({ name: "HDFC Deposit-1", amount: 100000, date: dep, maturity: mat, rate: "6.25%" })]);
  const txns = d.byMonthTxns[mk(mat)] || [];
  ok(txns.length === 1, "F1 one transaction in the maturity month", txns.length);
  ok(txns[0] && txns[0].out === true, "F2 it reads as an outflow");
  ok(txns[0] && txns[0].type === "Maturity", "F3 it is labelled Maturity, not Deposit", txns[0] && txns[0].type);
  ok(txns[0] && txns[0].instrument === "HDFC Deposit-1", "F4 it names the deposit");
  ok(txns[0] && near(txns[0].amount, (d.byMonthCatOut[mk(mat)] || {})["Fixed Deposit"]),
     "F5 its amount equals the bar it sits behind");
}

console.log("\nH. The maturity carries its interest as P&L");
{
  const dep = ago(30), mat = ago(6);
  const d = build([fdRow({ amount: 100000, date: dep, maturity: mat, rate: "6.25%" })]);
  const t = (d.byMonthTxns[mk(mat)] || [])[0];
  ok(t && t.pnl != null, "H1 the maturity row carries a pnl");
  ok(t && near(t.pnl, t.amount - 100000),
     "H2 it is exactly the interest: what came back minus what went in", t && [t.pnl, t.amount - 100000]);
  ok(t && t.pnl > 0, "H3 a positive rate earns positive interest", t && t.pnl);

  // A deposit is not a realized event; only the maturity books profit.
  const dt = (d.byMonthTxns[mk(dep)] || [])[0];
  ok(dt && dt.pnl == null, "H4 the deposit row carries no pnl", dt && dt.pnl);

  // A zero-rate FD returns exactly the principal, so its profit is zero — which
  // must still read as KNOWN (0), not as unknown.
  const d0 = build([fdRow({ amount: 100000, date: dep, maturity: mat, rate: "0%" })]);
  const t0 = (d0.byMonthTxns[mk(mat)] || [])[0];
  ok(t0 && t0.pnl === 0, "H5 a zero-rate FD reports zero profit, not a blank", t0 && t0.pnl);
}

console.log("\nG. fdMaturityValue itself");
{
  const s = new Date("2024-01-01T00:00:00");
  ok(fdMaturityValue(100000, s, new Date("2024-01-01T00:00:00"), 0.0625) === 100000,
     "G1 zero elapsed returns the principal");
  ok(near(fdMaturityValue(100000, s, new Date("2025-01-01T00:00:00"), 0.0625),
          100000 * Math.pow(1.015625, 4)),
     "G2 four quarters compound quarterly");
  ok(fdMaturityValue(100000, s, new Date("2025-01-01T00:00:00"), 0) === 100000,
     "G3 no rate means no interest");
  ok((SRC.match(/Math\.pow\(1 \+ rate \/ 4, q\)/g) || []).length === 1,
     "G4 the compounding formula lives in one place");
}

console.log("\nK. US stocks and ETFs are converted to rupees");
{
  // The chart is entirely in rupees. A $100 purchase must be drawn as ₹8,400, not
  // as ₹100 sitting alongside genuinely-rupee mutual fund purchases.
  const SE = ["Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price",
              "Transaction Date", "Instrument Sub Category"];
  const MAP = ["Instrument Name", "Instrument Category", "Instrument Sub Category",
               "Market Segment", "Region", "Identifier", "Sector"];
  function run(prices) {
    stockPrices = prices;
    sheets = {
      stocksetf: [SE,
        ["Snnehal", "QQQ", "Buy", "10", "100", "2024-03-01", "ETF"],
        ["Snnehal", "HDFC Bank", "Buy", "10", "1500", "2024-03-01", "Stock"]],
      stocksetfmapping: [MAP,
        ["QQQ", "Equity", "ETF", "Large Cap", "US", "QQQ", "Tech"],
        ["HDFC Bank", "Equity", "Stock", "Large Cap", "India", "HDFCBANK", "Financials"]],
    };
    return buildMonthlyInvestCatData("all");
  }

  const d = run({ prices: { __USD_INR__: { price: 84 } },
                  usd_inr_history: { "2024-03-01": 83 } });
  const m = d.byMonthCat["2024-03"] || {};
  ok(near(m["ETF"] || 0, 10 * 100 * 83),
     "K1 a US ETF is converted at the transaction date's own rate", m["ETF"]);
  ok(near(m["Stock"] || 0, 15000),
     "K2 an India row is left alone — it is already in rupees", m["Stock"]);
  ok(near((d.byMonthGrp["2024-03"] || {})["Equity"] || 0, 10 * 100 * 83 + 15000),
     "K3 the category rollup totals the converted figure", d.byMonthGrp["2024-03"]);

  // No history for that date → today's rate, not 1.
  const d2 = run({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {} });
  ok(near((d2.byMonthCat["2024-03"] || {})["ETF"] || 0, 10 * 100 * 84),
     "K4 a missing historical rate falls back to today's, never to unconverted",
     (d2.byMonthCat["2024-03"] || {})["ETF"]);

  // Prices not loaded yet: the chart repaints when they arrive, but it must not
  // crash or invent a rate in the meantime.
  const d3 = run(null);
  const m3 = d3.byMonthCat["2024-03"] || {};
  ok(isFinite(m3["ETF"]) && m3["ETF"] > 0, "K5 no price payload still produces a finite figure", m3["ETF"]);
  ok(near(m3["Stock"] || 0, 15000), "K6 and never disturbs the rupee rows", m3["Stock"]);

  // The drill-down rows must carry the same converted amount as the bars.
  const t = (d.byMonthTxns["2024-03"] || []).filter((x) => x.instrument === "QQQ")[0];
  ok(t && near(t.amount, 10 * 100 * 83),
     "K7 the transaction list shows rupees too, matching the bar", t && t.amount);
  stockPrices = null;
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
