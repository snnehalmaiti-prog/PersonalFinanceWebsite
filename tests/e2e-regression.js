// End-to-end regression sweep for this session's changes.
//
// Unit suites cover the pure logic; almost everything changed this session lives
// in render paths. This drives the real page: seeds every sheet plus expense data,
// walks all tabs, exercises every pill on every holdings card, and fails on any
// page error, any NaN/undefined leaking into rendered text, or a control that does
// not respond.
// Run with: node tests/e2e-regression.js   (needs a static server on $PORT, default
// 8098, and Playwright's Chromium at $PLAYWRIGHT_BROWSERS_PATH). Not part of
// run-all.js: it needs a browser, which CI here does not have.
const PORT = process.env.PORT || 8098;
const { chromium } = require("playwright");

const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];
const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return"];
const FI_HDR = ["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Amount"];

// Snnehal: open + closed MF, a debt fund, an India stock, an FD, gold.
// Trisha:  a closed MF, a closed debt fund, a US stock, a matured FD.
// Riya:    nothing but a US stock — exercises the "disabled pill" paths.
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Fund A", "Buy", "100", "50"],
    ["1-Jan-2024", "Snnehal", "Fund B", "Buy", "20", "10"], ["1-Mar-2024", "Snnehal", "Fund B", "Sell", "20", "12"],
    ["1-Jan-2024", "Snnehal", "Debt C", "Buy", "30", "10"],
    ["1-Feb-2024", "Trisha", "Fund B", "Buy", "10", "11"], ["1-Apr-2024", "Trisha", "Fund B", "Sell", "10", "13"],
    ["1-Feb-2024", "Trisha", "Debt D", "Buy", "40", "10"], ["1-May-2024", "Trisha", "Debt D", "Sell", "40", "11"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Fund A", "Equity", "Flexi Cap", "100033", "INF1"],
    ["Fund B", "Equity", "Large Cap", "100034", "INF2"],
    ["Debt C", "Fixed Income", "Corporate Bond", "100037", "INF3"],
    ["Debt D", "Fixed Income", "Corporate Bond", "100038", "INF4"]],
  "wf-stocksetf-data": [TXN,
    ["1-Jan-2024", "Snnehal", "HDFC Bank", "Buy", "10", "1500"],
    ["1-Jan-2024", "Trisha", "Hindustan Unilever", "Buy", "5", "2400"],
    ["1-Feb-2024", "Riya", "HDFC Bank", "Buy", "3", "1400"], ["1-Jun-2024", "Riya", "HDFC Bank", "Sell", "3", "1600"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["HDFC Bank", "Equity", "Stock", "Large Cap", "India", "HDFCBANK", "Financials"],
    ["Hindustan Unilever", "Equity", "Stock", "Large Cap", "India", "HINDUNILVR", "FMCG"]],
  "wf-fd-data": [FD_HDR,
    ["3-Jun-2026", "Snnehal", "HDFC", "Deposit-1", "Fixed Income", "Fixed Deposit", "Deposit", "32051", "4-Jun-2027", "6.25%"],
    ["3-Jun-2023", "Trisha", "HDFC", "Deposit-Old", "Fixed Income", "Fixed Deposit", "Deposit", "10000", "4-Jun-2024", "6.25%"],
    // Sep 2025 deliberately has BOTH a deposit and an FD maturing, and no equity
    // sale anywhere near it — the exact shape that used to lock up the page (see I).
    ["3-Mar-2024", "Trisha", "HDFC", "Deposit-Lone", "Fixed Income", "Fixed Deposit", "Deposit", "20000", "15-Sep-2025", "6.25%"],
    ["10-Sep-2025", "Trisha", "HDFC", "Deposit-New", "Fixed Income", "Fixed Deposit", "Deposit", "5000", "10-Sep-2030", "6.25%"],
    ["1-Jan-2024", "Snnehal", "—", "Gold Bar", "Fixed Income", "Gold", "Deposit", "50000", "", "0%"],
    ["1-Jan-2024", "Snnehal", "HDFC", "Savings", "Fixed Income", "Savings Account", "Deposit", "75000", "", "3%"]],
  "wf-fixedincome-data": [FI_HDR,
    ["1-Apr-2025", "Snnehal", "EPF", "Fixed Income", "Provident Fund", "Deposit", "12000"],
    ["1-May-2025", "Snnehal", "EPF", "Fixed Income", "Provident Fund", "Interest", "300"]],
};

const expenseRecords = (() => {
  const out = []; let id = 0;
  for (let m = 1; m <= 7; m++) {
    const mm = String(m).padStart(2, "0");
    out.push({ id: "i" + id++, type: "income", amount: 203000, txn_date: "2026-" + mm + "-05", txn_at: "2026-" + mm + "-05T00:00:00Z", created_at: "2026-" + mm + "-05T00:00:00Z", account_id: "acc-0", category_id: "cat-0", payment_method_id: "pm-0" });
    out.push({ id: "e" + id++, type: "expense", amount: 120000, txn_date: "2026-" + mm + "-10", txn_at: "2026-" + mm + "-10T00:00:00Z", created_at: "2026-" + mm + "-10T00:00:00Z", account_id: "acc-0", category_id: "cat-1", payment_method_id: "pm-1" });
    out.push({ id: "b" + id++, type: "budget", amount: 90000, txn_date: "2026-" + mm + "-01", txn_at: "2026-" + mm + "-01T00:00:00Z", created_at: "2026-" + mm + "-01T00:00:00Z", account_id: "acc-0", category_id: "cat-0", payment_method_id: "pm-0" });
  }
  return out;
})();
const rows = (p, n, e) => Array.from({ length: n }, (_, i) => Object.assign({ id: p + "-" + i, name: p + " " + i, sort_order: i, created_at: "2024-01-01T00:00:00Z" }, e || {}));

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail).slice(0, 300) : "")); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1100 } });
  const p = await ctx.newPage();
  const pageErrors = [];
  p.on("pageerror", (e) => pageErrors.push(e.message));

  const payloads = { expense_records: expenseRecords, expense_accounts: rows("acc", 2, { type: "checking" }),
    expense_categories: rows("cat", 4), expense_payment_methods: rows("pm", 2) };
  await p.route("**://*.supabase.co/**", (r) => {
    const t = new URL(r.request().url()).pathname.split("/").pop();
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(payloads[t] || []) });
  });
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "/* stubbed */" }));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  // A Chart stub that records what it is given, so charts "render" without a canvas lib.
  await p.addInitScript(() => {
    window.__charts = [];
    window.Chart = function (ctx, cfg) {
      window.__charts.push({ id: (ctx && ctx.canvas && ctx.canvas.id) || "",
        type: cfg && cfg.type, labels: (cfg && cfg.data && cfg.data.labels) || [] });
      this.destroy = function () {}; this.update = function () {}; this.resize = function () {};
      // Lets a test click a specific month on the chart, which is how the
      // transactions drill-down is reached.
      this.getElementsAtEventForMode = function () { return [{ index: (window.__clickIdx || 0) }]; };
      this.data = cfg && cfg.data; this.options = cfg && cfg.options; this.scales = { x: {}, y: {} };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => {
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
    for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
  }, SHEETS);
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(8000);

  console.log("A. The page loads without script errors");
  {
    // The Chart stub has no real scales, so chart-internal reads of scales.x are
    // an artifact of the harness, not the app.
    const real = pageErrors.filter((m) => !/reading 'x'|reading 'y'|scales/.test(m));
    ok(real.length === 0, "A1 no page errors during load", real.slice(0, 4));
  }

  console.log("\nB. Every tab and sub-tab opens");
  const subtabs = await p.evaluate(async () => {
    const out = [];
    const inv = document.getElementById("tab-investment");
    if (inv) inv.click();
    await new Promise((r) => setTimeout(r, 600));
    const subs = [...document.querySelectorAll(".invest-sub-tab")];
    for (const s of subs) {
      s.click();
      await new Promise((r) => setTimeout(r, 700));
      out.push({ name: s.textContent.trim(), selected: s.getAttribute("aria-selected") });
    }
    const exp = document.getElementById("tab-expense");
    if (exp) exp.click();
    await new Promise((r) => setTimeout(r, 900));
    for (const s of [...document.querySelectorAll("[data-dash-exp-subtab]")]) {
      s.click(); await new Promise((r) => setTimeout(r, 500));
      out.push({ name: s.textContent.trim(), selected: s.getAttribute("aria-selected") });
    }
    const ov = document.getElementById("tab-overview"); if (ov) ov.click();
    await new Promise((r) => setTimeout(r, 600));
    return out;
  });
  ok(subtabs.length >= 6, "B1 every sub-tab was clicked", subtabs.map((s) => s.name));
  {
    const real = pageErrors.filter((m) => !/reading 'x'|reading 'y'|scales/.test(m));
    ok(real.length === 0, "B2 no page errors while walking the tabs", real.slice(0, 4));
  }

  console.log("\nC. No NaN, undefined or Infinity reaches the screen");
  {
    const bad = await p.evaluate(() => {
      const hits = [];
      document.querySelectorAll("body *").forEach((el) => {
        if (el.children.length) return;              // leaf text only
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) return;
        if (el.offsetParent === null && el.tagName !== "OPTION") return;  // not visible
        const t = (el.textContent || "").trim();
        if (!t) return;
        // Status lines echo caught exception messages; those are reported by the
        // page-error check, and here they are the Chart stub's doing.
        if (/^Chart error:/.test(t)) return;
        if (/\bNaN\b|\bundefined\b|\bInfinity\b|₹NaN|NaN%/.test(t)) hits.push(el.tagName + ": " + t.slice(0, 60));
      });
      return hits;
    });
    ok(bad.length === 0, "C1 no NaN/undefined/Infinity in any rendered leaf", bad.slice(0, 6));
  }

  console.log("\nD. Every holdings pill responds and stays consistent");
  {
    const cards = [
      { pf: "mfh-portfolio-toggle", oc: "mfh-open-toggle", name: "Mutual Fund" },
      { pf: "seh-portfolio-toggle", oc: "seh-open-toggle", name: "India" },
      { pf: "seh-us-portfolio-toggle", oc: "seh-us-open-toggle", name: "US" },
      { pf: "dbth-portfolio-toggle", oc: "dbth-open-toggle", name: "Debt" },
      { pf: "fih-portfolio-toggle", oc: "fih-open-closed", name: "Fixed Income" },
      { pf: "cmh-portfolio-toggle", oc: "cmh-open-closed", name: "Commodity" },
    ];
    for (const c of cards) {
      const res = await p.evaluate(async (c) => {
        const read = (id) => {
          const el = document.getElementById(id);
          if (!el) return null;
          return [...el.querySelectorAll("button")].map((b) => ({
            label: b.textContent.trim(), active: b.classList.contains("active"), disabled: b.disabled,
          }));
        };
        const before = read(c.pf);
        if (!before || before.length < 2) return { skipped: true, pf: before };
        // Click the first ENABLED, non-active pill and see if the highlight moves.
        const target = [...document.getElementById(c.pf).querySelectorAll("button")]
          .find((b) => !b.disabled && !b.classList.contains("active"));
        if (!target) return { skipped: true, reason: "nothing selectable" };
        const wanted = target.textContent.trim();
        target.click();
        await new Promise((r) => setTimeout(r, 900));
        const after = read(c.pf);
        const oc = read(c.oc);
        return { wanted, activeAfter: (after.find((x) => x.active) || {}).label,
                 exactlyOneActive: after.filter((x) => x.active).length === 1,
                 ocOneActive: oc ? oc.filter((x) => x.active).length === 1 : null,
                 ocBothDisabled: oc ? oc.every((x) => x.disabled) : null };
      }, c);
      if (res.skipped) { console.log("  SKIP  D " + c.name + " (" + (res.reason || "no pills in this fixture") + ")"); continue; }
      ok(res.activeAfter === res.wanted, "D " + c.name + ": clicking a pill moves the highlight", res);
      ok(res.exactlyOneActive, "D " + c.name + ": exactly one portfolio pill is active", res);
      ok(res.ocOneActive !== false, "D " + c.name + ": exactly one Open/Closed segment is active", res);
      ok(res.ocBothDisabled !== true, "D " + c.name + ": Open/Closed is not fully locked out", res);
    }
  }

  console.log("\nE. The monthly charts stop at the last month with data");
  {
    // Scoped to the two Expense-tab charts this rule is about. The Investments
    // CASH FLOW chart also starts at "Jan" but draws a full calendar year on
    // purpose — it has a year selector, and trimming it would hide months the user
    // has explicitly navigated to. Matching it here was accidental.
    const EXPENSE_MONTHLY = ["dash-exp-monthly-chart", "dash-exp-wf-chart"];
    const labels = await p.evaluate((ids) => (window.__charts || [])
      .filter((c) => ids.indexOf(c.id) !== -1 && (c.labels || []).indexOf("Jan") === 0)
      .map((c) => c.labels.join(",")), EXPENSE_MONTHLY);
    ok(labels.length >= 1, "E1 the monthly charts were built", labels);
    // The fixture's expense data runs Jan–Jul, so the axis must end at Jul. Asserting
    // the exact label set, not merely "no September": a one-month overrun draws
    // August, which a Sep-only check waves through. (test-month-columns.js pins the
    // arithmetic itself; this confirms the rendered chart actually uses it.)
    const WANT = ["Jan,Feb,Mar,Apr,May,Jun,Jul", "Jan,Feb,Mar,Apr,May,Jun,Jul,YTD"];
    ok(labels.length >= 2 && labels.every((l) => WANT.indexOf(l) !== -1),
       "E2 the monthly axes end at the last month with data (Jul), with no padding", labels);
  }

  console.log("\nF. Overview totals reconcile");
  {
    const prov = await p.evaluate(() => (window.wfOvProvenance ? window.wfOvProvenance() : null));
    ok(prov !== null, "F1 the overview store is reachable");
    if (prov) {
      ok(prov.staleWritesDropped === 0 || prov.staleWritesDropped === undefined,
         "F2 no stale writes were dropped (would mean a race repainted with old data)", prov.staleWritesDropped);
      const slices = prov.slices || {};
      const nan = Object.keys(slices).filter((k) => Object.keys(slices[k] || {})
        .some((f) => typeof slices[k][f] === "number" && !isFinite(slices[k][f])));
      ok(nan.length === 0, "F3 no non-finite value in any overview slice", nan);
    }
  }

  console.log("\nG. Expense tab still works end to end");
  {
    const res = await p.evaluate(async () => {
      const exp = document.getElementById("tab-expense"); if (exp) exp.click();
      await new Promise((r) => setTimeout(r, 900));
      const tiles = document.querySelectorAll("#dash-exp-accounts-tiles .acc-card").length;
      const btn = document.getElementById("rec-open-btn");
      const ov = document.getElementById("rec-modal-overlay");
      let opened = null;
      if (btn && ov) {
        btn.click();
        await new Promise((r) => setTimeout(r, 500));
        opened = !ov.hidden;
        const c = document.getElementById("rec-modal-cancel"); if (c) c.click();
      }
      return { tiles, opened, records: document.querySelectorAll("#rec-list .rec-item").length };
    });
    ok(res.tiles > 0, "G1 account tiles render", res);
    ok(res.opened === true, "G2 Add Record opens", res);
    ok(res.records > 0, "G3 the record list has rows", res);
  }

  console.log("\nH. Nothing broke while all of that was clicked");
  {
    const real = pageErrors.filter((m) => !/reading 'x'|reading 'y'|scales/.test(m));
    ok(real.length === 0, "H1 no page errors across the whole sweep", real.slice(0, 5));
    console.log("       (harness-only chart-stub errors suppressed: " + (pageErrors.length - real.length) + ")");
  }

  console.log("\nI. The Sold view of an FD-maturity month does not hang");
  {
    // A maturing FD is an outflow with no unit price, so the FIFO realized pass
    // produces no row for its month. The modal used to wait on THAT MONTH'S slice
    // of the realized data rather than on the data itself, so it resolved the
    // cached promise and re-opened itself forever. A month with both a deposit and
    // a maturity is what makes it reachable: without both, the Sold button is
    // disabled and the branch is never entered.
    const res = await Promise.race([
      p.evaluate(async () => {
        const sel = document.getElementById("monthly-invest-cat-year");
        if (sel) { sel.value = "2025"; sel.onchange && sel.onchange(); }
        await new Promise((r) => setTimeout(r, 800));
        window.__clickIdx = 8; // September
        const cv = document.querySelector("#monthly-invest-cat-wrap canvas");
        if (!cv) return { err: "no canvas" };
        cv.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        const ov = document.getElementById("mic-txn-overlay");
        const sold = document.querySelector('[data-txn-filter="out"]');
        const soldOffered = !!(sold && !sold.disabled);
        if (soldOffered) sold.click();
        await new Promise((r) => setTimeout(r, 800));
        return {
          opened: !!(ov && !ov.hidden), soldOffered,
          title: (document.getElementById("mic-txn-title") || {}).textContent || "",
          sub: (document.getElementById("mic-txn-sub") || {}).textContent || "",
          rows: document.querySelectorAll("#mic-txn-body tr").length,
          // The maturity row's P&L cell, and the modal footer's P&L total.
          cells: [...document.querySelectorAll("#mic-txn-body tr")]
            .filter((r) => /Maturity/.test(r.textContent))
            .map((r) => [...r.children].map((c) => c.textContent.trim())),
          footer: (document.getElementById("mic-txn-totals") || {}).textContent || "",
        };
      }),
      new Promise((r) => setTimeout(() => r({ hung: true }), 20000)),
    ]);
    ok(!res.hung, "I1 the page is still responsive after opening the Sold view", res);
    ok(res.opened === true, "I2 the drill-down opened on the maturity month", res.title);
    ok(res.soldOffered === true, "I3 Sold is offered — the month has both directions", res);
    ok(/sold/.test(res.sub || ""), "I4 the Sold view actually rendered", res.sub);
    ok(res.rows > 0, "I5 the maturity is listed", res.rows);
    // An FD has no units, so Buy/Sell Price stay blank — but its profit is known
    // exactly (the interest it paid) and must not render as a dash.
    const cells = (res.cells || [])[0] || [];
    const pnlCell = cells[cells.length - 1] || "";
    ok(/^[+\u2212-]\s*\u20b9/.test(pnlCell), "I7 the maturity shows its interest as P&L", cells);
    ok(pnlCell.indexOf("\u2014") === -1, "I8 the P&L cell is not a dash", pnlCell);
    ok(/P&L/.test(res.footer || ""), "I9 the footer totals it", res.footer);
    // Raced as well: with the loop back, the page's main thread never yields, so
    // an unraced evaluate would hang the whole suite instead of failing it.
    const alive = await Promise.race([
      p.evaluate(() => 1 + 1).catch(() => 0),
      new Promise((r) => setTimeout(() => r(0), 15000)),
    ]);
    ok(alive === 2, "I6 the page can still be evaluated afterwards", alive);
  }

  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
  process.exit(fail ? 1 : 0);
})();
