#!/usr/bin/env node
// run-browser.js — run every browser suite, serving the repo itself.
//
// These suites hold most of the assertions that catch valuation bugs, but until
// now nothing ran them automatically: they need Chromium and a web server, so
// they only ever ran when someone remembered the two commands. run-all.js covers
// the plain-Node guards; this covers the rest.
//
// Suites are DISCOVERED from the directory, so a new tests/e2e-*.js is picked up
// without editing anything here — the same rule run-all.js uses, for the same
// reason: a suite nobody remembered to register is a suite nobody runs.
//
// Usage: node tests/run-browser.js            (exits non-zero if anything fails)
//        node tests/run-browser.js e2e-xirr   (substring filter, for one suite)
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const TESTS_DIR = __dirname;
const ROOT = path.join(TESTS_DIR, "..");
const PORT = Number(process.env.PORT || 8098);
const FILTER = process.argv[2] || "";

// The measure-* suites are diagnostics that print geometry across many widths and
// take minutes; they assert too, so they run here, but a "measure" filter or
// SKIP_MEASURE=1 keeps a quick loop quick.
const SKIP_MEASURE = process.env.SKIP_MEASURE === "1";

const suites = fs.readdirSync(TESTS_DIR)
  .filter((f) => /^(e2e|measure)-.*\.js$/.test(f))
  .filter((f) => !SKIP_MEASURE || !f.startsWith("measure-"))
  .filter((f) => !FILTER || f.includes(FILTER))
  .sort();

if (!suites.length) {
  console.error("No browser suites matched" + (FILTER ? " filter: " + FILTER : "."));
  process.exit(1);
}

// ── static server ─────────────────────────────────────────────────────────────
// Deliberately dependency-free: the repo has no package.json and no build step,
// and a CI job that has to install a server before it can test is one more thing
// to break.
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(req.url.split("?")[0]); } catch (e) { rel = req.url.split("?")[0]; }
  if (rel === "/") rel = "/index.html";
  // Contain to ROOT: a suite requesting ../../etc/passwd should 403, not read it.
  const full = path.resolve(ROOT, "." + rel);
  if (!full.startsWith(path.resolve(ROOT))) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, {
      "content-type": MIME[path.extname(full).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(buf);
  });
});

function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PORT: String(PORT) }),
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (status) => resolve({ status: status, out: out }));
  });
}

function listen() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
}

(async () => {
  try {
    await listen();
  } catch (e) {
    console.error("Could not serve on port " + PORT + ": " + e.message);
    console.error("Another server may already be running there.");
    process.exit(1);
  }
  console.log("serving " + ROOT + " on http://127.0.0.1:" + PORT);

  // Fail loudly if Chromium is missing, rather than reporting 18 identical
  // launch errors as though the suites were at fault.
  try {
    const { resolveExecutable } = require("./_launch");
    require("playwright");
    console.log("chromium: " + (resolveExecutable() || "playwright's own download"));
  } catch (e) {
    console.error("Playwright is not available: " + e.message);
    console.error("Install it with:  npm install playwright && npx playwright install chromium");
    server.close();
    process.exit(1);
  }

  let failed = 0;
  const summary = [];
  const started = Date.now();

  for (const s of suites) {
    const t0 = Date.now();
    // spawn, NOT spawnSync: the static server lives in THIS process, and
    // spawnSync blocks the event loop — the server would never answer the
    // browser and every suite would time out.
    const r = await run("node", [path.join(TESTS_DIR, s)]);
    const out = r.out;
    const result = (out.match(/RESULT: .*/) || [])[0] || "(no RESULT line)";
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const ok = r.status === 0;
    console.log((ok ? "  ok   " : "  FAIL ") + s.padEnd(32) + result + "  [" + secs + "s]");
    if (!ok) {
      failed++;
      // Only the failing lines, not the whole transcript — a browser suite prints
      // hundreds of PASS lines and they bury the one that matters.
      const lines = out.split("\n").filter((l) => /FAIL|Error|error:/.test(l));
      process.stdout.write((lines.length ? lines : out.split("\n").slice(-25)).join("\n").replace(/^/gm, "        ") + "\n");
    }
    summary.push({ name: s, ok });
  }

  server.close();
  const mins = ((Date.now() - started) / 60000).toFixed(1);
  console.log("\n" + (failed ? "FAILED" : "PASSED") + ": " +
    (summary.length - failed) + "/" + summary.length + " browser suites  [" + mins + " min]");
  process.exit(failed ? 1 : 0);
})();
