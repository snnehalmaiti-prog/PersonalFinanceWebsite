// wf-math.js — pure financial math kernels. No DOM, no globals, no side effects.
// Extracted from script.js so this correctness-critical logic can be unit-tested
// in isolation (see tests/test-math.js). Loaded via a plain <script> tag BEFORE
// script.js; the app bridges these onto its own call sites.
//
// Exposes window.WfMath (or globalThis.WfMath under Node for the test harness).
(function (root) {
  "use strict";

  // Day-count convention shared by XIRR / CAGR / benchmark figures so they stay
  // mutually consistent. 365.25 averages in leap years.
  var DAYS_PER_YEAR = 365.25;
  var MS_PER_DAY = 1000 * 60 * 60 * 24;
  var MS_PER_YEAR = MS_PER_DAY * DAYS_PER_YEAR;

  // calculateXIRR — internal rate of return for irregularly-timed cash flows.
  //
  // Input: array of { date: Date, amount: Number } where amount < 0 is money out
  // (a buy/contribution) and amount > 0 is money in (a sell/redemption/terminal
  // value). Returns the annualised rate as a decimal (0.12 = 12%/yr), or null when
  // it can't be computed (fewer than 2 flows, or all-same-sign — no root exists).
  //
  // Method: Newton-Raphson from a 10% seed (fast when it converges), falling back
  // to bracketed bisection when Newton stalls or lands off-root. The upper bracket
  // grows geometrically so genuine extreme returns (>1000%/yr on very short
  // holdings) still resolve instead of returning null. Acceptance tolerance scales
  // with flow magnitude — an absolute ₹1 residual is below float precision for
  // crore-sized flows and would spuriously reject a valid root.
  function calculateXIRR(cashflows) {
    if (!cashflows || cashflows.length < 2) return null;
    var hasPositive = cashflows.some(function (c) { return c.amount > 0; });
    var hasNegative = cashflows.some(function (c) { return c.amount < 0; });
    if (!hasPositive || !hasNegative) return null;

    var t0 = cashflows.reduce(function (min, c) {
      return c.date.getTime() < min ? c.date.getTime() : min;
    }, cashflows[0].date.getTime());

    function yearsFromStart(date) {
      return (date.getTime() - t0) / MS_PER_YEAR;
    }

    function npv(rate) {
      return cashflows.reduce(function (sum, c) {
        return sum + c.amount / Math.pow(1 + rate, yearsFromStart(c.date));
      }, 0);
    }

    function npvDerivative(rate) {
      return cashflows.reduce(function (sum, c) {
        var t = yearsFromStart(c.date);
        if (t === 0) return sum;
        return sum - (t * c.amount) / Math.pow(1 + rate, t + 1);
      }, 0);
    }

    var _absScale = cashflows.reduce(function (s, c) { return s + Math.abs(c.amount); }, 0);
    var npvTol = Math.max(1, _absScale * 1e-9);

    var rate = 0.1;
    var converged = false;
    for (var i = 0; i < 100; i++) {
      var f = npv(rate);
      var fp = npvDerivative(rate);
      if (Math.abs(fp) < 1e-10) break;
      var nextRate = rate - f / fp;
      if (!isFinite(nextRate) || nextRate <= -0.999999) break;
      if (Math.abs(nextRate - rate) < 1e-7) { rate = nextRate; converged = true; break; }
      rate = nextRate;
    }

    if (!converged || !isFinite(rate) || Math.abs(npv(rate)) > npvTol) {
      var low = -0.999999, high = 10;
      var fLow = npv(low), fHigh = npv(high);
      var grow = 0;
      while (fLow * fHigh > 0 && high < 1e7 && grow < 40) {
        high *= 2; fHigh = npv(high); grow++;
      }
      if (fLow * fHigh > 0) return converged ? rate : null;
      for (var j = 0; j < 200; j++) {
        var mid = (low + high) / 2;
        var fMid = npv(mid);
        if (Math.abs(fMid) < npvTol) { rate = mid; break; }
        if ((fMid > 0) === (fLow > 0)) { low = mid; fLow = fMid; } else { high = mid; }
        rate = mid;
      }
    }
    return rate;
  }

  // fifoRemainingLots — replay buy/sell transactions, matching sells against the
  // oldest open buy lots (FIFO), and return the still-open buy lots.
  //
  // Input: array of { type: "buy"|"sell", units: Number, price: Number } in
  // chronological order. Returns [{ units, price }] for the unsold remainder.
  // NOTE: mutates the lot objects it creates internally (not the input txns).
  function fifoRemainingLots(txns) {
    var buyLots = [];
    txns.forEach(function (txn) {
      if (txn.type === "buy") {
        buyLots.push({ units: txn.units, price: txn.price });
        return;
      }
      var unitsToMatch = txn.units;
      while (unitsToMatch > 0 && buyLots.length) {
        var lot = buyLots[0];
        var matched = Math.min(unitsToMatch, lot.units);
        lot.units -= matched;
        unitsToMatch -= matched;
        if (lot.units <= 0) buyLots.shift();
      }
    });
    return buyLots;
  }

  // forwardFillOverTimeline — value-at-or-before every timeline date, in one linear
  // pass. Equivalent to calling a binary-search lastAtOrBefore(sortedEvents, date,
  // valueKey) for each date, but O(events + dates) instead of O(dates·log events),
  // by exploiting that BOTH the timeline and the events are sorted ascending.
  //
  // Preconditions: `timeline` (Array<Date>) and `sortedEvents` (Array<{date:Date}>)
  // are both ascending. Returns Array aligned to `timeline`: each entry is the
  // valueKey of the latest event whose date <= that timeline date, or null if none.
  function forwardFillOverTimeline(sortedEvents, timeline, valueKey) {
    var n = timeline ? timeline.length : 0;
    var out = new Array(n);
    var m = sortedEvents ? sortedEvents.length : 0;
    var p = -1; // index of the latest event with date <= the current timeline date
    for (var i = 0; i < n; i++) {
      var t = timeline[i];
      while (p + 1 < m && sortedEvents[p + 1].date <= t) p++;
      out[i] = p >= 0 ? sortedEvents[p][valueKey] : null;
    }
    return out;
  }

  // twrNavSeries — the portfolio performance curve, as a unit/NAV model.
  //
  // The account is treated as a fund. It opens with `baseNav` per unit (100 here,
  // so the chart reads "growth of ₹100"), and thereafter:
  //
  //   * money added creates units at the NAV the money entered at,
  //   * money withdrawn cancels units at the NAV it left at,
  //   * the NAV itself moves ONLY with the market.
  //
  // So a deposit changes the unit COUNT and never the unit PRICE, which is what
  // keeps cash flows out of the curve. Worked through: 10 units at ₹1,000 is an
  // account of ₹10,000; adding ₹5,000 creates 5 units at ₹1,000, giving 15 units
  // and ₹15,000 — the account grew 50% while the curve correctly stays flat.
  //
  // Equivalently, and how it is computed here (one pass, no accumulated rounding):
  //
  //   NAV(i) = NAV(i-1) × (value(i) − flows(i)) / value(i-1)
  //
  // — the same thing, since NAV(i) = (value(i) − flows(i)) / units(i-1) and
  // units(i) = value(i) / NAV(i). `units` is returned as well, for callers that
  // want to show it.
  //
  // Flows are valued at the NAV of the point they occur on, both ways. In this app
  // a "contribution" is a purchase, not a cash deposit that sits idle: the money
  // arrives and is deployed in the same transaction, at that transaction's own
  // price. A mutual fund order executes AT the day's NAV, so this is exact for
  // them. Crediting a purchase with the day's move instead (creating its units at
  // the PREVIOUS point's NAV) would hand it a return it did not earn — measured at
  // 133 where 200 was right, on a fund that doubled while being bought into.
  //
  // Points before the account has any value are null: there is no return to report
  // yet, and drawing a flat baseline through a period when nothing was invested
  // would claim one.
  //
  // Returns { nav, units, baseIndex, last }; baseIndex is -1 (everything null)
  // when the account never had value.
  function twrNavSeries(values, cumContrib, baseNav) {
    var start = baseNav > 0 ? baseNav : 100;
    var n = values ? values.length : 0;
    var nav = new Array(n), units = new Array(n);
    for (var z = 0; z < n; z++) { nav[z] = null; units[z] = null; }
    var base = 0;
    while (base < n && !(values[base] > 0)) base++;
    if (base >= n) return { nav: nav, units: units, baseIndex: -1, last: null };
    nav[base] = start;
    units[base] = values[base] / start;
    var prevNav = start;
    var prevValue = values[base];
    var prevContrib = (cumContrib && cumContrib[base]) || 0;
    for (var i = base + 1; i < n; i++) {
      var c = (cumContrib && cumContrib[i]) || 0;
      var flow = c - prevContrib;
      var value = values[i];
      // What the units already outstanding are worth now, before this point's own
      // money is added or taken out. That is the only part that reflects the market.
      var earned = value - flow;
      var v = prevNav;
      // prevValue <= 0: nothing was invested over this period (the account was
      // empty, or is being opened by this very flow) — no return to record, so
      // carry the NAV flat rather than dividing by zero. earned <= 0: a full exit;
      // likewise flat, the realised move having been taken in earlier periods.
      if (prevValue > 0 && earned > 0) v = prevNav * (earned / prevValue);
      nav[i] = v;
      units[i] = v > 0 ? value / v : units[i - 1];
      prevNav = v;
      prevValue = value;
      prevContrib = c;
    }
    return { nav: nav, units: units, baseIndex: base, last: prevNav };
  }

  // Split a US holding's INR gain into what the stock did and what the rupee did.
  //
  // An INR return is the product of two moves, not the sum: you bought dollars
  // at one rate and the shares moved in dollars. Writing the end value two ways
  //
  //   current(INR) − cost(INR) = P1·R1 − P0·R0
  //                            = R0·(P1 − P0)   ← the stock, at the rate you paid
  //                            + P1·(R1 − R0)   ← the rupee, on what you now hold
  //
  // where P is the USD amount and R the USD/INR rate. R0 is the cost-weighted
  // average rate actually paid across the lots — cost(INR) / cost(USD) — not
  // today's rate and not any single lot's.
  //
  // The cross term (a dollar gain revalued at a changed rate) is assigned to
  // currency, because R1 is applied to the whole ending position including that
  // gain. The alternative — giving it to the stock — is equally defensible and
  // gives different numbers, so the choice is stated rather than left implicit.
  //
  // Percentages compound rather than add: (1+stock)(1+fx) − 1 = total.
  function attributeFxReturn(costUsd, costInr, currentUsd, rateNow) {
    costUsd = Number(costUsd) || 0;
    costInr = Number(costInr) || 0;
    currentUsd = Number(currentUsd) || 0;
    rateNow = Number(rateNow) || 0;
    if (!(costUsd > 0) || !(costInr > 0) || !(rateNow > 0)) return null;

    var rateCost = costInr / costUsd;              // weighted average rate paid
    var currentInr = currentUsd * rateNow;
    var stockInr = rateCost * (currentUsd - costUsd);
    var fxInr = currentUsd * (rateNow - rateCost);
    return {
      rateCost: rateCost,
      rateNow: rateNow,
      costUsd: costUsd,
      costInr: costInr,
      currentUsd: currentUsd,
      currentInr: currentInr,
      stockInr: stockInr,
      fxInr: fxInr,
      totalInr: currentInr - costInr,
      stockPct: (currentUsd / costUsd - 1) * 100,
      fxPct: (rateNow / rateCost - 1) * 100,
      totalPct: (currentInr / costInr - 1) * 100
    };
  }

  // ── Liabilities ───────────────────────────────────────────────────────────
  //
  // What a liability still owes, measured as what is LEFT TO PAY on its plan:
  // the instalments not yet posted, each at its instalment amount. That is not
  // the amortised principal — it includes the interest inside every instalment
  // still to come — and it is deliberately so: it answers "how much money still
  // has to leave this account", which is the question the Overview's Current
  // figure is being netted against.
  //
  // A schedule with neither an instalment count nor an end date is open-ended:
  // there is no last payment to count back from, so it owes an unknown amount
  // and is reported as null rather than as zero. A caller that treated null as
  // zero would quietly claim an open-ended loan costs nothing.
  function liabilityRemainingCount(row) {
    if (!row) return null;
    var done = Number(row.installments_done) || 0;
    if (row.num_payments != null && row.num_payments !== "") {
      var n = Math.floor(Number(row.num_payments));
      if (isFinite(n) && n >= 0) return Math.max(0, n - done);
    }
    if (row.end_date && row.next_due) return countDuesThrough(row.next_due, row.end_date, row.frequency);
    return null;
  }

  // Instalments falling in [from, through] at the given frequency. Month steps
  // clamp to the last valid day of the target month, matching the processor
  // that actually posts them — otherwise a 31st-of-the-month schedule would be
  // counted on a different calendar from the one it is paid on.
  function countDuesThrough(fromIso, throughIso, frequency) {
    var from = String(fromIso).slice(0, 10), through = String(throughIso).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through)) return null;
    if (through < from) return 0;
    var start = new Date(from + "T00:00:00");
    var day = start.getDate();
    var freq = frequency || "monthly";
    var monthStep = { monthly: 1, quarterly: 3, yearly: 12 }[freq];
    var count = 0, cur = new Date(start.getTime());
    for (var guard = 0; guard < 5000; guard++) {
      var iso = cur.getFullYear() + "-" +
        String(cur.getMonth() + 1).padStart(2, "0") + "-" +
        String(cur.getDate()).padStart(2, "0");
      if (iso > through) break;
      count++;
      if (monthStep) {
        // Stepped from the START each time, not from the previous date: a
        // schedule clamped to Feb 28 must jump back to the 31st in March, not
        // stay on the 28th for the rest of its life.
        var y = start.getFullYear(), m = start.getMonth() + monthStep * count;
        var lastDay = new Date(y, m + 1, 0).getDate();
        cur = new Date(y, m, Math.min(day, lastDay));
      } else if (freq === "weekly") {
        cur = new Date(cur.getTime()); cur.setDate(cur.getDate() + 7);
      } else {
        cur = new Date(cur.getTime()); cur.setDate(cur.getDate() + 1);
      }
    }
    return count;
  }

  function liabilityRemaining(row) {
    var n = liabilityRemainingCount(row);
    if (n == null) return null;
    var amt = Number(row && row.amount) || 0;
    if (!(amt > 0)) return 0;
    return n * amt;
  }

  // How much debt each person carries, and the household total.
  //
  // A liability paid from a contributing (personal) account is that person's in
  // full. One paid from a joint account is not anybody's until the split says so
  // — the joint account is funded by the contributing accounts, and the split is
  // the record of in what proportion.
  //
  // `total` always counts the whole liability, whether or not it could be
  // attributed. `unattributed` is the part that reached no name: a joint-account
  // liability with no split, or a split naming an account that no longer exists.
  // Keeping it visible is the point — it is the difference between the household
  // figure and the sum of the individual ones.
  function liabilityDeductions(liabilities, accounts) {
    var byId = {};
    (accounts || []).forEach(function (a) { if (a && a.id) byId[a.id] = a; });
    var key = function (s) { return String(s == null ? "" : s).trim().toLowerCase(); };
    // `items` keeps each liability's own contribution, so a figure made of
    // several loans can say which ones — a total with no names is a number the
    // reader has to go and reconstruct from the settings page.
    var out = { total: 0, byName: {}, unattributed: 0, openEnded: 0, items: [] };
    var cur = null;
    var add = function (name, amt) {
      var k = key(name);
      if (!k) { out.unattributed += amt; if (cur) cur.unattributed += amt; return; }
      out.byName[k] = (out.byName[k] || 0) + amt;
      if (cur) cur.byName[k] = (cur.byName[k] || 0) + amt;
    };

    (liabilities || []).forEach(function (item) {
      if (!item || item._deleted) return;
      var row = item.row || {};
      var owed = liabilityRemaining(row);
      // Open-ended: counted as a liability that exists but whose size is not
      // known, so it moves no figure and is reported for the caller to surface.
      if (owed == null) { out.openEnded++; return; }
      if (!(owed > 0)) return;
      out.total += owed;
      cur = { name: item.name || "Liability", total: owed, byName: {}, unattributed: 0 };
      out.items.push(cur);

      var acct = row.account_id ? byId[row.account_id] : null;
      if (acct && acct.contributing_account) { add(acct.name, owed); cur = null; return; }

      var split = row.contribution_split;
      if (!split || !Object.keys(split).length) {
        out.unattributed += owed; cur.unattributed += owed; cur = null; return;
      }
      var pctTotal = Object.keys(split).reduce(function (s, id) { return s + (Number(split[id]) || 0); }, 0);
      if (!(pctTotal > 0)) {
        out.unattributed += owed; cur.unattributed += owed; cur = null; return;
      }
      Object.keys(split).forEach(function (id) {
        var pct = Number(split[id]) || 0;
        if (!pct) return;
        var share = owed * (pct / pctTotal);
        var a = byId[id];
        if (a && a.name) add(a.name, share);
        // The account is gone; the debt is not.
        else { out.unattributed += share; cur.unattributed += share; }
      });
      cur = null;
    });
    return out;
  }

  // The date of a liability's FIRST instalment. next_due walks forward as
  // instalments are posted, so the start has to be walked back the same number
  // of periods to recover it. (A schedule clamped by a short month — Jan 31 to
  // Feb 28 — comes back as the 28th; the count of instalments is unaffected,
  // which is what the series is built from.)
  function liabilityStartDate(row) {
    if (!row || !row.next_due) return null;
    var iso = String(row.next_due).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var back = Math.max(0, Math.floor(Number(row.installments_done) || 0));
    if (!back) return iso;
    return stepDue(iso, row.frequency, -back);
  }

  // `k` periods from an ISO date, forward or back. Month steps clamp to the last
  // valid day of the target month, as the processor that posts them does.
  function stepDue(iso, frequency, k) {
    var d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    var freq = frequency || "monthly";
    var monthStep = { monthly: 1, quarterly: 3, yearly: 12 }[freq];
    if (monthStep) {
      var day = d.getDate();
      var y = d.getFullYear(), m = d.getMonth() + monthStep * k;
      var lastDay = new Date(y, m + 1, 0).getDate();
      d = new Date(y, m, Math.min(day, lastDay));
    } else {
      d.setDate(d.getDate() + (freq === "weekly" ? 7 : 1) * k);
    }
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // How many instalments the plan has in total.
  function liabilityTotalCount(row) {
    if (!row) return null;
    if (row.num_payments != null && row.num_payments !== "") {
      var n = Math.floor(Number(row.num_payments));
      if (isFinite(n) && n >= 0) return n;
    }
    var start = liabilityStartDate(row);
    if (start && row.end_date) return countDuesThrough(start, row.end_date, row.frequency);
    return null;
  }

  // What was still owed on a given date.
  //
  // An instalment counts as paid from its due date, which is the same rule the
  // processor posts by — so at today's date this returns exactly what
  // liabilityRemaining does, and the line meets the Overview's figure rather
  // than landing near it. Capped by the instalments actually recorded, so a
  // schedule that is behind does not get credit for payments never made.
  //
  // null before the first instalment: the debt did not exist yet, and drawing a
  // flat line back through history would claim it did.
  function liabilityOutstandingAt(row, iso) {
    var start = liabilityStartDate(row);
    var total = liabilityTotalCount(row);
    if (!start || total == null) return null;
    var date = String(iso).slice(0, 10);
    if (date < start) return null;
    var amt = Number(row.amount) || 0;
    var scheduled = countDuesThrough(start, date, row.frequency);
    if (scheduled == null) return null;
    var recorded = Math.max(0, Math.floor(Number(row.installments_done) || 0));
    var paid = Math.min(recorded, scheduled);
    return Math.max(0, total - paid) * amt;
  }

  // The liability line for a portfolio, over a timeline.
  //
  // Same attribution as the Overview figure — a personal account's liability is
  // that person's, a joint one is divided by its split — so the line and the
  // card cannot tell different stories about the same selection. Entries are
  // null until the earliest liability the selection carries began, which is
  // what keeps the line from starting before the debt did.
  function liabilityOwedSeries(liabilities, accounts, portfolio, isoDates) {
    var dates = isoDates || [];
    var out = new Array(dates.length);
    for (var z = 0; z < dates.length; z++) out[z] = null;
    if (!dates.length) return { start: null, values: out, any: false };

    var any = false, start = null;
    (liabilities || []).forEach(function (item) {
      if (!item || item._deleted) return;
      var row = item.row || {};
      if (liabilityTotalCount(row) == null) return;          // open-ended
      // Its share of THIS selection, expressed as a fraction of the whole
      // liability, so the same schedule can be scaled per portfolio.
      var whole = liabilityDeductions([item], accounts);
      if (!(whole.total > 0)) return;
      var mine = liabilityForPortfolio(whole, portfolio);
      if (!(mine > 0)) return;
      var frac = mine / whole.total;

      var began = liabilityStartDate(row);
      if (began && (start == null || began < start)) start = began;
      // One point of nothing-owed immediately before the first instalment, so
      // the line leaves the asset line and drops rather than appearing out of
      // nowhere partway down the chart. Without it the debt's arrival is the
      // one thing the line cannot show.
      var anchor = -1;
      for (var a = 0; a < dates.length; a++) {
        if (began && dates[a] < began) anchor = a; else break;
      }
      if (anchor >= 0) { out[anchor] = out[anchor] || 0; any = true; }
      for (var i = 0; i < dates.length; i++) {
        var owed = liabilityOutstandingAt(row, dates[i]);
        if (owed == null) continue;
        any = true;
        out[i] = (out[i] || 0) + owed * frac;
      }
    });
    return { start: start, values: out, any: any };
  }

  // One portfolio's share, matched to a contributing account by name — the only
  // link between the two, which live in different tables. "all" is the whole
  // household, including anything that could not be attributed to a name.
  function liabilityForPortfolio(deductions, portfolio) {
    if (!deductions) return 0;
    var pf = String(portfolio == null ? "all" : portfolio).trim();
    if (!pf || pf.toLowerCase() === "all") return deductions.total;
    return deductions.byName[pf.toLowerCase()] || 0;
  }

  // Which loans make up one selection's figure, largest first. Only the ones it
  // actually carries: a portfolio is not shown a debt that is not its own, and
  // the shares here sum to what liabilityForPortfolio returns for it.
  function liabilityBreakdown(deductions, portfolio) {
    if (!deductions || !deductions.items) return [];
    var pf = String(portfolio == null ? "all" : portfolio).trim().toLowerCase();
    var all = !pf || pf === "all";
    return deductions.items.map(function (it) {
      var amt = all ? it.total : (it.byName[pf] || 0);
      return { name: it.name, amount: amt };
    }).filter(function (r) { return r.amount > 0; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  root.WfMath = {
    DAYS_PER_YEAR: DAYS_PER_YEAR,
    liabilityRemainingCount: liabilityRemainingCount,
    liabilityRemaining: liabilityRemaining,
    liabilityDeductions: liabilityDeductions,
    liabilityForPortfolio: liabilityForPortfolio,
    liabilityBreakdown: liabilityBreakdown,
    liabilityStartDate: liabilityStartDate,
    liabilityTotalCount: liabilityTotalCount,
    liabilityOutstandingAt: liabilityOutstandingAt,
    liabilityOwedSeries: liabilityOwedSeries,
    calculateXIRR: calculateXIRR,
    fifoRemainingLots: fifoRemainingLots,
    forwardFillOverTimeline: forwardFillOverTimeline,
    twrNavSeries: twrNavSeries,
    attributeFxReturn: attributeFxReturn
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
