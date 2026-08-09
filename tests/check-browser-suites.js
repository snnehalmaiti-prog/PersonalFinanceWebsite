#!/usr/bin/env node
// Guard: every browser suite must be runnable on a CI runner.
//
// The suites used to hardcode executablePath: "/opt/pw-browsers/chromium", a path
// that exists only in the authoring sandbox. That is why ~480 browser assertions
// never ran in CI — and the breakage is invisible locally, because locally the
// path is there. Exactly the kind of thing a guard has to hold, since the only
// symptom is "CI was never testing this".
//
// Cheap and dependency-free, so it lives in run-all.js and gates every push,
// even though what it protects is the other runner.
"use strict";

const fs = require("fs");
const path = require("path");

const TESTS_DIR = __dirname;
const suites = fs.readdirSync(TESTS_DIR).filter((f) => /^(e2e|measure)-.*\.js$/.test(f)).sort();

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

check(suites.length > 0, "no browser suites found — the discovery glob is wrong");

for (const f of suites) {
  const src = fs.readFileSync(path.join(TESTS_DIR, f), "utf8");
  check(/require\(["']\.\/_launch["']\)/.test(src),
    f + ": must launch via require(\"./_launch\"), not playwright directly");
  check(!/require\(["']playwright["']\)/.test(src),
    f + ": requires playwright directly, so it will not pick up the CI browser");
  check(!/\/opt\/pw-browsers/.test(src),
    f + ": hardcodes a sandbox-only Chromium path");
  // Suites read their port from the runner, or they all collide on a default.
  check(/process\.env\.PORT/.test(src),
    f + ": must honour process.env.PORT so the runner can place the server");
}

// _launch.js is the one file that MAY name the sandbox path and require
// playwright — but it must not require itself. A bulk rewrite once turned its own
// `require("playwright")` into `require("./_launch")`, which every suite then
// inherited as "Cannot read properties of undefined (reading 'launch')".
const launchSrc = fs.readFileSync(path.join(TESTS_DIR, "_launch.js"), "utf8");
check(/require\(["']playwright["']\)/.test(launchSrc),
  "_launch.js must require playwright itself");
check(!/require\(["']\.\/_launch["']\)/.test(launchSrc),
  "_launch.js requires itself — a circular require that breaks every suite");

// The runner must not block its own event loop; it serves the pages the suites
// load, so a synchronous child process deadlocks every one of them.
// Comments stripped first: the runner explains in prose WHY it avoids spawnSync,
// and matching that sentence would fail the guard on the very file that is right.
const runnerSrc = fs.readFileSync(path.join(TESTS_DIR, "run-browser.js"), "utf8")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
check(!/spawnSync\s*\(/.test(runnerSrc),
  "run-browser.js uses spawnSync — the in-process static server cannot answer " +
  "while the event loop is blocked, so every suite times out");

// CI has to actually invoke the runner, or all of the above protects nothing.
const ci = fs.readFileSync(path.join(TESTS_DIR, "..", ".github", "workflows", "ci.yml"), "utf8");
check(/tests\/run-browser\.js/.test(ci), "ci.yml does not run tests/run-browser.js");
check(/playwright install/.test(ci), "ci.yml does not install a browser");

if (failed) { console.error(failed + " browser-suite check(s) failed"); process.exit(1); }
console.log("browser suites: " + suites.length + " runnable in CI");
