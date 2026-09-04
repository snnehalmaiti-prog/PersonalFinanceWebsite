// wf-ledger.js — the unified monthly ledger for GAIN · MONTHLY (and, later, the
// other cards). This is the PURE reconciliation engine only: it takes a series
// of month-boundary snapshots that were all produced by ONE valuation pass and
// ONE flow pass, and splits each month's real net-worth change into buckets that
// sum back to it EXACTLY.
//
// Why this removes the residual: today the card mixes three subsystems that key
// money to months differently (the value series sampled on the 1st, the
// transaction ledger by real date, and separate interest/idle valuation walks —
// with parked cash computed two different ways). Here every number for a month
// comes from the SAME two boundary valuations plus the SAME flow pass, so:
//
//   change   = Δ(eqComm + fi + parked)              (the month's real value move)
//   Invested = flows.eqComm + flows.fi              (net investable flows)
//   Market   = Δ(eqComm value) − flows.eqComm       (equity/commodity mark-to-market)
//   Interest = Δ(fi value)     − flows.fi           (fixed-income accrual)
//   Idle     = Δ(parked value)                       (parked cash — value only, no flow)
//
//   ⇒ Invested + Market + Interest + Idle == change,  for every month, exactly.
//
// The design points that kill the earlier failures:
//   • Parked cash is measured ONE way — as the change in its value (Δparked).
//     There is no separate parked-flow, so the two-computation mismatch that
//     made Interest swing cannot exist.
//   • Interest is Δ(fi value) − fi flows. FD maturity payouts (principal +
//     interest) arrive as an fi flow (an outflow), so a maturity nets Interest
//     to ~0 instead of a negative spike; while held, fi grows only by accrual so
//     Interest ≥ 0.
//   • Market uses the SAME flow figure as Invested for its equity part, so a
//     buy's value and its cost cancel within the month — no spurious swings.
//
// The hard part (building this canonical input from the sheets with one
// consistent boundary and carry-forward-safe valuation) is deliberately NOT here
// yet — this module and its tests prove the reconciliation math in isolation
// first, before any card is switched over.
(function (root) {
  "use strict";

  function num(x) { var n = Number(x); return isFinite(n) ? n : 0; }

  // A month snapshot's total value across the three books.
  function totalValue(v) {
    if (!v) return 0;
    return num(v.eqComm) + num(v.fi) + num(v.parked);
  }

  // months: [{ month:"YYYY-MM",
  //            value: { eqComm, fi, parked },   // cumulative value at that month END
  //            flows: { eqComm, fi } }]          // that month's NET investable flows
  //                                              // (buys − sells / deposits − payouts);
  //                                              // parked has NO flow — it is value-only.
  // Oldest first. The FIRST entry is the opening baseline (end of the month before
  // the first reported month) and produces no row; rows are emitted for entries
  // 1..n, each differencing against the entry before it.
  //
  // Returns [{ month, opening, closing, change, invested, market, interest, idle,
  //            gain, residual }] oldest-first. `residual` is always 0 by
  //            construction and is emitted only so tests/callers can assert it.
  function buildMonthlyLedger(months) {
    var sorted = (months || []).slice().sort(function (a, b) {
      return String(a.month).localeCompare(String(b.month));
    });
    var out = [];
    for (var i = 1; i < sorted.length; i++) {
      var prev = sorted[i - 1], cur = sorted[i];
      var pv = prev.value || {}, cv = cur.value || {};
      var dEq = num(cv.eqComm) - num(pv.eqComm);
      var dFi = num(cv.fi) - num(pv.fi);
      var dParked = num(cv.parked) - num(pv.parked);

      var fEq = cur.flows ? num(cur.flows.eqComm) : 0;
      var fFi = cur.flows ? num(cur.flows.fi) : 0;

      var invested = fEq + fFi;
      var market = dEq - fEq;
      var interest = dFi - fFi;
      var idle = dParked;

      var opening = totalValue(pv);
      var closing = totalValue(cv);
      var change = closing - opening;
      var residual = change - (invested + market + interest + idle);

      out.push({
        month: cur.month,
        opening: opening,
        closing: closing,
        change: change,
        invested: invested,
        market: market,
        interest: interest,
        idle: idle,
        gain: market + interest,
        residual: residual              // == 0 by construction
      });
    }
    return out;
  }

  // Aggregate a run of ledger rows into one period summary — the figures the card
  // header shows. Opening is the first row's opening, Closing the last row's
  // closing, and every flow/gain bucket is summed. Reconciles by construction.
  function summarize(rows) {
    var r = rows || [];
    if (!r.length) return null;
    var out = {
      opening: r[0].opening,
      closing: r[r.length - 1].closing,
      invested: 0, market: 0, interest: 0, idle: 0, gain: 0
    };
    r.forEach(function (row) {
      out.invested += row.invested;
      out.market += row.market;
      out.interest += row.interest;
      out.idle += row.idle;
      out.gain += row.gain;
    });
    out.change = out.closing - out.opening;
    out.residual = out.change - (out.invested + out.market + out.interest + out.idle);
    return out;
  }

  root.WfLedger = {
    buildMonthlyLedger: buildMonthlyLedger,
    summarize: summarize,
    totalValue: totalValue
  };
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));

if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof window !== "undefined" ? window : globalThis).WfLedger;
}
