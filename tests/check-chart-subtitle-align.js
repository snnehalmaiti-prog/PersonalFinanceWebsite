#!/usr/bin/env node
// Guard: the period line under each chart title must sit flush with the title.
//
// The card already pads 20px; the subtitle rule added its own horizontal margin on
// top of that, so "SINCE 2018" was indented 20px past the "GROWTH OF ₹100" it
// belongs to, and the header's own bottom margin left an 11px gap between them.
//
// Geometry, so it is checked as geometry — tests/measure-subtitle-align.js renders
// the real markup against the real stylesheet in a browser and asserts dx === 0.
// This file is the cheap version for run-all, which has no browser: it pins the
// rule those measurements depend on.
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const CSS = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

// Comments first: a /* ... */ inside the rule otherwise matches as the declaration.
const CSS_BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (CSS_BARE.match(/\.avc-subtitle\s*\{[^}]*\}/) || [""])[0];
check(rule, ".avc-subtitle rule is missing");

const margin = (rule.match(/margin:\s*([^;]+);/) || [])[1];
check(margin, ".avc-subtitle needs an explicit margin, or it inherits a p's 1em");
if (margin) {
  const parts = margin.trim().split(/\s+/);
  // top right bottom left — or the 3-value form, where left mirrors right.
  const right = parts[1], left = parts[3] !== undefined ? parts[3] : parts[1];
  check(/^0$/.test(right) && /^0$/.test(left),
    "the subtitle must have NO horizontal margin — the card's own 20px padding " +
    "already places it, and adding more indents it past the title: got " + margin);
  const top = parseFloat(parts[0]);
  check(top <= 0,
    "the subtitle's top margin must pull it toward the title, not push it away " +
    "(the header already contributes its own bottom margin): got " + parts[0]);
}

// Both cards must actually use the class, or the rule guards nothing.
check((HTML.match(/class="avc-subtitle"/g) || []).length === 2,
  "expected exactly two .avc-subtitle lines, one under each chart title");
check(/id="avc-period"/.test(HTML) && /id="pvc-period"/.test(HTML),
  "both period lines need their ids — the zoom readout writes to them");

// The titles must be plain titles; a period appended there is what this replaced.
check(/id="avc-eyebrow">GROWTH OF &#8377;100<\/span>/.test(HTML),
  "the Growth title must be the title alone, with the period on its own line");
check(/id="pvc-eyebrow">ACCOUNT VALUE<\/span>/.test(HTML),
  "the Account Value title must be the title alone, with the period on its own line");

if (failed) { console.error("\n" + failed + " subtitle-alignment check(s) failed"); process.exit(1); }
console.log("chart subtitle alignment OK");
