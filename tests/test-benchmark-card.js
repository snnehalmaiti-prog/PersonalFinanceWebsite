// Benchmark Comparison card — rendering and cache invariants.
//
// The card's ARITHMETIC is covered elsewhere: test-index-xirr.js owns the index
// simulation, test-xirr-terminal-scope.js the flows-and-terminal pairing,
// test-twr-unpriced-leg.js the CAGR/rolling series. What is left, and what this
// file is for, is the card itself: what it puts on screen and what it caches.

"use strict";
const fs = require("fs");
const path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
const HTML = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log("  PASS  " + label); }
  else { fail++; console.log("  FAIL  " + label + (extra !== undefined ? "  (got " + extra + ")" : "")); }
}

console.log("A. A Rolling Alpha of exactly zero renders, rather than throwing");
{
  // classList.add("") raises InvalidCharacterError. The ternary below fed it the
  // empty string on the alpha === 0 branch, and the throw was caught by the
  // render's own .catch(), which resets the summary — so a portfolio whose
  // rolling median exactly matched the index's blanked ALL THREE rolling cells
  // instead of showing a legitimate 0.0%.
  const from = SRC.indexOf("function setSummary(portMedian, idxMedian, notAvailable)");
  ok(from !== -1, "A1 setSummary is where the rolling cells are written");
  const body = SRC.slice(from, SRC.indexOf("\n    }", from));
  ok(!/classList\.add\([^;]*:\s*""\s*\)/.test(body),
     "A2 no branch can pass an empty token to classList.add");
  ok(/if \(alpha > 0\) sumAlphaEl\.classList\.add\("positive"\);/.test(body) &&
     /else if \(alpha < 0\) sumAlphaEl\.classList\.add\("negative"\);/.test(body),
     "A3 the sign classes are applied by branches that only ever add a real token");
  // renderResult does the same job for the XIRR/CAGR row and has always been
  // safe, via className assignment. Pinned so the two cannot diverge again.
  ok(/alphaEl\.className = "benchmark-col-value " \+/.test(SRC),
     "A4 the row above it still assigns className, which has no empty-token trap");
}

console.log("\nB. The card's memos cannot outlive the data they were built from");
{
  const from = SRC.indexOf("function _benchMemoKey(selected)");
  ok(from !== -1, "B1 there is one key for the card's memos");
  const body = SRC.slice(from, SRC.indexOf("\n  }", from));
  ok(/selected/.test(body), "B2 keyed by the selected portfolio");
  ok(/isEquityExcluded\(\)/.test(body) && /isFixedIncomeExcluded\(\)/.test(body),
     "B3 and by the exclusion in force");
  // Prices refresh on their own cadence. Without their stamp the memo would serve
  // a series built before a refresh until the next sheet write — the value
  // chart's own _inputKey has carried this for the same reason.
  ok(/getCachedStockPrices\(\)/.test(body) && /sp\.updated/.test(body),
     "B4 and by the price payload's stamp, so a price refresh retires it");
  // Sheets are the other input, and they change without touching either key.
  ok(/_clearBenchmarkMemos\(\);/.test(SRC.slice(SRC.indexOf("function _invalidateSheetRows"),
                                                SRC.indexOf("function _invalidateSheetRows") + 700)),
     "B5 a sheet write clears them outright");
  // A rejected promise must never be cached: one transient failure would stick
  // for the session and the card could not recover without a reload.
  const memo = SRC.slice(SRC.indexOf("function _benchMemoized"));
  ok(/promise\.catch\(function \(\) \{/.test(memo.slice(0, memo.indexOf("\n  }"))),
     "B6 and a rejection is dropped rather than remembered");
}

console.log("\nC. The benchmark dropdown reports its state to assistive tech");
{
  // role="option" inside role="listbox": selected state is what the role is FOR,
  // and a CSS class conveys none of it. The exclusions menu beside it already
  // carried aria-selected; this one had only the class.
  const menu = HTML.slice(HTML.indexOf('id="benchmark-menu"'), HTML.indexOf("</ul>", HTML.indexOf('id="benchmark-menu"')));
  const options = menu.match(/<li role="option"/g) || [];
  const withAria = menu.match(/<li role="option" aria-selected=/g) || [];
  ok(options.length === 4, "C1 the four indexes are listed as options", options.length);
  ok(withAria.length === options.length,
     "C2 every one of them carries aria-selected", withAria.length + "/" + options.length);
  ok(/o\.setAttribute\("aria-selected", on \? "true" : "false"\);/.test(SRC),
     "C3 and applyBenchmark keeps it in step with the class");
}

console.log("\nD. A period that cannot be measured falls back on BOTH legs");
{
  // No opening mark at the cutoff means the requested window is unmeasurable —
  // the portfolio did not exist then, or nothing it held can be priced that far
  // back. Reporting all-time is right; reporting all-time for the PORTFOLIO while
  // leaving the INDEX on flows filtered to the period was not. The two legs were
  // measured over different windows and the alpha subtracted them anyway.
  const from = SRC.indexOf("function computeBenchmarkXirr(indexKey, periodYears)");
  ok(from !== -1, "D1 computeBenchmarkXirr is where the period window is chosen");
  const body = SRC.slice(from, SRC.indexOf("\n  // Builds a synthetic", from));

  ok(!/if \(!startVal \|\| startVal <= 0\) return \{ xirr: allTimePortfolioXirr, indexFlows: allFlowsForIndex \};/.test(body),
     "D2 the mismatched fallback is gone");
  ok(/if \(!startVal \|\| startVal <= 0\) \{\s*return \{ xirr: allTimePortfolioXirr, indexFlows: allFlows, fellBack: true \};/.test(body),
     "D3 a missing opening mark sends BOTH legs to all-time");
  // The solver giving up on the period window is the same situation.
  ok(/if \(periodXirr == null \|\| !isFinite\(periodXirr\)\) \{\s*return \{ xirr: allTimePortfolioXirr, indexFlows: allFlows, fellBack: true \};/.test(body),
     "D4 and so does a period XIRR that will not converge");
  // The old code hid a non-converging period behind `|| allTimePortfolioXirr`,
  // which kept the index on the period flows.
  ok(!/calculateXIRR\(portFlows\) \|\| allTimePortfolioXirr/.test(body),
     "D5 the inline || fallback that kept the index on period flows is gone");

  ok(/function measuredYears\(fellBack\)/.test(body),
     "D6 the window actually measured is computed, not assumed from the pill");
  ok(/years: years/.test(body),
     "D7 and returned with the result");
}

console.log("\nE. Both modes name the window they actually measured");
{
  // CAGR disclosed a shortened window; XIRR, which shortens for its own reason,
  // said nothing — so the two modes disagreed about honesty on the same card.
  const from = SRC.indexOf("function renderResult(mode, xirrResult, cagrResult)");
  const body = SRC.slice(from, SRC.indexOf("\n    }", SRC.indexOf("subtitleEl.textContent", from)));
  ok(!/if \(subtitleEl && mode === "cagr"\)/.test(body),
     "E1 the disclosure is no longer gated on CAGR mode");
  ok(/var result = mode === "cagr" \? cagrResult : xirrResult;/.test(body),
     "E2 it reads the window from whichever result is on screen");
  ok(/actualYears < reqYears \* 0\.95/.test(body),
     "E3 and fires when the measured window is materially shorter than the pill");
  ok(/the portfolio's full history, shorter than the/.test(body),
     "E4 saying so in words, beside the figure it qualifies");
}

console.log("\nF. A failed index-history fetch does not stick for the session");
{
  // The card's index leg comes from stock_prices.json. One transient miss on
  // load used to store `{}` in the module-level cache, and every later run — the
  // flows-ready refresh, an index click, a period pill, a portfolio change — was
  // served that empty object. The index column read "No data — trigger Fetch
  // Stock Prices" and the alpha an em-dash, permanently, until a full reload.
  const from = SRC.indexOf("function fetchIndexHistory()");
  ok(from !== -1, "F1 fetchIndexHistory is where the series are cached");
  const body = SRC.slice(from, SRC.indexOf("\n  }", from));
  ok(!/catch\(function \(\) \{\s*_indexHistoryCache = \{\};/.test(body),
     "F2 a rejection is no longer remembered as an empty history");
  ok(/catch\(function \(\) \{\s*return \{\};/.test(body),
     "F3 it degrades to no index for this call only");
  ok(/if \(Object\.keys\(hist\)\.length\) _indexHistoryCache = hist;/.test(body),
     "F4 and an empty payload is not cached either, so the next call retries");
}

console.log("\nG. Portfolio navigation re-measures the Stocks/ETF leg");
{
  // Selecting a portfolio clears _ovFlows.seFlowsINR and starts a fresh SE
  // render, so the wf-overview-flows-ready refresh that follows measures the
  // benchmark with NO Stocks/ETF flows for the new portfolio. The old guard was
  // a boolean — "has the card ever seen SE flows?" — still true from the
  // PREVIOUS portfolio, so the wf-se-xirr-ready handler returned early and the
  // card kept a portfolio XIRR (and alpha) with the whole Stocks/ETF book
  // missing until a reload.
  const from = SRC.indexOf("function initBenchmarkCard()");
  const body = SRC.slice(from, SRC.indexOf("\n  function buildCommodityHoldingsList", from));
  ok(!/_lastBenchmarkHadSe/.test(body), "G1 the ever-seen-SE boolean is gone");
  ok(/function _seFlowsKey\(\)/.test(body) &&
     /_ovFlows\.seComputedPortfolio\) \+ "\|" \+/.test(body),
     "G2 replaced by a key naming WHICH portfolio's flows were measured");
  // The re-run goes through the coalescing scheduler now (see H), but the
  // ordering this guards is unchanged: the key naming the leg being measured is
  // recorded BEFORE the run is requested, so the SE-ready handler below can tell
  // "already measured" from "not measured yet".
  ok(/_lastBenchmarkSeKey = _seFlowsKey\(\);\s*\n\s*_?(?:schedule|apply)Benchmark\(currentKey\);/i.test(body),
     "G3 recorded on the flows-ready refresh");
  const se = body.slice(body.indexOf('addEventListener("wf-se-xirr-ready"'));
  ok(/if \(seKey === _lastBenchmarkSeKey\) return;/.test(se),
     "G4 and the SE-ready re-run is skipped only when the leg is unchanged");
  ok(/_lastBenchmarkSeKey = seKey;\s*\n\s*_?(?:schedule|apply)Benchmark\(currentKey\);/i.test(se),
     "G5 otherwise the card re-runs against the leg that just landed");

  console.log("\nH. The card computes once per load, not three times");
  // Init, wf-overview-flows-ready and wf-se-xirr-ready each used to drive a full
  // applyBenchmark. The first two run before the Stocks/ETF leg resolves, so they
  // measure a portfolio missing its entire stock book and are replaced a few
  // hundred ms later — three passes over the sheets to show the third one.
  ok(/function _scheduleBenchmark\(key\)/.test(body),
     "H1 there is a scheduler between the readiness events and the compute");
  ok(/clearTimeout\(_benchSchedule\)/.test(body),
     "H2 a second trigger cancels the pending run rather than adding to it");
  const initTail = body.slice(body.indexOf("// Restore saved mode, period and selection"));
  ok(!/^\s*if \(savedKey\) applyBenchmark\(savedKey\);/m.test(initTail),
     "H3 init no longer computes against a Stocks/ETF leg that has not landed");
  ok(/statusEl\.textContent = "Calculating…"/.test(initTail),
     "H4 it parks the card on Calculating instead");
  ok(/_benchmarkInitialRefreshDone \|\| _benchSchedule\) return;/.test(initTail),
     "H5 with a fallback run for a book that fires neither readiness event");
  // The user-driven paths must stay immediate — a 200ms debounce on a click reads
  // as lag, and the generation guard inside applyBenchmark already covers overlap.
  const pills = body.slice(body.indexOf("// Period pill buttons"), body.indexOf("// \u2500\u2500\u2500 One compute per load"));
  ok(/applyBenchmark\(currentKey\);/.test(pills) && !/_scheduleBenchmark/.test(pills),
     "H6 the period pills still recompute immediately");
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
