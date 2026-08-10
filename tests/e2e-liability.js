// Settings → Liability: a recurring payment that knows what debt it is paying.
//
// The tab is deliberately the Recurring-payments tab with the loan recorded, so
// the assertions are about the two things that are easy to get wrong when you
// clone a tab: that the two lists are stored separately (a liability must not
// appear under Recurring payments, or be wiped when one is saved), and that
// editing preserves the paid-instalment counter — rebuilding the row from the
// form would reset it and let expense.js re-post instalments already charged.
//
//     python3 -m http.server 8096 &
//     node tests/e2e-liability.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8096;

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1200 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => r.fulfill(j([])));
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.sheetjs.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**/*.json*", (r) => r.fulfill(j({})));

  await p.goto(`http://127.0.0.1:${PORT}/settings.html?nosw=1`, { waitUntil: "domcontentloaded" });
  // settings.html bounces to index.html when signed out.
  await p.evaluate(() => { localStorage.clear();
    localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } })); });
  await p.goto(`http://127.0.0.1:${PORT}/settings.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(600);
  await p.click("#tab-expense");
  await p.waitForTimeout(400);

  // L1 — the tab exists, and sits directly below Recurring payments.
  const navOrder = await p.$$eval(".exp-nav-item[data-exp-panel]",
    (els) => els.map((e) => e.getAttribute("data-exp-panel")));
  const iRec = navOrder.indexOf("recurring"), iLia = navOrder.indexOf("liability");
  ok(iLia !== -1, "L1 a Liability tab is present in the Expense settings nav", navOrder);
  ok(iRec !== -1 && iLia === iRec + 1,
     "L2 and it sits immediately below Recurring payments", navOrder);

  await p.click('.exp-nav-item[data-exp-panel="liability"]');
  await p.waitForTimeout(300);
  ok(await p.isVisible("#exp-detail-liability"),
     "L3 clicking it opens the Liability panel");
  ok(!(await p.isVisible("#exp-detail-recurring")),
     "L4 and closes the Recurring payments panel");
  ok((await p.textContent("#exp-liability-status")).includes("No liabilities yet"),
     "L5 an empty tab says so rather than showing a blank list");

  // L6 — add one.
  await p.click("#exp-add-liability-btn");
  await p.waitForTimeout(300);
  ok(await p.isVisible("#lb-modal-overlay"), "L6 the add button opens the modal");

  await p.fill("#lb-name", "Home loan");
  await p.fill("#lb-lender", "HDFC Bank");
  await p.fill("#lb-principal", "5000000");
  await p.fill("#lb-rate", "8.5");
  await p.fill("#lb-amount", "45000");
  await p.fill("#lb-next-due", "2026-09-01");
  await p.fill("#lb-num-payments", "240");
  await p.click("#lb-modal-save");
  await p.waitForTimeout(400);

  const card = await p.evaluate(() => {
    const el = document.querySelector("#exp-liability-list .wf-item-card");
    return el ? el.textContent.replace(/\s+/g, " ").trim() : null;
  });
  console.log("  card: " + card);
  ok(card && /Home loan/.test(card), "L7 the liability is listed", card);
  ok(card && /HDFC Bank/.test(card), "L8 with its lender", card);
  ok(card && /8\.5%/.test(card), "L9 and its interest rate", card);
  ok(card && /₹45,000/.test(card), "L10 the headline figure is the instalment", card);
  ok(card && /₹50,00,000/.test(card), "L11 and the principal is shown separately", card);
  // 240 unpaid instalments of ₹45,000 — what is left on the plan.
  ok(card && /₹1,08,00,000/.test(card),
     "L12 'left to pay' is the remaining instalments, not the principal", card);

  // L13 — the two lists are separate stores.
  const stored = await p.evaluate(() => ({
    lia: JSON.parse(localStorage.getItem("wf-liabilities") || "[]"),
    rec: JSON.parse(localStorage.getItem("wf-recurring-payments") || "null"),
  }));
  ok(stored.lia.length === 1 && stored.lia[0].row.type === "expense",
     "L13 it is stored under its own key, as an expense", stored.lia);
  ok(!stored.rec || stored.rec.length === 0,
     "L14 and does not leak into the recurring-payments list", stored.rec);
  await p.click('.exp-nav-item[data-exp-panel="recurring"]');
  await p.waitForTimeout(300);
  ok((await p.textContent("#exp-recurring-status")).includes("No recurring payments"),
     "L15 the Recurring payments tab still shows nothing");

  // L16 — an edit must not reset the paid counter.
  await p.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("wf-liabilities"));
    list[0].row.installments_done = 7;
    localStorage.setItem("wf-liabilities", JSON.stringify(list));
  });
  await p.click('.exp-nav-item[data-exp-panel="liability"]');
  await p.waitForTimeout(300);
  await p.click("[data-lb-edit]");
  await p.waitForTimeout(400);
  ok(await p.inputValue("#lb-name") === "Home loan",
     "L16 editing opens the modal populated from the saved liability");
  await p.fill("#lb-amount", "47000");
  await p.click("#lb-modal-save");
  await p.waitForTimeout(400);
  const afterEdit = await p.evaluate(() => JSON.parse(localStorage.getItem("wf-liabilities")));
  ok(afterEdit.length === 1 && afterEdit[0].row.amount === 47000,
     "L17 the edit is saved in place rather than adding a second entry", afterEdit);
  ok(afterEdit[0].row.installments_done === 7,
     "L18 and the paid-instalment counter survives it — otherwise the " +
     "processor would re-post seven charged instalments", afterEdit[0].row);

  // L19 — delete leaves a tombstone so the delete propagates to other devices.
  await p.click("[data-lb-del]");
  await p.waitForTimeout(400);
  const afterDel = await p.evaluate(() => JSON.parse(localStorage.getItem("wf-liabilities")));
  ok(afterDel.length === 1 && afterDel[0]._deleted === true,
     "L19 deleting writes a tombstone, not a silent local removal", afterDel);
  ok((await p.textContent("#exp-liability-status")).includes("No liabilities yet"),
     "L20 and the tombstoned row is not rendered");

  ok(errs.length === 0, "Z1 no page errors", errs.slice(0, 3));

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
