// Correctness tests for the pure Overview aggregator in wf-overview.js.
//
// These encode the invariants whose violation produced the real Overview
// defects: the day change collapsing to a subset of asset classes, and the
// "phantom total loss" while an async price/NAV fetch was still in flight.
// Run: node tests/test-overview-aggregate.js
const fs = require("fs");
const path = require("path");

eval(fs.readFileSync(path.join(__dirname, "..", "wf-overview.js"), "utf8"));
const WfOverview = globalThis.WfOverview || global.WfOverview;
if (!WfOverview) { console.error("FATAL: WfOverview not exported"); process.exit(1); }
const { aggregateOverview } = WfOverview;

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + detail : "")); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol); }

function slice(o) {
  return Object.assign({ invested: 0, current: 0, unrealized: 0, realized: 0, dayChange: 0 }, o);
}

// A representative fully-loaded portfolio used across several cases.
const FULL = {
  mf:   slice({ invested: 1173359, current: 1386282, unrealized: 212922, realized: 5000, dayChange: -9310 }),
  se:   slice({ invested: 936516,  current: 937796,  unrealized: 1281,   realized: 3000, dayChange: -9642 }),
  fi:   slice({ invested: 2400000, current: 2466730, unrealized: 66730,  realized: 94319 }),
  comm: slice({ invested: 13668,   current: 14301,   unrealized: 633,    realized: 0,    dayChange: 0 }),
};

console.log("A. Day change — the aggregation invariant");

// A1: THE core regression. Day change must be the sum of every present class.
// The shipped bug summed only a subset (Overview showed ~9K when MF and stocks
// were each ~-9.5K) because one flow zeroed another's accumulator.
{
  const r = aggregateOverview(FULL, { excludeFixedIncome: false });
  ok(approx(r.dayChange, -9310 + -9642 + 0), "A1 day change = mf + se + comm", r.dayChange);
}

// A2: Fixed income carries no intraday mark; it must never contribute day change
// even when it holds the largest balance.
{
  const withFiDay = { ...FULL, fi: slice({ invested: 2400000, current: 2466730, dayChange: 999999 }) };
  const r = aggregateOverview(withFiDay, { excludeFixedIncome: false });
  ok(approx(r.dayChange, -18952), "A2 fixed income contributes no day change", r.dayChange);
}

// A3: commodity moving opposite to equities nets correctly (the -16,084 case).
{
  const r = aggregateOverview({ ...FULL, comm: slice({ dayChange: 2868 }) }, { excludeFixedIncome: false });
  ok(approx(r.dayChange, -9310 + -9642 + 2868), "A3 positive commodity offsets equity loss", r.dayChange);
}

// A4: a class still loading (null slice) must not corrupt the others — it
// contributes 0, it does not zero the sum.
{
  const r = aggregateOverview({ ...FULL, mf: null }, { excludeFixedIncome: false });
  ok(approx(r.dayChange, -9642), "A4 unresolved MF slice omits only its own day change", r.dayChange);
}

// A5: aggregation is order-independent — slices landing in any sequence give the
// same answer. This is the property the shared-mutable accumulator lacked.
{
  const a = aggregateOverview({ mf: FULL.mf, se: FULL.se, fi: FULL.fi, comm: FULL.comm }, {});
  const b = aggregateOverview({ comm: FULL.comm, fi: FULL.fi, se: FULL.se, mf: FULL.mf }, {});
  ok(approx(a.dayChange, b.dayChange) && approx(a.current, b.current), "A5 result is order-independent");
}

console.log("B. Invested fallback — no phantom loss during load");

// B1: while MF's NAV fetch is in flight its current is 0 but its cost is known.
// The header must value it at cost (0% P&L), not 0 (a total loss).
{
  const loading = { ...FULL, mf: slice({ invested: 1173359, current: 0 }) };
  const r = aggregateOverview(loading, { excludeFixedIncome: false });
  const expected = 1173359 + 937796 + 2466730 + 14301;
  ok(approx(r.current, expected), "B1 unresolved MF valued at cost, not zero", r.current);
}

// B2: with every current unresolved, Current == Invested and P&L is exactly 0 —
// never a large negative number.
{
  const cold = {
    mf: slice({ invested: 100000 }), se: slice({ invested: 50000 }),
    fi: slice({ invested: 25000 }), comm: slice({ invested: 5000 }),
  };
  const r = aggregateOverview(cold, { excludeFixedIncome: false });
  ok(approx(r.current, 180000) && approx(r.unrealized, 0) && approx(r.returnPct, 0),
     "B2 cold load → current == invested, 0% P&L", r.unrealized);
}

// B3: a genuinely worthless holding (current 0, but sold/zeroed) still falls back
// to cost — documenting that the fallback is by design, not a bug to "fix" later.
{
  const r = aggregateOverview({ mf: slice({ invested: 1000, current: 0 }) }, {});
  ok(approx(r.current, 1000), "B3 fallback applies whenever current is 0", r.current);
}

console.log("C. Fixed-income exclusion gate");

// C1: excluding fixed income removes BOTH fi and commodity from every total —
// they share a sheet and are gated together.
{
  const r = aggregateOverview(FULL, { excludeFixedIncome: true });
  ok(approx(r.invested, 1173359 + 936516), "C1a excluded: invested drops fi + commodity", r.invested);
  ok(approx(r.current, 1386282 + 937796), "C1b excluded: current drops fi + commodity", r.current);
  ok(approx(r.realized, 5000 + 3000), "C1c excluded: realized drops fi + commodity", r.realized);
}

// C2: commodity day change must also be excluded, or the header day change would
// disagree with the (now hidden) cards.
{
  const r = aggregateOverview({ ...FULL, comm: slice({ dayChange: 2868 }) }, { excludeFixedIncome: true });
  ok(approx(r.dayChange, -18952), "C2 excluded: commodity day change removed", r.dayChange);
}

// C3: the combined FI card zeroes out entirely when excluded.
{
  const r = aggregateOverview(FULL, { excludeFixedIncome: true });
  ok(r.cards.fi.invested === 0 && r.cards.fi.current === 0 && r.cards.fi.realized === 0,
     "C3 excluded: FI category card is zeroed");
}

console.log("D. Header/card consistency");

// D1: the FI card combines fixed income and commodity.
{
  const r = aggregateOverview(FULL, { excludeFixedIncome: false });
  ok(approx(r.cards.fi.invested, 2400000 + 13668) && approx(r.cards.fi.current, 2466730 + 14301),
     "D1 FI card = fixed income + commodity", r.cards.fi.current);
}

// D2: return % is derived from the same numbers shown, so the card can never
// display a percentage inconsistent with its own invested/current.
{
  const r = aggregateOverview(FULL, {});
  ok(approx(r.cards.mf.returnPct, (1386282 - 1173359) / 1173359 * 100, 1e-9),
     "D2 MF card return % matches its invested/current", r.cards.mf.returnPct);
}

// D3: zero invested must not produce NaN/Infinity anywhere.
{
  const r = aggregateOverview({ mf: slice({}), se: slice({}), fi: slice({}), comm: slice({}) }, {});
  const finite = [r.invested, r.current, r.unrealized, r.returnPct, r.realized, r.dayChange,
                  r.cards.mf.returnPct, r.cards.se.returnPct, r.cards.fi.returnPct].every(Number.isFinite);
  ok(finite, "D3 empty portfolio yields finite zeros, no NaN");
}

// D4: SE card uses the invested-fallback (matching the header) so the two agree
// while live prices are loading.
{
  const r = aggregateOverview({ se: slice({ invested: 936516, current: 0 }) }, {});
  ok(approx(r.cards.se.current, 936516) && approx(r.cards.se.returnPct, 0),
     "D4 SE card falls back to cost like the header", r.cards.se.current);
}

console.log("E. Robustness");

// E1: completely absent input must not throw.
{
  let threw = false;
  let r = null;
  try { r = aggregateOverview(undefined, undefined); } catch (e) { threw = true; }
  ok(!threw && r && r.current === 0, "E1 undefined slices/opts do not throw");
}

// E2: non-numeric junk in a slice degrades to 0 rather than poisoning totals
// with NaN (sheet cells can arrive as empty strings or "—").
{
  const r = aggregateOverview({
    mf: { invested: "1000", current: "", unrealized: null, realized: undefined, dayChange: "abc" },
    se: slice({ invested: 500, current: 600, dayChange: 25 }),
  }, {});
  ok(approx(r.current, 1000 + 600) && approx(r.dayChange, 25),
     "E2 junk values coerce to 0, totals stay finite", r.current + "/" + r.dayChange);
}

console.log("F. Partial-patch semantics (the _ovApply contract)");

// The choke point applies only the fields present in a patch, so a flow that
// knows one number cannot blank the others. These tests pin that contract at the
// aggregate level: applying patches in sequence must accumulate, never reset.
// (Mirrors _ovApply's field-merge behavior in script.js.)
function applyPatch(store, cls, patch) {
  store[cls] = Object.assign({}, store[cls] || {});
  Object.keys(patch).forEach(k => {
    const v = +patch[k];
    store[cls][k] = Number.isFinite(v) ? v : 0;
  });
  return store;
}

// F1: the exact 18K→9K regression. A day-change-only write from a late flow must
// not clear the current value an earlier flow established.
{
  let store = {};
  applyPatch(store, "mf", { invested: 1173359, current: 1386282 });
  applyPatch(store, "mf", { dayChange: -9310 });          // late day-change-only write
  const r = aggregateOverview(store, {});
  ok(approx(r.current, 1386282) && approx(r.dayChange, -9310),
     "F1 day-change-only patch preserves current", r.current + "/" + r.dayChange);
}

// F2: interleaved writes from different classes never cross-contaminate.
{
  let store = {};
  applyPatch(store, "mf", { invested: 100, current: 110, dayChange: -5 });
  applyPatch(store, "se", { invested: 200, current: 190, dayChange: -10 });
  applyPatch(store, "mf", { current: 115 });               // MF re-price only
  const r = aggregateOverview(store, {});
  ok(approx(r.current, 115 + 190) && approx(r.dayChange, -15),
     "F2 per-class patches stay isolated", r.current + "/" + r.dayChange);
}

// F3: a patch carrying NaN/garbage coerces to 0 for that field only, leaving the
// rest of the slice intact — a bad parse degrades, it does not wipe the class.
{
  let store = {};
  applyPatch(store, "comm", { invested: 13668, current: 14301 });
  applyPatch(store, "comm", { dayChange: NaN });
  const r = aggregateOverview(store, {});
  ok(approx(r.current, 14301) && r.dayChange === 0,
     "F3 NaN patch zeroes only its own field", r.current + "/" + r.dayChange);
}

console.log("G. Debt funds/ETFs reclassified out of MF and Stocks/ETF");

// An instrument marked Fixed Income in the mapping sheets is tracked in the
// Mutual Fund or Stocks/ETF sheet but reported under Fixed Income. The value has
// to MOVE, not disappear: whatever the equity cards lose, the fixed income card
// must gain, and net worth must not budge.
{
  const before = aggregateOverview({
    mf: { invested: 1200000, current: 1200000 },
    se: { invested: 800000, current: 800000 },
    fi: { invested: 500000, current: 500000 },
    comm: { invested: 0, current: 0 },
  }, {});
  const after = aggregateOverview({
    mf: { invested: 1150000, current: 1150000 },
    se: { invested: 760000, current: 760000 },
    fi: { invested: 500000, current: 500000 },
    comm: { invested: 0, current: 0 },
    debtMf: { invested: 50000, current: 50000 },
    debtSe: { invested: 40000, current: 40000 },
  }, {});
  ok(approx(before.current, after.current), "G1 net worth unchanged by the reclassification",
     before.current + " vs " + after.current);
  ok(approx(after.cards.mf.current, 1150000), "G2 Mutual Funds card drops the debt funds");
  ok(approx(after.cards.se.current, 760000), "G3 Stocks & ETF card drops the debt ETFs");
  ok(approx(after.cards.fi.current, 590000), "G4 Fixed Income card gains both",
     String(after.cards.fi.current));
  ok(approx(after.cards.mf.current + after.cards.se.current + after.cards.fi.current, after.current),
     "G5 the three cards still total net worth");
  ok(approx(after.invested, before.invested), "G6 invested is moved, not double counted",
     after.invested + " vs " + before.invested);
}
{
  // Two independent buckets, because the MF and Stocks/ETF flows resolve
  // separately: one arriving must not erase the other's contribution.
  const onlyMf = aggregateOverview({ debtMf: { invested: 50000, current: 50000 } }, {});
  const both = aggregateOverview({
    debtMf: { invested: 50000, current: 50000 },
    debtSe: { invested: 40000, current: 40000 },
  }, {});
  ok(approx(onlyMf.current, 50000), "G7 MF debt counts before the Stocks/ETF flow resolves");
  ok(approx(both.current, 90000), "G8 both buckets add up once both have resolved");
}
{
  // Debt funds are priced daily, unlike deposits, so their day change counts.
  const r = aggregateOverview({
    mf: { current: 100, dayChange: -10 },
    debtMf: { current: 100, dayChange: 3 },
    debtSe: { current: 100, dayChange: 2 },
    fi: { current: 100, dayChange: 999 },
  }, {});
  ok(approx(r.dayChange, -5), "G9 debt day change counts; deposit fixed income still does not",
     String(r.dayChange));
}
{
  // Excluding fixed income must drop the debt buckets too — they are fixed income.
  const r = aggregateOverview({
    mf: { invested: 100, current: 100 },
    debtMf: { invested: 50, current: 50 },
    debtSe: { invested: 40, current: 40 },
    fi: { invested: 500, current: 500 },
  }, { excludeFixedIncome: true });
  ok(approx(r.current, 100), "G10 the exclusion toggle drops debt with the rest of fixed income",
     String(r.current));
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
