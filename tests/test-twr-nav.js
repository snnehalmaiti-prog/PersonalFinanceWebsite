// Portfolio Performance (Growth of ₹100) — the time-weighted return series behind the chart.
//
// TWR answers "what would ₹100 left alone have become", so the timing and size of
// contributions must not touch it. The old recurrence carried a unit count and
// bought units at the PREVIOUS timeline point's NAV, which is only right when the
// value did not move between the two points. A purchase on a day the price jumped
// therefore bought units at a stale NAV and permanently diluted the line: a fund
// that doubled while being bought into read 133 instead of 200 — and looked like
// it had LOST to an index that rose half as much.
//
// The recurrence is now WfMath.twrNavSeries, chaining each period's return with
// that period's own cash flow removed from the ending value. These cases are
// worked out by hand, not by re-running the shipped formula.

require("../wf-math.js");
const T = globalThis.WfMath.twrNavSeries;

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const near = (a, b, eps) => a != null && Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

console.log("A. No cash flows — the series is just the value's own growth");
{
  // Cumulative contributions constant at 1000: one buy at the start, nothing after.
  const v = [1000, 1500, 2000, 1000];
  const c = [1000, 1000, 1000, 1000];
  const s = T(v, c);
  ok(s.baseIndex === 0, "A1 the base is the first point with value", s.baseIndex);
  ok(s.nav[0] === 100, "A2 it starts at 100");
  ok(near(s.nav[1], 150), "A3 +50% reads 150", s.nav[1]);
  ok(near(s.nav[2], 200), "A4 doubling reads 200", s.nav[2]);
  ok(near(s.nav[3], 100), "A5 back to the starting value reads 100 again", s.nav[3]);
  ok(near(s.last, 100), "A6 last mirrors the final point", s.last);
}

console.log("\nB. A contribution must not move the NAV");
{
  // Value doubles 1000→2000 AND 2000 is paid in on that same point.
  const v = [1000, 4000];
  const c = [1000, 3000]; // +2000 contributed during period 1
  const s = T(v, c);
  ok(near(s.nav[1], 200), "B1 the jump-day purchase does not dilute the doubling", s.nav[1]);

  // The same portfolio without the purchase must give the identical series.
  const plain = T([1000, 2000], [1000, 1000]);
  ok(near(s.nav[1], plain.nav[1]), "B2 identical to the same fund with no purchase",
     [s.nav[1], plain.nav[1]]);

  // A contribution on a FLAT day must leave it at 100 no matter how large.
  const flat = T([1000, 61000], [1000, 61000]);
  ok(near(flat.nav[1], 100), "B3 a 60x contribution on a flat day leaves NAV at 100", flat.nav[1]);
}

console.log("\nC. Withdrawals are symmetric");
{
  // Doubled to 2000, then half sold: value 1000, cumulative contributions -1000.
  const s = T([1000, 2000, 1000], [1000, 1000, 0]);
  ok(near(s.nav[1], 200), "C1 doubled before the sale", s.nav[1]);
  ok(near(s.nav[2], 200), "C2 selling half does not erase the return", s.nav[2]);

  // Selling everything: value 0, proceeds 2000 out.
  const exit = T([1000, 2000, 0], [1000, 1000, -1000]);
  ok(near(exit.nav[2], 200), "C3 a full exit holds the return it had earned", exit.nav[2]);
}

console.log("\nD. An SIP tracks unit prices, not the money weighting");
{
  // Unit price 10 → 20 over four periods, buying ₹1000 of units each period.
  // TWR must be 200 regardless of how much was bought when.
  const price = [10, 12.5, 15, 17.5, 20];
  let units = 100, contrib = 1000;       // opening 100 units at 10
  const v = [1000], c = [1000];
  for (let i = 1; i < price.length; i++) {
    units += 1000 / price[i];
    contrib += 1000;
    v.push(units * price[i]);
    c.push(contrib);
  }
  const s = T(v, c);
  ok(near(s.last, 200, 1e-9), "D1 an SIP into a doubling fund reads 200", r2(s.last));
  // The money-weighted answer is much lower — that is the number the old code gave.
  const moneyWeighted = v[v.length - 1] / c[c.length - 1] * 100;
  ok(moneyWeighted < 190, "D2 (sanity) the money-weighted figure really is lower", r2(moneyWeighted));
}

console.log("\nE. Nothing invested yet");
{
  const s = T([0, 0, 500, 750], [0, 0, 500, 500]);
  ok(s.baseIndex === 2, "E1 the base is the first point with value", s.baseIndex);
  ok(s.nav[0] === null && s.nav[1] === null,
     "E2 points before it are null, not a flat 100 through an empty period", s.nav.slice(0, 2));
  ok(s.nav[2] === 100, "E3 100 on the opening point");
  ok(near(s.nav[3], 150), "E4 and it tracks from there", s.nav[3]);

  const never = T([0, 0, 0], [0, 0, 0]);
  ok(never.baseIndex === -1 && never.last === null && never.nav.every((x) => x === null),
     "E5 a portfolio that never had value produces no series", never);
  const empty = T([], []);
  ok(empty.baseIndex === -1 && empty.nav.length === 0, "E6 an empty input is handled", empty);
}

console.log("\nF. Exit and re-enter");
{
  // Doubles, fully sold (NAV holds at 200), then re-opened and rises 50%.
  const s = T([1000, 2000, 0, 1000, 1500], [1000, 1000, -1000, 0, 0]);
  ok(near(s.nav[1], 200), "F1 the gain before the exit");
  ok(near(s.nav[2], 200), "F2 flat while out of the market — no capital at risk", s.nav[2]);
  ok(near(s.nav[3], 200), "F3 re-entering is a contribution, not a return", s.nav[3]);
  ok(near(s.nav[4], 300), "F4 the new gain compounds on the old one", s.nav[4]);
}

console.log("\nG. Nothing is NaN or Infinity");
{
  // Every awkward combination in one pass: zero values, exact-zero net worth after
  // a flow, a withdrawal larger than the value, missing contribution entries.
  const cases = [
    [[1000, 0], [1000, 0]],
    [[1000, 500], [1000, -5000]],
    [[0, 1000, 0, 2000], [0, 1000, 0, 1000]],
    [[1000, 2000], undefined],
    [[1000, 2000], []],
  ];
  let bad = null;
  cases.forEach(function (cs, i) {
    const s = T(cs[0], cs[1]);
    s.nav.forEach(function (x) { if (x !== null && !isFinite(x)) bad = [i, s.nav]; });
    if (s.last !== null && !isFinite(s.last)) bad = [i, s.last];
  });
  ok(bad === null, "G1 no non-finite NAV in any degenerate case", bad);

  // A missing cumContrib array must be read as "no flows", not as NaN.
  const noFlows = T([1000, 2000], undefined);
  ok(near(noFlows.nav[1], 200), "G2 a missing contribution series means no flows", noFlows.nav[1]);
}

console.log("\nI. The unit model, at the ₹1,000 base the spec is written in");
{
  // "Your account value is ₹10,000 and the NAV is ₹1,000 → 10 units. When you add
  //  ₹5,000, 5 new units are created → 15 units. Since the NAV remains ₹1,000 your
  //  total value is ₹15,000, but the curve correctly shows no profit or loss."
  const a = T([10000, 15000], [10000, 15000], 1000);
  ok(a.nav[0] === 1000, "I1 opens at a NAV of 1,000", a.nav[0]);
  ok(a.units[0] === 10, "I2 ₹10,000 at ₹1,000 is 10 units", a.units[0]);
  ok(near(a.nav[1], 1000), "I3 adding ₹5,000 leaves the NAV at 1,000", a.nav[1]);
  ok(near(a.units[1], 15), "I4 it creates 5 new units, for 15", a.units[1]);
  ok(near(a.units[1] * a.nav[1], 15000), "I5 15 units × ₹1,000 = ₹15,000", a.units[1] * a.nav[1]);

  // "Day 1: NAV ₹1,000, 10 units, account ₹10,000. Day 2: gains ₹1,000 → ₹11,000
  //  and NAV ₹1,100, units unchanged. Day 3: loses ₹2,000 → ₹9,000 and NAV ₹900,
  //  units still unchanged."
  const b = T([10000, 11000, 9000], [10000, 10000, 10000], 1000);
  ok(near(b.nav[1], 1100), "I6 a ₹1,000 gain takes the NAV to 1,100", b.nav[1]);
  ok(near(b.nav[2], 900), "I7 a ₹2,000 loss takes it to 900", b.nav[2]);
  ok(b.units.every((u) => near(u, 10)),
     "I8 the unit count never moves on market gains or losses", b.units);

  // A withdrawal cancels units at the NAV it left at, and the NAV does not move.
  const w = T([10000, 6000], [10000, 6000], 1000);
  ok(near(w.nav[1], 1000), "I9 withdrawing ₹4,000 leaves the NAV at 1,000", w.nav[1]);
  ok(near(w.units[1], 6), "I10 it cancels 4 units, leaving 6", w.units[1]);

  // The base is a relabelling: the curve's SHAPE cannot depend on it.
  const v = [1000, 1500, 1200], c = [1000, 1000, 1000];
  const h = T(v, c, 100), k = T(v, c, 1000);
  ok(k.nav.every((x, i) => near(x, h.nav[i] * 10, 1e-9)),
     "I11 the ₹1,000 base is exactly ten times the ₹100 base", [h.nav, k.nav]);
  ok(near(T(v, c).last, h.last), "I12 the base defaults to 100", T(v, c).last);
}

console.log("\nJ. Units and NAV stay consistent with the account value");
{
  // units × NAV must reproduce the account value at every point — the invariant
  // that makes the unit story true rather than just a way of describing it.
  const v = [1000, 1800, 1800, 900, 2400];
  const c = [1000, 1000, 1500, 1500, 2100];
  const s = T(v, c, 1000);
  let worst = 0;
  s.nav.forEach((x, i) => { if (x != null) worst = Math.max(worst, Math.abs(s.units[i] * x - v[i])); });
  ok(worst < 1e-6, "J1 units × NAV equals the account value at every point", worst);
  // And units only ever change when money moves.
  let moved = [];
  for (let i = 1; i < v.length; i++) {
    const flowed = Math.abs(c[i] - c[i - 1]) > 1e-9;
    const unitsMoved = Math.abs(s.units[i] - s.units[i - 1]) > 1e-6;
    if (unitsMoved !== flowed) moved.push(i);
  }
  ok(moved.length === 0, "J2 units change on cash flows and only on cash flows", moved);
}

console.log("\nH. The chart uses this helper rather than its own copy");
{
  const fs = require("fs");
  const path = require("path");
  const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  ok(/WfMath\.twrNavSeries\(/.test(SRC), "H1 script.js calls the shared helper");
  ok(!/units \+= dContrib \/ prevNav/.test(SRC),
     "H2 the old unit-count recurrence is gone, not left beside it");
  ok((SRC.match(/WfMath\.twrNavSeries\(/g) || []).length === 1,
     "H3 exactly one call site", (SRC.match(/WfMath\.twrNavSeries\(/g) || []).length);
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
