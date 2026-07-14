// Performance benchmark for the hot client-side compute paths in script.js.
// Extracts the REAL function sources verbatim (brace-balanced slice) and times
// them at realistic scale (your ~520-550 row sheets) and 10x stress scale.
// Run: node tests/perf-hotpaths.js
// (no "use strict" — eval must leak the extracted declarations into this scope)
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function extract(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error("marker not found: " + marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  let end = i + 1;
  if (SRC[end] === ";") end++;
  return SRC.slice(start, end);
}

// Minimal scope the extracted functions reference.
const storage = new Map();
const localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
};
function dbg() {}

const pieces = [
  "function parseNumber(value)",
  "function normalizeText(value)",
  "var CANONICAL_FIELD_KEYWORDS",
  "function findHeaderIndex(ownHeader, canonicalName)",
  "function realignRowsToHeader(rows, canonicalHeader)",
  "function parseFlexibleDate(value)",
  "function lastAtOrBefore(sortedEvents, targetDate, valueKey)",
].map(extract).join("\n\n");
eval(pieces);

// calculateXIRR now lives in wf-math.js — load it for the benchmark.
eval(fs.readFileSync(path.join(__dirname, "..", "wf-math.js"), "utf8"));
const calculateXIRR = (globalThis.WfMath || global.WfMath).calculateXIRR;

// ── timing helper: median of N runs, plus ops/sec ────────────────────────────
function bench(name, fn, iters) {
  // warmup
  for (let i = 0; i < Math.min(5, iters); i++) fn();
  const samples = [];
  for (let r = 0; r < 7; r++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iters; i++) fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6 / iters); // ms per call
  }
  samples.sort((a, b) => a - b);
  const median = samples[3];
  const label = median < 1 ? (median * 1000).toFixed(1) + " µs" : median.toFixed(3) + " ms";
  console.log(
    "  " + name.padEnd(46) +
    label.padStart(12) + " / call" +
    ("  (" + Math.round(1000 / median).toLocaleString() + "/s)").padStart(16)
  );
  return median;
}

// ── synthetic data generators ────────────────────────────────────────────────
const TXN_HEADER = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
// A "messy" header in a different column order with extra columns, to exercise realign.
const MESSY_HEADER = ["Sl No", "Date", "Type", "Scheme Name", "Portfolio", "NAV", "Units", "Amount", "Notes"];
function messyRows(n) {
  const rows = [MESSY_HEADER.slice()];
  for (let i = 0; i < n; i++) {
    rows.push([
      String(i + 1),
      "0" + ((i % 28) + 1) + "/0" + ((i % 9) + 1) + "/20" + (15 + (i % 10)),
      i % 2 ? "Buy" : "Sell",
      "Fund Scheme " + (i % 40),
      i % 3 ? "Snnehal" : "Trisha",
      (100 + (i % 500)).toFixed(2),
      (i % 100 + 1).toFixed(3),
      (12345 + i).toFixed(2),
      "note",
    ]);
  }
  return rows;
}
function xirrFlows(n) {
  // n monthly buys then a terminal sell — the shape XIRR actually sees.
  const flows = [];
  const base = new Date(2015, 0, 1).getTime();
  const month = 1000 * 60 * 60 * 24 * 30;
  let terminal = 0;
  for (let i = 0; i < n; i++) {
    const amt = -(5000 + (i % 7) * 250);
    terminal += -amt * (1 + 0.09 * (n - i) / 12);
    flows.push({ date: new Date(base + i * month), amount: amt });
  }
  flows.push({ date: new Date(base + n * month), amount: terminal });
  return flows;
}
function sortedEvents(n) {
  const evs = [];
  const base = new Date(2015, 0, 1).getTime();
  const day = 1000 * 60 * 60 * 24;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += 10;
    evs.push({ date: new Date(base + i * day), cumulativeUnits: cum });
  }
  return evs;
}

console.log("Performance — hot compute paths (median of 7 batches)\n");
console.log("Node " + process.version + "\n");

// ── realignRowsToHeader: runs on EVERY sheet sync, per sheet ──────────────────
console.log("realignRowsToHeader  (per-sheet, every sync)");
const rows520 = messyRows(520);
const rows5200 = messyRows(5200);
bench("520 rows  (your Stocks/ETF sheet size)", () => realignRowsToHeader(rows520, TXN_HEADER), 200);
bench("5,200 rows  (10x stress)", () => realignRowsToHeader(rows5200, TXN_HEADER), 40);
console.log();

// ── calculateXIRR: Newton-Raphson + bisection, per portfolio/benchmark ───────
console.log("calculateXIRR  (per portfolio + per benchmark index)");
const flows50 = xirrFlows(50);
const flows200 = xirrFlows(200);
const flows1000 = xirrFlows(1000);
bench("50 flows", () => calculateXIRR(flows50), 2000);
bench("200 flows  (~realistic full history)", () => calculateXIRR(flows200), 1000);
bench("1,000 flows  (10x stress)", () => calculateXIRR(flows1000), 300);
console.log();

// ── lastAtOrBefore: called O(timeline_dates x series) in the value chart ──────
console.log("lastAtOrBefore  (chart: called dates x series times)");
const ev2000 = sortedEvents(2000);
const probe = new Date(2018, 5, 15);
bench("lookup in 2,000-event series", () => lastAtOrBefore(ev2000, probe, "cumulativeUnits"), 20000);
// Simulate a full chart pass: ~3,650 daily dates x ~20 instruments = 73k lookups
console.log("  --- simulated full value-chart pass (3650 dates x 20 series) ---");
const chartDates = [];
{
  const base = new Date(2015, 0, 1).getTime();
  const day = 1000 * 60 * 60 * 24;
  for (let i = 0; i < 3650; i++) chartDates.push(new Date(base + i * day));
}
const series20 = Array.from({ length: 20 }, () => sortedEvents(400));
bench("OLD: 3650 x 20 per-date binary searches", () => {
  let s = 0;
  for (let d = 0; d < chartDates.length; d++)
    for (let k = 0; k < series20.length; k++)
      s += lastAtOrBefore(series20[k], chartDates[d], "cumulativeUnits") || 0;
  return s;
}, 3);
const forwardFill = (globalThis.WfMath || global.WfMath).forwardFillOverTimeline;
bench("NEW: 20x forwardFillOverTimeline (pointer-walk)", () => {
  let s = 0;
  for (let k = 0; k < series20.length; k++) {
    const filled = forwardFill(series20[k], chartDates, "cumulativeUnits");
    for (let d = 0; d < filled.length; d++) s += filled[d] || 0;
  }
  return s;
}, 3);
console.log();

// ── parseFlexibleDate / parseNumber: called per cell during parsing ──────────
console.log("per-cell parsers  (called ~rows x columns during a sync)");
bench("parseFlexibleDate x1", () => parseFlexibleDate("14/07/2026"), 200000);
bench("parseNumber x1", () => parseNumber("₹1,23,456.78"), 200000);
console.log("\nDone.");
