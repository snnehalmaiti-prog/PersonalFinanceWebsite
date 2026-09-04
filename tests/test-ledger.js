// Tests for wf-ledger.js — the unified monthly ledger reconciliation engine.
// Run: node tests/test-ledger.js
//
// The contract under test: for every month, and for any inputs,
//   Invested + Market + Interest + Idle === Change   (residual === 0),
// and each bucket carries the right economic value across a holding's whole
// life — proven on hand-computed synthetic portfolios (FD lifecycle, EPF credit,
// equity buy/sell/mark, parked-cash moves), plus a large fuzz sweep.
var WfLedger = require("../wf-ledger.js");
var build = WfLedger.buildMonthlyLedger;
var summarize = WfLedger.summarize;

var failures = 0;
function ok(name, cond) {
  if (cond) console.log("✓ " + name);
  else { failures++; console.error("✗ " + name); }
}
function eq(name, got, want, tol) {
  tol = tol || 1e-6;
  if (Math.abs(got - want) <= tol) console.log("✓ " + name);
  else { failures++; console.error("✗ " + name + ": expected " + want + ", got " + got); }
}
// The invariant that must hold for every emitted row, whatever the inputs.
function assertReconciles(label, rows) {
  var worst = 0;
  rows.forEach(function (r) {
    var lhs = r.invested + r.market + r.interest + r.idle;
    worst = Math.max(worst, Math.abs(lhs - r.change), Math.abs(r.residual));
  });
  ok(label + " reconciles per month (max residual " + worst.toExponential(1) + ")", worst < 1e-6);
}
// convenience: a value snapshot
function V(eqComm, fi, parked) { return { eqComm: eqComm, fi: fi, parked: parked }; }
function F(eqComm, fi) { return { eqComm: eqComm, fi: fi }; }

// ── 1. Pure equity mark-to-market ─────────────────────────────────────────
(function () {
  var rows = build([
    { month: "2025-01", value: V(100000, 0, 0), flows: F(0, 0) },   // baseline
    { month: "2025-02", value: V(110000, 0, 0), flows: F(0, 0) }    // rose 10k, no trades
  ]);
  eq("equity mark-up → market 10k", rows[0].market, 10000);
  eq("equity mark-up → interest 0", rows[0].interest, 0);
  eq("equity mark-up → invested 0", rows[0].invested, 0);
  assertReconciles("equity mark-up", rows);
})();

// ── 2. Equity buy at close: cost and value cancel → market 0 ──────────────
(function () {
  var rows = build([
    { month: "2025-01", value: V(0, 0, 0), flows: F(0, 0) },
    { month: "2025-02", value: V(50000, 0, 0), flows: F(50000, 0) }  // bought 50k, worth 50k
  ]);
  eq("buy at close → market 0", rows[0].market, 0);
  eq("buy at close → invested 50k", rows[0].invested, 50000);
  assertReconciles("buy at close", rows);
})();

// ── 3. Equity sell: proceeds out, no market booked on the sale itself ──────
(function () {
  var rows = build([
    { month: "2025-01", value: V(50000, 0, 0), flows: F(0, 0) },
    { month: "2025-02", value: V(20000, 0, 0), flows: F(-30000, 0) }  // sold 30k worth
  ]);
  eq("sell → market 0", rows[0].market, 0);
  eq("sell → invested −30k", rows[0].invested, -30000);
  assertReconciles("sell", rows);
})();

// ── 4. FULL FD LIFECYCLE: deposit → accrue → mature (interest never negative) ─
// FD 1,00,000 deposited Jan, accrues 1,000/month, matures Apr (payout 1,03,000).
(function () {
  var rows = build([
    { month: "2024-12", value: V(0, 0, 0),      flows: F(0, 0) },       // baseline
    { month: "2025-01", value: V(0, 101000, 0), flows: F(0, 100000) },  // deposit + 1k accrual
    { month: "2025-02", value: V(0, 102000, 0), flows: F(0, 0) },       // +1k accrual
    { month: "2025-03", value: V(0, 103000, 0), flows: F(0, 0) },       // +1k accrual
    { month: "2025-04", value: V(0, 0, 0),      flows: F(0, -103000) }  // maturity payout out
  ]);
  eq("FD Jan interest (deposit month)", rows[0].interest, 1000);
  eq("FD Jan invested (principal in)", rows[0].invested, 100000);
  eq("FD Feb interest", rows[1].interest, 1000);
  eq("FD Mar interest", rows[2].interest, 1000);
  eq("FD maturity interest ~0 (not negative)", rows[3].interest, 0);
  ok("FD maturity interest ≥ 0", rows[3].interest >= 0);
  eq("FD maturity invested −1,03,000 (payout out)", rows[3].invested, -103000);
  var totalInterest = rows.reduce(function (s, r) { return s + r.interest; }, 0);
  eq("FD lifetime interest = 3,000", totalInterest, 3000);
  var totalInvested = rows.reduce(function (s, r) { return s + r.invested; }, 0);
  eq("FD lifetime net invested = −3,000 (proceeds > principal)", totalInvested, -3000);
  assertReconciles("FD lifecycle", rows);
})();

// ── 5. EPF annual interest credit (a legitimate one-month spike) ──────────
(function () {
  var rows = build([
    { month: "2025-02", value: V(0, 500000, 0), flows: F(0, 0) },
    { month: "2025-03", value: V(0, 545000, 0), flows: F(0, 0) }   // 45k credited, no deposit
  ]);
  eq("EPF credit → interest 45k", rows[0].interest, 45000);
  eq("EPF credit → invested 0", rows[0].invested, 0);
  assertReconciles("EPF credit", rows);
})();

// ── 6. Parked cash moves — value-only, no double count ────────────────────
(function () {
  var rows = build([
    { month: "2025-01", value: V(0, 0, 0),      flows: F(0, 0) },
    { month: "2025-02", value: V(0, 0, 899097), flows: F(0, 0) }   // parked 8.99L in
  ]);
  eq("parked in → idle", rows[0].idle, 899097);
  eq("parked in → interest 0", rows[0].interest, 0);
  eq("parked in → market 0", rows[0].market, 0);
  eq("parked in → invested 0", rows[0].invested, 0);
  assertReconciles("parked cash in", rows);
})();

// ── 7. Sell a fund and park the proceeds (internal transfer) ──────────────
// Equity value −2.82L (sold), parked +2.82L. Net change 0; nothing is gain.
(function () {
  var rows = build([
    { month: "2025-06", value: V(500000, 0, 0),      flows: F(0, 0) },
    { month: "2025-07", value: V(217893, 0, 282107), flows: F(-282107, 0) }
  ]);
  eq("transfer → market 0", rows[0].market, 0);
  eq("transfer → interest 0", rows[0].interest, 0);
  eq("transfer → invested −2.82L", rows[0].invested, -282107);
  eq("transfer → idle +2.82L", rows[0].idle, 282107);
  eq("transfer → change 0", rows[0].change, 0);
  assertReconciles("fund→parked transfer", rows);
})();

// ── 8. A realistic composite year, all books at once ──────────────────────
(function () {
  var rows = build([
    // baseline: 10L equity, 5L FI, 1L parked
    { month: "2024-12", value: V(1000000, 500000, 100000), flows: F(0, 0) },
    // Jan: +30k equity gain, bought 20k equity; FI +4k accrual; parked +50k
    { month: "2025-01", value: V(1050000, 504000, 150000), flows: F(20000, 0) },
    // Feb: −15k equity (market drop); FD deposit 1L (+ 4k accrual = +104k FI); parked −20k
    { month: "2025-02", value: V(1035000, 608000, 130000), flows: F(0, 100000) },
    // Mar: +25k equity gain, sold 40k equity; EPF credit 45k (+4k FD accrual = +49k FI)
    { month: "2025-03", value: V(1020000, 657000, 130000), flows: F(-40000, 0) }
  ]);
  eq("composite Jan market", rows[0].market, 30000);   // Δeq 50k − buy 20k
  eq("composite Jan interest", rows[0].interest, 4000);
  eq("composite Jan idle", rows[0].idle, 50000);
  eq("composite Feb market", rows[1].market, -15000);  // Δeq −15k − buy 0
  eq("composite Feb interest", rows[1].interest, 4000); // Δfi 104k − deposit 100k
  eq("composite Feb invested", rows[1].invested, 100000);
  eq("composite Feb idle", rows[1].idle, -20000);
  eq("composite Mar market", rows[2].market, 25000);   // Δeq −15k − sell(−40k) = 25k
  eq("composite Mar interest", rows[2].interest, 49000);
  assertReconciles("composite year", rows);

  // Period summary reconciles and interest never went negative.
  var s = summarize(rows);
  eq("summary residual 0", s.residual, 0);
  eq("summary change = closing − opening", s.change, s.closing - s.opening);
  eq("summary interest = Σ months", s.interest, 4000 + 4000 + 49000);
  ok("no month had negative interest", rows.every(function (r) { return r.interest >= 0; }));
})();

// ── 9. Reconciliation holds for random inputs (fuzz) ──────────────────────
(function () {
  function rnd() { return Math.round((Math.random() * 2 - 1) * 1e6); }
  var worst = 0;
  for (var t = 0; t < 2000; t++) {
    var n = 2 + Math.floor(Math.random() * 10), months = [];
    for (var i = 0; i < n; i++) {
      months.push({
        month: "20" + (20 + i) + "-01",   // strictly increasing keys
        value: V(rnd(), rnd(), rnd()),
        flows: F(rnd(), rnd())
      });
    }
    var rows = build(months);
    rows.forEach(function (r) {
      worst = Math.max(worst, Math.abs((r.invested + r.market + r.interest + r.idle) - r.change));
    });
  }
  ok("2000 random ledgers all reconcile (max residual " + worst.toExponential(1) + ")", worst < 1e-6);
})();

// ── 10. Edge cases: empty, single baseline, garbage, unsorted input ───────
(function () {
  ok("empty → []", build([]).length === 0);
  ok("single baseline → [] (no prior to difference)", build([{ month: "2025-01", value: V(1, 2, 3) }]).length === 0);
  var g = build([
    { month: "2025-01", value: { eqComm: "x", fi: null, parked: undefined } },
    { month: "2025-02", value: { eqComm: NaN }, flows: { fi: "y" } }
  ]);
  eq("garbage coerces to 0 → change 0", g[0].change, 0);
  assertReconciles("garbage inputs", g);
  // Unsorted input is sorted internally, so results are identical.
  var a = build([
    { month: "2025-01", value: V(0, 0, 0), flows: F(0, 0) },
    { month: "2025-02", value: V(10, 0, 0), flows: F(0, 0) }
  ]);
  var b = build([
    { month: "2025-02", value: V(10, 0, 0), flows: F(0, 0) },
    { month: "2025-01", value: V(0, 0, 0), flows: F(0, 0) }
  ]);
  eq("unsorted input sorted internally", b[0].market, a[0].market);
})();

// ── 11. assembleLedgerInput: series + pre-split flows → engine input ──────
// Flows arrive ALREADY split into the two value books (the caller splits by
// source/sheet, not category — a debt MF's flow belongs to eqComm because its
// value does). The assembler just zips value + flows by month.
var assemble = WfLedger.assembleLedgerInput;
(function () {
  var series = {
    monthsEq:     [{ month: "2025-01", current: 1000000 }, { month: "2025-02", current: 1050000 }],
    monthsFiCore: [{ month: "2025-01", value: 500000 },    { month: "2025-02", value: 504000 }],
    monthsParked: [{ month: "2025-01", value: 100000 },    { month: "2025-02", value: 150000 }]
  };
  var flows = { "2025-02": { eqComm: 20000, fi: 100000 } };
  var input = assemble(series, flows);
  eq("assemble → 2 months", input.length, 2);
  eq("assemble → Feb eqComm value", input[1].value.eqComm, 1050000);
  eq("assemble → Feb fi value", input[1].value.fi, 504000);
  eq("assemble → Feb parked value", input[1].value.parked, 150000);
  eq("assemble → Feb eq flow", input[1].flows.eqComm, 20000);
  eq("assemble → Feb fi flow", input[1].flows.fi, 100000);
  eq("assemble → month with no flow defaults to 0", input[0].flows.eqComm, 0);
})();

// ── 11b. The debt-MF bug this split fixes ─────────────────────────────────
// A debt mutual fund bought for 100k: its VALUE lands in eqComm (equity sheet),
// so its FLOW must too. Routing it to fi (by category) made interest go −100k
// and market +100k. With the flow in the right book, both are clean.
(function () {
  var series = {
    monthsEq:     [{ month: "2025-01", current: 0 }, { month: "2025-02", current: 100000 }],
    monthsFiCore: [{ month: "2025-01", value: 0 },   { month: "2025-02", value: 0 }],
    monthsParked: [{ month: "2025-01", value: 0 },   { month: "2025-02", value: 0 }]
  };
  var rows = build(assemble(series, { "2025-02": { eqComm: 100000, fi: 0 } }));
  eq("debt-MF flow in eqComm → market 0", rows[0].market, 0);
  eq("debt-MF flow in eqComm → interest 0 (was −100k when mis-routed)", rows[0].interest, 0);
  assertReconciles("debt-MF routed correctly", rows);
})();

// ── 12. End-to-end: assemble → buildMonthlyLedger reconciles ──────────────
(function () {
  var series = {
    monthsEq:     [{ month: "2024-12", current: 1000000 }, { month: "2025-01", current: 1050000 },
                   { month: "2025-02", current: 1035000 }],
    monthsFiCore: [{ month: "2024-12", value: 500000 },    { month: "2025-01", value: 504000 },
                   { month: "2025-02", value: 608000 }],
    monthsParked: [{ month: "2024-12", value: 100000 },    { month: "2025-01", value: 150000 },
                   { month: "2025-02", value: 130000 }]
  };
  var flows = { "2025-01": { eqComm: 20000, fi: 0 }, "2025-02": { eqComm: 0, fi: 100000 } };
  var rows = build(assemble(series, flows));
  eq("e2e Jan market", rows[0].market, 30000);    // Δeq 50k − buy 20k
  eq("e2e Jan interest", rows[0].interest, 4000);  // Δfi 4k − 0
  eq("e2e Jan idle", rows[0].idle, 50000);         // Δparked
  eq("e2e Feb market", rows[1].market, -15000);
  eq("e2e Feb interest", rows[1].interest, 4000);  // Δfi 104k − deposit 100k
  eq("e2e Feb idle", rows[1].idle, -20000);
  assertReconciles("assemble → engine", rows);
})();

console.log("\n" + (failures ? failures + " FAILED" : "all passed"));
if (failures) process.exit(1);
