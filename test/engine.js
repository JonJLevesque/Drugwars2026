/* Drugwars 2026 engine suite. `node test/engine.js` — exits non-zero on failure.
   Covers determinism, save/resume ≡ straight-through, price invariants,
   buy/sell/service refusals, trunk/loan/bank arithmetic, tiers, heat,
   the Task Force + collectors state machines, contacts/jobs, launder,
   the supplier, The Big One, endings, ranks, fmt. Ends with a per-tier
   Monte Carlo balance report that PRINTS (never asserts).
   Everything data-driven: names/numbers come from GOODS/TIERS/RULES/CONTACTS/JOBS. */
'use strict';
const { load } = require('./shim');
let fails = 0, passes = 0;
function ok(cond, name, extra){
  if(cond){ passes++; console.log('PASS '+name); }
  else { fails++; console.log('FAIL '+name+(extra!==undefined?' — '+extra:'')); }
}
const eq = (a,b)=> JSON.stringify(a)===JSON.stringify(b);
const fresh = ()=> load({engineOnly:true});
const P = (E,name)=>E.probe(name);          // data.js globals not exported by the shim
const cheapest = s => s.prices.reduce((b,p,i)=> p>0 && (b<0||p<s.prices[b]) ? i : b, -1);
const gi = (E,k)=>E.GOODS.findIndex(g=>g.k===k);
const PORT=1, DCR=2, CAMPUS=3, MALL=4, MARINA=5;   // = DISTRICTS index = CONTACTS index (see CONTRACT.md)

/* Tiny independent PRNG for bot decisions (never the engine's RNG). */
function botRng(seed){ let s=seed|0; return ()=>{ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

/* Resolve any non-market phase with a fixed policy (used by invariant sweeps). */
function settle(E){ const {G}=E; const s=G.state; let g=0;
  while(s.phase==='encounter' && g++<60) G.run();
  while(s.phase==='collectors' && g++<60){ if(!G.colPay().ok && !G.colVan().ok) G.colBeat(); }
}

/* A deterministic scripted step: decisions depend ONLY on the state, so the
   same seed always yields the same action sequence. Exercises every
   RNG-touching action (travel, layLow, run, lawyerUp, colBeat) plus bribes,
   offers, jobs (accept/deliver), launder, supplier, collectors. */
function scriptedStep(E){
  const { G, DISTRICTS, RULES } = E; const s = G.state;
  if(s.phase==='over') return false;
  if(s.phase==='encounter'){
    if(s.lawyers>0 && s.day%3===0) return G.lawyerUp().ok;
    if(s.day%2===0 && s.cash>=G.bribeCost(s)) return G.bribe().ok;
    return G.run().ok;
  }
  if(s.phase==='collectors'){
    if(s.day%3===0 && G.colVan().ok) return true;
    if(s.day%2===0 && G.colPay().ok) return true;
    return G.colBeat().ok;
  }
  // market: deliver any rush job we can, sell, take offers, accept a job, buy, services, launder, supplier
  for(const j of s.jobs.slice()) if(j.type==='rush' && j.contact===s.loc) G.deliver(j.id);
  for(let i=0;i<s.inv.length;i++) if(s.inv[i]>0 && s.prices[i]>0) G.sell(i, s.inv[i]);
  if(s.event && s.event.offer && !s.event.taken && s.cash > s.event.price*2) G.acceptOffer();
  const b=s.board[s.loc]||[]; for(let k=0;k<b.length;k++){ if(G.accept(k).ok) break; }
  if(s.supplierOffer && s.supplierOffer.day===s.day) G.supplierBuy();
  let best=-1, bestR=0;
  for(let i=0;i<s.prices.length;i++){ if(!s.prices[i]) continue; const r=G._midPrice(i)/s.prices[i]; if(r>bestR){ bestR=r; best=i; } }
  if(best>=0){ const n=G.maxBuy(s,best); if(n>0) G.buy(best,n); }
  if(s.loc===E.HOME){ if(s.cash>1000 && s.debt>0) G.payDebt(s.day%5===0? s.debt : Math.floor(s.cash/4)); }
  if(s.loc===MALL && s.cash>5000) G.launder(Math.floor(s.cash/3));
  if(s.heat>80 && s.day%2===1) return G.layLow().ok;
  const dest = (s.loc + 1 + (s.day % (DISTRICTS.length-1))) % DISTRICTS.length;
  const r = G.travel(dest===s.loc? (dest+1)%DISTRICTS.length : dest);
  return r.ok;
}
function runScript(E, seedWord, days, steps, tier){
  E.G.new(seedWord, days, tier);
  for(let i=0;i<steps;i++) if(!scriptedStep(E)) break;
  return E.G.state;
}

/* ---------------- determinism ---------------- */
{
  let allSame=true;
  for(const w of ['EGG-FLIP-101','GPU-MOON-777','TAX-CRASH-404']) for(const t of [0,1,2,3]){
    const a = runScript(fresh(), w, 30, 200, t), b = runScript(fresh(), w, 30, 200, t);
    if(!eq(a,b)) allSame=false;
  }
  ok(allSame, 'determinism: same seed word + tier + same script → JSON-identical state (3 seeds × 4 tiers)');
  const a = runScript(fresh(),'EGG-FLIP-101',30,60), b = runScript(fresh(),'EGG-FLIP-102',30,60);
  ok(!eq(a.prices,b.prices) || a.day!==b.day, 'determinism: different seed words diverge');
  const E=fresh(); const s1=E.G.new('SAME',30,1), p1=s1.prices.slice(), s2=E.G.new('SAME',30,2);
  ok(s1.seed===E.hashSeed('SAME|1') && s2.seed===E.hashSeed('SAME|2') && !eq(p1,s2.prices), 'seed = hashSeed(seedWord|tier); tiers diverge on the same word');
}

/* ---------------- save/resume ≡ straight-through ---------------- */
{
  let checked=0, encounterSaves=0, collectorSaves=0, jobSaves=0, supplierSaves=0, allEq=true, firstBad=null;
  for(let n=0;n<40;n++){
    const w='SAVE-'+n; const tier=n%4;
    for(const cut of [3, 11, 27, 41]){
      const A = fresh(); A.G.new(w, 45, tier);
      for(let i=0;i<cut;i++) scriptedStep(A);
      const sa=A.G.state; if(sa.phase==='over') continue;
      if(sa.phase==='encounter') encounterSaves++;
      if(sa.phase==='collectors') collectorSaves++;
      if(sa.jobs.length) jobSaves++;
      if(sa.story.supplier) supplierSaves++;
      const json = A.G.save();
      const B = fresh(); const loaded = B.G.load(json);
      if(!loaded){ allEq=false; firstBad=w+'@'+cut+' load returned null'; continue; }
      if(B.RNG.state!==A.RNG.state){ allEq=false; firstBad=w+'@'+cut+' RNG.state not restored'; }
      for(let i=0;i<60;i++){ const ra=scriptedStep(A), rb=scriptedStep(B); if(ra!==rb){ allEq=false; firstBad=firstBad||(w+'@'+cut+' step '+i+' diverged'); break; } }
      checked++;
      if(!eq(A.G.state,B.G.state)){ allEq=false; firstBad=firstBad||(w+'@'+cut+' final state differs'); }
    }
  }
  ok(allEq && checked>80, 'save/resume ≡ straight-through ('+checked+' cut points: '+encounterSaves+' mid-encounter, '+collectorSaves+' mid-collectors, '+jobSaves+' holding jobs, '+supplierSaves+' with supplier)', firstBad);
  ok(encounterSaves>0 && collectorSaves>0 && jobSaves>0 && supplierSaves>0, 'the cut-point harness actually covered encounters, collectors, jobs and the supplier');
  const E=fresh();
  ok(E.G.load('{not json')===null && E.G.load({v:1})===null && E.G.load({v:2,inv:[1]})===null, 'G.load rejects garbage / wrong version / wrong inv length');
  E.G.new('X',30); const before=E.G.save();
  const s=E.G.state; const rngStored=s.rng;
  E.G.travel(1); ok(E.G.state.rng!==rngStored && E.G.state.rng===E.RNG.state, 'travel writes RNG.state back into state.rng');
  ok(before===JSON.stringify(JSON.parse(before)), 'G.save() is plain JSON of the state');
}

/* ---------------- tiers ---------------- */
{
  const E=fresh(); const {G,RULES,DISTRICTS}=E; const TIERS=P(E,'TIERS');
  let allOk=true, bad=null;
  TIERS.forEach((T,t)=>{
    const s=G.new('TIER-'+t,30,t);
    if(s.tier!==t||s.cash!==T.cash||s.debt!==T.debt||s.principal!==T.debt||s.trunk!==T.trunk||G.T(s)!==T){ allOk=false; bad=bad||('tier '+t+' start fields'); }
    if(s.heat!==10||s.overdue!==0||s.creditCut!==false||s.v!==2){ allOk=false; bad=bad||('tier '+t+' heat/overdue/creditCut/v'); }
    const d0=s.debt; G.travel(1);
    if(s.debt!==Math.round(d0*(1+T.rate))){ allOk=false; bad=bad||('tier '+t+' rate'); }
    if(G.score(s)!==Math.round(G.netWorth(s)*T.scoreMult)){ allOk=false; bad=bad||('tier '+t+' score'); }
  });
  ok(allOk, 'TIERS[0..3] applied on G.new: cash, debt(=principal), trunk, G.T, daily rate via one travel, score = netWorth × scoreMult', bad);
  ok(G.new('X',30,-1).tier===1 && G.new('X',30,99).tier===1 && G.new('X',30).tier===1 && G.new('X',30,3).tier===3, 'G.new defaults / clamps tier to 1');
  // price band widening: with tier.vol prices may leave [lo,hi] by up to the widened band, stay integer ≥ 1
  const CHEAP=P(E,'CHEAP_MULT'), DEAR=P(E,'DEAR_MULT');
  let pbad=null, widened=0, n=0;
  TIERS.forEach((T,t)=>{ for(let k=0;k<40 && !pbad;k++){ G.new('VOL-'+t+'-'+k,30,t); const s=G.state;
    s.prices.forEach((p,i)=>{ if(!p) return; n++; const g=E.GOODS[i], d=DISTRICTS[s.loc];
      if(!Number.isInteger(p)||p<1) pbad='non-integer/<1 price '+p;
      const span=Math.log(g.hi)-Math.log(g.lo); let lo=Math.exp(Math.log(g.lo)+(0.5-0.5*T.vol)*span), hi=Math.exp(Math.log(g.lo)+(0.5+0.5*T.vol)*span);
      if(d.cheap===g.k){ lo*=CHEAP; hi*=CHEAP; } if(d.dear===g.k){ lo*=DEAR; hi*=DEAR; }
      if(p<Math.floor(lo)-1||p>Math.ceil(hi)+1) pbad='tier '+t+' '+g.k+'='+p+' outside vol band '+lo.toFixed(0)+'..'+hi.toFixed(0);
      if(T.vol>1 && (p<g.lo*(d.cheap===g.k?CHEAP:1)*0.999 || p>g.hi*(d.dear===g.k?DEAR:1)*1.001)) widened++;
    }); } });
  ok(!pbad && widened>0, 'price band scales with tier.vol ('+n+' prices, '+widened+' beyond the base band on vol>1 tiers), always integer ≥ 1', pbad);
}

/* ---------------- price invariants ---------------- */
{
  const E=fresh(); const {G,GOODS,RULES,DISTRICTS}=E;
  let bad=null, days=0, spikes=0, crashes=0, biased=0;
  const CHEAP=P(E,'CHEAP_MULT'), DEAR=P(E,'DEAR_MULT');
  for(let n=0;n<150 && !bad;n++){
    G.new('PRICE-'+n, 30, 1);  // tier 1: vol 1 → the base band
    while(G.state.phase!=='over' && !bad){
      const s=G.state; if(s.phase!=='market'){ settle(E); continue; } days++;
      const avail=s.prices.filter(p=>p>0).length;
      if(avail<RULES.availMin||avail>RULES.availMax) bad='avail '+avail+' on seed '+n+' day '+s.day;
      s.prices.forEach((p,i)=>{
        const g=GOODS[i], d=DISTRICTS[s.loc];
        if(!(Number.isInteger(p) && p>=0)) bad='non-integer/negative price '+p;
        if(p===0) return;
        let lo=g.lo, hi=g.hi;
        if(d.cheap===g.k){ lo*=CHEAP; hi*=CHEAP; biased++; }
        if(d.dear===g.k){ lo*=DEAR; hi*=DEAR; biased++; }
        const ev=s.event||{};
        if(ev.good===i && (ev.kind==='spike'||ev.kind==='job'||ev.kind==='jobfail')){ if(p>g.hi*DEAR) spikes++; else if(p<g.lo*CHEAP) crashes++; else if(ev.kind==='spike') bad='spike not above hi*DEAR: '+p+' '+g.k; return; }
        if(ev.kind==='crash' && ev.good===i){ crashes++; if(p>=g.lo*CHEAP) bad='crash not below lo*CHEAP: '+p+' '+g.k; return; }
        if(p<Math.floor(lo)-1||p>Math.ceil(hi)+1) bad='out of band '+g.k+'='+p+' band '+lo+'..'+hi+' seed '+n+' day '+s.day+' loc '+s.loc;
      });
      G.travel((s.loc+1)%DISTRICTS.length);
    }
  }
  ok(!bad, 'price invariants over '+days+' district-days (int ≥0, '+RULES.availMin+'..'+RULES.availMax+' available, in band unless spike/crash; '+spikes+' spikes, '+crashes+' crashes, '+biased+' biased)', bad);
  ok(spikes>0 && crashes>0, 'price events actually occurred in the sample');
}

/* ---------------- buy / sell refusals ---------------- */
{
  const E=fresh(); const {G,GOODS}=E;
  G.new('BUY-1',30); const s=G.state;
  const iOn = s.prices.findIndex(p=>p>0), iOff = s.prices.findIndex(p=>p===0);
  const cash0=s.cash;
  ok(!G.buy(iOn,0).ok && !G.buy(iOn,-3).ok && !G.buy(iOn,NaN).ok && s.cash===cash0, 'buy refuses n<=0 / NaN');
  if(iOff>=0) ok(!G.buy(iOff,1).ok, 'buy refuses a good not on sale today'); else ok(true,'(no absent good this day — skipped)');
  const tooMany=Math.floor(s.cash/s.prices[iOn])+1;
  ok(!G.buy(iOn,tooMany).ok && s.cash===cash0 && s.inv[iOn]===0, 'buy refuses when cash is short, no partial fill');
  const cheap = cheapest(s);
  ok(!G.buy(cheap, s.trunk+1).ok, 'buy refuses n > trunk space');
  const n=Math.min(G.maxBuy(s,cheap), 5); const r=G.buy(cheap,n);
  ok(r.ok && s.inv[cheap]===n && s.cash===cash0-n*s.prices[cheap] && s.paid[cheap]===n*s.prices[cheap], 'buy debits cash, credits inv and cost basis');
  ok(!G.sell(cheap,n+1).ok && s.inv[cheap]===n, 'sell refuses more than held');
  ok(!G.sell(cheap,0).ok, 'sell refuses n<=0');
  if(iOff>=0){ s.inv[iOff]=1; ok(!G.sell(iOff,1).ok, 'sell refuses when nobody is buying'); s.inv[iOff]=0; }
  const c1=s.cash; ok(G.sell(cheap,n).ok && s.cash===c1+n*s.prices[cheap] && s.inv[cheap]===0 && s.paid[cheap]===0, 'sell credits cash, clears basis when emptied');
  ok(G.maxBuy(s,cheap)===Math.min(G.space(s),Math.floor(s.cash/s.prices[cheap])), 'maxBuy = min(space, cash/price)');
  G.buy(cheap, 2.9); ok(s.inv[cheap]===2, 'buy floors fractional n');
  const rr=botRng(7); let neg=false;
  for(let k=0;k<3000;k++){
    const i=(rr()*GOODS.length)|0, q=((rr()*300)|0)-50;
    if(rr()<0.5) G.buy(i,q); else G.sell(i,q);
    if(s.cash<0 || s.inv.some(v=>v<0) || G.used(s)>s.trunk || s.heat<0 || s.heat>100){ neg=true; break; }
  }
  ok(!neg, 'fuzz: 3000 random buy/sell never leave negative cash/inv, overfull trunk, or heat outside [0,100]');
  for(const ph of ['encounter','collectors','over']){ s.phase=ph;
    ok(!G.buy(iOn,1).ok && !G.sell(iOn,1).ok && !G.travel(1).ok && !G.layLow().ok && !G.accept(0).ok && !G.deliver(1).ok && !G.launder(1).ok && !G.supplierBuy().ok, 'buy/sell/travel/layLow/accept/deliver/launder/supplierBuy refused in phase '+ph); }
  s.phase='market';
}

/* ---------------- heat ---------------- */
{
  // heat is a daily meter: trades accumulate state.dayVol ($ × good.heat); at the day turn
  // heat += heatVolBase × log2(1 + dayVol/heatVolUnit) − heatDecay, then travel adds carry weight.
  const E=fresh(); const {G,GOODS,RULES}=E; G.new('HEAT-1',30,1); const s=G.state;
  const volHeat=v=>RULES.heatVolBase*Math.log2(1+v/RULES.heatVolUnit);
  const r1=(x)=>Math.round(x*10)/10;
  const i=cheapest(s); s.cash=1e7; s.heat=20;
  const p=s.prices[i], n=Math.min(10,G.space(s));
  ok(s.dayVol===0, 'dayVol starts at 0');
  G.buy(i,n); ok(s.heat===20 && s.dayVol===n*p*GOODS[i].heat*RULES.heatBuyFrac, 'buy adds value × good.heat × heatBuyFrac to dayVol (heat unchanged until the day turns)', s.dayVol);
  let v=s.dayVol; G.sell(i,n); ok(s.dayVol===v+n*p*GOODS[i].heat, 'sell adds value × good.heat to dayVol', s.dayVol);
  G.buy(i,n); v=s.dayVol; s.event={kind:'spike',good:i,text:''}; G.sell(i,n);
  ok(s.dayVol===v+n*p*GOODS[i].heat*RULES.heatSpikeMult, 'selling into a spike counts × heatSpikeMult', s.dayVol); s.event=null;
  const hot=GOODS.reduce((b,g,k)=>g.heat>GOODS[b].heat?k:b,0), cool=GOODS.reduce((b,g,k)=>g.heat<GOODS[b].heat?k:b,0);
  s.dayVol=0; s.prices[hot]=1000; s.prices[cool]=1000; s.inv=GOODS.map(()=>0); s.paid=GOODS.map(()=>0);
  G.buy(hot,5); const vh=s.dayVol; s.dayVol=0; G.buy(cool,5); ok(vh>s.dayVol && vh/s.dayVol===GOODS[hot].heat/GOODS[cool].heat, 'volume is proportional to good.heat ('+GOODS[hot].k+' vs '+GOODS[cool].k+' for equal value)');
  // the day turn: volume → heat on the log curve, minus decay; plus carry on travel
  s.inv=GOODS.map(()=>0); s.paid=GOODS.map(()=>0); s.dayVol=RULES.heatVolUnit; s.heat=50; G.travel(1);
  ok(s.heat===r1(50+volHeat(RULES.heatVolUnit)-RULES.heatDecay) && s.dayVol===0, 'travel: heat += heatVolBase × log2(1+dayVol/heatVolUnit) − heatDecay; dayVol reset', s.heat);
  settle(E); s.heat=50; s.dayVol=0; s.inv=GOODS.map(()=>0); G.travel((s.loc+1)%6);
  ok(s.heat===r1(50-RULES.heatDecay), 'quiet day, empty trunk: heat decays by heatDecay', s.heat);
  settle(E); s.heat=50; s.dayVol=0; const j=cheapest(s); s.inv=GOODS.map(()=>0); s.inv[j]=s.trunk; const w=GOODS[j].heat;
  G.travel((s.loc+1)%6); ok(s.heat===r1(r1(50-RULES.heatDecay)+w*RULES.heatCarry), 'full trunk: travel adds (Σinv×good.heat/trunk) × heatCarry on top', s.heat);
  settle(E); s.heat=0; s.dayVol=0; s.inv=GOODS.map(()=>0); s.prices[hot]=1000; s.cash=1e9; G.buy(hot,20); const dv=s.dayVol;
  ok(G.heatForecast(s)===Math.round(volHeat(dv)-RULES.heatDecay+20*GOODS[hot].heat/s.trunk*RULES.heatCarry), 'heatForecast previews tonight\'s change from today\'s dayVol + carry');
  s.dayVol=0; s.heat=0.5; s.inv=GOODS.map(()=>0); G.travel((s.loc+1)%6); ok(s.heat===0, 'heat clamps at 0');
  settle(E); s.heat=99; s.dayVol=1e12; G.travel((s.loc+1)%6); ok(s.heat===100, 'heat clamps at 100');
  // log curve: doubling the volume adds a fixed amount
  { const U=RULES.heatVolUnit; ok(volHeat(2*U)-volHeat(U) < volHeat(U)-volHeat(0) && Math.abs((volHeat(2e6*U)-volHeat(1e6*U))-RULES.heatVolBase)<1e-3, 'volume→heat is concave: doubling a big day adds ≈heatVolBase, not double'); }
  // lay low
  const L=fresh(); L.G.new('HEAT-3',30,2); const l=L.G.state; l.heat=60; l.dayVol=0; const d0=l.debt, day0=l.day, loc0=l.loc, T=L.G.T(l);
  const r=L.G.layLow();
  ok(r.ok && l.day===day0+1 && l.loc===loc0 && l.debt===Math.round(d0*(1+T.rate)) && l.heat===r1(r1(60-L.RULES.heatDecay)-L.RULES.heatLayLow) && ['laylow','job','jobfail','collectors'].includes(l.event.kind), 'layLow: day+1, debt compounds, same district, heat −decay −heatLayLow, laylow event', l.heat);
  l.heat=5; L.G.layLow(); ok(l.heat===0, 'layLow clamps heat at 0');
  ok(l.prices.some(p=>p>0) && l.hist[l.hist.length-1].day===l.day, 'layLow rerolls prices and snapshots history');
  l.day=l.days; const e=L.G.layLow(); ok(e.over===true && l.phase==='over' && l.result.why==='time', 'layLow past the last day ends the run (time)');
  // fedsOdds
  const O=fresh(); O.G.new('ODDS',30,1); const o=O.G.state; const OT=O.G.T(o);
  o.inv=O.GOODS.map(()=>0); o.heat=90; ok(O.G.fedsOdds(o)===0, 'fedsOdds is 0 with an empty trunk regardless of heat');
  o.inv[0]=1; o.heat=0; const a0=O.G.fedsOdds(o); o.heat=50; const a50=O.G.fedsOdds(o); o.heat=100; const a100=O.G.fedsOdds(o);
  ok(a0===O.RULES.fedsBase && a50>a0 && a100>a50 && a100===Math.min(0.95,O.RULES.fedsBase+OT.fedsMax), 'fedsOdds = fedsBase + heat/100 × tier.fedsMax, increasing in heat');
  o.lastFeds=o.day; ok(O.G.fedsOdds(o)===0, 'fedsOdds is 0 on the day of a chase (cooldown)');
  o.day=o.lastFeds+1; ok(Math.abs(O.G.fedsOdds(o)-a100/O.RULES.heatDays)<1e-9, 'cooldown ramps back linearly over heatDays');
  o.day=o.lastFeds+O.RULES.heatDays; ok(O.G.fedsOdds(o)===a100, 'cooldown fully over after heatDays');
  const TIERS=P(O,'TIERS'); let mono=true; o.lastFeds=-99; o.heat=100;
  for(let t=1;t<TIERS.length;t++){ o.tier=t-1; const lo=O.G.fedsOdds(o); o.tier=t; if(O.G.fedsOdds(o)<lo) mono=false; }
  ok(mono, 'fedsOdds non-decreasing across tiers at max heat');
}

/* ---------------- trunk incl. find event ---------------- */
{
  let finds=0, over=false, vans=0;
  for(let n=0;n<300 && finds<25;n++){
    const E=fresh(); const {G,DISTRICTS}=E; G.new('FIND-'+n,60); const s=G.state;
    const cheap = cheapest(s);
    G.buy(cheap, Math.min(G.maxBuy(s,cheap), s.trunk-2));
    for(let d=0; d<59 && s.phase!=='over'; d++){
      G.travel((s.loc+1)%DISTRICTS.length);
      if(G.used(s)>s.trunk) over=true;
      if(s.event && s.event.kind==='find') finds++;
      if(s.event && s.event.kind==='van' && s.cash>=s.event.price){ const t=s.trunk; G.acceptOffer(); if(s.trunk===t+E.RULES.vanBonus) vans++; }
      settle(E);
    }
  }
  ok(!over && finds>0, 'trunk never exceeded across '+finds+' find events (near-full trunk) and '+vans+' van purchases');
}

/* ---------------- loan / bank / travel / services ---------------- */
{
  const E=fresh(); const {G,RULES,DISTRICTS,HOME}=E; G.new('LOAN-1',30,1); const s=G.state; const T=G.T(s);
  ok(!G.travel(s.loc).ok, 'travel to same district refused');
  ok(!G.travel(-1).ok && !G.travel(DISTRICTS.length).ok, 'travel out of range refused');
  ok(G.deposit(500).ok && s.bank===500 && s.cash===T.cash-500, 'deposit at HOME');
  let debt=s.debt, bank=s.bank, okAll=true, day=s.day;
  for(let k=0;k<10;k++){
    const r=G.travel((s.loc+1)%DISTRICTS.length); if(!r.ok||s.phase!=='market') break;
    debt=Math.round(debt*(1+T.rate)); bank=Math.round(bank*(1+RULES.bankRate)); day++;
    if(s.debt!==debt||s.bank!==bank||s.day!==day) okAll=false;
  }
  ok(okAll, 'loan compounds at tier.rate and bank at bankRate per travel; day increments');
  if(s.loc!==HOME){
    ok(!G.deposit(1).ok && !G.withdraw(1).ok && !G.payDebt(1).ok && !G.borrow(1).ok && !G.heal().ok, 'all services refused when loc !== HOME');
  } else ok(true,'(landed at HOME — service refusal covered below)');
  const F=fresh(); F.G.new('LOAN-2',30,1); const t=F.G.state; t.cash=10000; t.bank=0; t.debt=3000; t.principal=3000; t.health=50;
  ok(F.G.canService(t), 'canService true at HOME in market phase');
  for(const ph of ['encounter','collectors','over']){ t.phase=ph; ok(!F.G.canService(t) && !F.G.deposit(1).ok && !F.G.withdraw(1).ok && !F.G.payDebt(1).ok && !F.G.borrow(1).ok && !F.G.heal().ok, 'services refused at HOME in phase '+ph); }
  t.phase='market';
  ok(!F.G.withdraw(1).ok, 'withdraw refused with empty account');
  ok(F.G.deposit(4000).ok && !F.G.deposit(7000).ok && t.bank===4000, 'deposit refuses more than cash on hand');
  ok(F.G.withdraw(1000).ok && t.bank===3000 && t.cash===7000, 'withdraw arithmetic');
  ok(F.G.payDebt(99999).ok && t.debt===0 && t.principal===0 && t.cash===4000, 'payDebt clips to the debt owed; principal follows');
  ok(!F.G.payDebt(1).ok, 'payDebt refused when nothing owed');
  ok(t.story.paid && t.story.supplier && t.supplierNext===t.day, 'paying to zero sets story.paid + story.supplier, supplierNext = today');
  const room=F.G.maxLoan(t)-t.debt;
  ok(F.G.maxLoan(t)===Math.max(F.RULES.loanFloor,Math.floor(F.RULES.maxLoanMult*F.G.netWorth(t))), 'maxLoan = maxLoanMult × netWorth, floor loanFloor');
  ok(!F.G.borrow(room+1).ok && F.G.borrow(room).ok && t.debt===room && t.principal===room, 'borrow honors the ceiling exactly; principal = new debt');
  ok(!F.G.borrow(1).ok, 'no compounding borrow: ceiling is keyed to net worth, so a max borrow leaves no room');
  const nw=F.G.netWorth(t); t.creditCut=true;
  ok(F.G.maxLoan(t)===Math.max(F.RULES.loanFloor,Math.floor(F.RULES.maxLoanMult*nw*0.5)), 'creditCut halves maxLoan (above the floor)');
  t.creditCut=false;
  const per=Math.round(F.RULES.clinicPerHp*F.G.T(t).cost); const cost=(100-50)*per; t.cash=cost+100; const c0=t.cash;
  ok(F.G.heal().ok && t.health===100 && t.cash===c0-cost, 'heal charges clinicPerHp × tier.cost per point');
  ok(!F.G.heal().ok, 'heal refused at full health');
  t.health=10; t.cash=per*3+5; ok(F.G.heal().ok && t.health===13 && t.cash===5, 'heal partial when cash is short');
  t.cash=0; t.health=10; ok(!F.G.heal().ok, 'heal refused with no cash');
  const T2=fresh(); let u, last;
  for(let n=0;n<50;n++){ u=T2.G.new('TIME-'+n,30); last=null;
    while(u.phase!=='over'){ if(u.phase!=='market'){ settle(T2); continue; } last=T2.G.travel((u.loc+1)%T2.DISTRICTS.length); }
    if(u.result.why==='time') break; }
  ok(last.over===true && u.result.why==='time' && u.result.day===30 && u.day===31 && u.event.kind==='over' && u.result.tier===u.tier && u.result.score===T2.G.score(u), 'day > days → phase over, result {why:time, day, tier, score}');
  ok(!T2.G.travel(1).ok && !T2.G.buy(0,1).ok, 'actions refused after game over');
  ok(T2.G.new('X',99).days===T2.RULES.daysOptions[0] && T2.G.new('X',60).days===60, 'G.new clamps days to daysOptions');
}

/* ---------------- launder (Outlet Mall) ---------------- */
{
  const E=fresh(); const {G,RULES}=E; G.new('WASH',30,1); const s=G.state; s.cash=20000; s.heat=50;
  ok(!G.launder(1000).ok && s.bank===0, 'launder refused away from the Outlet Mall');
  s.loc=MALL; s.phase='market';
  ok(!G.launder(0).ok && !G.launder(s.cash+1).ok && s.bank===0, 'launder refuses n<=0 / more than cash');
  ok(G.launderFee(s)===RULES.launderFee, 'launderFee = launderFee without Tanya\'s perk');
  ok(G.launder(10000).ok && s.cash===10000 && s.bank===Math.floor(10000*(1-RULES.launderFee)) && s.heat===50-RULES.heatLaunder && s.stats.laundered===10000, 'launder moves cash→bank minus fee, −heatLaunder');
  s.rep[MALL]=P(E,'REP_PERK'); ok(G.hasPerk(s,MALL) && G.launderFee(s)===RULES.launderFeePerk, 'Tanya at REP_PERK → launderFeePerk');
  const b=s.bank; G.launder(5000); ok(s.bank===b+Math.floor(5000*(1-RULES.launderFeePerk)), 'perk fee applied');
}

/* ---------------- collectors ---------------- */
{
  const E0=fresh(); const RULES=E0.RULES, TIERS=P(E0,'TIERS');
  const hiTier=TIERS.length-1;
  // a run that never pays: debt compounds past principal×overdueMult, overdue counts consecutive days
  const E=fresh(); E.G.new('OVERDUE',60,hiTier); const s=E.G.state; let firstOverdueDay=null, prevOverdue=0, okCount=true;
  while(s.phase==='market' && s.day<20){
    E.G.travel((s.loc+1)%6);
    const isO=s.debt>s.principal*RULES.overdueMult;
    if(isO && firstOverdueDay===null) firstOverdueDay=s.day;
    if(isO){ if(s.overdue!==prevOverdue+1) okCount=false; } else if(s.overdue!==0) okCount=false;
    prevOverdue=s.overdue;
    if(s.phase==='collectors') break;
    if(s.phase==='encounter') settle(E);
  }
  ok(firstOverdueDay!==null && okCount, 'G.isOverdue when debt > principal × overdueMult; state.overdue counts consecutive overdue days (first overdue day '+firstOverdueDay+' on '+TIERS[hiTier].name+')');
  ok(E.G.isOverdue(s)===(s.debt>s.principal*RULES.overdueMult), 'G.isOverdue matches the rule');
  // force a collectors phase by seed-looping
  function forceCollectors(prefix, tier, maxSeeds){
    for(let n=0;n<maxSeeds;n++){
      const E=fresh(); const {G}=E; G.new(prefix+n,60,tier); const s=G.state; s.inv[7]=1; // a little stock so seizure is visible
      let guard=0;
      while(s.phase!=='over' && guard++<70){
        if(s.phase==='encounter'){ G.run(); continue; }
        if(s.phase==='collectors') return {E, seeds:n+1};
        G.travel((s.loc+1)%6);
      }
    }
    return null;
  }
  const C=forceCollectors('COL-',hiTier,300);
  ok(!!C, 'collectors arrive within '+(C?C.seeds:'?')+' seeds on '+TIERS[hiTier].name+' when the loan is never paid');
  if(C){
    const {G}=C.E; const s=G.state; const save=G.save();
    ok(s.encounter.kind==='collectors' && s.encounter.agents>=2 && s.event.kind==='collectors' && s.overdue>=RULES.overdueDays, 'collectors state: encounter{kind,agents}, event kind collectors, overdue ≥ overdueDays');
    ok(s.creditCut===TIERS[hiTier].cutCredit, 'creditCut set on a cutCredit tier when collectors arrive');
    ok(!G.travel((s.loc+1)%6).ok && !G.layLow().ok && !G.buy(0,1).ok && !G.run().ok && !G.bribe().ok, 'travel/layLow/buy/run/bribe refused during collectors');
    // colPay
    const min=Math.ceil(s.debt*RULES.collectorsMinFrac), want=Math.ceil(s.debt*RULES.collectorsPayFrac);
    s.cash=min-1; ok(!G.colPay().ok && s.phase==='collectors' && s.cash===min-1, 'colPay refuses under collectorsMinFrac of the debt');
    { const A=fresh(); A.G.load(save); const a=A.G.state; a.cash=min+5; const d=a.debt;
      ok(A.G.colPay().ok && a.cash===0 && a.debt===d-(min+5) && a.principal===a.debt && a.overdue===0 && a.phase==='market' && a.encounter===null && a.event.kind==='clear', 'colPay between min and want takes all cash: debt −cash, principal reset, overdue 0, back to market'); }
    { const A=fresh(); A.G.load(save); const a=A.G.state; a.cash=want*3; const d=a.debt;
      ok(A.G.colPay().ok && a.cash===want*3-want && a.debt===d-want && a.principal===a.debt && a.overdue===0, 'colPay with plenty of cash takes exactly collectorsPayFrac of the debt');
      ok(a.debt<=a.principal*RULES.overdueMult, 'after colPay you are no longer overdue');
      ok(!A.G.colPay().ok && !A.G.colBeat().ok && !A.G.colVan().ok, 'col* refused when nobody is collecting'); }
    // colBeat
    { const A=fresh(); A.G.load(save); const a=A.G.state; a.health=100; a.inv=A.GOODS.map(()=>10); a.paid=A.GOODS.map((g,i)=>10*g.lo);
      const r=A.G.colBeat(); const dmg=100-a.health;
      ok(r.ok && dmg>=RULES.collectorsHit[0] && dmg<=RULES.collectorsHit[1] && a.inv.every(v=>v===10-Math.floor(10*RULES.collectorsSeize)) && a.paid.every((p,i)=>p===a.inv[i]*A.GOODS[i].lo) && a.overdue===0 && a.principal===a.debt && a.phase==='market' && a.event.kind==='hit' && a.rng===A.RNG.state, 'colBeat: health −[collectorsHit], skims collectorsSeize of each stack (basis follows), overdue reset, rng stored'); }
    { const A=fresh(); A.G.load(save); const a=A.G.state; a.health=RULES.collectorsHit[0];
      const r=A.G.colBeat(); ok(r.over===true && a.phase==='over' && a.result.why==='collectors' && a.health<=0 && a.event.kind==='over', 'colBeat at health ≤ collectorsHit[0] ends the run: result.why collectors'); }
    // colVan
    { const A=fresh(); A.G.load(save); const a=A.G.state; const base=A.G.T(a).trunk; a.trunk=base;
      ok(!A.G.colVan().ok && a.phase==='collectors', 'colVan refuses with only the base trunk');
      a.trunk=base+RULES.vanBonus; a.inv=A.GOODS.map(()=>0); a.paid=A.GOODS.map(()=>0); a.inv[0]=base; a.inv[7]=RULES.vanBonus; a.paid[7]=RULES.vanBonus*100;
      ok(A.G.colVan().ok && a.trunk===base && A.G.used(a)===base && a.inv[0]===base && a.inv[7]===0 && a.paid[7]===0 && a.overdue===0 && a.phase==='market' && a.event.kind==='clear', 'colVan: trunk back to tier base, overflow dropped from the last goods first, back to market'); }
  }
  // creditCut only on cutCredit tiers
  const cutTier=TIERS.findIndex(t=>!t.cutCredit);
  if(cutTier>=0){ const C2=forceCollectors('NOCUT-',cutTier,400);
    ok(C2 && C2.E.G.state.creditCut===false, 'collectors on a non-cutCredit tier ('+TIERS[cutTier].name+') leave creditCut false'+(C2?'':' (none forced in 400 seeds)')); }
}

/* ---------------- jobs ---------------- */
{
  const E=fresh(); const {G,GOODS,RULES,DISTRICTS}=E; const CONTACTS=P(E,'CONTACTS'), JOBS=P(E,'JOBS'), REP_MIN_JOB=P(E,'REP_MIN_JOB'), REP_PERK=P(E,'REP_PERK');
  // board generated per visited district, from that contact's templates
  let boardsOk=true, seen=new Set(), bad=null;
  for(let n=0;n<30 && boardsOk;n++){ G.new('BOARD-'+n,30,1); const s=G.state;
    for(let d=0; d<12 && s.phase!=='over'; d++){
      if(s.phase!=='market'){ settle(E); continue; }
      const c=s.loc, b=s.board[c];
      if(!Array.isArray(b)||b.length<1||b.length>RULES.boardSize){ boardsOk=false; bad='board size at '+c+': '+(b&&b.length); }
      else for(const j of b){ seen.add(c); const tpl=JOBS[CONTACTS[c].k];
        if(j.contact!==c || !tpl.some(t=>t.type===j.type&&t.title===j.title) || !(j.due>s.day) || typeof j.text!=='string' || j.text.includes('{')){ boardsOk=false; bad='bad job '+JSON.stringify(j); } }
      G.travel((s.loc+1)%DISTRICTS.length);
    } }
  ok(boardsOk && seen.size===CONTACTS.length, 'board per visited district: 1..boardSize jobs, each from that contact\'s templates, due in the future, text filled (all '+seen.size+' contacts seen)', bad);
  { G.new('BOARD-LOW',30,1); const s=G.state; s.rep[PORT]=REP_MIN_JOB-1; G.travel(PORT); settle(E); ok(eq(s.board[PORT],[]), 'a contact below REP_MIN_JOB posts no jobs'); }

  // helpers to plant a job on the board deterministically (templates from data, values under our control)
  function plant(E,s,c,type,over){ const t=JOBS[CONTACTS[c].k].find(t=>t.type===type); const j={id:0,type,contact:c,title:t.title,rep:t.rep,due:s.day+t.days[0],text:'x'};
    Object.assign(j,over); s.board[c]=[j]; s.loc=c; return j; }
  // maxJobs
  { G.new('MAXJ',30,1); const s=G.state; s.cash=1e6;
    plant(E,s,CAMPUS,'rush',{good:gi(E,'weed'),qty:5,price:1000}); ok(G.accept(0).ok && s.jobs.length===1 && s.jobs[0].id===1 && s.board[CAMPUS].length===0, 'accept moves the job off the board, assigns id');
    ok(!G.accept(0).ok, 'accept refuses an empty slot');
    plant(E,s,CAMPUS,'rush',{good:gi(E,'weed'),qty:5,price:1000}); G.accept(0);
    plant(E,s,CAMPUS,'rush',{good:gi(E,'weed'),qty:5,price:1000}); ok(!G.accept(0).ok && s.jobs.length===RULES.maxJobs, 'accept enforces maxJobs='+RULES.maxJobs); }
  // import cash up front
  { G.new('IMP',30,1); const s=G.state; plant(E,s,PORT,'import',{good:gi(E,'weed'),qty:10,price:100,cost:1000,at:PORT}); s.cash=999;
    ok(!G.accept(0).ok && s.jobs.length===0, 'import accept refuses without the cash'); s.cash=1000; ok(G.accept(0).ok && s.cash===0, 'import accept takes the cost up front'); }
  // cook needs bottles
  { G.new('COOK',30,1); const s=G.state; const ket=gi(E,'ket'); plant(E,s,DCR,'cook',{good:ket,qty:20,yield:1.5,badP:0.15,at:DCR,out:30}); s.inv[ket]=19; s.paid[ket]=19*1000;
    ok(!G.accept(0).ok, 'cook accept refuses short of bottles'); s.inv[ket]=25; s.paid[ket]=25*1000; ok(G.accept(0).ok && s.inv[ket]===5 && s.paid[ket]===5*1000, 'cook accept takes the bottles (basis follows)'); }
  // case heat check
  { G.new('CASE',30,1); const s=G.state; plant(E,s,E.HOME,'case',{heat:40,retainers:1,start:s.day}); s.heat=40; ok(!G.accept(0).ok, 'case accept refuses at/over the heat line'); s.heat=39; ok(G.accept(0).ok, 'case accept under the line'); }

  // rush deliver
  { G.new('RUSH',30,1); const s=G.state; const weed=gi(E,'weed'); s.cash=0; s.heat=0;
    const j=plant(E,s,CAMPUS,'rush',{good:weed,qty:5,price:1000}); G.accept(0); const id=s.jobs[0].id; const rep0=s.rep[CAMPUS];
    s.inv[weed]=4; s.paid[weed]=4*400; ok(!G.deliver(id).ok, 'deliver refuses short stock');
    s.inv[weed]=5; s.paid[weed]=5*400; s.loc=MALL; ok(!G.deliver(id).ok, 'deliver refuses in the wrong district'); s.loc=CAMPUS;
    ok(!G.deliver(999).ok, 'deliver refuses an unknown job id');
    ok(G.deliver(id).ok && s.cash===5000 && s.inv[weed]===0 && s.paid[weed]===0 && s.rep[CAMPUS]===rep0+j.rep && s.jobs.length===0 && s.stats.jobs===1 && s.stats.profit===5000-2000 && s.event.kind==='job' && s.dayVol===5000*GOODS[weed].heat, 'rush deliver pays qty×price, clears stock, +rep, stats, dayVol, job event');
    // Hale heat gate
    const coke=gi(E,'coke'); plant(E,s,MARINA,'rush',{good:coke,qty:2,price:50000,heat:40}); G.accept(0); const hid=s.jobs[0].id; s.inv[coke]=2; s.heat=40;
    ok(!G.deliver(hid).ok, 'Hale refuses delivery at/over his heat line'); s.heat=39.9; ok(G.deliver(hid).ok && s.cash===5000+100000, 'Hale pays under the line');
    // deliver on non-rush refused
    plant(E,s,E.HOME,'case',{heat:60,retainers:1,start:s.day}); s.heat=0; G.accept(0); ok(!G.deliver(s.jobs[0].id).ok, 'deliver refuses a non-rush job'); }
  // rush expiry
  { G.new('EXPIRE',30,1); const s=G.state; const weed=gi(E,'weed'); plant(E,s,CAMPUS,'rush',{good:weed,qty:5,price:1000}); G.accept(0); const j=s.jobs[0]; const rep0=s.rep[CAMPUS]; s.inv=GOODS.map(()=>0);
    while(s.phase!=='over' && s.jobs.length && s.day<=j.due){ if(s.phase!=='market'){ settle(E); continue; } G.travel(s.loc===CAMPUS?MALL:CAMPUS); }
    ok(s.jobs.length===0 && s.rep[CAMPUS]===rep0-j.rep-5 && s.stats.jobsFailed===1 && s.day===j.due+1, 'rush expires the day after due → jobFail, rep −(rep+5), stats.jobsFailed'); }
  // import lands only at the Port on the due day
  { G.new('IMP-2',30,1); const s=G.state; const weed=gi(E,'weed'); s.cash=1e6; plant(E,s,PORT,'import',{good:weed,qty:10,price:100,cost:1000,at:PORT}); G.accept(0); const j=s.jobs[0];
    s.inv=GOODS.map(()=>0); s.paid=GOODS.map(()=>0);
    while(s.phase!=='over' && s.day<j.due-1){ if(s.phase!=='market'){ settle(E); continue; } G.travel(s.loc===DCR?CAMPUS:DCR); }
    settle(E); G.travel(PORT); settle(E);
    ok(s.day===j.due && s.jobs.length===0 && s.inv[weed]===10 && s.paid[weed]===1000 && s.stats.jobs===1, 'import lands at the Port on the due day: stock in, basis = price paid');
    // the miss
    G.new('IMP-3',30,1); const t=G.state; t.cash=1e6; plant(E,t,PORT,'import',{good:weed,qty:10,price:100,cost:1000,at:PORT}); G.accept(0); const k=t.jobs[0]; t.inv=GOODS.map(()=>0);
    while(t.phase!=='over' && t.jobs.length && t.day<=k.due+1){ if(t.phase!=='market'){ settle(E); continue; } G.travel(t.loc===DCR?CAMPUS:DCR); }
    ok(t.jobs.length===0 && t.inv[weed]===0 && t.stats.jobsFailed===1 && t.day===k.due+1, 'import missed (not at the Port on the due day) is lost the day after');
    // overflow clip
    G.new('IMP-4',30,1); const u=G.state; u.cash=1e6; plant(E,u,PORT,'import',{good:weed,qty:10,price:100,cost:1000,at:PORT}); G.accept(0); const m=u.jobs[0];
    u.inv=GOODS.map(()=>0); u.inv[7]=u.trunk-3;
    while(u.phase!=='over' && u.day<m.due-1){ if(u.phase!=='market'){ settle(E); continue; } G.travel(u.loc===DCR?CAMPUS:DCR); }
    settle(E); G.travel(PORT); ok(u.inv[weed]===3 && G.used(u)===u.trunk, 'import clips to trunk space'); }
  // cook: resolves at DCR on/after due; find a good and a bad batch by seed-looping
  { const ket=gi(E,'ket'); let good=null, badB=null;
    for(let n=0;n<200 && !(good&&badB);n++){ G.new('COOK-'+n,30,1); const s=G.state; s.inv[ket]=20; s.paid[ket]=20*1000; s.heat=0;
      plant(E,s,DCR,'cook',{good:ket,qty:20,yield:1.5,badP:0.5,at:DCR,out:30}); G.accept(0); const j=s.jobs[0];
      while(s.phase!=='over' && s.day<j.due-1){ if(s.phase!=='market'){ settle(E); continue; } G.travel(s.loc===CAMPUS?MALL:CAMPUS); }
      settle(E); if(s.phase!=='market') continue; G.travel(DCR);
      if(s.jobs.length) continue;
      if(s.stats.jobs===1 && s.inv[ket]===30 && s.event.kind==='job') good=good||n;
      else if(s.stats.jobsFailed===1 && s.inv[ket]===Math.round(20*0.6) && s.heat>=RULES.heatBadBatch) badB=badB||n;
    }
    ok(good!==null && badB!==null, 'cook: good batch hands back `out` bottles (seed '+good+'); bad batch hands back 60%, +heatBadBatch, jobFail (seed '+badB+')');
    G.new('COOK-LATE',30,1); const s=G.state; s.inv[ket]=20; plant(E,s,DCR,'cook',{good:ket,qty:20,yield:1.5,badP:0,at:DCR,out:30}); G.accept(0); const j=s.jobs[0];
    while(s.phase!=='over' && s.jobs.length){ if(s.phase!=='market'){ settle(E); continue; } G.travel(s.loc===CAMPUS?MALL:CAMPUS); }
    ok(s.stats.jobsFailed===1 && s.day===j.due+5 && s.inv[ket]===0, 'cook never collected is sold off 5 days after due');
    G.new('COOK-PERK',30,1); const t=G.state; t.rep[DCR]=REP_PERK; G.travel(DCR); settle(E);
    const cj=(t.board[DCR]||[]).find(x=>x.type==='cook'); ok(!cj || cj.badP===0, 'Dee\'s perk: cook jobs roll with badP 0'); }
  // case: fails when heat crosses, pays retainers at due
  { G.new('CASE-2',30,1); const s=G.state; s.heat=0; plant(E,s,E.HOME,'case',{heat:30,retainers:2,start:s.day}); G.accept(0); const j=s.jobs[0]; const l0=s.lawyers;
    while(s.phase!=='over' && s.jobs.length){ if(s.phase!=='market'){ settle(E); continue; } s.heat=0; G.travel(s.loc===CAMPUS?MALL:CAMPUS); }
    ok(s.lawyers===l0+2 && s.stats.jobs===1 && s.day===j.due, 'case held to due day pays the retainers as lawyers');
    G.new('CASE-3',30,1); const t=G.state; t.heat=0; plant(E,t,E.HOME,'case',{heat:30,retainers:1,start:t.day}); G.accept(0); const rep0=t.rep[0];
    t.heat=100; G.travel(CAMPUS); ok(t.jobs.length===0 && t.stats.jobsFailed===1 && t.rep[0]<rep0, 'case fails on arrival once heat ≥ the line'); }
}

/* ---------------- supplier + The Big One ---------------- */
{
  const E=fresh(); const {G,GOODS,RULES}=E;
  G.new('SUP',30,1); const s=G.state; s.cash=1e6;
  G.travel(PORT); settle(E); ok(s.supplierOffer===null && !G.supplierBuy().ok, 'no supplier offer before the loan is paid');
  settle(E); if(s.phase==='market'){ G.travel(E.HOME); settle(E); }
  G.payDebt(s.debt); ok(s.story.paid && s.story.supplier, 'paying PayLater to zero unlocks the supplier');
  G.travel(PORT); settle(E);
  const o=s.supplierOffer;
  ok(o && o.day===s.day && o.qty>=RULES.supplierQty[0] && o.qty<=RULES.supplierQty[1] && o.price===Math.round(GOODS[o.good].lo*RULES.supplierMult), 'supplier offer at the Port: qty in supplierQty, price = lo × supplierMult');
  if(o){ const c0=s.cash, inv0=s.inv[o.good]; const cost=o.qty*o.price;
    s.cash=cost-1; ok(!G.supplierBuy().ok, 'supplierBuy refuses short of cash'); s.cash=c0;
    const inv=s.inv.slice(); s.inv[7]=s.trunk; ok(!G.supplierBuy().ok, 'supplierBuy refuses without trunk space'); s.inv=inv;
    ok(G.supplierBuy().ok && s.cash===c0-cost && s.inv[o.good]===inv0+o.qty && s.paid[o.good]>=cost && s.supplierOffer===null && s.supplierNext===s.day+RULES.supplierEvery, 'supplierBuy: cash −qty×price, stock in, next offer in supplierEvery days');
    ok(!G.supplierBuy().ok, 'a second buy the same day refused');
    G.travel(DCR); settle(E); if(s.phase==='market'){ G.travel(PORT); settle(E); }
    ok(s.supplierOffer===null, 'no offer at the Port before supplierNext');
  }
  s.loc=MALL; s.phase='market'; s.supplierOffer={day:s.day,good:0,qty:1,price:1}; ok(!G.supplierBuy().ok, 'supplierBuy refused away from the Port');
  // The Big One
  let big=null;
  for(let n=0;n<40 && !big;n++){ G.new('BIG-'+n,30,1); const t=G.state; t.cash=1e6; t.story.supplier=true; t.story.paid=true;
    t.day=Math.floor(t.days*0.5)-2; G.travel(MARINA); settle(E); if(t.story.bigone) big='early';
    if(t.phase!=='market') continue;
    G.travel(E.HOME); settle(E); if(t.phase!=='market') continue; G.travel(MARINA); settle(E);
    if(t.story.bigone && t.board[MARINA][0] && t.board[MARINA][0].story==='bigone') big=t; }
  ok(big && big!=='early', 'The Big One appears on the Marina board once the supplier is unlocked and day ≥ floor(days/2), never before');
  if(big&&big!=='early'){ const j=big.board[MARINA][0]; const coke=gi(E,'coke'), her=gi(E,'her');
    ok(j.type==='rush' && j.contact===MARINA && j.good===coke && j.extraGood===her && j.qty>=2 && j.extraQty>=3 && j.due===big.days-1 && j.heat===40 && j.price===Math.round(GOODS[coke].hi*3.5) && !j.text.includes('{'), 'Big One job: rush for Hale, coke + heroin, due the day before the end, filled text');
    G.travel(E.HOME); settle(E); if(big.phase==='market'){ G.travel(MARINA); settle(E); }
    ok(big.story.bigone && big.board[MARINA].filter(x=>x.story==='bigone').length<=1, 'The Big One is offered once'); }
  { G.new('NOBIG',30,1); const t=G.state; t.day=t.days-3; G.travel(MARINA); ok(!t.story.bigone, 'no Big One without the supplier'); }
}

/* ---------------- encounter flow ---------------- */
{
  function forceEncounter(seedPrefix, days){
    for(let n=0;n<2000;n++){
      const E=fresh(); const {G,DISTRICTS}=E; G.new(seedPrefix+n, days, 1); const s=G.state;
      const cheap = cheapest(s);
      G.buy(cheap, G.maxBuy(s,cheap));
      for(let d=0; d<days-1; d++){ G.travel((s.loc+1)%DISTRICTS.length); if(s.phase==='encounter') return E; if(s.phase!=='market') break; }
    }
    return null;
  }
  const E=forceEncounter('FEDS-',30);
  ok(!!E, 'an encounter can be forced by looping seeds');
  if(E){
    const {G,RULES}=E; const s=G.state; const e=s.encounter;
    ok(s.event.kind==='feds' && e.kind==='feds' && e.agents>=1 && e.agents===e.start && e.rounds===0 && s.lastFeds===s.day, 'encounter state {kind,agents,start,rounds} + feds event; lastFeds = today');
    ok(!G.travel((s.loc+1)%6).ok && !G.buy(0,1).ok && !G.layLow().ok, 'travel/buy/layLow refused during encounter');
    ok(!G.lawyerUp().ok && s.lawyers===0, 'lawyerUp refused with no retainer');
    const cost=G.bribeCost(s);
    ok(cost===Math.round(RULES.bribePerAgent*e.agents*(1+s.day/s.days)*G.T(s).cost), 'bribeCost formula (× tier.cost, no Lorna perk)');
    s.rep[0]=P(E,'REP_PERK'); ok(G.bribeCost(s)===Math.round(RULES.bribePerAgent*e.agents*(1+s.day/s.days)*G.T(s).cost*0.7), 'Lorna\'s perk: bribes 30% cheaper'); s.rep[0]=P(E,'REP_START');
    const cash=s.cash; s.cash=cost-1;
    ok(!G.bribe().ok && s.cash===cost-1 && s.phase==='encounter', 'bribe refused when short, cash untouched');
    const B=fresh(); B.G.load(G.save()); const b=B.G.state; b.cash=cost+10; const bh=b.heat;
    ok(B.G.bribe().ok && b.cash===10 && b.phase==='market' && b.encounter===null && b.stats.bribes===1 && b.event.kind==='clear' && b.heat===Math.min(100,bh+RULES.heatBribe), 'bribe clears the encounter, debits exactly the cost, +heatBribe');
    const L=fresh(); L.G.load(G.save()); const l=L.G.state; l.lawyers=5; l.heat=80; const startAgents=l.encounter.agents; let rounds=0;
    while(l.phase==='encounter' && rounds<10){ const r=L.G.lawyerUp(); if(!r.ok) break; rounds++; }
    ok(l.phase==='market' && l.lawyers===5-rounds && l.stats.cases===1 && rounds>=Math.ceil(startAgents/2) && l.heat===80-rounds*RULES.heatLawyer, 'lawyerUp peels 1-2 agents/round, −heatLawyer each, wins when agents hit 0');
    s.cash=cash; let R=null, r=null, out=null, tries=0;
    for(let k=0;k<200 && !r;k++){ const C=fresh(); C.G.load(G.save()); const c=C.G.state; c.health=1; c.cash=1234; c.bank=50; c.rng=(s.rng+k)|0; tries++;
      const o=C.G.run(); if(c.phase==='over'){ R=C; r=c; out=o; } }
    ok(!!r, 'a failing run was found within '+tries+' rng nudges');
    if(r){
      ok(r.phase==='over' && r.result.why==='custody' && r.cash===0 && r.inv.every(v=>v===0) && r.paid.every(v=>v===0) && out.over===true && r.result.netWorth===50-r.debt && r.event.kind==='over' && r.encounter===null, 'health→0 on a failed run → custody: cash 0, inventory seized, over:true, netWorth = bank - debt');
      ok(!R.G.run().ok && !R.G.bribe().ok && !R.G.lawyerUp().ok, 'run/bribe/lawyerUp refused when nobody is chasing');
    }
  }
  let custody=0, escapes=0, hits=0, badHealth=false, badHit=false, backToBack=0;
  for(let n=0;n<400;n++){
    const E=fresh(); const {G,RULES,DISTRICTS}=E; G.new('SWEEP-'+n,30,1); const s=G.state;
    const cheap = cheapest(s);
    G.buy(cheap, G.maxBuy(s,cheap)); let lastChase=-99;
    while(s.phase!=='over'){
      if(s.phase==='encounter'){
        if(s.encounter.rounds===0){ if(s.day===lastChase+1) backToBack++; lastChase=s.day; }
        const h=s.health, esc=s.stats.escapes; G.run();
        if(s.stats.escapes>esc) escapes++;
        else { hits++; const dmg=h-s.health; if(dmg<RULES.hitLo||dmg>RULES.hitHi) badHit=true; if(s.phase==='over' && s.result.why!=='custody') badHealth=true; if(s.phase!=='over' && s.health<=0) badHealth=true; }
        if(s.phase==='over' && s.result.why==='custody'){ custody++; if(s.cash!==0||G.used(s)!==0) badHealth=true; }
      } else if(s.phase==='collectors'){ if(!G.colPay().ok) G.colBeat(); }
      else G.travel((s.loc+1)%DISTRICTS.length);
    }
  }
  ok(custody>0 && escapes>0 && !badHealth && !badHit, 'encounter sweep: '+escapes+' escapes, '+hits+' hits in [hitLo..hitHi], '+custody+' custody endings all with cash 0 / empty stash ('+backToBack+' next-day chases: cooldown is soft)');
}

/* ---------------- rank + fmt ---------------- */
{
  const E=fresh(); const {G,RANKS,fmt,fmtK}=E;
  const order=RANKS.map(r=>G.rank(r[0]));
  ok(eq(order, RANKS.map(r=>r[1])), 'G.rank returns each tier at its threshold');
  ok(G.rank(RANKS[0][0]-1)===RANKS[1][1] && G.rank(-1)===RANKS[RANKS.length-1][1] && G.rank(0)===RANKS[RANKS.length-2][1] && G.rank(1e12)===RANKS[0][1], 'G.rank boundaries (one below top tier, 0, -1, huge)');
  let mono=true; for(let i=1;i<RANKS.length;i++) if(RANKS[i][0]>=RANKS[i-1][0]) mono=false;
  ok(mono, 'RANKS thresholds strictly descending');
  ok(fmt(0)==='$0' && fmt(999)==='$999' && fmt(1000)==='$1,000' && fmt(1234567)==='$1,234,567' && fmt(-5500)==='-$5,500' && fmt(999.6)==='$1,000', 'fmt() thousands separators, sign, rounding');
  ok(fmtK(950)==='$950' && fmtK(12345)==='$12.3K' && fmtK(2500000)==='$2.50M' && fmtK(-3e9)==='-$3.00B', 'fmtK() abbreviations');
  ok(E.hashSeed('EGG-2026')===E.hashSeed('EGG-2026') && E.hashSeed('a')!==E.hashSeed('b') && Number.isInteger(E.hashSeed('x')), 'hashSeed stable + integer');
}

/* ---------------- Monte Carlo balance report per tier (prints, never asserts) ---------------- */
{
  const SEEDS=150, DAYS=30; const E0=fresh(); const TIERS=P(E0,'TIERS');
  console.log('\n--- balance (greedy bot, '+SEEDS+' seeds per tier, '+DAYS+' days; not asserted) ---');
  console.log('tier      p10          median       p90          custody  collectors  jobs/run  laylow/run');
  for(let t=0;t<TIERS.length;t++){
    const results=[]; let custody=0, collectors=0, jobs=0, laylows=0;
    for(let n=0;n<SEEDS;n++){
      const E=fresh(); const {G,DISTRICTS}=E; G.new('MC-'+t+'-'+n, DAYS, t); const s=G.state; const rr=botRng(1000+n);
      let guard=0;
      while(s.phase!=='over' && guard++<5000){
        if(s.phase==='encounter'){ if(s.lawyers>0) G.lawyerUp(); else if(s.cash>=G.bribeCost(s)) G.bribe(); else G.run(); continue; }
        if(s.phase==='collectors'){ if(!G.colPay().ok && !G.colVan().ok) G.colBeat(); continue; }
        for(const j of s.jobs.slice()) if(j.type==='rush' && j.contact===s.loc) G.deliver(j.id);
        for(let i=0;i<s.inv.length;i++) if(s.inv[i]>0 && s.prices[i]>0 && s.prices[i]>G.avgPaid(s,i)) G.sell(i,s.inv[i]);
        if(s.event && s.event.offer && !s.event.taken && s.cash>s.event.price*3) G.acceptOffer();
        const b=s.board[s.loc]||[]; for(let k=0;k<b.length;k++){ const j=b[k]; if(j.type==='rush' && s.jobs.length<E.RULES.maxJobs && G._midPrice(j.good)*j.qty<s.cash){ G.accept(k); break; } }
        if(s.supplierOffer && s.supplierOffer.day===s.day) G.supplierBuy();
        let best=-1,bestR=0;
        for(let i=0;i<s.prices.length;i++){ if(!s.prices[i]) continue; const r=G._midPrice(i)/s.prices[i]; if(r>bestR){bestR=r;best=i;} }
        if(best>=0){ const n=G.maxBuy(s,best); if(n>0) G.buy(best,n); }
        if(s.loc===E.HOME && s.cash>s.debt && s.debt>0) G.payDebt(s.debt);
        if(s.loc===E.HOME && s.health<60 && s.cash>5000) G.heal();
        if(s.loc===MALL && s.cash>20000) G.launder(Math.floor(s.cash/2));
        if(s.heat>=75 && G.used(s)>0){ laylows++; G.layLow(); continue; }
        let d=(rr()*DISTRICTS.length)|0; if(d===s.loc) d=(d+1)%DISTRICTS.length;
        G.travel(d);
      }
      const nw=s.result? s.result.netWorth : G.netWorth(s);
      results.push(nw); jobs+=s.stats.jobs;
      if(s.result && s.result.why==='custody') custody++; else if(s.result && s.result.why==='collectors') collectors++;
    }
    results.sort((a,b)=>a-b);
    const pct=p=>results[Math.min(results.length-1,Math.floor(p*results.length))];
    const pad=(x,n)=>String(x).padEnd(n);
    console.log(pad(TIERS[t].name,9)+' '+pad(E0.fmt(pct(0.10)),12)+' '+pad(E0.fmt(pct(0.5)),12)+' '+pad(E0.fmt(pct(0.9)),12)+' '+pad((100*custody/SEEDS).toFixed(1)+'%',8)+' '+pad((100*collectors/SEEDS).toFixed(1)+'%',11)+' '+pad((jobs/SEEDS).toFixed(2),9)+' '+(laylows/SEEDS).toFixed(2));
  }
  console.log('');
}

console.log(passes+' passed, '+fails+' failed');
process.exit(fails?1:0);
