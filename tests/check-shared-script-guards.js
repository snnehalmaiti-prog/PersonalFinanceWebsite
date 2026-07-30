#!/usr/bin/env node
// Guard: script.js runs on index.html, dashboard.html AND settings.html, but each
// page carries a different subset of the markup. A block that checks for one
// element and then dereferences a sibling throws on the pages missing it — and
// because it is all one IIFE, the throw kills every top-level statement below it,
// so later code silently never runs on that page.
//
// That is exactly what the login modal did: index.html has the "Log in" button
// (wired to its own auth modal inline) but none of the modal markup, so every
// landing-page load threw at closeLoginBtn.addEventListener.
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const PAGES = ["index.html", "dashboard.html", "settings.html"].map((f) => ({
  name: f, html: fs.readFileSync(path.join(ROOT, f), "utf8"),
}));

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

// The legacy login modal: the guard must cover everything the block dereferences.
check(/if \(openLoginBtn && loginOverlay && closeLoginBtn && tabLogin && tabSignup\) \{/.test(SRC),
  "the login-modal block must be guarded on the whole modal, not just the button — " +
  "index.html has the button without the modal");

// The elements that block reads, and the id each getElementById asks for.
const MODAL_IDS = ["login-overlay", "open-login", "close-login", "tab-login", "tab-signup"];
PAGES.forEach(function (p) {
  const present = MODAL_IDS.filter((id) => p.html.indexOf('id="' + id + '"') !== -1);
  // Either a page has the whole modal or none of the parts the block dereferences.
  // A page with only SOME of them is the shape that used to throw.
  const hasButton = present.indexOf("open-login") !== -1;
  const hasRest = ["login-overlay", "close-login", "tab-login", "tab-signup"]
    .every((id) => present.indexOf(id) !== -1);
  if (hasButton && !hasRest) {
    // Allowed only because the guard above covers it — assert the guard is what
    // saves us, so removing it fails here too rather than silently on the page.
    check(/if \(openLoginBtn && loginOverlay/.test(SRC),
      p.name + " has open-login without the rest of the modal, and the guard no longer covers it");
  }
});

// Any top-level statement that dereferences a page-specific element without a guard
// is the same landmine. Catch the common shape: `document.getElementById(...)` stored
// then used with `.addEventListener` at top level with no null check in between.
const declared = {};
(SRC.match(/var (\w+) = document\.getElementById\("([^"]+)"\);/g) || []).forEach(function (line) {
  const m = line.match(/var (\w+) = document\.getElementById\("([^"]+)"\);/);
  declared[m[1]] = m[2];
});
const unguarded = [];
Object.keys(declared).forEach(function (v) {
  // A bare `v.addEventListener(` at the start of a line, i.e. not inside `if (v)`.
  const re = new RegExp("^\\s{2}" + v + "\\.addEventListener\\(", "m");
  if (!re.test(SRC)) return;
  // Unguarded is fine as long as the element is on EVERY page that loads script.js.
  // It is only a bug where a page lacks it — then the throw kills the rest of the IIFE.
  const missing = PAGES.filter((p) => p.html.indexOf('id="' + declared[v] + '"') === -1)
                       .map((p) => p.name);
  if (missing.length) unguarded.push(v + " (#" + declared[v] + ") missing from " + missing.join(", "));
});
check(unguarded.length === 0,
  "these elements are dereferenced at top level with no null guard on pages that do not " +
  "have them, which throws and kills every statement below it: " + unguarded.join("; "));

if (failed) { console.error("\n" + failed + " shared-script check(s) failed"); process.exit(1); }
console.log("shared script.js guards OK");
