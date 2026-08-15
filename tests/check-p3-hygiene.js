#!/usr/bin/env node
// Guard: the hygiene fixes, each of which is a one-line edit away from coming
// back and none of which fails loudly when it does.
//
// These were P3 findings — maintainability and consistency rather than active
// bugs. That is exactly why they need a guard: nothing on screen changes when
// somebody reintroduces a local escaper or drops an encodeURIComponent, so
// nothing catches it.
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const SCRIPT = read("script.js");
const EXPENSE = read("expense.js");
const DASH = read("dashboard.html");
const SETTINGS = read("settings.html");
const INDEX = read("index.html");
const SB = read("supabase-client.js");
const DEPLOY = read(".github/workflows/deploy-pages.yml");

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

// ── P3-1: one escaper ──────────────────────────────────────────────────────
// There were SEVEN, with three different character sets — five named in the
// review plus two more it missed. All were used where the omissions were inert,
// so none was exploitable; the risk is the next call site reaching for the
// weakest one in a single-quoted attribute, on an origin holding the Supabase
// session and a repo-write PAT.
check(fs.existsSync(path.join(ROOT, "wf-esc.js")), "wf-esc.js must exist — it is the one escaper");
const ESC = read("wf-esc.js");
check(/window\.WfEsc = escapeHtml;/.test(ESC), "wf-esc.js must publish window.WfEsc");
check(/\[&<>"'\]/.test(ESC), "the canonical escaper must cover & < > \" AND the apostrophe");

// Any OTHER inline escaper is a new divergent copy. Matched on the character
// class rather than the function name, because the name is what kept changing:
// escapeHtml, _escHtml, esc, escLocal.
[["script.js", SCRIPT], ["expense.js", EXPENSE], ["dashboard.html", DASH],
 ["settings.html", SETTINGS], ["index.html", INDEX]].forEach(function (pair) {
  const hits = (pair[1].match(/replace\(\/\[&<>"\]\/g/g) || []).length;
  check(hits === 0,
    pair[0] + " defines " + hits + " local HTML escaper(s) missing the apostrophe — use window.WfEsc");
});
// script.js keeps one full-strength copy as a standalone fallback, because
// several suites eval its functions with no page around them. One, not two.
check((SCRIPT.match(/replace\(\/\[&<>"'\]\/g/g) || []).length === 1,
  "script.js should hold exactly one full-strength escaper (the WfEsc fallback)");
// Both pages must LOAD it, and before anything that uses it.
[["dashboard.html", DASH], ["settings.html", SETTINGS]].forEach(function (pair) {
  check(pair[1].indexOf("wf-esc.js") !== -1, pair[0] + " must load wf-esc.js");
  const at = pair[1].indexOf("wf-esc.js");
  const firstUse = pair[1].indexOf("window.WfEsc");
  check(at !== -1 && firstUse !== -1 && at < firstUse,
    pair[0] + " must load wf-esc.js BEFORE the first window.WfEsc reference — " +
    "dashboard.html escapes during the cached-expense paint, which runs before script.js is injected");
});

// ── P3-2: a malformed money cell is reported ───────────────────────────────
check(/function numericShape\(/.test(SCRIPT),
  "numericShape must exist — 'contains a digit' passes \"2024-01-15\", which parseNumber turns into 2024");
check(/function validateNumericCell\(value\) \{\s*var shape = numericShape\(value\);/.test(SCRIPT),
  "validateNumericCell must go through numericShape, or the truncations are waved through again");

// ── P3-3: the GitHub path is encoded ───────────────────────────────────────
check(/function ghRepoApiBase\(gh\)/.test(SCRIPT), "there must be one encoded builder for the repo API base");
check(/encodeURIComponent\(gh\.owner\) \+ "\/" \+ encodeURIComponent\(gh\.repo\)/.test(SCRIPT),
  "owner and repo must both be encoded");
check(!/api\.github\.com\/repos\/" \+ gh\.owner/.test(SCRIPT),
  "no call site may build the repos/ path by raw concatenation");

// ── P3-4: the deploy ships the site, not the repo ──────────────────────────
check(/Prune non-site files from the artifact/.test(DEPLOY),
  "the deploy must prune before uploading — it used to ship tests/, docs/, every .py and both .sql files");
["tests", "docs", "tools", "__pycache__"].forEach(function (d) {
  check(new RegExp("rm -rf[^\\n]*\\b" + d + "\\b").test(DEPLOY), "the prune must remove " + d + "/");
});
check(/rm -f[^\n]*\*\.py/.test(DEPLOY) && /rm -f[^\n]*\*\.sql/.test(DEPLOY) && /rm -f[^\n]*\*\.xlsx/.test(DEPLOY),
  "the prune must remove the .py, .sql and .xlsx files");
// Everything the pages actually reference has to survive it. Parsed from the
// HTML rather than listed here, so a new asset is covered automatically.
const PRUNED_DIRS = ["tests/", "docs/", "tools/", "__pycache__/", "node_modules/", ".github/"];
const refs = new Set();
[DASH, SETTINGS, INDEX, read("offline.html")].forEach(function (html) {
  (html.match(/(?:src|href)="([^"h#][^"]*)"/g) || []).forEach(function (m) {
    refs.add(m.replace(/^(?:src|href)="/, "").replace(/"$/, "").split("?")[0]);
  });
});
check(refs.size > 10, "the referenced-asset sweep found " + refs.size + " assets — too few to be real");
refs.forEach(function (f) {
  const prunedByDir = PRUNED_DIRS.some(function (d) { return f.indexOf(d) === 0; });
  const prunedByExt = /\.(py|sql|xlsx|md)$/.test(f);
  check(!prunedByDir && !prunedByExt,
    "the deploy prune would delete " + f + ", which a page references");
  check(fs.existsSync(path.join(ROOT, f)), "referenced asset " + f + " does not exist in the repo");
});

// ── P3-5: no deprecated unescape ───────────────────────────────────────────
// Comments stripped first — the replacement's own comment names the function it
// replaced, and matching prose would make this check unfailable-by-rewording.
const SCRIPT_CODE = SCRIPT.replace(/^\s*\/\/.*$/gm, "");
check(!/[^a-zA-Z_.]unescape\(/.test(SCRIPT_CODE), "unescape() is deprecated (Annex B) — use utf8ToBase64");
check(/function utf8ToBase64\(str\)/.test(SCRIPT) && /new TextEncoder\(\)/.test(SCRIPT),
  "the base64 path must encode UTF-8 with TextEncoder");
check(/i \+= 0x8000/.test(SCRIPT),
  "utf8ToBase64 must chunk — String.fromCharCode.apply overflows its argument limit on a large mapping sheet");

// ── P3-6: the allocation bar uses the real escaper ─────────────────────────
check(!/e\.name\.replace\(\/"\/g/.test(SCRIPT),
  "the allocation bar must not hand-roll a quote-only escape — its sibling 150 lines below uses escapeHtml");

// ── P3-7: loadData cannot recurse forever ──────────────────────────────────
check(/var _loadDepth = 0;/.test(EXPENSE) && /_loadDepth >= LOAD_MAX_DEPTH/.test(EXPENSE),
  "loadData needs an in-memory depth bound — under private browsing its localStorage markers always fail " +
  "to write, so termination rested entirely on a database side-effect having taken");

// ── P3-8: per-user expense markers are cleared on sign-out ─────────────────
check(/wf-exp-\(icons-cleared\|seeded\)-/.test(SB),
  "signOut must sweep the uid-keyed expense markers — they are not in SYNC_KEYS and survived on a shared device");

// ── P3-9: expense row ids are escaped ──────────────────────────────────────
const rowHtml = EXPENSE.slice(EXPENSE.indexOf("function rowHtml(opts)"),
                              EXPENSE.indexOf("// ── Rendering: Accounts"));
check(rowHtml.length > 100, "rowHtml could not be located");
check(!/data-nav="' \+ opts\.id/.test(rowHtml) && !/data-id="' \+ opts\.id/.test(rowHtml) &&
      !/data-kebab="' \+ opts\.kebab/.test(rowHtml),
  "rowHtml must escape opts.id and opts.kebab like every sibling value it interpolates");

// ── P3-10: no button defaults to submit ────────────────────────────────────
["dashboard.html", "settings.html", "index.html", "offline.html"].forEach(function (f) {
  const html = read(f);
  const bare = (html.match(/<button\b[^>]*>/g) || []).filter(function (t) { return t.indexOf("type=") === -1; });
  check(bare.length === 0,
    f + " has " + bare.length + " <button> without an explicit type — the default is submit: " +
    bare.slice(0, 3).join(" "));
  // And the ones inside a form must still submit — a blanket type="button" here
  // would silently break sign-in.
  (html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) || []).forEach(function (form) {
    const submits = (form.match(/<button\b[^>]*type="submit"[^>]*>/g) || []).length;
    const buttons = (form.match(/<button\b[^>]*>/g) || []).length;
    check(buttons === 0 || submits > 0,
      f + " has a <form> whose buttons are all type=button — nothing can submit it");
  });
});

if (failed) { console.error("\n" + failed + " P3 hygiene check(s) failed"); process.exit(1); }
console.log("P3 hygiene OK");
