// Deposits and physical gold belong in the TWR NAV series that feeds Portfolio
// CAGR and Rolling Returns.
//
// The series was built from instruments with a quoted price: Mutual Fund rows
// that resolve to an AMFI scheme code, and Stocks/ETF rows that resolve to a
// ticker. Fixed deposits, PF/EPF and physical gold — the whole `fd` sheet — were
// left out, on the grounds that they have no NAV history to chain returns from.
//
// That was harmless while the Benchmark card was equity-only. Under "Exclude
// Equity" it is not. The scope is then Fixed Income + Commodity, and what is
// dropped is precisely its steady majority; what survives is the gold and debt
// FUND sleeve. The card annualised that sleeve and called it the portfolio:
// a book reporting +7.20% XIRR showed a +44.59% Portfolio CAGR beside it.
//
// Part 1 works the distortion out on a fixture with the real TWR recurrence.
// Part 2 pins the wiring in script.js.

"use strict";
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  (got " + extra + ")" : "")); }
}
const near = (a, b, eps) => Math.abs(a - b) < (eps === undefined ? 0.0005 : eps);

// The recurrence script.js uses: each interval's growth is the ending value with
// that interval's own contribution taken back out, chained.
function chain(values, flows) {
  const nav = [100];
  for (let i = 1; i < values.length; i++) {
    const g = (values[i] - (flows[i] || 0)) / values[i - 1];
    nav.push(nav[i - 1] * g);
  }
  return nav;
}
const MONTHS = 20;
const YEARS = MONTHS / 12;
function cagrOf(values, flows) {
  const nav = chain(values, flows);
  return Math.pow(nav[nav.length - 1] / nav[0], 1 / YEARS) - 1;
}

// A term deposit accrues at its own rate, compounded quarterly — the same
// accrual fdMaturityValue applies, which is what the leg values it with.
const FD_RATE = 0.075;
const FD_EFFECTIVE = Math.pow(1 + FD_RATE / 4, 4) - 1; // 7.714%/yr
const fdValue = (principal, months) => principal * Math.pow(1 + FD_RATE / 4, months / 3);
// The gold/debt fund sleeve, on the run that produced the reported figure.
const GOLD_RATE = 0.4459;
const goldValue = (amount, months) => amount * Math.pow(1 + GOLD_RATE, months / 12);

const idx = Array.from({ length: MONTHS + 1 }, (_, i) => i);

console.log("A. Each leg alone reads as itself");
{
  const deposits = idx.map(m => fdValue(3600000, m));
  const gold = idx.map(m => goldValue(400000, m));
  ok(near(cagrOf(deposits, []), FD_EFFECTIVE),
     "A1 a deposit book compounds at its own rate, 7.71%/yr", cagrOf(deposits, []));
  ok(near(cagrOf(gold, []), GOLD_RATE),
     "A2 the gold sleeve alone reads 44.59%/yr — the number on the card", cagrOf(gold, []));
}

console.log("\nB. Dropping the deposits IS the distortion");
{
  // One portfolio: Rs36L of deposits, Rs4L of gold fund. Ninety percent of the
  // money is the part the series could not see.
  const deposits = idx.map(m => fdValue(3600000, m));
  const gold = idx.map(m => goldValue(400000, m));
  const whole = idx.map(m => deposits[m] + gold[m]);

  const shown = cagrOf(gold, []);      // what the card computed: gold sleeve only
  const truth = cagrOf(whole, []);     // what it should have computed

  ok(truth > FD_EFFECTIVE && truth < GOLD_RATE,
     "B1 the real CAGR sits between the two legs it is made of", truth);
  ok(truth < 0.12,
     "B2 and lands near the 7-8% a fixed-income book is expected to show", truth);
  ok(shown - truth > 0.30,
     "B3 the omission inflated it by more than 30 percentage points", shown - truth);
  // The error scales with how much of the book is unpriced, which is why it was
  // invisible on an equity portfolio and enormous on this one.
  const halfHalf = cagrOf(idx.map(m => fdValue(2000000, m) + goldValue(2000000, m)), []);
  ok(halfHalf > truth,
     "B4 it shrinks as the priced sleeve grows — hence never seen on equity", halfHalf);
}

console.log("\nC. Contributions must not move the CAGR (the flowIn sign convention)");
{
  // A new deposit part-way through is money added, not return. If flowIn's sign
  // were inverted the contribution would be ADDED to the gain instead of removed,
  // and a portfolio that merely received money would look like it earned it.
  const START = 3600000, ADDED = 2000000, AT = 8;
  const values = idx.map(m => fdValue(START, m) + (m >= AT ? fdValue(ADDED, m - AT) : 0));
  const flows = idx.map(m => (m === AT ? ADDED : 0));

  const withFlow = cagrOf(values, flows);
  ok(near(withFlow, FD_EFFECTIVE),
     "C1 netting the contribution out leaves the deposit rate untouched", withFlow);

  const ignored = cagrOf(values, []);
  ok(ignored - FD_EFFECTIVE > 0.20,
     "C2 not netting it out reads the deposit as a >20-point windfall", ignored - FD_EFFECTIVE);

  const inverted = cagrOf(values, flows.map(f => -f));
  ok(inverted - FD_EFFECTIVE > 0.40,
     "C3 and inverting the sign is worse still — the case the convention guards",
     inverted - FD_EFFECTIVE);
}

console.log("\nD. A withdrawal is the mirror image");
{
  // An FD matures: its value leaves the book and the proceeds are a cash flow.
  // Removing money must not read as a loss.
  const A = 3600000, MATURES = 1200000, AT = 10;
  const values = idx.map(m => fdValue(A, m) + (m < AT ? fdValue(MATURES, m) : 0));
  const flows = idx.map(m => (m === AT ? -fdValue(MATURES, AT) : 0));
  ok(near(cagrOf(values, flows), FD_EFFECTIVE),
     "D1 a maturing deposit leaves the CAGR at the deposit rate", cagrOf(values, flows));
}

// ---------------------------------------------------------------------------
console.log("\nE. script.js builds the leg from the accruals it already trusts");
{
  ok(/function buildUnpricedTwrLeg\(selected\)/.test(SRC),
     "E1 there is one builder for the deposit + physical-gold leg");
  const f = SRC.slice(SRC.indexOf("function buildUnpricedTwrLeg"));
  const body = f.slice(0, f.indexOf("\n  }\n\n  function computePortfolioTwrNavSeries"));

  ok(/if \(isFixedIncomeExcluded\(\)\) return null;/.test(body),
     "E2 it leaves entirely when Fixed Income and Commodity are excluded");
  ok(/fdMaturityValue\(x\.principal, x\.buy, date, x\.rate\)/.test(body),
     "E3 term deposits accrue with the same helper their maturity proceeds use");
  ok(/buildFdValueEvents\(selected, true\)/.test(body),
     "E4 PF/EPF is valued from its own contribution + interest timeline");
  ok(/buildFdMaturedXirrCashFlows\(fdRows, selected\)/.test(body) &&
     /buildProvidentFundXirrCashFlows\(fdRows, selected\)/.test(body),
     "E5 the flows are the existing builders, which keep credited interest out");
  ok(/_fiIsTermDeposit/.test(body),
     "E6 Savings Account / Investment Corpus stay out — a balance, not an investment");
  ok(/fetchXauInrForDate/.test(body) && /_terminal/.test(body),
     "E7 physical gold is priced per sample date, with its own terminal stripped");
  // Value and flows have to enter and leave together, or a contribution outlives
  // its valuation and reads as money that vanished.
  ok(/if \(!carry\) return;/.test(body),
     "E8 if no gold price resolves, gold leaves BOTH the value and the flows");
  ok(/net \+= -f\.amount/.test(body),
     "E9 XIRR's sign convention is inverted once, in one place");
}

console.log("\nF. Both series builders use it");
{
  // computeRollingReturns delegates its series build to _rollingNavSeries, so the
  // series itself is built once per portfolio and reused by every window/index.
  ["computePortfolioTwrNavSeries", "_rollingNavSeries"].forEach(function (fnName, i) {
    const from = SRC.indexOf("function " + fnName);
    const body = SRC.slice(from, from + 9000);
    const n = i + 1;
    ok(/var leg = buildUnpricedTwrLeg\(selected\);/.test(body),
       "F" + n + "a " + fnName + " builds the leg");
    ok(/if \(leg && leg\.firstDate && \(!firstDate \|\| leg\.firstDate < firstDate\)\) firstDate = leg\.firstDate;/.test(body),
       "F" + n + "b it can set the window on its own — a deposit-only book has a history too");
    ok(/if \(leg\) total \+= leg\.valueAt\(date\);/.test(body),
       "F" + n + "c its value is in every sample");
    ok(/if \(leg\) netFlow \+= leg\.flowIn\(prevPt\.date, curPt\.date\);/.test(body),
       "F" + n + "d and its flows are netted out of every interval");
    ok(/\(leg \? leg\.prime\(samples\) : Promise\.resolve\(\)\)\.then/.test(body),
       "F" + n + "e the dated gold prices are awaited before the samples are valued");
  });
}

console.log("\nG. The card names the window it actually measured");
{
  // computeAlignedCagr falls back to the portfolio's own life when it is younger
  // than the selected period, so a "3Y" pill produced a 1.6-year window and
  // annualised it without saying so.
  ok(/years: actualYears/.test(SRC),
     "G1 computeAlignedCagr reports the window it used");
  ok(/actualYears < reqYears \* 0\.95/.test(SRC) &&
     /the portfolio's full history, shorter than the/.test(SRC),
     "G2 and the subtitle says so whenever it is shorter than the pill");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
