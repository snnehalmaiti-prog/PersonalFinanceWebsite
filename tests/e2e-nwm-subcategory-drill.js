// The sub-category drill-down, read from recorded snapshots.
//
// The first attempt at this recomputed the breakdown from today's sheets, which
// is a second derivation of a number the card reads from a record. The two
// disagreed often enough to need an "unattributed" line. Snapshots now carry the
// split per portfolio, so the panel reads the SAME rows the bar came from and
// the parts sum to the whole by construction.
//
// What this suite defends, in order of how badly it fails if broken:
//   • every reconstructed row carries a split, shaped portfolio -> sub-category;
//   • each split sums to its own row's total, or is dropped rather than stored;
//   • the panel's rows sum to the Market figure on screen, with no remainder;
//   • the card's own load does NOT fetch by_subcategory — it is the widest thing
//     on the row and most loads never open the panel;
//   • a month whose endpoints predate the column says so instead of guessing.
//
// The fixture moves NAVs and prices month to month on purpose. With flat prices
// only one holding ever moves and "several sub-categories" passes on one row.
//
// Needs a static server and Playwright's Chromium; not in run-all.js.
//
//     python3 -m http.server 8098 &
//     node tests/e2e-nwm-subcategory-drill.js
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
   ["1-Jan-2024","Snnehal","HDFC","FD-1","Fixed Income","Fixed Deposit","Buy","100000","1-Jan-2027","7%",""],
   ["1-Jan-2024","Trisha","EPFO","PF-1","Fixed Income","Provident Fund","Buy","50000","","",""],
   ["1-Jan-2024","Snnehal","—","Physical Gold","Commodity","Gold","Buy","","","","10"]],
 "wf-fixedincome-data":[["Transaction Date","Portfolio Name","Instrument Name","Instrument Category","Instrument Sub Category","Transaction Type","Amount"]],
};
const DAYS=(()=>{const o=[];const d=new Date("2024-01-01T00:00:00"),e=new Date();while(d<=e){o.push(d.toISOString().slice(0,10));d.setDate(d.getDate()+1);}return o;})();
const dmy=iso=>{const[y,m,d]=iso.split("-");return `${d}-${m}-${y}`;};
const navA=iso=>(10+(new Date(iso).getMonth()+1)*0.5).toFixed(4);
const navB=iso=>(20-(new Date(iso).getMonth()+1)*0.3).toFixed(4);
const pxG=iso=>+(50+(new Date(iso).getMonth()+1)*1.2).toFixed(2);
(async()=>{
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:1500,height:900}});
 const p=await ctx.newPage();const errs=[];p.on("pageerror",e=>errs.push(e.message));
 const j=body=>({status:200,contentType:"application/json",headers:{"access-control-allow-origin":"*"},body:JSON.stringify(body)});
 let stored=[], selects=[];
 await p.route("**://*.supabase.co/**",r=>{
   const req=r.request(), u=req.url();
   if(/net_worth_snapshots/.test(u)){
     if(req.method()==="POST"){ try{ (JSON.parse(req.postData()||"[]")).forEach(row=>{
        const i=stored.findIndex(x=>x.snapshot_date===row.snapshot_date);
        if(i>=0) stored[i]=Object.assign({},stored[i],row); else stored.push(row); }); }catch(e){}
       return r.fulfill(j([])); }
     // Honour the column projection + date filter the client asks for.
     const sel=decodeURIComponent((u.match(/select=([^&]*)/)||[])[1]||"*").split(",");
     selects.push(u.split("?").slice(1).join("?"));
     const inm=u.match(/snapshot_date=in\.\(([^)]*)\)/);
     let rows=stored;
     if(inm){ const want=decodeURIComponent(inm[1]).split(","); rows=rows.filter(x=>want.includes(x.snapshot_date)); }
     rows=rows.map(x=>{ if(sel[0]==="*") return x; const o={}; sel.forEach(k=>{o[k]=x[k]===undefined?null:x[k];}); return o; });
     return r.fulfill(j(rows));
   }
   return r.fulfill(j([]));
 });
 await p.route("**://fonts.googleapis.com/**",r=>r.fulfill({status:200,contentType:"text/css",body:""}));
 await p.route("**/xau.min.json*",r=>r.fulfill(j({xau:{inr:311035}})));
 await p.route("**://cdn.jsdelivr.net/npm/@fawazahmed0/**",r=>r.fulfill(j({xau:{inr:311035}})));
 await p.route("**://cdn.jsdelivr.net/**",r=>r.fulfill({status:200,contentType:"text/javascript",body:""}));
 await p.route("**://api.mfapi.in/**",r=>r.fulfill(j({data:DAYS.map(i=>({date:dmy(i),nav:navA(i)})).reverse()})));
 await p.route("**/mf_history.json*",r=>r.fulfill(j({updated:new Date().toISOString(),mf_history:{"100001":Object.fromEntries(DAYS.map(i=>[i,+navA(i)])),"100002":Object.fromEntries(DAYS.map(i=>[i,+navB(i)]))}})));
 await p.route("**/amfi_isin_map.json*",r=>r.fulfill(j({fetchedAt:Date.now(),data:{INFA:"100001",INFB:"100002"}})));
 await p.route("**/amfi_nav.json*",r=>r.fulfill(j({fetchedAt:Date.now(),data:{"100001":{date:"01-Aug-2026",nav:navA("2026-08-01")},"100002":{date:"01-Aug-2026",nav:navB("2026-08-01")}}})));
 await p.route("**/stock_prices.json*",r=>r.fulfill(j({prices:{__USD_INR__:{price:84},GOLDBEES:{price:pxG("2026-08-01")}},usd_inr_history:{},index_history:{}})));
 await p.route("**/stock_history.json*",r=>r.fulfill(j({stock_history:{GOLDBEES:{currency:"INR",prices:Object.fromEntries(DAYS.map(i=>[i,pxG(i)]))}}})));
 await p.addInitScript(()=>{window.Chart=function(c,cfg){this.data=cfg.data;this.options=cfg.options;this.scales={x:{},y:{}};this.chartArea={left:0,right:800,top:0,bottom:300};this.destroy=function(){};this.update=function(){};this.resize=function(){};this.zoomScale=function(){};this.resetZoom=function(){};this.getElementsAtEventForMode=function(){return[]};};window.Chart.register=function(){};window.Chart.defaults={font:{}};});
 const load=async()=>{
   await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`,{waitUntil:"domcontentloaded"});
   await p.evaluate(s=>{const keep=localStorage.getItem("wf-sb-session");localStorage.clear();
     localStorage.setItem("wf-sb-session",keep||JSON.stringify({access_token:"x",expires_at:Math.floor(Date.now()/1000)+3600,user:{id:"u1",email:"a@b.c"}}));
     localStorage.setItem("wf-gold-premium-pct","0");
     for(const k in s)localStorage.setItem(k,JSON.stringify(s[k]));},SHEETS);
   await p.goto(`http://127.0.0.1:${PORT}/dashboard.html?nosw=1`,{waitUntil:"load"});
   await p.waitForTimeout(14000);
 };
 await load();   // pass 1: backfill writes rows + splits
 const withSplit = stored.filter(r=>r.by_subcategory).length;
 console.log("stored rows:",stored.length,"with split:",withSplit);
 console.log("sample split:",JSON.stringify((stored.find(r=>r.by_subcategory)||{}).by_subcategory));
 await load();   // pass 2: rows now exist, drill-down can read them
 const res=await p.evaluate(()=>{
   const c=window.__wfNwmChart; if(!c) return {err:"no chart"};
   let idx=-1; for(let i=c.data.labels.length-1;i>=0;i--){ if(c.data.datasets.some(d=>d.data[i]!=null)){idx=i;break;} }
   if(idx<0) return {err:"no filled bar",labels:c.data.labels};
   c.options.onClick({},[{index:idx,datasetIndex:0}],c);
   return {clicked:c.data.labels[idx]};
 });
 await p.waitForTimeout(2500);
 const panel=await p.evaluate(()=>{
   const totals={}; document.querySelectorAll("#nwm-drill-totals .mic-hs-tot").forEach(el=>{
     totals[(el.querySelector(".mic-hs-tot-label")||{}).textContent]=(el.querySelector("b")||{}).textContent;});
   return {sub:(document.getElementById("nwm-drill-sub")||{}).textContent,
           totals, body:(document.getElementById("nwm-drill-body")||{}).textContent.slice(0,200),
           rows:[...document.querySelectorAll("#nwm-drill-body tbody tr")].map(tr=>[...tr.children].map(td=>td.textContent.trim()))};
 });
 let pass=0, fail=0;
 const ok=(c,n,d)=>{ if(c){pass++;console.log("  PASS  "+n);} else {fail++;console.log("  FAIL  "+n+(d!==undefined?"  → "+JSON.stringify(d):""));} };
 const money=(t)=>{ const s=String(t||""); const n=Number(s.replace(/[^0-9.]/g,""))||0;
   const m=/\bCR\b/i.test(s)?1e7:/\bL\b/i.test(s)?1e5:/\bK\b/i.test(s)?1e3:1;
   return (/−|-/.test(s)?-n:n)*m; };

 // ── What was stored ──────────────────────────────────────────────────────
 ok(stored.length >= 12, "W0 the backfill wrote rows to work with", stored.length);
 ok(withSplit === stored.length,
    "W1 every reconstructed row carries a sub-category split", { withSplit, rows: stored.length });
 const shape = (stored.find((r) => r.by_subcategory) || {}).by_subcategory;
 ok(shape && Object.keys(shape).length >= 2 &&
    typeof shape[Object.keys(shape)[0]] === "object",
    "W2 shaped portfolio -> sub-category, not a flat map — the whole point is " +
    "that it works per portfolio", shape);
 const badSums = stored.filter((r) => {
   if (!r.by_subcategory) return false;
   let s = 0;
   Object.keys(r.by_subcategory).forEach((pf) =>
     Object.keys(r.by_subcategory[pf]).forEach((k) => { s += Number(r.by_subcategory[pf][k]) || 0; }));
   return Math.abs(s - Number(r.total)) > Math.max(1, Math.abs(Number(r.total)) * 0.005);
 });
 const byDate = {};
 stored.forEach((r) => { byDate[r.snapshot_date] = r.total; });
 ok(badSums.length === 0,
    "W3 and each split sums to its OWN row's total — a split that does not would " +
    "resurface in the panel as an unexplained remainder",
    badSums.slice(0, 2).map((r) => r.snapshot_date));

 // ── Repairing rows that predate the column ───────────────────────────────
 // The situation every existing user is in: months already recorded, none with
 // a split. planBackfill only writes dates it does not have, and the refresh
 // planner leaves live rows alone by design — so without a repair pass those
 // months stay undrillable forever. Shipping without this produced exactly that:
 // a migration that worked, and a panel that still said "cannot be broken down".
 stored.forEach((r) => { delete r.by_subcategory;
   if (r.meta) delete r.meta.subcategory; });
 ok(stored.every((r) => !r.by_subcategory), "R0 (setup) splits stripped", stored.length);
 await load();
 const repaired = stored.filter((r) => r.by_subcategory).length;
 console.log("  after repair pass: " + repaired + "/" + stored.length + " rows have a split");
 ok(repaired >= stored.length - 1,
    "R1 a later load fills the split into rows that already existed, without " +
    "being asked to rewrite them for any other reason",
    { repaired, rows: stored.length });
 const restated = stored.filter((r) => r.by_subcategory &&
   Math.abs(Number(r.total) - Number(byDate[r.snapshot_date])) > 1);
 ok(restated.length === 0,
    "R2 and carries each row's recorded total forward unchanged — a repair may " +
    "add what is missing, never restate what was recorded",
    restated.slice(0, 2).map((r) => [r.snapshot_date, r.total, byDate[r.snapshot_date]]));

 // ── What the card fetched ────────────────────────────────────────────────
 // Identified by order=, which only the card's load uses — NOT by column names.
 // Naming columns is exactly what the mutation under test removes, so a filter
 // built on them drops the very request being checked and silently measures the
 // backfill's read instead. That is how the first version of F1 passed against
 // select=*.
 const cardSelects = selects.filter((s) => s.indexOf("order=snapshot_date") !== -1);
 ok(cardSelects.length > 0, "F0 the card loaded snapshots", selects.slice(0, 3));
 // Two conditions, because either alone passes on a broken implementation:
 // "*" contains no "by_subcategory" substring, so an omission check alone is
 // satisfied by the very thing it is meant to forbid. Asked for by name, and
 // that name absent.
 ok(cardSelects.every((s) => s.indexOf("*") === -1),
    "F1 the card asks for named columns, never select=* — a wildcard pulls the " +
    "sub-category map back in while looking like it omits it", cardSelects.slice(0, 2));
 ok(cardSelects.every((s) => s.indexOf("by_subcategory") === -1),
    "F1b and by_subcategory is not among them — it is the widest thing on the " +
    "row and most loads never open the panel", cardSelects.slice(0, 2));
 ok(selects.some((s) => s.indexOf("by_subcategory") !== -1),
    "F2 while the drill-down does fetch it, for the month asked about",
    selects.slice(-3));

 // ── What the panel showed ────────────────────────────────────────────────
 ok(!res.err && /All portfolios/.test(panel.sub || ""),
    "P1 clicking a month opens the panel and names the scope", { res, sub: panel.sub });
 ok((panel.rows || []).length >= 3,
    "P2 with a row per sub-category that moved — several, which is what the " +
    "moving fixture is for", panel.rows);
 const M = money(panel.totals["Market"]);
 const sum = (panel.rows || []).reduce((a, c) => a + money(c[4]), 0);
 ok(Math.abs(sum - M) <= Math.max(2, Math.abs(M) * 0.002),
    "P3 and the rows sum to the Market figure on screen — read from the same " +
    "records, so this is exact rather than approximate", { rows: sum, market: M });
 ok(panel.totals["Unreconciled"] === undefined,
    "P4 with no Unreconciled line at all, which is the difference from the " +
    "recomputed version this replaced", panel.totals);
 // A deposit's growth must be interest, never market.
 const fd = (panel.rows || []).find((c) => /Deposit/.test(c[0]));
 ok(fd && money(fd[3]) > 0 && Math.abs(money(fd[4])) < 1,
    "P5 a term deposit shows its growth as interest and zero market", fd);

 ok(errs.length === 0, "no page errors", errs.slice(0, 3));
 console.log("\nRESULT: " + pass + " passed, " + fail + " failed");
  await b.close();
 process.exit(fail ? 1 : 0);
})();
