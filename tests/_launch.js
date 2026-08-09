// Shared Chromium launcher for the browser suites.
//
// Every suite used to hardcode executablePath: "/opt/pw-browsers/chromium".
// That path exists in the authoring sandbox and nowhere else, so the suites
// could not run on a CI runner — which is why ~480 browser assertions were never
// checked automatically. A plain chromium.launch() does not work in the sandbox
// either: PLAYWRIGHT_BROWSERS_PATH points at a browser build whose version does
// not match the bundled Playwright, so Playwright looks for a sibling directory
// that isn't there.
//
// So: use an explicit path only when one is actually available, and otherwise let
// Playwright find the browser it installed itself. PW_CHROMIUM overrides both.
"use strict";

const fs = require("fs");
const { chromium } = require("playwright");

const SANDBOX_CHROMIUM = "/opt/pw-browsers/chromium";

function resolveExecutable() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  try { if (fs.statSync(SANDBOX_CHROMIUM).isFile()) return SANDBOX_CHROMIUM; } catch (e) {}
  return null;                    // let Playwright use its own download
}

async function launch(opts) {
  const o = Object.assign({}, opts);
  const exe = resolveExecutable();
  if (exe) o.executablePath = exe;
  return chromium.launch(o);
}

// Suites destructure `chromium` and call `chromium.launch()`, so expose the same
// shape rather than making every file learn a new API.
module.exports = { chromium: { launch }, launch, resolveExecutable };
