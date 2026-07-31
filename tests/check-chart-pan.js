#!/usr/bin/env node
// Guard: both value charts must pan on a left/right mouse drag.
//
// The Growth chart declared pan and still would not drag, because its x scale also
// carried hard `min`/`max` in the OPTIONS. Chart.js re-applies those on every
// update, so the pan plugin's writes were undone as fast as it made them. The
// window has to be set through the plugin (zoomScale) instead, or the bound and the
// gesture fight and the gesture loses.
//
// None of this is reachable by the browser suites here: chartjs-plugin-zoom needs a
// CDN the sandbox cannot reach, so its gestures are never exercised. This checks the
// configuration that makes them possible.
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const HTML = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

// The plugin, and the date adapter its time axis needs, must both be loaded.
check(/chartjs-plugin-zoom/.test(HTML), "chartjs-plugin-zoom is not loaded — no gesture works without it");

// Balanced-brace extraction: these blocks nest, so a regex cannot delimit them.
function blocksAt(src, marker) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf(marker, i)) !== -1) {
    let j = src.indexOf("{", i), depth = 0, k = j;
    for (; k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}") { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(i, k + 1));
    i = k + 1;
  }
  return out;
}

// Two charts, two pan blocks, both horizontal and both enabled.
const panBlocks = blocksAt(SRC, "pan: {").concat(blocksAt(SRC, "pan:\n"));
const enabledPans = panBlocks.filter((b) => /enabled:\s*true/.test(b) && /mode:\s*"x"/.test(b));
check(enabledPans.length === 2,
  "expected both value charts to enable horizontal pan, found " + enabledPans.length);
check(enabledPans.every((b) => /threshold:\s*\d+/.test(b)),
  "pan needs a threshold, or a plain click registers as a one-pixel drag");

// The regression itself: a hard min/max on the x scale options kills panning.
check(!/min:\s*fullMinTime,\s*\n\s*max:\s*fullMaxTime,/.test(SRC),
  "the Growth chart pins min/max on its x scale options again — Chart.js re-applies " +
  "those on every update, so panning is undone as fast as it happens");
check(/setChartXWindow\(window\.__wfValueChart, fullMinTime, fullMaxTime\)/.test(SRC),
  "the Growth chart's opening window must be set through the plugin, so pan and the " +
  "bound do not fight");

// The plugin is a separate CDN script. Chart.js can load while it does not, and a
// bare plugin call then throws and takes the whole render down.
const bareCalls = (SRC.match(/\.(zoomScale|resetZoom)\(/g) || []).length;
const guardedCalls = (SRC.match(/typeof chart\.(zoomScale|resetZoom) === "function"/g) || []).length +
                     (SRC.match(/typeof window\.__wfValueChart\.resetZoom === "function"/g) || []).length;
check(bareCalls <= 3 && guardedCalls >= 3,
  "every zoomScale/resetZoom call must be behind a typeof guard (or go through " +
  "setChartXWindow), or the charts break entirely when the zoom plugin fails to load: " +
  "calls=" + bareCalls + " guards=" + guardedCalls);

// Drag has to belong to panning; box-select zoom would claim the same gesture.
const zoomBlocks = blocksAt(SRC, "zoom: {").filter((b) => /wheel:/.test(b));
check(zoomBlocks.length === 2 && zoomBlocks.every((b) => /drag:\s*\{\s*enabled:\s*false/.test(b)),
  "drag-to-zoom must stay off on both charts, or it takes the drag gesture from pan");

// Both charts clamp to their own data so a pan cannot wander into empty space.
check(blocksAt(SRC, "limits: {").filter((b) => /x:\s*\{\s*min:/.test(b)).length === 2,
  "both charts must bound pan/zoom to their plotted range");

// Discoverability: a draggable chart looks exactly like one that is not.
check(/#value-chart[^{]*#portfolio-value-chart[^{]*\{[^}]*cursor:\s*grab/.test(CSS),
  "the canvases should show a grab cursor so the drag is discoverable");
check(/cursor:\s*grabbing/.test(CSS), "and a grabbing cursor while dragging");

if (failed) { console.error("\n" + failed + " chart-pan check(s) failed"); process.exit(1); }
console.log("chart pan/zoom configuration OK");
