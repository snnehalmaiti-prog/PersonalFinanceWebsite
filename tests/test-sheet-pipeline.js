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

console.log("H. CSV parsing");
const csv = 'Transaction Date,Portfolio Name,Instrument Name,Transaction Type,Units,Price\r\n' +
  '12/05/2024,Snnehal,"Bank, HDFC",Buy,10,1500\r\n' +
  '13/05/2024,Trisha,"Say ""Hi""",Sell,5,900\r\n\r\n';
const crows = parseCSVText(csv);
ok(crows.length === 3, "H1 CRLF + trailing blank line handled");
ok(crows[1][2] === "Bank, HDFC", "H2 quoted comma kept in one cell");
ok(crows[2][2] === 'Say "Hi"', "H3 escaped quotes unescaped");

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
