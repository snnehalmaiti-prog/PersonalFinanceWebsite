// Tests for WfSnapshots.gainBuckets — the exact GAIN · MONTHLY decomposition.
// The card splits a month's real net-worth change into four buckets that must
// ALWAYS sum back to it (no residual). Run: node tests/test-gain-buckets.js
//
// Invariant under test: invested + market + interest + idle === change,
// where change === eqCurDelta + fiCurDelta. This must hold EXACTLY for any
// inputs (that's what makes the residual line disappear), and the individual
// buckets must carry the right economic meaning in named scenarios.
var WfSnapshots = require("../wf-snapshots.js");
var GB = WfSnapshots.gainBuckets;

var failures = 0;
function ok(name, cond) {
  if (cond) { console.log("✓ " + name); }
  else { failures++; console.error("✗ " + name); }
}
function eq(name, got, want, tol) {
  tol = tol || 1e-9;
  if (Math.abs(got - want) <= tol) { console.log("✓ " + name); }
  else { failures++; console.error("✗ " + name + ": expected " + want + ", got " + got); }
}
// The one invariant that must never break, whatever the inputs.
function reconciles(name, b) {
  var lhs = b.invested + b.market + b.interest + b.idle;
  if (Math.abs(lhs - b.change) <= 1e-6) { console.log("✓ " + name + " (reconciles)"); }
  else { failures++; console.error("✗ " + name + " RESIDUAL " + (b.change - lhs)); }
}

// ── 1. Pure equity mark-to-market, no flows ───────────────────────────────
// Equity rose 10k, nothing bought/sold, no FI, no parked cash.
(function () {
  var b = GB(10000, 0, 0, 0, 0);
  eq("equity mark-up → market", b.market, 10000);
  eq("equity mark-up → interest 0", b.interest, 0);
  eq("equity mark-up → invested 0", b.invested, 0);
  eq("equity mark-up → gain", b.gain, 10000);
  reconciles("equity mark-up", b);
})();

// ── 2. A pure buy: value in and cost in cancel → market 0 ─────────────────
// Bought 50k of equity; by month-end it's worth 50k (bought at close). eqCurDelta
// = 50k (value appeared), eqContrib = 50k (cost). Market must be 0, not +50k.
(function () {
  var b = GB(50000, 0, 50000, 0, 0);
  eq("buy at close → market 0", b.market, 0);
  eq("buy at close → invested 50k", b.invested, 50000);
  eq("buy → gain 0", b.gain, 0);
  reconciles("buy at close", b);
})();

// ── 3. Buy that also rose during the month ────────────────────────────────
// Bought 50k (cost), worth 52k at month-end. Value +52k, cost 50k → market +2k.
(function () {
  var b = GB(52000, 0, 50000, 0, 0);
  eq("buy + rise → market 2k", b.market, 2000);
  eq("buy + rise → invested 50k", b.invested, 50000);
  reconciles("buy + rise", b);
})();

// ── 4. A sell (cash-flow view): proceeds leave, gap preserved ─────────────
// Sold a holding for 30k. Current drops 30k (value gone), contrib −30k (proceeds
// out). Market = −30k − (−30k) = 0 → the sale itself books no market gain
// (the gain was recognised as the price rose, in earlier months).
(function () {
  var b = GB(-30000, 0, -30000, 0, 0);
  eq("sell → market 0", b.market, 0);
  eq("sell → invested −30k", b.invested, -30000);
  reconciles("sell", b);
})();

// ── 5. Fixed-income accrual: FD grows, no flows ───────────────────────────
(function () {
  var b = GB(0, 700, 0, 0, 0);
  eq("FD accrual → interest 700", b.interest, 700);
  eq("FD accrual → market 0", b.market, 0);
  eq("FD accrual → invested 0", b.invested, 0);
  reconciles("FD accrual", b);
})();

// ── 6. FD deposit: principal in, no gain ──────────────────────────────────
// Deposited 1L into an FD. fiCurDelta +1L (value up), fiContrib +1L (deposit).
// Interest must be 0 (it's a contribution, not growth).
(function () {
  var b = GB(0, 100000, 0, 100000, 0);
  eq("FD deposit → interest 0", b.interest, 0);
  eq("FD deposit → invested 1L", b.invested, 100000);
  reconciles("FD deposit", b);
})();

// ── 7. FD maturity: payout (principal + interest) leaves as a withdrawal ───
// FD of 1L that accrued 7k matures. Value drops 1,07,000 (principal + accrued).
// The payout is a withdrawal in contributions: fiContrib = −1,07,000. Interest
// must net to ~0 that month (the interest was earned as it accrued earlier),
// NOT show −1,07,000 or a negative spike.
(function () {
  var b = GB(0, -107000, 0, -107000, 0);
  eq("FD maturity → interest 0 (not negative)", b.interest, 0);
  eq("FD maturity → invested −1,07,000", b.invested, -107000);
  ok("FD maturity → interest not negative", b.interest >= 0);
  reconciles("FD maturity", b);
})();

// ── 8. FD maturity with a same-month final accrual ────────────────────────
// Matures having accrued 500 more this month before payout: value −106500,
// payout still books 107000 out → interest = −106500 − (−107000) = +500.
(function () {
  var b = GB(0, -106500, 0, -107000, 0);
  eq("FD maturity + final accrual → interest 500", b.interest, 500);
  ok("FD maturity + accrual → interest ≥ 0", b.interest >= 0);
  reconciles("FD maturity + accrual", b);
})();

// ── 9. EPF annual interest credit (a spike, real) ─────────────────────────
(function () {
  var b = GB(0, 45000, 0, 0, 0);
  eq("EPF credit → interest 45k", b.interest, 45000);
  reconciles("EPF credit", b);
})();

// ── 10. Parked cash moves in, nothing else ────────────────────────────────
// Moved 8.99L into Investment Corpus. fiCurDelta carries it (parked is inside
// the FI current), idle names it, so interest must be 0 — not +8.99L.
(function () {
  var b = GB(0, 899097, 0, 0, 899097);
  eq("parked cash in → idle", b.idle, 899097);
  eq("parked cash in → interest 0", b.interest, 0);
  eq("parked cash in → market 0", b.market, 0);
  reconciles("parked cash in", b);
})();

// ── 11. Money moved from a fund INTO parked cash (internal transfer) ───────
// Sold 2.82L of equity (value −2.82L, proceeds out −2.82L) and parked it
// (fiCurDelta +2.82L, idle +2.82L). Net change 0, and every bucket is sensible:
// market 0 (sale books none), interest 0, invested −2.82L, idle +2.82L.
(function () {
  var b = GB(-282107, 282107, -282107, 0, 282107);
  eq("transfer → market 0", b.market, 0);
  eq("transfer → interest 0", b.interest, 0);
  eq("transfer → invested −2.82L", b.invested, -282107);
  eq("transfer → idle +2.82L", b.idle, 282107);
  eq("transfer → net change 0", b.change, 0);
  reconciles("fund→parked transfer", b);
})();

// ── 12. Everything at once (a realistic composite month) ──────────────────
// Equity: bought 50k, ended +12k in value beyond cost. FI: 7k accrual + 100k
// deposit. Parked: +20k.
//   eqCurDelta = 50k(cost back) + 12k(gain) = 62k ; eqContrib = 50k
//   fiCurDelta = 7k(accrual) + 100k(deposit) + 20k(parked) = 127k
//   fiContrib  = 100k ; idle = 20k
(function () {
  var b = GB(62000, 127000, 50000, 100000, 20000);
  eq("composite → market 12k", b.market, 12000);
  eq("composite → interest 7k", b.interest, 7000);
  eq("composite → invested 150k", b.invested, 150000);
  eq("composite → idle 20k", b.idle, 20000);
  eq("composite → gain 19k", b.gain, 19000);
  reconciles("composite month", b);
})();

// ── 13. Reconciliation holds for random inputs (fuzz) ─────────────────────
(function () {
  function rnd() { return Math.round((Math.random() * 2 - 1) * 1e6); }
  var worst = 0;
  for (var i = 0; i < 5000; i++) {
    var eqC = rnd(), fiC = rnd(), eqK = rnd(), fiK = rnd(), id = rnd();
    var b = GB(eqC, fiC, eqK, fiK, id);
    var resid = b.change - (b.invested + b.market + b.interest + b.idle);
    if (Math.abs(resid) > worst) worst = Math.abs(resid);
  }
  ok("5000 random inputs all reconcile (max residual " + worst + ")", worst < 1e-6);
})();

// ── 14. Bad/missing inputs coerce to 0, still reconciles ──────────────────
(function () {
  var b = GB(undefined, null, NaN, "x", undefined);
  eq("garbage → change 0", b.change, 0);
  reconciles("garbage inputs", b);
})();

// ── 15. Invested equals CASH FLOW's Net (eqContrib + fiContrib), by design ─
(function () {
  var b = GB(0, 0, 111111, 22222, 0);
  eq("invested = eqContrib + fiContrib", b.invested, 133333);
  reconciles("invested identity", b);
})();

console.log("\n" + (failures ? failures + " FAILED" : "all passed"));
if (failures) process.exit(1);
