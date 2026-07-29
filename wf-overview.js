// wf-overview.js — pure Overview aggregation. No DOM, no network, no globals.
//
// Step 1 of the overview-orchestrator refactor: the arithmetic that turns the
// four per-asset-class slices (mutual funds, stocks/ETF, fixed income, commodity)
// into the Overview header numbers and the category-card numbers is extracted
// here as ONE pure function, so it can be unit-tested without a browser (see
// tests/test-overview-aggregate.js).
//
// Why this matters: these totals were previously derived in three places
// (refreshOverviewStats, refreshCategoryCards, getOverviewCurrentTotal) that had
// to keep their exclusion-gating and invested-fallback rules manually in sync.
// Divergence between them is what produced the Overview day-change and phantom
// loss defects. One pure function = one place those rules can live.
//
// Loaded via a plain <script> tag BEFORE script.js. Exposes window.WfOverview
// (or globalThis.WfOverview under Node for the test harness).
(function (root) {
  "use strict";

  var ZERO = { invested: 0, current: 0, unrealized: 0, realized: 0, dayChange: 0 };

  // A slice may be null/undefined when its async flow hasn't resolved yet.
  // Missing fields default to 0 so a partially-populated slice is still safe.
  function norm(slice) {
    if (!slice) return ZERO;
    return {
      invested: +slice.invested || 0,
      current: +slice.current || 0,
      unrealized: +slice.unrealized || 0,
      realized: +slice.realized || 0,
      dayChange: +slice.dayChange || 0
    };
  }

  // Zero out a slice entirely — used for fixed income and commodity when the
  // "Exclude Fixed Income" toggle is on. Both live in the same sheet and are
  // gated together, so the header total, the category cards and the split
  // charts all agree.
  function gate(slice, excluded) { return excluded ? ZERO : slice; }

  // A class's `current` is populated by its own async flow (NAV fetch, gold
  // price, live stock prices). Until that resolves the field is 0 while its
  // *invested* is already known — so fall back to invested (0% P&L) rather than
  // 0, otherwise the Overview shows a phantom total loss for that class during
  // the fetch window.
  function currentOrCost(slice) {
    return slice.current > 0 ? slice.current : slice.invested;
  }

  function pct(current, invested) {
    return invested > 0 ? ((current - invested) / invested) * 100 : 0;
  }

  // aggregateOverview — derive every Overview figure from the four slices.
  //
  //   slices: { mf, se, fi, comm } — each { invested, current, unrealized,
  //           realized, dayChange } or null/undefined while still loading.
  //   opts:   { excludeFixedIncome: Boolean }
  //
  // Returns { invested, current, unrealized, returnPct, realized, dayChange,
  //           cards: { mf, se, fi } } where `cards.fi` is the combined
  //           fixed-income + commodity card.
  //
  // NOTE on a deliberate asymmetry preserved from the original code: the header
  // `current` applies the invested-fallback to every class, but the CATEGORY
  // CARDS apply it only to stocks/ETF. The MF and FI/commodity cards show their
  // raw current so an unresolved fetch reads as "—/0" on the card rather than
  // silently displaying cost as if it were market value. Changing that is a
  // product decision, not a refactor, so it is kept bit-identical here.
  function aggregateOverview(slices, opts) {
    slices = slices || {};
    var excluded = !!(opts && opts.excludeFixedIncome);

    var mf = norm(slices.mf);
    var se = norm(slices.se);
    var fi = gate(norm(slices.fi), excluded);
    var comm = gate(norm(slices.comm), excluded);
    // Debt funds and ETFs are tracked in the Mutual Fund and Stocks/ETF sheets but
    // belong to Fixed Income. Two buckets, not one, because the MF and Stocks/ETF
    // flows resolve independently — a single shared bucket would let whichever
    // finished last overwrite the other's contribution.
    // They are gated with fixed income, since that is what they are.
    var debtMf = gate(norm(slices.debtMf), excluded);
    var debtSe = gate(norm(slices.debtSe), excluded);
    var debt = {
      invested: debtMf.invested + debtSe.invested,
      current: debtMf.current + debtSe.current,
      unrealized: debtMf.unrealized + debtSe.unrealized,
      realized: debtMf.realized + debtSe.realized,
      dayChange: debtMf.dayChange + debtSe.dayChange
    };

    // --- Header ---------------------------------------------------------
    var invested = mf.invested + se.invested + fi.invested + comm.invested + debt.invested;
    var current = currentOrCost(mf) + currentOrCost(se) + currentOrCost(fi) + currentOrCost(comm) +
                  currentOrCost(debtMf) + currentOrCost(debtSe);
    var realized = mf.realized + se.realized + fi.realized + comm.realized + debt.realized;
    // Deposit-style fixed income has no intraday mark, but debt funds and ETFs do
    // — they are priced daily — so their day change still counts.
    var dayChange = mf.dayChange + se.dayChange + comm.dayChange + debt.dayChange;

    // --- Category cards -------------------------------------------------
    var seCardCurrent = currentOrCost(se);
    // The Fixed Income card carries the debt funds and ETFs that were taken out of
    // the Mutual Fund and Stocks/ETF cards, so the three cards still total net worth.
    var fiCardInvested = fi.invested + comm.invested + debt.invested;
    var fiCardCurrent = fi.current + comm.current + debt.current;

    return {
      invested: invested,
      current: current,
      unrealized: current - invested,
      returnPct: pct(current, invested),
      realized: realized,
      dayChange: dayChange,
      cards: {
        mf: {
          invested: mf.invested,
          current: mf.current,
          unrealized: mf.unrealized,
          realized: mf.realized,
          returnPct: pct(mf.current, mf.invested)
        },
        se: {
          invested: se.invested,
          current: seCardCurrent,
          unrealized: se.unrealized,
          realized: se.realized,
          dayChange: se.dayChange,
          returnPct: pct(seCardCurrent, se.invested)
        },
        fi: {
          invested: fiCardInvested,
          current: fiCardCurrent,
          unrealized: fi.unrealized + comm.unrealized + debt.unrealized,
          realized: fi.realized + comm.realized,
          returnPct: pct(fiCardCurrent, fiCardInvested)
        }
      }
    };
  }

  root.WfOverview = {
    aggregateOverview: aggregateOverview
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
