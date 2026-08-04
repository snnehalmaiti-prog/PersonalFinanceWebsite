#!/usr/bin/env node
// The India-retail gold premium default lives in two places: settings.html
// pre-fills the input with it, and script.js falls back to it when nothing was
// ever saved. They drifted — Settings showed 15 while the valuation applied 0 —
// so a user who never pressed Save was valued at a number they were never shown,
// understating physical gold by the whole premium. Nothing at runtime reconciles
// them, so assert it here.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");

const js = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "settings.html"), "utf8");

let failed = 0;
function ok(cond, msg, detail) {
  if (cond) return;
  failed++;
  console.error("FAIL: " + msg + (detail !== undefined ? "  → " + JSON.stringify(detail) : ""));
}

const jsM = js.match(/GOLD_PREMIUM_DEFAULT_PCT\s*=\s*(-?[\d.]+)/);
ok(jsM, "script.js declares GOLD_PREMIUM_DEFAULT_PCT");

// The fallback must USE the constant, not a second literal alongside it.
ok(/wf-gold-premium-pct[\s\S]{0,200}?\?\s*GOLD_PREMIUM_DEFAULT_PCT\s*:/.test(js),
   "getGoldPremiumMultiplier falls back to GOLD_PREMIUM_DEFAULT_PCT, not a literal");

const htmlM = html.match(/wf-gold-premium-pct[\s\S]{0,200}?\?\s*"(-?[\d.]+)"\s*:/);
ok(htmlM, "settings.html pre-fills the premium input with a literal default");

if (jsM && htmlM) {
  ok(Number(jsM[1]) === Number(htmlM[1]),
     "the two gold-premium defaults agree", { "script.js": jsM[1], "settings.html": htmlM[1] });
}

if (failed) { console.error(failed + " check(s) failed"); process.exit(1); }
console.log("gold premium default: ok");
