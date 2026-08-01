// renderValueChart is invoked ~12 times during a single dashboard load (portfolio
// select, benchmark apply, every sheet that finishes, the overview-flows event).
// Each call is a long async chain; without a generation guard every obsolete call
// still recomputes thousands of timeline points and rebuilds both charts, and the
// stale results race the live one onto the canvas.
//
// This check pins the guard: a generation counter, a _superseded() helper, and a
// bail-out at EVERY async resumption point inside renderValueChart — including the
// terminal .then/.catch that draw the Growth chart, where falling through on a
// superseded (null) result would paint a stale, benchmark-less curve.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

// Isolate renderValueChart's body so a guard living in some other function
// cannot satisfy these assertions by accident.
const start = src.indexOf("function renderValueChart() {");
check("G1 renderValueChart is present", start !== -1);
const nextFn = src.indexOf("\n  function ", start + 10);
const body = src.slice(start, nextFn === -1 ? src.length : nextFn);

check("G2 a generation counter is declared outside the function",
  /var\s+_vcGen\s*=\s*0\s*;/.test(src.slice(0, start)),
  "expected `var _vcGen = 0;` above renderValueChart");

check("G3 each call stamps its own generation",
  /var\s+_vcMyGen\s*=\s*\+\+\s*_vcGen\s*;/.test(body),
  "expected `var _vcMyGen = ++_vcGen;` at the top of renderValueChart");

check("G4 _superseded compares this call's generation with the newest",
  /function\s+_superseded\s*\(\s*\)\s*\{\s*return\s+_vcMyGen\s*!==\s*_vcGen\s*;\s*\}/.test(body),
  "expected `function _superseded() { return _vcMyGen !== _vcGen; }`");

// Every point where control returns from an await must re-check. Count them by
// the async boundaries that actually exist in the chain.
const boundaries = [
  ["G5 the scheme-map resumption bails when superseded",
    /buildInstrumentSchemeMap\(\)\.then\(function \(schemeMap\) \{\s*\n\s*if \(_superseded\(\)\) return/],
  ["G6 the NAV/prices resumption bails when superseded",
    /\]\)\.then\(function \(outerResults\) \{\s*\n\s*if \(_superseded\(\)\) return/],
  ["G7 the index-history resumption bails when superseded",
    /fetchIndexHistory\(\)\.then\(function \(indexHistory\) \{\s*\n\s*if \(_superseded\(\)\) return/],
];
boundaries.forEach(function (b) { check(b[0], b[1].test(body), "guard missing at this await"); });

// The terminal handlers are the dangerous ones: a superseded index fetch resolves
// to null, and the `idxResult ? ... : []` fallback would happily draw the Growth
// chart from a stale render with an empty benchmark.
const terminal = body.slice(body.indexOf("}).then(function (idxResult) {"));
// Positional, not regex-spanning: the FIRST guard in the terminal block must
// precede the FIRST draw. A lookahead regex would otherwise be satisfied by the
// catch block's guard further down and pass even with this one deleted.
const firstGuard = terminal.indexOf("if (_superseded()) return;");
const firstDraw = terminal.indexOf("_renderNormalizedChart(");
check("G8 the Growth-chart draw bails before the empty-benchmark fallback",
  firstGuard !== -1 && firstDraw !== -1 && firstGuard < firstDraw,
  "the _superseded() check must come BEFORE the first _renderNormalizedChart call");

check("G9 the error path bails too",
  /\}\)\.catch\(function \(\) \{\s*\n\s*if \(_superseded\(\)\) return;\s*\n\s*_renderNormalizedChart\(\[\]\);/.test(terminal),
  "a superseded render must not draw an empty Growth chart from its catch");

// Every call to _renderNormalizedChart must sit behind a guard — if a new one is
// added later without one, the stale-draw hole reopens.
const draws = (body.match(/_renderNormalizedChart\(/g) || []).length;
const definition = (body.match(/function _renderNormalizedChart/g) || []).length;
check("G10 both _renderNormalizedChart call sites are accounted for",
  draws - definition === 2, "found " + (draws - definition) + " call sites, expected 2");

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
