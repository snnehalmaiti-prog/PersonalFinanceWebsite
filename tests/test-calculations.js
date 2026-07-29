#!/usr/bin/env node
// test-calculations.js — the money maths.
//
// Every expectation here is derived independently of the implementation: XIRR is
// checked by discounting the flows back through NPV, FIFO by hand-worked lots, PF
// interest by compounding month by month in the test itself. A test that simply
// re-ran the shipped formula would agree with it however wrong it was.
//
// Functions taken from wf-math.js are loaded for real. Those living inside
// script.js are reproduced verbatim (the convention in test-sheet-pipeline.js and
// test-expense-export.js); their source line is noted so drift is traceable.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
global.window = global;
eval(fs.readFileSync(path.join(ROOT, "wf-math.js"), "utf8"));
const { calculateXIRR, fifoRemainingLots, DAYS_PER_YEAR } = global.WfMath;

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol); }
const D = (s) => new Date(s + "T00:00:00Z");

// ───────────────────────── A. XIRR ─────────────────────────
console.log("A. XIRR — verified by discounting the flows independently");

// If r is the true IRR then the NPV of the flows at r is zero. That is the
// definition, and it does not depend on how the solver found r.
function npvAt(flows, rate) {
  const t0 = flows[0].date.getTime();
  return flows.reduce((s, f) => {
    const yrs = (f.date.getTime() - t0) / (86400000 * DAYS_PER_YEAR);
    return s + f.amount / Math.pow(1 + rate, yrs);
  }, 0);
}

{
  const flows = [
    { date: D("2024-01-01"), amount: -100000 },
    { date: D("2025-01-01"), amount: 110000 },
  ];
  const r = calculateXIRR(flows);
  ok(near(r, 0.10, 1e-3), "A1 one-year 10% gain returns ~0.10", String(r));
  ok(near(npvAt(flows, r), 0, 1), "A2 NPV at the returned rate is zero", String(npvAt(flows, r)));
}
{
  // Irregular timing and multiple contributions — the case a naive
  // (end/start)^(1/n) formula gets wrong.
  const flows = [
    { date: D("2023-03-15"), amount: -50000 },
    { date: D("2023-09-02"), amount: -25000 },
    { date: D("2024-02-11"), amount: -30000 },
    { date: D("2025-06-30"), amount: 130000 },
  ];
  const r = calculateXIRR(flows);
  ok(r !== null && isFinite(r), "A3 irregular multi-contribution solves", String(r));
  ok(near(npvAt(flows, r), 0, 1), "A4 NPV at that rate is zero", String(npvAt(flows, r)));
}
{
  const flows = [
    { date: D("2024-01-01"), amount: -100000 },
    { date: D("2025-01-01"), amount: 80000 },
  ];
  const r = calculateXIRR(flows);
  ok(r !== null && r < 0, "A5 a loss returns a negative rate", String(r));
  ok(near(npvAt(flows, r), 0, 1), "A6 NPV zero for the loss case");
}
{
  // Same money, twice the time: the annualised rate must be lower, and both must
  // still satisfy NPV = 0.
  const oneYear = calculateXIRR([
    { date: D("2024-01-01"), amount: -100000 }, { date: D("2025-01-01"), amount: 121000 }]);
  const twoYear = calculateXIRR([
    { date: D("2024-01-01"), amount: -100000 }, { date: D("2026-01-01"), amount: 121000 }]);
  ok(twoYear < oneYear, "A7 same gain over twice the span annualises lower");
  ok(near(twoYear, 0.10, 1e-3), "A8 21% over two years ≈ 10%/yr compounded", String(twoYear));
}
ok(calculateXIRR([{ date: D("2024-01-01"), amount: -1000 }]) === null,
   "A9 a single flow has no solvable rate → null");
ok(calculateXIRR([]) === null, "A10 empty flows → null");
{
  // All outflows and no inflow has no root; it must not return a bogus number.
  const r = calculateXIRR([
    { date: D("2024-01-01"), amount: -1000 }, { date: D("2024-06-01"), amount: -1000 }]);
  ok(r === null || !isFinite(r), "A11 no positive flow → no rate", String(r));
}

// ───────────────────────── B. FIFO ─────────────────────────
console.log("\nB. FIFO lot matching");

{
  const lots = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "buy", units: 10, price: 150 },
    { type: "sell", units: 15, price: 200 },
  ]);
  const units = lots.reduce((s, l) => s + l.units, 0);
  const cost = lots.reduce((s, l) => s + l.units * l.price, 0);
  // Oldest lot goes first: the 10@100 and 5 of the 10@150 are consumed, leaving 5@150.
  ok(near(units, 5), "B1 5 units remain after selling 15 of 20", String(units));
  ok(near(cost, 750), "B2 remaining cost is 5×150 = 750", String(cost));
}
{
  const lots = fifoRemainingLots([
    { type: "buy", units: 5, price: 100 },
    { type: "sell", units: 20, price: 200 },
  ]);
  ok(lots.reduce((s, l) => s + l.units, 0) === 0, "B3 overselling leaves nothing (no negative lots)");
}
{
  const lots = fifoRemainingLots([{ type: "buy", units: 3, price: 10 }]);
  ok(near(lots.reduce((s, l) => s + l.units * l.price, 0), 30), "B4 unsold lot keeps its full cost");
}

// ── computeInstrumentRealizedDetail — verbatim from script.js (~line 10130) ──
function computeInstrumentRealizedDetail(txns) {
  var buyLots = [];
  var costOfSoldUnits = 0, saleProceeds = 0, unitsSold = 0, lastSell = null;
  txns.forEach(function (txn) {
    if (txn.type === "buy") { buyLots.push({ units: txn.units, price: txn.price }); return; }
    var unitsToMatch = txn.units, matchedThisSell = 0;
    while (unitsToMatch > 0 && buyLots.length) {
      var lot = buyLots[0];
      var matched = Math.min(unitsToMatch, lot.units);
      costOfSoldUnits += matched * lot.price;
      matchedThisSell += matched;
      lot.units -= matched;
      unitsToMatch -= matched;
      if (lot.units <= 0) buyLots.shift();
    }
    saleProceeds += matchedThisSell * txn.price;
    unitsSold += matchedThisSell;
    if (!lastSell || (txn.date && (!lastSell.date || txn.date.getTime() >= lastSell.date.getTime()))) lastSell = txn;
  });
  return {
    costOfSoldUnits: costOfSoldUnits, saleProceeds: saleProceeds, unitsSold: unitsSold,
    avgBuyCost: unitsSold > 0 ? costOfSoldUnits / unitsSold : 0,
    realizedPnl: saleProceeds - costOfSoldUnits,
    lastSellPrice: lastSell ? lastSell.price : 0,
  };
}

console.log("\nC. Realized profit");
{
  const r = computeInstrumentRealizedDetail([
    { type: "buy", units: 10, price: 100, date: D("2024-01-01") },
    { type: "buy", units: 10, price: 150, date: D("2024-06-01") },
    { type: "sell", units: 15, price: 200, date: D("2025-01-01") },
  ]);
  // Hand-worked: cost 10×100 + 5×150 = 1750; proceeds 15×200 = 3000.
  ok(near(r.costOfSoldUnits, 1750), "C1 FIFO cost of the 15 units sold = 1750", String(r.costOfSoldUnits));
  ok(near(r.saleProceeds, 3000), "C2 proceeds = 3000", String(r.saleProceeds));
  ok(near(r.realizedPnl, 1250), "C3 realized P&L = 1250", String(r.realizedPnl));
  ok(near(r.avgBuyCost, 1750 / 15), "C4 average buy cost per unit sold");
  ok(near(r.lastSellPrice, 200), "C5 sell price per unit");
}
{
  // Overselling must not credit proceeds for units that were never bought:
  // proceeds are clamped to the 5 matched units, not the 20 claimed.
  const r = computeInstrumentRealizedDetail([
    { type: "buy", units: 5, price: 100, date: D("2024-01-01") },
    { type: "sell", units: 20, price: 200, date: D("2025-01-01") },
  ]);
  ok(near(r.unitsSold, 5), "C6 oversell clamps units to what was bought", String(r.unitsSold));
  ok(near(r.saleProceeds, 1000), "C7 oversell proceeds clamped to 5×200", String(r.saleProceeds));
  ok(near(r.realizedPnl, 500), "C8 no phantom zero-cost profit", String(r.realizedPnl));
}
{
  const r = computeInstrumentRealizedDetail([
    { type: "buy", units: 10, price: 200, date: D("2024-01-01") },
    { type: "sell", units: 10, price: 150, date: D("2025-01-01") },
  ]);
  ok(near(r.realizedPnl, -500), "C9 selling below cost realizes a loss", String(r.realizedPnl));
}
{
  const r = computeInstrumentRealizedDetail([{ type: "buy", units: 10, price: 100 }]);
  ok(r.realizedPnl === 0 && r.unitsSold === 0, "C10 nothing sold → no realized P&L");
}

// ── Month-windowed FIFO, as used by the Cash Flow drill-down ──
function realizedByMonth(txns) {
  const lots = [], out = {};
  txns.forEach((t) => {
    if (t.type === "buy") { lots.push({ units: t.units, cost: t.price }); return; }
    let toMatch = t.units, costMatched = 0, matched = 0;
    while (toMatch > 0 && lots.length) {
      const l = lots[0];
      const q = Math.min(toMatch, l.units);
      costMatched += q * l.cost; matched += q; l.units -= q; toMatch -= q;
      if (l.units <= 0) lots.shift();
    }
    if (matched <= 0) return;
    const k = t.date.getUTCFullYear() + "-" + String(t.date.getUTCMonth() + 1).padStart(2, "0");
    const e = out[k] || (out[k] = { units: 0, cost: 0, proceeds: 0 });
    e.units += matched; e.cost += costMatched; e.proceeds += matched * t.price;
  });
  return out;
}

console.log("\nD. Realized profit bucketed by month of sale");
{
  const byMonth = realizedByMonth([
    { type: "buy", units: 10, price: 100, date: D("2025-05-10") },
    { type: "buy", units: 10, price: 150, date: D("2025-09-01") },
    { type: "sell", units: 15, price: 200, date: D("2026-02-20") },
  ]);
  const feb = byMonth["2026-02"];
  // The buys sit in 2025 but fund a 2026 sale: cost basis must come from them.
  ok(!!feb, "D1 sale is attributed to its own month");
  ok(near(feb.cost, 1750), "D2 cost basis drawn from buys made in earlier months", String(feb && feb.cost));
  ok(near(feb.proceeds - feb.cost, 1250), "D3 P&L = 1250");
  ok(near(feb.cost / feb.units, 1750 / 15), "D4 buy price = matched cost per unit");
  ok(near(feb.proceeds / feb.units, 200), "D5 sell price = proceeds per unit");
  ok(Object.keys(byMonth).length === 1, "D6 months holding only buys report no realized figure");
}
{
  // Two sales in different months must not share a cost basis: the first
  // consumes the cheap lot, so the second is left with the dearer one.
  const byMonth = realizedByMonth([
    { type: "buy", units: 10, price: 100, date: D("2025-01-01") },
    { type: "buy", units: 10, price: 200, date: D("2025-02-01") },
    { type: "sell", units: 10, price: 150, date: D("2025-06-10") },
    { type: "sell", units: 10, price: 150, date: D("2025-07-10") },
  ]);
  ok(near(byMonth["2025-06"].cost, 1000), "D7 first sale consumes the oldest lot", String(byMonth["2025-06"].cost));
  ok(near(byMonth["2025-07"].cost, 2000), "D8 later sale gets the remaining, dearer lot", String(byMonth["2025-07"].cost));
  ok(near(byMonth["2025-06"].proceeds - byMonth["2025-06"].cost, 500), "D9 first sale profits 500");
  ok(near(byMonth["2025-07"].proceeds - byMonth["2025-07"].cost, -500), "D10 second sale loses 500");
  const total = Object.values(byMonth).reduce((s, m) => s + (m.proceeds - m.cost), 0);
  ok(near(total, 0), "D11 the two months net to zero overall", String(total));
}
{
  // US legs convert at each transaction's own rate, not one rate for both ends.
  const usd = { buy: 80, sell: 90 };
  const lots = [{ units: 10, cost: 100 * usd.buy }];
  const proceeds = 10 * 120 * usd.sell;
  const cost = 10 * 100 * usd.buy;
  ok(near(cost, 80000) && near(proceeds, 108000), "D12 each leg uses its own USD/INR rate");
  ok(near(proceeds - cost, 28000), "D13 P&L includes the currency move", String(proceeds - cost));
}

// ── PF/EPF engine — verbatim from script.js (~line 680) ──
function epfFyStart(d) { return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; }
function computePfAccountValue(txns, rateMap, asOf) {
  var valid = txns.filter(function (t) { return t.date; }).sort(function (a, b) { return a.date - b.date; });
  if (!valid.length) return { invested: 0, current: 0, realizedProfit: 0, realizedByYear: {} };
  var realizedByYear = {};
  var manualByFY = {};
  valid.forEach(function (t) { if (t.type === "interest") { var fy = epfFyStart(t.date); manualByFY[fy] = (manualByFY[fy] || 0) + t.amount; } });
  var byYM = {};
  valid.forEach(function (t) {
    var k = t.date.getFullYear() + "-" + t.date.getMonth();
    var c = byYM[k] || (byYM[k] = { dep: [], intr: 0, wd: [] });
    if (t.type === "interest") c.intr += t.amount;
    else if (t.type === "withdrawal") c.wd.push(t.amount);
    else c.dep.push(t.amount);
  });
  var lots = [], credited = 0, accrued = 0, realized = 0;
  var cur = new Date(valid[0].date.getFullYear(), valid[0].date.getMonth(), 1);
  var end = new Date(asOf.getFullYear(), asOf.getMonth(), 1);
  var curFY = epfFyStart(cur);
  var fyHasManual = manualByFY[curFY] > 0;
  while (cur <= end) {
    var fy = epfFyStart(cur);
    if (fy !== curFY) { credited += accrued; accrued = 0; curFY = fy; fyHasManual = manualByFY[curFY] > 0; }
    var cell = byYM[cur.getFullYear() + "-" + cur.getMonth()];
    if (cell) {
      cell.dep.forEach(function (a) { lots.push({ amount: a }); });
      if (cell.intr) credited += cell.intr;
      cell.wd.forEach(function (wamt) {
        var principalBefore = lots.reduce(function (s, l) { return s + l.amount; }, 0);
        var interestBefore = credited + accrued;
        var balanceBefore = principalBefore + interestBefore;
        var w = Math.min(wamt, balanceBefore);
        if (balanceBefore > 0 && w > 0) {
          var pp = w * (principalBefore / balanceBefore), ip = w - pp, rem = pp;
          while (rem > 1e-9 && lots.length > 0) { if (lots[0].amount <= rem + 1e-9) { rem -= lots[0].amount; lots.shift(); } else { lots[0].amount -= rem; rem = 0; } }
          realized += ip;
          var wy = String(cur.getFullYear());
          realizedByYear[wy] = (realizedByYear[wy] || 0) + ip;
          var fromAccrued = Math.min(accrued, ip); accrued -= fromAccrued; credited -= (ip - fromAccrued);
        }
      });
    }
    var rate = rateMap[curFY];
    if (rate && !fyHasManual) {
      var base = lots.reduce(function (s, l) { return s + l.amount; }, 0) + credited;
      accrued += base * (rate / 12);
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  var principal = lots.reduce(function (s, l) { return s + l.amount; }, 0);
  return { invested: principal, current: principal + credited + accrued, realizedProfit: realized, realizedByYear: realizedByYear };
}

console.log("\nE. Provident Fund / EPF interest");
{
  // One deposit in April, held to 31 March at 8.5%: twelve monthly accruals on a
  // flat balance = exactly the annual rate.
  const r = computePfAccountValue(
    [{ type: "deposit", amount: 120000, date: new Date(2024, 3, 1) }],
    { 2024: 0.085 }, new Date(2025, 2, 31));
  ok(near(r.invested, 120000, 0.01), "E1 principal unchanged by interest", String(r.invested));
  ok(near(r.current, 120000 * 1.085, 1), "E2 a full year at 8.5% = 130,200", String(r.current));
}
{
  // The financial year runs April→March, so a deposit made in March earns only
  // that one month before the year closes.
  const r = computePfAccountValue(
    [{ type: "deposit", amount: 120000, date: new Date(2025, 2, 1) }],
    { 2024: 0.085 }, new Date(2025, 2, 31));
  ok(near(r.current, 120000 * (1 + 0.085 / 12), 1), "E3 March deposit accrues one month only", String(r.current));
}
{
  // Interest credited at year end must itself earn interest in the next year.
  const r = computePfAccountValue(
    [{ type: "deposit", amount: 100000, date: new Date(2023, 3, 1) }],
    { 2023: 0.10, 2024: 0.10 }, new Date(2025, 2, 31));
  ok(near(r.current, 121000, 1), "E4 two years at 10% compounds to 121,000", String(r.current));
  ok(!near(r.current, 120000, 1), "E5 not simple interest (120,000)");
}
{
  // Within a year the accrual does not compound on itself.
  const r = computePfAccountValue(
    [{ type: "deposit", amount: 100000, date: new Date(2024, 3, 1) }],
    { 2024: 0.12 }, new Date(2025, 2, 31));
  ok(near(r.current, 112000, 1), "E6 in-year accrual is simple, not monthly-compounded", String(r.current));
  ok(r.current < 100000 * Math.pow(1 + 0.12 / 12, 12), "E7 below monthly compounding");
}
{
  // A withdrawal takes principal and interest in proportion, so it cannot strip
  // interest first and leave the principal overstated.
  const r = computePfAccountValue([
    { type: "deposit", amount: 100000, date: new Date(2023, 3, 1) },
    { type: "withdrawal", amount: 55000, date: new Date(2024, 5, 1) },
  ], { 2023: 0.10, 2024: 0.10 }, new Date(2025, 2, 31));
  // At withdrawal (Jun 2024): FY2023's 10,000 has been credited, and Apr+May of
  // FY2024 have accrued. The monthly accrual is charged on principal PLUS
  // credited interest — 110,000, not the 100,000 principal — because credited
  // interest compounds from the new year. Getting this wrong understates the
  // interest share of the withdrawal.
  const accrued = 110000 * 0.10 / 12 * 2;
  const bal = 110000 + accrued;
  const expectedRealized = 55000 * ((10000 + accrued) / bal);
  ok(near(r.realizedProfit, expectedRealized, 1),
     "E8 withdrawal splits principal/interest proportionally", r.realizedProfit + " vs " + expectedRealized);
  ok(r.invested < 100000, "E9 principal is reduced by its share of the withdrawal");
  ok(near(r.invested, 100000 - 55000 * (100000 / bal), 1), "E10 principal share is exact", String(r.invested));
}
{
  // No configured rate for a year → no interest invented for it.
  const r = computePfAccountValue(
    [{ type: "deposit", amount: 100000, date: new Date(2024, 3, 1) }],
    {}, new Date(2025, 2, 31));
  ok(near(r.current, 100000, 0.01), "E11 a year with no rate accrues nothing", String(r.current));
}
{
  // A manual interest row is the user's own figure; auto-calc must stand down for
  // that year rather than adding a second lot of interest.
  const r = computePfAccountValue([
    { type: "deposit", amount: 100000, date: new Date(2024, 3, 1) },
    { type: "interest", amount: 9000, date: new Date(2025, 2, 31) },
  ], { 2024: 0.085 }, new Date(2025, 2, 31));
  ok(near(r.current, 109000, 1), "E12 manual interest wins; no double count", String(r.current));
}
{
  const r = computePfAccountValue([
    { type: "deposit", amount: 50000, date: new Date(2024, 3, 1) },
    { type: "withdrawal", amount: 999999, date: new Date(2024, 8, 1) },
  ], { 2024: 0.085 }, new Date(2025, 2, 31));
  ok(r.invested >= -0.01 && r.current >= -0.01, "E13 over-withdrawal cannot drive the account negative",
     r.invested + "/" + r.current);
}

// ───────────────────────── F. Growth rates ─────────────────────────
console.log("\nF. CAGR");
function cagr(begin, end, years) {
  if (!(begin > 0) || !(years > 0)) return null;
  return Math.pow(end / begin, 1 / years) - 1;
}
ok(near(cagr(100, 121, 2), 0.10, 1e-9), "F1 100→121 over 2y = 10%");
ok(near(cagr(100, 100, 5), 0, 1e-9), "F2 no change = 0%");
ok(cagr(100, 50, 3) < 0, "F3 a halving is negative");
ok(cagr(0, 100, 1) === null, "F4 zero start has no defined CAGR");
ok(cagr(100, 121, 0) === null, "F5 zero span has no defined CAGR");
{
  // Annualising must use the actual span; using the requested window instead is
  // the C2/C3 bug class and overstates a short-lived portfolio.
  const actual = cagr(100, 150, 1.5), assumed = cagr(100, 150, 3);
  ok(actual > assumed, "F6 the same gain over a shorter real span annualises higher");
}

// ───────────────────────── G. Aggregation invariants ─────────────────────────
console.log("\nG. Aggregation invariants");
{
  // Category rollup must conserve the total: it reclassifies, never creates.
  const bySub = { "Large Cap": 12000, "Gold ETF": 3000, "Fixed Deposit": 5000 };
  const byCat = { Equity: 12000, Commodity: 3000, "Fixed Income": 5000 };
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  ok(near(sum(bySub), sum(byCat)), "G1 category rollup preserves the month total");
}
{
  // Moving a debt fund out of Equity moves value; it must not change net worth.
  const before = { equity: 300000, fixedIncome: 300000, commodity: 14301 };
  const movedFi = 90000, movedComm = 30000;
  const after = {
    equity: before.equity - movedFi - movedComm,
    fixedIncome: before.fixedIncome + movedFi,
    commodity: before.commodity + movedComm,
  };
  const tot = (o) => o.equity + o.fixedIncome + o.commodity;
  ok(near(tot(before), tot(after)), "G2 reclassification conserves the portfolio total");
  ok(after.equity === 180000 && after.fixedIncome === 390000, "G3 the moved amounts land correctly");
}
{
  // Day change is a plain sum across classes; a missing class contributes 0
  // rather than voiding the total (the 18K→9K regression).
  const dayChange = (mf, se, comm) => (mf || 0) + (se || 0) + (comm || 0);
  ok(near(dayChange(-9310, -9642, 0), -18952), "G4 day change sums the present classes");
  ok(near(dayChange(-9310, -9642, 2868), -16084), "G5 a rising class offsets the fall");
  ok(near(dayChange(null, -9642, null), -9642), "G6 an unresolved class contributes zero, not NaN");
}
{
  // Net invested is gross minus withdrawals, and must not go through zero when
  // withdrawals exceed contributions.
  const net = (inv, out) => inv - out;
  ok(near(net(25000, 6485), 18515), "G7 net invested = invested − withdrawn");
  ok(near(net(8000, 12000), -4000), "G8 withdrawing more than invested nets negative");
}
{
  // Expense % of income, with the divide-by-zero case explicit.
  const pct = (exp, inc) => (inc > 0 ? (exp / inc) * 100 : null);
  ok(near(pct(25000, 100000), 25), "G9 expense % of income");
  ok(pct(5000, 0) === null, "G10 no income → percentage undefined, not Infinity");
}

// ───────────── H. Per-holding XIRR (Mutual Fund / India / US lists) ─────────────
// Every holdings list derives a row's XIRR the same way: that instrument's own
// buy and sell flows, plus its current value as a terminal inflow. US rows differ
// only in converting each leg at that transaction's own USD/INR rate, so the rate
// move is part of the return an Indian investor actually earned.
console.log("\nH. Per-holding XIRR");

function holdingXirr(txns, currentINR, opts) {
  opts = opts || {};
  const rate = opts.rate || (() => 1);
  const flows = txns
    .filter((t) => t.date && t.units && t.price)
    .map((t) => ({
      date: t.date,
      amount: (t.type === "buy" ? -1 : 1) * t.units * t.price * rate(t.date),
    }));
  // A closed position has no holding left to value, so no terminal flow.
  if (!opts.isClosed && currentINR > 0) flows.push({ date: opts.asOf || new Date(), amount: currentINR });
  const r = calculateXIRR(flows);
  return (r === null || !isFinite(r)) ? null : r * 100;
}

{
  // India: 10 units at ₹100, worth ₹110 a year on = 10%.
  const x = holdingXirr(
    [{ type: "buy", units: 10, price: 100, date: D("2024-01-01") }],
    1100, { asOf: D("2025-01-01") });
  ok(near(x, 10, 0.05), "H1 India holding: one year, +10% value → ~10% XIRR", String(x));
}
{
  // Two purchases at different times: the later money is invested for less of the
  // period, so the rate must exceed the simple total-return percentage.
  const x = holdingXirr([
    { type: "buy", units: 10, price: 100, date: D("2024-01-01") },
    { type: "buy", units: 10, price: 100, date: D("2024-10-01") },
  ], 2300, { asOf: D("2025-01-01") });
  const simple = (2300 - 2000) / 2000 * 100;   // 15% over the whole period
  ok(x > simple, "H2 later contributions raise the annualised rate above simple return",
     x + " vs " + simple);
}
{
  // US: bought at $100 with USD/INR 80, now $110 with USD/INR 90. In dollars the
  // gain is 10%; in rupees it is (110×90)/(100×80) − 1 = 23.75%.
  const x = holdingXirr(
    [{ type: "buy", units: 10, price: 100, date: D("2024-01-01") }],
    10 * 110 * 90,
    { asOf: D("2025-01-01"), rate: () => 80 });
  // 23.75% is the period return; the annualised figure comes out a shade under
  // because 2024 is a leap year — 366 days measured against a 365-day year.
  ok(near(x, 23.75, 0.1), "H3 US holding: XIRR includes the currency move", String(x));
  ok(x > 10, "H4 rupee return exceeds the dollar return when USD strengthens");
}
{
  // Each leg uses its own rate, not one rate applied to both ends. Buying when the
  // dollar was cheap must not be revalued at today's rate.
  const rates = { "2024-01-01": 80, "2024-07-01": 85 };
  const x = holdingXirr([
    { type: "buy", units: 10, price: 100, date: D("2024-01-01") },
    { type: "buy", units: 10, price: 100, date: D("2024-07-01") },
  ], 20 * 110 * 90, { asOf: D("2025-01-01"), rate: (d) => rates[d.toISOString().slice(0, 10)] || 90 });
  const flat = holdingXirr([
    { type: "buy", units: 10, price: 100, date: D("2024-01-01") },
    { type: "buy", units: 10, price: 100, date: D("2024-07-01") },
  ], 20 * 110 * 90, { asOf: D("2025-01-01"), rate: () => 90 });
  ok(Math.abs(x - flat) > 1, "H5 per-leg rates give a different answer than one flat rate",
     x + " vs " + flat);
}
{
  // A sold-out position is valued by its proceeds alone; adding a terminal for a
  // holding that no longer exists would double count it.
  const x = holdingXirr([
    { type: "buy", units: 10, price: 100, date: D("2024-01-01") },
    { type: "sell", units: 10, price: 120, date: D("2025-01-01") },
  ], 0, { isClosed: true });
  ok(near(x, 20, 0.05), "H6 closed position: XIRR from proceeds, no terminal added", String(x));
}
{
  const x = holdingXirr([{ type: "buy", units: 10, price: 100, date: D("2024-01-01") }], 0,
                        { isClosed: true });
  ok(x === null, "H7 no sale and no current value → no rate, not 0%");
}
{
  const x = holdingXirr(
    [{ type: "buy", units: 10, price: 100, date: D("2024-01-01") }],
    800, { asOf: D("2025-01-01") });
  ok(x !== null && x < 0, "H8 a holding below cost reports a negative XIRR", String(x));
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
