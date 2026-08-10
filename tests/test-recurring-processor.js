// The schedule processor, now shared by Recurring payments and Liabilities.
//
// One processor drives two independent stores. The failure that matters is the
// two bleeding into each other: a liability whose instalments are deduped
// against a recurring payment's posted dates would silently skip charges, and a
// run over one store that rewrote the other's key would destroy a schedule. So
// the assertions here are about separation — distinct labels, distinct keys,
// distinct re-entrancy guards — on top of the scheduling arithmetic itself.
//
// expense.js is loaded whole in a sandbox rather than copied, so the code under
// test is the shipped code.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
const eq = (a, b, name) => ok(a === b, name, { got: a, want: b });

function makeSandbox() {
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
  };
  const inserted = [];
  const selects = [];
  const WfDb = {
    select: (table, q) => { selects.push({ table, q }); return Promise.resolve([]); },
    insert: (table, row) => { inserted.push({ table, row }); return Promise.resolve([row]); },
  };
  const WfAuth = {
    isLoggedIn: () => true,
    loadSettingsFromCloud: () => Promise.resolve(null),
    saveSettingsToCloud: () => Promise.resolve(null),
  };
  const document = {
    readyState: "complete",
    addEventListener: () => {},
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {}, addEventListener() {}, setAttribute() {} }),
  };
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, JSON, Math, String, Number,
    localStorage, document, WfDb, WfAuth,
    fetch: () => Promise.reject(new Error("no network")),
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "expense.js"), "utf8"), sandbox);
  return { sandbox, store, inserted, selects, localStorage };
}

// A schedule that started three months ago and has never been posted: the
// processor should catch it up to today, one instalment per month.
function item(id, opts) {
  return {
    id: id,
    name: opts.name,
    row: Object.assign({
      type: "expense", amount: 1000, frequency: "monthly",
      next_due: opts.nextDue, end_date: null, num_payments: null,
      account_id: "acc-1", category_id: "cat-1", subcategory_id: null,
      payment_method_id: "pm-1", note: "",
    }, opts.row || {}),
    updated_at: 1,
  };
}

function isoMonthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  const p = (x) => String(x).padStart(2, "0");
  // Pin to the 5th: a day that exists in every month, so the count of due
  // instalments is exactly n regardless of when the suite runs.
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-05";
}

(async () => {
  console.log("── one store, caught up ──");
  {
    const env = makeSandbox();
    env.localStorage.setItem("wf-recurring-payments",
      JSON.stringify([item("rp-1", { name: "Rent", nextDue: isoMonthsAgo(3) })]));
    await env.sandbox.window.WfExpense.processRecurring();

    eq(env.inserted.length, 4,
       "R1 three months overdue posts four instalments — the three missed and today's");
    ok(env.inserted.every((i) => i.table === "expense_records"),
       "R2 into expense_records");
    ok(env.inserted.every((i) => i.row.labels[0] === "recurring"),
       "R3 each labelled 'recurring'", env.inserted.map((i) => i.row.labels));
    ok(env.inserted.every((i) => /\[recurring\]$/.test(i.row.note)),
       "R4 and the note says so", env.inserted.map((i) => i.row.note));
    const saved = JSON.parse(env.localStorage.getItem("wf-recurring-payments"));
    eq(saved[0].row.installments_done, 4, "R5 the paid counter advances with them");
    ok(saved[0].row.next_due > isoMonthsAgo(0),
       "R6 and next_due moves past today, so a second run posts nothing",
       saved[0].row.next_due);
  }

  console.log("\n── the other store ──");
  {
    const env = makeSandbox();
    env.localStorage.setItem("wf-liabilities",
      JSON.stringify([item("lb-1", { name: "Home loan", nextDue: isoMonthsAgo(2),
        row: { amount: 45000, lender: "HDFC", principal: 5000000, interest_rate: 8.5 } })]));
    await env.sandbox.window.WfExpense.processRecurring();

    eq(env.inserted.length, 3, "L1 a liability is caught up by the same processor");
    ok(env.inserted.every((i) => i.row.amount === 45000),
       "L2 posting its instalment amount", env.inserted.map((i) => i.row.amount));
    ok(env.inserted.every((i) => i.row.labels[0] === "liability"),
       "L3 but labelled 'liability', not 'recurring'", env.inserted.map((i) => i.row.labels));
    ok(env.inserted.every((i) => /\[liability\]$/.test(i.row.note)),
       "L4 and the note distinguishes it in the ledger", env.inserted.map((i) => i.row.note));
    // The dedup query is what keeps a liability from being suppressed by a
    // recurring payment's already-posted dates: it is scoped to the item id.
    ok(env.selects.some((s) => s.q.indexOf(encodeURIComponent(JSON.stringify(["lb-1"]))) !== -1),
       "L5 its idempotency query is scoped to its own id", env.selects);
    const saved = JSON.parse(env.localStorage.getItem("wf-liabilities"));
    eq(saved[0].row.installments_done, 3, "L6 and its own counter advances");
    ok(saved[0].row.lender === "HDFC" && saved[0].row.principal === 5000000,
       "L7 while the debt fields it carries are left untouched", saved[0].row);
  }

  console.log("\n── both at once ──");
  {
    const env = makeSandbox();
    env.localStorage.setItem("wf-recurring-payments",
      JSON.stringify([item("rp-1", { name: "Rent", nextDue: isoMonthsAgo(1) })]));
    env.localStorage.setItem("wf-liabilities",
      JSON.stringify([item("lb-1", { name: "Car loan", nextDue: isoMonthsAgo(1), row: { amount: 20000 } })]));
    await env.sandbox.window.WfExpense.processRecurring();

    const rec = env.inserted.filter((i) => i.row.labels[0] === "recurring");
    const lia = env.inserted.filter((i) => i.row.labels[0] === "liability");
    eq(rec.length, 2, "B1 the recurring payment posts its two instalments");
    eq(lia.length, 2, "B2 and the liability posts its own two");
    eq(env.inserted.length, 4, "B3 with nothing double-counted between them");
    const savedRec = JSON.parse(env.localStorage.getItem("wf-recurring-payments"));
    const savedLia = JSON.parse(env.localStorage.getItem("wf-liabilities"));
    eq(savedRec.length, 1, "B4 each store is rewritten in place");
    eq(savedLia.length, 1, "B5 and neither overwrites the other's key");
    eq(savedRec[0].name, "Rent", "B6 the recurring payment survives the liability run", savedRec[0]);
    eq(savedLia[0].name, "Car loan", "B7 and the liability survives the recurring run", savedLia[0]);
  }

  console.log("\n── limits still apply to both ──");
  {
    const env = makeSandbox();
    env.localStorage.setItem("wf-liabilities",
      JSON.stringify([item("lb-1", { name: "Personal loan", nextDue: isoMonthsAgo(5),
        row: { num_payments: 2, installments_done: 0 } })]));
    await env.sandbox.window.WfExpense.processRecurring();
    eq(env.inserted.length, 2,
       "C1 a liability stops at its instalment count even when far overdue");

    const env2 = makeSandbox();
    env2.localStorage.setItem("wf-liabilities",
      JSON.stringify([item("lb-2", { name: "Bridge loan", nextDue: isoMonthsAgo(5),
        row: { end_date: isoMonthsAgo(3) } })]));
    await env2.sandbox.window.WfExpense.processRecurring();
    eq(env2.inserted.length, 3, "C2 and at its end date");
  }

  console.log("\n── re-entrancy ──");
  {
    // Both page-load and the Expense tab's onShow can trigger this, so it has to
    // be safe to run repeatedly: the second run must find both schedules already
    // past today and insert nothing.
    const env = makeSandbox();
    env.localStorage.setItem("wf-recurring-payments",
      JSON.stringify([item("rp-1", { name: "Rent", nextDue: isoMonthsAgo(1) })]));
    env.localStorage.setItem("wf-liabilities",
      JSON.stringify([item("lb-1", { name: "Car loan", nextDue: isoMonthsAgo(1) })]));
    await env.sandbox.window.WfExpense.processRecurring();
    const first = env.inserted.length;
    await env.sandbox.window.WfExpense.processRecurring();
    eq(first, 4, "D1 the first run posts for both stores");
    eq(env.inserted.length, 4,
       "D2 and a second run posts nothing — the schedules are already past today");
  }

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
