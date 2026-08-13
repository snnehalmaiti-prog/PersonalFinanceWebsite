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
  // byPortfolioPoints, when given, maps a portfolio name to its own series over
  // the same dates. Each month end then carries { name: total } so the card can
  // be filtered by portfolio across reconstructed history too — without it, a
  // portfolio selection would show nothing until months were recorded live.
  //
  // Only totals, not the category split: the Account Value series is a single
  // line per portfolio and has no split to record.
  function planBackfill(points, existingDates, todayKey, limit, byPortfolioPoints) {
    var have = {};
    (existingDates || []).forEach(function (d) { have[d] = true; });
    var rows = monthEndPoints(points, todayKey).filter(function (r) { return !have[r.snapshot_date]; });
    if (limit != null && rows.length > limit) rows = rows.slice(rows.length - limit);

    // Each portfolio's own month ends, keyed by date, so a row can look up its
    // own date rather than relying on the two series lining up by index.
    var byName = {};
    Object.keys(byPortfolioPoints || {}).forEach(function (name) {
      var m = {};
      monthEndPoints(byPortfolioPoints[name], todayKey).forEach(function (r) {
        m[r.snapshot_date] = r.total;
      });
      byName[name] = m;
    });
    var names = Object.keys(byName);

    return rows.map(function (r) {
      var split = null;
      names.forEach(function (name) {
        var v = byName[name][r.snapshot_date];
        if (v == null) return;
        (split = split || {})[name] = v;
      });
      return {
        snapshot_date: r.snapshot_date,
        total: r.total,
        invested: null, equity: null, fixed_income: null, commodity: null,
        by_portfolio: split,
        meta: { source: "backfill", backfilled: true }
      };
    });
  }

  // Rows that already exist but carry no by_portfolio split.
  //
  // planBackfill only writes dates it does not already have, so history written
  // before the card could filter stays split-less forever. forPortfolio drops
  // those rows, and a portfolio selection empties the card — the filter looks
  // broken while working exactly as written. This plans the repair: the same
  // reconstruction planBackfill would have used, patched into the rows that
  // predate it.
  //
  // What it will not do is restate a row. Everything the row already records is
  // carried forward unchanged — the upsert replaces the whole row, and a
  // recorded total is a record, not something a reconstruction may overwrite.
  // Rows whose date the reconstruction cannot reach are left alone rather than
  // given a partial split.
  function planSplitBackfill(rows, todayKey, byPortfolioPoints, limit) {
    var byName = {};
    Object.keys(byPortfolioPoints || {}).forEach(function (name) {
      var m = {};
      monthEndPoints(byPortfolioPoints[name], todayKey).forEach(function (r) {
        m[r.snapshot_date] = r.total;
      });
      byName[name] = m;
    });
    var names = Object.keys(byName);
    if (!names.length) return [];

    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.snapshot_date) return;
      if (r.by_portfolio && Object.keys(r.by_portfolio).length) return;
      var date = String(r.snapshot_date).slice(0, 10);
      var split = null;
      names.forEach(function (name) {
        var v = byName[name][date];
        if (v == null) return;
        (split = split || {})[name] = v;
      });
      if (!split) return;
      var meta = {};
      if (r.meta && typeof r.meta === "object") {
        Object.keys(r.meta).forEach(function (k) { meta[k] = r.meta[k]; });
      }
      // Says where the split came from, because it did not come from the same
      // place as the total: the total is what the row recorded, the split is a
      // reconstruction from today's sheets and may not add up to it exactly.
      meta.split_source = "backfill";
      out.push({
        snapshot_date: date,
        total: r.total,
        invested: r.invested == null ? null : r.invested,
        equity: r.equity == null ? null : r.equity,
        fixed_income: r.fixed_income == null ? null : r.fixed_income,
        commodity: r.commodity == null ? null : r.commodity,
        by_portfolio: split,
        meta: meta
      });
    });
    if (limit != null && out.length > limit) out = out.slice(out.length - limit);
    return out;
  }

  // Reconstructed rows, re-reconstructed.
  //
  // A backfilled row is a derivation, not a record: it was computed from the
  // sheets as they stood, by the valuation the app had at the time. When that
  // valuation improves — the day fixed deposits started carrying their accrued
  // interest, say — every stored reconstruction is left asserting something the
  // app no longer believes, and planBackfill will not revisit a date it already
  // has. A month end recorded months ago then reads lower than the same month
  // end on the chart beside it, with nothing to explain the gap.
  //
  // Live rows are never touched, and that is the point of the source check.
  // Those ARE records — what the portfolio was worth on a day the dashboard was
  // open — and no later improvement in how the past is reconstructed may
  // overwrite one. The whole reason the snapshot table exists is that a
  // derivation can be rewritten and a record cannot.
  function planRefreshBackfill(rows, points, todayKey, byPortfolioPoints, limit) {
    var fresh = {};
    monthEndPoints(points, todayKey).forEach(function (r) { fresh[r.snapshot_date] = r.total; });
    if (!Object.keys(fresh).length) return [];

    var byName = {};
    Object.keys(byPortfolioPoints || {}).forEach(function (name) {
      var m = {};
      monthEndPoints(byPortfolioPoints[name], todayKey).forEach(function (r) {
        m[r.snapshot_date] = r.total;
      });
      byName[name] = m;
    });
    var names = Object.keys(byName);

    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || !r.snapshot_date) return;
      var meta = r.meta;
      var reconstructed = !!(meta && (meta.backfilled || meta.source === "backfill"));
      if (!reconstructed) return;
      var date = String(r.snapshot_date).slice(0, 10);
      // A date the series no longer reaches says nothing about what that month
      // was worth — the row stays as it is rather than being blanked.
      var total = fresh[date];
      if (total == null) return;

      var split = null;
      names.forEach(function (name) {
        var v = byName[name][date];
        if (v == null) return;
        (split = split || {})[name] = v;
      });

      // Rewritten only when it would actually say something different. Rupee
      // tolerance, so floating-point noise does not rewrite the whole table on
      // every load.
      var totalMoved = Math.abs(Number(r.total) - total) >= 1;
      var splitMissing = !!split && !(r.by_portfolio && Object.keys(r.by_portfolio).length);
      if (!totalMoved && !splitMissing) return;

      out.push({
        snapshot_date: date,
        total: round2(total),
        invested: null, equity: null, fixed_income: null, commodity: null,
        by_portfolio: split || r.by_portfolio || null,
        meta: { source: "backfill", backfilled: true }
      });
    });
    if (limit != null && out.length > limit) out = out.slice(out.length - limit);
    return out;
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

  // What moved a month, split by Instrument Category.
  //
  // Every term is a partition of what the card already computes for the month
  // as a whole, which is why the parts sum to the bar rather than approaching
  // it:
  //
  //   Δcategory       the stored equity / fixed_income / commodity columns,
  //                   recorded in the same write as the total
  //   contributions   byMonthGrp, already rolled up by Instrument Category by
  //                   the same pass that produces the month's total
  //   interest        deposits and provident fund — all Fixed Income
  //   idle cash       Investment Corpus and Savings — all Fixed Income
  //
  //   market = Δcategory − contributions − interest − idle
  //
  // `contribByCatByMonth` is the WHOLE map, month → { category: amount }, not
  // one month's slice, because this function — not its caller — has to decide
  // which months a bar covers. A bar spanning a gap measures the change since
  // the last snapshot, so buildMonthlyChange sums contributions over every
  // month since then; taking only the bar's own month here would leave the
  // skipped months' investing to be called market gain. Passing one month's
  // slice reconciled perfectly on every consecutive bar and silently overstated
  // the gain on exactly the months a user is most likely to open — the ones
  // after a long absence. Both spans now come from eachMonthAfter, so they
  // cannot drift apart.
  //
  // Returns null when either endpoint has no category columns: those rows
  // predate the fill, and a breakdown cannot be invented for them. The caller
  // says so rather than guessing, and `missing` names which end is at fault.
  //
  // `residual` is the part of the month's change the three categories do not
  // account for — the stored columns are allowed to differ from the stored
  // total by up to the write guard's tolerance. It should be pennies; it is
  // reported rather than folded into a category, because spreading it would
  // make every row slightly wrong to make the total look exact.
  // Which of the three columns a category NAME belongs to.
  //
  // Contribution categories are whatever the mapping sheet says, verbatim —
  // "Fixed Income", but also "fixed income", "Debt", "Real Estate". The stored
  // columns are only ever three, and the walk that produced them sorts anything
  // it does not recognise into equity. Matching the label exactly meant a
  // contribution under any other spelling found no row, and its money came out
  // as a market gain: a ₹10,000 deposit booked as a ₹10,000 gain on a sheet
  // that says "Debt". Both sides now fold the same way, so they agree whatever
  // the sheet calls it.
  function catLabel(name) {
    var k = String(name == null ? "" : name).trim().toLowerCase().replace(/\s+/g, " ");
    if (k === "fixed income") return "Fixed Income";
    if (k === "commodity") return "Commodity";
    return "Equity";
  }

  function categoryChange(row, prevRow, contribByCatByMonth, interest, idle) {
    if (!row || !prevRow) return null;
    var CATS = [
      { key: "equity", label: "Equity" },
      { key: "fixed_income", label: "Fixed Income" },
      { key: "commodity", label: "Commodity" }
    ];
    var missing = [];
    if (row.equity == null) missing.push(row.date || row.month);
    if (prevRow.equity == null) missing.push(prevRow.date || prevRow.month);
    if (missing.length) return { rows: [], missing: missing };

    // Exactly the months buildMonthlyChange charged this bar for. Falling back
    // to the bar's own month when either end is unlabelled keeps a caller that
    // hands over bare rows working, rather than throwing inside a panel.
    // Bought and sold are carried SEPARATELY, as { in, out } per category, and
    // netted only where the arithmetic needs it.
    //
    // Only the net moves net worth, so only the net can come out of the market
    // figure. But reporting the net under the heading "Invested" put a number
    // beside CASH FLOW · MONTHLY's gross one, under the same word, with no way
    // to see why they differed: a month that bought 86,878 of equity and sold
    // 31,502 read as 55,376 here and 86,878 there. Netting also erases the
    // difference between a quiet month and one that bought and sold ten lakh.
    // Both figures are reported; the market column still uses in − out.
    var src = contribByCatByMonth || {};
    var flow = {};
    var months = (prevRow.month && row.month) ? eachMonthAfter(prevRow.month, row.month)
                                              : (row.month ? [row.month] : []);
    months.forEach(function (m) {
      var g = src[m];
      if (!g) return;
      Object.keys(g).forEach(function (cat) {
        var k = catLabel(cat);
        var v = g[cat];
        if (!flow[k]) flow[k] = { in: 0, out: 0 };
        // A bare number is money in, nothing out — the shape this took before
        // redemptions were reported, and what a caller with only one figure has.
        if (v && typeof v === "object") {
          flow[k].in += Number(v.in) || 0;
          flow[k].out += Number(v.out) || 0;
        } else {
          flow[k].in += Number(v) || 0;
        }
      });
    });
    var rows = [], attributed = 0;
    CATS.forEach(function (c) {
      var open = Number(prevRow[c.key]) || 0;
      var close = Number(row[c.key]) || 0;
      // Interest and idle cash are Fixed Income by definition — a deposit's
      // accrual and a savings balance are not equities or metal.
      var inc = c.key === "fixed_income" ? (Number(interest) || 0) : 0;
      var idl = c.key === "fixed_income" ? (Number(idle) || 0) : 0;
      var f = flow[c.label] || { in: 0, out: 0 };
      var con = round2(f.in - f.out);
      var mkt = round2((close - open) - con - inc - idl);
      if (!open && !close && !f.in && !f.out && !inc && !idl) return;   // nothing here at all
      rows.push({ category: c.label, opening: round2(open), closing: round2(close),
                  bought: round2(f.in), sold: round2(f.out), contributions: con,
                  interest: round2(inc), idle: round2(idl), market: mkt });
      attributed += mkt;
    });
    attributed = round2(attributed);
    var market = row.market == null ? null : round2(row.market);
    return {
      rows: rows,
      attributed: attributed,
      market: market,
      residual: market == null ? null : round2(market - attributed),
      missing: []
    };
  }

  // The bar a given bar's change was measured against.
  //
  // The chart's array has one slot per CALENDAR month, with placeholders where
  // no snapshot exists, so that a gap shows as empty space rather than two
  // adjacent months pretending to be consecutive. buildMonthlyChange measures
  // against the previous SNAPSHOT, which after a gap is not the previous slot.
  // Taking index-1 hands back a placeholder with no category columns, and the
  // breakdown refuses a month it could have explained — on exactly the months
  // that follow an absence.
  //
  // A placeholder is a slot with no total. Not "delta is null": the earliest
  // recorded month has a null delta too, and it is a real row.
  function previousRecorded(bars, i) {
    if (!bars || i == null) return null;
    for (var j = i - 1; j >= 0; j--) {
      if (bars[j] && bars[j].total != null) return bars[j];
    }
    return null;
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
  // idleByMonth is the movement in parked cash — Investment Corpus and Savings
  // Account together. Its own term rather than part of contributions: money
  // moved into a savings account is not investing, but it IS in net worth, so it
  // has to be named and subtracted or the market would be credited for it.
  function buildMonthlyChange(rows, contribByMonth, interestByMonth, todayKey, idleByMonth) {
    var series = monthEndSeries(rows, todayKey);
    var contrib = contribByMonth || {};
    var interest = interestByMonth || {};
    var idle = idleByMonth || {};
    var out = series.map(function (row, i) {
      var prev = i > 0 ? series[i - 1] : null;
      var o = {
        month: row.month, date: row.date, total: row.total,
        invested: row.invested, equity: row.equity,
        fixed_income: row.fixed_income, commodity: row.commodity,
        by_portfolio: row.by_portfolio, backfilled: row.backfilled,
        delta: null, contributions: null, interest: null, idle: null, market: null,
        estimated: false, gapMonths: 0
      };
      if (!prev) return o;
      o.delta = round2(row.total - prev.total);
      o.gapMonths = monthsBetween(prev.month, row.month);
      // Every month after the previous snapshot up to and including this one.
      // Using only this month's contributions across a gap would book the
      // skipped months' investing as market movement.
      var c = 0, inc = 0, idl = 0;
      eachMonthAfter(prev.month, row.month).forEach(function (m) {
        c += Number(contrib[m]) || 0;
        inc += Number(interest[m]) || 0;
        idl += Number(idle[m]) || 0;
      });
      o.contributions = round2(c);
      o.interest = round2(inc);
      o.idle = round2(idl);
      o.market = round2(o.delta - c - inc - idl);
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

  // Month-over-month change in a running balance.
  //
  // Savings and Investment Corpus rows are balances, not transactions — each
  // replaces the last — so the only flow they can yield is the difference. The
  // first month counts in full: that money arrived at or before it.
  //
  // What a typed balance cannot say is how much of a rise was deposited and how
  // much was interest the account paid. Both land here together.
  function monthlyDeltas(byMonthTotal) {
    var out = {};
    if (!byMonthTotal) return out;
    var prev = 0;
    Object.keys(byMonthTotal).sort().forEach(function (m) {
      var bal = Number(byMonthTotal[m]) || 0;
      out[m] = round2(bal - prev);
      prev = bal;
    });
    return out;
  }

  // Restate each row as one portfolio's share, from its stored by_portfolio
  // split. Rows without a figure for that portfolio are dropped rather than
  // shown as zero — "not recorded for this portfolio" and "this portfolio was
  // worth nothing" are different claims.
  //
  // The category columns go: the split stores totals only, and carrying the
  // household's equity/fixed_income onto one person's row would be wrong.
  function forPortfolio(rows, name) {
    if (!rows || !name || name === "all") return rows || [];
    var out = [];
    rows.forEach(function (r) {
      var bp = r && r.by_portfolio;
      if (!bp) return;
      var v = bp[name];
      // Live rows store a category object per portfolio; backfilled rows store
      // a plain total. Both are accepted, so history and records read alike.
      if (v && typeof v === "object") {
        v = (Number(v.equity) || 0) + (Number(v.fixed_income) || 0) + (Number(v.commodity) || 0);
      }
      if (v == null || !isFinite(Number(v))) return;
      out.push({
        snapshot_date: r.snapshot_date, total: round2(Number(v)),
        invested: null, equity: null, fixed_income: null, commodity: null,
        by_portfolio: null, meta: r.meta
      });
    });
    return out;
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
    categoryChange: categoryChange,
    previousRecorded: previousRecorded,
    buildMonthlyChange: buildMonthlyChange,
    accruedBetween: accruedBetween,
    monthlyDeltas: monthlyDeltas,
    forPortfolio: forPortfolio,
    localDateKey: localDateKey,
    monthKey: monthKey,
    isStable: isStable,
    evaluateWrite: evaluateWrite,
    monthEndPoints: monthEndPoints,
    planBackfill: planBackfill,
    planSplitBackfill: planSplitBackfill,
    planRefreshBackfill: planRefreshBackfill
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).WfSnapshots;
}
