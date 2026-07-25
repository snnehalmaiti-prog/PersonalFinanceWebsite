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
