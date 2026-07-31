#!/usr/bin/env node
// Guard: the progress bar and the "+x.xx%   +Rs n gain" line under every portfolio
// card on the Investments tabs.
//
// The markup was copy-pasted into the Mutual Fund, Stocks/ETF and Fixed Income
// renderers and had drifted — Stocks/ETF dropped the " gain"/" loss" word, so the
// same line read differently depending on which tab you were on. Both pieces are
// now shared; this keeps a fourth copy from appearing.
"use strict";

const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

check(/function _mfpcBarHtml\(pnlPct\)/.test(SRC), "_mfpcBarHtml is missing");
check(/function _mfpcReturnRowHtml\(pnl, pnlPct\)/.test(SRC), "_mfpcReturnRowHtml is missing");

// Exactly one definition plus one call per portfolio-card renderer (MF, SE, FI).
const barUses = (SRC.match(/_mfpcBarHtml\(/g) || []).length;
const rowUses = (SRC.match(/_mfpcReturnRowHtml\(/g) || []).length;
check(barUses === 4, "expected one _mfpcBarHtml definition and three call sites, found " + barUses);
check(rowUses === 4, "expected one _mfpcReturnRowHtml definition and three call sites, found " + rowUses);

// No renderer may hand-roll either piece again.
check((SRC.match(/class="mfpc-bar"/g) || []).length === 1,
  "the bar markup is written out more than once — it must come from _mfpcBarHtml");
check((SRC.match(/class="mfpc-return-row"/g) || []).length === 1,
  "the return row is written out more than once — it must come from _mfpcReturnRowHtml");
check((SRC.match(/Math\.max\(4, \(pnlPct \+ 30\) \* 1\.4\)/g) || []).length === 1,
  "the bar's scaling formula is duplicated; it belongs only in _mfpcBarHtml");

// The word that had gone missing on one tab.
const row = SRC.slice(SRC.indexOf("function _mfpcReturnRowHtml"),
                      SRC.indexOf("function _mfpcReturnRowHtml") + 800);
check(/isNeg \? " loss" : " gain"/.test(row),
  'the gain/loss word must be part of the shared row — Stocks/ETF used to omit it');
check(/mfpc-negative/.test(row) && /mfpc-positive/.test(row),
  "the row must still colour gains and losses");

if (failed) { console.error("\n" + failed + " portfolio-card line check(s) failed"); process.exit(1); }
console.log("portfolio card lines OK");
