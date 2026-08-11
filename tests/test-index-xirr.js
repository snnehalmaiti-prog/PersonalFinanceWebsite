// The benchmark simulation: "what if the same rupees had gone into the index?"
//
// Every buy purchases index units, every sale redeems them, and what is left is
// valued at the latest index level. The whole point is that the answer describes
// the INDEX — so the property each case here checks is that the simulated XIRR
// comes out at the index's own return, whatever the portfolio did.
//
// The bug this exists for: a sale capped the units it redeemed at what the
// position held, then booked the portfolio's full rupee proceeds anyway. A
// winner sold for more than the index position was worth credited the simulation
// money it never had, and once it had sold out the flows it reported were the
// portfolio's own — so "Nifty 50 XIRR" read back the portfolio's return. It ran
// against the reader: the benchmark inflates, so alpha reads worse than it is.
//
// Functions are extracted from script.js, not reimplemented.
//
//     node tests/test-index-xirr.js
//
// Deliberately not "use strict": eval'd function declarations land in the eval's
// own scope under strict mode, so the extracted functions would be invisible
// here. The other extraction suites omit it for the same reason.

const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function extract(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error("marker not found in script.js: " + marker);
  let depth = 0, i = SRC.indexOf("{", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}
eval(extract("function lookupIndexPrice(") + "\n\n" + extract("function buildIndexXirrCashFlows("));
eval(fs.readFileSync(path.join(__dirname, "..", "wf-math.js"), "utf8"));
const calculateXIRR = globalThis.WfMath.calculateXIRR;

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 1e-6 : tol);
const D = (s) => new Date(s + "T00:00:00");

// An index compounding at a known rate, sampled monthly. Every expectation below
// is this number, because that is the only thing the simulation should report.
const RATE = 0.1067;
const START_LEVEL = 10000;
const T0 = D("2020-01-01");
const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const levelAt = (d) => START_LEVEL * Math.pow(1 + RATE, (d - T0) / YEAR_MS);
const iso = (d) => d.toISOString().slice(0, 10);
// Monthly through today, and one entry ON today. The terminal flow is dated
// now while being priced at the LAST index date, so a fixture whose history
// stopped short — or ran past today, as this one first did — values the
// terminal at the wrong level and the error looks like a bug in the simulation.
const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0);
const PRICES = (() => {
  const p = {};
  const cur = new Date(2020, 0, 1);
  while (cur <= TODAY) {
    p[iso(new Date(cur.getFullYear(), cur.getMonth(), 1, 12))] =
      levelAt(new Date(cur.getFullYear(), cur.getMonth(), 1));
    cur.setMonth(cur.getMonth() + 1);
  }
  p[iso(TODAY)] = levelAt(TODAY);
  return p;
})();
const LATEST = PRICES[iso(TODAY)];
const levelOn = (d) => levelAt(D(d));

console.log("A. A sale larger than the simulated position");
{
  // ₹1,00,000 into a ten-bagger, sold four years later. The index position that
  // ₹1,00,000 bought is worth ~₹1,50,000 by then — nothing like ₹10,00,000.
  const flows = [
    { date: D("2020-01-01"), amount: -100000 },
    { date: D("2024-01-01"), amount: 1000000 },
  ];
  const idx = buildIndexXirrCashFlows(flows, PRICES);
  const held = 100000 / levelOn("2020-01-01");
  const worth = held * levelOn("2024-01-01");

  ok(idx.length === 2, "A1 one flow in, one flow out", idx.length);
  ok(near(idx[1].amount, worth, 1),
     "A2 the sale takes in what the index units were worth, not what the " +
     "portfolio's own sale realised", { got: idx[1].amount, want: worth });
  ok(idx[1].amount < 200000,
     "A3 nowhere near the portfolio's ₹10,00,000 — that money was never in this " +
     "position to take out", idx[1].amount);

  const idxXirr = calculateXIRR(idx);
  ok(near(idxXirr, RATE, 5e-4),
     "A4 so the benchmark reports the index's own return", { got: idxXirr, want: RATE });
  const portXirr = calculateXIRR(flows);
  ok(portXirr > 0.7 && Math.abs(idxXirr - portXirr) > 0.5,
     "A5 and NOT the portfolio's, which is the failure this guards: a sold " +
     "winner used to make the benchmark echo the portfolio",
     { index: idxXirr, portfolio: portXirr });
}

console.log("\nB. A sale the position can fund");
{
  // The index outgrew the holding here, so the units are there to redeem and the
  // capped and uncapped answers agree. This is the case that always worked, and
  // it has to keep working.
  const flows = [
    { date: D("2020-01-01"), amount: -100000 },
    { date: D("2024-01-01"), amount: 120000 },
  ];
  const idx = buildIndexXirrCashFlows(flows, PRICES);
  ok(near(idx[1].amount, 120000, 1),
     "B1 a sale within what the position holds takes in exactly that amount",
     idx[1].amount);
  const held = 100000 / levelOn("2020-01-01") - 120000 / levelOn("2024-01-01");
  ok(held > 0, "B2 leaving units behind", held);
  ok(idx.length === 3 && near(idx[2].amount, held * LATEST, 1),
     "B3 which the terminal values at the latest index level",
     { got: idx[2] && idx[2].amount, want: held * LATEST });
  ok(near(calculateXIRR(idx), RATE, 5e-4),
     "B4 and the answer is still the index's return", calculateXIRR(idx));
}

console.log("\nC. Buying and holding");
{
  const flows = [
    { date: D("2020-01-01"), amount: -100000 },
    { date: D("2022-01-01"), amount: -50000 },
  ];
  const idx = buildIndexXirrCashFlows(flows, PRICES);
  const units = 100000 / levelOn("2020-01-01") + 50000 / levelOn("2022-01-01");
  ok(idx.length === 3, "C1 two buys and a terminal", idx.length);
  ok(near(idx[2].amount, units * LATEST, 1),
     "C2 the terminal is every unit still held, at the latest level", idx[2].amount);
  ok(near(calculateXIRR(idx), RATE, 5e-4),
     "C3 two purchases at different levels still return the index's rate",
     calculateXIRR(idx));
}

console.log("\nD. Selling out completely");
{
  const flows = [
    { date: D("2020-01-01"), amount: -100000 },
    { date: D("2023-01-01"), amount: 400000 },   // far more than the position
    { date: D("2024-01-01"), amount: -200000 },  // and buying back in later
  ];
  const idx = buildIndexXirrCashFlows(flows, PRICES);
  ok(idx.length === 4, "D1 in, out, in, terminal", idx.length);
  ok(idx[1].amount < 150000,
     "D2 the exit takes only what was there", idx[1].amount);
  ok(near(idx[2].amount, -200000, 1e-9),
     "D3 a later purchase is unaffected — a cash-flow series is not a bank " +
     "balance, and the index can always be bought again", idx[2].amount);
  ok(near(calculateXIRR(idx), RATE, 5e-4),
     "D4 and round-tripping out and back in still returns the index's rate",
     calculateXIRR(idx));
}

console.log("\nE. Degenerate inputs");
{
  ok(buildIndexXirrCashFlows(null, PRICES) === null, "E1 no flows, no simulation");
  ok(buildIndexXirrCashFlows([], PRICES) === null, "E2 nor an empty list");
  ok(buildIndexXirrCashFlows([{ date: D("2020-01-01"), amount: -1000 }], null) === null,
     "E3 nor without index prices");
  // A sale before anything was bought has no units behind it, so it can only
  // take in nothing — booking the portfolio's amount would invent a return from
  // a position that never existed.
  const orphan = buildIndexXirrCashFlows(
    [{ date: D("2020-01-01"), amount: 50000 }, { date: D("2021-01-01"), amount: -10000 }], PRICES);
  ok(orphan.length === 3 && orphan[0].amount === 0,
     "E4 a sale with nothing held takes in nothing", orphan.map((f) => f.amount));
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
