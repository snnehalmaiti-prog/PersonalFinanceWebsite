// Unit tests for WfSnapshots.monthlyGainFromSeries — the accurate monthly gain
// used by the GAIN · MONTHLY card. Run: node tests/test-monthly-gain.js
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

// Buy 1@100 (Jan), mark to 150 (Feb), sell @150 (Mar). Total gain must be 50,
// recognised in Feb as the price rose; Mar (sale at the last mark) adds nothing.
var series = [
  { month: "2026-01", current: 100, invested: 100 }, // gap 0
  { month: "2026-02", current: 150, invested: 100 }, // gap 50
  { month: "2026-03", current: 0,   invested: 0 },   // sold, gap 0
];
var realized = { "2026-03": 50 }; // proceeds 150 − cost 100
var rows = WfSnapshots.monthlyGainFromSeries(series, realized);
eq("Jan gain", rows[0].gain, 0);
eq("Feb gain (mark-up)", rows[1].gain, 50);
eq("Mar gain (sale, no new gain)", rows[2].gain, 0);
eq("total gain over life", rows.reduce(function (s, r) { return s + r.gain; }, 0), 50);

// Sale in the SAME month as the whole move: buy Jan@100, Feb price hits 150 and
// is sold within Feb. Feb must show the full 50.
var s2 = [
  { month: "2026-01", current: 100, invested: 100 },
  { month: "2026-02", current: 0,   invested: 0 },
];
var r2 = WfSnapshots.monthlyGainFromSeries(s2, { "2026-02": 50 });
eq("same-month buy+sell gain", r2[1].gain, 50);

// No realized data: pure mark-to-market. A drop is a negative gain.
var s3 = [
  { month: "2026-01", current: 100, invested: 100 },
  { month: "2026-02", current: 80,  invested: 100 },
];
var r3 = WfSnapshots.monthlyGainFromSeries(s3, {});
eq("mark-to-market loss", r3[1].gain, -20);

// Interest-style gain (invested flat, current rises): gap change is the gain.
var s4 = [
  { month: "2026-01", current: 1000, invested: 1000 },
  { month: "2026-02", current: 1007, invested: 1000 },
  { month: "2026-03", current: 1014, invested: 1000 },
];
var r4 = WfSnapshots.monthlyGainFromSeries(s4, {});
eq("interest Feb", r4[1].gain, 7);
eq("interest Mar", r4[2].gain, 7);

console.log("\n" + (rows.length ? "" : "") + (failures ? failures + " FAILED" : "all passed"));
if (failures) process.exit(1);
