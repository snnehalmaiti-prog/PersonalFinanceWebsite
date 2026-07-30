// Local snapshot mutation after an expense save / delete.
//
// Adding a record used to trigger loadDashAccounts(true) — a full re-download of
// all four expense tables plus a complete repaint — before anything on screen
// changed. On a phone that read as a hang. The row the server already returned is
// now spliced into the painted snapshot instead.
//
// That is only safe if the spliced row lands where the server would have put it
// (records are ordered txn_date desc, created_at desc) and if the cached snapshot
// is updated too, so a reload doesn't lose the record. Those are the invariants
// here. Functions are extracted from dashboard.html's inline script, not copied.

const fs = require("fs");
const path = require("path");
const HTML = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");

function extract(marker) {
  const start = HTML.indexOf(marker);
  if (start === -1) throw new Error("marker not found in dashboard.html: " + marker);
  const braceStart = HTML.indexOf("{", start);
  let depth = 0, i = braceStart;
  for (; i < HTML.length; i++) {
    if (HTML[i] === "{") depth++;
    else if (HTML[i] === "}") { depth--; if (depth === 0) break; }
  }
  return HTML.slice(start, i + 1);
}

// ── scope ──────────────────────────────────────────────────────────────────
var dashExpState = { accounts: [], categories: [], paymentMethods: [], records: [] };
var _expCacheKey = "exp-snapshot:u1";
var renderCount = 0;
function renderAllExpense() { renderCount++; }
var idbWrites = [];
var _expCachedSig = null;
var WfIdb = { set: function (k, v) { idbWrites.push({ key: k, value: v }); } };
var window = { WfIdb: WfIdb };

eval([
  extract("function expSignature(s)"),
  extract("function _expRecordCmp(a, b)"),
  extract("function applySavedRecordLocally(saved)"),
  extract("function removeRecordsLocally(ids)"),
].join("\n\n"));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

function rec(id, date, created) { return { id: id, txn_date: date, created_at: created, amount: 100 }; }
function reset() {
  dashExpState.records = [
    rec("c", "2026-07-20", "2026-07-20T10:00:00Z"),
    rec("b", "2026-07-10", "2026-07-10T09:00:00Z"),
    rec("a", "2026-07-01", "2026-07-01T08:00:00Z"),
  ];
  renderCount = 0; idbWrites = [];
}
const ids = () => dashExpState.records.map(function (r) { return r.id; }).join(",");

console.log("A. Ordering matches the server's order= clause");
{
  reset();
  applySavedRecordLocally(rec("new", "2026-07-15", "2026-07-29T12:00:00Z"));
  ok(ids() === "c,new,b,a", "A1 a mid-range date is inserted in date order, not at the top", ids());
  reset();
  applySavedRecordLocally(rec("new", "2026-07-29", "2026-07-29T12:00:00Z"));
  ok(ids() === "new,c,b,a", "A2 the newest date goes first", ids());
  reset();
  applySavedRecordLocally(rec("new", "2025-01-01", "2026-07-29T12:00:00Z"));
  ok(ids() === "c,b,a,new", "A3 a backdated record goes last", ids());
  reset();
  // Same txn_date: created_at breaks the tie, descending.
  applySavedRecordLocally(rec("new", "2026-07-10", "2026-07-10T23:00:00Z"));
  ok(ids() === "c,new,b,a", "A4 same date - later created_at wins the tie", ids());
  reset();
  applySavedRecordLocally(rec("new", "2026-07-10", "2026-07-10T01:00:00Z"));
  ok(ids() === "c,b,new,a", "A5 same date - earlier created_at sorts after", ids());
}

console.log("\nB. An edit replaces the row, it never duplicates it");
{
  reset();
  const before = dashExpState.records.length;
  applySavedRecordLocally({ id: "b", txn_date: "2026-07-10", created_at: "2026-07-10T09:00:00Z", amount: 999 });
  ok(dashExpState.records.length === before, "B1 count unchanged", dashExpState.records.length);
  const edited = dashExpState.records.filter(function (r) { return r.id === "b"; });
  ok(edited.length === 1 && edited[0].amount === 999, "B2 the row carries the new amount", edited);
  reset();
  // An edit that moves the record's date must re-sort it, not leave it stranded.
  applySavedRecordLocally({ id: "a", txn_date: "2026-07-31", created_at: "2026-07-01T08:00:00Z" });
  ok(ids() === "a,c,b", "B3 an edited date re-sorts the row", ids());
}

console.log("\nC. Unusable responses fall back to a full refetch");
{
  reset();
  ok(applySavedRecordLocally(null) === false, "C1 null response -> false");
  ok(applySavedRecordLocally(undefined) === false, "C2 undefined -> false");
  ok(applySavedRecordLocally({}) === false, "C3 a row with no id -> false");
  ok(applySavedRecordLocally([]) === false, "C4 an empty array -> false");
  ok(renderCount === 0, "C5 and nothing was repainted on any of those", renderCount);
  ok(applySavedRecordLocally([rec("z", "2026-07-05", "x")]) === true,
     "C6 an array response (PostgREST returns one) is unwrapped");
  ok(ids().indexOf("z") !== -1, "C7 and the row lands in the list");
}

console.log("\nD. The cached snapshot is kept in step");
{
  reset();
  applySavedRecordLocally(rec("new", "2026-07-29", "2026-07-29T12:00:00Z"));
  ok(idbWrites.length === 1, "D1 exactly one cache write", idbWrites.length);
  ok(idbWrites[0].key === "exp-snapshot:u1", "D2 under the per-user key");
  ok(idbWrites[0].value.records.length === 4, "D3 with the new record included — a reload keeps it",
     idbWrites[0].value.records.length);
  ok(idbWrites[0].value.accounts === dashExpState.accounts &&
     idbWrites[0].value.categories === dashExpState.categories &&
     idbWrites[0].value.paymentMethods === dashExpState.paymentMethods,
     "D4 and the other three tables are preserved, not dropped");
  ok(renderCount === 1, "D5 one repaint", renderCount);

  // No cache key (signed out) or no IDB: still repaints, just doesn't cache.
  reset();
  _expCacheKey = null;
  applySavedRecordLocally(rec("new", "2026-07-29", "z"));
  ok(idbWrites.length === 0 && renderCount === 1, "D6 no cache key - repaint but no write");
  _expCacheKey = "exp-snapshot:u1";
}

console.log("\nE. Deletes drop rows locally");
{
  reset();
  removeRecordsLocally(["b"]);
  ok(ids() === "c,a", "E1 the row is gone", ids());
  ok(idbWrites.length === 1 && idbWrites[0].value.records.length === 2, "E2 cache updated");
  reset();
  removeRecordsLocally(["a", "c"]);
  ok(ids() === "b", "E3 a bulk delete drops all of them", ids());
  reset();
  removeRecordsLocally(["not-a-real-id"]);
  ok(ids() === "c,b,a", "E4 an unknown id is a no-op, not a wipe", ids());
  reset();
  removeRecordsLocally([]);
  ok(ids() === "c,b,a", "E5 an empty list leaves the list intact", ids());
}

console.log("\nF. The comparator is a total order (no unstable sort surprises)");
{
  const rows = [
    rec("1", "2026-07-10", "b"), rec("2", "2026-07-10", "a"),
    rec("3", "", ""), rec("4", "2026-08-01", "z"),
  ];
  ok(_expRecordCmp(rows[0], rows[0]) === 0, "F1 a row equals itself");
  ok(_expRecordCmp(rows[3], rows[0]) < 0 && _expRecordCmp(rows[0], rows[3]) > 0, "F2 antisymmetric on dates");
  ok(_expRecordCmp(rows[0], rows[2]) < 0, "F3 a blank date sorts last, it doesn't throw");
  const sorted = rows.slice().sort(_expRecordCmp).map(function (r) { return r.id; }).join(",");
  ok(sorted === "4,1,2,3", "F4 full sort order", sorted);
}

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
