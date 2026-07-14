// Correctness tests for the pure financial kernels in wf-math.js.
// These are the highest-stakes functions in the app and previously had ZERO
// correctness coverage (only a timing benchmark). Run: node tests/test-math.js
const fs = require("fs");
const path = require("path");

// Load the real module (defines globalThis.WfMath).
eval(fs.readFileSync(path.join(__dirname, "..", "wf-math.js"), "utf8"));
const WfMath = globalThis.WfMath || global.WfMath;
if (!WfMath) { console.error("FATAL: WfMath not exported"); process.exit(1); }
const { calculateXIRR, fifoRemainingLots, DAYS_PER_YEAR } = WfMath;

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + detail : "")); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }

// Build a date `years` (in 365.25-day years) after a base date — matches the
// module's own day-count so exact-rate assertions are convention-independent.
const BASE = new Date(2020, 0, 1);
function atYears(years) { return new Date(BASE.getTime() + years * DAYS_PER_YEAR * 86400000); }

// Independent NPV using the SAME day-count — the strongest correctness check:
// a correct IRR makes NPV≈0 regardless of which convention is used.
function npvAt(flows, rate) {
  const t0 = Math.min.apply(null, flows.map(f => f.date.getTime()));
  return flows.reduce((s, f) => {
    const yrs = (f.date.getTime() - t0) / (DAYS_PER_YEAR * 86400000);
    return s + f.amount / Math.pow(1 + rate, yrs);
  }, 0);
}

console.log("X. calculateXIRR");

// X1: exactly +10% over exactly one year.
{
  const r = calculateXIRR([{ date: atYears(0), amount: -1000 }, { date: atYears(1), amount: 1100 }]);
  ok(approx(r, 0.10, 1e-4), "X1 -1000 → +1100 over 1yr ≈ 10%", r);
}
// X2: doubling in one year = +100%.
{
  const r = calculateXIRR([{ date: atYears(0), amount: -1000 }, { date: atYears(1), amount: 2000 }]);
  ok(approx(r, 1.0, 1e-4), "X2 doubling in 1yr ≈ 100%", r);
}
// X3: a 50% loss over one year. Uses realistic lakh-scale flows: the solver's
// acceptance tolerance floors at ₹1 absolute (Math.max(1, scale*1e-9)), so on
// tiny ₹1000 flows the implied rate precision is only ~0.05%; at ₹10L it's tight.
{
  const r = calculateXIRR([{ date: atYears(0), amount: -1000000 }, { date: atYears(1), amount: 500000 }]);
  ok(approx(r, -0.5, 1e-4), "X3 halving in 1yr ≈ -50%", r);
}
// X4: flat, two years — 0% return.
{
  const r = calculateXIRR([{ date: atYears(0), amount: -1000 }, { date: atYears(2), amount: 1000 }]);
  ok(approx(r, 0, 1e-4), "X4 no gain over 2yr ≈ 0%", r);
}
// X5: multi-flow (Excel XIRR reference shape) — assert the root is self-consistent
// (NPV≈0) and lands in the known ballpark (~37%). Day-count differs from Excel's
// 365, so we check NPV≈0 rather than an exact Excel decimal.
{
  const flows = [
    { date: new Date(2008, 0, 1), amount: -10000 },
    { date: new Date(2008, 2, 1), amount: 2750 },
    { date: new Date(2008, 9, 30), amount: 4250 },
    { date: new Date(2009, 1, 15), amount: 3250 },
    { date: new Date(2009, 3, 1), amount: 2750 },
  ];
  const r = calculateXIRR(flows);
  ok(Math.abs(npvAt(flows, r)) < 1e-3, "X5 multi-flow root is self-consistent (NPV≈0)", npvAt(flows, r));
  ok(r > 0.35 && r < 0.39, "X5 multi-flow rate in known ballpark (~37%)", r);
}
// X6: many monthly contributions + terminal — NPV self-consistency at scale.
{
  const flows = [];
  for (let i = 0; i < 24; i++) flows.push({ date: atYears(i / 12), amount: -5000 });
  flows.push({ date: atYears(2), amount: 140000 });
  const r = calculateXIRR(flows);
  ok(Math.abs(npvAt(flows, r)) < 1e-2, "X6 24 monthly SIPs + terminal: NPV≈0", npvAt(flows, r));
}
// X7: a strong-but-realistic extreme (5x over half a year ≈ 2400%/yr) resolves via
// geometric bracket growth rather than returning null. (Absurd rates beyond the 1e7
// bracket cap — e.g. 1000x in weeks — intentionally return null; not tested here as
// they can't occur for real holdings.)
{
  const flows = [{ date: atYears(0), amount: -1000 }, { date: atYears(0.5), amount: 5000 }];
  const r = calculateXIRR(flows);
  ok(r !== null && isFinite(r) && r > 1, "X7 strong short-holding gain resolves (not null)", r);
  ok(Math.abs(npvAt(flows, r)) < 1, "X7 extreme-return root is self-consistent (NPV≈0)", npvAt(flows, r));
}
// X8-X10: degenerate inputs → null.
ok(calculateXIRR([{ date: atYears(0), amount: -1000 }]) === null, "X8 single flow → null");
ok(calculateXIRR([{ date: atYears(0), amount: -1 }, { date: atYears(1), amount: -1 }]) === null, "X9 all-negative → null");
ok(calculateXIRR([{ date: atYears(0), amount: 1 }, { date: atYears(1), amount: 1 }]) === null, "X10 all-positive → null");
ok(calculateXIRR(null) === null && calculateXIRR([]) === null, "X11 null/empty → null");
// X12: sign convention — order of flows must not change the result.
{
  const a = calculateXIRR([{ date: atYears(0), amount: -1000 }, { date: atYears(1), amount: 1200 }]);
  const b = calculateXIRR([{ date: atYears(1), amount: 1200 }, { date: atYears(0), amount: -1000 }]);
  ok(approx(a, b, 1e-9), "X12 flow order does not affect result", a + " vs " + b);
}

console.log("F. fifoRemainingLots");

// F1: partial sell consumes the oldest lot first.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "buy", units: 5, price: 120 },
    { type: "sell", units: 8, price: 150 },
  ]);
  ok(rem.length === 2 && rem[0].units === 2 && rem[0].price === 100 && rem[1].units === 5 && rem[1].price === 120,
    "F1 FIFO sell consumes oldest lot first", JSON.stringify(rem));
}
// F2: sell spanning two lots.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "buy", units: 5, price: 120 },
    { type: "sell", units: 12, price: 150 },
  ]);
  ok(rem.length === 1 && rem[0].units === 3 && rem[0].price === 120, "F2 sell spans lots, remainder from newest", JSON.stringify(rem));
}
// F3: exact full liquidation → nothing open.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "sell", units: 10, price: 150 },
  ]);
  ok(rem.length === 0, "F3 full sell leaves no open lots");
}
// F4: over-sell (more than held) — drains lots, never goes negative.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 5, price: 100 },
    { type: "sell", units: 8, price: 150 },
  ]);
  ok(rem.length === 0, "F4 over-sell drains to empty (no negative lots)");
}
// F5: buy after sell stays open.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "sell", units: 10, price: 150 },
    { type: "buy", units: 4, price: 130 },
  ]);
  ok(rem.length === 1 && rem[0].units === 4 && rem[0].price === 130, "F5 re-buy after full exit is open", JSON.stringify(rem));
}
// F6: no transactions → empty.
ok(fifoRemainingLots([]).length === 0, "F6 empty txns → empty");

console.log("W. forwardFillOverTimeline ≡ lastAtOrBefore (chart optimization)");
// Extract the REAL binary-search lastAtOrBefore from script.js and prove the
// linear pointer-walk returns byte-identical results — the safety guarantee for
// swapping it into the value-chart hot loop.
{
  const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const mk = "function lastAtOrBefore(sortedEvents, targetDate, valueKey)";
  const s = SRC.indexOf(mk), bs = SRC.indexOf("{", s);
  let depth = 0, i = bs;
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } }
  eval(SRC.slice(s, i + 1)); // defines lastAtOrBefore
  const { forwardFillOverTimeline } = WfMath;

  // Deterministic pseudo-random (no Math.random) for repeatable events + timeline.
  function build(nEvents, nDates, seed) {
    let x = seed;
    const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const evs = [];
    let day = 0, val = 0;
    for (let k = 0; k < nEvents; k++) { day += Math.floor(rnd() * 40); val += rnd() * 100; evs.push({ date: new Date(2015, 0, 1 + day), v: val }); }
    const tl = [];
    let d2 = -10; // start before first event so some queries return null
    for (let k = 0; k < nDates; k++) { d2 += Math.floor(rnd() * 15); tl.push(new Date(2015, 0, 1 + d2)); }
    return { evs, tl };
  }
  let mism = 0, cases = 0;
  [[50, 300, 7], [5, 500, 11], [0, 20, 3], [200, 50, 99]].forEach(([ne, nd, sd]) => {
    const { evs, tl } = build(ne, nd, sd);
    const filled = forwardFillOverTimeline(evs, tl, "v");
    for (let k = 0; k < tl.length; k++) {
      cases++;
      const ref = lastAtOrBefore(evs, tl[k], "v");
      if (!(filled[k] === ref || (filled[k] == null && ref == null))) mism++;
    }
  });
  ok(mism === 0, "W1 pointer-walk matches binary-search on " + cases + " randomized queries", mism + " mismatches");
  // Empty events → all null; empty timeline → empty output.
  ok(forwardFillOverTimeline([], [new Date()], "v")[0] === null, "W2 no events → null");
  ok(forwardFillOverTimeline([{ date: new Date(2020, 0, 1), v: 5 }], [], "v").length === 0, "W3 empty timeline → empty");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
