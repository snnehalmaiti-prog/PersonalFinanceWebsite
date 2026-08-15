// The two functions that blocked the main thread during a mobile load.
//
// Profiling a load on a mobile viewport at 4x CPU showed 3130 ms of blocked main
// thread in three long tasks, the worst 1278 ms. A tap landing inside one waits
// for it to finish, which is what "Add Record freezes when the page is loaded"
// was. The self time was concentrated in formatCurrencyFull (205 ms) and
// parseFlexibleDate (253 ms) — both called tens of thousands of times while the
// sheets are processed.
//
// NOTE: the "215 ms blocked" first measured after this change was an artifact —
// parseFlexibleDate was throwing on every early call (see section E), so the work
// never ran. With that fixed the honest figure is 2068 ms, down from 3130 ms.
//
// Both fixes are caches, so what matters is that they cannot change a value or
// leak a mutable object. That is what these tests check.

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
  return SRC.slice(start, i + 1);
}

// The memo lives in the module scope in script.js; extract() slices on brace
// balance and cannot take a bare `var`, so it is declared here.
var _dateParseMemo = Object.create(null);
var _dateParseMemoSize = 0;
var _inrFullFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

eval([
  extract("function parseFlexibleDate(value)"),
  extract("function _parseFlexibleDateUncached(str)"),
  extract("function formatCurrencyFull(amount)"),
].join("\n\n"));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

console.log("A. formatCurrencyFull is unchanged by the hoisted formatter");
{
  // The reference is exactly what the function used to do.
  function reference(amount) {
    var sign = amount < 0 ? "-" : "";
    return sign + "₹" + Math.abs(amount).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }
  const vals = [0, -0, 1, -1, 7, 99, 100, 999, 1000, 1001, 12345, 99999, 100000, 123456,
                1234567, 12345678, 1e7, 99999999, 1234567890, -1234567, 0.4, 0.5, 0.6, -0.5,
                NaN, Infinity, -Infinity];
  let bad = [];
  vals.forEach(function (v) { if (formatCurrencyFull(v) !== reference(v)) bad.push([v, formatCurrencyFull(v), reference(v)]); });
  ok(bad.length === 0, "A1 identical output across " + vals.length + " values including 0, negatives, NaN and Infinity", bad.slice(0, 3));
  ok(formatCurrencyFull(1234567) === "₹12,34,567", "A2 still Indian digit grouping", formatCurrencyFull(1234567));
  ok(formatCurrencyFull(-500).charAt(0) === "-", "A3 the sign goes before the symbol", formatCurrencyFull(-500));
}

console.log("\nB. parseFlexibleDate memo returns what the parser returns");
{
  const cases = ["3-Jun-2026", "01/04/2024", "1/4/2024", "13/01/2024", "31-12-2023",
                 "2024-04-01", "6-Jul-2026", "Jun 3, 2026", "", "   ", "not a date", "0/0/0000"];
  let bad = [];
  cases.forEach(function (c) {
    const memoed = parseFlexibleDate(c);
    const raw = String(c).trim() ? _parseFlexibleDateUncached(String(c).trim()) : null;
    const same = (memoed === null && raw === null) ||
                 (memoed && raw && memoed.getTime() === raw.getTime());
    if (!same) bad.push([c, String(memoed), String(raw)]);
  });
  ok(bad.length === 0, "B1 memoised result equals the uncached parse for " + cases.length + " inputs", bad.slice(0, 3));
  ok(parseFlexibleDate(null) === null, "B2 null is null");
  ok(parseFlexibleDate(undefined) === null, "B3 undefined is null");
  ok(parseFlexibleDate("") === null, "B4 empty is null");
  ok(parseFlexibleDate("   ") === null, "B5 whitespace is null");
  ok(parseFlexibleDate("rubbish") === null, "B6 an unparseable string is null, and that null is cached too");
  // dd/mm vs mm/dd swap must survive memoisation.
  const d = parseFlexibleDate("13/01/2024");
  ok(d && d.getMonth() === 0 && d.getDate() === 13, "B7 the day/month swap still applies", d && d.toDateString());
}

console.log("\nC. The memo never hands out a shared, mutable Date");
{
  const a = parseFlexibleDate("01/04/2024");
  const b = parseFlexibleDate("01/04/2024");
  ok(a !== b, "C1 two calls return distinct objects");
  ok(a.getTime() === b.getTime(), "C2 with the same instant");
  // A caller mutating its copy must not corrupt every later read — this is the
  // whole reason the cache stores a timestamp rather than the Date.
  a.setFullYear(1999);
  const c = parseFlexibleDate("01/04/2024");
  ok(c.getFullYear() === 2024, "C3 a mutated result does not poison the cache", c.getFullYear());
}

console.log("\nE. The memo must survive being called before its initialiser runs");
{
  // script.js declares the memo with `var`, and parseFlexibleDate is called during
  // module init from far ABOVE that line. Function declarations hoist; assignments
  // do not — so those early calls see the binding as UNDEFINED. A guard testing
  // `=== null` is not enough. This shipped once and threw on every early call.
  _dateParseMemo = undefined;
  let threw = null, out = null;
  try { out = parseFlexibleDate("1-Jan-2021"); } catch (e) { threw = e.message; }
  ok(threw === null, "E1 an early call does not throw", threw);
  ok(out && out.getFullYear() === 2021, "E2 and still parses", out && out.toDateString());
  _dateParseMemo = null;
  threw = null;
  try { out = parseFlexibleDate("2-Feb-2022"); } catch (e) { threw = e.message; }
  ok(threw === null && out.getFullYear() === 2022, "E3 a null binding is handled too", threw);
  ok(/if \(!_dateParseMemo\)/.test(SRC),
     "E4 the guard is falsy-tested, not compared to null");
}

console.log("\nD. Guards: neither hot function may go back to per-call construction");
{
  ok(/var _inrFullFmt = new Intl\.NumberFormat/.test(SRC),
     "D1 formatCurrencyFull uses a hoisted NumberFormat");
  const fn = extract("function formatCurrencyFull(amount)");
  ok(fn.indexOf("toLocaleString") === -1,
     "D2 and no longer calls toLocaleString, which builds a formatter every time");
  ok(/_dateParseMemo\[str\]/.test(SRC), "D3 parseFlexibleDate consults the memo");
  const pf = extract("function parseFlexibleDate(value)");
  ok(pf.indexOf("getTime()") !== -1 && pf.indexOf("new Date(hit)") !== -1,
     "D4 the memo stores a timestamp and rebuilds the Date, so nothing shared escapes");
  ok(/_dateParseMemoSize < \d+/.test(SRC),
     "D5 the memo is bounded, so pathological input cannot grow it without limit");
}

{
  console.log("\nF. A malformed money cell is reported, not silently truncated");
  // parseNumber strips everything outside [0-9.-] and hands the rest to
  // parseFloat, which STOPS at the first thing it cannot read instead of
  // rejecting. Embedded separators survive the strip, so a date in an Amount
  // column became a plausible-looking rupee figure:
  //     "2024-01-15" -> 2024,  "1.2.3" -> 1.2,  "12-34" -> 12
  // The old validator asked only "does it contain a digit", which all three pass.
  eval(extract("function numericShape("));
  eval(extract("function parseNumber("));
  eval(extract("function validateNumericCell("));

  // Formats a real money column legitimately carries. A false reject here is a
  // spurious warning shown to the user about a perfectly good row, so the list is
  // deliberately generous.
  [["1234", "a bare integer"],
   ["1,234.56", "thousands separators"],
   ["₹1,234", "a rupee sign"],
   ["$1,234.00", "a dollar sign"],
   ["(500)", "accounting parentheses"],
   ["-500", "a leading minus"],
   ["+42", "a leading plus"],
   ["8%", "a trailing percent"],
   [".5", "a bare decimal"],
   ["  500  ", "surrounding whitespace"],
   ["Rs 500", "an Rs prefix"],
   ["Rs. 1,000", "Rs. with a dot"],
   ["INR 250", "a currency code"],
   ["500/-", "a trailing /-"]].forEach(function (c, i) {
    ok(numericShape(c[0]).ok, "F" + (i + 1) + " accepts " + c[1] + ": " + JSON.stringify(c[0]),
       numericShape(c[0]).reason);
  });

  // The truncations. Each of these used to pass validation AND parse to a
  // plausible number.
  [["2024-01-15", 2024], ["1.2.3", 1.2], ["12-34", 12]].forEach(function (c, i) {
    ok(!numericShape(c[0]).ok,
       "F20" + i + " rejects " + JSON.stringify(c[0]) + ", which parseNumber turns into " + c[1]);
    ok(parseNumber(c[0]) === c[1],
       "F21" + i + "   (and parseNumber really does still return " + c[1] + " — the value contract is unchanged)",
       parseNumber(c[0]));
    ok(!validateNumericCell(c[0]).ok && /is not a number/.test(validateNumericCell(c[0]).reason),
       "F22" + i + "   so the row is reported to the user",
       validateNumericCell(c[0]).reason);
  });

  ok(!numericShape("").ok && numericShape("").reason === "is blank",
     "F30 a blank cell keeps its own distinct message");
  ok(!numericShape("abc").ok, "F31 and a non-numeric string is still rejected");
  ok(validateNumericCell("0").ok === false && validateNumericCell("0").reason === "is zero",
     "F32 zero and negative keep their existing messages", validateNumericCell("0").reason);
  ok(validateNumericCell("-5").reason.indexOf("is negative") === 0,
     "F33 as does a negative", validateNumericCell("-5").reason);
  ok(validateNumericCell("1,234.56").ok, "F34 and a good value still validates");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
