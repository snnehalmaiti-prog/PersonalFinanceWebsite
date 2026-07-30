#!/usr/bin/env node
// Guard: the four holdings tables' Open/Closed controls.
//
// Each used to be a single button whose label flipped between "Open" and
// "Closed" — ambiguous, since the label could read as the current state or as
// the action. They are now segmented pills with both options visible. Verified in
// Chromium (each starts on Open, moves to Closed and back, the four stay
// independent, and the legacy checkboxes the render path still reads follow the
// pill); this keeps the wiring from regressing.
"use strict";

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "dashboard.html"), "utf8");
const SRC = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");

let failed = 0;
function check(cond, msg) { if (!cond) { console.error("  FAIL " + msg); failed++; } }

const TOGGLES = [
  { id: "mfh-open-toggle", attr: "data-mfh-open", label: "Mutual Fund Holding" },
  { id: "seh-open-toggle", attr: "data-seh-open", label: "India holdings" },
  { id: "seh-us-open-toggle", attr: "data-seh-open", label: "US holdings" },
  { id: "dbth-open-toggle", attr: "data-dbth-open", label: "Debt ETF/Mutual Fund Holding" },
  { id: "fih-open-closed", attr: "data-fih-oc", label: "Fixed Income Holding" },
  { id: "cmh-open-closed", attr: "data-cmh-oc", label: "Commodity Holding" },
];

// Every header puts the portfolio pills first and the Open/Closed pill last, so
// the two controls line up the same way on every card.
["fih-card", "cmh-card", "mfh-card", "dbth-card"].forEach(function (cardId) {
  const at = HTML.indexOf('id="' + cardId + '"');
  if (at === -1) { console.error("  FAIL " + cardId + " is missing"); failed++; return; }
  const right = HTML.slice(HTML.indexOf("mfh-header-right", at), HTML.indexOf("mfh-header-right", at) + 900);
  const pf = right.indexOf("portfolio-toggle");
  const oc = right.search(/isc-toggle/);
  if (pf === -1 || oc === -1) { console.error("  FAIL " + cardId + ": header is missing one of the two controls"); failed++; return; }
  if (pf > oc) { console.error("  FAIL " + cardId + ": Open/Closed comes before the portfolio pills — headers must line up"); failed++; }
});

TOGGLES.forEach(function (t) {
  const at = HTML.indexOf('id="' + t.id + '"');
  check(at !== -1, t.label + ": the toggle container is missing");
  if (at === -1) return;
  const block = HTML.slice(at, at + 600);
  check(block.indexOf("isc-toggle") !== -1,
    t.label + ": must use the segmented .isc-toggle pill, not a single flipping button");
  check(block.indexOf(t.attr + '="open"') !== -1 && block.indexOf(t.attr + '="closed"') !== -1,
    t.label + ": both Open and Closed segments must be present");
  check(block.indexOf("isc-toggle-btn active") !== -1,
    t.label + ": one segment must start active, or the pill renders with no state");
  check(/class="mfh-btn"[^>]*id="/.test(block) === false,
    t.label + ": the old single-button markup is back");
});

// The shared painter must know every attribute, or a pill silently stops
// highlighting while still changing the data.
const painter = SRC.slice(SRC.indexOf("function _setOpenClosedPill"),
                          SRC.indexOf("function _setOpenClosedPill") + 700);
check(painter.length > 0, "_setOpenClosedPill is missing");
["data-mfh-open", "data-seh-open", "data-dbth-open", "data-fih-oc", "data-cmh-oc"].forEach(function (a) {
  check(painter.indexOf(a) !== -1, "_setOpenClosedPill does not recognise " + a);
});
check(painter.indexOf("aria-pressed") !== -1,
  "the segments must set aria-pressed — state conveyed by colour alone is not accessible");

// Each pill must paint its initial state at wire-up, otherwise the markup's
// hardcoded `active` can disagree with the real state after a reload.
["MFH_STATE.showClosed", "DBTH_STATE.showClosed"].forEach(function (state) {
  check(new RegExp("_setOpenClosedPill\\([^)]*,\\s*" + state.replace(".", "\\.")).test(SRC),
    "the initial pill state is not painted from " + state);
});
check(/_setOpenClosedPill\(box, SEH_STATE\.showClosed\[spec\.region\]\)/.test(SRC),
  "the Stocks/ETF pills do not paint their initial state");

// Clicking the segment that is already active must not re-render.
check((SRC.match(/if \(wantClosed === !!/g) || []).length >= 3,
  "clicking the active segment should be a no-op, not a repaint");

// Either segment must disable itself when its side is empty — symmetrically.
check(/b\.disabled = !has && !neither/.test(SRC),
  "a segment with nothing behind it is never disabled — an enabled control leading to an empty list reads as a bug");
check(/var neither = hasClosed === false && hasOpen === false/.test(SRC),
  "with BOTH sides empty the pill should stay enabled rather than lock out entirely");
check(/No closed positions/.test(SRC) && /No open positions/.test(SRC),
  "both disabled segments need a tooltip saying why");
check(/if \(state\.showClosed && !hasClosed && hasOpen\) state\.showClosed = false/.test(SRC) &&
      /else if \(!state\.showClosed && !hasOpen && hasClosed\) state\.showClosed = true/.test(SRC),
  "the shared renderer must land on whichever side has something");
check(/if \(regionShowClosed && !hasClosed && hasOpen\)/.test(SRC) &&
      /else if \(!regionShowClosed && !hasOpen && hasClosed\)/.test(SRC),
  "the Stocks/ETF regions need the same two-way fallback");
// Every holdings table builds ALL portfolios and BOTH sides once, then filters in
// the renderer — the shape Fixed Income Holding always had. Baking the pills into
// the build makes each click wait on the network and leaves the row set holding
// only one side, which is what forced the old __mfAnyClosed special case.
const mfBuild = SRC.slice(SRC.indexOf("function renderEquityHoldingsTable"),
                          SRC.indexOf("function renderEquityHoldingsTable") + 1500);
check(/var selectedPortfolio = "all";/.test(mfBuild) &&
      mfBuild.indexOf("__mfHoldingsPortfolioOverride") === -1,
  "the Mutual Fund build must not be scoped to the portfolio pill");
check(!/window\.__mfAnyClosed/.test(SRC),
  "the __mfAnyClosed workaround should be gone once the rows carry both sides");
check(/var _allRows = _buildEquityRowsPerPortfolio\(rows, _navByInst, function \(\) \{ return true; \}\)/.test(SRC),
  "Mutual Fund rows must be built for every portfolio and both sides");
check(/var scoped = \(state\.portfolio && state\.portfolio !== "all"\)/.test(SRC),
  "the renderer must apply the portfolio filter itself");
check(/var hasClosed = scoped\.some/.test(SRC) && /var hasOpen = scoped\.some/.test(SRC),
  "Open/Closed availability must be answered AFTER the portfolio filter, so it reflects what is on screen");
// The point of the exercise: filtering must not re-run the pipeline.
const mfPill = SRC.slice(SRC.indexOf('closest("[data-mfh-portfolio]")'), SRC.indexOf('closest("[data-mfh-portfolio]")') + 500);
check(mfPill.indexOf("renderEquityHoldingsTable") === -1,
  "the Mutual Fund portfolio pill must filter the built rows, not re-run the pipeline (and its NAV fetches)");
const mfOc = SRC.slice(SRC.indexOf('closest("[data-mfh-open]")'), SRC.indexOf('closest("[data-mfh-open]")') + 600);
check(mfOc.indexOf("renderEquityHoldingsTable") === -1,
  "the Mutual Fund Open/Closed pill must filter the built rows, not re-run the pipeline");
// Stocks/ETF only builds the closed set once the user has asked for it, so the
// answer has to come from the sheet instead.
check(/function _seOpenClosedAvailability\(region, portfolioFilter\)/.test(SRC),
  "Stocks/ETF must answer availability from the transaction sheet, not from priced rows");
check(/var avail = _seOpenClosedAvailability\(region, regionPortfolio\)/.test(SRC),
  "...and the renderer must use it, scoped to the region and portfolio on screen");
// The state objects are read during module init, from above their old declaration
// site — a `var` there left them undefined and the first empty render threw.
const mfhDecl = SRC.indexOf("var MFH_STATE =");
check(mfhDecl !== -1 && mfhDecl < SRC.indexOf("function renderEquityHoldingsTable"),
  "MFH_STATE must be declared before renderEquityHoldingsTable, which reads it during init");
check(SRC.indexOf("var DBTH_STATE =") < SRC.indexOf("function renderMfHoldingsCardList"),
  "DBTH_STATE must be declared before the renderer that reads it");

check(/if \(FIH_STATE\.showClosed && !fihHasClosed && fihHasOpen\)/.test(SRC),
  "Fixed Income Holding needs the same two-way fallback as the other tables");
check(/_setOpenClosedPill\(ocToggle, FIH_STATE\.showClosed, fihHasClosed, fihHasOpen\)/.test(SRC),
  "Fixed Income Holding must paint its pill availability");
check(/if \(COMH_STATE\.showClosed && !cmhHasClosed && cmhHasOpen\)/.test(SRC),
  "Commodity Holding needs the same two-way fallback");
check(/_setOpenClosedPill\(document\.getElementById\("cmh-open-closed"\), COMH_STATE\.showClosed, cmhHasClosed, cmhHasOpen\)/.test(SRC),
  "Commodity Holding must paint its pill availability");

// The Debt table has its own portfolio filter, which only works if its rows are
// built per portfolio. Lifting them out of the Mutual Fund rows would make them
// follow the MUTUAL FUND pill instead, and with that pill on "all" every
// portfolio's units would be merged into one unfilterable row.
check(/function _buildDebtRowsPerPortfolio\(rows, navByInst, isDebt\)/.test(SRC),
  "debt rows must be built per portfolio");
check(/window\.__mfDebtRows = _allRows\.filter\(/.test(SRC),
  "...and the debt table must be a filter over that same build");
check(/portfolio: "all"/.test(SRC) && /DBTH_STATE = \{[^}]*portfolio: "all"/.test(SRC),
  "DBTH_STATE needs a portfolio field");
check(/data-dbth-portfolio/.test(SRC), "the debt portfolio pill is not wired");
check(/_portfolio: r\._portfolio \|\| ""/.test(SRC),
  "Stocks/ETF debt rows must carry their portfolio through the normalisation, or the filter drops them");

check(/r\._portfolio \? escapeHtml\(r\._portfolio\)/.test(SRC),
  "the same instrument can appear once per portfolio — the row must name which one");

check(/<h3 class="mfh-title">Debt ETF\/Mutual Fund Holding<\/h3>/.test(HTML),
  'the debt card must be titled "Debt ETF/Mutual Fund Holding"');

if (failed) { console.error("\n" + failed + " holdings-toggle check(s) failed"); process.exit(1); }
console.log("holdings Open/Closed toggles OK");
