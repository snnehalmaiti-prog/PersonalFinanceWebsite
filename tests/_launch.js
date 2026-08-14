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

// The chart libraries moved from jsDelivr into vendor/ on this origin, so they
// are no longer neutralised by the `**://cdn.jsdelivr.net/**` route that 42
// suites install. Left alone, the real Chart.js loads and OVERWRITES the
// `window.Chart` stub those suites set in addInitScript — every assertion that
// reads a captured chart config then finds undefined.
//
// Blocked here rather than in each suite: the stub is how the browser tests read
// chart data at all, and one forgotten route in a new suite is a confusing
// failure a long way from its cause. A suite that genuinely wants the real
// library can re-route the path itself.
// Trailing * is load-bearing: the tags carry "?v=__ASSET_VERSION__" and
// Playwright matches globs against the full URL, query string included.
const VENDOR_ROUTE = "**/vendor/*.js*";

async function stubVendor(target) {
  await target.route(VENDOR_ROUTE, (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
}

async function launch(opts) {
  const o = Object.assign({}, opts);
  const exe = resolveExecutable();
  if (exe) o.executablePath = exe;
  const browser = await chromium.launch(o);
  // Wrap newContext so every context a suite makes gets the route without the
  // suite having to know about it.
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async function (ctxOpts) {
    const ctx = await newContext(ctxOpts);
    await stubVendor(ctx);
    return ctx;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async function (pageOpts) {
    const pg = await newPage(pageOpts);
    await stubVendor(pg);
    return pg;
  };
  return browser;
}

// Suites destructure `chromium` and call `chromium.launch()`, so expose the same
// shape rather than making every file learn a new API.
module.exports = { chromium: { launch }, launch, resolveExecutable, VENDOR_ROUTE };
