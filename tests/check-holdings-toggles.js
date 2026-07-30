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

check(/<h3 class="mfh-title">Debt ETF\/Mutual Holding<\/h3>/.test(HTML),
  'the debt card must be titled "Debt ETF/Mutual Holding"');

if (failed) { console.error("\n" + failed + " holdings-toggle check(s) failed"); process.exit(1); }
console.log("holdings Open/Closed toggles OK");
