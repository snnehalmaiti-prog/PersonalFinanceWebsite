// Every XIRR terminal must be marked in the SAME scope as the cash flows it closes.
//
// The by-category reclassification splits debt funds and gold funds out of the
// Mutual Fund and Stocks/ETF slices so an exclusion named for Fixed Income or
// Commodity can reach a holding typed into either sheet. The cash-flow builders
// were never split with them: buildXirrCashFlows and buildSeInrFlows read the
// sheets and never look at Instrument Category, so a debt fund's purchase is a
// flow like any other.
//
// So a terminal taken from the post-split slice pays back only part of what the
// flows bought. The money put into debt and gold funds goes out and never comes
// back, and every XIRR built on those flows — Mutual Fund, Stocks/ETF, Overview,
// and the Benchmark Comparison's portfolio side, at ALL and at every period —
// reads as a loss that never happened. It grows with that allocation and with
// time, and it moves ONLY the portfolio side: the index replays the same rupees,
// so the whole error lands in the alpha.
//
// Part 1 measures the distortion on a fixture with the real solver.
// Part 2 pins the wiring in script.js, which is where the two scopes met.

"use strict";
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
require("../wf-math.js");
const { calculateXIRR } = global.WfMath || globalThis.WfMath;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  (got " + extra + ")" : "")); }
}
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 0.005 : eps);

// ---------------------------------------------------------------------------
console.log("A. A portfolio that is half debt fund, marked at the equity slice only");
{
  // Three years ago: Rs1,00,000 into an equity fund, Rs1,00,000 into a debt fund.
  // Today the equity fund is worth Rs1,50,000 and the debt fund Rs1,20,000.
  // Nothing was sold. The true return is (2,70,000 / 2,00,000) over 3 years.
  const t0 = new Date("2022-08-13T00:00:00Z");
  const now = new Date("2025-08-13T00:00:00Z");
  const flows = [
    { date: t0, amount: -100000 },   // equity fund buy
    { date: t0, amount: -100000 },   // debt fund buy  — same builder, same sheet
  ];
  const mfEquityCurrent = 150000;   // _ovSlice.mf.current   (post-split)
  const debtMfCurrent = 120000;     // _ovSlice.debtMf.current
  const commMfCurrent = 0;

  const whole = calculateXIRR(flows.concat([{ date: now, amount: mfEquityCurrent + debtMfCurrent + commMfCurrent }]));
  const split = calculateXIRR(flows.concat([{ date: now, amount: mfEquityCurrent }]));

  ok(near(whole, Math.pow(270000 / 200000, 1 / 3) - 1, 0.002),
     "A1 marked whole, the XIRR is the portfolio's real 10.6%/yr", whole);
  ok(split < 0, "A2 marked at the equity slice alone it is NEGATIVE", split);
  ok(near(split, Math.pow(150000 / 200000, 1 / 3) - 1, 0.002),
     "A3 because it pays back Rs1,50,000 against Rs2,00,000 invested", split);
  ok(whole - split > 0.19,
     "A4 a 19-percentage-point hole, from one holding being reclassified", whole - split);
}

// ---------------------------------------------------------------------------
console.log("\nB. The hole widens with the debt/gold allocation");
{
  const t0 = new Date("2023-08-13T00:00:00Z"), now = new Date("2025-08-13T00:00:00Z");
  function gap(debtShare) {
    const eq = 100000 * (1 - debtShare), dbt = 100000 * debtShare;
    const flows = [{ date: t0, amount: -eq }, { date: t0, amount: -dbt }];
    const whole = calculateXIRR(flows.concat([{ date: now, amount: eq * 1.3 + dbt * 1.15 }]));
    const split = calculateXIRR(flows.concat([{ date: now, amount: eq * 1.3 }]));
    return whole - split;
  }
  ok(near(gap(0), 0, 1e-6), "B1 no debt holding, no distortion", gap(0));
  ok(gap(0.25) > 0.1, "B2 a quarter in debt already costs over 10 points", gap(0.25));
  ok(gap(0.5) > gap(0.25), "B3 and it grows with the allocation", gap(0.5));
  ok(gap(0.75) > gap(0.5), "B4 monotonically", gap(0.75));
}

// ---------------------------------------------------------------------------
console.log("\nC. It lands entirely in the alpha, because the index side is unaffected");
{
  // The benchmark replays the portfolio's OWN signed flows on the index, so the
  // index leg never sees the terminal at all. Whatever the portfolio side loses
  // to a mis-scoped terminal is subtracted from alpha, one for one.
  const t0 = new Date("2023-08-13T00:00:00Z"), now = new Date("2025-08-13T00:00:00Z");
  const flows = [{ date: t0, amount: -100000 }, { date: t0, amount: -100000 }];
  const indexXirr = 0.0059; // the index leg, unchanged either way
  const whole = calculateXIRR(flows.concat([{ date: now, amount: 130000 + 115000 }]));
  const split = calculateXIRR(flows.concat([{ date: now, amount: 130000 }]));
  ok(whole - indexXirr > 0, "C1 marked whole the portfolio beat the index", whole - indexXirr);
  ok(split - indexXirr < 0, "C2 marked split it 'lost' to it", split - indexXirr);
  ok(near((whole - indexXirr) - (split - indexXirr), whole - split, 1e-9),
     "C3 the alpha error is exactly the terminal error");
}

// ---------------------------------------------------------------------------
console.log("\nD. script.js marks the Mutual Fund terminal whole");
{
  ok(/var mfXirrTerminal = total \+ debtCurrent \+ commVal\.current;/.test(SRC),
     "D1 the MF terminal adds the debt and commodity funds back");
  ok(/if \(mfXirrTerminal > UNITS_EPSILON\) xirrCashFlows\.push\(\{ date: new Date\(\), amount: mfXirrTerminal \}\);/.test(SRC),
     "D2 and it is that value the flows are closed with");
  ok(!/xirrCashFlows\.push\(\{ date: new Date\(\), amount: total \}\)/.test(SRC),
     "D3 the equity-slice-only terminal is gone, not left beside it");
}

console.log("\nE. ...and the Stocks/ETF terminal too");
{
  ok(/var seXirrTerminal = totalCurrentINR \+ dbtCurrentINR \+ cmdCurrentINR;/.test(SRC),
     "E1 the SE terminal adds the bond and gold ETFs back");
  ok(/if \(seXirrTerminal > UNITS_EPSILON\) seXirrFlowsWithTerminal\.push/.test(SRC),
     "E2 and closes the SE flows with it");
  ok(!/seXirrFlowsWithTerminal\.push\(\{ date: new Date\(\), amount: totalCurrentINR \}\)/.test(SRC),
     "E3 the split terminal is gone");
}

console.log("\nF. The benchmark card reads the whole-sheet value, not the slice");
{
  ok(/function _ovMfAllCurrent\(\) \{ return _ovSlice\.mf\.current \+ _ovSlice\.debtMf\.current \+ _ovSlice\.commMf\.current; \}/.test(SRC),
     "F1 there is one helper for the whole-sheet MF value");
  ok(/function _ovSeAllCurrent\(\) \{ return _ovSlice\.se\.current \+ _ovSlice\.debtSe\.current \+ _ovSlice\.commSe\.current; \}/.test(SRC),
     "F2 and one for Stocks/ETF");
  // The benchmark card's own terminals moved from "whole sheet" to "whole sheet
  // MINUS whatever the exclusion in force hides" — the same rule, applied to the
  // portfolio actually on screen (see section H). Whole-sheet is still what these
  // helpers return when no exclusion is on, which is the case F1/F2 pin.
  ok(/var periodCurrentVal = _ovScopedMfCurrent\(\) \+ result\.seCurrentIncluded;/.test(SRC),
     "F3 the PERIOD portfolio XIRR (1Y/2Y/3Y/5Y/10Y) marks the MF sheet in the scope on screen");
  ok(/function _ovScopedMfCurrent\(\) \{\s*return \(isEquityExcluded\(\) \? 0 : _ovSlice\.mf\.current\) \+\s*\(isFixedIncomeExcluded\(\) \? 0 : _ovSlice\.debtMf\.current \+ _ovSlice\.commMf\.current\);/.test(SRC),
     "F4 and that scope is the whole sheet whenever no exclusion is on");
  ok(/var currentVal = scopedReturnTerminal\(\);/.test(SRC) &&
     /function scopedReturnTerminal\(\)[\s\S]{0,200}_ovAggregate\(\)\.current/.test(SRC),
     "F5 the all-time terminal is the Overview's own current value, so both sides agree");

  // The opening mark is the other half of the pair: computePortfolioValueAtDate
  // prices every held instrument, so a terminal that dropped a class made the
  // period window open richer than it closed — which is the shape of the bug
  // reported from the dashboard (2Y XIRR deeply negative, 2Y rolling +23%).
  const fn = SRC.slice(SRC.indexOf("function computePortfolioValueAtDate"));
  const body = fn.slice(0, fn.indexOf("\n  // Compute rolling CAGR"));
  ok(!/instrument category|_isDebtName|_isCommName/i.test(body),
     "F6 the opening mark prices every instrument, debt and gold included — the terminal must match it");
}

console.log("\nG. No terminal is left reading a split slice directly");
{
  // Any future call site that wants a current value for an XIRR terminal has to
  // go through the helpers; reading _ovSlice.mf.current for that purpose is the
  // exact mistake this suite exists to stop.
  // _ovScopedMfCurrent is a helper too, so its own body is not a call site —
  // remove it before looking, rather than loosening the pattern.
  const scopedHelper = SRC.slice(SRC.indexOf("function _ovScopedMfCurrent()"));
  const withoutScopedHelper = SRC.replace(scopedHelper.slice(0, scopedHelper.indexOf("\n  }") + 4), "");
  const direct = withoutScopedHelper.split("\n").filter(function (l) {
    return /_ovSlice\.(mf|se)\.current/.test(l) && !/function _ov(Mf|Se)AllCurrent/.test(l);
  });
  ok(direct.length === 0, "G1 the split slices are read only inside the helpers", direct.join(" | "));
}

// ---------------------------------------------------------------------------
console.log("\nH. Scope is the exclusion on screen, not just the whole sheet");
{
  // The same "flows and terminal must cover the same holdings" rule, one level up.
  // With Exclude Equity on, the Overview header dropped equity while the Benchmark
  // Comparison card kept valuing the whole equity book — a Portfolio CAGR/XIRR and
  // an alpha for a portfolio that was not the one being shown. Both sides of the
  // card now read the scope from Instrument Category, the way the aggregator does.
  ok(/function returnScopeIncludesInstrument\(name\)/.test(SRC),
     "H1 there is one gate deciding whether an instrument is in scope");
  const gate = SRC.slice(SRC.indexOf("function returnScopeIncludesInstrument"));
  const gateBody = gate.slice(0, gate.indexOf("\n  }"));
  ok(/buildInstrumentTopCategoryMap\(\)/.test(gateBody) &&
     /"fixed income" \|\| cat === "commodity"/.test(gateBody) &&
     /isFixedIncomeExcluded\(\)/.test(gateBody) && /isEquityExcluded\(\)/.test(gateBody),
     "H2 it gates by Instrument Category, honouring both exclusions");

  const flows = SRC.slice(SRC.indexOf("function buildScopedReturnFlows"));
  const flowsBody = flows.slice(0, flows.indexOf("\n  }"));
  ok((flowsBody.match(/returnScopeIncludesInstrument/g) || []).length >= 3,
     "H3 the benchmark's flows are gated on both sheet legs, INR flows included");
  ok(/isFixedIncomeExcluded\(\)/.test(flowsBody),
     "H4 and fixed income/commodity flows leave with their own exclusion");

  // The CAGR and Rolling Return columns are built from the TWR NAV series, not from
  // cash flows — they need the same gate or the card disagrees with itself.
  ["computePortfolioTwrNavSeries", "computeRollingReturns"].forEach(function (fnName, i) {
    const f = SRC.slice(SRC.indexOf("function " + fnName));
    const body = f.slice(0, 4000);
    ok((body.match(/returnScopeIncludesInstrument/g) || []).length >= 2,
       "H" + (5 + i) + " " + fnName + " is scoped on both the MF and Stocks/ETF legs");
  });
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
