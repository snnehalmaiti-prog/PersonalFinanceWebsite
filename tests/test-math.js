// Correctness tests for the pure financial kernels in wf-math.js.
// These are the highest-stakes functions in the app and previously had ZERO
// correctness coverage (only a timing benchmark). Run: node tests/test-math.js
const fs = require("fs");
const path = require("path");

// Load the real module (defines globalThis.WfMath).
eval(fs.readFileSync(path.join(__dirname, "..", "wf-math.js"), "utf8"));
const WfMath = globalThis.WfMath || global.WfMath;
if (!WfMath) { console.error("FATAL: WfMath not exported"); process.exit(1); }
const { calculateXIRR, fifoRemainingLots, DAYS_PER_YEAR } = WfMath;

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + detail : "")); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }

// Build a date `years` (in 365.25-day years) after a base date — matches the
// module's own day-count so exact-rate assertions are convention-independent.
const BASE = new Date(2020, 0, 1);
function atYears(years) { return new Date(BASE.getTime() + years * DAYS_PER_YEAR * 86400000); }

// Independent NPV using the SAME day-count — the strongest correctness check:
// a correct IRR makes NPV≈0 regardless of which convention is used.
function npvAt(flows, rate) {
  const t0 = Math.min.apply(null, flows.map(f => f.date.getTime()));
  return flows.reduce((s, f) => {
    const yrs = (f.date.getTime() - t0) / (DAYS_PER_YEAR * 86400000);
    return s + f.amount / Math.pow(1 + rate, yrs);
  }, 0);
}

console.log("X. calculateXIRR");

// X1: exactly +10% over exactly one year.
{
  const r = calculateXIRR([{ date: atYears(0), amount: -1000 }, { date: atYears(1), amount: 1100 }]);
  ok(approx(r, 0.10, 1e-4), "X1 -1000 → +1100 over 1yr ≈ 10%", r);
}
// X2: doubling in one year = +100%.
{
  const r = calculateXIRR([{ date: atYears(0), amount: -1000 }, { date: atYears(1), amount: 2000 }]);
  ok(approx(r, 1.0, 1e-4), "X2 doubling in 1yr ≈ 100%", r);
}
// X3: a 50% loss over one year. Uses realistic lakh-scale flows: the solver's
// acceptance tolerance floors at ₹1 absolute (Math.max(1, scale*1e-9)), so on
// tiny ₹1000 flows the implied rate precision is only ~0.05%; at ₹10L it's tight.
{
  const r = calculateXIRR([{ date: atYears(0), amount: -1000000 }, { date: atYears(1), amount: 500000 }]);
  ok(approx(r, -0.5, 1e-4), "X3 halving in 1yr ≈ -50%", r);
}
// X4: flat, two years — 0% return.
{
  const r = calculateXIRR([{ date: atYears(0), amount: -1000 }, { date: atYears(2), amount: 1000 }]);
  ok(approx(r, 0, 1e-4), "X4 no gain over 2yr ≈ 0%", r);
}
// X5: multi-flow (Excel XIRR reference shape) — assert the root is self-consistent
// (NPV≈0) and lands in the known ballpark (~37%). Day-count differs from Excel's
// 365, so we check NPV≈0 rather than an exact Excel decimal.
{
  const flows = [
    { date: new Date(2008, 0, 1), amount: -10000 },
    { date: new Date(2008, 2, 1), amount: 2750 },
    { date: new Date(2008, 9, 30), amount: 4250 },
    { date: new Date(2009, 1, 15), amount: 3250 },
    { date: new Date(2009, 3, 1), amount: 2750 },
  ];
  const r = calculateXIRR(flows);
  ok(Math.abs(npvAt(flows, r)) < 1e-3, "X5 multi-flow root is self-consistent (NPV≈0)", npvAt(flows, r));
  ok(r > 0.35 && r < 0.39, "X5 multi-flow rate in known ballpark (~37%)", r);
}
// X6: many monthly contributions + terminal — NPV self-consistency at scale.
{
  const flows = [];
  for (let i = 0; i < 24; i++) flows.push({ date: atYears(i / 12), amount: -5000 });
  flows.push({ date: atYears(2), amount: 140000 });
  const r = calculateXIRR(flows);
  ok(Math.abs(npvAt(flows, r)) < 1e-2, "X6 24 monthly SIPs + terminal: NPV≈0", npvAt(flows, r));
}
// X7: a strong-but-realistic extreme (5x over half a year ≈ 2400%/yr) resolves via
// geometric bracket growth rather than returning null. (Absurd rates beyond the 1e7
// bracket cap — e.g. 1000x in weeks — intentionally return null; not tested here as
// they can't occur for real holdings.)
{
  const flows = [{ date: atYears(0), amount: -1000 }, { date: atYears(0.5), amount: 5000 }];
  const r = calculateXIRR(flows);
  ok(r !== null && isFinite(r) && r > 1, "X7 strong short-holding gain resolves (not null)", r);
  ok(Math.abs(npvAt(flows, r)) < 1, "X7 extreme-return root is self-consistent (NPV≈0)", npvAt(flows, r));
}
// X8-X10: degenerate inputs → null.
ok(calculateXIRR([{ date: atYears(0), amount: -1000 }]) === null, "X8 single flow → null");
ok(calculateXIRR([{ date: atYears(0), amount: -1 }, { date: atYears(1), amount: -1 }]) === null, "X9 all-negative → null");
ok(calculateXIRR([{ date: atYears(0), amount: 1 }, { date: atYears(1), amount: 1 }]) === null, "X10 all-positive → null");
ok(calculateXIRR(null) === null && calculateXIRR([]) === null, "X11 null/empty → null");
// X12: sign convention — order of flows must not change the result.
{
  const a = calculateXIRR([{ date: atYears(0), amount: -1000 }, { date: atYears(1), amount: 1200 }]);
  const b = calculateXIRR([{ date: atYears(1), amount: 1200 }, { date: atYears(0), amount: -1000 }]);
  ok(approx(a, b, 1e-9), "X12 flow order does not affect result", a + " vs " + b);
}

console.log("F. fifoRemainingLots");

// F1: partial sell consumes the oldest lot first.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "buy", units: 5, price: 120 },
    { type: "sell", units: 8, price: 150 },
  ]);
  ok(rem.length === 2 && rem[0].units === 2 && rem[0].price === 100 && rem[1].units === 5 && rem[1].price === 120,
    "F1 FIFO sell consumes oldest lot first", JSON.stringify(rem));
}
// F2: sell spanning two lots.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "buy", units: 5, price: 120 },
    { type: "sell", units: 12, price: 150 },
  ]);
  ok(rem.length === 1 && rem[0].units === 3 && rem[0].price === 120, "F2 sell spans lots, remainder from newest", JSON.stringify(rem));
}
// F3: exact full liquidation → nothing open.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "sell", units: 10, price: 150 },
  ]);
  ok(rem.length === 0, "F3 full sell leaves no open lots");
}
// F4: over-sell (more than held) — drains lots, never goes negative.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 5, price: 100 },
    { type: "sell", units: 8, price: 150 },
  ]);
  ok(rem.length === 0, "F4 over-sell drains to empty (no negative lots)");
}
// F5: buy after sell stays open.
{
  const rem = fifoRemainingLots([
    { type: "buy", units: 10, price: 100 },
    { type: "sell", units: 10, price: 150 },
    { type: "buy", units: 4, price: 130 },
  ]);
  ok(rem.length === 1 && rem[0].units === 4 && rem[0].price === 130, "F5 re-buy after full exit is open", JSON.stringify(rem));
}
// F6: no transactions → empty.
ok(fifoRemainingLots([]).length === 0, "F6 empty txns → empty");

console.log("W. forwardFillOverTimeline ≡ lastAtOrBefore (chart optimization)");
// Extract the REAL binary-search lastAtOrBefore from script.js and prove the
// linear pointer-walk returns byte-identical results — the safety guarantee for
// swapping it into the value-chart hot loop.
{
  const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
  const mk = "function lastAtOrBefore(sortedEvents, targetDate, valueKey)";
  const s = SRC.indexOf(mk), bs = SRC.indexOf("{", s);
  let depth = 0, i = bs;
  for (; i < SRC.length; i++) { const c = SRC[i]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } }
  eval(SRC.slice(s, i + 1)); // defines lastAtOrBefore
  const { forwardFillOverTimeline } = WfMath;

  // Deterministic pseudo-random (no Math.random) for repeatable events + timeline.
  function build(nEvents, nDates, seed) {
    let x = seed;
    const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const evs = [];
    let day = 0, val = 0;
    for (let k = 0; k < nEvents; k++) { day += Math.floor(rnd() * 40); val += rnd() * 100; evs.push({ date: new Date(2015, 0, 1 + day), v: val }); }
    const tl = [];
    let d2 = -10; // start before first event so some queries return null
    for (let k = 0; k < nDates; k++) { d2 += Math.floor(rnd() * 15); tl.push(new Date(2015, 0, 1 + d2)); }
    return { evs, tl };
  }
  let mism = 0, cases = 0;
  [[50, 300, 7], [5, 500, 11], [0, 20, 3], [200, 50, 99]].forEach(([ne, nd, sd]) => {
    const { evs, tl } = build(ne, nd, sd);
    const filled = forwardFillOverTimeline(evs, tl, "v");
    for (let k = 0; k < tl.length; k++) {
      cases++;
      const ref = lastAtOrBefore(evs, tl[k], "v");
      if (!(filled[k] === ref || (filled[k] == null && ref == null))) mism++;
    }
  });
  ok(mism === 0, "W1 pointer-walk matches binary-search on " + cases + " randomized queries", mism + " mismatches");
  // Empty events → all null; empty timeline → empty output.
  ok(forwardFillOverTimeline([], [new Date()], "v")[0] === null, "W2 no events → null");
  ok(forwardFillOverTimeline([{ date: new Date(2020, 0, 1), v: 5 }], [], "v").length === 0, "W3 empty timeline → empty");
}

console.log("V. Stocks/ETF invested = FX per-leg + FIFO (computeStocksEtfInvestedINR core)");
// Mirrors the algorithm computeStocksEtfInvestedINR uses: convert each buy leg's
// price to INR (US → × transaction-date USD/INR rate; India → ×1), FIFO-match
// sells, then sum the open lots' INR cost. Reuses the tested fifoRemainingLots.
function investedINR(txns, isUsd, rateByDate, usdToday) {
  const lotTxns = txns.map(t => t.type === "buy"
    ? { type: "buy", units: t.units, price: t.price * (isUsd ? (rateByDate[t.date] || usdToday) : 1) }
    : { type: "sell", units: t.units, price: 0 });
  return fifoRemainingLots(lotTxns).reduce((s, l) => s + l.units * l.price, 0);
}
{
  const rates = { "2024-01-10": 83, "2024-06-20": 84 };
  // US buy: 2 @ $100 on a day with rate 83 → ₹16,600 invested (no sells).
  const us = investedINR([{ type: "buy", units: 2, price: 100, date: "2024-01-10" }], true, rates, 84);
  ok(approx(us, 2 * 100 * 83, 1e-9), "V1 US buy invested is FX-converted (₹16,600)", us);
  // Same numbers but India region → no conversion → ₹200 (the bug: Overview used this for US too).
  const india = investedINR([{ type: "buy", units: 2, price: 100, date: "2024-01-10" }], false, rates, 84);
  ok(india === 200, "V2 India buy invested is NOT converted (₹200)", india);
  ok(approx(us / india, 83, 1e-9), "V3 US invested is ~rate× the un-converted figure (the ~84x bug)", us / india);
  // US buy then partial sell: 3 @ $100 (rate 83), sell 1 → 2 open lots @ ₹8,300 = ₹16,600.
  const partial = investedINR([
    { type: "buy", units: 3, price: 100, date: "2024-01-10" },
    { type: "sell", units: 1, price: 150, date: "2024-06-20" },
  ], true, rates, 84);
  ok(approx(partial, 2 * 100 * 83, 1e-9), "V4 open cost basis after FIFO sell, US converted (₹16,600)", partial);
  // Price-independence: invested needs only the USD/INR rate, never the stock price —
  // so a freshly-added instrument with no live price still contributes.
  ok(investedINR([{ type: "buy", units: 1, price: 50, date: "2024-06-20" }], true, rates, 84) === 50 * 84,
    "V5 invested computed with no stock price (price-independent)");
}

console.log("U. Stocks/ETF current = FX + FIFO + cost fallback (computeStocksEtfCurrentINR core)");
// Mirrors computeStocksEtfCurrentINR: open units (FIFO) × live price (US × today's
// USD/INR), falling back to INR cost basis when the live price hasn't loaded.
function currentINR(txns, isUsd, currentPrice, usdToday, rateByDate) {
  const lotTxns = txns.map(t => t.type === "buy"
    ? { type: "buy", units: t.units, price: t.price * (isUsd ? (rateByDate[t.date] || usdToday) : 1) }
    : { type: "sell", units: t.units, price: 0 });
  let units = 0, cost = 0;
  fifoRemainingLots(lotTxns).forEach(l => { units += l.units; cost += l.units * l.price; });
  if (units <= 1e-9) return 0;
  if (currentPrice == null) return cost;
  return units * (isUsd ? currentPrice * usdToday : currentPrice);
}
{
  const rates = { "2024-01-10": 83 };
  const usBuy = [{ type: "buy", units: 2, price: 100, date: "2024-01-10" }];
  ok(approx(currentINR(usBuy, true, 110, 84, rates), 2 * 110 * 84, 1e-9), "U1 US current = units × live price × today FX (₹18,480)");
  ok(approx(currentINR(usBuy, true, null, 84, rates), 2 * 100 * 83, 1e-9), "U2 US no live price → INR cost-basis fallback (₹16,600)");
  ok(currentINR([{ type: "buy", units: 3, price: 200, date: "2024-01-10" }], false, 250, 84, rates) === 3 * 250, "U3 India current = units × live price (₹750)");
  const partial = [
    { type: "buy", units: 3, price: 100, date: "2024-01-10" },
    { type: "sell", units: 1, price: 150, date: "2024-01-10" },
  ];
  ok(approx(currentINR(partial, true, 120, 84, rates), 2 * 120 * 84, 1e-9), "U4 open units after FIFO sell × live price (₹20,160)");
  ok(currentINR([{ type: "buy", units: 1, price: 5, date: "2024-01-10" }, { type: "sell", units: 1, price: 9, date: "2024-01-10" }], true, 120, 84, rates) === 0, "U5 fully sold → 0 current");
}

// ── attributeFxReturn: stock vs currency on a US holding ────────────────────
// An INR return is two moves at once. The decomposition has to sum exactly and
// the percentages have to compound, or the split is decoration.
{
  // $1,000 bought when the rupee was 75; now worth $1,180 with the rate at 84.
  const a = WfMath.attributeFxReturn(1000, 75000, 1180, 84);
  ok(Math.abs(a.stockPct - 18) < 1e-9, "FX1 the stock moved 18% in dollars", a.stockPct);
  ok(Math.abs(a.fxPct - 12) < 1e-9, "FX2 the rupee moved 12% against the rate paid", a.fxPct);
  ok(Math.abs(a.totalPct - 32.16) < 1e-9,
     "FX3 and the INR return is the two compounded, not added — 32.16%, not 30%", a.totalPct);
  ok(Math.abs((a.stockInr + a.fxInr) - a.totalInr) < 1e-6,
     "FX4 the two amounts sum to the total gain exactly", a);
  ok(Math.abs(a.rateCost - 75) < 1e-9,
     "FX5 the reference rate is the one actually paid, not today's", a.rateCost);
}
{
  // Lots bought at different rates: the reference is cost-weighted, so it lands
  // between them and nearer the larger lot.
  const a = WfMath.attributeFxReturn(2000, 160000, 2000, 80);
  ok(Math.abs(a.rateCost - 80) < 1e-9, "FX6 weighted average rate paid", a.rateCost);
  ok(Math.abs(a.stockInr) < 1e-9, "FX7 a flat stock contributes nothing", a.stockInr);
  ok(Math.abs(a.fxInr) < 1e-9, "FX8 and an unchanged rate contributes nothing", a.fxInr);
}
{
  // A rupee that strengthens takes away from an INR return.
  const a = WfMath.attributeFxReturn(1000, 84000, 1100, 80);
  ok(a.stockPct > 0 && a.fxPct < 0,
     "FX9 the stock can gain while the currency loses", { s: a.stockPct, f: a.fxPct });
  ok(a.fxInr < 0 && Math.abs((a.stockInr + a.fxInr) - a.totalInr) < 1e-6,
     "FX10 and the parts still sum to the whole", a);
}
{
  ok(WfMath.attributeFxReturn(0, 0, 100, 84) === null,
     "FX11 nothing invested, nothing to attribute");
  ok(WfMath.attributeFxReturn(1000, 75000, 1180, 0) === null,
     "FX12 nor without a rate to value it at");
  ok(WfMath.attributeFxReturn(1000, 0, 1180, 84) === null,
     "FX13 nor without an INR cost to compare against");
}

// ── Liabilities against the Overview's Current figure ───────────────────────
// What is left to pay, and whose it is. A liability paid from a personal
// account is that person's in full; one paid from a joint account is nobody's
// until the split says otherwise.
const eq = (a, b, name) => ok(a === b, name, { got: a, want: b });
const ACCTS = [
  { id: "sn", name: "Snnehal", contributing_account: true },
  { id: "tr", name: "Trisha", contributing_account: true },
  { id: "jt", name: "Joint", contributing_account: false },
];
const L = (row) => ({ id: "lb-" + Math.random(), name: "loan", row: row });

{
  eq(WfMath.liabilityRemaining({ amount: 45000, num_payments: 240, installments_done: 40 }),
     200 * 45000, "LB1 what is left to pay is the unpaid instalments, at their amount");
  eq(WfMath.liabilityRemaining({ amount: 45000, num_payments: 240, installments_done: 240 }), 0,
     "LB2 a loan paid off owes nothing");
  eq(WfMath.liabilityRemaining({ amount: 45000, num_payments: 240, installments_done: 900 }), 0,
     "LB3 and cannot go negative if the counter overruns");
  eq(WfMath.liabilityRemaining({ amount: 45000 }), null,
     "LB4 an open-ended schedule owes an unknown amount, not zero");
  eq(WfMath.liabilityRemaining({ amount: 0, num_payments: 10 }), 0,
     "LB5 no instalment amount, nothing owed");

  // Counted off the end date when there is no instalment count.
  eq(WfMath.liabilityRemainingCount({ next_due: "2026-09-01", end_date: "2027-08-01", frequency: "monthly" }),
     12, "LB6 twelve monthly dues from September through the following August");
  eq(WfMath.liabilityRemainingCount({ next_due: "2026-09-01", end_date: "2026-09-01", frequency: "monthly" }),
     1, "LB7 an end date on the due date still owes that instalment");
  eq(WfMath.liabilityRemainingCount({ next_due: "2026-09-02", end_date: "2026-09-01", frequency: "monthly" }),
     0, "LB8 an end date already past owes nothing");
  eq(WfMath.liabilityRemainingCount({ next_due: "2026-01-31", end_date: "2026-04-30", frequency: "monthly" }),
     4, "LB9 a month-end schedule clamps through February rather than skipping a month");
  eq(WfMath.liabilityRemainingCount({ next_due: "2026-09-01", end_date: "2027-09-01", frequency: "quarterly" }),
     5, "LB10 quarterly steps three months at a time");
  eq(WfMath.liabilityRemainingCount({ next_due: "2026-09-01", end_date: "2026-09-29", frequency: "weekly" }),
     5, "LB11 and weekly, seven days");
  eq(WfMath.liabilityRemainingCount({ num_payments: 6, installments_done: 2, end_date: "2027-01-01",
     next_due: "2026-09-01", frequency: "monthly" }), 4,
     "LB12 an explicit instalment count wins over the end date");
}

{
  // A personal account: the whole debt is that person's.
  const d = WfMath.liabilityDeductions(
    [L({ amount: 10000, num_payments: 10, installments_done: 0, account_id: "sn" })], ACCTS);
  eq(d.total, 100000, "LB13 the household owes the whole of it");
  eq(d.byName["snnehal"], 100000, "LB14 and so does the person who pays it");
  eq(d.byName["trisha"], undefined, "LB15 the other person owes none of it");
  eq(d.unattributed, 0, "LB16 nothing is left unassigned");
}
{
  // A joint account: split, or nobody's.
  const split = WfMath.liabilityDeductions(
    [L({ amount: 10000, num_payments: 10, account_id: "jt",
         contribution_split: { sn: 70, tr: 30 } })], ACCTS);
  eq(split.total, 100000, "LB17 the household still owes the whole of it");
  eq(split.byName["snnehal"], 70000, "LB18 divided by the split");
  eq(split.byName["trisha"], 30000, "LB19 across both contributors");
  eq(split.unattributed, 0, "LB20 with nothing left over");

  const none = WfMath.liabilityDeductions(
    [L({ amount: 10000, num_payments: 10, account_id: "jt" })], ACCTS);
  eq(none.total, 100000, "LB21 a joint liability with no split still counts against the household");
  eq(Object.keys(none.byName).length, 0,
     "LB22 but is nobody's in particular — it is not silently handed to one person");
  eq(none.unattributed, 100000, "LB23 and says so, rather than losing the difference");

  // An account that has since been deleted takes its share with it — into the
  // unattributed bucket, never out of the total.
  const gone = WfMath.liabilityDeductions(
    [L({ amount: 10000, num_payments: 10, account_id: "jt",
         contribution_split: { sn: 50, ghost: 50 } })], ACCTS);
  eq(gone.total, 100000, "LB24 a share naming a deleted account does not shrink the debt");
  eq(gone.byName["snnehal"], 50000, "LB25 the share that still resolves is assigned");
  eq(gone.unattributed, 50000, "LB26 and the orphaned one is reported, not dropped");
}
{
  // Percentages that do not add to 100 are normalised rather than trusted: the
  // household total is the truth, and the split only divides it.
  const odd = WfMath.liabilityDeductions(
    [L({ amount: 1000, num_payments: 10, account_id: "jt",
         contribution_split: { sn: 30, tr: 30 } })], ACCTS);
  eq(odd.total, 10000, "LB27 the debt is what it is");
  eq(odd.byName["snnehal"] + odd.byName["trisha"], 10000,
     "LB28 and a split that does not sum to 100 still divides all of it, not 60% of it");
}
{
  const many = WfMath.liabilityDeductions([
    L({ amount: 10000, num_payments: 10, account_id: "sn" }),
    L({ amount: 5000, num_payments: 4, account_id: "jt", contribution_split: { sn: 50, tr: 50 } }),
    L({ amount: 1000, account_id: "sn" }),                       // open-ended
    { _deleted: true, row: { amount: 99999, num_payments: 99, account_id: "sn" } },
  ], ACCTS);
  eq(many.total, 120000, "LB29 liabilities accumulate");
  eq(many.byName["snnehal"], 110000, "LB30 per person, across both kinds");
  eq(many.byName["trisha"], 10000, "LB31 and the joint share reaches the other one");
  eq(many.openEnded, 1,
     "LB32 the open-ended one moves no figure but is counted, so it can be surfaced");
  ok(many.total === 120000,
     "LB33 a deleted liability is not owed — a tombstone is not a debt", many);
}
{
  const d = WfMath.liabilityDeductions(
    [L({ amount: 10000, num_payments: 10, account_id: "jt", contribution_split: { sn: 70, tr: 30 } })],
    ACCTS);
  eq(WfMath.liabilityForPortfolio(d, "all"), 100000, "LB34 the household sees all of it");
  eq(WfMath.liabilityForPortfolio(d, "Snnehal"), 70000, "LB35 a portfolio sees its own share");
  eq(WfMath.liabilityForPortfolio(d, "snnehal "), 70000,
     "LB36 matched on name without being fussy about case or spacing");
  eq(WfMath.liabilityForPortfolio(d, "Nobody"), 0,
     "LB37 a portfolio matching no contributing account owes nothing");
  eq(WfMath.liabilityForPortfolio(null, "all"), 0, "LB38 no liabilities, no deduction");

  // Which loans the figure is made of, for whichever selection is showing.
  const many = WfMath.liabilityDeductions([
    { id: "1", name: "Car loan", row: { amount: 1000, num_payments: 10, account_id: "sn" } },
    { id: "2", name: "Home loan", row: { amount: 1000, num_payments: 100, account_id: "jt",
      contribution_split: { sn: 70, tr: 30 } } },
    { id: "3", name: "Trisha's card", row: { amount: 500, num_payments: 4, account_id: "tr" } },
  ], ACCTS);
  const bAll = WfMath.liabilityBreakdown(many, "all");
  eq(bAll.length, 3, "LB41 the household's figure names every loan behind it");
  eq(bAll[0].name, "Home loan", "LB42 largest first — the one that moves the number most");
  eq(bAll[0].amount, 100000, "LB43 at its full size for the household");
  const bSn = WfMath.liabilityBreakdown(many, "Snnehal");
  eq(bSn.length, 2, "LB44 a portfolio names only the loans it carries");
  ok(!bSn.some((r) => /Trisha/.test(r.name)),
     "LB45 not the other person's — a debt that is not yours is not shown to you", bSn);
  eq(bSn[0].amount, 70000, "LB46 and at its share, not its full size");
  eq(bSn.reduce((s, r) => s + r.amount, 0), WfMath.liabilityForPortfolio(many, "Snnehal"),
     "LB47 the parts add up to the figure they explain");
  eq(WfMath.liabilityBreakdown(many, "Nobody").length, 0,
     "LB48 a portfolio carrying none of it has nothing to name");
  eq(WfMath.liabilityBreakdown(null, "all").length, 0, "LB49 and neither has no data");
  eq(WfMath.liabilityBreakdown(WfMath.liabilityDeductions(
    [{ id: "x", row: { amount: 100, num_payments: 2, account_id: "sn" } }], ACCTS), "all")[0].name,
     "Liability", "LB50 an unnamed liability still gets a label rather than a blank line");
  eq(WfMath.liabilityDeductions(null, ACCTS).total, 0, "LB39 nor from an empty list");
  eq(WfMath.liabilityDeductions([L({ amount: 100, num_payments: 2, account_id: "sn" })], null).total, 200,
     "LB40 the household total survives having no account list to name people with");
}

// ── The liability line on the Account Value chart ───────────────────────────
// A declining staircase from the first instalment forward, drawn per portfolio
// on the same attribution as the Overview figure. Two properties carry it: it
// does not exist before the debt did, and at today it equals what the card says
// is owed — a line that lands near the figure beside it is worse than none.
{
  // Ten monthly instalments of ₹1,000 from 1 Jan 2026; three recorded.
  const loan = { amount: 1000, frequency: "monthly", next_due: "2026-04-01",
    num_payments: 10, installments_done: 3, account_id: "sn" };

  eq(WfMath.liabilityStartDate(loan), "2026-01-01",
     "LS1 the start is recovered by walking next_due back one period per instalment paid");
  eq(WfMath.liabilityStartDate({ next_due: "2026-04-01", frequency: "monthly" }), "2026-04-01",
     "LS2 an untouched schedule starts where it says it does");
  eq(WfMath.liabilityStartDate({ next_due: "2027-01-01", frequency: "quarterly", installments_done: 4 }),
     "2026-01-01", "LS3 quarterly steps back three months at a time");
  eq(WfMath.liabilityTotalCount(loan), 10, "LS4 the plan is ten instalments long");
  eq(WfMath.liabilityTotalCount({ next_due: "2026-01-01", end_date: "2026-06-01", frequency: "monthly" }),
     6, "LS5 or as many as fit before the end date");

  eq(WfMath.liabilityOutstandingAt(loan, "2025-12-31"), null,
     "LS6 nothing is owed before the loan existed — the line does not reach back");
  eq(WfMath.liabilityOutstandingAt(loan, "2026-01-01"), 9000,
     "LS7 on the first due date one instalment has been paid, as the processor posts it that day");
  eq(WfMath.liabilityOutstandingAt(loan, "2026-02-15"), 8000,
     "LS8 and a month later, two");
  eq(WfMath.liabilityOutstandingAt(loan, "2026-04-01"), 7000,
     "LS9 capped by what was actually recorded — three paid, not four, on a schedule that is behind");
  eq(WfMath.liabilityOutstandingAt(loan, "2027-06-01"), 7000,
     "LS10 and it stays there rather than paying itself off on paper");
  // The property that matters: the line meets the card.
  eq(WfMath.liabilityOutstandingAt(loan, "2026-04-01"), WfMath.liabilityRemaining(loan),
     "LS11 at today the line equals what the Overview says is owed");
}
{
  const dates = ["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"];
  const items = [{ id: "a", row: { amount: 1000, frequency: "monthly", next_due: "2026-03-01",
    num_payments: 10, installments_done: 2, account_id: "sn" } }];
  const s = WfMath.liabilityOwedSeries(items, ACCTS, "all", dates);
  eq(s.start, "2026-01-01", "LS12 the series knows when the debt began");
  // Nothing owed at the last point before the loan: the line meets the asset
  // line there and drops away from it, so taking the debt on is visible as an
  // event rather than the line simply appearing partway down the chart.
  eq(s.values[0], 0, "LS13 with nothing owed at the point before it began");
  eq(s.values[1], 9000, "LS14 then steps down one instalment per period");
  eq(s.values[2], 8000, "LS15 monotonically");
  eq(s.values[3], 8000, "LS16 pausing where the payments actually stopped");
  ok(s.any, "LS17 and reports that it has something to draw");

  // Portfolio selection: the line is one person's share, not the household's.
  const joint = [{ id: "b", row: { amount: 1000, frequency: "monthly", next_due: "2026-03-01",
    num_payments: 10, installments_done: 2, account_id: "jt",
    contribution_split: { sn: 70, tr: 30 } } }];
  eq(WfMath.liabilityOwedSeries(joint, ACCTS, "all", dates).values[1], 9000,
     "LS18 the household carries the whole schedule");
  eq(WfMath.liabilityOwedSeries(joint, ACCTS, "Snnehal", dates).values[1], 6300,
     "LS19 a portfolio carries its share of it, at every point");
  eq(WfMath.liabilityOwedSeries(joint, ACCTS, "Trisha", dates).values[2], 2400,
     "LS20 including as the staircase descends");
  const none = WfMath.liabilityOwedSeries(joint, ACCTS, "Nobody", dates);
  ok(!none.any && none.values.every((v) => v === null),
     "LS21 a portfolio carrying none of it gets no line at all", none);

  // Two liabilities that began at different times add up, and the line starts
  // at the earlier of them.
  const two = WfMath.liabilityOwedSeries([items[0],
    { id: "c", row: { amount: 500, frequency: "monthly", next_due: "2026-02-01",
      num_payments: 4, installments_done: 0, account_id: "sn" } }], ACCTS, "all", dates);
  eq(two.start, "2026-01-01", "LS22 the line begins with the earliest debt");
  eq(two.values[1], 9000, "LS23 carrying only the one that had begun");
  eq(two.values[2], 8000 + 2000, "LS24 and both once the second starts");
  eq(two.values[0], 0,
     "LS25 a second liability starting later does not blank the anchor of the first");

  // A liability that began before the chart has no room for an anchor, and must
  // still draw from the first point rather than being dropped.
  // Six paid, so it started in September — before the chart's first point.
  const early = WfMath.liabilityOwedSeries([{ id: "e", row: { amount: 1000,
    frequency: "monthly", next_due: "2026-03-01", num_payments: 10,
    installments_done: 6, account_id: "sn" } }], ACCTS, "all", dates);
  eq(early.values[0], 6000,
     "LS26 a debt older than the chart is drawn from its first point, with no " +
     "anchor to drop from — there is no before to show");

  eq(WfMath.liabilityOwedSeries([{ id: "d", row: { amount: 1000, frequency: "monthly",
    next_due: "2026-02-01", account_id: "sn" } }], ACCTS, "all", dates).any, false,
     "LS27 an open-ended liability draws nothing — its size is not known");
  eq(WfMath.liabilityOwedSeries(items, ACCTS, "all", []).any, false,
     "LS28 and an empty timeline draws nothing");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
