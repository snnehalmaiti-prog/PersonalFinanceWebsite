// Regression suite for the Fixed Income reclassification.
//
// An instrument whose Instrument Category is "Fixed Income" in the Mutual Fund
// or Stocks/ETF mapping sheet must be reported under Fixed Income everywhere:
// out of the MF and Stocks/ETF lists AND their totals, into Debt ETF/Mutual and
// the Fixed Income cards — with net worth unchanged.
//
// Like the other suites, this extracts the REAL function sources from script.js
// and evals them against mocked sheets, so it tests the shipped code.

var window = {}; // hoisted: wf-*.js attach to it when eval'd below
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
eval(fs.readFileSync(path.join(__dirname, "..", "wf-overview.js"), "utf8"));
const { aggregateOverview } = window.WfOverview || globalThis.WfOverview;
require("../wf-math.js"); // defines globalThis.WfMath
const WfMath = window.WfMath || globalThis.WfMath;
function fifoRemainingLots(txns) { return WfMath.fifoRemainingLots(txns); }

function extract(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error("marker not found: " + marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  let end = i + 1;
  if (SRC[end] === ";") end++;
  return SRC.slice(start, end);
}

// ---- scope the extracted code runs in -------------------------------------
let sheets = {}; // prefix → rows[][]
function getSheetRows(prefix) { return sheets[prefix] || null; }
const UNITS_EPSILON = 0.0001;

const pieces = [
  "function normalizeText(value)",
  "function findHeaderIndex(ownHeader, canonicalName)",
  "var CANONICAL_FIELD_KEYWORDS",
  "function parseNumber(value)",
  "function parseFlexibleDate(value)",
  "var _topCatMemo = null",
  "function buildInstrumentTopCategoryMap()",
  "function isFixedIncomeInstrument(name, catMap)",
  "function excludeFixedIncomeRows(rows, catMap)",
  "function onlyFixedIncomeRows(rows, catMap)",
  "function collectPortfolioNamesFromRows(rows)",
  "function _buildDebtFundHoldingsForFi()",
  "function _buildAllFixedIncomeHoldingsList()",
  "function groupUnitTransactionsByInstrument(rows, portfolioFilter)",
  "function sumUnitBasedBuyInvestment(rows, portfolioFilter)",
  "function buildXirrCashFlows(rows, portfolioFilter, instrumentFilter)",
].map(extract).join("\n\n");
eval(pieces);

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 0.01 : eps); }

// ---- fixture ---------------------------------------------------------------
// Snnehal holds one equity fund + one arbitrage (debt) fund + one debt ETF.
// Riya holds ONLY a debt fund — she must vanish from the MF tab entirely.
const TXN_HDR = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
function resetSheets() {
  sheets = {
    mfmapping: [
      ["Instrument Name", "Instrument Category", "Instrument Sub Category"],
      ["Parag Parikh Flexi Cap", "Equity", "Flexi Cap"],
      ["Kotak Arbitrage Fund", "Fixed Income", "Arbitrage"],
      ["Riya Debt Fund", "Fixed Income", "Corporate Bond"],
    ],
    stocksetfmapping: [
      ["Instrument Name", "Instrument Category", "Identifier", "Region"],
      ["Nifty Bees", "Equity", "NIFTYBEES", "India"],
      ["Liquid Bees", "Fixed Income", "LIQUIDBEES", "India"],
    ],
    equity: [
      TXN_HDR,
      ["01/04/2024", "Snnehal", "Parag Parikh Flexi Cap", "Buy", "100", "50"],   // 5,000
      ["01/04/2024", "Snnehal", "Kotak Arbitrage Fund", "Buy", "200", "25"],     // 5,000 debt
      ["01/05/2024", "Riya", "Riya Debt Fund", "Buy", "100", "30"],              // 3,000 debt
    ],
    stocksetf: [
      TXN_HDR,
      ["01/04/2024", "Snnehal", "Nifty Bees", "Buy", "10", "200"],               // 2,000
      ["01/04/2024", "Snnehal", "Liquid Bees", "Buy", "5", "1000"],              // 5,000 debt
    ],
  };
  window.__mfDebtRows = [
    { instrument: "Kotak Arbitrage Fund", units: 200, invested: 5000, current: 5400 },
    { instrument: "Riya Debt Fund", units: 100, invested: 3000, current: 3200 },
  ];
  window.__seDebtRows = [
    { instrument: "Liquid Bees", units: 5, investedINR: 5000, currentINR: 5100, isClosed: false },
  ];
}
resetSheets();

console.log("A. Classification is driven by the mapping sheets");
{
  const cat = buildInstrumentTopCategoryMap();
  ok(cat["kotak arbitrage fund"] === "Fixed Income", "A1 MF mapping supplies the category");
  ok(cat["liquid bees"] === "Fixed Income", "A2 Stocks/ETF mapping supplies the category");
  ok(isFixedIncomeInstrument("KOTAK ARBITRAGE FUND", cat), "A3 matching ignores case");
  ok(!isFixedIncomeInstrument("Parag Parikh Flexi Cap", cat), "A4 an equity fund is not debt");
  ok(!isFixedIncomeInstrument("Some Unmapped Fund", cat), "A5 unmapped instruments stay in their own tab (fail-open)");
}

console.log("\nB. Mutual Fund tab excludes debt");
{
  const mfRows = excludeFixedIncomeRows(sheets.equity);
  ok(mfRows.length === 2, "B1 only the equity transaction survives", mfRows.length);
  ok(near(sumUnitBasedBuyInvestment(mfRows, "Snnehal"), 5000), "B2 invested excludes the arbitrage fund",
     sumUnitBasedBuyInvestment(mfRows, "Snnehal"));
  ok(near(sumUnitBasedBuyInvestment(sheets.equity, "Snnehal"), 10000), "B3 (unfiltered would have been 10,000)");
  const names = collectPortfolioNamesFromRows(mfRows);
  ok(names.join(",") === "Snnehal", "B4 Riya gets no Mutual Fund card - she holds only debt", names);
  ok(buildXirrCashFlows(mfRows, "Riya").length === 0, "B5 and no MF cash flows either");
  ok(buildXirrCashFlows(mfRows, "Snnehal").length === 1, "B6 Snnehal's MF flows drop the debt buy");
}

console.log("\nC. Stocks/ETF tab excludes debt");
{
  const seRows = excludeFixedIncomeRows(sheets.stocksetf);
  ok(seRows.length === 2, "C1 the debt ETF transaction is removed", seRows.length);
  ok(near(sumUnitBasedBuyInvestment(seRows, "Snnehal"), 2000), "C2 invested excludes Liquid Bees",
     sumUnitBasedBuyInvestment(seRows, "Snnehal"));
  ok(buildXirrCashFlows(seRows, "all").length === 1, "C3 XIRR flows cover only the equity ETF");
}

console.log("\nD. Nothing is lost: exclude + only partition the sheet");
["equity", "stocksetf"].forEach(function (prefix) {
  const rows = sheets[prefix];
  const kept = excludeFixedIncomeRows(rows), moved = onlyFixedIncomeRows(rows);
  ok(kept.length + moved.length === rows.length + 1, "D " + prefix + ": every row lands in exactly one side");
  const investedSplit = sumUnitBasedBuyInvestment(kept, "all") + sumUnitBasedBuyInvestment(moved, "all");
  ok(near(investedSplit, sumUnitBasedBuyInvestment(rows, "all")),
     "D " + prefix + ": invested is conserved across the split", investedSplit);
});

console.log("\nE. Fixed Income tab picks the debt holdings up");
{
  const debt = _buildDebtFundHoldingsForFi();
  ok(debt.length === 3, "E1 both MF debt funds and the debt ETF appear", debt.length);
  const byInst = {};
  debt.forEach(function (h) { byInst[h.instrument] = h; });
  ok(byInst["Kotak Arbitrage Fund"].portfolio === "Snnehal", "E2 portfolio resolved from the equity sheet");
  ok(byInst["Riya Debt Fund"].portfolio === "Riya", "E3 a debt-only portfolio still gets its FI holding");
  ok(byInst["Liquid Bees"].portfolio === "Snnehal", "E4 portfolio resolved from the Stocks/ETF sheet");
  ok(near(byInst["Liquid Bees"].current, 5100), "E5 the SE row's INR value is used, not a USD figure");
  const total = debt.reduce(function (s, h) { return s + h.current; }, 0);
  ok(near(total, 13700), "E6 all debt value reaches Fixed Income", total);
  ok(debt.every(function (h) { return String(h.subCategory).toLowerCase().indexOf("debt") === 0; }),
     "E7 sub-category marks them as debt so the FI list can hide them");
}
{
  // Closed and fully-sold positions must not inflate the FI cards.
  window.__seDebtRows = [{ instrument: "Liquid Bees", units: 5, investedINR: 5000, currentINR: 5100, isClosed: true }];
  window.__mfDebtRows = [{ instrument: "Kotak Arbitrage Fund", units: 0, invested: 5000, current: 0 }];
  ok(_buildDebtFundHoldingsForFi().length === 0, "E8 closed / zero-unit debt positions are skipped");
  window.__mfDebtRows = undefined; window.__seDebtRows = undefined;
  ok(_buildDebtFundHoldingsForFi().length === 0, "E9 no debt rows yet (tab not rendered) is not a crash");
  resetSheets();
}

console.log("\nF. Overview conservation: value only moves between buckets");
{
  const before = aggregateOverview({
    mf: { invested: 10000, current: 11000, dayChange: 50 },
    se: { invested: 7000, current: 7200, dayChange: -20 },
    fi: { invested: 500000, current: 590000 },
    comm: { invested: 1000, current: 1200, dayChange: 5 },
  }, {});
  const after = aggregateOverview({
    mf: { invested: 5000, current: 5600, dayChange: 30 },
    se: { invested: 2000, current: 2100, dayChange: -20 },
    fi: { invested: 500000, current: 590000 },
    comm: { invested: 1000, current: 1200, dayChange: 5 },
    debtMf: { invested: 5000, current: 5400, dayChange: 20 },
    debtSe: { invested: 5000, current: 5100, dayChange: 0 },
  }, {});
  ok(near(before.current, after.current), "F1 net worth is unchanged by the reclassification",
     [before.current, after.current]);
  ok(near(before.invested, after.invested), "F2 invested is unchanged", [before.invested, after.invested]);
  ok(near(before.dayChange, after.dayChange), "F3 day change is unchanged", [before.dayChange, after.dayChange]);
  ok(after.cards.mf.current < before.cards.mf.current, "F4 the Mutual Fund card falls",
     [before.cards.mf.current, after.cards.mf.current]);
  ok(after.cards.se.current < before.cards.se.current, "F5 the Stocks/ETF card falls",
     [before.cards.se.current, after.cards.se.current]);
  ok(near(after.cards.fi.invested, before.cards.fi.invested + 10000),
     "F6 the Fixed Income card absorbs the debt invested", after.cards.fi.invested);
  const cardSum = after.cards.mf.current + after.cards.se.current + after.cards.fi.current;
  ok(near(cardSum, after.current), "F7 the three cards still sum to net worth", [cardSum, after.current]);
  ok(near(before.cards.mf.current - after.cards.mf.current, 5400),
     "F8 exactly the debt fund's value left Mutual Fund");
  ok(near(before.cards.se.current - after.cards.se.current, 5100),
     "F9 exactly the debt ETF's value left Stocks/ETF");
}

console.log("\nG. A portfolio holding nothing but debt disappears from both tabs");
{
  sheets.equity = [
    TXN_HDR,
    ["01/05/2024", "Riya", "Riya Debt Fund", "Buy", "100", "30"],
  ];
  sheets.stocksetf = [
    TXN_HDR,
    ["01/04/2024", "Riya", "Liquid Bees", "Buy", "5", "1000"],
  ];
  ok(collectPortfolioNamesFromRows(excludeFixedIncomeRows(sheets.equity)).length === 0,
     "G1 no Mutual Fund cards at all when every fund is debt");
  ok(collectPortfolioNamesFromRows(excludeFixedIncomeRows(sheets.stocksetf)).length === 0,
     "G2 no Stocks/ETF cards either");
  ok(collectPortfolioNamesFromRows(onlyFixedIncomeRows(sheets.equity)).join(",") === "Riya",
     "G3 the portfolio is still reachable on the Fixed Income side");
  resetSheets();
}

console.log("\nH. Degenerate inputs");
{
  ok(excludeFixedIncomeRows(undefined) === undefined, "H1 undefined rows pass through");
  ok(excludeFixedIncomeRows([]).length === 0, "H2 empty rows pass through");
  const noNameCol = [["Portfolio Name", "Units"], ["Snnehal", "1"]];
  ok(excludeFixedIncomeRows(noNameCol).length === 2, "H3 a sheet without Instrument Name is left intact");
  ok(onlyFixedIncomeRows(noNameCol).length === 1, "H4 ...and yields no debt rows");
  sheets.mfmapping = [["Instrument Name"], ["Parag Parikh Flexi Cap"]];
  sheets.stocksetfmapping = null;
  ok(Object.keys(buildInstrumentTopCategoryMap()).length === 0,
     "H5 a mapping sheet with no Instrument Category classifies nothing");
  ok(excludeFixedIncomeRows(sheets.equity).length === 4,
     "H6 with no categories mapped, nothing is reclassified away from MF");
  resetSheets();
}

console.log("\nI. The Fixed Income holdings list is actually wired to the debt rows");
{
  // No fd / fixedincome sheets: whatever comes back must be the debt holdings,
  // which is what the Fixed Income cards, allocation and split are built from.
  sheets.fd = null; sheets.fixedincome = null;
  const all = _buildAllFixedIncomeHoldingsList();
  ok(all.length === 3, "I1 debt funds reach the Fixed Income holdings list", all.length);
  const total = all.reduce(function (s, h) { return s + h.current; }, 0);
  ok(near(total, 13700), "I2 with their full value", total);
  ok(all.every(function (h) { return !h.matured; }), "I3 and none is flagged matured, so the cards count them");
  resetSheets();
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
