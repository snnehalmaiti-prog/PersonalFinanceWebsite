#!/usr/bin/env node
// run-all.js — run every test suite and the repo guards in one command.
//
// Previously each suite had to be invoked by hand, which meant "have you run the
// tests?" depended on remembering all of them — and a newly added suite was
// invisible until someone thought to run it. This discovers suites from the
// directory, so a new tests/test-*.js file is picked up automatically.
//
// Usage: node tests/run-all.js     (exits non-zero if anything fails)
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const TESTS_DIR = __dirname;
const ROOT = path.join(TESTS_DIR, "..");

// Suites are discovered; guards are explicit repo-hygiene checks that aren't
// "tests" in the assertion sense but must pass before a deploy.
const suites = fs.readdirSync(TESTS_DIR)
  .filter((f) => /^test-.*\.js$/.test(f))
  .sort()
  .map((f) => ({ name: f, cmd: "node", args: [path.join(TESTS_DIR, f)] }));

const guards = [
  { name: "syntax: script.js", cmd: "node", args: ["--check", path.join(ROOT, "script.js")] },
  { name: "syntax: wf-math.js", cmd: "node", args: ["--check", path.join(ROOT, "wf-math.js")] },
  { name: "syntax: wf-overview.js", cmd: "node", args: ["--check", path.join(ROOT, "wf-overview.js")] },
  { name: "syntax: expense.js", cmd: "node", args: ["--check", path.join(ROOT, "expense.js")] },
  { name: "syntax: supabase-client.js", cmd: "node", args: ["--check", path.join(ROOT, "supabase-client.js")] },
  { name: "syntax: sw.js", cmd: "node", args: ["--check", path.join(ROOT, "sw.js")] },
  { name: "syntax: wf-idb.js", cmd: "node", args: ["--check", path.join(ROOT, "wf-idb.js")] },
  { name: "syntax: inline <script> in HTML", cmd: "node", args: [path.join(TESTS_DIR, "check-inline-scripts.js")] },
  { name: "shared script.js guards", cmd: "node", args: [path.join(TESTS_DIR, "check-shared-script-guards.js")] },
  { name: "portfolio card lines", cmd: "node", args: [path.join(TESTS_DIR, "check-portfolio-card-lines.js")] },
  { name: "chart pan/zoom config", cmd: "node", args: [path.join(TESTS_DIR, "check-chart-pan.js")] },
  { name: "holdings Open/Closed toggles", cmd: "node", args: [path.join(TESTS_DIR, "check-holdings-toggles.js")] },
  { name: "dashboard load path", cmd: "node", args: [path.join(TESTS_DIR, "check-load-path.js")] },
  { name: "service worker routes", cmd: "node", args: [path.join(TESTS_DIR, "check-sw-routes.js")] },
  { name: "debt reclassification call sites", cmd: "node", args: [path.join(TESTS_DIR, "check-debt-callsites.js")] },
  { name: "asset versions use placeholder", cmd: "node", args: [path.join(ROOT, "tools", "stamp-assets.js"), "--check"] },
];

function run(job) {
  const r = spawnSync(job.cmd, job.args, { cwd: ROOT, encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  return { ok: r.status === 0, out };
}

let failed = 0;
const summary = [];

console.log("=== Guards ===");
for (const g of guards) {
  const { ok, out } = run(g);
  console.log((ok ? "  ok   " : "  FAIL ") + g.name);
  if (!ok) { failed++; process.stdout.write(out.replace(/^/gm, "        ")); }
  summary.push({ name: g.name, ok });
}

console.log("\n=== Suites ===");
for (const s of suites) {
  const { ok, out } = run(s);
  // Surface each suite's own RESULT line rather than its full pass-by-pass output.
  const result = (out.match(/RESULT: .*/) || [])[0] || "(no RESULT line)";
  console.log((ok ? "  ok   " : "  FAIL ") + s.name + " — " + result);
  if (!ok) { failed++; process.stdout.write(out.replace(/^/gm, "        ")); }
  summary.push({ name: s.name, ok });
}

const total = summary.length;
console.log("\n" + (failed ? "FAILED" : "PASSED") + ": " + (total - failed) + "/" + total + " checks");
process.exit(failed ? 1 : 0);
