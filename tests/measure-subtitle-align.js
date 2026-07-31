// Measures the chart-title / period-line geometry in a real browser, against the
// real stylesheet — the thing check-chart-subtitle-align.js can only approximate by
// reading the CSS rule. Builds its fixture from dashboard.html, so it cannot drift
// away from the markup it claims to check.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     node tools/serve.js &
//     node tests/measure-subtitle-align.js
//
// Expected: dx 0 (flush left with the title) and a small positive gap.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 8098;

// Build the fixture out of the live markup: the two header blocks plus their period
// lines, dropped into a real .avc-card so the card's own padding is in play.
const HTML = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
function grab(anchor) {
  const j = HTML.indexOf(anchor);
  const start = HTML.lastIndexOf('<div class="avc-header">', j);
  const end = HTML.indexOf("</p>", HTML.indexOf("avc-subtitle", j)) + 4;
  return HTML.slice(start, end);
}
const FIXTURE = path.join(ROOT, "__subtitle-align-fixture.html");
fs.writeFileSync(FIXTURE,
  '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body>' +
  '<div class="avc-card" style="width:520px">' + grab('id="avc-eyebrow"') + '</div>' +
  '<div class="avc-card" style="width:520px">' + grab('id="pvc-eyebrow"') + '</div>' +
  '</body></html>');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  \u2192 " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await (await b.newContext({ viewport: { width: 900, height: 700 } })).newPage();
  await p.goto(`http://127.0.0.1:${PORT}/__subtitle-align-fixture.html`, { waitUntil: "load" });
  await p.waitForTimeout(400);
  const out = await p.evaluate(() => {
    const pair = (t, s) => {
      const tr = document.getElementById(t).getBoundingClientRect();
      const sr = document.getElementById(s).getBoundingClientRect();
      return { dx: +(sr.left - tr.left).toFixed(2), gap: +(sr.top - tr.bottom).toFixed(2) };
    };
    return { growth: pair("avc-eyebrow", "avc-period"), account: pair("pvc-eyebrow", "pvc-period") };
  });
  console.log("  " + JSON.stringify(out));
  ["growth", "account"].forEach(function (k) {
    ok(out[k].dx === 0, k + ": the period line is flush left with its title", out[k].dx);
    ok(out[k].gap >= 0 && out[k].gap <= 6,
       k + ": and sits close under it, without overlapping", out[k].gap);
  });
  await b.close();
  try { fs.unlinkSync(FIXTURE); } catch (e) {}
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
