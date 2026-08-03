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

The Portfolio Performance chart (Growth of ₹100), end to end, against hand-computable data — NAV history,
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

## check-branding.js

The product is Kosha and the monogram is drawn from one source. A rename is the
kind of change that half-lands — the header says one thing, the tab title
another, the installed PWA a third — so every user-visible place the name appears
is listed: page titles, the manifest name and short_name, and the iOS
home-screen title.

The mark is pinned the same way. `icons/kosha-mark.svg` is the source of truth
for the geometry and `tools/make-icons.js` renders every PNG from it, so the
inline copies in the page headers must carry the same three strokes — otherwise
the favicon and the header show different logos. Regenerate the PNGs with:

    node tools/make-icons.js

Five mutants fail it: the old name back in a title, a wrong manifest short_name,
a header mark that has drifted from the SVG, a missing icon file, and a changed
stroke in the source SVG.

## check-tablet-breakpoint.js / measure-tablet-layout.js

Between the phone breakpoint at 760px and the width the desktop layout needs, the
Overview stats row and the Benchmark card were single nowrap flex rows whose items
could shrink below the width of their own text. Values were drawn over each other
("₹58,41,173" landing on "₹72,69,941") and every Benchmark label ellipsised down to
"Portfolio Rolling…", which no longer names its column.

`measure-tablet-layout.js` measures it in a browser at ten widths — text spill
(scrollWidth > clientWidth) and overlapping TEXT rectangles, using Range boxes so
it is the ink that is checked rather than the padding:

    python3 -m http.server 8098 &
    node tests/measure-tablet-layout.js

Before the fix: overlaps and clipping at 768, 810, 834 and 1024; nothing at 480,
760, 1080 or above. After: clean at all ten.

`measure-tablet-expense.js` does the same for the Expense tab, where BREAKDOWN
and SETTLEMENT share the same two-column grid: on tablet the spend table
overflowed its card by up to 141px (cut off mid-figure) and the two settlement
person cards were squeezed to ~145px each, wrapping "TRANSFER AMOUNT" onto two
lines. Note the route order in it — Playwright matches the most recently
registered route first, so the supabase catch-all has to be registered BEFORE the
per-table routes or the expense tab loads with no data and the whole file
measures nothing.

`check-tablet-breakpoint.js` is in run-all.js and pins the SCOPE, which the
measurement cannot: widen the band to cover phones and desktop and the browser
measurement still passes at every width — the grid layout does not overlap
anywhere, it is simply wrong for those form factors. Six mutants fail the guard.

## e2e-nav-cache.js

Mutual fund NAV history is immutable — a NAV published in 2019 is still that
number — so it is cached in IndexedDB with no clock expiry, and the daily tail
comes from amfi_nav.json, which is downloaded anyway.

    python3 -m http.server 8098 &
    node tests/e2e-nav-cache.js

The risk is the mirror image of the saving: a series that never refreshes, so a
correction from AMFI is never picked up. So the suite is about the ways a series
must still be refetched — a NAV restated for a date already held, and a cache
older than the 30-day backstop — plus the fact that a plain refresh fetches
nothing and that the legacy localStorage entries are swept.

Two fixture traps worth knowing, both of which produced confidently wrong runs
before being found. The two sources do NOT share a date format: mfapi.in is
numeric ("01-12-2024"), amfi_nav is a month name ("01-Dec-2024"). Getting it
wrong is silent — parseMfApiDate builds an Invalid Date, the entry survives the
truthiness filter, and the series caches with unusable dates. And the AMFI stub
must quote the EXACT nav mfapi served for the same date, or the app correctly
reads the difference as a restatement and refetches everything.

## e2e-value-chart-refresh.js

The value charts skip a render whose inputs match the last completed one. That
saves real work — a refresh built each chart four times and three of those were
byte-identical — but it introduces exactly one new way to be wrong: a chart that
stops updating when something DID change.

    python3 -m http.server 8098 &
    node tests/e2e-value-chart-refresh.js

So the suite does not check that the skip happens. It checks that every input the
key claims to cover forces a redraw, and that the redraw lands on the right
numbers. The fixture's two portfolios are structurally identical — same
instrument, same dates, same row counts, same fixed income — and differ only in
units held, so every derived length in the key is equal between them and only the
portfolio name can tell them apart.

Note on mutants: dropping a single term from the key does NOT fail this suite,
and that is not a gap. The portfolio name and the Overview total both vary when
the portfolio changes, so each covers the other. What does fail is a skip that
ignores the key entirely (4 assertions) — which is the failure that matters.

## e2e-integration-smoke.js

Every other suite runs on a small isolated fixture. This one runs the whole
dashboard on ONE realistic portfolio — several funds, Indian and US stocks, a
closed position, an FD, a savings account, an investment corpus, EPF and physical
gold — and checks the features do not break each other: both value charts, their
hover readouts, all three CASH FLOW · MONTHLY modes and the switches between
them, the idle-cash legend, and the year / All time controls, with zero page
errors throughout.

    python3 -m http.server 8098 &
    node tests/e2e-integration-smoke.js

Two things it exists to catch that nothing else does. Physical gold alone pulls
in ~90 gold-price requests that gate BOTH value charts, so a portfolio holding it
is the one most likely to render nothing — those endpoints must be stubbed.
And every trade is priced at whatever the stubbed price series quotes on that
date: with trades at prices the series never had, TWR and XIRR diverge for
reasons that are the fixture's fault rather than the app's.

Note the comment above V7c: Growth-of-₹100 and the XIRR cards can legitimately
disagree about whether the portfolio beat the index, because the Growth chart
excludes fixed income and the XIRR cards do not.

## e2e-mic-idle-cash.js

CASH FLOW · MONTHLY's "Idle Cash" view must read out a hovered month the way Net
and By instrument do — in the panel under the stats row, not a floating tooltip —
and its legend must be selectable the same way. The test measures the flow view
FIRST and asserts Idle Cash matches it, so "the same as" is checked against the
other modes rather than against a remembered description.

    python3 -m http.server 8098 &
    node tests/e2e-mic-idle-cash.js

Nine mutants fail it: the tooltip re-enabled, the hover made a no-op, mouseleave
not restoring, the legend markup made inert, the filter ignored by the datasets
or by the stats, the palette indexed off the filtered list, and the selection not
reset on a mode switch.

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
