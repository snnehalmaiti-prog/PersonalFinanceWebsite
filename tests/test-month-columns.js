// How many month columns the CASH FLOW and Budget-variance charts draw.
//
// Both trimmed to `lastMonthWithData + 2`. The +1 turns a 0-based index into a
// count; the second +1 was padding that drew one empty month past the end of the
// data — which is why a year with activity through August showed an empty
// September. Extracted from dashboard.html rather than copied.

const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");

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
eval(extract("function monthColumnsToShow(hasDataAt)"));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
// months: 0-based indices that have data
const upTo = (last) => (i) => i <= last;
const only = (list) => (i) => list.indexOf(i) !== -1;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const labelsFor = (n) => MONTHS.slice(0, n).join(",");

console.log("A. The axis ends at the last month that has data");
{
  ok(monthColumnsToShow(upTo(7)) === 8, "A1 data through August draws Jan-Aug, not Jan-Sep",
     labelsFor(monthColumnsToShow(upTo(7))));
  ok(monthColumnsToShow(upTo(6)) === 7, "A2 data through July draws Jan-Jul", labelsFor(monthColumnsToShow(upTo(6))));
  ok(monthColumnsToShow(upTo(11)) === 12, "A3 a full year draws all twelve");
  ok(monthColumnsToShow(upTo(10)) === 11, "A4 data through November draws eleven, not thirteen");
}

console.log("\nB. A six-month floor, so an early-year chart is not a stub");
{
  ok(monthColumnsToShow(upTo(0)) === 6, "B1 data only in January still draws six months");
  ok(monthColumnsToShow(upTo(4)) === 6, "B2 data through May draws six, not five");
  ok(monthColumnsToShow(upTo(5)) === 6, "B3 data through June draws six");
  ok(monthColumnsToShow(function () { return false; }) === 6, "B4 no data at all still draws six");
}

console.log("\nC. Gaps do not truncate the axis");
{
  // A month with nothing in it between two that have data must not end the chart.
  ok(monthColumnsToShow(only([0, 7])) === 8,
     "C1 January and August with a gap between still draws through August",
     labelsFor(monthColumnsToShow(only([0, 7]))));
  ok(monthColumnsToShow(only([11])) === 12, "C2 only December draws all twelve");
  ok(monthColumnsToShow(only([3])) === 6, "C3 only April draws the six-month minimum");
}

console.log("\nD. Both charts use it, and neither pads past the data");
{
  ok((HTML.match(/monthColumnsToShow\(/g) || []).length === 3,
     "D1 one definition and two call sites", (HTML.match(/monthColumnsToShow\(/g) || []).length);
  ok(!/lastMonthWithData \+ 2/.test(HTML) && !/lastActiveMonth \+ 2/.test(HTML),
     "D2 the padded trim is gone from both charts");
  ok(/return Math\.min\(12, Math\.max\(6, last \+ 1\)\);/.test(HTML),
     "D3 index-to-count is +1, with a floor of six and a ceiling of twelve");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
