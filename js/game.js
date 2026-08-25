'use strict';
/* ==================================================================
   GAME — the whole engine, pure and headless. No DOM, no timers.
   G.state is a plain object: JSON.stringify(G.state) is the save.
   Every function that touches RNG reads RNG.state from state.rng first
   and stores it back after, so a resumed run is bit-identical.
   Actions return {ok, msg?, over?} and never throw on bad UI input.
   Phases: market → encounter (feds) | collectors → market, → over.
   ================================================================== */
const G={ state:null };
G.T=s=>TIERS[s.tier]||TIERS[1];

G.new=function(seedWord, days, tier){
  days = RULES.daysOptions.includes(days)? days : RULES.daysOptions[0];
  tier = (tier>=0&&tier<TIERS.length)? tier : 1;
  const T=TIERS[tier];
  const seed=hashSeed(String(seedWord)+'|'+tier);
  RNG.seed(seed);
  const s={
    v:2, seedWord:String(seedWord), seed, day:1, days, tier,
    loc:HOME, cash:T.cash, bank:0, debt:T.debt, principal:T.debt,
    health:RULES.startHealth, trunk:T.trunk, lawyers:0, lastFeds:-99,
    heat:10, dayVol:0, overdue:0, creditCut:false,
    inv:GOODS.map(()=>0), paid:GOODS.map(()=>0),
    prices:[], hist:[], event:null, encounter:null, phase:'market',
    rep:CONTACTS.map(()=>REP_START), jobs:[], board:{}, nextJob:1,
    story:{paid:false,supplier:false,bigone:false,bigoneDone:false}, supplierNext:1, supplierOffer:null,
    log:[], stats:{bought:0,sold:0,profit:0,escapes:0,bribes:0,cases:0,jobs:0,jobsFailed:0,laundered:0},
    rng:0, result:null,
  };
  G.state=s;
  G._prices(s); G._snap(s); G._board(s);
  s.event={kind:'quiet', text:'Day 1. '+fmt(s.debt)+' from PayLater at '+Math.round(T.rate*100)+'% a day, '+T.name+' rules. '+s.days+' days.'};
  s.rng=RNG.state;
  return s;
};
G.load=function(json){
  let s; try{ s= typeof json==='string'? JSON.parse(json): json; }catch(e){ return null; }
  if(!s || s.v!==2 || !Array.isArray(s.inv) || s.inv.length!==GOODS.length) return null;
  G.state=s; RNG.state=s.rng; return s;
};
G.save=function(){ return JSON.stringify(G.state); };

/* ---- helpers ---- */
G.used=s=>s.inv.reduce((a,b)=>a+b,0);
G.space=s=>s.trunk-G.used(s);
G._midPrice=i=>(GOODS[i].lo+GOODS[i].hi)/2;
G.stashValue=s=>s.inv.reduce((a,n,i)=>a+n*(s.prices[i]||G._midPrice(i)),0);
G.netWorth=s=>s.cash+s.bank-s.debt;
G.score=s=>Math.round(G.netWorth(s)*G.T(s).scoreMult);
G.maxLoan=s=>Math.max(RULES.loanFloor, Math.floor(RULES.maxLoanMult*Math.max(0,G.netWorth(s))*(s.creditCut?0.5:1)));
G.bribeCost=s=>Math.round(RULES.bribePerAgent*s.encounter.agents*(1+s.day/s.days)*G.T(s).cost*(G.hasPerk(s,0)?0.7:1));
G.canService=s=>s.loc===HOME && s.phase==='market';
G.rank=nw=>RANKS.find(r=>nw>=r[0])[1];
G.avgPaid=(s,i)=> s.inv[i]? s.paid[i]/s.inv[i] : 0;
G.hasPerk=(s,c)=>s.rep[c]>=REP_PERK;
G.contactHere=s=>s.loc;             // contact index === district index
G.fedsOdds=s=>{ const cool=Math.min(1,(s.day-s.lastFeds)/RULES.heatDays);
  return G.used(s)>0? Math.min(0.95,(RULES.fedsBase + (s.heat/100)*G.T(s).fedsMax)*cool) : 0; };
G.isOverdue=s=>s.debt>s.principal*RULES.overdueMult;
function logLine(s,text){ s.log.push({day:s.day, text}); if(s.log.length>80) s.log.shift(); }
function fill(tpl,vars){ return tpl.replace(/\{(\w+)\}/g,(m,k)=> k in vars? vars[k]: m); }
function addHeat(s,n){ s.heat=clamp(Math.round((s.heat+n)*10)/10,0,100); }

/* ---- prices: log-uniform in band, widened by tier volatility, × district bias ---- */
G._prices=function(s){
  const d=DISTRICTS[s.loc]; const vol=G.T(s).vol;
  const n=RNG.int(RULES.availMax-RULES.availMin+1)+RULES.availMin;
  const idx=GOODS.map((_,i)=>i);
  for(let i=idx.length-1;i>0;i--){ const j=RNG.int(i+1); const t=idx[i]; idx[i]=idx[j]; idx[j]=t; }
  const off=new Set(idx.slice(n));
  s.prices=GOODS.map((g,i)=>{
    if(off.has(i)) return 0;
    const u=0.5+(RNG.next()-0.5)*vol;
    let p=Math.exp(Math.log(g.lo)+u*(Math.log(g.hi)-Math.log(g.lo)));
    if(d.cheap===g.k) p*=CHEAP_MULT;
    if(d.dear===g.k)  p*=DEAR_MULT;
    if(s.loc===3 && G.hasPerk(s,3)) p*=0.9;   // Kev's perk: campus buys cheaper
    return Math.max(1,Math.round(p));
  });
};
G._snap=function(s){ s.hist.push({day:s.day,loc:s.loc,prices:s.prices.slice()}); if(s.hist.length>90) s.hist.shift(); };

/* ---- market ---- */
G.buy=function(i,n){
  const s=G.state; if(s.phase!=='market') return {ok:false,msg:'Not now.'};
  n=Math.floor(n); if(!(n>0)) return {ok:false,msg:'How many?'};
  const p=s.prices[i]; if(!p) return {ok:false,msg:'Nobody is selling '+GOODS[i].name+' here today.'};
  if(n>G.space(s)) return {ok:false,msg:'Trunk is full. Room for '+G.space(s)+' more.'};
  if(n*p>s.cash) return {ok:false,msg:'You can afford '+Math.floor(s.cash/p)+'.'};
  s.cash-=n*p; s.inv[i]+=n; s.paid[i]+=n*p; s.stats.bought+=n;
  s.dayVol+=n*p*GOODS[i].heat*RULES.heatBuyFrac;
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
  const spike=s.event&&s.event.kind==='spike'&&s.event.good===i;
  s.dayVol+=n*p*GOODS[i].heat*(spike?RULES.heatSpikeMult:1);
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
  s.cash-=n; s.debt-=n; logLine(s,'Paid PayLater '+fmt(n));
  if(s.debt<=0){ s.debt=0; s.principal=0; s.overdue=0; G._milestone(s,'paid'); }
  else s.principal=Math.min(s.principal,s.debt);
  return {ok:true}; };
G.borrow=function(n){ const s=G.state; n=Math.floor(n);
  if(!G.canService(s)) return {ok:false,msg:'PayLater only lends Downtown.'};
  const room=G.maxLoan(s)-s.debt;
  if(!(n>0)||n>room) return {ok:false,msg:room>0?'PayLater will extend '+fmt(room)+' more.':'PayLater has cut you off.'};
  s.cash+=n; s.debt+=n; s.principal=s.debt; logLine(s,'Borrowed '+fmt(n)); return {ok:true}; };
G.heal=function(){ const s=G.state;
  if(!G.canService(s)) return {ok:false,msg:'The clinic is Downtown.'};
  const need=RULES.startHealth-s.health; if(need<=0) return {ok:false,msg:'You feel fine.'};
  const per=Math.round(RULES.clinicPerHp*G.T(s).cost);
  const afford=Math.min(need,Math.floor(s.cash/per));
  if(afford<=0) return {ok:false,msg:'The clinic wants '+fmt(need*per)+' for a full patch-up.'};
  s.cash-=afford*per; s.health+=afford;
  logLine(s,'Clinic: +'+afford+' health for '+fmt(afford*per)); return {ok:true}; };

/* ---- district specials ---- */
G.launder=function(n){ const s=G.state; n=Math.floor(n);
  if(s.phase!=='market'||s.loc!==4) return {ok:false,msg:'Tanya works the Outlet Mall.'};
  if(!(n>0)||n>s.cash) return {ok:false,msg:'You have '+fmt(s.cash)+' on hand.'};
  const fee=G.hasPerk(s,4)?RULES.launderFeePerk:RULES.launderFee;
  const net=Math.floor(n*(1-fee)); s.cash-=n; s.bank+=net; s.stats.laundered+=n; addHeat(s,-RULES.heatLaunder);
  logLine(s,'Laundered '+fmt(n)+' → '+fmt(net)+' banked'); return {ok:true}; };
G.launderFee=s=>G.hasPerk(s,4)?RULES.launderFeePerk:RULES.launderFee;
G.supplierBuy=function(){ const s=G.state; const o=s.supplierOffer;
  if(s.phase!=='market'||s.loc!==1||!s.story.supplier) return {ok:false,msg:'Vic is at the Port.'};
  if(!o||o.day!==s.day) return {ok:false,msg:'Nothing on offer today.'};
  if(s.day<s.supplierNext) return {ok:false,msg:'Vic: "Not till day '+s.supplierNext+'."'};
  const cost=o.qty*o.price;
  if(cost>s.cash) return {ok:false,msg:'You need '+fmt(cost)+'.'};
  if(o.qty>G.space(s)) return {ok:false,msg:'Trunk is full. Room for '+G.space(s)+'.'};
  s.cash-=cost; s.inv[o.good]+=o.qty; s.paid[o.good]+=cost; s.supplierNext=s.day+RULES.supplierEvery; s.supplierOffer=null;
  logLine(s,'Supplier: '+o.qty+' '+GOODS[o.good].name+' @ '+fmt(o.price)); return {ok:true}; };

/* ---- offers raised by events (van / lawyer) ---- */
G.acceptOffer=function(){ const s=G.state; const e=s.event;
  if(!e||!e.offer||e.taken) return {ok:false,msg:'No offer on the table.'};
  if(s.cash<e.price) return {ok:false,msg:'You cannot afford it.'};
  s.cash-=e.price; e.taken=true;
  if(e.kind==='van'){ s.trunk+=RULES.vanBonus; logLine(s,'Bought a van. Trunk is now '+s.trunk); }
  else { s.lawyers+=1; logLine(s,'Lawyer on retainer ('+s.lawyers+')'); }
  return {ok:true}; };

/* ---- jobs ---- */
G._board=function(s){
  // fresh offers for the district you just arrived in (deterministic)
  const c=s.loc; const tpls=JOBS[CONTACTS[c].k]; if(!tpls) return;
  if(s.rep[c]<REP_MIN_JOB){ s.board[c]=[]; return; }
  const out=[]; const n=1+RNG.int(RULES.boardSize);
  for(let k=0;k<n;k++){ const j=G._rollJob(s,c,RNG.pick(tpls)); if(j) out.push(j); }
  s.board[c]=out;
};
G._rollJob=function(s,c,t){
  const T=G.T(s); const j={id:0,type:t.type,contact:c,title:t.title,rep:t.rep};
  const due=s.day+t.days[0]+RNG.int(t.days[1]-t.days[0]+1); j.due=due;
  const trunkFrac=f=>Math.max(1,Math.round(s.trunk*(f[0]+RNG.next()*(f[1]-f[0]))));
  if(t.type==='rush'){
    let goods=t.goods.map(k=>GOODS.findIndex(g=>g.k===k));
    j.good=RNG.pick(goods); const g=GOODS[j.good];
    j.qty= t.qty? t.qty[0]+RNG.int(t.qty[1]-t.qty[0]+1) : trunkFrac(t.qtyFrac);
    if(c===5&&G.hasPerk(s,5)) j.qty=Math.round(j.qty*1.5);
    const mult=t.mult[0]+RNG.next()*(t.mult[1]-t.mult[0]);
    j.price=Math.round(G._midPrice(j.good)*mult*(c===5&&G.hasPerk(s,5)?1.2:1));
    if(t.heat) j.heat=t.heat[0]+RNG.int(t.heat[1]-t.heat[0]+1);
    j.text=fill(t.text,{qty:j.qty,unitPl:g.unit+'s',good:g.name,due,price:fmt(j.price),heat:j.heat});
  } else if(t.type==='import'){
    j.good=RNG.int(GOODS.length); const g=GOODS[j.good];
    j.qty=Math.max(1,trunkFrac(t.qtyFrac)); j.price=Math.round(g.lo*(G.hasPerk(s,1)?0.4:t.wholesale));
    j.cost=j.qty*j.price; j.at=1;
    j.text=fill(t.text,{qty:j.qty,unitPl:g.unit+'s',good:g.name,due})+' '+fmt(j.cost)+' now.';
  } else if(t.type==='cook'){
    j.good=GOODS.findIndex(g=>g.k==='ket'); j.qty=t.qty[0]+RNG.int(t.qty[1]-t.qty[0]+1);
    j.yield=t.yield[0]+RNG.next()*(t.yield[1]-t.yield[0]); if(G.hasPerk(s,2)) j.yield+=0.2;
    j.badP=G.hasPerk(s,2)?0:t.badP; j.at=2; j.out=Math.round(j.qty*j.yield);
    j.text=fill(t.text,{qty:j.qty,due,yieldTxt:j.out+' back'});
  } else if(t.type==='case'){
    j.heat=t.heat[0]+RNG.int(t.heat[1]-t.heat[0]+1); j.retainers=t.retainers; j.start=s.day;
    j.text=fill(t.text,{heat:j.heat,days:due-s.day});
  }
  return j;
};
G.accept=function(boardIdx){
  const s=G.state; if(s.phase!=='market') return {ok:false,msg:'Not now.'};
  const b=s.board[s.loc]||[]; const j=b[boardIdx]; if(!j) return {ok:false,msg:'No such job.'};
  if(s.jobs.length>=RULES.maxJobs) return {ok:false,msg:'You can only hold '+RULES.maxJobs+' jobs.'};
  if(j.type==='import'){ if(s.cash<j.cost) return {ok:false,msg:'Vic wants '+fmt(j.cost)+' up front.'}; s.cash-=j.cost; }
  if(j.type==='cook'){ if(s.inv[j.good]<j.qty) return {ok:false,msg:'You need '+j.qty+' bottles of ketamine on you.'}; G._take(s,j.good,j.qty); }
  if(j.type==='case'&&s.heat>=j.heat) return {ok:false,msg:'Lorna: "You are already over '+j.heat+'. Cool off first."'};
  j.id=s.nextJob++; j.accepted=s.day; s.jobs.push(j); b.splice(boardIdx,1);
  logLine(s,'Job: '+j.title+' for '+CONTACTS[j.contact].name+' (day '+j.due+')'); return {ok:true};
};
G._take=function(s,i,n){ const basis=G.avgPaid(s,i)*n; s.inv[i]-=n; s.paid[i]=s.inv[i]?s.paid[i]-basis:0; };
G.deliver=function(jobId){
  const s=G.state; if(s.phase!=='market') return {ok:false,msg:'Not now.'};
  const k=s.jobs.findIndex(j=>j.id===jobId); if(k<0) return {ok:false,msg:'No such job.'}; const j=s.jobs[k];
  if(j.type!=='rush') return {ok:false,msg:'That one resolves on its own.'};
  if(s.loc!==j.contact) return {ok:false,msg:CONTACTS[j.contact].name+' is at '+DISTRICTS[j.contact].name+'.'};
  if(s.inv[j.good]<j.qty) return {ok:false,msg:'You need '+j.qty+' '+GOODS[j.good].name+'; you have '+s.inv[j.good]+'.'};
  if(j.heat!=null&&s.heat>=j.heat) return {ok:false,msg:'Hale: "Not like this." Your heat is '+Math.round(s.heat)+'; he wants under '+j.heat+'.'};
  const basis=G.avgPaid(s,j.good)*j.qty; G._take(s,j.good,j.qty); const pay=j.qty*j.price;
  s.cash+=pay; s.stats.profit+=pay-basis; s.stats.sold+=j.qty; s.dayVol+=pay*GOODS[j.good].heat;
  G._jobDone(s,k,fill(EVENTS.jobDone[0],{name:CONTACTS[j.contact].name,money:fmt(pay)}));
  return {ok:true};
};
G._jobDone=function(s,k,text){ const j=s.jobs[k]; s.jobs.splice(k,1); s.rep[j.contact]=clamp(s.rep[j.contact]+j.rep,0,100); s.stats.jobs++;
  logLine(s,'Done: '+j.title+' (+'+j.rep+' rep)'); s.event={kind:'job',text}; if(j.story==='bigone'){ s.story.bigoneDone=true; } };
G._jobFail=function(s,k,text){ const j=s.jobs[k]; s.jobs.splice(k,1); s.rep[j.contact]=clamp(s.rep[j.contact]-j.rep-5,0,100); s.stats.jobsFailed++;
  logLine(s,'Failed: '+j.title+' (-'+(j.rep+5)+' rep)'); s.event={kind:'jobfail',text}; };
/* resolve time-based jobs on arrival; returns true if it wrote the day's event */
G._jobsTick=function(s){
  let wrote=false;
  for(let k=s.jobs.length-1;k>=0;k--){ const j=s.jobs[k];
    if(j.type==='import'){
      if(s.loc===j.at&&s.day===j.due){ const n=Math.min(j.qty,G.space(s)); s.inv[j.good]+=n; s.paid[j.good]+=n*j.price;
        G._jobDone(s,k,fill(EVENTS.importIn[0],{qty:n,unitPl:GOODS[j.good].unit+'s',good:GOODS[j.good].name})+(n<j.qty?' ('+(j.qty-n)+' would not fit.)':'')); wrote=true; }
      else if(s.day>j.due){ G._jobFail(s,k,EVENTS.importLost[0]); wrote=true; }
    } else if(j.type==='cook'){
      if(s.loc===j.at&&s.day>=j.due){ const bad=RNG.chance(j.badP); const n=Math.min(bad?Math.round(j.qty*0.6):j.out, G.space(s));
        s.inv[j.good]+=n; if(bad) addHeat(s,RULES.heatBadBatch);
        if(bad){ G._jobFail(s,k,fill(EVENTS.cookBad[0],{qty:n})); } else G._jobDone(s,k,fill(EVENTS.cookGood[0],{qty:n})); wrote=true; }
      else if(s.day>j.due+4){ G._jobFail(s,k,'Dee: "You never came back for it." She sold it.'); wrote=true; }
    } else if(j.type==='case'){
      if(s.heat>=j.heat){ G._jobFail(s,k,'Lorna: "I said under '+j.heat+'." She drops the case.'); wrote=true; }
      else if(s.day>=j.due){ s.lawyers+=j.retainers; G._jobDone(s,k,'Lorna: "Clean. Retainer is on file." (+'+j.retainers+' lawyer)'); wrote=true; }
    } else if(j.type==='rush'){
      if(s.day>j.due){ G._jobFail(s,k,fill(EVENTS.jobFail[0],{name:CONTACTS[j.contact].name})); wrote=true; }
    }
  }
  return wrote;
};
G._milestone=function(s,k){
  if(k==='paid'&&!s.story.paid){ s.story.paid=true; s.story.supplier=true; s.supplierNext=s.day; logLine(s,'PayLater paid off. Vic is asking about you.'); }
};
G._supplierRoll=function(s){
  if(s.loc!==1||!s.story.supplier||s.day<s.supplierNext){ s.supplierOffer=null; return; }
  const good=RNG.int(GOODS.length); const qty=RULES.supplierQty[0]+RNG.int(RULES.supplierQty[1]-RULES.supplierQty[0]+1);
  s.supplierOffer={day:s.day,good,qty,price:Math.round(GOODS[good].lo*RULES.supplierMult)};
};
G._storyRoll=function(s){
  // The Big One: once the supplier is yours and the run is half over, Hale calls
  if(s.story.supplier&&!s.story.bigone&&s.day>=Math.floor(s.days*0.5)&&s.loc===5){
    s.story.bigone=true; const coke=GOODS.findIndex(g=>g.k==='coke'), her=GOODS.findIndex(g=>g.k==='her');
    const qty=2+RNG.int(3), qty2=3+RNG.int(3); const due=s.days-1;
    const j={id:0,type:'rush',contact:5,title:'The Big One',rep:30,story:'bigone',good:coke,qty,due,heat:40,
      price:Math.round(GOODS[coke].hi*3.5), extraGood:her, extraQty:qty2};
    const price=fmt(j.qty*j.price+j.extraQty*Math.round(GOODS[her].hi*3.5));
    j.text=fill(STORY[2].text,{qty,qty2,due,price});
    (s.board[5]=s.board[5]||[]).unshift(j);
  }
};

/* ---- travel & lay low: the day turns over ---- */
G._newDay=function(s){
  const T=G.T(s);
  s.day+=1; s.event=null; s.encounter=null;
  s.debt=Math.round(s.debt*(1+T.rate));
  s.bank=Math.round(s.bank*(1+RULES.bankRate));
  s.overdue= G.isOverdue(s)? s.overdue+1 : 0;
  // the day's trading volume becomes heat on a log curve: doubling the
  // money moved adds a fixed amount, so a $5K day and a $500K day both matter
  addHeat(s, RULES.heatVolBase*Math.log2(1+s.dayVol/RULES.heatVolUnit) - RULES.heatDecay);
  s.dayVol=0;
};
G.travel=function(dest){
  const s=G.state; if(s.phase!=='market') return {ok:false,msg:'Not now.'};
  if(dest===s.loc) return {ok:false,msg:'You are already here.'};
  if(dest<0||dest>=DISTRICTS.length) return {ok:false,msg:'No such place.'};
  RNG.state=s.rng;
  G._newDay(s); s.loc=dest;
  // carrying weight draws heat; a quiet drive sheds some
  const w=s.inv.reduce((a,n,i)=>a+n*GOODS[i].heat,0)/s.trunk;
  addHeat(s, w*RULES.heatCarry);
  if(s.day>s.days){ s.rng=RNG.state; return G._end('time'); }
  G._prices(s);
  G._arrive(s);
  G._snap(s); G._board(s); G._supplierRoll(s); G._storyRoll(s);
  s.rng=RNG.state;
  return {ok:true};
};
G.layLow=function(){
  const s=G.state; if(s.phase!=='market') return {ok:false,msg:'Not now.'};
  RNG.state=s.rng;
  G._newDay(s); addHeat(s,-RULES.heatLayLow);
  if(s.day>s.days){ s.rng=RNG.state; return G._end('time'); }
  G._prices(s);
  const jobWrote=G._jobsTick(s);
  if(!G._collectors(s) && !jobWrote) s.event={kind:'laylow',text:RNG.pick(EVENTS.laylow)};
  G._snap(s); G._board(s); G._supplierRoll(s);
  s.rng=RNG.state; return {ok:true};
};
G._collectors=function(s){
  if(s.overdue>=RULES.overdueDays && RNG.chance(RULES.collectorsChance)){
    const n=2+RNG.int(2); s.encounter={kind:'collectors',agents:n};
    s.phase='collectors'; s.event={kind:'collectors',text:fill(RNG.pick(EVENTS.collectors),{n})};
    if(G.T(s).cutCredit) s.creditCut=true;
    return true; }
  return false;
};
G._arrive=function(s){
  // 0. job resolutions first (imports land, cooks finish, deadlines pass)
  const jobWrote=G._jobsTick(s);
  // 1. collectors beat the feds to you
  if(G._collectors(s)) return;
  // 2. the Task Force — odds from heat
  if(RNG.chance(G.fedsOdds(s))){
    s.lastFeds=s.day;
    const agents=1+RNG.int(Math.min(6, 2+Math.floor(4*s.heat/100)+Math.floor(2*s.day/s.days)));
    s.encounter={kind:'feds',agents, start:agents, rounds:0};
    s.phase='encounter';
    s.event={kind:'feds', text:fill(RNG.pick(EVENTS.feds),{n:agents})};
    return;
  }
  // 3. price event
  if(RNG.chance(RULES.priceEventRate)){
    const vol=G.T(s).vol;
    const avail=GOODS.map((_,i)=>i).filter(i=>s.prices[i]>0);
    const i=RNG.pick(avail); const g=GOODS[i];
    if(RNG.chance(0.5)){ s.prices[i]=Math.round(g.hi*RNG.range(RULES.spikeMult[0],RULES.spikeMult[1])*vol); if(!jobWrote) s.event={kind:'spike',good:i,text:g.spike}; else s.event.good=i; }
    else { s.prices[i]=Math.max(1,Math.round(g.lo/(RNG.range(RULES.crashDiv[0],RULES.crashDiv[1])*vol))); if(!jobWrote) s.event={kind:'crash',good:i,text:g.crash}; else s.event.good=i; }
    return;
  }
  if(jobWrote) return;
  // 4. a non-price event
  if(RNG.chance(RULES.eventRate)){
    const roll=RNG.next(); const T=G.T(s);
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
      const price=Math.round(RNG.range(RULES.vanPrice[0],RULES.vanPrice[1])*T.cost/50)*50;
      s.event={kind:'van',offer:true,price,text:fill(EVENTS.van[0],{money:fmt(price),n:RULES.vanBonus})};
    } else {
      const price=Math.round(RNG.range(RULES.lawyerPrice[0],RULES.lawyerPrice[1])*T.cost/50)*50;
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
  RNG.state=s.rng; const e=s.encounter; e.rounds++; s.lawyers--; addHeat(s,-RULES.heatLawyer);
  const drop=1+RNG.int(2); e.agents-=drop;
  let out;
  if(e.agents<=0){ s.stats.cases++; out=G._clear(s,RNG.pick(EVENTS.win)); }
  else { s.event={kind:'feds',text:'Your lawyer peels off '+drop+' agent'+(drop>1?'s':'')+'. '+e.agents+' still on you.'}; out={ok:true}; }
  s.rng=RNG.state; return out;
};
G.bribe=function(){
  const s=G.state; if(s.phase!=='encounter') return {ok:false,msg:'Nobody is chasing you.'};
  const cost=G.bribeCost(s); if(s.cash<cost) return {ok:false,msg:'They want '+fmt(cost)+'. You have '+fmt(s.cash)+'.'};
  s.cash-=cost; s.stats.bribes++; addHeat(s,RULES.heatBribe);
  return G._clear(s,fill(EVENTS.bribe[0],{money:fmt(cost)}));
};
G._clear=function(s,text){ s.encounter=null; s.phase='market'; s.event={kind:'clear',text}; logLine(s,'Shook the Task Force'); return {ok:true}; };

/* ---- PayLater's collectors ---- */
G.collectorsPay=s=>Math.min(G.state.cash, Math.ceil(G.state.debt*RULES.collectorsPayFrac));
G.colPay=function(){
  const s=G.state; if(s.phase!=='collectors') return {ok:false,msg:'Nobody is collecting.'};
  const want=Math.ceil(s.debt*RULES.collectorsPayFrac), min=Math.ceil(s.debt*RULES.collectorsMinFrac);
  if(s.cash<min) return {ok:false,msg:'They want at least '+fmt(min)+'. You have '+fmt(s.cash)+'.'};
  const pay=Math.min(s.cash,want); s.cash-=pay; s.debt-=pay; s.principal=s.debt; s.overdue=0;
  s.encounter=null; s.phase='market'; s.event={kind:'clear',text:fill(EVENTS.colPay[0],{money:fmt(pay)})};
  logLine(s,'Collectors took '+fmt(pay)); return {ok:true};
};
G.colBeat=function(){
  const s=G.state; if(s.phase!=='collectors') return {ok:false,msg:'Nobody is collecting.'};
  RNG.state=s.rng;
  const dmg=RULES.collectorsHit[0]+RNG.int(RULES.collectorsHit[1]-RULES.collectorsHit[0]+1); s.health-=dmg;
  GOODS.forEach((g,i)=>{ const take=Math.floor(s.inv[i]*RULES.collectorsSeize); if(take) G._take(s,i,take); });
  s.overdue=0; s.principal=s.debt;
  s.encounter=null; s.phase='market'; s.event={kind:'hit',text:EVENTS.colBeat[0]+' (-'+dmg+' health)'};
  logLine(s,'Collectors: beaten, stash skimmed');
  s.rng=RNG.state;
  if(s.health<=0) return G._end('collectors');
  return {ok:true};
};
G.colVan=function(){
  const s=G.state; if(s.phase!=='collectors') return {ok:false,msg:'Nobody is collecting.'};
  const base=G.T(s).trunk; if(s.trunk<=base) return {ok:false,msg:'You have no van to give.'};
  s.trunk=base; let over=G.used(s)-s.trunk;
  for(let i=GOODS.length-1;i>=0&&over>0;i--){ const take=Math.min(over,s.inv[i]); if(take){ G._take(s,i,take); over-=take; } }
  s.overdue=0; s.principal=s.debt;
  s.encounter=null; s.phase='market'; s.event={kind:'clear',text:EVENTS.colVan[0]};
  logLine(s,'Collectors took the van'); return {ok:true};
};

/* ---- endings ---- */
G._custody=function(){
  const s=G.state;
  s.cash=0; s.inv=GOODS.map(()=>0); s.paid=GOODS.map(()=>0);
  return G._end('custody');
};
G._end=function(why){
  const s=G.state; s.phase='over'; s.encounter=null;
  const nw=G.netWorth(s);
  s.result={why, netWorth:nw, score:G.score(s), rank:G.rank(nw), day:Math.min(s.day,s.days), tier:s.tier};
  s.event={kind:'over',text: why==='custody'? EVENTS.custody[0] : why==='collectors'? 'PayLater collected in full. You are found in a parking lot.' : 'Day '+s.days+' is over. PayLater wants its money. Time to count.'};
  return {ok:true, over:true};
};

/* what tonight's heat change will be, given today's trades so far (for the UI) */
G.heatForecast=s=>Math.round(RULES.heatVolBase*Math.log2(1+s.dayVol/RULES.heatVolUnit) - RULES.heatDecay + s.inv.reduce((a,n,i)=>a+n*GOODS[i].heat,0)/s.trunk*RULES.heatCarry);
