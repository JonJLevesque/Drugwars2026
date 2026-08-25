'use strict';
/* ==================================================================
   GAME — the whole engine, pure and headless. No DOM, no timers.
   G.state is a plain object: JSON.stringify(G.state) is the save.
   Every function that touches RNG stores RNG.state back into the
   state so a resumed run is bit-identical to one never interrupted.
   Actions return a result object {ok, msg?} and never throw on bad
   input from the UI — they refuse and explain.
   ================================================================== */
const G={ state:null };

G.new=function(seedWord, days){
  days = RULES.daysOptions.includes(days)? days : RULES.daysOptions[0];
  const seed=hashSeed(String(seedWord));
  RNG.seed(seed);
  const s={
    v:1, seedWord:String(seedWord), seed, day:1, days,
    loc:HOME, cash:RULES.startCash, bank:0, debt:RULES.startDebt,
    health:RULES.startHealth, trunk:RULES.startTrunk, lawyers:0,
    inv:GOODS.map(()=>0), paid:GOODS.map(()=>0),   // paid = total cost basis, for avg display
    prices:[], hist:[], event:null, encounter:null, phase:'market', // market | encounter | over
    log:[], stats:{bought:0,sold:0,profit:0,escapes:0,bribes:0,cases:0},
    rng:0, result:null,
  };
  G.state=s;
  G._prices(s); G._snap(s);
  s.event={kind:'quiet', text:'Day 1. '+fmt(s.debt)+' borrowed from PayLater at '+(RULES.loanRate*100)+'% a day. '+s.days+' days to make it count.'};
  s.rng=RNG.state;
  return s;
};

G.load=function(json){
  let s; try{ s= typeof json==='string'? JSON.parse(json): json; }catch(e){ return null; }
  if(!s || s.v!==1 || !Array.isArray(s.inv) || s.inv.length!==GOODS.length) return null;
  if(!Array.isArray(s.hist)) s.hist=[];
  G.state=s; RNG.state=s.rng; return s;
};
G.save=function(){ return JSON.stringify(G.state); };

/* ---- helpers ---- */
G.used=s=>s.inv.reduce((a,b)=>a+b,0);
G.space=s=>s.trunk-G.used(s);
G.stashValue=s=>s.inv.reduce((a,n,i)=>a+n*(s.prices[i]||G._midPrice(i)),0);
G.netWorth=s=>s.cash+s.bank-s.debt;
// ceiling on total debt, keyed to net worth: borrowing moves cash and debt
// together so net worth — and therefore the ceiling — never rises by borrowing.
G.maxLoan=s=>Math.max(RULES.loanFloor, Math.floor(RULES.maxLoanMult*Math.max(0,G.netWorth(s))));
G.bribeCost=s=>Math.round(RULES.bribePerAgent*s.encounter.agents*(1+s.day/s.days));
G.canService=s=>s.loc===HOME && s.phase==='market';
G._midPrice=i=>(GOODS[i].lo+GOODS[i].hi)/2;
G.rank=nw=>RANKS.find(r=>nw>=r[0])[1];
G.avgPaid=(s,i)=> s.inv[i]? s.paid[i]/s.inv[i] : 0;

function logLine(s,text){ s.log.push({day:s.day, text}); if(s.log.length>60) s.log.shift(); }

/* ---- prices: log-uniform in band × district bias; some goods absent ---- */
G._prices=function(s){
  const d=DISTRICTS[s.loc];
  const n=RNG.int(RULES.availMax-RULES.availMin+1)+RULES.availMin;
  // pick which goods are unavailable: shuffle indexes deterministically
  const idx=GOODS.map((_,i)=>i);
  for(let i=idx.length-1;i>0;i--){ const j=RNG.int(i+1); const t=idx[i]; idx[i]=idx[j]; idx[j]=t; }
  const off=new Set(idx.slice(n));
  s.prices=GOODS.map((g,i)=>{
    if(off.has(i)) return 0;
    const u=RNG.next();
    let p=Math.exp(Math.log(g.lo)+u*(Math.log(g.hi)-Math.log(g.lo)));
    if(d.cheap===g.k) p*=CHEAP_MULT;
    if(d.dear===g.k)  p*=DEAR_MULT;
    return Math.max(1,Math.round(p));
  });
};

/* price history for the sparklines — after events, so spikes show */
G._snap=function(s){ s.hist.push({day:s.day,loc:s.loc,prices:s.prices.slice()}); if(s.hist.length>90) s.hist.shift(); };

/* ---- market ---- */
G.buy=function(i,n){
  const s=G.state; if(s.phase!=='market') return {ok:false,msg:'Not now.'};
  n=Math.floor(n); if(!(n>0)) return {ok:false,msg:'How many?'};
  const p=s.prices[i]; if(!p) return {ok:false,msg:'Nobody is selling '+GOODS[i].name+' here today.'};
  if(n>G.space(s)) return {ok:false,msg:'Trunk is full. Room for '+G.space(s)+' more.'};
  if(n*p>s.cash) return {ok:false,msg:'You can afford '+Math.floor(s.cash/p)+'.'};
  s.cash-=n*p; s.inv[i]+=n; s.paid[i]+=n*p; s.stats.bought+=n;
  logLine(s,'Bought '+n+' '+GOODS[i].name+' @ '+fmt(p));
  return {ok:true};
};
G.sell=function(i,n){
  const s=G.state; if(s.phase!=='market') return {ok:false,msg:'Not now.'};
  n=Math.floor(n); if(!(n>0)) return {ok:false,msg:'How many?'};
  const p=s.prices[i]; if(!p) return {ok:false,msg:'Nobody is buying '+GOODS[i].name+' here today.'};
  if(n>s.inv[i]) return {ok:false,msg:'You only have '+s.inv[i]+'.'};
  const basis=G.avgPaid(s,i)*n;
  s.cash+=n*p; s.inv[i]-=n; s.paid[i]=s.inv[i]? s.paid[i]-basis : 0;
  s.stats.sold+=n; s.stats.profit+=n*p-basis;
  logLine(s,'Sold '+n+' '+GOODS[i].name+' @ '+fmt(p)+(n*p-basis>=0?' (+':' (')+fmt(n*p-basis)+')');
  return {ok:true};
};
G.maxBuy=(s,i)=> s.prices[i]? Math.min(G.space(s), Math.floor(s.cash/s.prices[i])) : 0;

/* ---- downtown services ---- */
G.deposit=function(n){ const s=G.state; n=Math.floor(n);
  if(!G.canService(s)) return {ok:false,msg:'The bank is Downtown.'};
  if(!(n>0)||n>s.cash) return {ok:false,msg:'You have '+fmt(s.cash)+' on hand.'};
  s.cash-=n; s.bank+=n; logLine(s,'Deposited '+fmt(n)); return {ok:true}; };
G.withdraw=function(n){ const s=G.state; n=Math.floor(n);
  if(!G.canService(s)) return {ok:false,msg:'The bank is Downtown.'};
  if(!(n>0)||n>s.bank) return {ok:false,msg:'The account holds '+fmt(s.bank)+'.'};
  s.bank-=n; s.cash+=n; logLine(s,'Withdrew '+fmt(n)); return {ok:true}; };
G.payDebt=function(n){ const s=G.state; n=Math.floor(n);
  if(!G.canService(s)) return {ok:false,msg:'PayLater only takes cash Downtown.'};
  n=Math.min(n,s.debt);
  if(!(n>0)||n>s.cash) return {ok:false,msg:'You have '+fmt(s.cash)+' on hand.'};
  s.cash-=n; s.debt-=n; logLine(s,'Paid PayLater '+fmt(n)); return {ok:true}; };
G.borrow=function(n){ const s=G.state; n=Math.floor(n);
  if(!G.canService(s)) return {ok:false,msg:'PayLater only lends Downtown.'};
  const room=G.maxLoan(s)-s.debt;
  if(!(n>0)||n>room) return {ok:false,msg:room>0?'PayLater will extend '+fmt(room)+' more.':'PayLater has cut you off.'};
  s.cash+=n; s.debt+=n; logLine(s,'Borrowed '+fmt(n)+' at '+(RULES.loanRate*100)+'%/day'); return {ok:true}; };
G.heal=function(){ const s=G.state;
  if(!G.canService(s)) return {ok:false,msg:'The clinic is Downtown.'};
  const need=RULES.startHealth-s.health; if(need<=0) return {ok:false,msg:'You feel fine.'};
  const cost=need*RULES.clinicPerHp; const afford=Math.min(need,Math.floor(s.cash/RULES.clinicPerHp));
  if(afford<=0) return {ok:false,msg:'The clinic wants '+fmt(cost)+' for a full patch-up.'};
  s.cash-=afford*RULES.clinicPerHp; s.health+=afford;
  logLine(s,'Clinic: +'+afford+' health for '+fmt(afford*RULES.clinicPerHp)); return {ok:true}; };

/* ---- offers raised by events (van / lawyer) ---- */
G.acceptOffer=function(){ const s=G.state; const e=s.event;
  if(!e||!e.offer||e.taken) return {ok:false,msg:'No offer on the table.'};
  if(s.cash<e.price) return {ok:false,msg:'You cannot afford it.'};
  s.cash-=e.price; e.taken=true;
  if(e.kind==='van'){ s.trunk+=RULES.vanBonus; logLine(s,'Bought a van. Trunk is now '+s.trunk); }
  else { s.lawyers+=1; logLine(s,'Lawyer on retainer ('+s.lawyers+')'); }
  return {ok:true}; };

/* ---- travel: the day turns over ---- */
G.travel=function(dest){
  const s=G.state; if(s.phase!=='market') return {ok:false,msg:'Not now.'};
  if(dest===s.loc) return {ok:false,msg:'You are already here.'};
  if(dest<0||dest>=DISTRICTS.length) return {ok:false,msg:'No such place.'};
  RNG.state=s.rng;
  s.day+=1; s.loc=dest; s.event=null; s.encounter=null;
  s.debt=Math.round(s.debt*(1+RULES.loanRate));
  s.bank=Math.round(s.bank*(1+RULES.bankRate));
  if(s.day>s.days){ s.rng=RNG.state; return G._end('time'); }
  G._prices(s);
  G._arrive(s);
  G._snap(s);
  s.rng=RNG.state;
  return {ok:true};
};

function fill(tpl,vars){ return tpl.replace(/\{(\w+)\}/g,(m,k)=> k in vars? vars[k]: m); }

G._arrive=function(s){
  // 1. the Task Force? odds grow with the calendar and how much you're hauling
  const hauling=Math.min(1, G.stashValue(s)/(50000));
  const pFeds=Math.min(RULES.fedsMax, RULES.fedsBase + RULES.fedsPerDay*(s.day/s.days) + RULES.fedsPerValue*hauling);
  if(G.used(s)>0 && RNG.chance(pFeds)){
    const agents=1+RNG.int(Math.min(6, 2+Math.floor(4*s.day/s.days)));
    s.encounter={agents, start:agents, rounds:0};
    s.phase='encounter';
    s.event={kind:'feds', text:fill(RNG.pick(EVENTS.feds),{n:agents})};
    return;
  }
  // 2. price event
  if(RNG.chance(RULES.priceEventRate)){
    const avail=GOODS.map((_,i)=>i).filter(i=>s.prices[i]>0);
    const i=RNG.pick(avail); const g=GOODS[i];
    if(RNG.chance(0.5)){ s.prices[i]=Math.round(g.hi*RNG.range(RULES.spikeMult[0],RULES.spikeMult[1])); s.event={kind:'spike',good:i,text:g.spike}; }
    else { s.prices[i]=Math.max(1,Math.round(g.lo/RNG.range(RULES.crashDiv[0],RULES.crashDiv[1]))); s.event={kind:'crash',good:i,text:g.crash}; }
    return;
  }
  // 3. a non-price event
  if(RNG.chance(RULES.eventRate)){
    const roll=RNG.next();
    if(roll<0.30 && G.space(s)>0){
      const i=RNG.int(GOODS.length); const n=Math.min(G.space(s), 1+RNG.int(Math.max(1,Math.round(8000/G._midPrice(i)))));
      s.inv[i]+=n; const g=GOODS[i];
      s.event={kind:'find',text:fill(RNG.pick(EVENTS.find),{good:g.name,n,unit:g.unit,unitPl:g.unit+'s'})};
      logLine(s,'Found '+n+' '+g.name);
    } else if(roll<0.55 && s.cash>500){
      const lost=Math.round(s.cash*RNG.range(0.10,0.25)); s.cash-=lost;
      s.event={kind:'mugged',text:fill(RNG.pick(EVENTS.mugged),{money:fmt(lost)})};
      logLine(s,'Lost '+fmt(lost));
    } else if(roll<0.78){
      const price=Math.round(RNG.range(RULES.vanPrice[0],RULES.vanPrice[1])/50)*50;
      s.event={kind:'van',offer:true,price,text:fill(EVENTS.van[0],{money:fmt(price),n:RULES.vanBonus})};
    } else {
      const price=Math.round(RNG.range(RULES.lawyerPrice[0],RULES.lawyerPrice[1])/50)*50;
      s.event={kind:'lawyer',offer:true,price,text:fill(EVENTS.lawyer[0],{money:fmt(price)})};
    }
    return;
  }
  s.event={kind:'quiet',text:RNG.pick(EVENTS.quiet)};
};

/* ---- the Task Force encounter ---- */
G.run=function(){
  const s=G.state; if(s.phase!=='encounter') return {ok:false,msg:'Nobody is chasing you.'};
  RNG.state=s.rng; const e=s.encounter; e.rounds++;
  const p=Math.max(0.12, RULES.runBase-RULES.runPerAgent*e.agents);
  let out;
  if(RNG.chance(p)){ s.stats.escapes++; out=G._clear(s,RNG.pick(EVENTS.escaped)); }
  else {
    const dmg=RNG.int(RULES.hitHi-RULES.hitLo+1)+RULES.hitLo; s.health-=dmg;
    s.event={kind:'hit',text:RNG.pick(EVENTS.hit)+' (-'+dmg+' health)'};
    if(s.health<=0){ s.rng=RNG.state; return G._custody(); }
    out={ok:true};
  }
  s.rng=RNG.state; return out;
};
G.lawyerUp=function(){
  const s=G.state; if(s.phase!=='encounter') return {ok:false,msg:'Nobody is chasing you.'};
  if(s.lawyers<=0) return {ok:false,msg:'No lawyer on retainer.'};
  RNG.state=s.rng; const e=s.encounter; e.rounds++; s.lawyers--;
  const drop=1+RNG.int(2); e.agents-=drop;
  let out;
  if(e.agents<=0){ s.stats.cases++; out=G._clear(s,RNG.pick(EVENTS.win)); }
  else { s.event={kind:'feds',text:'Your lawyer peels off '+drop+' agent'+(drop>1?'s':'')+'. '+e.agents+' still on you.'}; out={ok:true}; }
  s.rng=RNG.state; return out;
};
G.bribe=function(){
  const s=G.state; if(s.phase!=='encounter') return {ok:false,msg:'Nobody is chasing you.'};
  const cost=G.bribeCost(s); if(s.cash<cost) return {ok:false,msg:'They want '+fmt(cost)+'. You have '+fmt(s.cash)+'.'};
  s.cash-=cost; s.stats.bribes++;
  return G._clear(s,fill(EVENTS.bribe[0],{money:fmt(cost)}));
};
G._clear=function(s,text){ s.encounter=null; s.phase='market'; s.event={kind:'clear',text}; logLine(s,'Shook the Task Force'); return {ok:true}; };

/* ---- endings ---- */
G._custody=function(){
  const s=G.state;
  s.cash=0; s.inv=GOODS.map(()=>0); s.paid=GOODS.map(()=>0);
  return G._end('custody');
};
G._end=function(why){
  const s=G.state; s.phase='over'; s.encounter=null;
  const nw=G.netWorth(s);
  s.result={why, netWorth:nw, rank:G.rank(nw), day:Math.min(s.day,s.days)};
  s.event={kind:'over',text: why==='custody'? EVENTS.custody[0] : 'Day '+s.days+' is over. PayLater wants its money. Time to count.'};
  return {ok:true, over:true};
};
