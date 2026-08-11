// Fixed Deposits on the Account Value chart: valued as they grow.
//
// The chart used to hold an FD at its principal from purchase to maturity — a
// step, not a curve. So an FD-heavy portfolio read flat for years and then
// jumped at the final point, where the tail is snapped to the Overview's
// accrual-inclusive total. The jump was the only place the interest appeared.
//
// The invariant that matters is agreement: on any date, what the chart puts on
// the line must be what buildFdHoldingsList would call that FD's current value.
// A second way of valuing a deposit that drifts from the first is worse than a
// step, because a step is at least obviously wrong.
//
// Functions are extracted from script.js, not reimplemented here.

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
  "function _fiIsTermDeposit(normSub)",
  "function buildFdAccrualAt(timeline, portfolioFilter)",
  "function buildFdValueEvents(portfolioFilter, excludeBalance, includeFd)",
].map(extract).join("\n\n"));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }
const D = (s) => new Date(s + "T00:00:00");

const HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const FD = (date, portfolio, amount, maturity, rate) =>
  [date, portfolio, "HDFC", "Deposit " + date, "Fixed Income", "Fixed Deposit", "Deposit",
    String(amount), maturity, rate, ""];

console.log("A. An FD grows on the chart instead of standing still");
{
  sheets = { fd: [HDR, FD("1-Jan-2024", "Snnehal", 100000, "1-Jan-2030", "8%")] };
  const tl = ["2023-12-01", "2024-01-01", "2024-04-01", "2024-07-01", "2025-01-01"].map(D);
  const v = buildFdAccrualAt(tl, "all");

  ok(v[0] === 0, "A1 nothing before the deposit was made", v[0]);
  ok(v[1] === 100000, "A2 its principal on the day it was made", v[1]);
  // One quarter at 8%/4 = 2%.
  ok(near(v[2], 100000 * 1.02), "A3 one quarter later, one quarter's interest", v[2]);
  ok(near(v[3], 100000 * Math.pow(1.02, 2)), "A4 compounding, not simple", v[3]);
  ok(near(v[4], 100000 * Math.pow(1.02, 4)), "A5 four quarters after a year", v[4]);
  ok(v[4] > v[3] && v[3] > v[2] && v[2] > v[1],
     "A6 the value rises at every step — the whole point, against a flat step", v);
}

console.log("\nB. It agrees with how the Overview values the same deposit");
{
  // The card's rule: principal × (1 + rate/4) ^ fractional quarters elapsed,
  // capped at maturity. Checked on a date mid-quarter, where a truncating
  // implementation would differ.
  sheets = { fd: [HDR, FD("15-Feb-2024", "Snnehal", 250000, "15-Feb-2029", "7.1%")] };
  const asOf = D("2025-06-20");
  const v = buildFdAccrualAt([asOf], "all")[0];
  const expected = 250000 * Math.pow(1 + 0.071 / 4, elapsedQuartersFractional(D("2024-02-15"), asOf));
  ok(near(v, expected, 1e-6),
     "B1 mid-quarter, the chart's figure is the card's figure", { chart: v, card: expected });
  ok(v > 250000 && v < 250000 * 1.4, "B2 and is a plausible size", v);
}

console.log("\nC. Maturity closes the deposit, as it always did");
{
  sheets = { fd: [HDR, FD("1-Jan-2024", "Snnehal", 100000, "1-Jul-2024", "8%")] };
  const tl = ["2024-06-30", "2024-07-01", "2025-01-01"].map(D);
  const v = buildFdAccrualAt(tl, "all");
  ok(v[0] > 100000, "C1 still growing the day before maturity", v[0]);
  ok(v[1] === 0, "C2 gone on the maturity date — the money has left the FD", v[1]);
  ok(v[2] === 0, "C3 and stays gone rather than compounding forever", v[2]);
  // The value it reached is the maturity value, not a truncated one.
  ok(near(v[0], 100000 * Math.pow(1.02, elapsedQuartersFractional(D("2024-01-01"), D("2024-06-30")))),
     "C4 right up to the last day it accrues by the same rule", v[0]);
}

console.log("\nD. Whose deposit it is");
{
  sheets = { fd: [HDR,
    FD("1-Jan-2024", "Snnehal", 100000, "1-Jan-2030", "8%"),
    FD("1-Jan-2024", "Trisha", 50000, "1-Jan-2030", "8%")] };
  const tl = [D("2025-01-01")];
  const all = buildFdAccrualAt(tl, "all")[0];
  const sn = buildFdAccrualAt(tl, "Snnehal")[0];
  const tr = buildFdAccrualAt(tl, "Trisha")[0];
  ok(near(all, sn + tr),
     "D1 the portfolios sum to the household, accrued interest and all",
     { all: all, sn: sn, tr: tr });
  ok(near(sn, 2 * tr), "D2 in proportion to what each put in", { sn: sn, tr: tr });
  ok(buildFdAccrualAt(tl, "Nobody")[0] === 0, "D3 and a portfolio with none has none");
}

console.log("\nE. Only term deposits, and no double counting");
{
  // Savings and PF are running balances, not deposits that compound at a stated
  // rate — they stay with buildFdValueEvents, which is what actually models them.
  sheets = { fd: [HDR,
    FD("1-Jan-2024", "Snnehal", 100000, "1-Jan-2030", "8%"),
    ["1-Jan-2024", "Snnehal", "HDFC", "Savings A", "Fixed Income", "Savings Account", "Deposit", "300000", "", "", ""],
    ["1-Jan-2024", "Snnehal", "EPFO", "PF", "Fixed Income", "Provident Fund", "Deposit", "200000", "", "", ""]] };
  const v = buildFdAccrualAt([D("2025-01-01")], "all")[0];
  ok(v > 100000 && v < 120000,
     "E1 the accrual series carries the deposit alone — not the savings or the PF beside it", v);

  // And the events series must now leave FDs out, or the chart counts each twice.
  const ev = buildFdValueEvents("all", false, false);
  const last = ev.length ? ev[ev.length - 1].cumulativeValue : 0;
  ok(near(last, 500000),
     "E2 with includeFd=false the events carry savings + PF and no deposit", last);
  // Peak, not last: the final event is the maturity drop back to zero, so the
  // last value is the same either way and would prove nothing.
  const peak = (l) => Math.max.apply(null, l.map((e) => e.cumulativeValue));
  ok(peak(buildFdValueEvents("all", false, true)) > peak(ev),
     "E3 (includeFd=true still adds it as a step, for the callers that want that)",
     { withFd: peak(buildFdValueEvents("all", false, true)), without: peak(ev) });
}

console.log("\nG. The incremental quarter walk equals the canonical count");
{
  // buildFdAccrualAt carries the quarter boundary along the timeline instead of
  // asking elapsedQuartersFractional at every point, which would be
  // O(dates x quarters). That is only allowed if it lands on the same number
  // everywhere — checked here across six years of daily dates, spanning leap
  // years and every quarter length.
  sheets = { fd: [HDR, FD("15-Jan-2020", "Snnehal", 137000, "1-Jan-2030", "6.85%")] };
  const tl = [];
  for (let t = D("2020-01-01").getTime(); t <= D("2026-01-01").getTime(); t += 86400000) {
    tl.push(new Date(t));
  }
  const walked = buildFdAccrualAt(tl, "all");
  let worst = 0, worstAt = null;
  tl.forEach((d, i) => {
    const canonical = d < D("2020-01-15") ? 0
      : 137000 * Math.pow(1 + 0.0685 / 4, elapsedQuartersFractional(D("2020-01-15"), d));
    const diff = Math.abs(walked[i] - canonical);
    if (diff > worst) { worst = diff; worstAt = d.toISOString().slice(0, 10); }
  });
  ok(tl.length > 2000, "G1 the sweep really is years of daily points", tl.length);
  ok(worst < 1e-6,
     "G2 and every one of them matches the canonical valuation to the paisa",
     { worst: worst, at: worstAt });
  // Ascending order is the walk's one assumption; going backwards must restart it.
  const rev = buildFdAccrualAt(tl.slice().reverse(), "all");
  ok(Math.abs(rev[0] - walked[walked.length - 1]) < 1e-6,
     "G3 a timeline handed over backwards still values each date correctly",
     { rev: rev[0], fwd: walked[walked.length - 1] });
}

console.log("\nF. Degenerate rows are skipped, not charted as zero-value noise");
{
  sheets = { fd: [HDR,
    FD("", "Snnehal", 100000, "1-Jan-2030", "8%"),              // no start date
    FD("1-Jan-2024", "Snnehal", 0, "1-Jan-2030", "8%"),          // no principal
    FD("1-Jan-2024", "Snnehal", 100000, "", "")] };              // no maturity, no rate
  const v = buildFdAccrualAt([D("2025-01-01")], "all")[0];
  ok(v === 100000,
     "F1 a deposit with no rate holds at principal; the undated and empty ones are dropped", v);
  sheets = { fd: [HDR] };
  ok(buildFdAccrualAt([D("2025-01-01")], "all")[0] === 0, "F2 no rows, no value");
  sheets = {};
  ok(buildFdAccrualAt([D("2025-01-01")], "all")[0] === 0, "F3 no sheet, no value");
  ok(buildFdAccrualAt([], "all").length === 0, "F4 no timeline, no series");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
