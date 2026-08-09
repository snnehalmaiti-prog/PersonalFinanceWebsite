// wf-snapshots.js — net-worth snapshot rules, kept out of the DOM.
//
// A snapshot is a RECORD of what the portfolio was worth on a date, as opposed
// to the Account Value chart, which is a DERIVATION recomputed from the sheets
// on every load. That difference is the whole point of the feature: correcting a
// 2019 transaction today silently rewrites a derivation, but must not rewrite a
// record.
//
// Because a record is permanent, the interesting logic is not "what do we
// store" but "when do we refuse to store". The dashboard resolves progressively
// — mutual funds, then stocks, then gold — so the total is simply wrong for the
// first few seconds of every load, and writing it would bake that wrong number
// into history forever. Everything in evaluateWrite() exists to catch one such
// case. It is pure so each rule can be tested without a browser.
//
// Loaded as a plain global (no bundler), same as wf-math.js / wf-overview.js.
(function (root) {
  "use strict";

  // Local calendar date, NOT toISOString().slice(0,10).
  //
  // A dashboard opened at 01:30 IST is still 20:00 of the PREVIOUS day in UTC,
  // so the ISO form would file the snapshot under yesterday — and, worse, would
  // collide with the snapshot yesterday evening actually wrote, overwriting a
  // real record with a different day's number.
  function localDateKey(d) {
    var t = d == null ? new Date() : (d instanceof Date ? d : new Date(d));
    if (isNaN(t.getTime())) return null;
    var m = t.getMonth() + 1, day = t.getDate();
    return t.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function monthKey(d) {
    var k = localDateKey(d);
    return k ? k.slice(0, 7) : null;
  }

  // Two readings of the same total, taken a second apart, agree.
  //
  // Deliberately not an equality test: fixed-deposit interest accrues to "now",
  // so two reads a second apart legitimately differ by a rounding paisa. The
  // tolerance is relative and tiny (0.05%) — far below the jump caused by a
  // slice of the portfolio landing between the reads, which is what this is for.
  function isStable(a, b, relTol) {
    if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return false;
    var tol = relTol == null ? 0.0005 : relTol;
    return Math.abs(a - b) <= Math.max(1, Math.abs(a) * tol);
  }

  // Should this load write a snapshot, and if so what row?
  //
  // ctx:
  //   total, totalAgain  two readings of the Overview current total
  //   invested           Overview invested total
  //   breakdown          { equity, fixedIncome, commodity } for ALL portfolios
  //   byPortfolio        { name: {equity, fixedIncome, commodity} } (optional)
  //   portfolioFilter    the Overview's portfolio selector
  //   fiExcluded         the Fixed Income exclusion toggle
  //   savingsExcluded    the Savings-as-investment toggle
  //   goldStale          gold price came from a stale cache
  //   hasCommodity       the portfolio actually holds commodity
  //   dateKey            local date key for the row
  //   marketSource       { key: {source, at} } recorded for the row's meta
  //
  // Returns { write, reasons, row }. `reasons` is populated whether or not the
  // write proceeds, so a refusal can say why instead of failing silently.
  function evaluateWrite(ctx) {
    ctx = ctx || {};
    var reasons = [];

    // A snapshot is whole net worth. The Overview's totals follow its portfolio
    // selector, so with "Snnehal" selected `total` is one person's share — a
    // number that would be indistinguishable from a genuine crash in net worth
    // once stored.
    if ((ctx.portfolioFilter || "all") !== "all") reasons.push("portfolio-filtered");

    // Same argument for the exclusion toggles: with Fixed Income hidden the
    // total on screen is correct for what it claims to be, and wrong as history.
    if (ctx.fiExcluded) reasons.push("fixed-income-excluded");
    if (ctx.savingsExcluded) reasons.push("savings-excluded");

    if (!(ctx.total > 0)) reasons.push("no-total");
    else if (!isStable(ctx.total, ctx.totalAgain)) reasons.push("unstable");

    // Gold priced off a stale cache is a stored number that never happened.
    if (ctx.hasCommodity && ctx.goldStale) reasons.push("stale-gold");

    var b = ctx.breakdown || null;
    var parts = null;
    if (!b) reasons.push("no-breakdown");
    else {
      parts = {
        equity: b.equity || 0,
        fixed_income: b.fixedIncome || 0,
        commodity: b.commodity || 0
      };
      // The category breakdown and the Overview total are computed by different
      // code paths. They should agree; when they don't, one of them is mid-load
      // and there is no way to tell which — so store neither.
      var sum = parts.equity + parts.fixed_income + parts.commodity;
      if (ctx.total > 0 && !isStable(sum, ctx.total, 0.005)) reasons.push("breakdown-mismatch");
    }

    if (reasons.length) return { write: false, reasons: reasons, row: null };

    return {
      write: true,
      reasons: [],
      row: {
        snapshot_date: ctx.dateKey || localDateKey(),
        total: round2(ctx.total),
        invested: ctx.invested > 0 ? round2(ctx.invested) : null,
        equity: round2(parts.equity),
        fixed_income: round2(parts.fixed_income),
        commodity: round2(parts.commodity),
        by_portfolio: ctx.byPortfolio || null,
        meta: {
          source: "live",
          market: ctx.marketSource || null
        }
      }
    };
  }

  function round2(n) {
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  // Month-end points of the Account Value series: the last point in each
  // calendar month, oldest first.
  //
  // The current month is dropped — its "last point" is today, which is not a
  // month end and which the live writer owns. Including it would have the
  // backfill and the live write fight over the same date with different values.
  function monthEndPoints(points, todayKey) {
    if (!points || !points.length) return [];
    var curMonth = (todayKey || localDateKey()).slice(0, 7);
    var byMonth = {}, order = [];
    points.forEach(function (p) {
      if (!p || !isFinite(p.y) || p.y <= 0) return;
      var key = localDateKey(p.x);
      if (!key) return;
      var m = key.slice(0, 7);
      if (m >= curMonth) return;
      if (!byMonth[m]) order.push(m);
      byMonth[m] = { snapshot_date: key, total: round2(p.y) };
    });
    return order.sort().map(function (m) { return byMonth[m]; });
  }

  // Rows to write for a backfill: month ends not already recorded.
  //
  // Reconstructions are flagged. A backfilled row was computed from today's
  // sheets by exactly the derivation this feature exists to escape, so it
  // carries none of a real snapshot's guarantees — and the chart has to be able
  // to draw it differently, or the honesty is only in the comment.
  //
  // Only `total` is filled: the Account Value series is a single line and has no
  // category split, so writing zeros for equity/fixed_income/commodity would
  // invent a portfolio that was 100% nothing.
  function planBackfill(points, existingDates, todayKey, limit) {
    var have = {};
    (existingDates || []).forEach(function (d) { have[d] = true; });
    var rows = monthEndPoints(points, todayKey).filter(function (r) { return !have[r.snapshot_date]; });
    if (limit != null && rows.length > limit) rows = rows.slice(-limit);
    return rows.map(function (r) {
      return {
        snapshot_date: r.snapshot_date,
        total: r.total,
        invested: null, equity: null, fixed_income: null, commodity: null,
        by_portfolio: null,
        meta: { source: "backfill", backfilled: true }
      };
    });
  }

  root.WfSnapshots = {
    localDateKey: localDateKey,
    monthKey: monthKey,
    isStable: isStable,
    evaluateWrite: evaluateWrite,
    monthEndPoints: monthEndPoints,
    planBackfill: planBackfill
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).WfSnapshots;
}
