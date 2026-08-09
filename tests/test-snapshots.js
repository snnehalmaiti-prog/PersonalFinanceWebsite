// wf-snapshots.js — the rules that decide whether a net-worth snapshot is
// allowed to be written, and what a backfill reconstructs.
//
// The write rules matter more than the arithmetic here: a snapshot is permanent,
// so every case below is one specific way a load could store a number that never
// happened (a partial total mid-load, one portfolio's share, a stale gold price).
//
//     node tests/test-snapshots.js
"use strict";

// The date rules are about local-vs-UTC disagreement, so they prove nothing in a
// UTC container — which is exactly what CI and this sandbox are. Re-exec once in
// the app's real zone so "local" and "UTC" actually differ and D1–D4 can fail.
if (process.env.TZ !== "Asia/Kolkata") {
  const r = require("child_process").spawnSync(process.execPath, [__filename],
    { stdio: "inherit", env: Object.assign({}, process.env, { TZ: "Asia/Kolkata" }) });
  process.exit(r.status == null ? 1 : r.status);
}

const S = require("../wf-snapshots.js");

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const eq = (a, b, name) => ok(a === b, name, { got: a, want: b });

// ── Date key ────────────────────────────────────────────────────────────────
// Local calendar date, not UTC. A load at 01:30 IST is the previous day in UTC,
// and filing it under yesterday would overwrite yesterday's real record.
eq(S.localDateKey(new Date(2026, 7, 9, 1, 30)), "2026-08-09", "D1 local date at 01:30");
eq(S.localDateKey(new Date(2026, 0, 5)), "2026-01-05", "D2 month and day are zero-padded");
eq(S.localDateKey("not a date"), null, "D3 an unparseable date yields null, not 'NaN-NaN-NaN'");
{
  // The real regression this guards: the UTC form of a late-evening IST load
  // lands on a DIFFERENT day. Constructed from a fixed UTC instant so the test
  // does not depend on the machine's zone: 2026-08-09T20:00Z is the 10th in IST.
  const d = new Date(Date.UTC(2026, 7, 9, 20, 0));
  const iso = d.toISOString().slice(0, 10);
  const local = S.localDateKey(d);
  const tzShifts = d.getDate() !== d.getUTCDate();
  ok(!tzShifts || local !== iso,
     "D4 where local and UTC disagree on the day, the local one wins",
     { local, iso, tzShifts });
}
eq(S.monthKey(new Date(2026, 7, 9)), "2026-08", "D5 month key");

// ── Stability ───────────────────────────────────────────────────────────────
ok(S.isStable(7295713, 7295713), "S1 identical reads are stable");
ok(S.isStable(7295713, 7295714), "S2 a rupee of FD accrual between reads is not instability");
ok(!S.isStable(7295713, 5149917), "S3 a slice landing between reads is");
ok(!S.isStable(0, 0), "S4 zero is never stable — it means nothing has loaded");
ok(!S.isStable(100, NaN), "S5 NaN is not stable");
// Tolerance is relative, so it must scale rather than let a big portfolio drift.
ok(!S.isStable(10000000, 10000000 * 1.002), "S6 0.2% apart on a crore is NOT stable");
ok(S.isStable(10000000, 10000000 * 1.0002), "S7 0.02% apart is");

// ── evaluateWrite ───────────────────────────────────────────────────────────
const GOOD = () => ({
  total: 7295713, totalAgain: 7295713, invested: 5000000,
  breakdown: { equity: 2145796, fixedIncome: 5069894, commodity: 80023 },
  byPortfolio: { Snnehal: { equity: 1, fixed_income: 2, commodity: 3 } },
  portfolioFilter: "all", fiExcluded: false, savingsExcluded: false,
  goldStale: false, hasCommodity: true, dateKey: "2026-08-09",
  marketSource: { stock_prices: { source: "live", at: "x" } }
});
const withCtx = (patch) => S.evaluateWrite(Object.assign(GOOD(), patch));

{
  const d = S.evaluateWrite(GOOD());
  ok(d.write, "W1 a fully-resolved, unfiltered, fresh load is recorded", d.reasons);
  eq(d.row.snapshot_date, "2026-08-09", "W2 row carries the local date");
  eq(d.row.total, 7295713, "W3 row total is the Overview total");
  eq(d.row.equity, 2145796, "W4 category split is carried through");
  eq(d.row.meta.source, "live", "W5 a recorded row is marked live, not backfill");
  ok(d.row.by_portfolio && d.row.by_portfolio.Snnehal, "W6 per-portfolio split is stored");
}

// Each of these is a way to store a number that never happened.
const refuses = (patch, reason, name) => {
  const d = withCtx(patch);
  ok(!d.write && d.reasons.indexOf(reason) !== -1, name, d.reasons);
  ok(d.row === null, name + " (and produces no row)");
};
refuses({ portfolioFilter: "Snnehal" }, "portfolio-filtered",
        "W7 one portfolio's share is not the household's net worth");
refuses({ fiExcluded: true }, "fixed-income-excluded",
        "W8 not with fixed income hidden");
refuses({ savingsExcluded: true }, "savings-excluded",
        "W9 not with savings excluded");
refuses({ total: 0, totalAgain: 0 }, "no-total",
        "W10 not before anything has loaded");
refuses({ totalAgain: 5149917 }, "unstable",
        "W11 not while the total is still moving");
refuses({ goldStale: true }, "stale-gold",
        "W12 not on a stale gold price when gold is held");
refuses({ breakdown: null }, "no-breakdown",
        "W13 not without a category breakdown");
refuses({ breakdown: { equity: 2145796, fixedIncome: 0, commodity: 0 } }, "breakdown-mismatch",
        "W14 not when the split and the total disagree");

{
  // Stale gold only blocks when there IS gold. Otherwise every gold-free
  // portfolio would be permanently unrecordable the moment the feed went down.
  const d = withCtx({ goldStale: true, hasCommodity: false,
                      breakdown: { equity: 2145796, fixedIncome: 5149917, commodity: 0 } });
  ok(d.write, "W15 a stale gold price does not block a portfolio holding no gold", d.reasons);
}
{
  // All the reasons, not just the first — a refusal should be able to say
  // everything that is wrong.
  const d = withCtx({ fiExcluded: true, portfolioFilter: "Trisha" });
  ok(d.reasons.length >= 2, "W16 every failing rule is reported", d.reasons);
}
{
  const d = withCtx({ invested: 0 });
  ok(d.write && d.row.invested === null,
     "W17 a missing invested total is stored as null, not as a real zero", d.row);
}

// ── Backfill ────────────────────────────────────────────────────────────────
const P = (y, m, day, v) => ({ x: new Date(y, m - 1, day), y: v });
const SERIES = [
  P(2026, 5, 1, 100), P(2026, 5, 30, 150),
  P(2026, 6, 10, 160), P(2026, 6, 30, 170),
  P(2026, 7, 31, 200),
  P(2026, 8, 1, 210), P(2026, 8, 9, 220)   // current month
];
{
  const me = S.monthEndPoints(SERIES, "2026-08-09");
  eq(me.length, 3, "B1 one point per completed month");
  eq(me[0].snapshot_date, "2026-05-30", "B2 the LAST point of each month, not the first");
  eq(me[0].total, 150, "B3 with that point's value");
  eq(me[2].snapshot_date, "2026-07-31", "B4 oldest first");
  ok(!me.some((r) => r.snapshot_date.slice(0, 7) === "2026-08"),
     "B5 the current month is excluded — its last point is today, which the live writer owns");
}
{
  const plan = S.planBackfill(SERIES, ["2026-06-30"], "2026-08-09");
  eq(plan.length, 2, "B6 months already recorded are skipped");
  ok(!plan.some((r) => r.snapshot_date === "2026-06-30"), "B7 specifically that one");
  eq(plan[0].meta.backfilled, true, "B8 reconstructions are flagged");
  eq(plan[0].meta.source, "backfill", "B9 and their source names them");
  eq(plan[0].equity, null,
     "B10 category columns are null — the Account Value line has no split, and zeros would invent a portfolio that held nothing");
  eq(plan[0].invested, null, "B11 same for invested");
}
{
  eq(S.planBackfill([], [], "2026-08-09").length, 0, "B12 an empty series plans nothing");
  eq(S.planBackfill(SERIES, ["2026-05-30", "2026-06-30", "2026-07-31"], "2026-08-09").length, 0,
     "B13 a fully-recorded history plans nothing");
  const capped = S.planBackfill(SERIES, [], "2026-08-09", 2);
  eq(capped.length, 2, "B14 the limit caps the batch");
  eq(capped[1].snapshot_date, "2026-07-31", "B15 keeping the most RECENT months, not the oldest");
}
{
  // Zero/negative points would otherwise record a net worth of nothing on days
  // the series simply has no data for.
  const withGap = [P(2026, 5, 30, 0), P(2026, 6, 30, 170)];
  const me = S.monthEndPoints(withGap, "2026-08-09");
  eq(me.length, 1, "B16 non-positive points are not month ends");
  eq(me[0].snapshot_date, "2026-06-30", "B17 the real one survives");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
