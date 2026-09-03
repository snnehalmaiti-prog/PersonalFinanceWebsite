// Unit tests for WfSnapshots.monthlyGainFromSeries — the accurate monthly gain
// used by the GAIN · MONTHLY card. Run: node tests/test-monthly-gain.js
//
// The invested series is CASH-FLOW view: a sale subtracts sale PROCEEDS (not
// the cost basis). So `invested` can go negative when total proceeds exceed
// total buys, and the gap = Current − Invested PERSISTS after a sale (the
// previously-unrealized gain is preserved in the gap as an accounting
// artifact). This is why the formula is gain(m) = Δgap(m) alone — realized is
// already captured, adding it would double-count.
var WfSnapshots = require("../wf-snapshots.js");

var failures = 0;
function eq(name, got, want) {
  if (Math.abs(got - want) > 1e-6) {
    failures++;
    console.error("✗ " + name + ": expected " + want + ", got " + got);
  } else {
    console.log("✓ " + name);
  }
}

// Long-held: buy 1@100 (Jan). Price rises to 150 (Feb). Sell @150 (Mar, cash
// leaves). Under cash-flow view: Mar invested = 100−150 = −50, current = 0,
// gap = 50 (preserved). Total lifetime gain = 50, earned entirely in Feb.
var series = [
  { month: "2026-01", current: 100, invested: 100 },   // gap 0
  { month: "2026-02", current: 150, invested: 100 },   // gap 50 (mark-up)
  { month: "2026-03", current: 0,   invested: -50 },   // gap 50 (sale locks-in)
];
var realized = { "2026-03": 50 };                       // info only
var rows = WfSnapshots.monthlyGainFromSeries(series, realized);
eq("Jan gain",                        rows[0].gain, 0);
eq("Feb gain (mark-up)",              rows[1].gain, 50);
eq("Mar gain (sale, no new gain)",    rows[2].gain, 0);
eq("total gain over life",            rows.reduce(function (s, r) { return s + r.gain; }, 0), 50);
eq("realized is preserved (info)",    rows[2].realized, 50);

// Intra-month buy-and-sell: buy Jan@100. Feb buy 1@100 + price hits 150 + sell
// same month (cash leaves). Feb should show +50 gain.
// End of Jan: current=100, invested=100, gap=0.
// End of Feb: 1 unit bought and sold at 150 → invested = 100 + 100 − 150 = 50,
// but 1 unit still held from Jan at Feb-close price 150 → current = 150.
// gap = 150 − 50 = 100. Δgap = +100. Which equals 50 (Jan unit's mark-up) +
// 50 (Feb intra-month realized). Both are new gains — Jan unit rose 50 in Feb.
var s2 = [
  { month: "2026-01", current: 100, invested: 100 },
  { month: "2026-02", current: 150, invested: 50 },
];
var r2 = WfSnapshots.monthlyGainFromSeries(s2, { "2026-02": 50 });
eq("intra-month gain (mark-up + realized combined)", r2[1].gain, 100);

// No trades — pure mark-to-market. A drop is a negative gain.
var s3 = [
  { month: "2026-01", current: 100, invested: 100 },
  { month: "2026-02", current: 80,  invested: 100 },
];
var r3 = WfSnapshots.monthlyGainFromSeries(s3, {});
eq("mark-to-market loss",  r3[1].gain, -20);

// Interest-style: invested flat, current rises each month.
var s4 = [
  { month: "2026-01", current: 1000, invested: 1000 },
  { month: "2026-02", current: 1007, invested: 1000 },
  { month: "2026-03", current: 1014, invested: 1000 },
];
var r4 = WfSnapshots.monthlyGainFromSeries(s4, {});
eq("interest Feb",  r4[1].gain, 7);
eq("interest Mar",  r4[2].gain, 7);

console.log("\n" + (failures ? failures + " FAILED" : "all passed"));
if (failures) process.exit(1);
