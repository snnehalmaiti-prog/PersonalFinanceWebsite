#!/usr/bin/env node
// check-inline-scripts.js — syntax-check the JavaScript embedded in the HTML pages.
//
// dashboard.html carries ~2,500 lines of inline <script> (the whole Expense UI
// lives there). Nothing ever parsed it: `node --check` only covers the .js files,
// so a stray typo in that block shipped as a blank page and no test noticed.
// This parses every inline script and fails on a syntax error.
//
// It parses only — it does not execute — so browser globals are irrelevant.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const PAGES = ["index.html", "dashboard.html", "settings.html"];

// Inline scripts only: anything with a src= is a separate file, already covered
// by node --check. Non-JS payloads (JSON-LD, templates) are skipped by type.
const SCRIPT_RE = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
const JS_TYPES = ["", "text/javascript", "application/javascript", "module"];

let failures = 0;
let checked = 0;

for (const page of PAGES) {
  const abs = path.join(ROOT, page);
  if (!fs.existsSync(abs)) continue;
  const html = fs.readFileSync(abs, "utf8");

  let m;
  while ((m = SCRIPT_RE.exec(html)) !== null) {
    const attrs = m[1] || "";
    const body = m[2] || "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']*)["']/i);
    const type = typeMatch ? typeMatch[1].toLowerCase() : "";
    if (JS_TYPES.indexOf(type) === -1) continue;
    if (!body.trim()) continue;

    // Line number of this block, so an error points at the real place in the file.
    const line = html.slice(0, m.index).split("\n").length;
    checked++;
    try {
      // new vm.Script() parses without running. Modules need a different parse
      // goal, so route them through SourceTextModule when available.
      if (type === "module" && typeof vm.SourceTextModule === "function") {
        new vm.SourceTextModule(body);
      } else {
        new vm.Script(body, { filename: page + ":" + line });
      }
    } catch (err) {
      failures++;
      console.error(page + " (inline script at line " + line + "): " + err.message);
    }
  }
}

if (failures) {
  console.error("\nRESULT: " + failures + " inline script(s) failed to parse");
  process.exit(1);
}
console.log("RESULT: " + checked + " inline script(s) parsed, 0 failed");
