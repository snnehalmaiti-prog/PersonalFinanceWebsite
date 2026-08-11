// Every tab, on both pages, visited in turn.
//
// The suites here go deep on one card at a time, which leaves a gap they cannot
// see: a tab nobody's test opens. A panel can throw on show, stay on "Loading…"
// for ever, or render nothing, and every existing suite still passes because
// none of them look at it. Settings' six tabs had no coverage at all.
//
// So this one is broad and shallow on purpose. For each tab it asks only what a
// person opening it would notice: did the page throw, did the panel actually
// appear, did the ones beside it go away, and is there something in it besides a
// spinner. Depth belongs in the per-card suites.
//
//     python3 -m http.server 8105 &
//     node tests/e2e-tab-sweep.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8105;

const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

// Enough of everything that every panel has something real to draw: a fund, a
// US stock, an India stock, a deposit, a savings balance, provident fund and
// gold. A fixture that leaves a panel empty cannot tell "renders nothing"
// from "has nothing to render".
const SHEETS = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Aurora Fund", "Buy", "1000", "10"],
    ["1-Feb-2024", "Trisha", "Aurora Fund", "Buy", "500", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Aurora Fund", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Alpha Corp", "Buy", "100", "5"],
    ["1-Jan-2024", "Snnehal", "Desi Ltd", "Buy", "100", "50"]],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"],
    ["Alpha Corp", "Equity", "Stock", "Large Cap", "US", "ALPHA", "Tech"],
    ["Desi Ltd", "Equity", "Stock", "Large Cap", "India", "DESI", "Tech"]],
  "wf-fd-data": [FD_HDR,
    ["1-Apr-2022", "Snnehal", "HDFC", "Deposit One", "Fixed Income", "Fixed Deposit", "Deposit", "500000", "1-Apr-2030", "7%", ""],
    ["1-Jan-2023", "Snnehal", "HDFC", "Savings A", "Fixed Income", "Savings Account", "Deposit", "300000", "", "", ""],
    ["1-Jan-2023", "Trisha", "EPFO", "PF", "Fixed Income", "Provident Fund", "Deposit", "200000", "", "", ""],
    ["1-Jun-2023", "Snnehal", "MMTC", "Gold Coin", "Commodity", "Gold", "Buy", "100000", "", "", "20"]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

const monthlyNav = () => {
  const out = [];
  const now = new Date();
  for (let i = 30; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    if (d < new Date(2024, 0, 1)) continue;
    out.push({ date: String(d.getDate()).padStart(2, "0") + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" + d.getFullYear(), nav: String(10 + i * 0.05) });
  }
  return out;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();

  // Page errors are collected per tab, so a failure names the tab that caused
  // it rather than the run as a whole.
  let errs = [];
  p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
  await p.route("**://*.supabase.co/**", (r) => {
    const req = r.request();
    if (req.method() === "POST" || req.method() === "PATCH") {
      return r.fulfill({ status: 201, contentType: "application/json",
        headers: { "access-control-allow-origin": "*" }, body: "[]" });
    }
    return r.fulfill(j([]));
  });
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://*.currency-api.pages.dev/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://cdn.sheetjs.com/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: monthlyNav() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: { "100001": monthlyNav() } })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: "01-Aug-2026", nav: "12.5" } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({
    prices: { __USD_INR__: { price: 84 },
      ALPHA: { price: 6, prev_close: 5.8, currency: "USD" },
      DESI: { price: 60, prev_close: 59 } },
    usd_inr_history: { "2024-01-01": 83 }, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.type = cfg.type; this.data = cfg.data; this.options = cfg.options;
      this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  const seed = async () => {
    await p.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      localStorage.setItem("wf-selected-portfolio", "all");
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
    }, SHEETS);
  };

  // Visible text of a panel, with the whitespace collapsed — enough to tell an
  // empty panel from one that drew something.
  const panelState = (id) => p.evaluate((pid) => {
    const el = document.getElementById(pid);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    return {
      hidden: !!el.hidden, height: Math.round(r.height), chars: text.length,
      loading: /Loading…|Loading\.\.\./.test(text),
      // "Couldn't", "failed", "error" in visible text — a panel that rendered an
      // error message is not a panel that worked.
      errorText: (text.match(/Could ?n[o']t [a-z ]+|failed to [a-z ]+/i) || [])[0] || null,
      sample: text.slice(0, 90),
    };
  }, id);

  // ── dashboard.html ──────────────────────────────────────────────────────
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
  await seed();
  errs = [];
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(8000);

  const DASH_TABS = [
    { tab: "overview", panel: "panel-overview" },
    { tab: "investment", panel: "panel-investment" },
    { tab: "expense", panel: "panel-expense" },
  ];

  for (const t of DASH_TABS) {
    errs = [];
    await p.evaluate((name) => {
      const btn = document.querySelector('[data-tab="' + name + '"]');
      if (btn) btn.click();
    }, t.tab);
    await p.waitForTimeout(3000);

    const st = await panelState(t.panel);
    console.log("  " + t.tab + ": " + JSON.stringify(st));
    ok(st && !st.hidden, "D-" + t.tab + "-1 the panel is shown", st);
    ok(st && st.height > 100, "D-" + t.tab + "-2 and has actually laid out", st);
    ok(st && st.chars > 80, "D-" + t.tab + "-3 with content in it, not an empty shell", st);
    ok(st && !st.loading, "D-" + t.tab + "-4 and is not still saying 'Loading…'", st);
    ok(st && !st.errorText, "D-" + t.tab + "-5 nor showing an error", st && st.errorText);
    ok(errs.length === 0, "D-" + t.tab + "-6 opening it threw nothing", errs.slice(0, 2));

    // The others must be gone, or two panels stack and the page reads as one
    // long broken screen.
    const siblings = await p.evaluate((keep) =>
      ["panel-overview", "panel-investment", "panel-expense"]
        .filter((id) => id !== keep)
        .map((id) => ({ id, hidden: !!(document.getElementById(id) || {}).hidden })), t.panel);
    ok(siblings.every((s) => s.hidden),
       "D-" + t.tab + "-7 and the other tabs' panels are hidden", siblings);
  }

  // The Investments tab's three sub-tabs, which nothing else sweeps.
  await p.evaluate(() => {
    const btn = document.querySelector('[data-tab="investment"]');
    if (btn) btn.click();
  });
  await p.waitForTimeout(1500);
  for (const sub of ["equity", "stocksetf", "fixedincome"]) {
    errs = [];
    await p.evaluate((id) => {
      const b2 = document.getElementById("subtab-" + id);
      if (b2) b2.click();
    }, sub);
    await p.waitForTimeout(3000);
    const st = await panelState("panel-" + sub);
    console.log("  investment/" + sub + ": " + JSON.stringify(st));
    ok(st && !st.hidden, "I-" + sub + "-1 the sub-panel is shown", st);
    ok(st && st.chars > 80, "I-" + sub + "-2 with content in it", st);
    ok(st && !st.loading, "I-" + sub + "-3 and not still loading", st);
    ok(st && !st.errorText, "I-" + sub + "-4 nor showing an error", st && st.errorText);
    ok(errs.length === 0, "I-" + sub + "-5 opening it threw nothing", errs.slice(0, 2));
  }

  // ── settings.html ───────────────────────────────────────────────────────
  // Six tabs, none of which had any coverage before this suite.
  await p.goto(`http://127.0.0.1:${PORT}/settings.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(3000);
  ok(/settings\.html/.test(p.url()),
     "S0 settings loads for a signed-in user rather than bouncing to the sign-in page",
     p.url());

  const SET_TABS = [
    { tab: "tab-profile", panel: "panel-profile" },
    { tab: "tab-transactions", panel: "panel-transactions" },
    { tab: "tab-mapping", panel: "panel-mapping" },
    { tab: "tab-expense", panel: "panel-expense" },
    { tab: "tab-github", panel: "panel-github" },
    { tab: "tab-epf", panel: "panel-epf" },
  ];
  const SET_PANELS = SET_TABS.map((t) => t.panel);

  for (const t of SET_TABS) {
    errs = [];
    const clicked = await p.evaluate((id) => {
      const btn = document.getElementById(id);
      if (!btn) return false;
      btn.click();
      return true;
    }, t.tab);
    ok(clicked, "S-" + t.tab + "-0 the tab exists", t.tab);
    await p.waitForTimeout(1200);

    const st = await panelState(t.panel);
    console.log("  " + t.tab + ": " + JSON.stringify(st));
    ok(st && !st.hidden, "S-" + t.tab + "-1 the panel is shown", st);
    ok(st && st.chars > 40, "S-" + t.tab + "-2 with content in it", st);
    ok(st && !st.errorText, "S-" + t.tab + "-3 and no error on it", st && st.errorText);
    ok(errs.length === 0, "S-" + t.tab + "-4 opening it threw nothing", errs.slice(0, 2));

    const siblings = await p.evaluate((args) =>
      args.all.filter((id) => id !== args.keep)
        .map((id) => ({ id, hidden: !!(document.getElementById(id) || {}).hidden })),
      { all: SET_PANELS, keep: t.panel });
    ok(siblings.every((s) => s.hidden),
       "S-" + t.tab + "-5 and every other panel is hidden", siblings.filter((s) => !s.hidden));
  }

  // The Expense tab's own left-nav, six panels deep, none of it swept before.
  await p.evaluate(() => { const b2 = document.getElementById("tab-expense"); if (b2) b2.click(); });
  await p.waitForTimeout(800);
  const EXP_PANELS = ["accounts", "payment-methods", "categories", "template", "recurring", "liability", "import"];
  for (const name of EXP_PANELS) {
    errs = [];
    const clicked = await p.evaluate((n) => {
      const btn = document.querySelector('.exp-nav-item[data-exp-panel="' + n + '"]');
      if (!btn) return false;
      btn.click();
      return true;
    }, name);
    ok(clicked, "E-" + name + "-0 the section exists in the Expense nav", name);
    await p.waitForTimeout(700);
    const st = await panelState("exp-detail-" + name);
    console.log("  expense/" + name + ": " + JSON.stringify(st && st.sample));
    ok(st && !st.hidden, "E-" + name + "-1 the section is shown", st);
    ok(st && st.chars > 20, "E-" + name + "-2 with content in it", st);
    ok(errs.length === 0, "E-" + name + "-3 opening it threw nothing", errs.slice(0, 2));
  }

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
