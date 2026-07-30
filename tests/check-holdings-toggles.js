#!/usr/bin/env node
// Guard: the four holdings tables' Open/Closed controls.
//
// Each used to be a single button whose label flipped between "Open" and
// "Closed" — ambiguous, since the label could read as the current state or as
// the action. They are now segmented pills with both options visible. Verified in
// Chromium (each starts on Open, moves to Closed and back, the four stay
// independent, and the legacy checkboxes the render path still reads follow the
// pill); this keeps the wiring from regressing.
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

const TOGGLES = [
  { id: "mfh-open-toggle", attr: "data-mfh-open", label: "Mutual Fund Holding" },
  { id: "seh-open-toggle", attr: "data-seh-open", label: "India holdings" },
  { id: "seh-us-open-toggle", attr: "data-seh-open", label: "US holdings" },
  { id: "dbth-open-toggle", attr: "data-dbth-open", label: "Debt ETF/Mutual Holding" },
];

TOGGLES.forEach(function (t) {
  const at = HTML.indexOf('id="' + t.id + '"');
  check(at !== -1, t.label + ": the toggle container is missing");
  if (at === -1) return;
  const block = HTML.slice(at, at + 600);
  check(block.indexOf("isc-toggle") !== -1,
    t.label + ": must use the segmented .isc-toggle pill, not a single flipping button");
  check(block.indexOf(t.attr + '="open"') !== -1 && block.indexOf(t.attr + '="closed"') !== -1,
    t.label + ": both Open and Closed segments must be present");
  check(block.indexOf("isc-toggle-btn active") !== -1,
    t.label + ": one segment must start active, or the pill renders with no state");
  check(/class="mfh-btn"[^>]*id="/.test(block) === false,
    t.label + ": the old single-button markup is back");
});

// The shared painter must know every attribute, or a pill silently stops
// highlighting while still changing the data.
const painter = SRC.slice(SRC.indexOf("function _setOpenClosedPill"),
                          SRC.indexOf("function _setOpenClosedPill") + 700);
check(painter.length > 0, "_setOpenClosedPill is missing");
["data-mfh-open", "data-seh-open", "data-dbth-open"].forEach(function (a) {
  check(painter.indexOf(a) !== -1, "_setOpenClosedPill does not recognise " + a);
});
check(painter.indexOf("aria-pressed") !== -1,
  "the segments must set aria-pressed — state conveyed by colour alone is not accessible");

// Each pill must paint its initial state at wire-up, otherwise the markup's
// hardcoded `active` can disagree with the real state after a reload.
["MFH_STATE.showClosed", "DBTH_STATE.showClosed"].forEach(function (state) {
  check(new RegExp("_setOpenClosedPill\\([^)]*,\\s*" + state.replace(".", "\\.")).test(SRC),
    "the initial pill state is not painted from " + state);
});
check(/_setOpenClosedPill\(box, SEH_STATE\.showClosed\[spec\.region\]\)/.test(SRC),
  "the Stocks/ETF pills do not paint their initial state");

// Clicking the segment that is already active must not re-render.
check((SRC.match(/if \(wantClosed === !!/g) || []).length >= 3,
  "clicking the active segment should be a no-op, not a repaint");

// Either segment must disable itself when its side is empty — symmetrically.
check(/b\.disabled = !has && !neither/.test(SRC),
  "a segment with nothing behind it is never disabled — an enabled control leading to an empty list reads as a bug");
check(/var neither = hasClosed === false && hasOpen === false/.test(SRC),
  "with BOTH sides empty the pill should stay enabled rather than lock out entirely");
check(/No closed positions/.test(SRC) && /No open positions/.test(SRC),
  "both disabled segments need a tooltip saying why");
check(/if \(state\.showClosed && !hasClosed && hasOpen\) state\.showClosed = false/.test(SRC) &&
      /else if \(!state\.showClosed && !hasOpen && hasClosed\) state\.showClosed = true/.test(SRC),
  "the shared renderer must land on whichever side has something");
check(/if \(regionShowClosed && !hasClosed && hasOpen\)/.test(SRC) &&
      /else if \(!regionShowClosed && !hasOpen && hasClosed\)/.test(SRC),
  "the Stocks/ETF regions need the same two-way fallback");
// The MF row set is pre-filtered by the toggle upstream, so asking it whether any
// position is closed always answers "no" and permanently disables the segment.
check(/var mfFlags = state === MFH_STATE && window\.__mfAnyClosed !== undefined/.test(SRC),
  "Mutual Fund Holding must answer from the transaction set, not from its filtered rows");
check(/window\.__mfAnyClosed = anyClosedMf/.test(SRC) && /window\.__mfAnyOpen = anyOpenMf/.test(SRC),
  "...and both flags must be published by the render that computes them");
// Stocks/ETF only builds the closed set once the user has asked for it, so the
// answer has to come from the sheet instead.
check(/function _seOpenClosedAvailability\(region, portfolioFilter\)/.test(SRC),
  "Stocks/ETF must answer availability from the transaction sheet, not from priced rows");
check(/var avail = _seOpenClosedAvailability\(region, regionPortfolio\)/.test(SRC),
  "...and the renderer must use it, scoped to the region and portfolio on screen");
// The state objects are read during module init, from above their old declaration
// site — a `var` there left them undefined and the first empty render threw.
const mfhDecl = SRC.indexOf("var MFH_STATE =");
check(mfhDecl !== -1 && mfhDecl < SRC.indexOf("function renderEquityHoldingsTable"),
  "MFH_STATE must be declared before renderEquityHoldingsTable, which reads it during init");
check(SRC.indexOf("var DBTH_STATE =") < SRC.indexOf("function renderMfHoldingsCardList"),
  "DBTH_STATE must be declared before the renderer that reads it");
check(/var anyClosedMf = false/.test(SRC), "anyClosedMf is computed before the open/closed filter");
// Debt instruments must bypass the MF open/closed filter or their own table can
// only ever see one side.
check(/if \(!isDebtInst\) \{/.test(SRC),
  "debt instruments must not be filtered by the Mutual Fund toggle — their table has its own");

check(/<h3 class="mfh-title">Debt ETF\/Mutual Holding<\/h3>/.test(HTML),
  'the debt card must be titled "Debt ETF/Mutual Holding"');

if (failed) { console.error("\n" + failed + " holdings-toggle check(s) failed"); process.exit(1); }
console.log("holdings Open/Closed toggles OK");
