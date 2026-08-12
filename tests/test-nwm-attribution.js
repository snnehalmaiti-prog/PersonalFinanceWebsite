// Splitting a month's market movement across sub-categories.
//
// NET WORTH · MONTHLY charts market movement as a residual — the part of a
// month's change left unexplained after contributions, interest and idle cash.
// A residual has no parts, so the drill-down rebuilds them from the other
// direction, per sub-category:
//
//     market = (value now − value a month ago) − contributions − interest
//
// The two numbers come from different sources: the residual from recorded
// snapshots, this from today's sheets and price history. They will not always
// agree. The property these tests defend is that the disagreement is REPORTED
// and never absorbed — a breakdown that always adds up exactly is the one to
// distrust, because it means the gap was hidden rather than closed.
//
//     node tests/test-nwm-attribution.js
"use strict";

const fs = require("fs");
const path = require("path");
eval(fs.readFileSync(path.join(__dirname, "..", "wf-math.js"), "utf8"));
const attribute = globalThis.WfMath.attributeMarketBySubCategory;

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const eq = (a, b, name, detail) => ok(a === b, name, detail !== undefined ? detail : { got: a, want: b });
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.011 : tol);
const rowFor = (r, sub) => (r.rows.filter((x) => x.subCategory === sub)[0] || null);

console.log("A. A month that only moved on price");
{
  // Nothing bought, nothing sold, no interest: the whole change is market.
  const V = { "2026-06": { "Flexi Cap": 100000, "Large Cap": 50000 },
              "2026-07": { "Flexi Cap": 110000, "Large Cap": 45000 } };
  const r = attribute("2026-07", "2026-06", V, {}, {}, 5000);
  eq(r.rows.length, 2, "A1 both sub-categories reported", r.rows);
  eq(rowFor(r, "Flexi Cap").market, 10000, "A2 the riser's gain is its whole change");
  eq(rowFor(r, "Large Cap").market, -5000, "A3 and the faller's loss is its own");
  eq(r.attributed, 5000, "A4 which together are the month's movement");
  eq(r.unattributed, 0, "A5 leaving nothing unexplained");
  eq(r.rows[0].subCategory, "Flexi Cap",
     "A6 biggest mover first — the reader is asking what did this", r.rows.map((x) => x.subCategory));
}

console.log("\nB. Money in is not a gain");
{
  // ₹20,000 bought during the month. Value rose ₹25,000, so only ₹5,000 is market.
  const V = { "2026-06": { "Flexi Cap": 100000 }, "2026-07": { "Flexi Cap": 125000 } };
  const C = { "2026-07": { "Flexi Cap": 20000 } };
  const r = attribute("2026-07", "2026-06", V, C, {}, 5000);
  eq(rowFor(r, "Flexi Cap").market, 5000,
     "B1 the contribution is taken out before the rest is called market");
  eq(rowFor(r, "Flexi Cap").contributions, 20000, "B2 and is reported alongside it");
  eq(r.unattributed, 0, "B3 reconciling exactly");
}

console.log("\nC. Interest is not market");
{
  // A deposit that accrued ₹3,000 and did nothing else must show zero market.
  const V = { "2026-06": { "Fixed Deposit": 200000 }, "2026-07": { "Fixed Deposit": 203000 } };
  const I = { "2026-07": { "Fixed Deposit": 3000 } };
  const r = attribute("2026-07", "2026-06", V, {}, I, 0);
  eq(rowFor(r, "Fixed Deposit").market, 0,
     "C1 a deposit's growth is interest, not a market gain");
  eq(rowFor(r, "Fixed Deposit").interest, 3000, "C2 and is carried on the row");
  eq(r.attributed, 0, "C3 contributing nothing to the market total");
  // A row with interest but no market movement still has something to say.
  eq(r.rows.length, 1, "C4 and the row survives rather than being dropped as empty", r.rows);
}

console.log("\nD. A sub-category that did not exist last month");
{
  // Bought ₹30,000 of a new fund, worth ₹31,000 by month end. The ₹30,000 is
  // principal — only ₹1,000 is a gain. Excluding new keys would drop it; keeping
  // them without the contribution term would book ₹31,000 of imaginary profit.
  const V = { "2026-06": { "Flexi Cap": 100000 },
              "2026-07": { "Flexi Cap": 100000, "Small Cap": 31000 } };
  const C = { "2026-07": { "Small Cap": 30000 } };
  const r = attribute("2026-07", "2026-06", V, C, {}, 1000);
  eq(rowFor(r, "Small Cap").market, 1000,
     "D1 a first-month holding shows the gain, not the principal");
  eq(rowFor(r, "Small Cap").opening, 0, "D2 opening from nothing");
  ok(!rowFor(r, "Flexi Cap"),
     "D3 and a sub-category that did not move at all is left out", r.rows);
  eq(r.unattributed, 0, "D4 reconciling");
}

console.log("\nE. A sub-category sold to nothing");
{
  // Held ₹40,000, sold the lot for ₹43,000. Value → 0, contribution −43,000.
  // (0 − 40,000) − (−43,000) = +3,000 realised.
  const V = { "2026-06": { "Mid Cap": 40000 }, "2026-07": {} };
  const C = { "2026-07": { "Mid Cap": -43000 } };
  const r = attribute("2026-07", "2026-06", V, C, {}, 3000);
  eq(rowFor(r, "Mid Cap").market, 3000,
     "E1 selling out books the realised move, not a ₹40,000 collapse");
  eq(rowFor(r, "Mid Cap").closing, 0, "E2 closing at nothing");
  eq(r.unattributed, 0, "E3 reconciling");
}

console.log("\nF. The gap is reported, never absorbed");
{
  // The card's residual says −₹8,000; the parts only account for −₹5,000.
  // The ₹3,000 difference is the whole point of the row.
  const V = { "2026-06": { "Flexi Cap": 100000 }, "2026-07": { "Flexi Cap": 95000 } };
  const r = attribute("2026-07", "2026-06", V, {}, {}, -8000);
  eq(r.attributed, -5000, "F1 the parts add to what they add to");
  eq(r.total, -8000, "F2 the card's figure is carried through unchanged");
  eq(r.unattributed, -3000,
     "F3 and the difference is stated — spreading it across the rows would make " +
     "every row wrong to make the total look right");
  ok(near(r.attributed + r.unattributed, r.total),
     "F4 parts plus remainder is the total, by construction",
     { attributed: r.attributed, unattributed: r.unattributed, total: r.total });
}

console.log("\nG. No baseline to measure from");
{
  // The first month of history: with nothing to difference against, every
  // holding's whole value would read as a gain. Flagged so the caller can say so.
  const V = { "2026-07": { "Flexi Cap": 100000 } };
  const r = attribute("2026-07", null, V, {}, {}, 100000);
  eq(r.noBaseline, true, "G1 flagged when there is no previous valuation");
  const r2 = attribute("2026-07", "2026-06", { "2026-07": { "Flexi Cap": 1 } }, {}, {}, 1);
  eq(r2.noBaseline, true,
     "G2 and also when the previous month is named but has no valuation — a " +
     "month key that is merely absent is the same problem", r2);
  const r3 = attribute("2026-07", "2026-06",
    { "2026-06": { "Flexi Cap": 1 }, "2026-07": { "Flexi Cap": 2 } }, {}, {}, 1);
  eq(r3.noBaseline, false, "G3 but not when there is one");
}

console.log("\nH. Gaps in the series");
{
  // Snapshots can skip months. prevMonth is passed in rather than derived by
  // subtracting one, so a quarter-long gap differences against the month that
  // actually has a valuation instead of an empty one.
  const V = { "2026-03": { "Flexi Cap": 100000 }, "2026-07": { "Flexi Cap": 130000 } };
  const r = attribute("2026-07", "2026-03", V, {}, {}, 30000);
  eq(rowFor(r, "Flexi Cap").market, 30000,
     "H1 the whole gap's movement, measured from the month that has a valuation");
  eq(r.noBaseline, false, "H2 and that counts as a baseline");
}

console.log("\nI. Degenerate inputs");
{
  ok(attribute("2026-07", "2026-06", null, {}, {}, 0) === null,
     "I1 no valuations, no breakdown");
  ok(attribute("2026-07", "2026-06", { "2026-05": {} }, {}, {}, 0) === null,
     "I2 nor for a month that has none");
  const empty = attribute("2026-07", "2026-06", { "2026-06": {}, "2026-07": {} }, {}, {}, 0);
  eq(empty.rows.length, 0, "I3 an empty month reports no rows");
  eq(empty.attributed, 0, "I4 and attributes nothing");
  const noTotal = attribute("2026-07", "2026-06",
    { "2026-06": { A: 1 }, "2026-07": { A: 2 } }, {}, {}, null);
  eq(noTotal.unattributed, null,
     "I5 with no figure to reconcile against, the remainder is unknown rather " +
     "than zero — reporting 0 would claim agreement that was never checked");
  eq(noTotal.total, null, "I6 and the total stays null");
}

console.log("\nJ. Rounding");
{
  // Floating-point drift, not a market movement. Deliberately well under the
  // half-paisa threshold rather than sitting on it: a fixture landing exactly on
  // the boundary tests the tie-break, not the filter.
  const V = { "2026-06": { A: 100000.0001 }, "2026-07": { A: 100000.0009 } };
  const r = attribute("2026-07", "2026-06", V, {}, {}, 0);
  eq(r.rows.length, 0, "J1 sub-paisa noise does not earn a row", r.rows);
  // Just over the line is kept. Deliberately not a fixture sitting exactly ON
  // 0.005: that value is not representable in binary floating point (100.005 −
  // 100 comes out as 0.004999…), so such a test measures the format rather than
  // the filter.
  const justOver = attribute("2026-07", "2026-06",
    { "2026-06": { A: 100 }, "2026-07": { A: 100.02 } }, {}, {}, 0.02);
  eq(justOver.rows.length, 1, "J1b while a real paisa of movement is kept", justOver.rows);
  eq(rowFor(justOver, "A").market, 0.02, "J1c at its true size");
  const V2 = { "2026-06": { A: 100 }, "2026-07": { A: 100.126 } };
  const r2 = attribute("2026-07", "2026-06", V2, {}, {}, 0.13);
  eq(rowFor(r2, "A").market, 0.13, "J2 real paise are kept, rounded to two places");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
