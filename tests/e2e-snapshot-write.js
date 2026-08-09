// Net-worth snapshots, as actually written by a real page load.
//
// test-snapshots.js proves the rules in isolation. This proves the wiring: that
// a load reaches them at all, that what it posts is the number on the screen,
// and — the part that matters, because a snapshot is permanent — that a load
// which shouldn't record anything doesn't.
//
// Every assertion reads the intercepted PostgREST request, not the code.
//
//     python3 -m http.server 8099 &
//     node tests/e2e-snapshot-write.js
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8099;

const FD_HDR = ["Transaction Date", "Portfolio Name", "Bank", "Instrument Name", "Instrument Category",
  "Instrument Sub Category", "Transaction Type", "Invested Amount", "Maturity Date/Sell Date", "Rate of Return", "Grams"];
const TXN = ["Transaction Date", "Portfolio Name", "Instrument Name", "Transaction Type", "Units", "Price"];

const sheets = {
  "wf-equity-data": [TXN,
    ["1-Jan-2024", "Snnehal", "Aurora Fund", "Buy", "100", "10"],
    ["1-Jan-2024", "Trisha", "Aurora Fund", "Buy", "50", "10"]],
  "wf-mfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Scheme Code", "ISIN"],
    ["Aurora Fund", "Equity", "Flexi Cap", "100001", "INFA"]],
  "wf-stocksetf-data": [TXN],
  "wf-stocksetfmapping-data": [["Instrument Name", "Instrument Category", "Instrument Sub Category", "Market Segment", "Region", "Identifier", "Sector"]],
  "wf-fd-data": [FD_HDR,
    ["1-Apr-2020", "Snnehal", "HDFC", "Deposit One", "Fixed Income", "Fixed Deposit", "Deposit", "500000", "1-Apr-2030", "7%", ""]],
  "wf-fixedincome-data": [["Transaction Date", "Portfolio Name", "Instrument Name", "Instrument Category", "Instrument Sub Category", "Transaction Type", "Amount"]],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

const localToday = () => {
  const d = new Date(), m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
};

// NAV history so the Account Value chart has a timeline for the backfill to walk.
const monthlyNav = () => {
  const out = [];
  const now = new Date();
  for (let i = 30; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
    if (d < new Date(2024, 0, 1)) continue;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    out.push({ date: dd + "-" + mm + "-" + d.getFullYear(), nav: String(10 + i * 0.05) });
  }
  return out;
};

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1200 } });
  const p = await ctx.newPage();

  const snapPosts = [];   // every write aimed at net_worth_snapshots
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));

  const j = (body) => ({ status: 200, contentType: "application/json",
    headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });

  await p.route("**://*.supabase.co/**", (r) => {
    const req = r.request();
    const url = req.url();
    if (/net_worth_snapshots/.test(url)) {
      if (req.method() === "POST") {
        let body = null;
        try { body = JSON.parse(req.postData() || "null"); } catch (e) {}
        snapPosts.push({ url, headers: req.headers(), rows: Array.isArray(body) ? body : [body] });
        return r.fulfill({ status: 201, contentType: "application/json",
          headers: { "access-control-allow-origin": "*" }, body: "[]" });
      }
      return r.fulfill(j([]));          // SELECT: nothing recorded yet
    }
    return r.fulfill(j([]));
  });
  await p.route("**://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://*.currency-api.pages.dev/**", (r) => r.fulfill(j({ xau: { inr: 311035 } })));
  await p.route("**://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await p.route("**://api.mfapi.in/**", (r) => r.fulfill(j({ data: monthlyNav() })));
  await p.route("**/mf_history.json*", (r) => r.fulfill(j({ mf_history: { "100001": monthlyNav() } })));
  await p.route("**/amfi_isin_map.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(), data: { INFA: "100001" } })));
  await p.route("**/amfi_nav.json*", (r) => r.fulfill(j({ fetchedAt: Date.now(),
    data: { "100001": { date: "01-Aug-2026", nav: "12.5" } } })));
  await p.route("**/stock_prices.json*", (r) => r.fulfill(j({ prices: { __USD_INR__: { price: 84 } }, usd_inr_history: {}, index_history: {} })));
  await p.route("**/stock_history.json*", (r) => r.fulfill(j({ stock_history: {} })));

  await p.addInitScript(() => {
    window.Chart = function (c, cfg) {
      this.data = cfg.data; this.options = cfg.options; this.scales = { x: {}, y: {} };
      this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
      this.zoomScale = function () {}; this.resetZoom = function () {}; this.destroy = function () {};
      this.update = function () {}; this.resize = function () {};
      this.getElementsAtEventForMode = function () { return []; };
    };
    window.Chart.register = function () {}; window.Chart.defaults = { font: {} };
  });

  const seed = async (extra) => {
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "domcontentloaded" });
    await p.evaluate(([s, x]) => {
      localStorage.clear();
      localStorage.setItem("wf-sb-session", JSON.stringify({ access_token: "x",
        expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "a@b.c" } }));
      for (const k in s) localStorage.setItem(k, JSON.stringify(s[k]));
      for (const k in (x || {})) localStorage.setItem(k, x[k]);
    }, [sheets, extra || {}]);
  };

  const load = async (waitMs) => {
    snapPosts.length = 0; errs.length = 0;
    await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
    await p.waitForTimeout(waitMs || 14000);   // load + the writer's stability wait
  };

  const liveRows = () => snapPosts.flatMap((q) => q.rows).filter((r) => r && r.meta && r.meta.source === "live");
  const backRows = () => snapPosts.flatMap((q) => q.rows).filter((r) => r && r.meta && r.meta.source === "backfill");

  // ── A normal, unfiltered load records exactly one row ────────────────────
  await seed();
  await load();
  const live = liveRows();
  console.log("  posts=" + snapPosts.length + " live=" + live.length + " backfill=" + backRows().length +
              " errs=" + JSON.stringify(errs.slice(0, 2)));
  ok(errs.length === 0, "S0 the load throws nothing", errs.slice(0, 3));
  ok(live.length === 1, "S1 an unfiltered load records exactly one snapshot", live);

  if (live.length === 1) {
    const row = live[0];
    ok(row.snapshot_date === localToday(),
       "S2 filed under today's LOCAL date", { got: row.snapshot_date, want: localToday() });

    // The stored number is the one on the screen. Anything else and the table is
    // a second, silently-disagreeing source of truth.
    const shown = await p.evaluate(() => {
      const el = document.getElementById("overview-total-current-value");
      return el ? (el.textContent || "").replace(/[^0-9.]/g, "") : "";
    });
    const shownNum = Math.round(parseFloat(shown) || 0);
    ok(shownNum > 0 && Math.abs(row.total - shownNum) <= Math.max(2, shownNum * 0.005),
       "S3 the stored total is the total displayed on the Overview",
       { stored: row.total, shown: shownNum });

    ok(row.equity > 0 && row.fixed_income > 0,
       "S4 the category split is stored, not left null", row);
    ok(Math.abs((row.equity + row.fixed_income + (row.commodity || 0)) - row.total) <= Math.max(2, row.total * 0.005),
       "S5 and it sums to the total", row);
    ok(row.by_portfolio && Object.keys(row.by_portfolio).length === 2,
       "S6 both portfolios are broken out", row.by_portfolio);
    ok(row.user_id === "u1", "S7 the row is scoped to the signed-in user", row.user_id);
  }

  const q = snapPosts.find((x) => (x.rows || []).some((r) => r && r.meta && r.meta.source === "live"));
  if (q) {
    ok(/on_conflict=user_id%2Csnapshot_date|on_conflict=user_id,snapshot_date/.test(q.url),
       "S8 written as an upsert on (user_id, snapshot_date)", q.url);
    ok(/merge-duplicates/.test(q.headers["prefer"] || ""),
       "S9 with merge-duplicates, so a second load of the day updates rather than 409s",
       q.headers["prefer"]);
  } else { ok(false, "S8/S9 no live post to inspect"); }

  // ── Backfill: reconstructed month ends, marked as reconstructions ────────
  const back = backRows();
  ok(back.length > 0, "S10 past month ends are backfilled from the Account Value series", back.length);
  if (back.length) {
    ok(back.every((r) => r.meta.backfilled === true),
       "S11 every backfilled row says so — it came from the derivation this table exists to escape");
    ok(back.every((r) => r.equity === null && r.invested === null),
       "S12 with null category columns rather than invented zeros",
       back.slice(0, 2));
    ok(back.every((r) => r.snapshot_date.slice(0, 7) < localToday().slice(0, 7)),
       "S13 and never in the current month, which the live writer owns",
       back.map((r) => r.snapshot_date).slice(0, 3));
    ok(new Set(back.map((r) => r.snapshot_date)).size === back.length,
       "S14 one row per month, no duplicates");
  }

  // ── A filtered load records nothing ──────────────────────────────────────
  // One portfolio's share stored as net worth would be indistinguishable from a
  // real crash. This is the assertion that would catch it.
  await seed({ "wf-selected-portfolio": "Snnehal" });
  await load();
  console.log("  filtered: live=" + liveRows().length + " total posts=" + snapPosts.length);
  ok(liveRows().length === 0,
     "S15 a load filtered to one portfolio records no snapshot", liveRows());

  // ── Fixed income hidden: nothing is written, live OR backfilled ──────────
  // The live rules refuse this case. The backfill bypasses them entirely — it
  // reads the Account Value series, which honours the same toggle — so it has to
  // refuse for itself or it writes years of understated history.
  await seed({ "wf-exclude-fixedincome": "true" });
  await load();
  console.log("  fi-excluded: live=" + liveRows().length + " backfill=" + backRows().length);
  ok(liveRows().length === 0, "S15b no live snapshot with fixed income excluded", liveRows());
  ok(backRows().length === 0, "S15c and no backfill either", backRows().slice(0, 2));

  // ── Same day, already recorded, unchanged ────────────────────────────────
  await seed();
  await load();
  const firstAgain = liveRows();
  ok(firstAgain.length === 1, "S16 (setup) a fresh profile records once", firstAgain.length);
  snapPosts.length = 0;
  await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`, { waitUntil: "load" });
  await p.waitForTimeout(14000);
  ok(liveRows().length === 0,
     "S17 reloading the same day does not re-post an unchanged snapshot", liveRows());

  await b.close();
  console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
