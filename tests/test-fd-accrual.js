// Fixed Deposit accrual.
//
// A cumulative FD compounds quarterly, but its value between quarter boundaries
// used to stand still — a deposit two months old showed Rs 0 unrealized, then
// jumped. Interest now accrues pro-rata within the quarter in progress.
//
// The invariant that matters: ON a quarter boundary the value must be exactly
// what quarterly compounding gives, so this change adds resolution without
// moving any figure that was already correct.
//
// Extracts the real functions from script.js and checks them against
// expectations worked out here, not against a re-run of the shipped formula.


var window = {};
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function extract(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error("marker not found: " + marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
  }
  let end = i + 1;
  if (SRC[end] === ";") end++;
  return SRC.slice(start, end);
}

let sheets = {};
// parseFlexibleDate memoises into these; declared here because extract() slices
// on brace balance and cannot take a bare `var`.
var _dateParseMemo = Object.create(null);
var _dateParseMemoSize = 0;
function getSheetRows(prefix) { return sheets[prefix] || null; }
function isProvidentFundSub(s) { return /provident|epf|ppf/.test(String(s || "").toLowerCase()); }

eval([
  "function normalizeText(value)",
  "function parseNumber(value)",
  "function parseFlexibleDate(value)",
  "function _parseFlexibleDateUncached(str)",
  "function parsePercentRate(value)",
  "function _addMonthsClamped(base, n)",
  "function countElapsedQuarters(start, asOf)",
  "function elapsedQuartersFractional(start, asOf)",
].map(extract).join("\n\n"));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-9 : eps); }
const D = (s) => new Date(s + "T00:00:00");

console.log("A. Quarter boundaries are preserved exactly");
{
  const start = D("2024-01-15");
  [1, 2, 3, 4, 8].forEach(function (q, i) {
    const boundary = _addMonthsClamped(start, q * 3);
    ok(elapsedQuartersFractional(start, boundary) === q,
       "A" + (i + 1) + " exactly " + q + " on quarter boundary " + q,
       elapsedQuartersFractional(start, boundary));
  });
  ok(elapsedQuartersFractional(start, start) === 0, "A6 zero elapsed at the start date");
  ok(elapsedQuartersFractional(start, D("2023-12-01")) === 0, "A7 a date before the start is zero, not negative");
  ok(elapsedQuartersFractional(null, D("2024-06-01")) === 0, "A8 a missing start date is zero");
}

console.log("\nB. The part-quarter accrues in proportion to days elapsed");
{
  const start = D("2024-01-01");
  // Q1 runs 1-Jan to 1-Apr 2024 = 91 days (2024 is a leap year: Jan 31 + Feb 29 + Mar 31).
  const q1days = (D("2024-04-01") - start) / 86400000;
  ok(q1days === 91, "B1 the first quarter is 91 days long here", q1days);
  const half = elapsedQuartersFractional(start, D("2024-02-16")); // 46 days in
  ok(near(half, 46 / 91, 1e-12), "B2 46 of 91 days reads as 46/91 of a quarter", half);
  // Measured against the CURRENT quarter's own length, not a fixed 91.25 — Q2
  // (1-Apr to 1-Jul) is 91 days, Q3 (1-Jul to 1-Oct) is 92.
  const q3 = elapsedQuartersFractional(start, D("2024-08-16")); // 46 days into Q3
  ok(near(q3, 2 + 46 / 92, 1e-12), "B3 the fraction uses that quarter's real length", q3);
  ok(elapsedQuartersFractional(start, D("2024-03-31")) < 1, "B4 one day short of the boundary is under a full quarter");
  ok(elapsedQuartersFractional(start, D("2024-04-02")) > 1, "B5 one day past it is over");
}

console.log("\nC. Month-end starts are handled by the clamped month arithmetic");
{
  const start = D("2024-11-30");
  ok(_addMonthsClamped(start, 3).getTime() === D("2025-02-28").getTime(),
     "C1 30-Nov + 3 months clamps to 28-Feb");
  ok(elapsedQuartersFractional(start, D("2025-02-28")) === 1, "C2 and that date is exactly one quarter");
  const start2 = D("2024-01-31");
  ok(_addMonthsClamped(start2, 1).getTime() === D("2024-02-29").getTime(),
     "C3 31-Jan + 1 month clamps to 29-Feb in a leap year");
}

console.log("\nD. Monotonic: value never goes backwards or jumps");
{
  const start = D("2025-06-03");
  let prev = -1, maxStep = 0;
  for (let d = 0; d <= 400; d++) {
    const asOf = new Date(start.getTime() + d * 86400000);
    const q = elapsedQuartersFractional(start, asOf);
    if (q < prev) { ok(false, "D1 non-monotonic at day " + d, [prev, q]); prev = q; break; }
    if (prev >= 0) maxStep = Math.max(maxStep, q - prev);
    prev = q;
  }
  ok(prev >= 4.3 && prev <= 4.5, "D1 400 days is about 4.4 quarters", prev);
  ok(maxStep < 0.02, "D2 no step bigger than a single day's worth — the discontinuity is gone", maxStep);
}

console.log("\nE. The user's deposits, end to end");
{
  // Deposit-1: Rs 32,051 at 6.25% from 3-Jun-2026. As of 29-Jul-2026 that is 56
  // days into a 92-day quarter (3-Jun → 3-Sep), so value = P * (1+r/4)^(56/92).
  const P = 32051, r = 0.0625;
  const start = D("2026-06-03"), asOf = D("2026-07-29");
  const qEnd = _addMonthsClamped(start, 3);
  const qLen = (qEnd - start) / 86400000;
  ok(qLen === 92, "E1 3-Jun to 3-Sep is 92 days", qLen);
  const q = elapsedQuartersFractional(start, asOf);
  ok(near(q, 56 / 92, 1e-12), "E2 56/92 of the first quarter has elapsed", q);
  const value = P * Math.pow(1 + r / 4, q);
  const interest = value - P;
  ok(interest > 290 && interest < 320, "E3 accrued interest is about Rs 305, not Rs 0", Math.round(interest));
  // And at the first quarter boundary it must equal plain quarterly compounding.
  const atBoundary = P * Math.pow(1 + r / 4, elapsedQuartersFractional(start, qEnd));
  ok(near(atBoundary, P * (1 + r / 4), 1e-9), "E4 unchanged at the quarter boundary", atBoundary);
  ok(Math.round(atBoundary) === 32552, "E5 which is Rs 32,552", Math.round(atBoundary));
}

console.log("\nF. A matured FD is valued at its maturity date, not today");
{
  // Maturity mid-quarter now earns its part-quarter too, instead of being
  // truncated down to the last whole quarter.
  const start = D("2024-01-01"), maturity = D("2024-11-15");
  const q = elapsedQuartersFractional(start, maturity);
  ok(q > 3 && q < 4, "F1 a 10.5-month FD is between 3 and 4 quarters", q);
  ok(countElapsedQuarters(start, maturity) === 3, "F2 (the old whole-quarter count truncated it to 3)");
  const P = 100000, r = 0.07;
  ok(P * Math.pow(1 + r / 4, q) > P * Math.pow(1 + r / 4, 3),
     "F3 so the maturity value is now higher than the truncated one");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
