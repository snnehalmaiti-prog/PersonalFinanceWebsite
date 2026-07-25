#!/usr/bin/env node
// stamp-assets.js — replace the __ASSET_VERSION__ placeholder with a real build
// version, so every deploy gets fresh cache-busting URLs automatically.
//
// WHY THIS EXISTS
// Asset versions used to be bumped by hand (`sed -i s/oldtag/newtag/` across the
// HTML files) on every change. That is easy to forget and easy to do partially:
// at the time this script was written, index.html was still pointing at
// `script.js?v=budgetacct` while dashboard.html had moved on to `?v=ovstore4` —
// the same file served under two cache keys, so anyone landing on index.html got
// a stale bundle. Manual versioning had silently drifted.
//
// Now the committed HTML carries a placeholder and CI stamps it at deploy time
// with the commit SHA. Consequences:
//   * every deploy busts every asset, consistently — drift is impossible;
//   * a deploy that changes nothing produces no version churn beyond the SHA;
//   * nobody has to remember anything.
//
// Local development is unaffected: the placeholder is a valid query string, so
// pages opened straight from the working tree just get a constant version (which
// is what you want locally — no stale-cache surprises between edits).
//
// Usage:
//   node tools/stamp-assets.js                 # version from GITHUB_SHA, else git rev-parse
//   node tools/stamp-assets.js <version>       # explicit version
//   node tools/stamp-assets.js --check         # verify no hardcoded ?v= remains (CI guard)
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const PLACEHOLDER = "__ASSET_VERSION__";

// Files that carry versioned references. Kept explicit rather than globbed so a
// new page must be added deliberately (and shows up in review).
const TARGETS = ["index.html", "dashboard.html", "settings.html", "sw.js"];

function resolveVersion(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (e) {
    // No git available (e.g. a source tarball). A timestamp still yields a
    // unique, monotonic version — worse for reproducibility, but never stale.
    return "t" + Date.now().toString(36);
  }
}

// A version must be safe inside a URL query string and a JS string literal.
function assertSafeVersion(v) {
  if (!/^[A-Za-z0-9._-]+$/.test(v)) {
    console.error("stamp-assets: refusing unsafe version '" + v + "' (expected [A-Za-z0-9._-]+)");
    process.exit(1);
  }
}

function readTargets() {
  return TARGETS.map((rel) => {
    const abs = path.join(ROOT, rel);
    return fs.existsSync(abs) ? { rel, abs, text: fs.readFileSync(abs, "utf8") } : null;
  }).filter(Boolean);
}

// --check: fail if any versioned reference is hardcoded instead of using the
// placeholder. This is what stops the codebase from sliding back into manual
// bumping — the exact failure this script was written to eliminate.
function check() {
  let bad = 0;
  for (const f of readTargets()) {
    // Only real asset references count — i.e. a ?v= inside an src/href attribute.
    // A bare `?v=` in prose (sw.js documents the query-string behaviour in its
    // header comment) is not a version to stamp.
    const refs = f.text.match(/(?:src|href)="[^"]*\?v=[^"]*"/g) || [];
    const hardcoded = refs.filter((r) => !r.includes(PLACEHOLDER));
    if (hardcoded.length) {
      bad += hardcoded.length;
      console.error(f.rel + ": hardcoded asset version(s): " + [...new Set(hardcoded)].join(", "));
    }
    if (f.rel === "sw.js") {
      const m = f.text.match(/var VERSION = "([^"]*)"/);
      if (m && m[1] !== PLACEHOLDER) {
        bad++;
        console.error('sw.js: VERSION is hardcoded as "' + m[1] + '" (expected ' + PLACEHOLDER + ")");
      }
    }
  }
  if (bad) {
    console.error("\nFAIL: " + bad + " hardcoded asset version(s). Use ?v=" + PLACEHOLDER +
                  " and let tools/stamp-assets.js fill it in at deploy time.");
    process.exit(1);
  }
  console.log("OK: all asset versions use the " + PLACEHOLDER + " placeholder.");
}

function stamp(version) {
  assertSafeVersion(version);
  let touched = 0, total = 0;
  for (const f of readTargets()) {
    const count = f.text.split(PLACEHOLDER).length - 1;
    if (!count) continue;
    fs.writeFileSync(f.abs, f.text.split(PLACEHOLDER).join(version));
    touched++; total += count;
    console.log("  " + f.rel + ": " + count + " reference(s)");
  }
  if (!total) {
    console.error("stamp-assets: no " + PLACEHOLDER + " found — nothing stamped. Refusing to " +
                  "report success, since this usually means the placeholder was lost.");
    process.exit(1);
  }
  console.log("Stamped version '" + version + "' into " + touched + " file(s), " + total + " reference(s).");
}

const arg = process.argv[2];
if (arg === "--check") check();
else stamp(resolveVersion(arg));
