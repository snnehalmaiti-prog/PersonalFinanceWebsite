// The expense tab's render hot paths.
//
// Profiled at 5000 records / 4x CPU throttle, a full expense repaint cost 201 ms,
// of which the record list alone was 127 ms — and only 22 ms of that was the DOM
// parse. The rest was Intl formatters being constructed per call, a linear
// findById inside per-row loops, and computeAccountMonthly rescanning every record
// once per account tile. After: 57 ms total, record list 12 ms.
//
// These tests pin the behaviour, not the speed: the fast versions have to return
// exactly what the slow ones did. A static guard at the end keeps the formatters
// from drifting back into the loops.

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");

function extract(marker) {
  const start = HTML.indexOf(marker);
  if (start === -1) throw new Error("marker not found in dashboard.html: " + marker);
  const braceStart = HTML.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === "{") depth++;
    else if (HTML[i] === "}") { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

var dashExpState = { accounts: [], categories: [], paymentMethods: [], records: [] };
eval([
  extract("var _byIdIndex = new WeakMap()").replace(/^var _byIdIndex = new WeakMap\(\);?/, "var _byIdIndex = new WeakMap();"),
  extract("function findById(list, id)"),
  extract("var _acctMonthlyCache = null"),
  extract("function accountMonthlyMap()"),
  extract("function computeAccountMonthly(accountId)"),
].join("\n\n"));

const ym = (function () {
  const n = new Date();
  return n.getFullYear() + "-" + ("0" + (n.getMonth() + 1)).slice(-2);
})();
const thisMonth = (d) => ym + "-" + ("0" + d).slice(-2);

console.log("A. findById returns what a linear scan would");
{
  const list = [{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "c", n: 3 }];
  ok(findById(list, "b").n === 2, "A1 finds a member");
  ok(findById(list, "b") === list[1], "A2 the same object, not a copy");
  ok(findById(list, "zz") === undefined, "A3 a miss is undefined, matching Array.find");
  ok(findById(list, null) === undefined, "A4 a null id is a miss, not a throw");
  ok(findById(null, "a") === undefined, "A5 a null list is a miss, not a throw");
  ok(findById([], "a") === undefined, "A6 an empty list is a miss");
  // Cached on the array identity, so a replaced list must be seen.
  ok(findById(list, "a").n === 1, "A7 second call hits the index");
  const replaced = [{ id: "a", n: 99 }];
  ok(findById(replaced, "a").n === 99,
     "A8 a NEW array is indexed separately — every update path replaces the array");
  ok(findById(list, "a").n === 1, "A9 and the old array's index is still correct");
  // Rows without ids must not blow up the index build.
  ok(findById([{ n: 1 }, { id: "x", n: 2 }], "x").n === 2, "A10 rows with no id are skipped");
}

console.log("\nB. computeAccountMonthly totals the current month per account");
{
  dashExpState.records = [
    { account_id: "a1", txn_date: thisMonth(2), type: "budget", amount: 1000 },
    { account_id: "a1", txn_date: thisMonth(5), type: "expense", amount: 300 },
    { account_id: "a1", txn_date: thisMonth(9), type: "expense", amount: 200 },
    { account_id: "a2", txn_date: thisMonth(5), type: "budget", amount: 500 },
    // Income must NOT count toward the allowance, even though it now carries an account.
    { account_id: "a1", txn_date: thisMonth(6), type: "income", amount: 9999 },
    // Another month must not leak in.
    { account_id: "a1", txn_date: "2020-01-15", type: "expense", amount: 7777 },
    // A row with no account belongs to no tile.
    { account_id: null, txn_date: thisMonth(3), type: "expense", amount: 5555 },
  ];
  const a1 = computeAccountMonthly("a1");
  ok(a1.budget === 1000, "B1 budget rows fund the allowance", a1.budget);
  ok(a1.spent === 500, "B2 expense rows are spend", a1.spent);
  ok(a1.balance === 500, "B3 balance = budget - spent", a1.balance);
  ok(computeAccountMonthly("a2").budget === 500, "B4 accounts are kept separate");
  const missing = computeAccountMonthly("nope");
  ok(missing.budget === 0 && missing.spent === 0 && missing.balance === 0,
     "B5 an account with no rows returns zeros, not undefined", missing);
}

console.log("\nC. The month filter is on the date string, so it is timezone-proof");
{
  // new Date("YYYY-MM-DD") parses as UTC midnight and was compared against LOCAL
  // midnight, so west of UTC the 1st of the month fell outside its own month.
  dashExpState.records = [
    { account_id: "a1", txn_date: thisMonth(1), type: "expense", amount: 100 },
    { account_id: "a1", txn_date: thisMonth(28), type: "expense", amount: 100 },
  ];
  ok(computeAccountMonthly("a1").spent === 200,
     "C1 the first and last days of the month are both inside it", computeAccountMonthly("a1").spent);
  dashExpState.records = [{ account_id: "a1", txn_date: "", type: "expense", amount: 50 }];
  ok(computeAccountMonthly("a1").spent === 0, "C2 a blank date is excluded, not counted as today");
  dashExpState.records = [{ account_id: "a1", txn_date: null, type: "expense", amount: 50 }];
  ok(computeAccountMonthly("a1").spent === 0, "C3 a null date does not throw");
}

console.log("\nD. The per-month cache follows the data");
{
  dashExpState.records = [{ account_id: "a1", txn_date: thisMonth(4), type: "expense", amount: 10 }];
  ok(computeAccountMonthly("a1").spent === 10, "D1 first read");
  // Every update path replaces the array; the cache keys on its identity.
  dashExpState.records = dashExpState.records.concat(
    [{ account_id: "a1", txn_date: thisMonth(5), type: "expense", amount: 90 }]);
  ok(computeAccountMonthly("a1").spent === 100,
     "D2 a new records array is recomputed — a tile cannot show a stale total",
     computeAccountMonthly("a1").spent);
  const same = dashExpState.records;
  computeAccountMonthly("a1");
  ok(dashExpState.records === same, "D3 reading does not replace the array");
}

console.log("\nE. Formatters are built once, not per call");
{
  ok(/var _inrFmt = new Intl\.NumberFormat/.test(HTML), "E1 the money formatter is hoisted");
  ok(/var _timeFmt = new Intl\.DateTimeFormat/.test(HTML), "E2 the time formatter is hoisted");
  // The record row and the day header are the per-row paths — no toLocale* there.
  const listFn = HTML.slice(HTML.indexOf("function renderDashRecords()"),
                            HTML.indexOf("function renderDashRecords()") + 12000);
  ok(listFn.indexOf("toLocaleTimeString") === -1,
     "E3 no toLocaleTimeString in the record list — it builds a DateTimeFormat per row");
  ok(listFn.indexOf('toLocaleDateString("en-US"') === -1,
     "E4 no toLocaleDateString(\"en-US\") in the record list either");
  ok(!/toLocaleString\("en-IN"\)/.test(HTML),
     "E5 fmtMoney must use the hoisted NumberFormat, not Number.toLocaleString");
  ok(/_inrFmt\.format\(/.test(HTML), "E6 fmtMoney uses it");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
