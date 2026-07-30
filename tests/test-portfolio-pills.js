// Portfolio pills across the holdings cards.
//
// Every card lists the same portfolios and disables the ones with nothing in that
// particular table. Hiding them instead made the row of names change shape from
// card to card, which reads as data missing; a greyed name says "this person holds
// nothing here", which is information.
//
// The painter is shared, so this pins its contract: the fallback when the current
// selection becomes unavailable, "All" never being disabled, and escaping.

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

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
eval(extract("function _renderPortfolioPills(container, attr, names, selected, isAvailable)"));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

function box() { return { innerHTML: "" }; }
const has = (list) => (p) => list.indexOf(p) !== -1;
// Parse the generated markup back into a comparable shape.
function pills(el) {
  return (el.innerHTML.match(/<button[\s\S]*?<\/button>/g) || []).map(function (b) {
    return {
      label: (b.match(/>([^<]*)<\/button>/) || [])[1],
      value: (b.match(/data-[a-z-]+portfolio="([^"]*)"/) || [])[1],
      disabled: / disabled/.test(b),
      active: /class="[^"]*\bactive\b/.test(b),
    };
  });
}

console.log("A. Every portfolio is listed; unavailable ones are disabled, not hidden");
{
  const el = box();
  const sel = _renderPortfolioPills(el, "data-mfh-portfolio", ["Snnehal", "Trisha", "Riya"], "all", has(["Snnehal"]));
  const p = pills(el);
  ok(p.length === 4, "A1 All plus all three portfolios", p.length);
  ok(p.map(function (x) { return x.label; }).join(",") === "All,Snnehal,Trisha,Riya", "A2 in order, All first",
     p.map(function (x) { return x.label; }));
  ok(p[0].disabled === false, "A3 All is never disabled");
  ok(p[1].disabled === false, "A4 an available portfolio is enabled");
  ok(p[2].disabled === true && p[3].disabled === true, "A5 the rest are disabled, not removed");
  ok(sel === "all", "A6 selection unchanged when it is still valid");
  ok(/No holdings in this table/.test(el.innerHTML), "A7 disabled pills explain themselves on hover");
}

console.log("\nB. A selection that becomes unavailable falls back to All");
{
  const el = box();
  // Trisha sold her last holding in this table, or the filter came from another card.
  const sel = _renderPortfolioPills(el, "data-fih-portfolio", ["Snnehal", "Trisha"], "Trisha", has(["Snnehal"]));
  ok(sel === "all", "B1 returns 'all' so the caller can adopt it", sel);
  const p = pills(el);
  ok(p[0].active === true, "B2 and All is the one painted active");
  ok(p.filter(function (x) { return x.active; }).length === 1, "B3 exactly one active pill");
}
{
  const el = box();
  const sel = _renderPortfolioPills(el, "data-fih-portfolio", ["Snnehal", "Trisha"], "Trisha", has(["Snnehal", "Trisha"]));
  ok(sel === "Trisha", "B4 a still-available selection is kept", sel);
  ok(pills(el)[2].active === true, "B5 and stays painted active");
}

console.log("\nC. Degenerate inputs");
{
  ok(_renderPortfolioPills(null, "data-x-portfolio", ["A"], "A", has(["A"])) === "A",
     "C1 a missing container returns the selection untouched rather than throwing");
  const el = box();
  const sel = _renderPortfolioPills(el, "data-cmh-portfolio", [], "Snnehal", has([]));
  ok(sel === "all", "C2 no portfolios at all -> fall back to All");
  ok(pills(el).length === 1 && pills(el)[0].label === "All", "C3 and only All is rendered", pills(el));
  const el2 = box();
  _renderPortfolioPills(el2, "data-cmh-portfolio", ["A"], "all", function () { return false; });
  ok(pills(el2)[0].disabled === false, "C4 All stays usable even when nothing is available");
}

console.log("\nD. Names are escaped, in the label and in the attribute");
{
  const el = box();
  _renderPortfolioPills(el, "data-mfh-portfolio", ['R&D "team" <x>'], "all", has([]));
  const html = el.innerHTML;
  ok(html.indexOf("<x>") === -1, "D1 the label cannot inject markup");
  ok(html.indexOf('&amp;') !== -1, "D2 ampersands are escaped in the label");
  const attr = (html.match(/data-mfh-portfolio="([^"]*)"/) || [])[1];
  ok(attr.indexOf('"') === -1, "D3 quotes cannot break out of the attribute", attr);
}

console.log("\nE. Every card uses the shared painter");
{
  ["data-mfh-portfolio", "data-seh-portfolio", "data-dbth-portfolio",
   "data-fih-portfolio", "data-cmh-portfolio"].forEach(function (attr) {
    ok(new RegExp('_renderPortfolioPills\\([\\s\\S]{0,120}"' + attr + '"').test(SRC),
       "E " + attr + " is painted by the shared helper");
  });
  // Clicking a disabled pill must never change the filter.
  const guards = (SRC.match(/if \(!btn \|\| btn\.disabled/g) || []).length;
  ok(guards >= 4, "E6 the delegated handlers ignore clicks on disabled pills", guards);
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
