# Tests

Plain Node, no dependencies. **Run everything with one command:**

    node tests/run-all.js

That runs the repo guards (syntax checks, asset-version placeholder check) and
every `tests/test-*.js` suite, and exits non-zero if anything fails. New suites
are discovered automatically — drop in a `test-*.js` and it is included. CI runs
this on every push and pull request (`.github/workflows/ci.yml`).

Individual suites can still be run directly:

    node tests/test-math.js               # pure financial kernels (wf-math.js)
    node tests/test-overview-aggregate.js # Overview aggregation (wf-overview.js)
    node tests/test-sheet-pipeline.js     # sheet fetch/merge pipeline
    node tests/test-supabase-sync.js      # settings/config sync (supabase-client.js)
    node tests/perf-hotpaths.js           # timing benchmark, not a pass/fail suite

## What's covered

**test-math.js** — XIRR (validated against an independent NPV computation, so a
correct rate is proven convention-independently), FIFO lot consumption, and the
shared day-count convention.

**test-overview-aggregate.js** — the Overview aggregation invariants. These exist
because a family of shipped bugs all came from the same cause: the Overview total
was stitched together from independent async flows, so a component could be
dropped, zeroed, or read at a different moment than its neighbours. The tests pin
the properties that make that impossible:

  * day change is the sum of *every* present asset class, and fixed income
    (which has no intraday mark) contributes none;
  * an unresolved slice omits only its own contribution — it cannot zero others;
  * aggregation is order-independent, whatever sequence the flows finish in;
  * a class still loading is valued at cost, so a cold load reads 0% P&L rather
    than a phantom total loss;
  * the fixed-income exclusion toggle gates fixed income and commodity together;
  * a partial patch (e.g. a day-change-only write) never clears fields it
    doesn't mention — this is the "18K reverts to 9K" regression, stated directly.

**test-sheet-pipeline.js** — sheet fetch/merge: URL parsing, gviz row conversion,
header keyword matching and realignment (including the wrong-header-row failure
mode), multi-sheet merge with partial failures, CSV parsing, config loading.

**test-supabase-sync.js** — resilient settings upsert (unknown-column retry), the
PAT never being uploaded and being cleared on sign-out, and cloud config pull.

## Guards

`run-all.js` also enforces repo hygiene that isn't assertion-style testing:

  * `node --check` on every shipped JS file;
  * `tools/stamp-assets.js --check` — every versioned `?v=` reference must use
    the `__ASSET_VERSION__` placeholder rather than a hardcoded tag. Asset
    versions are stamped with the commit SHA at deploy time. This guard exists
    because hand-bumped tags had already drifted: `index.html` was serving
    `script.js?v=budgetacct` while `dashboard.html` had moved to `?v=ovstore4`,
    so the same file was cached under two keys and landing pages served stale code.

## e2e-regression.js

An end-to-end sweep in a real browser: seeds every sheet plus expense data, walks
all tabs, exercises every pill on all six holdings cards, and fails on any page
error, any NaN/undefined reaching the screen, or a control that does not respond.

It is NOT picked up by `run-all.js` (that discovers `test-*.js`) because it needs a
static server and Playwright's Chromium, neither of which CI here has. Run it by
hand after UI changes:

    node tools/serve.js &          # or any static server on :8098
    node tests/e2e-regression.js

## e2e-growth.js

The GROWTH OF ₹100 chart, end to end, against hand-computable data — NAV history,
stock history, FX and AMFI resolution are all stubbed, so the expected figures are
worked out by hand rather than by re-running the shipped formula. Same reason it is
not in `run-all.js`: needs a static server and Playwright's Chromium.

    node tools/serve.js &
    node tests/e2e-growth.js

Three defects in that chart were invisible to unit tests, because each lived in how
the series was ASSEMBLED rather than in any function: a period return that let
contributions dilute the line, contributions drawn from instruments the value series
cannot price, and US flows counted in dollars against rupee values. The recurrence
itself now lives in `WfMath.twrNavSeries` and is unit-tested by `test-twr-nav.js`;
this suite covers the assembly around it.

Every scenario also cross-checks the chart against the CAGR card, which runs a
SECOND, separately written TWR over the same portfolio at a different sampling
frequency. Compounding its rate over its own window must land on the chart's final
NAV. Two independent implementations agreeing is stronger evidence than either one
matching an expectation written next to it.

## e2e-xirr.js

Portfolio XIRR end to end, checked against an XIRR written in the test from the
definition — not by calling the shipped solver, so the two are genuinely
independent. Same reason it is not in `run-all.js`.

    node tests/e2e-xirr.js

The fixture is built so a wrong answer is unmistakable: ₹1,000 into a fund that
doubles and ₹10,000 into a stock that halves, both fully sold. Counting both gives
−59.63%; dropping the stock gives +301.91%. The app reported +301.91%, because the
stocks/ETF flows were gathered from the OPEN holdings and a fully-sold position
contributed neither its cost nor its proceeds — while mutual funds had no such
filter, so the two asset classes did not agree on what the number meant.

## check-chart-subtitle-align.js / measure-subtitle-align.js

The period line under each chart title ("SINCE 2018", "OVER TIME") must sit flush
with the title. It did not: the card already pads 20px and the subtitle rule added
its own horizontal margin on top, indenting the period 20px past the title it
belongs to, with an 11px gap above it.

`check-chart-subtitle-align.js` is in `run-all.js` and pins the CSS rule.
`measure-subtitle-align.js` measures the real geometry in a browser — it builds its
fixture out of dashboard.html's own markup, so it cannot drift from what it checks:

    node tests/measure-subtitle-align.js

Measured before → after: dx 20px → 0, gap 10.9px → 2.9px.

## e2e-account-value-zoom.js

Also covers the hover readout: both value charts have their floating tooltip off
and report the hovered point in the card header instead, the way CASH FLOW ·
MONTHLY keeps its figures in a stats row. Ten mutants fail it — each tooltip
re-enabled, each chart's hover made a no-op, the index read at the wrong date,
each chart's mouseleave failing to restore, and the hover ignoring its index.

The ACCOUNT VALUE · OVER TIME range pills and the zoom-following readout.

    node tests/e2e-account-value-zoom.js
    PVC_SHORT=1 node tests/e2e-account-value-zoom.js   # short-history variant

The NAV compounds at a fixed 0.16%/day, so each window's expected change is
`1.0016^days − 1` and is checked as arithmetic rather than taken from the app. The
interior-window case (C11–C13) is the one that matters: every range pill ends at the
last point, so only a window that does NOT end at today can tell a window-aware
readout from one that merely prints the final value.

Chart.js and its zoom plugin cannot load in the sandbox (no CDN), so the suite
models an x scale with min/max plus zoomScale/resetZoom. It covers the wiring and
the arithmetic, NOT the plugin's own wheel and pinch gestures.

## More on e2e-regression.js

It also caught the transactions drill-down hanging the page on a month where a
fixed deposit matured: the modal waited on that month's slice of the realized-P&L
data instead of on the data itself, and since a maturity carries no unit price the
slice was never filled, so the modal re-opened itself forever. That is a live
event loop, not a pure function — no unit suite can see it.

It found the login-modal guard bug that every unit suite missed: script.js runs on
all three pages, and a block guarded on one element while dereferencing a sibling
threw on index.html, killing every top-level statement below it.
