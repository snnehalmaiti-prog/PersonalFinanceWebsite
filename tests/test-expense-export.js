#!/usr/bin/env node
// test-expense-export.js — expense label handling and CSV export.
//
// Functions extracted verbatim from dashboard.html's inline script (same
// convention as test-sheet-pipeline.js). Pins the regression that made Export
// silently do nothing: the `labels` column is overloaded — originally a JSON
// array of tags, later also a metadata object ({budget_split, payer}) — and
// recLabels returned whatever JSON.parse produced. For any record saved with a
// payer it returned an object, so callers doing .join("|") / .map() threw
// "is not a function" and the whole handler died before downloading anything.
"use strict";

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// ── extracted verbatim from dashboard.html ────────────────────────────────
function recLabels(r) {
  if (!r) return [];
  if (Array.isArray(r.labels)) return r.labels;
  if (typeof r.labels === "string" && r.labels) {
    try {
      var parsed = JSON.parse(r.labels);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
  }
  return [];
}

function findById(list, id) { return list.find(function (x) { return x.id === id; }); }

function buildCsv(records, accounts, categories, paymentMethods) {
  var header = ["Date", "Type", "Amount", "Account", "Category", "Payment Method", "Labels", "Note"];
  var lines = [header.join(",")];
  records.forEach(function (r) {
    var acct = findById(accounts, r.account_id) || {};
    var cat = findById(categories, r.category_id) || {};
    var pm = findById(paymentMethods, r.payment_method_id) || {};
    var lbls = recLabels(r).join("|");
    var csv = [r.txn_date || "", r.type, r.amount, acct.name || "", cat.name || "", pm.name || "", lbls, (r.note || "").replace(/[,\n]/g, " ")];
    lines.push(csv.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(","));
  });
  return "﻿" + lines.join("\r\n");
}
// ──────────────────────────────────────────────────────────────────────────

console.log("A. recLabels always yields an array");

ok(Array.isArray(recLabels({ labels: ["a", "b"] })), "A1 array passes through");
ok(recLabels({ labels: ["a", "b"] }).join("|") === "a|b", "A2 array joins");
ok(Array.isArray(recLabels({ labels: JSON.stringify(["x"]) })), "A3 JSON array string parses to array");

// The regression: labels holding the payer/budget_split metadata object.
const payerRec = { labels: JSON.stringify({ payer: "Snnehal", budget_split: "joint" }) };
ok(Array.isArray(recLabels(payerRec)), "A4 metadata OBJECT yields [] not an object");
let threw = false;
try { recLabels(payerRec).join("|"); } catch (e) { threw = true; }
ok(!threw, "A5 .join() on a payer record does not throw (the Export bug)");
let threw2 = false;
try { recLabels(payerRec).map(function (l) { return String(l); }); } catch (e) { threw2 = true; }
ok(!threw2, "A6 .map() on a payer record does not throw (the label-filter bug)");

ok(recLabels({ labels: "not json" }).length === 0, "A7 malformed JSON yields []");
ok(recLabels({ labels: null }).length === 0, "A8 null yields []");
ok(recLabels({}).length === 0, "A9 missing labels yields []");
ok(recLabels(null).length === 0, "A10 null record yields []");
ok(recLabels({ labels: JSON.stringify({}) }).length === 0, "A11 empty object yields []");

console.log("\nB. CSV export");

const accounts = [{ id: "a1", name: "HDFC" }];
const categories = [{ id: "c1", name: "Food, Dining" }];
const pms = [{ id: "p1", name: "UPI" }];

// A payer record must export rather than aborting the whole file.
{
  const csv = buildCsv([{ id: "r1", txn_date: "2026-07-25", type: "expense", amount: 250.5,
    account_id: "a1", category_id: "c1", payment_method_id: "p1",
    labels: JSON.stringify({ payer: "Snnehal" }), note: "lunch" }], accounts, categories, pms);
  ok(csv.indexOf("2026-07-25") !== -1, "B1 payer record exports instead of throwing");
}

// Quoting: commas, double quotes and newlines must not break the row structure.
{
  const csv = buildCsv([{ id: "r1", txn_date: "2026-07-25", type: "expense", amount: 1,
    account_id: "a1", category_id: "c1", payment_method_id: "p1",
    labels: ["t1", "t2"], note: 'lunch, with "team"' }], accounts, categories, pms);
  const row = csv.replace(/^﻿/, "").split("\r\n")[1];
  const fields = row.match(/"([^"]|"")*"/g) || [];
  ok(fields.length === 8, "B2 row has exactly 8 quoted fields", "got " + fields.length);
  ok(row.indexOf('""team""') !== -1, "B3 double quotes are escaped by doubling");
  ok(row.indexOf('"Food, Dining"') !== -1, "B4 comma inside a field stays in one field");
  ok(row.indexOf("t1|t2") !== -1, "B5 labels joined with |");
}

// Newlines in a note must not split the record across CSV rows.
{
  const csv = buildCsv([{ id: "r1", txn_date: "2026-07-24", type: "income", amount: 1000,
    account_id: "a1", labels: [], note: "line1\nline2" }], accounts, categories, pms);
  const dataRows = csv.replace(/^﻿/, "").split("\r\n").slice(1);
  ok(dataRows.length === 1, "B6 newline in note does not create a second row", dataRows.length + " rows");
}

ok(buildCsv([], accounts, categories, pms).indexOf("﻿") === 0, "B7 UTF-8 BOM leads the file (Excel encoding)");

console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
