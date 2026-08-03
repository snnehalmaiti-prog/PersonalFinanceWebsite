#!/usr/bin/env node
// Guard: the tablet layout fix must stay scoped to tablets.
//
// Between the phone breakpoint at 760px and the width the desktop layout needs,
// the Overview stats row and the Benchmark card were single nowrap flex rows
// whose items could shrink below the width of their own text — so values were
// drawn over each other and every Benchmark label ellipsised.
//
// The fix is a media query with BOTH bounds. Losing the lower bound would push a
// four-column grid onto phones, which already have their own two-column layout;
// losing the upper bound would push it onto desktop, which has room for one row.
// Either mistake is invisible at the width you happen to be testing at, which is
// exactly why it is pinned here.
//
// The behaviour itself is measured, not read: tests/measure-tablet-layout.js
// checks overlap and clipping at ten widths in a real browser.
"use strict";

const fs = require("fs");
const path = require("path");
const CSS = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

// Pull out the tablet block by its bounds, so every assertion below is about
// THAT block and cannot be satisfied by a rule living somewhere else.
const OPEN = /@media\s*\(min-width:\s*761px\)\s*and\s*\(max-width:\s*1100px\)\s*\{/;
const m = CSS.match(OPEN);
check(m, "the tablet media query must be @media (min-width: 761px) and (max-width: 1100px)");

let block = "";
if (m) {
  // Brace-match to the end of the block: the body contains nested rules, so a
  // lazy match to the first '}' would stop inside the first declaration.
  let i = m.index + m[0].length, depth = 1;
  const start = i;
  while (i < CSS.length && depth > 0) {
    const c = CSS[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    i++;
  }
  block = CSS.slice(start, i - 1);
}

check(block.length > 0, "the tablet media query block is empty");

// The lower bound is what keeps this off phones, which have their own layout.
check(/min-width:\s*761px/.test(m ? m[0] : ""),
  "the tablet block needs a LOWER bound — without it phones get this layout too");
check(/max-width:\s*1100px/.test(m ? m[0] : ""),
  "the tablet block needs an UPPER bound — without it desktop gets this layout too");

// The three things the measurement depends on.
check(/\.overview-stats-inline\s*\{[^}]*display:\s*grid/.test(block),
  "the Overview stats row must become a grid on tablet — as one flex row its " +
  "seven items shrink below their own text and the values overlap");
check(/\.benchmark-result\s*\{[^}]*flex-wrap:\s*wrap/.test(block),
  "the Benchmark result row must wrap on tablet, so its two groups of three " +
  "get a line each instead of sharing one");
check(/\.benchmark-col-label\s*\{[^}]*white-space:\s*normal/.test(block),
  "Benchmark labels must wrap rather than ellipsise on tablet — a label " +
  "truncated to \"Portfolio Rolling…\" no longer names its column");
check(/\.acc-charts-grid\s*\{[^}]*grid-template-columns:\s*1fr\s*[;}]/.test(block),
  "the Expense tab's BREAKDOWN and SETTLEMENT cards must get a row each on " +
  "tablet — sharing a two-column grid cuts the spend table off mid-figure and " +
  "squeezes the two settlement person cards to about 145px");

// And that the phone block is still there and still its own thing: this fix must
// not have been achieved by widening the phone breakpoint.
check(/@media\s*\(max-width:\s*760px\)/.test(CSS),
  "the phone breakpoint at 760px must still exist");

if (failed) { console.error("\n" + failed + " tablet-breakpoint check(s) failed"); process.exit(1); }
console.log("tablet breakpoint OK");
