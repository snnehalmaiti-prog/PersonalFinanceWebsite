#!/usr/bin/env node
// Guard: the service worker's routing table.
//
// The bulky market-data JSON (~4 MB across three files) must be served
// stale-while-revalidate from a cache keyed on the PATH, ignoring the query
// string — the app requests stock_prices.json with a rotating ?t= bucket, so a
// query-sensitive key would miss on every new bucket, re-download megabytes, and
// accumulate one copy per bucket. Verified in a real browser (a second request
// with a different buster reuses the single entry, and the file is served
// offline); this guard keeps the wiring from silently regressing.
"use strict";

const fs = require("fs");
const path = require("path");
const SW = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

let failed = 0;
function check(cond, msg) {
  if (!cond) { console.error("  FAIL " + msg); failed++; }
}

check(/var DATA_CACHE = "pf-data"/.test(SW),
  "DATA_CACHE must exist and must NOT be version-suffixed — a fresh name per deploy " +
  "throws away ~4 MB and re-downloads it on the phone");
check(/keep = \[[^\]]*DATA_CACHE/.test(SW),
  "DATA_CACHE must be in the activate handler's keep list, or it is deleted on every activation");
check(/function staleWhileRevalidateData\(request\)/.test(SW),
  "the query-insensitive data strategy is missing");
check(/request\.url\.split\("\?"\)\[0\]/.test(SW),
  "staleWhileRevalidateData must key on the path, not the full URL with its ?t= buster");
check(/\\\.json\(\?:\$\|\\\?\)/.test(SW) && /event\.respondWith\(staleWhileRevalidateData\(/.test(SW),
  "no fetch route dispatches same-origin .json to staleWhileRevalidateData");

// The data route must sit behind the bypass check, so per-user Supabase and
// Google Sheets responses are never written into a shared cache.
const bypassAt = SW.indexOf("hostMatches(url.hostname, BYPASS_HOSTS)");
const jsonRouteAt = SW.indexOf("event.respondWith(staleWhileRevalidateData(");
check(bypassAt !== -1 && jsonRouteAt !== -1 && bypassAt < jsonRouteAt,
  "the JSON route must come AFTER the BYPASS_HOSTS check — per-user data must never be cached");

if (failed) { console.error("\n" + failed + " service-worker route check(s) failed"); process.exit(1); }
console.log("service worker routes OK");
