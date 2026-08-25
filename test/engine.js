/* Drugwars 2026 engine suite. `node test/engine.js` — exits non-zero on failure.
   Covers determinism, save/resume ≡ straight-through, price invariants,
   buy/sell/service refusals, trunk/loan/bank arithmetic, the encounter
   state machine, endings, ranks, fmt. Ends with a Monte Carlo balance
   report that PRINTS (never asserts) so a human can judge tuning. */
'use strict';
const { load } = require('./shim');
let fails = 0, passes = 0;
function ok(cond, name, extra){
  if(cond){ passes++; console.log('PASS '+name); }
  else { fails++; console.log('FAIL '+name+(extra!==undefined?' — '+extra:'')); }
}
const eq = (a,b)=> JSON.stringify(a)===JSON.stringify(b);
const fresh = ()=> load({engineOnly:true});

/* Tiny independent PRNG for bot decisions (never the engine's RNG). */
function botRng(seed){ let s=seed|0; return ()=>{ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }

/* A deterministic scripted step: decisions depend ONLY on the state, so the
   same seed always yields the same action sequence. Exercises every
   RNG-touching action (travel, run, lawyerUp) plus bribes and offers. */
function scriptedStep(E){
  const { G, DISTRICTS } = E; const s = G.state;
  if(s.phase==='over') return false;
  if(s.phase==='encounter'){
    if(s.lawyers>0 && s.day%3===0) return G.lawyerUp().ok;
    if(s.day%2===0 && s.cash>=G.bribeCost(s)) return G.bribe().ok;
    return G.run().ok;
  }
  // market: sell everything sellable, buy the cheapest-vs-mid good, accept an offer if rich
  for(let i=0;i<s.inv.length;i++) if(s.inv[i]>0 && s.prices[i]>0) G.sell(i, s.inv[i]);
  if(s.event && s.event.offer && !s.event.taken && s.cash > s.event.price*2) G.acceptOffer();
  let best=-1, bestR=0;
  for(let i=0;i<s.prices.length;i++){ if(!s.prices[i]) continue; const r=G._midPrice(i)/s.prices[i]; if(r>bestR){ bestR=r; best=i; } }
  if(best>=0){ const n=G.maxBuy(s,best); if(n>0) G.buy(best,n); }
  if(s.loc===E.HOME){ if(s.cash>1000 && s.debt>0) G.payDebt(Math.floor(s.cash/4)); }
  const dest = (s.loc + 1 + (s.day % (DISTRICTS.length-1))) % DISTRICTS.length;
  const r = G.travel(dest===s.loc? (dest+1)%DISTRICTS.length : dest);
  return r.ok;
}
function runScript(E, seedWord, days, steps){
  E.G.new(seedWord, days);
  for(let i=0;i<steps;i++) if(!scriptedStep(E)) break;
  return E.G.state;
}

/* ---------------- determinism ---------------- */
{
  let allSame=true;
  for(const w of ['EGG-FLIP-101','GPU-MOON-777','TAX-CRASH-404']){
    const a = runScript(fresh(), w, 30, 200), b = runScript(fresh(), w, 30, 200);
    if(!eq(a,b)) allSame=false;
  }
  ok(allSame, 'determinism: same seed word + same script → JSON-identical state (3 seeds)');
  const a = runScript(fresh(),'EGG-FLIP-101',30,60), b = runScript(fresh(),'EGG-FLIP-102',30,60);
  ok(!eq(a.prices,b.prices) || a.day!==b.day, 'determinism: different seed words diverge');
}

/* ---------------- save/resume ≡ straight-through ---------------- */
{
  let checked=0, encounterSaves=0, allEq=true, firstBad=null;
  for(let n=0;n<40;n++){
    const w='SAVE-'+n;
    for(const cut of [3, 11, 27]){
      const A = fresh(); A.G.new(w, 45);
      for(let i=0;i<cut;i++) scriptedStep(A);
      if(A.G.state.phase==='over') continue;
      if(A.G.state.phase==='encounter') encounterSaves++;
      const json = A.G.save();
      const B = fresh(); const loaded = B.G.load(json);
      if(!loaded){ allEq=false; firstBad=w+'@'+cut+' load returned null'; continue; }
      if(B.RNG.state!==A.RNG.state){ allEq=false; firstBad=w+'@'+cut+' RNG.state not restored'; }
      for(let i=0;i<60;i++){ const ra=scriptedStep(A), rb=scriptedStep(B); if(ra!==rb){ allEq=false; firstBad=firstBad||(w+'@'+cut+' step '+i+' diverged'); break; } }
      checked++;
      if(!eq(A.G.state,B.G.state)){ allEq=false; firstBad=firstBad||(w+'@'+cut+' final state differs'); }
    }
  }
  ok(allEq && checked>50, 'save/resume ≡ straight-through ('+checked+' cut points, '+encounterSaves+' mid-encounter)', firstBad);
  const E=fresh();
  ok(E.G.load('{not json')===null && E.G.load({v:2})===null && E.G.load({v:1,inv:[1]})===null, 'G.load rejects garbage / wrong version / wrong inv length');
  E.G.new('X',30); const before=E.G.save();
  const s=E.G.state; const rngStored=s.rng;
  E.G.travel(1); ok(E.G.state.rng!==rngStored && E.G.state.rng===E.RNG.state, 'travel writes RNG.state back into state.rng');
  ok(before===JSON.stringify(JSON.parse(before)), 'G.save() is plain JSON of the state');
}

/* ---------------- price invariants ---------------- */
{
  const E=fresh(); const {G,GOODS,RULES,DISTRICTS}=E;
  let bad=null, days=0, spikes=0, crashes=0, biased=0;
  const CHEAP=E.probe('CHEAP_MULT'), DEAR=E.probe('DEAR_MULT');
  for(let n=0;n<150 && !bad;n++){
    G.new('PRICE-'+n, 30);
    while(G.state.phase!=='over' && !bad){
      const s=G.state; if(s.phase==='encounter'){ let g=0; while(s.phase==='encounter' && g++<50) G.run(); continue; } days++;
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
        if(ev.kind==='spike' && ev.good===i){ spikes++; if(p<=g.hi*DEAR) bad='spike not above hi*DEAR: '+p+' '+g.k; return; }
        if(ev.kind==='crash' && ev.good===i){ crashes++; if(p>=g.lo*CHEAP) bad='crash not below lo*CHEAP: '+p+' '+g.k; return; }
        if(p<Math.floor(lo)-1||p>Math.ceil(hi)+1) bad='out of band '+g.k+'='+p+' band '+lo+'..'+hi+' seed '+n+' day '+s.day+' loc '+s.loc;
      });
      // a 'find' hands us stock → encounters become possible; run them out
      if(s.phase==='encounter'){ let g=0; while(s.phase==='encounter' && g++<50) G.run(); continue; }
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
  // cheapest good to test trunk limit
  const cheap = s.prices.reduce((b,p,i)=> p>0 && (b<0||p<s.prices[b]) ? i : b, -1);
  ok(!G.buy(cheap, s.trunk+1).ok, 'buy refuses n > trunk space');
  const n=Math.min(G.maxBuy(s,cheap), 5); const r=G.buy(cheap,n);
  ok(r.ok && s.inv[cheap]===n && s.cash===cash0-n*s.prices[cheap] && s.paid[cheap]===n*s.prices[cheap], 'buy debits cash, credits inv and cost basis');
  ok(!G.sell(cheap,n+1).ok && s.inv[cheap]===n, 'sell refuses more than held');
  ok(!G.sell(cheap,0).ok, 'sell refuses n<=0');
  if(iOff>=0){ s.inv[iOff]=1; ok(!G.sell(iOff,1).ok, 'sell refuses when nobody is buying'); s.inv[iOff]=0; }
  const c1=s.cash; ok(G.sell(cheap,n).ok && s.cash===c1+n*s.prices[cheap] && s.inv[cheap]===0 && s.paid[cheap]===0, 'sell credits cash, clears basis when emptied');
  ok(G.maxBuy(s,cheap)===Math.min(G.space(s),Math.floor(s.cash/s.prices[cheap])), 'maxBuy = min(space, cash/price)');
  // fractional n floors
  G.buy(cheap, 2.9); ok(s.inv[cheap]===2, 'buy floors fractional n');
  // Fuzz: random buys/sells never leave negative cash / inv or an overfull trunk
  const rr=botRng(7); let neg=false;
  for(let k=0;k<3000;k++){
    const i=(rr()*GOODS.length)|0, q=((rr()*300)|0)-50;
    if(rr()<0.5) G.buy(i,q); else G.sell(i,q);
    if(s.cash<0 || s.inv.some(v=>v<0) || G.used(s)>s.trunk){ neg=true; break; }
  }
  ok(!neg, 'fuzz: 3000 random buy/sell never leave negative cash/inv or overfull trunk');
  s.phase='encounter'; ok(!G.buy(iOn,1).ok && !G.sell(iOn,1).ok && !G.travel(1).ok, 'buy/sell/travel refused outside market phase');
}

/* ---------------- trunk incl. find event ---------------- */
{
  let finds=0, over=false, vans=0;
  for(let n=0;n<300 && finds<25;n++){
    const E=fresh(); const {G,DISTRICTS}=E; G.new('FIND-'+n,60); const s=G.state;
    // fill the trunk nearly full with the cheapest good so a find must clip
    const cheap = s.prices.reduce((b,p,i)=> p>0 && (b<0||p<s.prices[b]) ? i : b, -1);
    G.buy(cheap, Math.min(G.maxBuy(s,cheap), s.trunk-2));
    for(let d=0; d<59 && s.phase!=='over'; d++){
      G.travel((s.loc+1)%DISTRICTS.length);
      if(G.used(s)>s.trunk) over=true;
      if(s.event && s.event.kind==='find') finds++;
      if(s.event && s.event.kind==='van' && s.cash>=s.event.price){ const t=s.trunk; G.acceptOffer(); if(s.trunk===t+E.RULES.vanBonus) vans++; }
      if(s.phase==='encounter'){ while(s.phase==='encounter') G.run(); }
    }
  }
  ok(!over && finds>0, 'trunk never exceeded across '+finds+' find events (near-full trunk) and '+vans+' van purchases');
}

/* ---------------- loan / bank / travel ---------------- */
{
  const E=fresh(); const {G,RULES,DISTRICTS,HOME}=E; G.new('LOAN-1',30); const s=G.state;
  ok(!G.travel(s.loc).ok, 'travel to same district refused');
  ok(!G.travel(-1).ok && !G.travel(DISTRICTS.length).ok, 'travel out of range refused');
  ok(G.deposit(500).ok && s.bank===500 && s.cash===1500, 'deposit at HOME');
  let debt=s.debt, bank=s.bank, okAll=true, day=s.day;
  for(let k=0;k<10;k++){
    const r=G.travel((s.loc+1)%DISTRICTS.length); if(!r.ok||s.phase!=='market') break;
    debt=Math.round(debt*(1+RULES.loanRate)); bank=Math.round(bank*(1+RULES.bankRate)); day++;
    if(s.debt!==debt||s.bank!==bank||s.day!==day) okAll=false;
  }
  ok(okAll, 'loan compounds at loanRate and bank at bankRate per travel; day increments');
  // services off-Downtown refused
  if(s.loc!==HOME){
    ok(!G.deposit(1).ok && !G.withdraw(1).ok && !G.payDebt(1).ok && !G.borrow(1).ok && !G.heal().ok, 'all services refused when loc !== HOME');
  } else ok(true,'(landed at HOME — service refusal covered below)');
  // Build a state at HOME and test each service's arithmetic
  const F=fresh(); F.G.new('LOAN-2',30); const t=F.G.state; t.cash=10000; t.bank=0; t.debt=3000; t.health=50;
  ok(F.G.canService(t), 'canService true at HOME');
  ok(!F.G.withdraw(1).ok, 'withdraw refused with empty account');
  ok(F.G.deposit(4000).ok && !F.G.deposit(7000).ok && t.bank===4000, 'deposit refuses more than cash on hand');
  ok(F.G.withdraw(1000).ok && t.bank===3000 && t.cash===7000, 'withdraw arithmetic');
  ok(F.G.payDebt(99999).ok && t.debt===0 && t.cash===4000, 'payDebt clips to the debt owed');
  ok(!F.G.payDebt(1).ok, 'payDebt refused when nothing owed');
  const room=F.G.maxLoan(t)-t.debt;
  ok(F.G.maxLoan(t)===Math.max(1000,Math.floor(F.RULES.maxLoanMult*(t.cash+t.bank))), 'maxLoan = maxLoanMult × (cash+bank), floor 1000');
  ok(!F.G.borrow(room+1).ok && F.G.borrow(room).ok && t.debt===room, 'borrow honors the ceiling exactly');
  // NOTE (engine finding, not asserted): the ceiling is maxLoanMult×(cash+bank), and borrowing
  // raises cash, so the ceiling recedes — repeated max borrows compound without bound.
  { const before=t.debt; let spiral=0; while(spiral<5 && F.G.borrow(F.G.maxLoan(t)-t.debt).ok) spiral++;
    console.log('     note: after a max borrow, '+spiral+' more max borrows succeeded (debt '+F.fmt(before)+' -> '+F.fmt(t.debt)+') — maxLoan is not a hard cap'); }
  const cost=(100-50)*F.RULES.clinicPerHp; const c0=t.cash;
  ok(F.G.heal().ok && t.health===100 && t.cash===c0-cost, 'heal charges clinicPerHp per point');
  ok(!F.G.heal().ok, 'heal refused at full health');
  t.health=10; t.cash=F.RULES.clinicPerHp*3+5; ok(F.G.heal().ok && t.health===13 && t.cash===5, 'heal partial when cash is short');
  t.cash=0; t.health=10; ok(!F.G.heal().ok, 'heal refused with no cash');
  // day > days → over/time
  const T=fresh(); let u, last;
  for(let n=0;n<50;n++){ u=T.G.new('TIME-'+n,30); last=null;
    while(u.phase!=='over'){ if(u.phase==='encounter'){ if(!T.G.bribe().ok) T.G.run(); continue; } last=T.G.travel((u.loc+1)%T.DISTRICTS.length); }
    if(u.result.why==='time') break; }
  ok(last.over===true && u.result.why==='time' && u.result.day===30 && u.day===31 && u.event.kind==='over', 'day > days → phase over, result.why time');
  ok(!T.G.travel(1).ok && !T.G.buy(0,1).ok, 'actions refused after game over');
  ok(T.G.new('X',99).days===T.RULES.daysOptions[0] && T.G.new('X',60).days===60, 'G.new clamps days to daysOptions');
}

/* ---------------- encounter flow ---------------- */
{
  function forceEncounter(seedPrefix, days){
    for(let n=0;n<2000;n++){
      const E=fresh(); const {G,DISTRICTS}=E; G.new(seedPrefix+n, days); const s=G.state;
      const cheap = s.prices.reduce((b,p,i)=> p>0 && (b<0||p<s.prices[b]) ? i : b, -1);
      G.buy(cheap, G.maxBuy(s,cheap));
      for(let d=0; d<days-1; d++){ G.travel((s.loc+1)%DISTRICTS.length); if(s.phase==='encounter') return E; if(s.phase==='over') break; }
    }
    return null;
  }
  const E=forceEncounter('FEDS-',30);
  ok(!!E, 'an encounter can be forced by looping seeds');
  if(E){
    const {G,RULES}=E; const s=G.state; const e=s.encounter;
    ok(s.event.kind==='feds' && e.agents>=1 && e.agents===e.start && e.rounds===0, 'encounter state {agents,start,rounds} + feds event');
    ok(!G.travel((s.loc+1)%6).ok && !G.buy(0,1).ok, 'travel/buy refused during encounter');
    ok(!G.lawyerUp().ok && s.lawyers===0, 'lawyerUp refused with no retainer');
    const cost=G.bribeCost(s);
    ok(cost===Math.round(RULES.bribePerAgent*e.agents*(1+s.day/s.days)), 'bribeCost formula');
    const cash=s.cash; s.cash=cost-1;
    ok(!G.bribe().ok && s.cash===cost-1 && s.phase==='encounter', 'bribe refused when short, cash untouched');
    // bribe path on a copy
    const B=fresh(); B.G.load(G.save()); const b=B.G.state; b.cash=cost+10;
    ok(B.G.bribe().ok && b.cash===10 && b.phase==='market' && b.encounter===null && b.stats.bribes===1 && b.event.kind==='clear', 'bribe clears the encounter, debits exactly the cost');
    // lawyer path on a copy
    const L=fresh(); L.G.load(G.save()); const l=L.G.state; l.lawyers=5; const startAgents=l.encounter.agents; let rounds=0;
    while(l.phase==='encounter' && rounds<10){ const r=L.G.lawyerUp(); if(!r.ok) break; rounds++; }
    ok(l.phase==='market' && l.lawyers===5-rounds && l.stats.cases===1 && rounds>=Math.ceil(startAgents/2), 'lawyerUp peels 1-2 agents/round and wins when agents hit 0');
    // run path: health→0 → custody
    s.cash=cash; let R=null, r=null, out=null, tries=0;
    // the run roll depends on state.rng; nudge it until the first run fails so custody is exercised deterministically
    for(let k=0;k<200 && !r;k++){ const C=fresh(); C.G.load(G.save()); const c=C.G.state; c.health=1; c.cash=1234; c.bank=50; c.rng=(s.rng+k)|0; tries++;
      const o=C.G.run(); if(c.phase==='over'){ R=C; r=c; out=o; } }
    ok(!!r, 'a failing run was found within '+tries+' rng nudges');
    if(r){
      ok(r.phase==='over' && r.result.why==='custody' && r.cash===0 && r.inv.every(v=>v===0) && r.paid.every(v=>v===0) && out.over===true && r.result.netWorth===50-r.debt && r.event.kind==='over' && r.encounter===null, 'health→0 on a failed run → custody: cash 0, inventory seized, over:true, netWorth = bank - debt');
      ok(!R.G.run().ok && !R.G.bribe().ok && !R.G.lawyerUp().ok, 'run/bribe/lawyerUp refused when nobody is chasing');
    }
  }
  // sweep: many forced encounters, always run; check custody + escape bookkeeping + health never below 0 after end
  let custody=0, escapes=0, hits=0, badHealth=false, badHit=false;
  for(let n=0;n<400;n++){
    const E=fresh(); const {G,RULES,DISTRICTS}=E; G.new('SWEEP-'+n,30); const s=G.state;
    const cheap = s.prices.reduce((b,p,i)=> p>0 && (b<0||p<s.prices[b]) ? i : b, -1);
    G.buy(cheap, G.maxBuy(s,cheap));
    while(s.phase!=='over'){
      if(s.phase==='encounter'){
        const h=s.health, esc=s.stats.escapes; G.run();
        if(s.stats.escapes>esc) escapes++;
        else { hits++; const dmg=h-s.health; if(dmg<RULES.hitLo||dmg>RULES.hitHi) badHit=true; if(s.phase==='over' && s.result.why!=='custody') badHealth=true; if(s.phase!=='over' && s.health<=0) badHealth=true; }
        if(s.phase==='over' && s.result.why==='custody'){ custody++; if(s.cash!==0||G.used(s)!==0) badHealth=true; }
      } else G.travel((s.loc+1)%DISTRICTS.length);
    }
  }
  ok(custody>0 && escapes>0 && !badHealth && !badHit, 'encounter sweep: '+escapes+' escapes, '+hits+' hits in ['+'hitLo..hitHi], '+custody+' custody endings all with cash 0 / empty stash');
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

/* ---------------- Monte Carlo balance report (prints, never asserts) ---------------- */
{
  const SEEDS=200, DAYS=30;
  const results=[]; let custody=0, time=0, brokeOrWorse=0;
  for(let n=0;n<SEEDS;n++){
    const E=fresh(); const {G,DISTRICTS}=E; G.new('MC-'+n, DAYS); const s=G.state; const rr=botRng(1000+n);
    let guard=0;
    while(s.phase!=='over' && guard++<5000){
      if(s.phase==='encounter'){
        if(s.cash>=G.bribeCost(s)) G.bribe(); else G.run();
        continue;
      }
      for(let i=0;i<s.inv.length;i++) if(s.inv[i]>0 && s.prices[i]>0 && s.prices[i]>G.avgPaid(s,i)) G.sell(i,s.inv[i]);
      if(s.event && s.event.kind==='van' && !s.event.taken && s.cash>s.event.price*3) G.acceptOffer();
      let best=-1,bestR=0;
      for(let i=0;i<s.prices.length;i++){ if(!s.prices[i]) continue; const r=G._midPrice(i)/s.prices[i]; if(r>bestR){bestR=r;best=i;} }
      if(best>=0){ const n=G.maxBuy(s,best); if(n>0) G.buy(best,n); }
      if(s.loc===E.HOME && s.cash>s.debt && s.debt>0) G.payDebt(s.debt);
      let d=(rr()*DISTRICTS.length)|0; if(d===s.loc) d=(d+1)%DISTRICTS.length;
      G.travel(d);
    }
    const nw=s.result? s.result.netWorth : G.netWorth(s);
    results.push(nw);
    if(s.result && s.result.why==='custody') custody++; else time++;
    if(nw<=0) brokeOrWorse++;
  }
  results.sort((a,b)=>a-b);
  const pct=p=>results[Math.min(results.length-1,Math.floor(p*results.length))];
  const E=fresh();
  console.log('\n--- balance (greedy bot, '+SEEDS+' seeds, '+DAYS+' days; not asserted) ---');
  console.log('net worth  p10 '+E.fmt(pct(0.10))+'  p25 '+E.fmt(pct(0.25))+'  median '+E.fmt(pct(0.5))+'  p75 '+E.fmt(pct(0.75))+'  p90 '+E.fmt(pct(0.9))+'  max '+E.fmt(results[results.length-1]));
  console.log('endings    time '+time+'  custody '+custody+' ('+(100*custody/SEEDS).toFixed(1)+'%)   net worth <= 0: '+brokeOrWorse+' ('+(100*brokeOrWorse/SEEDS).toFixed(1)+'%)');
  const ranks={}; for(const nw of results){ const r=E.G.rank(nw); ranks[r]=(ranks[r]||0)+1; }
  console.log('ranks      '+Object.entries(ranks).map(([k,v])=>k+':'+v).join('  '));
  console.log('');
}

console.log(passes+' passed, '+fails+' failed');
process.exit(fails?1:0);
