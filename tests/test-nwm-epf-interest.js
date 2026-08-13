// EPF interest belongs in the Interest column, not the market residual.
//
// "What moved this month" explains a month by naming Invested, Withdrawn,
// Interest and Idle Cash, then books the leftover as Market:
//
//     market = (close − open) − contributions − interest − idle
//
// so anything that raises value without being NAMED becomes a market gain.
//
// The Provident Fund (EPF) sheet is a second source of fixed-income interest and
// the Interest column only ever read the first:
//
//   • buildEpfValueEvents accumulates that sheet's Deposit AND Interest rows,
//     and its series is what the stored snapshot's fixed_income holds — so an
//     interest credit RAISES close − open;
//   • buildMonthlyInvestCatData counts only its Deposit rows as contributions,
//     which is correct — interest is not a contribution;
//   • _nwmInterestByMonth opened getSheetRows("fd") and nothing else.
//
// Nothing named it, so the residual absorbed it. EPF credits at the financial
// year end, so Fixed Income showed a "market gain" every March — of roughly a
// year's interest, in an asset class with no market to speak of.
//
// The property that matters, and the one that makes the fix trustworthy rather
// than merely plausible: it attributes EXACTLY the interest the sheet records.
// Nothing is rated or inferred, so no month can be credited with more interest
// than was booked, and the whole history sums to precisely the gain the Fixed
// Income holdings table shows.
//
//     node tests/test-nwm-epf-interest.js
//
// (no "use strict" — eval must leak the extracted declarations into this scope)

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
eval(fs.readFileSync(path.join(ROOT, "wf-snapshots.js"), "utf8"));
const WfSnapshots = globalThis.WfSnapshots;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  (got " + JSON.stringify(extra) + ")" : "")); }
}

console.log("A. The residual formula is what makes an unnamed rise look like market");
{
  // Straight from wf-snapshots.categoryChange, on a month where the ONLY change
  // is a 100000 interest credit.
  const res = WfSnapshots.categoryChange(
    { month: "2026-03", equity: 0, fixed_income: 1100000, commodity: 0, market: 0 },
    { month: "2026-02", equity: 0, fixed_income: 1000000, commodity: 0 },
    {}, 0, 0);
  const fi = res.rows.find((r) => r.category === "Fixed Income");
  ok(fi && fi.market === 100000,
     "A1 unnamed, the whole credit is booked as market", fi && fi.market);

  const named = WfSnapshots.categoryChange(
    { month: "2026-03", equity: 0, fixed_income: 1100000, commodity: 0, market: 0 },
    { month: "2026-02", equity: 0, fixed_income: 1000000, commodity: 0 },
    {}, 100000, 0);
  const fiNamed = named.rows.find((r) => r.category === "Fixed Income");
  ok(fiNamed && fiNamed.interest === 100000 && fiNamed.market === 0,
     "A2 named as interest, market falls to zero and the total is unchanged",
     fiNamed && [fiNamed.interest, fiNamed.market]);
  ok(fiNamed && (fiNamed.closing - fiNamed.opening) === 100000,
     "A3 either way the category's own change is the same — this is a labelling fault, not a valuation one");
}

console.log("\nB. script.js now reads BOTH fixed-income sheets for interest");
{
  const from = SRC.indexOf("function _nwmInterestByMonth(fromMonth, portfolio)");
  ok(from !== -1, "B1 _nwmInterestByMonth is the Interest column's source");
  const body = SRC.slice(from, SRC.indexOf("\n  // ── Drill-down", from));

  ok(/getSheetRows\("fd"\)/.test(body), "B2 it still reads the FD/PF sheet");
  ok(/getSheetRows\("fixedincome"\)/.test(body),
     "B3 and now the standalone Provident Fund (EPF) sheet too");
  ok(/if \(!haveFd && !haveEpf\) return out;/.test(body),
     "B4 an EPF-only portfolio is no longer dismissed for having no FD sheet");
  ok(/epfInterestTo\(d, m\);/.test(body),
     "B5 its interest joins the same per-holding valuation the others use");

  // The category gate has to match buildEpfValueEvents, or the two disagree about
  // which rows are fixed income at all — and the residual reappears for the gap.
  ok(/normalizeText\(row\[epfIdx\.category\]\) !== "fixed income"/.test(body),
     "B6 gated on the same category as the series that feeds the snapshot");

  // Deposits open the key so accruedBetween can difference the first credit.
  ok(/if \(!\(k in into\)\) into\[k\] = 0;/.test(body),
     "B7 a deposit opens the holding's key without adding interest");
  ok(/if \(isInterest\) into\[k\] \+= parseNumber/.test(body),
     "B8 only interest rows add to it");
}

console.log("\nC. accruedBetween is why B7 is load-bearing");
{
  // Only keys present in BOTH valuations are differenced. A holding whose key
  // first appears in the month its interest lands is skipped entirely — and every
  // later credit is then measured from the wrong base.
  const first = WfSnapshots.accruedBetween({}, { "epf|s||provident fund": 50000 });
  ok(first === 0,
     "C1 a key that appears for the first time contributes nothing", first);
  const seeded = WfSnapshots.accruedBetween({ "epf|s||provident fund": 0 },
                                            { "epf|s||provident fund": 50000 });
  ok(seeded === 50000,
     "C2 seeded at zero by the deposit, the same credit is counted in full", seeded);
}

console.log("\nD. It can never attribute more interest than the sheet records");
{
  const from = SRC.indexOf("function epfInterestTo(d, into)");
  const body = SRC.slice(from, SRC.indexOf("\n    }", from));
  // Interest is READ, never derived: no rate, no compounding, no elapsed-time
  // term. Whatever the sheet says was credited is exactly what is attributed, so
  // the whole history sums to the gain the holdings table already shows.
  ok(!/getEpfRateMap|computePfAccountValue|Math\.pow|elapsedQuarters/.test(body),
     "D1 no rate or accrual engine — the booked amounts are taken as given");
  ok(/dt > d/.test(body),
     "D2 and only credits dated on or before the valuation date count");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
