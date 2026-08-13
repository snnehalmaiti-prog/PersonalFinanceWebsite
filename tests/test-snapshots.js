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
// ── Repairing rows written before the split existed ─────────────────────────
// planBackfill writes only dates it does not already have, so every month
// recorded before the card could filter by portfolio keeps a null by_portfolio
// forever — and forPortfolio drops exactly those rows, so the selector empties
// the card. This is the repair pass: same reconstruction, aimed at the rows
// that already exist.
{
  const SN = [P(2026, 5, 30, 90), P(2026, 6, 30, 100), P(2026, 7, 31, 110)];
  const TR = [P(2026, 5, 30, 60), P(2026, 6, 30, 70), P(2026, 7, 31, 80)];
  const splits = { Snnehal: SN, Trisha: TR };
  const stored = [
    { snapshot_date: "2026-05-30", total: 150, by_portfolio: null, meta: { source: "backfill" } },
    { snapshot_date: "2026-06-30", total: 170, by_portfolio: null, meta: { source: "backfill" } },
    { snapshot_date: "2026-07-31", total: 190, by_portfolio: { Snnehal: 110, Trisha: 80 },
      meta: { source: "backfill" } },
  ];
  const fix = S.planSplitBackfill(stored, "2026-08-09", splits);
  eq(fix.length, 2, "N1 only the rows missing a split are rewritten");
  ok(!fix.some((r) => r.snapshot_date === "2026-07-31"),
     "N2 a row that already carries one is left alone — the repair is not a rewrite of history");
  eq(fix[0].by_portfolio.Snnehal, 90, "N3 each portfolio's own value for that date");
  eq(fix[0].by_portfolio.Trisha, 60, "N4 for every portfolio, not just the first");
  eq(fix[1].by_portfolio.Snnehal, 100,
     "N5 looked up by date rather than by position, so a portfolio with a shorter history cannot shift the rest");
  eq(fix[0].total, 150,
     "N6 the recorded total is carried through untouched — it is a record, and the split is only being filled in");
  eq(fix[0].meta.source, "backfill", "N7 the row's own meta survives");
  eq(fix[0].meta.split_source, "backfill",
     "N8 and says the split is a reconstruction, which the total may not be");

  // A live row records a real total; its split can still be filled in, but
  // nothing else about it may change.
  const live = [{ snapshot_date: "2026-06-30", total: 175, invested: 120, equity: 60,
    fixed_income: 115, commodity: 0, by_portfolio: null, meta: { source: "live" } }];
  const lf = S.planSplitBackfill(live, "2026-08-09", splits);
  eq(lf.length, 1, "N9 a live row missing its split is repaired too");
  eq(lf[0].total, 175, "N10 keeping the total it recorded, not the reconstruction's");
  eq(lf[0].equity, 60, "N11 and its category columns");
  eq(lf[0].invested, 120, "N12 and what it recorded as invested");
  eq(lf[0].meta.source, "live", "N13 it is still a live record");

  eq(S.planSplitBackfill(stored, "2026-08-09", {}).length, 0,
     "N14 with no per-portfolio series there is nothing to patch in, and no row is touched");
  eq(S.planSplitBackfill(null, "2026-08-09", splits).length, 0, "N15 no rows, no work");
  eq(S.planSplitBackfill([{ snapshot_date: "2020-01-31", total: 5, by_portfolio: null }],
     "2026-08-09", splits).length, 0,
     "N16 a date the reconstruction cannot reach is skipped rather than given an empty split");
  eq(S.planSplitBackfill(stored, "2026-08-09", splits, 1).length, 1, "N17 the limit caps the batch");
  eq(S.planSplitBackfill(stored, "2026-08-09", splits, 1)[0].snapshot_date, "2026-06-30",
     "N18 keeping the most recent, as the backfill does");
}

// ── Re-reconstructing rows the valuation has moved past ─────────────────────
// A backfilled row is a derivation. When the app learns to value something it
// was ignoring — accrued interest on a deposit, say — every stored
// reconstruction keeps asserting the old figure, and planBackfill will not
// revisit a date it already has. A live row is a record and must survive the
// same pass untouched.
{
  const SERIES2 = [
    P(2026, 5, 30, 150), P(2026, 6, 30, 170), P(2026, 7, 31, 190),
    P(2026, 8, 9, 220),   // current month, never a month end
  ];
  const SPLITS = {
    Snnehal: [P(2026, 5, 30, 90), P(2026, 6, 30, 100), P(2026, 7, 31, 110)],
    Trisha: [P(2026, 5, 30, 60), P(2026, 6, 30, 70), P(2026, 7, 31, 80)],
  };
  const stored = [
    // Written before the valuation improved: too low, by the interest it missed.
    { snapshot_date: "2026-06-30", total: 165, by_portfolio: { Snnehal: 97, Trisha: 68 },
      meta: { source: "backfill", backfilled: true } },
    // Already right — must not be rewritten just for being a reconstruction.
    { snapshot_date: "2026-07-31", total: 190, by_portfolio: { Snnehal: 110, Trisha: 80 },
      meta: { source: "backfill", backfilled: true } },
    // A record of a day the dashboard was open. Lower than the reconstruction,
    // and it stays that way.
    { snapshot_date: "2026-05-30", total: 140, invested: 100, equity: 60,
      by_portfolio: { Snnehal: 80, Trisha: 60 }, meta: { source: "live" } },
  ];
  const plan = S.planRefreshBackfill(stored, SERIES2, "2026-08-09", SPLITS);

  eq(plan.length, 1, "RB1 only the reconstruction that would now say something different");
  eq(plan[0].snapshot_date, "2026-06-30", "RB2 specifically the stale one");
  eq(plan[0].total, 170, "RB3 rewritten to what the series says that month end was worth");
  eq(plan[0].by_portfolio.Snnehal, 100, "RB4 with the split re-derived too");
  eq(plan[0].meta.source, "backfill", "RB5 and still flagged as a reconstruction");
  ok(!plan.some((r) => r.snapshot_date === "2026-05-30"),
     "RB6 the live row is untouched — a record is not rewritten because a " +
     "derivation of the same day now disagrees with it", plan);
  ok(!plan.some((r) => r.snapshot_date === "2026-07-31"),
     "RB7 nor is a reconstruction that already matches", plan);

  // A reconstruction whose split never arrived is refreshed even when its total
  // is right — otherwise the portfolio filter stays blank for that month.
  const noSplit = S.planRefreshBackfill(
    [{ snapshot_date: "2026-07-31", total: 190, by_portfolio: null,
       meta: { source: "backfill" } }], SERIES2, "2026-08-09", SPLITS);
  eq(noSplit.length, 1, "RB8 a right-but-splitless reconstruction is still refreshed");
  eq(noSplit[0].by_portfolio.Trisha, 80, "RB9 to gain the split it was missing");

  // Sub-rupee drift must not rewrite the whole table on every load.
  const noise = S.planRefreshBackfill(
    [{ snapshot_date: "2026-06-30", total: 170.004, by_portfolio: { Snnehal: 100, Trisha: 70 },
       meta: { source: "backfill" } }], SERIES2, "2026-08-09", SPLITS);
  eq(noise.length, 0, "RB10 floating-point noise is not a reason to rewrite a row");

  // A date the series no longer reaches says nothing about that month.
  const orphan = S.planRefreshBackfill(
    [{ snapshot_date: "2019-03-31", total: 5, meta: { source: "backfill" } }],
    SERIES2, "2026-08-09", SPLITS);
  eq(orphan.length, 0,
     "RB11 a month the series no longer covers is left alone rather than blanked");

  eq(S.planRefreshBackfill(stored, [], "2026-08-09", SPLITS).length, 0,
     "RB12 with no series there is nothing to re-reconstruct from");
  eq(S.planRefreshBackfill(null, SERIES2, "2026-08-09", SPLITS).length, 0, "RB13 no rows, no work");
  eq(S.planRefreshBackfill(stored, SERIES2, "2026-08-09", SPLITS, 0).length, 0,
     "RB14 the limit caps the batch");

  // The current month is not a month end, so a row dated inside it is not
  // something this pass has an opinion about.
  const thisMonth = S.planRefreshBackfill(
    [{ snapshot_date: "2026-08-09", total: 1, meta: { source: "backfill" } }],
    SERIES2, "2026-08-09", SPLITS);
  eq(thisMonth.length, 0, "RB15 and the month in progress is left out of it");
}

{
  // Zero/negative points would otherwise record a net worth of nothing on days
  // the series simply has no data for.
  const withGap = [P(2026, 5, 30, 0), P(2026, 6, 30, 170)];
  const me = S.monthEndPoints(withGap, "2026-08-09");
  eq(me.length, 1, "B16 non-positive points are not month ends");
  eq(me[0].snapshot_date, "2026-06-30", "B17 the real one survives");
}

// Every read-back call passes an explicit "today" far in the future, so the
// fixtures' months always count as completed. Without it these tests quietly
// change meaning as the calendar moves: a fixture written in July starts
// exercising the current-month exclusion in August.
const FUTURE = "2099-01-01";
const series = (rows) => S.monthEndSeries(rows, FUTURE);
const chg = (rows, c, i, cash) => S.buildMonthlyChange(rows, c, i, FUTURE, cash);

// ── Reading back: month-end series ──────────────────────────────────────────
const R = (date, total, extra) => Object.assign({ snapshot_date: date, total, meta: { source: "live" } }, extra || {});
{
  const s = series([
    R("2026-06-02", 100), R("2026-06-30", 150), R("2026-06-15", 120),
    R("2026-07-31", 200)
  ]);
  eq(s.length, 2, "M1 one row per month");
  eq(s[0].total, 150, "M2 the LATEST snapshot in the month wins, whatever order they arrive in");
  eq(s[0].month, "2026-06", "M3 keyed by month");
  eq(s[1].total, 200, "M4 oldest first");
}
{
  // Postgres hands dates back as timestamps often enough that slicing matters.
  const s = series([R("2026-06-30T00:00:00+05:30", 150)]);
  eq(s.length, 1, "M5 a timestamp-shaped date is accepted");
  eq(s[0].date, "2026-06-30", "M6 and trimmed to the day");
}
{
  const s = series([R("garbage", 1), R("2026-06-30", null), R("2026-07-31", 200)]);
  eq(s.length, 1, "M7 unparseable dates and non-numeric totals are dropped, not rendered as 0");
}
{
  const s = series([R("2026-06-30", 150, { meta: { source: "backfill", backfilled: true } })]);
  eq(s[0].backfilled, true, "M8 reconstructions are surfaced to the renderer");
  eq(series([R("2026-06-30", 150)])[0].backfilled, false, "M9 recorded ones are not");
}
{
  // numeric() comes back from PostgREST as a string.
  const s = series([R("2026-06-30", "150.5", { equity: "100.25", invested: "" })]);
  eq(s[0].total, 150.5, "M10 string totals are coerced");
  eq(s[0].equity, 100.25, "M11 so are string categories");
  eq(s[0].invested, null, "M12 and an empty one stays null rather than becoming 0");
}

// ── Reading back: monthly change ────────────────────────────────────────────
{
  const rows = [R("2026-05-31", 1000000), R("2026-06-30", 1200000), R("2026-07-31", 1150000)];
  const c = { "2026-06": 90000, "2026-07": 90000 };
  const out = chg(rows, c);
  eq(out.length, 3, "C1 one row per month");
  eq(out[0].month, "2026-07", "C2 newest first — the order it is read in");

  eq(out[0].delta, -50000, "C3 change is against the previous month's snapshot");
  eq(out[0].contributions, 90000, "C4 contributions come from the transaction sheets");
  eq(out[0].market, -140000,
     "C5 market movement is the remainder: you added 90k and still finished 50k down");

  eq(out[1].delta, 200000, "C6 the up month");
  eq(out[1].market, 110000, "C7 of which 110k was the market");

  eq(out[2].delta, null, "C8 the oldest row has nothing to compare against");
  eq(out[2].market, null, "C9 and no attribution is invented for it");
}
{
  // The gap case. Skipping the dashboard for two months must not book those
  // months' investing as market movement.
  const rows = [R("2026-05-31", 1000000), R("2026-08-31", 1400000)];
  const c = { "2026-06": 50000, "2026-07": 50000, "2026-08": 50000 };
  const out = chg(rows, c);
  eq(out[0].gapMonths, 3, "C10 the gap is reported");
  eq(out[0].contributions, 150000,
     "C11 contributions are summed across the whole gap, not just the closing month");
  eq(out[0].market, 250000, "C12 leaving the market with the rest");
}
{
  // The earlier endpoint's own month is already inside its total.
  const rows = [R("2026-05-31", 1000000), R("2026-06-30", 1100000)];
  const out = chg(rows, { "2026-05": 999999, "2026-06": 40000 });
  eq(out[0].contributions, 40000,
     "C13 May's contributions are NOT counted again — they are already in May's total");
}
{
  const rows = [R("2026-05-31", 100, { meta: { source: "backfill", backfilled: true } }),
                R("2026-06-30", 150)];
  const out = chg(rows, {});
  eq(out[0].estimated, true,
     "C14 an attribution against a reconstructed endpoint is flagged — half of it is not a record");
  eq(out[0].delta, 50, "C15 but it is still computed");
}
{
  const rows = [R("2026-05-31", 100), R("2026-06-30", 150)];
  eq(chg(rows, {})[0].estimated, false,
     "C16 two recorded endpoints are not flagged");
  eq(chg(rows, {})[0].contributions, 0,
     "C17 a month with no transactions contributes zero, not null");
  eq(chg(rows, {})[0].market, 50, "C18 so all of it was the market");
}
{
  eq(chg([], {}).length, 0, "C19 no snapshots, no rows");
  eq(chg(null, null).length, 0, "C20 and null inputs do not throw");
  eq(chg([R("2026-06-30", 100)], {}).length, 1,
     "C21 a single snapshot still renders — it just has no change yet");
}
{
  // A year boundary in the gap walk.
  const rows = [R("2025-11-30", 100), R("2026-02-28", 400)];
  const out = chg(rows, { "2025-12": 10, "2026-01": 20, "2026-02": 30 });
  eq(out[0].gapMonths, 3, "C22 gaps count across a year boundary");
  eq(out[0].contributions, 60, "C23 and pick up every month in it");
}

// ── Interest as a third term ────────────────────────────────────────────────
// A fixed deposit compounding at 7% does not care what equities did. Leaving
// its accrual in the residual credited price movement for it.
{
  const rows = [R("2026-03-31", 1000000), R("2026-04-30", 1100000)];
  const two = chg(rows, { "2026-04": 40000 });
  const three = chg(rows, { "2026-04": 40000 }, { "2026-04": 25000 });
  eq(two[0].market, 60000, "I1 (baseline) with two terms the deposit interest lands in market");
  eq(three[0].interest, 25000, "I2 with three it is named");
  eq(three[0].market, 35000, "I3 and taken out of the residual");
  eq(three[0].contributions, 40000, "I4 contributions are untouched by it");
  eq(three[0].delta, 100000, "I5 and the three terms still sum to the change");
  ok(three[0].contributions + three[0].interest + three[0].market === three[0].delta,
     "I6 exactly — the bar segments must total the bar");
}
{
  // Omitting the argument must not change any existing answer.
  const rows = [R("2026-03-31", 100), R("2026-04-30", 150)];
  const a = chg(rows, { "2026-04": 20 });
  eq(a[0].interest, 0, "I7 no interest series means no interest");
  eq(a[0].market, 30, "I8 and the model collapses to the original two terms");
}
{
  // Interest accrues across a skipped month too.
  const rows = [R("2026-01-31", 1000), R("2026-04-30", 2000)];
  const out = chg(rows, {},
    { "2026-02": 10, "2026-03": 10, "2026-04": 10, "2026-01": 999 });
  eq(out[0].interest, 30, "I9 interest is summed across a gap, and the earlier month excluded");
}
{
  const rows = [R("2026-03-31", 1000000), R("2026-04-30", 990000)];
  const out = chg(rows, {}, { "2026-04": 5000 });
  eq(out[0].market, -15000,
     "I10 a month that earned interest and still fell lost MORE than the headline says");
}

// accruedBetween — the same holdings, valued at two dates.
{
  eq(S.accruedBetween({ a: 100, b: 200 }, { a: 107, b: 214 }), 21,
     "A1 accrual is the difference across matched holdings");
  eq(S.accruedBetween({ a: 100 }, { a: 107, b: 500000 }), 7,
     "A2 a deposit opened during the month is skipped — its principal is not interest");
  eq(S.accruedBetween({ a: 100, b: 500000 }, { a: 107 }), 7,
     "A3 and one that matured is skipped too — its principal leaving is not a loss");
  eq(S.accruedBetween({}, {}), 0, "A4 nothing held, nothing accrued");
  eq(S.accruedBetween(null, { a: 1 }), 0, "A5 a missing earlier valuation yields nothing, not the whole balance");
  eq(S.accruedBetween({ a: 200 }, { a: 100 }), -100,
     "A6 a fall is reported as it is rather than clamped — it would mean the input is wrong");
}

// ── Idle cash as its own term ───────────────────────────────────────────────
// Investment Corpus and Savings Account stay IN the totals, so the card
// reconciles with the Overview — but their movement is named rather than left
// in the residual, where the market would be credited for money merely moved.
{
  const rows = [R("2026-03-31", 1000000), R("2026-04-30", 1100000)];
  // ₹50,000 moved from a fund into savings: net worth is unchanged by the move
  // itself, the idle balance rose 50k, and the fund sale is a negative
  // contribution. The market gets neither.
  const out = chg(rows, { "2026-04": -50000 }, {}, { "2026-04": 50000 });
  eq(out[0].delta, 100000, "K1 the change is the change in net worth, cash included");
  eq(out[0].idle, 50000, "K2 the idle-cash movement is named");
  eq(out[0].contributions, -50000, "K3 alongside the sale that funded it");
  eq(out[0].market, 100000, "K4 leaving the market only what it actually did");
  ok(out[0].contributions + out[0].interest + out[0].idle + out[0].market === out[0].delta,
     "K5 and the four movement terms sum to the change", out[0]);
}
{
  const rows = [R("2026-03-31", 100), R("2026-04-30", 400)];
  const out = chg(rows, {}, {}, { "2026-04": 200 });
  eq(out[0].idle, 200, "K6 corpus and savings arrive as one figure");
  eq(out[0].market, 100, "K7 with the rest left to the market");
}
{
  // Omitting the argument must leave every earlier answer untouched.
  const rows = [R("2026-03-31", 100), R("2026-04-30", 150)];
  const a = chg(rows, { "2026-04": 20 });
  eq(a[0].idle, 0, "K9 no cash series, no cash movement");
  eq(a[0].market, 30, "K11 and the model collapses to what it was");
}
{
  // A balance that falls is money taken out, not a market loss.
  const rows = [R("2026-03-31", 1000), R("2026-04-30", 900)];
  const out = chg(rows, {}, {}, { "2026-04": -100 });
  eq(out[0].idle, -100, "K12 a falling balance is a withdrawal");
  eq(out[0].market, 0, "K13 and the market is untouched by it");
}

// monthlyDeltas — a running balance yields flows only by difference.
{
  const f = S.monthlyDeltas({ "2026-03": 100000, "2026-04": 150000, "2026-05": 120000 });
  eq(f["2026-04"], 50000, "K14 a rising balance is money in");
  eq(f["2026-05"], -30000, "K15 a falling one, money out");
  eq(f["2026-03"], 100000, "K16 the first month counts in full");
  eq(Object.keys(S.monthlyDeltas(null)).length, 0, "K17 no balances, no flows");
  eq(S.monthlyDeltas({ "2026-04": 5, "2026-03": 5 })["2026-04"], 0,
     "K18 months are ordered before differencing, and no change is no flow");
}

// ── The current month is not a month end ────────────────────────────────────
// Its latest snapshot is today. Charting it puts a part-month beside full ones
// and produces a bar that grows between visits, so it waits until the month
// finishes. planBackfill has always taken this view; this is the reader agreeing.
{
  const rows = [R("2026-06-30", 100), R("2026-07-31", 150), R("2026-08-09", 175)];
  const s = S.monthEndSeries(rows, "2026-08-09");
  eq(s.length, 2, "E1 the month in progress is not in the series");
  eq(s[s.length - 1].month, "2026-07", "E2 the newest is the last completed month");
  eq(S.monthEndSeries(rows, "2026-09-01").length, 3,
     "E3 and it joins once the month has finished — the snapshot is not discarded");

  const out = S.buildMonthlyChange(rows, {}, {}, "2026-08-09");
  eq(out.length, 2, "E4 no bar for it either");
  eq(out[0].month, "2026-07", "E5 the newest bar is July");
  ok(!out.some((r) => r.month === "2026-08"),
     "E6 specifically, nothing part-month is charted", out.map((r) => r.month));
}

// ── What moved a month, by Instrument Category ──────────────────────────────
// The parts must SUM to the bar, not approach it. That is only true because
// every term is a partition of what the card already computes for the month as
// a whole — the stored category columns, the contributions rollup from the same
// pass as the total, and interest/idle which are Fixed Income by definition.
{
  const row = (d, e, f, c, mkt) => ({ date: d, month: d.slice(0, 7),
    equity: e, fixed_income: f, commodity: c, market: mkt });
  // Contributions arrive as the whole month → category map; these fixtures are
  // consecutive months, so only July's slice is ever charged.
  const jul = (g) => ({ "2026-07": g });

  // Nothing bought or accrued: the whole change is market, per category.
  const a = S.categoryChange(row("2026-07-31", 110000, 52000, 9000, 9000),
                             row("2026-06-30", 100000, 50000, 12000), {}, 0, 0);
  eq(a.rows.length, 3, "CC1 all three categories reported", a.rows);
  eq(a.rows[0].market, 10000, "CC2 equity's gain is its own change");
  eq(a.rows[1].market, 2000, "CC3 fixed income's likewise");
  eq(a.rows[2].market, -3000, "CC4 and commodity's loss");
  eq(a.attributed, 9000, "CC5 which together are the month's movement");
  eq(a.residual, 0, "CC6 leaving nothing unexplained");

  // Money in is not a gain: ₹20,000 into equity, value up ₹25,000.
  const b = S.categoryChange(row("2026-07-31", 125000, 50000, 0, 5000),
                             row("2026-06-30", 100000, 50000, 0),
                             jul({ Equity: 20000 }), 0, 0);
  eq(b.rows[0].market, 5000, "CC7 the contribution comes out before the rest is called market");
  eq(b.rows[0].contributions, 20000, "CC8 and is reported beside it");
  eq(b.residual, 0, "CC9 reconciling");
  eq(b.rows[0].bought, 20000,
     "CC9a a bare number is money in — the shape a caller with only one figure has");
  eq(b.rows[0].sold, 0, "CC9b and nothing out");

  // A month that BOUGHT and SOLD. The reported symptom: 86,878 of equity bought
  // and 31,502 sold showed as 55,376 here and 86,878 on CASH FLOW · MONTHLY,
  // under the same word, with nothing on screen explaining the gap. Both
  // figures are now reported; only the net may reach the market column, since
  // only the net moved the net worth.
  const t = S.categoryChange(row("2026-07-31", 160000, 0, 0, 4624),
                             row("2026-06-30", 100000, 0, 0),
                             { "2026-07": { Equity: { in: 86878, out: 31502 } } }, 0, 0);
  eq(t.rows[0].bought, 86878,
     "CC9c Invested is money IN, the same figure CASH FLOW · MONTHLY shows " +
     "under that word — not the net, which read lower for no visible reason");
  eq(t.rows[0].sold, 31502, "CC9d and what was sold is reported beside it rather than folded in");
  eq(t.rows[0].contributions, 55376, "CC9e the net is still carried, for the arithmetic");
  eq(t.rows[0].market, 4624,
     "CC9f which is what comes out of market — netting is right for the sum " +
     "and wrong for the label, so it is done for one and not the other");
  eq(t.residual, 0, "CC9g and the month still reconciles");

  // Buying and selling the same amount is not a quiet month, and must not
  // render as one.
  const u = S.categoryChange(row("2026-07-31", 100000, 0, 0, 0),
                             row("2026-06-30", 100000, 0, 0),
                             { "2026-07": { Equity: { in: 1000000, out: 1000000 } } }, 0, 0);
  eq(u.rows[0].bought, 1000000, "CC9h ten lakh in and ten lakh out is still reported");
  eq(u.rows[0].sold, 1000000, "CC9i on both sides");
  eq(u.rows[0].market, 0, "CC9j while the net effect on the month was nothing");

  // A deposit that only accrued: interest, not market, and only Fixed Income
  // can carry it.
  const c = S.categoryChange(row("2026-07-31", 100000, 53000, 0, 0),
                             row("2026-06-30", 100000, 50000, 0), {}, 3000, 0);
  eq(c.rows[1].market, 0, "CC10 a deposit's growth is interest, not a market gain");
  eq(c.rows[1].interest, 3000, "CC11 carried on the Fixed Income row");
  eq(c.rows[0].interest, 0, "CC12 and never on Equity — interest is Fixed Income by definition");
  eq(c.attributed, 0, "CC13 contributing nothing to market");

  // Idle cash moves the Fixed Income column without being market either.
  const d = S.categoryChange(row("2026-07-31", 100000, 80000, 0, 0),
                             row("2026-06-30", 100000, 50000, 0), {}, 0, 30000);
  eq(d.rows[1].market, 0, "CC14 parked cash is idle, not a market gain");
  eq(d.rows[1].idle, 30000, "CC15 and is named as such");

  // The residual is reported, never absorbed.
  const e = S.categoryChange(row("2026-07-31", 110000, 50000, 0, 12000),
                             row("2026-06-30", 100000, 50000, 0), {}, 0, 0);
  eq(e.attributed, 10000, "CC16 the parts add to what they add to");
  eq(e.market, 12000, "CC17 the card's figure is carried through unchanged");
  eq(e.residual, 2000,
     "CC18 and the difference is stated — spreading it across the categories " +
     "would make every row wrong to make the total look right");

  // A month whose either endpoint predates the category fill cannot be shown.
  const f = S.categoryChange(row("2026-07-31", 110000, 50000, 0, 0),
    { date: "2026-06-30", month: "2026-06", equity: null, fixed_income: null, commodity: null },
    {}, 0, 0);
  eq(f.rows.length, 0, "CC19 no breakdown when an endpoint has no categories");
  eq(f.missing.length, 1, "CC20 and the offending date is named, not guessed at", f.missing);
  eq(f.missing[0], "2026-06-30", "CC21 specifically which end is at fault");

  ok(S.categoryChange(null, row("2026-06-30", 1, 1, 1), {}, 0, 0) === null,
     "CC22 no row, no breakdown");
  ok(S.categoryChange(row("2026-07-31", 1, 1, 1, 0), null, {}, 0, 0) === null,
     "CC23 nor without a month to measure from");

  // A category the household has never held earns no row.
  const g = S.categoryChange(row("2026-07-31", 110000, 0, 0, 10000),
                             row("2026-06-30", 100000, 0, 0), {}, 0, 0);
  eq(g.rows.length, 1, "CC24 a category with nothing on either side is left out", g.rows);
  eq(g.rows[0].category, "Equity", "CC25 leaving the one that moved");

  // A bar that spans a gap. Snapshots for January and April only; ₹15,000 into
  // equity in each of February, March and April. The bar is charged for all
  // three, so the breakdown must be too — charging it for April alone leaves
  // ₹30,000 of investing to be called a market gain, and the two numbers on
  // screen disagree by that much on precisely the months a user opens after
  // being away.
  const gapRows = [
    { snapshot_date: "2026-01-31", total: 100000, equity: 100000, fixed_income: 0, commodity: 0 },
    { snapshot_date: "2026-04-30", total: 160000, equity: 160000, fixed_income: 0, commodity: 0 }
  ];
  const perMonth = { "2026-02": 15000, "2026-03": 15000, "2026-04": 15000 };
  const perCat = { "2026-02": { Equity: 15000 }, "2026-03": { Equity: 15000 },
                   "2026-04": { Equity: 15000 } };
  const gapBars = S.buildMonthlyChange(gapRows, perMonth, {}, "2026-05-15", {});
  const apr = gapBars.find((b) => b.month === "2026-04");
  const janB = gapBars.find((b) => b.month === "2026-01");
  eq(apr.gapMonths, 3, "CC26 the bar covers three months", apr.gapMonths);
  eq(apr.contributions, 45000, "CC27 and is charged for all three months' investing");
  const h = S.categoryChange(apr, janB, perCat, apr.interest || 0, apr.idle || 0);
  eq(h.rows[0].contributions, 45000,
     "CC28 so the category is charged for the same three, not for April alone");
  eq(h.rows[0].market, 15000, "CC29 leaving the gain the bar actually reports");
  eq(h.residual, 0,
     "CC30 and the breakdown reconciles across the gap — this is the assertion " +
     "that fails if the two ever sum over different spans");

  // …and the chart has to hand categoryChange that same January. Its array has
  // a slot per calendar month, so the two months in the gap are placeholders
  // sitting between April and the row it was measured against.
  const slots = [
    janB,
    { month: "2026-02", delta: null },
    { month: "2026-03", delta: null },
    apr
  ];
  const prev = S.previousRecorded(slots, 3);
  ok(prev === janB,
     "CC31 the bar before a gap is the previous SNAPSHOT, not the previous slot",
     prev && prev.month);
  eq(S.categoryChange(apr, prev, perCat, apr.interest || 0, apr.idle || 0).residual, 0,
     "CC32 which is what lets the panel open at all — the placeholder has no " +
     "category columns, so index-1 would refuse to break down a month it can");
  ok(S.previousRecorded(slots, 0) === null,
     "CC33 and the earliest bar has nothing before it");
  ok(S.previousRecorded([{ month: "2026-01", delta: null, total: 100000 }, apr], 1) !== null,
     "CC34 while a real row with a null delta — the first month ever recorded — " +
     "is still a row, not a placeholder");

  // Contribution categories are whatever the mapping sheet says. The stored
  // columns are only ever three, so a sheet that says "Debt" has to fold the
  // same way the valuation walk folded it — or the deposit it names comes out
  // as a market gain of the same size.
  const deposit = (label) => S.categoryChange(
    row("2026-07-31", 100000, 60000, 0, 0),
    row("2026-06-30", 100000, 50000, 0),
    { "2026-07": { [label]: 10000 } }, 0, 0);
  ["Fixed Income", "fixed income", "FIXED INCOME", "Fixed  Income", " Fixed Income "]
    .forEach((label, i) => {
      const z = deposit(label);
      eq(z.rows[1].contributions, 10000,
         "CC35." + i + ' "' + label + '" is the Fixed Income column');
      eq(z.rows[1].market, 0, "CC36." + i + " so the deposit is not a market gain");
      eq(z.residual, 0, "CC37." + i + " and the month reconciles");
    });
  // An unrecognised name goes where the valuation walk put its value: equity.
  // Not because that is right, but because the two must agree — a category the
  // stored columns cannot represent has to land in the same place on both sides.
  const other = S.categoryChange(row("2026-07-31", 110000, 50000, 0, 0),
                                 row("2026-06-30", 100000, 50000, 0),
                                 { "2026-07": { "Real Estate": 10000 } }, 0, 0);
  eq(other.rows[0].contributions, 10000,
     "CC38 an unrecognised category folds into Equity, matching the walk");
  eq(other.residual, 0, "CC39 leaving nothing to be called a market gain");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
