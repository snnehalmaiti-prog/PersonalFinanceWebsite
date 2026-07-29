#!/usr/bin/env node
// Guard: the Fixed Income reclassification lives at CALL SITES, and unit tests
// can't see a call site that quietly goes back to the raw sheet. Every regression
// in this area has been of exactly that shape — a repaint path re-reading the
// unfiltered rows (the allocation toggle), or a card row seeded from
// collectPortfolioNamesFromSheets instead of the debt-filtered copy.
//
// So this checks the wiring statically: inside each function that renders a
// Mutual Fund or Stocks/ETF surface, the debt filter must be present and the
// raw-sheet shortcuts must not be.
"use strict";

const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

function body(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error("function not found (renamed?): " + marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}

// [marker, must contain, must NOT contain]
const RULES = [
  ["function renderMfPortfolioCards()",
    ["excludeFixedIncomeRows", "collectPortfolioNamesFromRows"],
    ['collectPortfolioNamesFromSheets(["equity"])']],
  ["function renderSePortfolioCards(rowsData)",
    ["excludeFixedIncomeRows", "collectPortfolioNamesFromRows"],
    ['collectPortfolioNamesFromSheets(["stocksetf"])']],
  ["function renderMfPerformanceChart()",
    ["isFixedIncomeInstrument"], []],
  ["function _buildAllFixedIncomeHoldingsList()",
    ["_buildDebtFundHoldingsForFi"], []],
  ["function renderDebtHoldings()",
    // The debt rows land after the Fixed Income tab has drawn, so this must
    // repaint it — otherwise the FI cards silently report only FD/PF.
    ["renderFiRedesign"], []],
];

let failed = 0;
for (const [marker, must, mustNot] of RULES) {
  let src;
  try { src = body(marker); }
  catch (e) { console.error("  FAIL " + e.message); failed++; continue; }
  const name = marker.replace(/^function /, "").replace(/\(.*/, "");
  for (const needle of must) {
    if (src.indexOf(needle) === -1) {
      console.error("  FAIL " + name + " no longer calls " + needle + " — debt would leak back in");
      failed++;
    }
  }
  for (const needle of mustNot) {
    if (src.indexOf(needle) !== -1) {
      console.error("  FAIL " + name + " reads the raw sheet via " + needle +
                    " — use the debt-filtered copy");
      failed++;
    }
  }
}

// The allocation toggle re-renders from this cache, so it must hold the
// debt-EXCLUDED rows. Caching the pre-split rows is what let an arbitrage fund
// reappear as 100% of the mutual funds when the toggle was flipped.
if (!/window\.__mfLastRowsData\s*=\s*mfOnlyRows/.test(SRC)) {
  console.error("  FAIL __mfLastRowsData must cache the debt-excluded rows (mfOnlyRows)");
  failed++;
}

if (failed) { console.error("\n" + failed + " call-site check(s) failed"); process.exit(1); }
console.log("debt reclassification call sites OK");
