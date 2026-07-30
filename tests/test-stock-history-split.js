// Splitting the per-ticker OHLC history out of stock_prices.json.
//
// stock_history was ~90% of stock_prices.json (2.0 MB of 2.25 MB; 595 KB of the
// 662 KB gzipped) and only the value chart, the TWR series and the rolling-return
// analytics read it. It now lives in stock_history.json, fetched lazily. Measured
// at 4x CPU / 4 Mbps that takes 1494 ms off the load path.
//
// The risk this suite covers: a deploy where the two files disagree. A cached or
// older stock_prices.json still carrying stock_history inline must be used as-is
// (no second request, no empty charts), and a failed history fetch must degrade to
// "no history" rather than rejecting and killing the chart.

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");

function extract(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error("marker not found: " + marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

// ── scope: stub the two things fetchAllStockPricesWithHistory depends on ────
let pricesPayload, historyResult, historyCalls;
function fetchAllStockPrices() { return Promise.resolve(pricesPayload); }
function _getStaticStockHistory() { historyCalls++; return historyResult; }
eval(extract("function fetchAllStockPricesWithHistory()"));

function reset(prices, hist) {
  pricesPayload = prices;
  historyResult = hist;
  historyCalls = 0;
}

(async function () {
  console.log("A. The split files are combined for the chart paths");
  {
    reset({ prices: { A: 1 }, usd_inr_history: { x: 1 }, updated: "t" },
          Promise.resolve({ AAPL: { prices: { "2026-01-01": 10 } } }));
    const out = await fetchAllStockPricesWithHistory();
    ok(historyCalls === 1, "A1 the history file is fetched", historyCalls);
    ok(out.stock_history.AAPL.prices["2026-01-01"] === 10, "A2 history is attached under the key callers read");
    ok(out.prices.A === 1 && out.usd_inr_history.x === 1 && out.updated === "t",
       "A3 every other field from stock_prices.json survives");
  }

  console.log("\nB. It does not mutate the cached prices object");
  {
    const cached = { prices: { A: 1 } };
    reset(cached, Promise.resolve({ AAPL: {} }));
    const out = await fetchAllStockPricesWithHistory();
    ok(cached.stock_history === undefined,
       "B1 the shared cached object is left alone — a later prices-only reader must not see history bolted on");
    ok(out !== cached, "B2 a copy is returned");
  }

  console.log("\nC. A build that still has history inline is used as-is");
  {
    // The window between deploying this code and the Action regenerating the files,
    // or a warm 30-minute cache of the old payload.
    reset({ prices: {}, stock_history: { OLD: { prices: { "2025-01-01": 5 } } } },
          Promise.resolve({ NEW: {} }));
    const out = await fetchAllStockPricesWithHistory();
    ok(historyCalls === 0, "C1 no second request is made", historyCalls);
    ok(out.stock_history.OLD.prices["2025-01-01"] === 5, "C2 the inline history is what the charts get");
  }
  {
    // An empty stock_history key must NOT count as inline history, or the charts
    // would silently render nothing forever.
    reset({ prices: {}, stock_history: {} }, Promise.resolve({ NEW: { prices: {} } }));
    const out = await fetchAllStockPricesWithHistory();
    ok(historyCalls === 1, "C3 an empty inline history still triggers the fetch", historyCalls);
    ok(out.stock_history.NEW !== undefined, "C4 and the fetched history wins");
  }

  console.log("\nD. A missing or broken history file degrades, it does not throw");
  {
    reset({ prices: { A: 1 } }, Promise.reject(new Error("404")));
    let threw = false, out = null;
    try { out = await fetchAllStockPricesWithHistory(); } catch (e) { threw = true; }
    ok(!threw, "D1 a 404 on stock_history.json does not reject the caller");
    ok(out && out.prices.A === 1, "D2 prices still come through, so holdings and totals are unaffected");
    ok(out && typeof out.stock_history === "object" && !Object.keys(out.stock_history).length,
       "D3 history is an empty object — the chart draws nothing rather than crashing", out && out.stock_history);
  }

  console.log("\nE. The generator and the repo agree");
  {
    const py = fs.readFileSync(path.join(ROOT, "fetch_stock_prices.py"), "utf8");
    ok(/HISTORY_FILE\s*=/.test(py), "E1 the generator defines a history output file");
    ok(/json\.dump\(\{"updated": updated, "stock_history": stock_history\}/.test(py),
       "E2 and writes the history to it");
    const outputBlock = py.slice(py.indexOf("output = {"), py.indexOf("with open(OUTPUT_FILE"));
    ok(outputBlock.indexOf('"stock_history"') === -1,
       "E3 stock_prices.json no longer carries the history — otherwise the split saves nothing");
    const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/fetch_stock_prices.yml"), "utf8");
    ok(/git add .*stock_history\.json/.test(wf),
       "E4 the workflow commits the new file, or it never reaches the site");

    // The shipped JSON must match: a stock_prices.json with history still inline
    // would mean the repo was regenerated by an old script.
    const sp = JSON.parse(fs.readFileSync(path.join(ROOT, "stock_prices.json"), "utf8"));
    ok(sp.stock_history === undefined, "E5 the committed stock_prices.json has no history key");
    ok(sp.prices && Object.keys(sp.prices).length > 0, "E6 and still has prices");
    const sh = JSON.parse(fs.readFileSync(path.join(ROOT, "stock_history.json"), "utf8"));
    ok(sh.stock_history && Object.keys(sh.stock_history).length > 0,
       "E7 the committed stock_history.json has the series");

    // Every real ticker with a price should have a history series, so no chart
    // silently loses a holding in the split. __USD_INR__ is a synthetic entry whose
    // series is usd_inr_history, which stays in stock_prices.json.
    const missing = Object.keys(sp.prices)
      .filter(function (t) { return t.indexOf("__") !== 0; })
      .filter(function (t) { return !sh.stock_history[t]; });
    ok(missing.length === 0, "E8 no priced ticker lost its history series", missing.slice(0, 5));

    // And the point of the exercise: the load-path file must actually be small.
    const spKb = fs.statSync(path.join(ROOT, "stock_prices.json")).size / 1024;
    ok(spKb < 400, "E9 stock_prices.json is under 400 KB raw (was 2251)", Math.round(spKb));
  }

  console.log("\nF. Only the chart paths pay for the history");
  {
    // If a load-path caller reached for the history accessor, the split would be
    // undone silently. Exactly the four chart/analytics sites may use it.
    const uses = (SRC.match(/fetchAllStockPricesWithHistory\(\)/g) || []).length;
    ok(uses === 5, "F1 one definition plus four chart call sites", uses);
    ok(/function _getStaticStockHistory\(\)/.test(SRC), "F2 the lazy fetch exists");
    // It must never be called during the eager price path.
    const eager = SRC.slice(SRC.indexOf("function fetchAllStockPrices()"),
                            SRC.indexOf("function fetchAllStockPrices()") + 2000);
    ok(eager.indexOf("_getStaticStockHistory") === -1,
       "F3 fetchAllStockPrices does not touch the history file");
  }

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
