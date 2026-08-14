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
//
// Forced to Asia/Kolkata, because a UTC runner cannot see the class of bug this
// simulation is most exposed to. Transaction dates are built at LOCAL midnight,
// so anything that reaches for toISOString() names the previous day in every
// timezone ahead of UTC — and silently gets away with it under TZ=UTC, which is
// what this suite ran as. Section G is meaningless anywhere else, and the rest
// of the file is timezone-agnostic, so the whole suite simply runs there.
if (process.env.TZ !== "Asia/Kolkata") {
  const r = require("child_process").spawnSync(process.execPath, [__filename], {
    stdio: "inherit", env: Object.assign({}, process.env, { TZ: "Asia/Kolkata" }),
  });
  process.exit(r.status === null ? 1 : r.status);
}

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
eval(extract("function formatDateISO(") + "\n\n" + extract("function lookupIndexPrice(") + "\n\n" + extract("function buildIndexXirrCashFlows("));
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

console.log("\nF. Chronological order is the loop's own responsibility");
{
  // unitsHeld is carried across the list and every sale is capped at it, so the
  // flows only mean anything in the order they happened. The CALLERS never
  // guaranteed that: buildScopedReturnFlows concatenates sources — Mutual Fund,
  // then Stocks/ETF, then matured FDs, then PF, then commodity — each in sheet
  // order, and nothing sorted the result. A Stocks/ETF buy from 2020 therefore
  // arrived AFTER a Mutual Fund sale from 2023, and that sale was capped against
  // units the simulation had not bought yet.
  //
  // Only the INDEX leg was wrong: the portfolio side comes from calculateXIRR,
  // which is order-independent. So the entire error landed in the alpha.
  const mf = [{ date: D("2021-01-01"), amount: -100000 }, { date: D("2023-01-01"), amount: 400000 }];
  const se = [{ date: D("2020-01-01"), amount: -300000 }];
  const concatenated = mf.concat(se);
  const sorted = concatenated.slice().sort((a, b) => a.date - b.date);
  const shuffled = [concatenated[1], concatenated[2], concatenated[0]];

  const xirrOf = (flows) => calculateXIRR(buildIndexXirrCashFlows(flows, PRICES));
  ok(near(xirrOf(concatenated), xirrOf(sorted)),
     "F1 concatenated order gives the same answer as chronological order",
     [xirrOf(concatenated), xirrOf(sorted)]);
  ok(near(xirrOf(shuffled), xirrOf(sorted)),
     "F2 and so does an arbitrary shuffle", [xirrOf(shuffled), xirrOf(sorted)]);
  ok(near(xirrOf(concatenated), RATE, 5e-4),
     "F3 which is the index's own return, the only thing this may report",
     xirrOf(concatenated));

  // The mechanism, not just the summary: by 2023 the simulation holds units from
  // both 2020 and 2021, so the sale redeems its whole Rs4,00,000.
  const sale = buildIndexXirrCashFlows(concatenated, PRICES)
    .find((f) => f.amount > 0 && f.date.getFullYear() === 2023);
  ok(sale && Math.round(sale.amount) === 400000,
     "F4 the 2023 sale redeems all Rs4,00,000, not the slice 2021 alone could fund",
     sale && Math.round(sale.amount));
}

console.log("\nG. Flows are priced on their own LOCAL calendar day");
{
  ok(new Date(2024, 0, 15).toISOString().slice(0, 10) === "2024-01-14",
     "G1 the runner is in a timezone where local date and UTC date disagree");

  // Two prices a day apart and a factor of two apart, so choosing the wrong day
  // is unmissable in the unit count rather than a rounding difference.
  const twoDays = { "2024-01-14": 1000, "2024-01-15": 2000 };
  const flows = buildIndexXirrCashFlows([{ date: D("2024-01-15"), amount: -100000 }], twoDays);
  const terminal = flows[flows.length - 1].amount;
  ok(Math.round(terminal) === 100000,
     "G2 a flow dated the 15th buys at the 15th's level: 50 units, not 100",
     Math.round(terminal));

  // And the guarantee is stated where the loop that needs it lives, so a future
  // caller cannot reintroduce either fault by passing its own list.
  const fn = extract("function buildIndexXirrCashFlows(");
  ok(/allCashFlows\.slice\(\)\.sort\(/.test(fn), "G3 the sort is inside the function");
  ok(/formatDateISO\(cf\.date\)/.test(fn) && !/\.toISOString\(\)\.slice/.test(fn),
     "G4 and the date comes from formatDateISO, as everywhere else in the file");
}

{
  console.log("\nH. The back-walk to the previous trading day");
  // Index prices exist on trading days only, so a flow dated on a weekend, a
  // holiday or the 1st of a month MISSES and has to walk back. That walk used to
  // build a Date and call toISOString() up to five times per call; it is now ISO
  // string arithmetic with a per-series memo. This block is the only cover that
  // branch has — before it, every assertion in this file landed on an exact match.
  const P = { "2024-02-29": 100, "2024-03-01": 110, "2023-12-29": 90, "2024-05-31": 120 };

  ok(lookupIndexPrice(P, "2024-03-01") === 110, "H1 an exact match still short-circuits");
  ok(lookupIndexPrice(P, "2024-03-02") === 110, "H2 one day back");
  ok(lookupIndexPrice(P, "2024-03-06") === 110, "H3 five days back — the furthest it reaches",
     lookupIndexPrice(P, "2024-03-06"));
  ok(lookupIndexPrice(P, "2024-03-07") === null, "H4 six days back is out of reach",
     lookupIndexPrice(P, "2024-03-07"));

  // Boundaries the old Date walk got for free and string arithmetic must earn.
  ok(lookupIndexPrice(P, "2024-03-01") === 110 && lookupIndexPrice(P, "2024-03-02") === 110,
     "H5 crossing into February");
  ok(lookupIndexPrice({ "2024-02-29": 100 }, "2024-03-01") === 100,
     "H6 lands on 29 Feb in a leap year rather than skipping it",
     lookupIndexPrice({ "2024-02-29": 100 }, "2024-03-01"));
  ok(lookupIndexPrice({ "2023-02-28": 55 }, "2023-03-02") === 55,
     "H7 and on 28 Feb in a non-leap year",
     lookupIndexPrice({ "2023-02-28": 55 }, "2023-03-02"));
  ok(lookupIndexPrice(P, "2024-01-02") === 90, "H8 crossing a year boundary",
     lookupIndexPrice(P, "2024-01-02"));
  // Century years, tested so they DISCRIMINATE. Asking for a price one day back
  // passes under a naive "divisible by 4" rule too — the walk just takes one extra
  // step and still lands inside its five-day reach. So ask from five days out,
  // where spending a step on a day that does not exist is the difference between
  // finding the price and returning null.
  ok(lookupIndexPrice({ "2000-02-29": 7 }, "2000-03-04") === 7,
     "H9 2000 IS a leap year (divisible by 400), so 29 Feb is a real step",
     lookupIndexPrice({ "2000-02-29": 7 }, "2000-03-04"));
  ok(lookupIndexPrice({ "1900-02-28": 7 }, "1900-03-05") === 7,
     "H10 1900 is NOT (divisible by 100, not 400), so the walk must not spend a step on 29 Feb",
     lookupIndexPrice({ "1900-02-28": 7 }, "1900-03-05"));
  ok(lookupIndexPrice({ "2100-02-28": 7 }, "2100-03-05") === 7,
     "H10b and neither is 2100",
     lookupIndexPrice({ "2100-02-28": 7 }, "2100-03-05"));
  ok(lookupIndexPrice(P, "2024-06-02") === 120, "H11 stepping back over a 31-day month",
     lookupIndexPrice(P, "2024-06-02"));

  // Exhaustive equivalence with the Date walk this replaced, over 30 years.
  let drift = 0, checked = 0;
  for (let t = Date.UTC(1890, 0, 1); t <= Date.UTC(2110, 11, 31); t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const d = new Date(iso); d.setDate(d.getDate() - 1);
    const expect = d.toISOString().slice(0, 10);
    // One-entry series placed exactly one day back: the walk must find it.
    const got = lookupIndexPrice({ [expect]: 42 }, iso);
    checked++;
    if (got !== 42) drift++;
  }
  ok(drift === 0, "H12 matches the Date-based walk on all " + checked + " days from 1890 to 2110 — spanning 1900, 2000 and 2100", drift);

  console.log("\nI. The memo cannot serve a stale or foreign price");
  // A miss is cached as null — the misses are the expensive ones — so the cache
  // must not turn "no price then" into "no price ever" for a refreshed payload.
  const first = { "2024-03-01": 110 };
  ok(lookupIndexPrice(first, "2024-03-09") === null, "I1 a genuine miss resolves to null");
  first["2024-03-08"] = 999;
  ok(lookupIndexPrice(first, "2024-03-09") === null,
     "I2 mutating the SAME object in place keeps the cached answer — documented, not accidental",
     lookupIndexPrice(first, "2024-03-09"));
  ok(lookupIndexPrice({ "2024-03-01": 110, "2024-03-08": 999 }, "2024-03-09") === 999,
     "I3 but a REFRESHED payload is a different object, so it re-resolves");
  // Two series must never share a cache.
  const a = { "2024-03-01": 1 }, b = { "2024-03-01": 2 };
  ok(lookupIndexPrice(a, "2024-03-02") === 1 && lookupIndexPrice(b, "2024-03-02") === 2,
     "I4 two index series keep separate caches",
     [lookupIndexPrice(a, "2024-03-02"), lookupIndexPrice(b, "2024-03-02")]);
  // A date literally named "__proto__" must be a key, not the prototype.
  // A bare `prices[dateStr] !== undefined` returns Object.prototype here, and
  // Object.prototype is not a price. Unreachable from formatDateISO, but the
  // non-ISO branch exists for callers that do not use it.
  ok(lookupIndexPrice({ "2024-03-01": 5 }, "__proto__") === null,
     "I5 an inherited property is not mistaken for a price",
     lookupIndexPrice({ "2024-03-01": 5 }, "__proto__"));
  ok(lookupIndexPrice({ "2024-03-01": 5 }, "constructor") === null,
     "I6 nor is an inherited function",
     lookupIndexPrice({ "2024-03-01": 5 }, "constructor"));

  const src = lookupIndexPrice.toString();
  ok(/lookupIndexPrice\._memo/.test(src) && /WeakMap/.test(src),
     "I7 the cache is on the function and keyed weakly, so it survives extraction and leaks nothing");
  ok(!/toISOString/.test(src.slice(src.indexOf("function prevDay"))),
     "I8 the hot path formats no dates");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
