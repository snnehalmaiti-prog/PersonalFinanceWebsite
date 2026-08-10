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

  // ── Reading snapshots back ────────────────────────────────────────────────

  // One row per COMPLETED calendar month: the latest snapshot in it, oldest
  // first. Rows are normalised here so every consumer sees the same shape
  // whether they came from the database or a fixture.
  //
  // The current month is excluded. Its latest snapshot is today, which is not a
  // month end: charting it puts a part-month beside full ones, invites reading
  // their heights against each other, and produces a bar that grows between
  // visits. planBackfill has always taken that view; this is the reader agreeing
  // with it, rather than one half of the code calling today a month end and the
  // other half not.
  //
  // The daily snapshot is still recorded — it simply joins the series once the
  // month it belongs to has finished.
  function monthEndSeries(rows, todayKey) {
    if (!rows || !rows.length) return [];
    var curMonth = (todayKey || localDateKey()).slice(0, 7);
    var byMonth = {};
    rows.forEach(function (r) {
      if (!r) return;
      var date = String(r.snapshot_date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      // Number(null) is 0 and Number("") is 0, both finite — so the null check
      // has to come first or a row with no total renders as a net worth of zero.
      if (r.total == null || r.total === "") return;
      var total = Number(r.total);
      if (!isFinite(total)) return;
      var m = date.slice(0, 7);
      if (m >= curMonth) return;
      if (byMonth[m] && byMonth[m].date >= date) return;
      byMonth[m] = {
        month: m,
        date: date,
        total: total,
        invested: numOrNull(r.invested),
        equity: numOrNull(r.equity),
        fixed_income: numOrNull(r.fixed_income),
        commodity: numOrNull(r.commodity),
        by_portfolio: r.by_portfolio || null,
        backfilled: !!(r.meta && (r.meta.backfilled || r.meta.source === "backfill"))
      };
    });
    return Object.keys(byMonth).sort().map(function (m) { return byMonth[m]; });
  }

  function numOrNull(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  // Month-over-month change, split into what you put in and what the market did.
  //
  //   Δ net worth = contributions + market movement
  //
  // Both terms come from different places — the change from two snapshots, the
  // contributions from the transaction sheets — so market movement is what is
  // left over. That makes it only as good as its inputs, and the flags below say
  // when it isn't good:
  //
  //   estimated   one of the two endpoints is a reconstruction, so the change is
  //               partly derived from today's sheets and is not a record
  //   gapMonths   the previous snapshot is not the previous month; contributions
  //               are summed across the whole gap, but a longer gap means a
  //               coarser attribution
  //
  // contribByMonth maps "YYYY-MM" to NET contributions for that month
  // (investments minus withdrawals). A month missing from it contributes zero,
  // which is right: no transactions means no contributions.
  //
  // interestByMonth is the same shape for accrued income — deposit and provident
  // fund interest. It is taken OUT of the residual: interest is money the
  // portfolio earned by sitting still, and leaving it in "market" credited price
  // movement for it. Omit the argument and the model collapses to two terms.
  //
  // Returned newest first, which is the order it is read in.
  function buildMonthlyChange(rows, contribByMonth, interestByMonth, todayKey) {
    var series = monthEndSeries(rows, todayKey);
    var contrib = contribByMonth || {};
    var interest = interestByMonth || {};
    var out = series.map(function (row, i) {
      var prev = i > 0 ? series[i - 1] : null;
      var o = {
        month: row.month, date: row.date, total: row.total,
        invested: row.invested, equity: row.equity,
        fixed_income: row.fixed_income, commodity: row.commodity,
        by_portfolio: row.by_portfolio, backfilled: row.backfilled,
        delta: null, contributions: null, interest: null, market: null,
        estimated: false, gapMonths: 0
      };
      if (!prev) return o;
      o.delta = round2(row.total - prev.total);
      o.gapMonths = monthsBetween(prev.month, row.month);
      // Every month after the previous snapshot up to and including this one.
      // Using only this month's contributions across a gap would book the
      // skipped months' investing as market movement.
      var c = 0, inc = 0;
      eachMonthAfter(prev.month, row.month).forEach(function (m) {
        c += Number(contrib[m]) || 0;
        inc += Number(interest[m]) || 0;
      });
      o.contributions = round2(c);
      o.interest = round2(inc);
      o.market = round2(o.delta - c - inc);
      o.estimated = row.backfilled || prev.backfilled;
      return o;
    });
    return out.reverse();
  }

  // Interest accrued between two valuations of the SAME holdings.
  //
  // Both maps are keyed by holding. Only keys present in both count: a deposit
  // that did not exist at the earlier date has no accrual to measure, and
  // counting its whole principal as interest is precisely the mistake this
  // guards against. A holding that has since disappeared (matured, closed) is
  // dropped for the mirror-image reason — its principal leaving is not a loss.
  function accruedBetween(prevByKey, curByKey) {
    if (!prevByKey || !curByKey) return 0;
    var sum = 0;
    Object.keys(curByKey).forEach(function (k) {
      if (!(k in prevByKey)) return;
      var a = Number(prevByKey[k]) || 0, b = Number(curByKey[k]) || 0;
      sum += b - a;
    });
    return round2(sum);
  }

  // Restate each month's total net of an amount held in that month.
  //
  // Used to take parked cash (Savings Account / Investment Corpus) out of the
  // card entirely. Taking it out of the contributions leg alone would not do:
  // Market is the leftover, so every rupee moved into or out of savings would
  // resurface there as a price movement that never happened. Removing it from
  // BOTH sides is what keeps the five figures reconciling.
  //
  // The parked balance sits inside fixed_income, so that column is reduced with
  // the total; equity and commodity are untouched.
  function subtractByMonth(rows, byMonth) {
    if (!rows || !byMonth) return rows || [];
    return rows.map(function (r) {
      var m = String((r && r.snapshot_date) || "").slice(0, 7);
      var amt = Number(byMonth[m]) || 0;
      if (!amt) return r;
      var c = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) c[k] = r[k];
      c.total = round2((Number(r.total) || 0) - amt);
      if (r.fixed_income != null && r.fixed_income !== "") {
        c.fixed_income = round2((Number(r.fixed_income) || 0) - amt);
      }
      return c;
    });
  }

  function monthsBetween(a, b) {
    var pa = a.split("-"), pb = b.split("-");
    return (+pb[0] - +pa[0]) * 12 + (+pb[1] - +pa[1]);
  }

  // The months in (from, to] — exclusive of the earlier endpoint, inclusive of
  // the later one, because the earlier month's contributions are already inside
  // the earlier snapshot's total.
  function eachMonthAfter(from, to) {
    var out = [], y = +from.split("-")[0], m = +from.split("-")[1];
    for (var guard = 0; guard < 1200; guard++) {
      m++; if (m > 12) { m = 1; y++; }
      var key = y + "-" + (m < 10 ? "0" : "") + m;
      out.push(key);
      if (key >= to) break;
    }
    return out;
  }

  root.WfSnapshots = {
    monthEndSeries: monthEndSeries,
    buildMonthlyChange: buildMonthlyChange,
    accruedBetween: accruedBetween,
    subtractByMonth: subtractByMonth,
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
