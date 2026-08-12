// The sub-category valuations must add up to the line they explain.
//
// The NET WORTH · MONTHLY drill-down splits a month's market movement across
// sub-categories, and to do that it values every holding at each month end.
// That valuation is a REGROUPING of the Account Value chart's own arithmetic —
// same timeline, same NAVs, same historical prices, same USD/INR rates, same FD
// accrual — not a second way of valuing a portfolio.
//
// This suite holds it to that. For every month, the sub-categories are summed
// and compared against _snapSeriesForPortfolio's value for the same month end.
// A breakdown that does not add up to the line it is explaining is worse than
// no breakdown: it invites the reader to trust parts that do not belong to the
// whole. The fixture deliberately spans all five valuation paths — mutual
// funds, stocks/ETFs, term deposits, provident fund, and commodity by grams —
// because each one is a separate opportunity to drift.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-nwm-subcategory-values.js
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
 await p.route("**://*.supabase.co/**",r=>r.fulfill(j([])));
 await p.route("**://fonts.googleapis.com/**",r=>r.fulfill({status:200,contentType:"text/css",body:""}));
 await p.route("**/xau.min.json*",r=>r.fulfill(j({xau:{inr:311035}})));
 await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**",r=>r.fulfill(j({xau:{inr:311035}})));
 await p.route("**://cdn.jsdelivr.net/**",r=>r.fulfill({status:200,contentType:"text/javascript",body:""}));
 await p.route("**://api.mfapi.in/**",r=>r.fulfill(j({data:DAYS.map(i=>({date:dmy(i),nav:"12"})).reverse()})));
 await p.route("**/mf_history.json*",r=>r.fulfill(j({updated:new Date().toISOString(),mf_history:{"100001":Object.fromEntries(DAYS.map(i=>[i,12])),"100002":Object.fromEntries(DAYS.map(i=>[i,22]))}})));
 await p.route("**/amfi_isin_map.json*",r=>r.fulfill(j({fetchedAt:Date.now(),data:{INFA:"100001",INFB:"100002"}})));
 await p.route("**/amfi_nav.json*",r=>r.fulfill(j({fetchedAt:Date.now(),data:{"100001":{date:"01-Aug-2026",nav:"12"},"100002":{date:"01-Aug-2026",nav:"22"}}})));
 await p.route("**/stock_prices.json*",r=>r.fulfill(j({prices:{__USD_INR__:{price:84},GOLDBEES:{price:60}},usd_inr_history:{},index_history:{}})));
 await p.route("**/stock_history.json*",r=>r.fulfill(j({stock_history:{GOLDBEES:{currency:"INR",prices:Object.fromEntries(DAYS.map(i=>[i,60]))}}})));
 await p.addInitScript(()=>{window.Chart=function(c,cfg){this.data=cfg.data;this.options=cfg.options;this.scales={x:{},y:{}};this.chartArea={left:0,right:800,top:0,bottom:300};this.destroy=function(){};this.update=function(){};this.resize=function(){};this.zoomScale=function(){};this.resetZoom=function(){};this.getElementsAtEventForMode=function(){return[]};};window.Chart.register=function(){};window.Chart.defaults={font:{}};});
 await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`,{waitUntil:"domcontentloaded"});
 await p.evaluate(s=>{localStorage.clear();localStorage.setItem("wf-sb-session",JSON.stringify({access_token:"x",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"u1",email:"a@b.c"}}));localStorage.setItem("wf-gold-premium-pct","0");for(const k in s)localStorage.setItem(k,JSON.stringify(s[k]));},SHEETS);
 await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`,{waitUntil:"load"});
 await p.waitForTimeout(12000);
 const res=await p.evaluate(()=>{
   const f=window.__wfNwmProbe;
   return f?f():"probe missing";
 });
 let pass = 0, fail = 0;
 const ok = (c, n, d) => { if (c) { pass++; console.log("  PASS  " + n); }
   else { fail++; console.log("  FAIL  " + n + (d !== undefined ? "  → " + JSON.stringify(d) : "")); } };

 for (const pf of ["all", "Snnehal", "Trisha"]) {
   const res = await p.evaluate((x) => window.__wfNwmProbe(x), pf);
   if (!Array.isArray(res)) { ok(false, pf + ": probe returned a series", res); continue; }
   const bad = res.filter((r) => Math.abs(r.diff) > 1);
   const subs = [...new Set(res.flatMap((r) => Object.keys(r.subs)))];
   console.log("  " + pf.padEnd(9) + " months " + res.length + "  subs " + JSON.stringify(subs));
   // Without this the reconciliation below is vacuous: an empty series has
   // nothing to disagree about and would sail through.
   ok(res.length >= 12, pf + ": V — there are months to check", res.length);
   ok(subs.length >= (pf === "all" ? 4 : 2),
      pf + ": S — spanning several valuation paths, not just one", subs);
   ok(bad.length === 0,
      pf + ": R — every month's sub-categories sum to the Account Value series " +
      "for that month end", bad.slice(0, 3));
 }

 // The portfolios must also sum to the household, the same property the
 // snapshot replay is held to — otherwise one portfolio's drill-down could look
 // right while the set of them does not.
 const totals = {};
 for (const pf of ["all", "Snnehal", "Trisha"]) {
   totals[pf] = await p.evaluate((x) => {
     const r = window.__wfNwmProbe(x);
     return Array.isArray(r) ? Object.fromEntries(r.map((m) => [m.month, m.sum])) : null;
   }, pf);
 }
 const months = Object.keys(totals.all || {});
 const mismatched = months.filter((m) =>
   Math.abs((totals.all[m] || 0) - ((totals.Snnehal[m] || 0) + (totals.Trisha[m] || 0))) > 2);
 ok(months.length > 0 && mismatched.length === 0,
    "H the two portfolios' valuations sum to the household's, month by month",
    mismatched.slice(0, 3).map((m) => [m, totals.all[m], totals.Snnehal[m], totals.Trisha[m]]));

 ok(errs.length === 0, "no page errors", errs.slice(0, 3));
 console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
 await b.close();
 process.exit(fail ? 1 : 0);
})();
