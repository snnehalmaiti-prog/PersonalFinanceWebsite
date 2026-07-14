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

  root.WfMath = {
    DAYS_PER_YEAR: DAYS_PER_YEAR,
    calculateXIRR: calculateXIRR,
    fifoRemainingLots: fifoRemainingLots
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
