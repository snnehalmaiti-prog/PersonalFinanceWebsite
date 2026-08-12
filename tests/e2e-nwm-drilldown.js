// Clicking a month in NET WORTH · MONTHLY says which sub-categories moved it.
//
// The card charts market movement as a residual, so there is nothing stored to
// drill into; the panel rebuilds the parts per sub-category from today's sheets
// and price history. Those are different sources from the recorded snapshot the
// bar came from, so the panel carries an Unattributed line, and the property
// this suite defends is that the line is TOLD rather than absorbed:
//
//     Attributed + Unattributed = Market
//
// must hold on screen, in the figures the reader can see, not just in the
// kernel's return value.
//
// The fixture moves NAVs and prices month to month on purpose. With flat prices
// only one holding ever moves, every "several sub-categories" assertion passes
// on a single row, and the grouping is never really exercised.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-nwm-drilldown.js
"use strict";
const { chromium } = require("./_launch");
const PORT = process.env.PORT || 8098;
const TXN=["Transaction Date","Portfolio Name","Instrument Name","Transaction Type","Units","Price"];
const FDH=["Transaction Date","Portfolio Name","Bank","Instrument Name","Instrument Category","Instrument Sub Category","Transaction Type","Invested Amount","Maturity Date/Sell Date","Rate of Return","Grams"];
const SHEETS={
 "wf-equity-data":[TXN,["1-Jan-2024","Snnehal","Fund A","Buy","1000","10"],["1-Mar-2024","Trisha","Fund B","Buy","500","20"]],
 "wf-mfmapping-data":[["Instrument Name","Instrument Category","Instrument Sub Category","Scheme Code","ISIN"],
   ["Fund A","Equity","Flexi Cap","100001","INFA"],["Fund B","Equity","Large Cap","100002","INFB"]],
 "wf-stocksetf-data":[TXN,["1-Feb-2024","Snnehal","GOLDBEES","Buy","100","50"]],
 "wf-stocksetfmapping-data":[["Instrument Name","Instrument Category","Instrument Sub Category","Market Segment","Region","Identifier","Sector"],
   ["GOLDBEES","Commodity","Gold ETF","ETF","India","GOLDBEES","Gold"]],
 "wf-fd-data":[FDH,
   ["1-Jan-2024","Snnehal","HDFC","FD-1","Fixed Income","Fixed Deposit","Buy","100000","1-Jan-2027","7",""],
   ["1-Jan-2024","Trisha","EPFO","PF-1","Fixed Income","Provident Fund","Buy","50000","","",""],
   ["1-Jan-2024","Snnehal","—","Physical Gold","Commodity","Gold","Buy","","","","10"]],
 "wf-fixedincome-data":[["Transaction Date","Portfolio Name","Instrument Name","Instrument Category","Instrument Sub Category","Transaction Type","Amount"]],
};
const DAYS=(()=>{const o=[];const d=new Date("2024-01-01T00:00:00"),e=new Date();while(d<=e){o.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1);}return o;})();
const dmy=iso=>{const[y,m,d]=iso.split("-");return `${d}-${m}-${y}`;};
(async()=>{
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1500,height:900}});
 const p=await ctx.newPage();const errs=[];p.on("pageerror",e=>errs.push(e.message));
 const j=body=>({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify(body)});
 let snapshotRows=[];
 await p.route("**://*.supabase.co/**",r=>{
   if(/net_worth_snapshots/.test(r.request().url())) return r.fulfill(j(snapshotRows));
   return r.fulfill(j([]));
 });
 await p.route("**://fonts.googleapis.com/**",r=>r.fulfill({status:200,contentType:"text/css",body:""}));
 await p.route("**/xau.min.json*",r=>r.fulfill(j({xau:{inr:311035}})));
 await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**",r=>r.fulfill(j({xau:{inr:311035}})));
 await p.route("**://cdn.jsdelivr.net/**",r=>r.fulfill({status:200,contentType:"text/javascript",body:""}));
 const navA=iso=>(10+ (new Date(iso).getMonth()+1)*0.5).toFixed(4);
 const navB=iso=>(20 - (new Date(iso).getMonth()+1)*0.3).toFixed(4);
 const pxG=iso=>+(50 + (new Date(iso).getMonth()+1)*1.2).toFixed(2);
 await p.route("**://api.mfapi.in/**",r=>r.fulfill(j({data:DAYS.map(i=>({date:dmy(i),nav:navA(i)})).reverse()})));
 await p.route("**/mf_history.json*",r=>r.fulfill(j({updated:new Date().toISOString(),mf_history:{"100001":Object.fromEntries(DAYS.map(i=>[i,+navA(i)])),"100002":Object.fromEntries(DAYS.map(i=>[i,+navB(i)]))}})));
 await p.route("**/amfi_isin_map.json*",r=>r.fulfill(j({fetchedAt:Date.now(),data:{INFA:"100001",INFB:"100002"}})));
 await p.route("**/amfi_nav.json*",r=>r.fulfill(j({fetchedAt:Date.now(),data:{"100001":{date:"01-Aug-2026",nav:navA("2026-08-01")},"100002":{date:"01-Aug-2026",nav:navB("2026-08-01")}}})));
 await p.route("**/stock_prices.json*",r=>r.fulfill(j({prices:{__USD_INR__:{price:84},GOLDBEES:{price:60}},usd_inr_history:{},index_history:{}})));
 await p.route("**/stock_history.json*",r=>r.fulfill(j({stock_history:{GOLDBEES:{currency:"INR",prices:Object.fromEntries(DAYS.map(i=>[i,pxG(i)]))}}})));
 await p.addInitScript(()=>{window.Chart=function(c,cfg){this.data=cfg.data;this.options=cfg.options;this.scales={x:{},y:{}};this.chartArea={left:0,right:800,top:0,bottom:300};this.destroy=function(){};this.update=function(){};this.resize=function(){};this.zoomScale=function(){};this.resetZoom=function(){};this.getElementsAtEventForMode=function(){return[]};};window.Chart.register=function(){};window.Chart.defaults={font:{}};});
 await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`,{waitUntil:"domcontentloaded"});
 await p.evaluate(s=>{localStorage.clear();localStorage.setItem("wf-sb-session",JSON.stringify({access_token:"x",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"u1",email:"a@b.c"}}));localStorage.setItem("wf-gold-premium-pct","0");for(const k in s)localStorage.setItem(k,JSON.stringify(s[k]));},SHEETS);
 await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`,{waitUntil:"load"});
 await p.waitForTimeout(12000);
 const monthly=await p.evaluate(()=>window.__wfNwmProbe("all"));
 if(!Array.isArray(monthly)){console.log("probe failed",monthly);await b.close();return;}
 // Snapshots that agree with the valuations: any leftover then comes from the
 // model (contributions/interest), not from the two sources disagreeing.
 // by_portfolio as well as the total: NET WORTH · MONTHLY reads one portfolio's
 // share out of each snapshot's stored split, so without it the Trisha view has
 // no bars and every per-portfolio assertion below would be testing an error
 // object rather than a drill-down.
 const perPf = {};
 for (const name of ["Snnehal", "Trisha"]) {
   const r = await p.evaluate((x) => window.__wfNwmProbe(x), name);
   perPf[name] = Array.isArray(r) ? Object.fromEntries(r.map((m) => [m.month, m.sum])) : {};
 }
 snapshotRows=monthly.map(m=>{
   const [y,mm]=m.month.split("-");
   const eom=new Date(+y,+mm,0);
   const iso=eom.getFullYear()+"-"+String(eom.getMonth()+1).padStart(2,"0")+"-"+String(eom.getDate()).padStart(2,"0");
   return {snapshot_date:iso,total:m.sum,meta:{source:"live"},
           by_portfolio:{Snnehal:perPf.Snnehal[m.month]||0, Trisha:perPf.Trisha[m.month]||0}};
 });
 await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`,{waitUntil:"load"});
 await p.waitForTimeout(12000);
 let pass=0, fail=0;
 const ok=(c,n,d)=>{ if(c){pass++;console.log("  PASS  "+n);} else {fail++;console.log("  FAIL  "+n+(d!==undefined?"  → "+JSON.stringify(d):""));} };
 // formatCurrency renders compact Indian units, so "−₹1.07 CR" is −1,07,00,000
 // and not −1.07. Stripping non-digits and comparing would put crores, lakhs and
 // rupees on one scale and make any sum of them meaningless — which is exactly
 // what the first version of D8 did.
 const money = (t) => {
   const str = String(t || "");
   const n = Number(str.replace(/[^0-9.]/g, "")) || 0;
   const mult = /\bCR\b/i.test(str) ? 1e7 : /\bL\b/i.test(str) ? 1e5 : /\bK\b/i.test(str) ? 1e3 : 1;
   return (/−|-/.test(str) ? -n : n) * mult;
 };

 const clickLast = () => p.evaluate(() => {
   const c = window.__wfNwmChart;
   if (!c) return { err: "no chart" };
   let idx = -1;
   for (let i = c.data.labels.length - 1; i >= 0; i--) {
     if (c.data.datasets.some((d) => d.data[i] != null)) { idx = i; break; }
   }
   if (idx < 0) return { err: "no filled bar" };
   c.options.onClick({}, [{ index: idx, datasetIndex: 0 }], c);
   const ov = document.getElementById("nwm-drill-overlay");
   const rows = [...document.querySelectorAll("#nwm-drill-body tbody tr")]
     .map((tr) => [...tr.children].map((td) => td.textContent.trim()));
   const totals = {};
   document.querySelectorAll("#nwm-drill-totals .mic-hs-tot").forEach((el) => {
     totals[(el.querySelector(".mic-hs-tot-label") || {}).textContent] =
       (el.querySelector("b") || {}).textContent; });
   return { label: c.data.labels[idx], open: ov && !ov.hidden, totals, rows,
            sub: (document.getElementById("nwm-drill-sub") || {}).textContent,
            headers: [...document.querySelectorAll("#nwm-drill-body thead th")].map((t) => t.textContent.trim()) };
 });

 const r1 = await clickLast();
 console.log("  " + JSON.stringify({ label: r1.label, totals: r1.totals, rows: r1.rows.length }));
 ok(!r1.err && r1.open, "D1 clicking a month opens the drill-down", r1);
 ok(/All portfolios/.test(r1.sub || ""), "D2 naming the month and the portfolio", r1.sub);
 ok((r1.rows || []).length >= 3,
    "D3 with a row per sub-category that moved — several, not one, which is what " +
    "the moving fixture is for", r1.rows);
 ok((r1.headers || []).join(",").indexOf("Market") !== -1,
    "D4 and a Market column", r1.headers);

 // The property the whole design turns on.
 const M = money(r1.totals["Market"]), A = money(r1.totals["Attributed"]),
       U = money(r1.totals["Unattributed"]);
 ok(r1.totals["Unattributed"] !== undefined,
    "D5 the Unattributed line is always shown, including when it is zero — a row " +
    "that appears only on disagreement teaches the reader it never happens",
    r1.totals);
 ok(Math.abs((A + U) - M) <= Math.max(2, Math.abs(M) * 0.001),
    "D6 attributed plus unattributed equals the market figure, on screen",
    { market: M, attributed: A, unattributed: U });

 // Rows must be the real breakdown, not a repeat of the total.
 const marketCol = (r1.rows || []).map((cells) => money(cells[4]));
 ok(marketCol.some((v) => v !== 0), "D7 the rows carry real figures", marketCol);
 ok(Math.abs(marketCol.reduce((a, b) => a + b, 0) - A) <= Math.max(2, Math.abs(A) * 0.002),
    "D8 and they sum to Attributed", { rows: marketCol, attributed: A });

 // Closing, three ways.
 await p.evaluate(() => document.getElementById("nwm-drill-close").click());
 ok(await p.evaluate(() => document.getElementById("nwm-drill-overlay").hidden),
    "C1 the close button closes it");
 await clickLast();
 await p.evaluate(() => { const ov = document.getElementById("nwm-drill-overlay");
   ov.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
 ok(await p.evaluate(() => document.getElementById("nwm-drill-overlay").hidden),
    "C2 a click on the backdrop closes it");
 await clickLast();
 await p.evaluate(() => { const m = document.querySelector("#nwm-drill-overlay .mic-txn-modal");
   m.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
 ok(!(await p.evaluate(() => document.getElementById("nwm-drill-overlay").hidden)),
    "C3 but a click INSIDE the dialog does not — dragging across a figure to " +
    "select it must not dismiss the panel");
 await p.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
 ok(await p.evaluate(() => document.getElementById("nwm-drill-overlay").hidden),
    "C4 and Escape closes it");

 // Per portfolio, which is the half of the request that is easy to skip.
 await p.evaluate(() => {
   const b = document.querySelector('#portfolio-pills [data-ov-portfolio="Trisha"]');
   if (b) b.click();
 });
 await p.waitForTimeout(6000);
 const r2 = await clickLast();
 console.log("  Trisha: " + JSON.stringify({ err: r2.err, totals: r2.totals,
   rows: (r2.rows || []).length }));
 ok(!r2.err && r2.open, "P1 the drill-down follows the portfolio selection", r2);
 ok(/Trisha/.test(r2.sub || ""), "P2 and says whose figures these are", r2.sub);
 const subs1 = (r1.rows || []).map((c) => c[0]).sort().join(",");
 const subs2 = (r2.rows || []).map((c) => c[0]).sort().join(",");
 ok(subs1 !== subs2,
    "P3 showing one portfolio's holdings rather than the household's", { all: subs1, trisha: subs2 });
 const M2 = money(r2.totals["Market"]), A2 = money(r2.totals["Attributed"]),
       U2 = money(r2.totals["Unattributed"]);
 ok(Math.abs((A2 + U2) - M2) <= Math.max(2, Math.abs(M2) * 0.001),
    "P4 and it still reconciles for one portfolio", { market: M2, attributed: A2, unattributed: U2 });

 ok(errs.length === 0, "no page errors", errs.slice(0, 3));
 console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
 await b.close();
 process.exit(fail ? 1 : 0);
})();
