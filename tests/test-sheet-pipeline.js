// Executable tests for the sheet-sync pipeline in script.js.
// Extracts the REAL function sources verbatim (brace-balanced slice) and evals
// them in a scope with a controllable fetchSheetData mock — so we're testing
// the shipped code, not a re-implementation.

const fs = require("fs");
const SRC = fs.readFileSync(require("path").join(__dirname, "..", "script.js"), "utf8");

function extract(marker) {
  const start = SRC.indexOf(marker);
  if (start === -1) throw new Error("marker not found: " + marker);
  const braceStart = SRC.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) break; }
  }
  // include trailing ";" for var declarations
  let end = i + 1;
  if (SRC[end] === ";") end++;
  return SRC.slice(start, end);
}

const pieces = [
  "function normalizeText(value)",
  "var CANONICAL_FIELD_KEYWORDS",
  "function findHeaderIndex(ownHeader, canonicalName)",
  "function realignRowsToHeader(rows, canonicalHeader)",
  "function getColumnIndices(header)",
  "function findSavingsBankInstrumentConflicts(rows)",
  "function parseSheetUrl(url)",
  "function detectSheetUrlType(url)",
  "function toCsvFetchUrl(url, type)",
  "function parseCSVText(text)",
  "function gvizRowsFromResponse(data)",
  "function filterColumns(rows, allowedFields)",
  "function extractColumnValues(rows, fieldName)",
  "function fetchAndMergeSheets(configs, onComplete, canonicalFields)",
  "function loadSheetConfigs(prefix)",
].map(extract).join("\n\n");

// Scope: mock fetchSheetData + localStorage before evaling the real code.
const storage = new Map();
const localStorage = {
  getItem: k => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: k => storage.delete(k),
};
const btoa = s => Buffer.from(s, "binary").toString("base64");
let mockSheets = {}; // link → rows[][] or {error}
function fetchSheetData(config, onRows, onError) {
  const m = mockSheets[config.link];
  if (!m) return onError("query");
  if (m.error) return onError(m.error);
  onRows(m);
}
eval(pieces);

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  → " + JSON.stringify(detail) : "")); }
}

const GA="https://docs.google.com/spreadsheets/d/AAA/edit#gid=0", GB="https://docs.google.com/spreadsheets/d/BBB/edit#gid=0", GBAD="https://docs.google.com/spreadsheets/d/BAD/edit#gid=0", GEMPTY="https://docs.google.com/spreadsheets/d/EMP/edit#gid=0";
const TXN_FIELDS = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

console.log("D. URL parsing / type detection");
const u = "https://docs.google.com/spreadsheets/d/1D_DLW7GS7indezLzyGd7ywawjGsDWKgwsraaFAFJ2iY/edit?gid=0#gid=0";
const p = parseSheetUrl(u);
ok(p && p.id === "1D_DLW7GS7indezLzyGd7ywawjGsDWKgwsraaFAFJ2iY" && p.gid === "0", "D1 user's real URL parses (id+gid)", p);
ok(parseSheetUrl("https://docs.google.com/spreadsheets/d/ABC/edit#gid=1234567").gid === "1234567", "D2 non-zero gid extracted");
ok(parseSheetUrl("https://example.com/x.csv") === null, "D3 non-google returns null");
ok(detectSheetUrlType(u) === "google" &&
   detectSheetUrlType("https://1drv.ms/x/abc") === "onedrive" &&
   detectSheetUrlType("https://corp.sharepoint.com/f.xlsx") === "sharepoint" &&
   detectSheetUrlType("https://x.com/data.csv?x=1") === "csv" &&
   detectSheetUrlType("https://drive.google.com/file/d/ID/view") === "gdrive" &&
   detectSheetUrlType("ftp://nope") === null, "D4 type detection matrix");
ok(toCsvFetchUrl("https://drive.google.com/file/d/FILEID/view", "gdrive") === "https://drive.google.com/uc?export=csv&id=FILEID",
  "D5 gdrive → csv export url");

console.log("E. gviz response → rows");
const gviz = {
  table: {
    cols: [
      { label: "Transaction Date", type: "date" },
      { label: "Portfolio Name", type: "string" },
      { label: "Units", type: "number" },
      { label: "Price", type: "number" },
    ],
    rows: [
      { c: [{ v: "Date(2024,4,12)", f: "12/05/2024" }, { v: "Snnehal" }, { v: 10.5, f: "10.50" }, { v: -1234.5, f: "(1,234.50)" }] },
      { c: [{ v: "Date(2024,4,13)", f: "13/05/2024" }, null, { v: 0 }, null] },
    ],
  },
};
const grows = gvizRowsFromResponse(gviz);
ok(grows[0].join("|") === "Transaction Date|Portfolio Name|Units|Price", "E1 header from col labels");
ok(grows[1][0] === "12/05/2024", "E2 date column uses formatted string");
ok(grows[1][3] === "-1234.5", "E3 negative number uses RAW value, not '(1,234.50)'", grows[1]);
ok(grows[2][1] === "" && grows[2][3] === "", "E4 null cells → empty strings");
ok(grows[2][2] === "0", "E5 numeric zero preserved (not blank)");

console.log("F. header matching / realignment");
// F1: the user's exact header row, different column order than canonical
const userSheet = [
  ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"],
  ["12/05/2024", "Snnehal", "HDFCBANK", "Buy", "10", "1500"],
  ["13/05/2024", "Trisha", "TATACAP", "Sell", "5", "900"],
];
const aligned = realignRowsToHeader(userSheet, TXN_FIELDS);
ok(aligned.length === 2 && aligned[0].join("|") === "12/05/2024|Snnehal|HDFCBANK|Buy|10|1500",
  "F1 user's exact headers map 1:1", aligned[0]);

// F2: scrambled column order still maps correctly
const scrambled = [
  ["Price", "Units", "Transaction Type", "Instrument Name", "Portfolio Name", "Transaction Date"],
  ["1500", "10", "Buy", "HDFCBANK", "Snnehal", "12/05/2024"],
];
const a2 = realignRowsToHeader(scrambled, TXN_FIELDS);
ok(a2[0].join("|") === "12/05/2024|Snnehal|HDFCBANK|Buy|10|1500", "F2 scrambled order realigned", a2[0]);

// F3: broker-style alternate names matched via keywords
const alt = [
  ["Date", "Portfolio", "Scheme Name", "Type", "Unit(s)", "NAV"],
  ["12/05/2024", "Snnehal", "HDFC Flexi Cap", "Purchase", "100", "45.5"],
];
const a3 = realignRowsToHeader(alt, TXN_FIELDS);
ok(a3[0].join("|") === "12/05/2024|Snnehal|HDFC Flexi Cap|Purchase|100|45.5",
  "F3 keyword matching (Date/Portfolio/Scheme/Type/Unit(s)/NAV)", a3[0]);

// F4: THE BUG THE USER HIT — header-row misconfig means row 0 is DATA, not headers
const noHeader = [
  ["12/05/2024", "Snnehal", "HDFCBANK", "Buy", "10", "1500"],
  ["13/05/2024", "Trisha", "TATACAP", "Sell", "5", "900"],
];
const a4 = realignRowsToHeader(noHeader, TXN_FIELDS);
ok(a4.every(r => r.every(c => c === "")), "F4 wrong header row → all-blank rows (matches observed 'Portfolio is blank' error)", a4[0]);

// F5: known edge — a sheet with 'Instrument Category' but NO 'Instrument Name'
const trap = [
  ["Transaction Date", "Portfolio Name", "Instrument Category", "Transaction Type", "Units", "Price"],
  ["12/05/2024", "Snnehal", "Equity", "Buy", "10", "1500"],
];
const a5 = realignRowsToHeader(trap, TXN_FIELDS);
// documents behavior: keyword 'instrument' falls back to the Category column
console.log("  INFO  F5 'Instrument Name' resolved to: " + JSON.stringify(a5[0][2]) + " (keyword fallback hits 'Instrument Category')");

console.log("G. fetchAndMergeSheets");
// G1: two sheets, different orders, merged under canonical header
mockSheets = {}; mockSheets[GA] = userSheet; mockSheets[GB] = scrambled;
let out;
fetchAndMergeSheets([{ link: GA }, { link: GB }], (merged, failures, reasons, stats) => { out = { merged, failures, reasons, stats }; }, TXN_FIELDS);
ok(out.merged[0].join("|") === TXN_FIELDS.join("|"), "G1 merged header is canonical");
ok(out.merged.length === 4 && out.failures === 0, "G1 rows from both sheets merged", out.merged.length);
ok(out.merged[3].join("|") === "12/05/2024|Snnehal|HDFCBANK|Buy|10|1500", "G1 second sheet realigned into canonical order");

// G2: one sheet fails — other still merges, failure surfaced
mockSheets = {}; mockSheets[GA] = userSheet; mockSheets[GBAD] = { error: "timeout" };
fetchAndMergeSheets([{ link: GA }, { link: GBAD }], (merged, failures, reasons, stats) => { out = { merged, failures, reasons, stats }; }, TXN_FIELDS);
ok(out.failures === 1 && out.reasons[0] === "timeout", "G2 failure counted + reason kept");
ok(out.merged.length === 3, "G2 healthy sheet's rows still delivered");
ok(out.stats[1].error === "timeout" && out.stats[0].rowCount === 2, "G2 per-sheet stats correct");

// G3: header-only sheet contributes nothing but doesn't break the merge
mockSheets = {}; mockSheets[GA] = userSheet;
mockSheets[GEMPTY] = [["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"]];
fetchAndMergeSheets([{ link: GEMPTY }, { link: GA }], (merged) => { out = { merged }; }, TXN_FIELDS);
ok(out.merged.length === 3, "G3 header-only sheet skipped, data sheet intact");

// G4: invalid link → pre-counted failure, valid one proceeds
mockSheets = {}; mockSheets[GA] = userSheet;
fetchAndMergeSheets([{ link: "not a url" }, { link: GA }], (merged, failures) => { out = { merged, failures }; }, TXN_FIELDS);
ok(out.failures === 1 && out.merged.length === 3, "G4 invalid link pre-counted, valid link synced");

// G5: localData (uploaded file) bypasses fetch entirely
fetchAndMergeSheets([{ localData: scrambled }], (merged, failures) => { out = { merged, failures }; }, TXN_FIELDS);
ok(out.failures === 0 && out.merged.length === 2 && out.merged[1][1] === "Snnehal", "G5 uploaded-file localData path realigned");

// G6: REGRESSION — a statically-invalid config alongside a valid sheet must NOT be
// counted as a fetchFailure. Callers gate cache writes on fetchFailures, so a bad
// config entry must not freeze updates from the healthy sheet.
fetchAndMergeSheets([{ link: "not a url" }, { link: GA }],
  (merged, failures, reasons, stats, fetchFailures) => { out = { merged, failures, fetchFailures }; }, TXN_FIELDS);
ok(out.failures === 1, "G6 invalid config still counted in total failures");
ok(out.fetchFailures === 0, "G6 invalid config is NOT a fetchFailure (writes proceed)");
ok(out.merged.length === 3, "G6 valid sheet's rows delivered despite bad config");

// G7: a valid sheet that fails to LOAD is a real fetchFailure (keep last-known-good).
fetchAndMergeSheets([{ link: GA }, { link: GBAD }],
  (merged, failures, reasons, stats, fetchFailures) => { out = { merged, failures, fetchFailures }; }, TXN_FIELDS);
ok(out.fetchFailures === 1 && out.failures === 1, "G7 real load failure counted as fetchFailure");

// G8: all-invalid configs → early return still passes fetchFailures (0, no fetch attempted).
fetchAndMergeSheets([{ link: "nope" }],
  (merged, failures, reasons, stats, fetchFailures) => { out = { merged, failures, fetchFailures }; }, TXN_FIELDS);
ok(out.merged === null && out.failures === 1 && out.fetchFailures === 0, "G8 all-invalid: merged null, fetchFailures 0");

console.log("H. CSV parsing");
const csv = 'Transaction Date,Portfolio Name,Instrument Name,Transaction Type,Units,Price\r\n' +
  '12/05/2024,Snnehal,"Bank, HDFC",Buy,10,1500\r\n' +
  '13/05/2024,Trisha,"Say ""Hi""",Sell,5,900\r\n\r\n';
const crows = parseCSVText(csv);
ok(crows.length === 3, "H1 CRLF + trailing blank line handled");
ok(crows[1][2] === "Bank, HDFC", "H2 quoted comma kept in one cell");
ok(crows[2][2] === 'Say "Hi"', "H3 escaped quotes unescaped");

console.log("J. getColumnIndices");
{
  const hdr = ["transaction date", "portfolio name", "instrument name", "transaction type", "units", "price", "amount", "instrument category", "instrument sub category", "invested amount", "bank"];
  const ci = getColumnIndices(hdr);
  // Behaviour-identical to inline header.indexOf(...) — verify each field.
  ok(ci.portfolio === 1 && ci.instrument === 2 && ci.type === 3 && ci.units === 4 && ci.price === 5, "J1 core txn columns resolved");
  ok(ci.amount === 6 && ci.category === 7 && ci.subCategory === 8 && ci.investedAmount === 9 && ci.bank === 10, "J2 fixed-income columns resolved");
  ok(ci.date === 0, "J3 date uses fuzzy contains-'date' match");
  // Exact transactionDate must NOT be confused with a fuzzy date match.
  {
    const multiDate = ["maturity date", "transaction date", "portfolio name"];
    const mci = getColumnIndices(multiDate);
    ok(mci.transactionDate === 1, "J3b transactionDate is exact (not the first 'date' column)");
    ok(mci.date === 0, "J3c fuzzy date still matches the first 'date' column");
  }
  // "amount" must not partial-match "invested amount" (exact element match).
  ok(getColumnIndices(["invested amount"]).amount === -1 && getColumnIndices(["invested amount"]).investedAmount === 0, "J4 'amount' != 'invested amount'");
  // Absent columns → -1; null/empty header → all -1 without throwing.
  const empty = getColumnIndices([]);
  ok(empty.portfolio === -1 && empty.date === -1, "J5 empty header → all -1");
  ok(getColumnIndices(null).portfolio === -1, "J6 null header → -1 (no throw)");
}

console.log("K. findSavingsBankInstrumentConflicts");
{
  const H = ["Portfolio Name", "Bank", "Instrument Name", "Instrument Category", "Instrument Sub Category"];
  const mk = (rows) => [H].concat(rows);
  // Clean: each bank has one instrument name (across banks and portfolios).
  const clean = mk([
    ["Snnehal", "HDFC", "HDFC Savings", "Fixed Income", "Savings Account"],
    ["Snnehal", "HDFC", "HDFC Savings", "Fixed Income", "Savings Account"], // same bank+name = running balance, OK
    ["Snnehal", "ICICI", "ICICI Savings", "Fixed Income", "Savings Account"],
  ]);
  ok(findSavingsBankInstrumentConflicts(clean).length === 0, "K1 one instrument name per bank → no conflict");
  // Conflict: same bank, two different instrument names.
  const conflict = mk([
    ["Snnehal", "HDFC", "HDFC Savings", "Fixed Income", "Savings Account"],
    ["Snnehal", "HDFC", "HDFC Salary A/c", "Fixed Income", "Savings Account"],
  ]);
  const c = findSavingsBankInstrumentConflicts(conflict);
  ok(c.length === 1, "K2 same bank, two instrument names → one conflict", c.length);
  ok(c[0].indexOf("Snnehal") !== -1 && c[0].indexOf("HDFC") !== -1 && c[0].indexOf("HDFC Savings") !== -1 && c[0].indexOf("HDFC Salary A/c") !== -1 && c[0].indexOf("row") !== -1,
    "K3 conflict names portfolio + bank + both instruments + row refs", c[0]);
  // Only Savings Account is checked — FD / other sub-categories with multiple names are fine.
  const fd = mk([
    ["Snnehal", "HDFC", "HDFC FD 1", "Fixed Income", "Fixed Deposit"],
    ["Snnehal", "HDFC", "HDFC FD 2", "Fixed Income", "Fixed Deposit"],
  ]);
  ok(findSavingsBankInstrumentConflicts(fd).length === 0, "K4 Fixed Deposit sub-category is not subject to the rule");
  // Case/whitespace-insensitive on bank + category + sub-category.
  const messy = mk([
    ["Snnehal", " hdfc ", "HDFC Savings", "fixed income", "savings account"],
    ["Snnehal", "HDFC", "HDFC Salary", "Fixed Income", "Savings  Account"],
  ]);
  ok(findSavingsBankInstrumentConflicts(messy).length === 1, "K5 bank/category/sub-cat matched case & space-insensitively");
  // Blanks are skipped here (flagged elsewhere); no false positive.
  const blanks = mk([
    ["Snnehal", "", "HDFC Savings", "Fixed Income", "Savings Account"],
    ["Snnehal", "HDFC", "", "Fixed Income", "Savings Account"],
  ]);
  ok(findSavingsBankInstrumentConflicts(blanks).length === 0, "K6 blank bank/instrument skipped (no false positive)");
  // Investment Corpus is subject to the same rule.
  const corpusConflict = mk([
    ["Snnehal", "SBI", "SBI Corpus", "Fixed Income", "Investment Corpus"],
    ["Snnehal", "SBI", "SBI Growth Corpus", "Fixed Income", "Investment Corpus"],
  ]);
  const cc = findSavingsBankInstrumentConflicts(corpusConflict);
  ok(cc.length === 1 && cc[0].indexOf("Investment Corpus") !== -1 && cc[0].indexOf("SBI") !== -1,
    "K7 Investment Corpus: two names per bank → conflict", cc[0]);
  // Savings Account and Investment Corpus are checked INDEPENDENTLY — a bank may
  // have one name for each without conflict.
  const mixed = mk([
    ["Snnehal", "HDFC", "HDFC Savings", "Fixed Income", "Savings Account"],
    ["Snnehal", "HDFC", "HDFC Corpus", "Fixed Income", "Investment Corpus"],
  ]);
  ok(findSavingsBankInstrumentConflicts(mixed).length === 0, "K8 one Savings + one Corpus name per bank → no conflict");
  // A conflict in BOTH sub-categories at the same bank → two separate messages.
  const both = mk([
    ["Snnehal", "HDFC", "HDFC Savings A", "Fixed Income", "Savings Account"],
    ["Snnehal", "HDFC", "HDFC Savings B", "Fixed Income", "Savings Account"],
    ["Snnehal", "HDFC", "HDFC Corpus A", "Fixed Income", "Investment Corpus"],
    ["Snnehal", "HDFC", "HDFC Corpus B", "Fixed Income", "Investment Corpus"],
  ]);
  const bc = findSavingsBankInstrumentConflicts(both);
  ok(bc.length === 2 && bc.some(m => m.indexOf("Savings Account") !== -1) && bc.some(m => m.indexOf("Investment Corpus") !== -1),
    "K9 conflicts in both sub-categories → two distinct messages", bc.length);
  // Per-PORTFOLIO scoping: different portfolios at the same bank may use different
  // Instrument Names without conflict.
  const twoPortfolios = mk([
    ["Snnehal", "HDFC", "Snnehal HDFC Savings", "Fixed Income", "Savings Account"],
    ["Trisha", "HDFC", "Trisha HDFC Savings", "Fixed Income", "Savings Account"],
  ]);
  ok(findSavingsBankInstrumentConflicts(twoPortfolios).length === 0,
    "K10 different portfolios, same bank, different names → no conflict (per-portfolio scope)");
  // But the SAME portfolio+bank with two names is still a conflict.
  const samePB = mk([
    ["Snnehal", "HDFC", "Name A", "Fixed Income", "Savings Account"],
    ["Snnehal", "HDFC", "Name B", "Fixed Income", "Savings Account"],
    ["Trisha", "HDFC", "Trisha Name", "Fixed Income", "Savings Account"],
  ]);
  const spc = findSavingsBankInstrumentConflicts(samePB);
  ok(spc.length === 1 && spc[0].indexOf("Snnehal") !== -1,
    "K11 same portfolio+bank two names → conflict scoped to that portfolio", spc.length);
}

console.log("I. loadSheetConfigs");
storage.clear();
localStorage.setItem("wf-stocksetf-sheets", JSON.stringify([{ link: "L1", headerRow: "1" }, { link: "L2", headerRow: "3" }]));
const cfg = loadSheetConfigs("stocksetf");
ok(cfg.length === 2 && cfg[1].headerRow === "3", "I1 multi-sheet config parsed");
storage.clear();
localStorage.setItem("wf-fd-sheet-link", "LEGACY");
localStorage.setItem("wf-fd-header-row", "2");
const cfg2 = loadSheetConfigs("fd");
ok(cfg2.length === 1 && cfg2[0].link === "LEGACY" && cfg2[0].headerRow === "2", "I2 legacy single-link fallback");
storage.clear();
localStorage.setItem("wf-equity-sheets", "{corrupt");
ok(loadSheetConfigs("equity").length === 0, "I3 corrupt JSON handled (no crash)");

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
