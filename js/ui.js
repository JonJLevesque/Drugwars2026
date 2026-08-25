'use strict';
/* ==================================================================
   UI — everything the player sees and touches. Reads G.state, calls
   G.* actions, re-renders. Owns localStorage (save, settings, hi) and
   the cosmetic animation clock. No gameplay decisions live here.
   ================================================================== */
const UI={ sel:0, modal:null, settings:{vol:70,calm:false}, hi:[], hover:-1, drive:null, anim:0, scene:null, tier:1, hiTab:1 };
const LS={ save:'drugwars26.save', set:'drugwars26.settings', hi:'drugwars26.hi' };
let lastPrices=null; // for ▲▼ arrows vs the previous stop

/* ---------------- persistence ---------------- */
function persist(){ try{ if(G.state&&G.state.phase!=='over') localStorage.setItem(LS.save,G.save()); else localStorage.removeItem(LS.save); }catch(e){} }
function loadSettings(){ try{ Object.assign(UI.settings,JSON.parse(localStorage.getItem(LS.set)||'{}')); UI.hi=JSON.parse(localStorage.getItem(LS.hi)||'[]').filter(h=>h.tier!=null); if(UI.settings.tier!=null){ UI.tier=UI.hiTab=UI.settings.tier; } }catch(e){} }
function saveSettings(){ try{ localStorage.setItem(LS.set,JSON.stringify(UI.settings)); localStorage.setItem(LS.hi,JSON.stringify(UI.hi)); }catch(e){} }
function recordHi(r,s){
  UI.hi.push({nw:r.netWorth,score:r.score,tier:s.tier,rank:r.rank,seed:s.seedWord,days:s.days,why:r.why,daily:/^DAILY-/.test(s.seedWord)});
  UI.hi.sort((a,b)=>b.score-a.score); UI.hi=UI.hi.slice(0,40); saveSettings();
}

/* ---------------- small cosmetics ---------------- */
function say(t){ el('sr').textContent=t; }
function msg(t,bad){ const m= UI.modal? el('mMsg') : el('msg'); m.textContent=t||''; m.className=bad?'red':''; if(bad) SFX.bad(); }
function floater(text,cls){
  const a=el('sCash').getBoundingClientRect(), st=el('stage').getBoundingClientRect();
  const f=document.createElement('span'); f.className='floater '+cls; f.textContent=text;
  f.style.left=(a.left-st.left)+'px'; f.style.top=(a.top-st.top-4)+'px';
  el('stage').appendChild(f); setTimeout(()=>f.remove(),1200);
}
function shake(){ const g=el('game'); g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); }
function flash(){ el('sCash').classList.remove('flash'); void el('sCash').offsetWidth; el('sCash').classList.add('flash'); }

/* ---------------- rendering ---------------- */
function renderStrip(){
  const s=G.state; if(!s) return;
  el('sDay').textContent=Math.min(s.day,s.days)+'/'+s.days;
  el('sCash').textContent=fmtK(s.cash);
  el('sBank').textContent=fmtK(s.bank);
  el('sDebt').textContent=fmtK(s.debt);
  el('sTrunk').textContent=G.used(s)+'/'+s.trunk;
  const h=el('sHealth'); h.textContent=s.health; h.className= s.health<35?'red': s.health<70?'amb':'';
  el('sLaw').textContent=s.lawyers;
  const hf=G.heatForecast(s); el('sHeatN').textContent=Math.round(s.heat)+' ('+(hf>=0?'+':'')+hf+' tonight)'; el('sTier').textContent=G.T(s).name;
  if(ART.heat) ART.heat(el('gHeat'),s.heat,performance.now()); else ART.bar(el('gHeat'),s.heat/100,'#ffb454');
  ART.gauge(el('gTrunk'),s);
  ART.bar(el('gHealth'),s.health/RULES.startHealth, s.health<35?'#ff6b6b': s.health<70?'#ffb454':'#9fe870');
}
function renderMarket(){
  const s=G.state; const tb=el('rows'); tb.innerHTML='';
  GOODS.forEach((g,i)=>{
    const p=s.prices[i]; const tr=document.createElement('tr');
    tr.className=(p?'':'off ')+(i===UI.sel?'sel ':'')+(s.event&&s.event.good===i?s.event.kind:'');
    let arrow='';
    if(p&&lastPrices&&lastPrices[i]){ const r=p/lastPrices[i]; arrow= r>1.15?'<span class="arrow grn">▲</span>': r<0.87?'<span class="arrow red">▼</span>':''; }
    const paid=G.avgPaid(s,i);
    tr.innerHTML=
      '<td class="gd"><span class="k">'+(i+1)+'</span></td>'+
      '<td class="ic gd"></td>'+
      '<td class="gd">'+g.name+' <span class="dim">/'+g.unit+'</span></td>'+
      '<td class="num price gd">'+(p?fmt(p)+arrow:'')+'</td>'+
      '<td class="tr gd"><canvas width="90" height="22"></canvas></td>'+
      '<td class="num gd">'+(s.inv[i]||'')+'</td>'+
      '<td class="num gd '+(s.inv[i]&&p? (p>=paid?'grn':'red'):'dim')+'">'+(s.inv[i]?fmt(paid):'')+'</td>'+
      '<td><div class="act">'+
        '<button class="buy" data-i="'+i+'" '+(G.maxBuy(s,i)>0?'':'disabled')+' title="Buy '+g.name+' (B)">BUY</button>'+
        '<button class="sell" data-i="'+i+'" '+(p&&s.inv[i]>0?'':'disabled')+' title="Sell '+g.name+' (S)">SELL</button>'+
      '</div></td>';
    tr.querySelector('.ic').appendChild(ART.icon(g.k,20));
    ART.spark(tr.querySelector('.tr canvas'), s.hist.map(h=>h.prices[i]), g.lo, g.hi, p);
    tr.querySelectorAll('.gd').forEach(td=>td.addEventListener('click',()=>{ UI.sel=i; renderMarket(); }));
    tr.querySelector('.buy').addEventListener('click',()=>{ UI.sel=i; askQty('buy',i); });
    tr.querySelector('.sell').addEventListener('click',()=>{ UI.sel=i; askQty('sell',i); });
    tb.appendChild(tr);
  });
  ART.chart(el('chart'),s,UI.sel);
}
function renderDay(){
  const s=G.state; const e=s.event; const dc=el('daycard'); const bt=el('dayBtns'); bt.innerHTML='';
  dc.className= e&&(e.kind==='feds'||e.kind==='hit'||e.kind==='mugged'||e.kind==='crash'||e.kind==='collectors'||e.kind==='jobfail')?'bad': e&&(e.kind==='van'||e.kind==='lawyer'||e.kind==='spike'||e.kind==='job')?'warn':'';
  el('dayText').textContent=e?e.text:'';
  if(e&&e.offer&&!e.taken){
    const b=document.createElement('button'); b.textContent=(e.kind==='van'?'BUY THE VAN':'RETAIN')+' · '+fmt(e.price);
    b.disabled=s.cash<e.price;
    b.addEventListener('click',()=>{ const r=G.acceptOffer(); if(r.ok){ SFX.cash(); floater('-'+fmt(e.price),'red'); renderAll(); } else msg(r.msg,true); });
    bt.appendChild(b);
    const n=document.createElement('button'); n.textContent='PASS'; n.addEventListener('click',()=>{ e.taken=true; e.text+=' You pass.'; renderAll(); });
    bt.appendChild(n);
  }
}
function renderRight(){
  const s=G.state; const home=G.canService(s);
  el('services').classList.toggle('hidden',!home);
  el('svRate').textContent=Math.round(G.T(s).rate*100)+'%/day';
  el('bTravel').disabled=s.phase!=='market'; el('bLayLow').disabled=s.phase!=='market';
  renderContact(); renderJobs(); renderSpecial();
  const lg=el('log'); lg.innerHTML=s.log.slice().reverse().map(l=>'<div><b>d'+l.day+'</b>'+l.text+'</div>').join('');
  renderMap();
}
function dueTag(s,j){ const left=j.due-s.day; const cls= left<0?'late': left<=1?'soon':''; return '<span class="due '+cls+'">'+(left<0?'LATE':'day '+j.due+(left===0?' · today':' · '+left+'d'))+'</span>'; }
function jobCard(s,j,btns){
  const d=document.createElement('div'); d.className='job'+(j.story?' story':'');
  d.innerHTML='<div class="jt"><span class="jg"></span>'+j.title.toUpperCase()+dueTag(s,j)+'</div><div>'+j.text+'</div><div class="jb"></div>';
  if(ART.job){ const src=ART.job(j.story?'story':j.type,14); const cv=document.createElement('canvas'); cv.width=cv.height=src.width; cv.getContext('2d').drawImage(src,0,0); d.querySelector('.jg').appendChild(cv); }
  const jb=d.querySelector('.jb'); btns.forEach(b=>{ const x=document.createElement('button'); x.textContent=b.label; x.disabled=!!b.disabled; x.title=b.title||''; x.addEventListener('click',()=>{ SFX.click(); b.fn(); }); jb.appendChild(x); });
  return d;
}
function renderContact(){
  const s=G.state; const c=CONTACTS[s.loc]; const rep=s.rep[s.loc];
  el('cName').textContent=c.name; el('cRole').textContent=c.role+' · rep '+rep;
  el('cLine').textContent=c.line;
  const perk=el('cPerk'); perk.textContent=(G.hasPerk(s,s.loc)?'PERK ACTIVE: ':'perk at rep '+REP_PERK+': ')+c.perk; perk.className=G.hasPerk(s,s.loc)?'on':'dim';
  const pw=el('cPortrait'); pw.innerHTML=''; if(ART.portrait) pw.appendChild(ART.portrait(c.k,40));
  ART.bar(el('gRep'),rep/100, rep>=REP_PERK?'#9fe870': rep<REP_MIN_JOB?'#ff6b6b':'#8b95a3');
  const b=el('board'); b.innerHTML='';
  const offers=s.board[s.loc]||[];
  if(rep<REP_MIN_JOB){ b.innerHTML='<div class="boardTitle">'+c.name.toUpperCase()+' IS NOT TAKING YOUR CALLS</div>'; return; }
  b.innerHTML='<div class="boardTitle">ON OFFER</div>'+(offers.length?'':'<div class="rep">nothing today</div>');
  offers.forEach((j,i)=>{
    const cost= j.type==='import'? ' · '+fmt(j.cost)+' now' : '';
    b.appendChild(jobCard(s,j,[{label:'ACCEPT'+cost,disabled:s.phase!=='market'||s.jobs.length>=RULES.maxJobs,fn:()=>{ const r=G.accept(i); if(r.ok){ SFX.cash(); renderAll(); } else msg(r.msg,true); }}]));
  });
}
function renderJobs(){
  const s=G.state; const l=el('jobList'); l.innerHTML=''; el('jobCount').textContent=s.jobs.length+'/'+RULES.maxJobs;
  s.jobs.forEach(j=>{
    const btns=[];
    if(j.type==='rush'){ const here=s.loc===j.contact, have=s.inv[j.good]>=j.qty;
      const extra= j.extraGood!=null? ' + '+j.extraQty+' '+GOODS[j.extraGood].name : '';
      btns.push({label:'DELIVER '+j.qty+' '+GOODS[j.good].name+extra, disabled:!(here&&have)||s.phase!=='market',
        title: here?(have?'':'you have '+s.inv[j.good]):'deliver at '+DISTRICTS[j.contact].name, fn:()=>{ const r=G.deliver(j.id); if(r.ok){ SFX.win(); floater('+'+fmt(j.qty*j.price),'grn'); renderAll(); } else msg(r.msg,true); }}); }
    l.appendChild(jobCard(s,j,btns));
  });
}
function renderSpecial(){
  const s=G.state; const sp=el('special'); sp.innerHTML=''; let any=false;
  if(s.loc===4){ any=true; const b=document.createElement('button'); b.className='sv'; b.innerHTML='LAUNDER <small>'+Math.round(G.launderFee(s)*100)+'% fee · -'+RULES.heatLaunder+' heat</small>'; b.disabled=s.phase!=='market'; b.addEventListener('click',openLaunder); sp.appendChild(b); }
  if(s.loc===1&&s.story.supplier){ any=true; const o=s.supplierOffer; const b=document.createElement('button'); b.className='sv';
    b.innerHTML= o&&o.day===s.day? 'SUPPLIER <small>'+o.qty+' '+GOODS[o.good].name+' @ '+fmt(o.price)+'</small>' : 'SUPPLIER <small>back day '+s.supplierNext+'</small>';
    b.disabled=!(o&&o.day===s.day)||s.phase!=='market'; b.addEventListener('click',()=>{ const r=G.supplierBuy(); if(r.ok){ SFX.cash(); renderAll(); } else msg(r.msg,true); }); sp.appendChild(b); }
  if(any){ sp.insertAdjacentHTML('afterbegin','<div class="sv-title">'+DISTRICTS[s.loc].name.toUpperCase()+'</div>'); }
  sp.classList.toggle('hidden',!any);
}
function openLaunder(){ const s=G.state; const fee=G.launderFee(s);
  moneyModal('TANYA · LAUNDER',['Cash in, bank out, '+Math.round(fee*100)+'% fee, and the heat comes off (-'+RULES.heatLaunder+'). No trip Downtown.','Cash on hand: '+fmt(s.cash)+'. Heat: '+Math.round(s.heat)+'.'],
    [{label:'LAUNDER',cls:'go big',def:s.cash,fn:G.launder}]); }
function renderMap(t){
  const s=G.state; if(!s) return;
  const opt={hover:UI.hover,t:t||performance.now()};
  if(UI.drive){ opt.car=[UI.drive.from,UI.drive.to,UI.drive.f]; opt.route=[UI.drive.from,UI.drive.to]; }
  ART.map(el('map'),UI.drive?{loc:UI.drive.from}:s,opt);
}
function renderAll(){
  const s=G.state; if(!s) return;
  const d=DISTRICTS[s.loc]; el('locName').textContent=d.name.toUpperCase(); el('locBlurb').textContent=d.blurb;
  renderStrip(); renderDay(); renderMarket(); renderRight(); persist();
  if(s.phase==='encounter') openEncounter();
  else if(s.phase==='collectors') openCollectors();
  else if(s.phase==='over') openGameOver();
}

/* the cosmetic clock: map glow, drive animation, encounter lights.
   Runs only while something needs it; calm mode keeps it still. */
function tick(){
  UI.anim=0; const now=performance.now(); let again=false;
  if(UI.drive){ const d=UI.drive; d.f=Math.min(1,(now-d.t0)/d.dur); renderMap(now); if(d.f>=1){ UI.drive=null; el('map').classList.remove('busy'); d.done(); } else again=true; }
  else if(!UI.settings.calm && G.state && !el('game').classList.contains('hidden')){ renderMap(now); again=true; }
  if(UI.scene){ const sc=UI.scene; if(!document.body.contains(sc.cv)){ UI.scene=null; } else { (sc.col&&ART.collectors? ART.collectors : ART.scene)(sc.cv,sc.col?sc.enc.agents:sc.enc,now,{calm:UI.settings.calm,hit:sc.hitAt?now-sc.hitAt:0}); again=true; } }
  if(G.state&&!UI.settings.calm&&ART.heat&&G.state.heat>=70&&!el('game').classList.contains('hidden')){ ART.heat(el('gHeat'),G.state.heat,now); again=true; }
  if(again) UI.anim=requestAnimationFrame(tick);
}
function wake(){ if(!UI.anim) UI.anim=requestAnimationFrame(tick); }

/* ---------------- modal plumbing ---------------- */
function openModal(title,bodyHTML,btns){
  UI.modal=title; el('mTitle').textContent=title; el('mBody').innerHTML=bodyHTML; el('mMsg').textContent='';
  const bb=el('mBtns'); bb.innerHTML='';
  btns.forEach(b=>{ const x=document.createElement('button'); x.textContent=b.label; x.className=b.cls||''; if(b.disabled) x.disabled=true; x.addEventListener('click',()=>{ SFX.click(); b.fn(); }); bb.appendChild(x); });
  el('modal').classList.remove('hidden');
  const f=el('mBody').querySelector('input,button')||bb.querySelector('button:not(:disabled)'); if(f) f.focus();
}
function closeModal(){ UI.modal=null; UI.scene=null; el('modal').classList.add('hidden'); if(document.activeElement&&document.activeElement.blur) document.activeElement.blur(); }

/* ---------------- quantity ---------------- */
function askQty(kind,i){
  const s=G.state; if(s.phase!=='market'||UI.drive) return; const g=GOODS[i]; const p=s.prices[i];
  const max= kind==='buy'? G.maxBuy(s,i) : s.inv[i];
  if(kind==='buy'&&!p) return msg('Nobody is selling '+g.name+' here today.',true);
  if(kind==='sell'&&!p) return msg('Nobody is buying '+g.name+' here today.',true);
  if(max<=0) return msg(kind==='buy'?'You cannot afford any '+g.name+' (or the trunk is full).':'You have no '+g.name+'.',true);
  const body='<p><span class="icw"></span>'+g.name+' @ <b class="grn">'+fmt(p)+'</b> / '+g.unit+
    (kind==='sell'&&s.inv[i]?' · paid avg '+fmt(G.avgPaid(s,i)):'')+'</p>'+
    '<div class="row"><label for="qty">HOW MANY</label><input id="qty" type="number" min="1" max="'+max+'" value="'+max+'" inputmode="numeric"></div>'+
    '<div class="qty"><button data-q="1">1</button><button data-q="10">10</button><button data-q="'+Math.max(1,Math.floor(max/2))+'">HALF</button><button data-q="'+max+'">MAX ('+max+')</button></div>'+
    '<p class="dim" id="qtyTotal"></p>';
  const go=()=>{ const n=parseInt(el('qty').value,10); const r= kind==='buy'? G.buy(i,n) : G.sell(i,n);
    if(r.ok){ closeModal(); (kind==='buy'?SFX.buy:SFX.sell)(); floater((kind==='buy'?'-':'+')+fmt(n*p),kind==='buy'?'red':'grn'); msg(''); renderAll(); flash(); } else msg(r.msg,true); };
  openModal(kind.toUpperCase()+' '+g.name.toUpperCase(),body,[{label:'CANCEL',fn:closeModal},{label:kind==='buy'?'BUY':'SELL',cls:'big go',fn:go}]);
  el('mBody').querySelector('.icw').appendChild(ART.icon(g.k,24));
  const q=el('qty'); const tot=()=>{ const n=clamp(parseInt(q.value,10)||0,0,max); el('qtyTotal').textContent= n? n+' × '+fmt(p)+' = '+fmt(n*p) : ''; };
  q.addEventListener('input',tot); q.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); go(); } });
  el('mBody').querySelectorAll('.qty button').forEach(b=>b.addEventListener('click',()=>{ q.value=b.dataset.q; tot(); q.focus(); }));
  q.select(); tot();
}

/* ---------------- travel ---------------- */
function openTravel(){
  const s=G.state; if(s.phase!=='market'||UI.drive) return;
  const last=s.day>=s.days;
  let body='<p class="dim">'+(last?'This is the last day. Driving anywhere ends the run — sell first.':'Driving takes a day. PayLater compounds. Prices reshuffle.')+'</p>';
  DISTRICTS.forEach((d,i)=>{ body+='<button class="dest'+(i===s.loc?' here':'')+'" data-d="'+i+'" '+(i===s.loc?'disabled':'')+'><span><kbd>'+(i+1)+'</kbd> '+d.name+(i===HOME?' <small>· bank · loan · clinic</small>':'')+'</span><small>'+d.blurb+'</small></button>'; });
  openModal('TRAVEL',body,[{label:'STAY',fn:closeModal}]);
  el('mBody').querySelectorAll('.dest').forEach(b=>b.addEventListener('click',()=>goTravel(+b.dataset.d)));
}
function goTravel(d){
  const s=G.state; if(UI.drive) return; if(s.phase!=='market') return;
  const from=s.loc; const snap=s.prices.slice();
  const r=G.travel(d); if(!r.ok) return msg(r.msg,true);
  closeModal(); SFX.travel(); msg(''); UI.sel=0;
  const finish=()=>{
    lastPrices= s.phase==='over'? null : snap;
    if(s.event&&s.event.kind==='spike') SFX.cash();
    if(s.event&&(s.event.kind==='feds'||s.event.kind==='collectors')) SFX.siren();
    if(s.event&&s.event.kind==='job') SFX.win();
    if(s.event&&s.event.kind==='mugged') shake();
    renderAll();
    say('Day '+s.day+', '+DISTRICTS[s.loc].name+'. '+(s.event?s.event.text:''));
  };
  if(UI.settings.calm||s.phase==='over'){ finish(); return; }
  // the drive: the car crosses the map, the panel waits. Cosmetic only —
  // the engine already moved; a reload mid-drive resumes at the destination.
  UI.drive={from,to:d,f:0,t0:performance.now(),dur:650,done:finish};
  el('map').classList.add('busy'); el('bTravel').disabled=true;
  el('locName').textContent='DRIVING…'; el('locBlurb').textContent='to '+DISTRICTS[d].name;
  wake();
}

function layLow(){
  const s=G.state; if(s.phase!=='market'||UI.drive) return;
  const snap=s.prices.slice(); const r=G.layLow(); if(!r.ok) return msg(r.msg,true);
  closeModal(); SFX.click(); msg(''); lastPrices= s.phase==='over'? null : snap;
  if(s.event&&s.event.kind==='collectors') SFX.siren();
  renderAll(); say('Day '+s.day+'. '+(s.event?s.event.text:''));
}

/* ---------------- downtown services ---------------- */
function moneyModal(title,lines,actions){
  let body=lines.map(l=>'<p>'+l+'</p>').join('')+'<div class="row"><label for="amt">AMOUNT</label><input id="amt" type="number" min="0" inputmode="numeric"></div>';
  const btns=[{label:'CLOSE',fn:closeModal}].concat(actions.map(a=>({label:a.label,cls:a.cls,fn:()=>{ const n=parseInt(el('amt').value,10); const r=a.fn(n); if(r.ok){ SFX.cash(); closeModal(); msg(''); renderAll(); } else msg(r.msg,true); }})));
  openModal(title,body,btns);
  const q=el('amt'); q.value=actions[0].def; q.select();
  q.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); el('mBtns').querySelectorAll('button')[1].click(); } });
}
function openBank(){ const s=G.state;
  moneyModal('BANK',['Account: <b class="grn">'+fmt(s.bank)+'</b> · pays '+(RULES.bankRate*100)+'% a day.','Cash on hand: '+fmt(s.cash)+'. The Task Force cannot seize what is in the bank.'],
    [{label:'DEPOSIT',cls:'go big',def:s.cash,fn:G.deposit},{label:'WITHDRAW',def:s.bank,fn:G.withdraw}]); }
function openLoan(){ const s=G.state; const room=Math.max(0,G.maxLoan(s)-s.debt);
  moneyModal('PAYLATER',['You owe <b class="red">'+fmt(s.debt)+'</b> · compounding '+(RULES.loanRate*100)+'% a day.','They will extend '+fmt(room)+' more. Cash on hand: '+fmt(s.cash)+'.'],
    [{label:'PAY',cls:'go big',def:Math.min(s.cash,s.debt),fn:G.payDebt},{label:'BORROW',def:room,fn:G.borrow}]); }
function openClinic(){ const s=G.state; const need=RULES.startHealth-s.health;
  openModal('CLINIC',['<p>Health <b>'+s.health+'</b>/'+RULES.startHealth+'. Patch-up is '+fmt(RULES.clinicPerHp)+' per point'+(need?' — full recovery '+fmt(need*RULES.clinicPerHp):'')+'.</p>'],
    [{label:'CLOSE',fn:closeModal},{label:'HEAL',cls:'go big',disabled:need<=0,fn:()=>{ const r=G.heal(); if(r.ok){ SFX.cash(); closeModal(); renderAll(); } else msg(r.msg,true); }}]); }

/* ---------------- the Task Force ---------------- */
function openEncounter(){
  const s=G.state; const e=s.encounter; if(!e) return;
  const p=Math.max(0.12,RULES.runBase-RULES.runPerAgent*e.agents);
  const cost=G.bribeCost(s);
  const body='<canvas id="sceneCv" width="472" height="120"></canvas><p class="red">'+s.event.text+'</p>'+
    '<div class="stat-grid"><span>Agents on you</span><b>'+e.agents+'</b><span>Stash at stake</span><b>'+fmt(G.stashValue(s))+'</b><span>Health</span><b>'+s.health+'</b><span>Lawyers on retainer</span><b>'+s.lawyers+'</b></div>'+
    '<p class="dim"><kbd>R</kbd> RUN: '+Math.round(p*100)+'% to lose them, or take a hit. <kbd>L</kbd> LAWYER: burns a retainer, peels off 1–2 agents, no risk. <kbd>B</kbd> BRIBE: '+fmt(cost)+', guaranteed.</p>';
  const after=(r,bad)=>{ if(!r.ok) return msg(r.msg,true);
    if(s.phase!=='encounter'){ closeModal(); (s.phase==='over'?SFX.over:SFX.win)(); renderAll(); return; }
    if(bad&&s.event.kind==='hit'){ SFX.bad(); shake(); } else SFX.click();
    renderAll(); if(UI.scene&&bad&&s.event.kind==='hit') UI.scene.hitAt=performance.now(); };
  openModal('THE TASK FORCE',body,[
    {label:'RUN',cls:'big',fn:()=>after(G.run(),1)},
    {label:'LAWYER',disabled:s.lawyers<=0,fn:()=>after(G.lawyerUp())},
    {label:'BRIBE '+fmtK(cost),cls:s.cash>=cost?'go big':'',disabled:s.cash<cost,fn:()=>after(G.bribe())},
  ]);
  UI.scene={cv:el('sceneCv'),enc:e,hitAt:0}; ART.scene(UI.scene.cv,e,performance.now(),{calm:UI.settings.calm}); wake();
  say(s.event.text);
}

/* ---------------- PayLater's collectors ---------------- */
function openCollectors(){
  const s=G.state; const e=s.encounter; if(!e) return;
  const want=Math.ceil(s.debt*RULES.collectorsPayFrac), min=Math.ceil(s.debt*RULES.collectorsMinFrac);
  const hasVan=s.trunk>G.T(s).trunk;
  const body='<canvas id="sceneCv" width="472" height="120"></canvas><p class="red">'+s.event.text+'</p>'+
    '<div class="stat-grid"><span>You owe</span><b class="red">'+fmt(s.debt)+'</b><span>Overdue</span><b>'+s.overdue+' days</b><span>Cash on hand</span><b>'+fmt(s.cash)+'</b><span>Stash</span><b>'+G.used(s)+' units · '+fmt(G.stashValue(s))+'</b></div>'+
    '<p class="dim"><kbd>P</kbd> PAY: '+fmt(Math.min(s.cash,want))+' now (they take '+Math.round(RULES.collectorsPayFrac*100)+'% of the debt, minimum '+fmt(min)+'). <kbd>B</kbd> BEATING: lose health and '+Math.round(RULES.collectorsSeize*100)+'% of every stack. <kbd>V</kbd> VAN: hand over the van, keep what fits in a base trunk.'+(s.creditCut?' PayLater has cut your credit line in half.':'')+'</p>';
  const after=r=>{ if(!r.ok) return msg(r.msg,true); closeModal(); if(s.phase==='over') SFX.over(); else if(s.event.kind==='hit'){ SFX.bad(); shake(); } else SFX.cash(); renderAll(); };
  openModal('PAYLATER COLLECTIONS',body,[
    {label:'PAY '+fmtK(Math.min(s.cash,want)),cls:s.cash>=min?'go big':'',disabled:s.cash<min,fn:()=>after(G.colPay())},
    {label:'TAKE THE BEATING',fn:()=>after(G.colBeat())},
    {label:'GIVE THE VAN',disabled:!hasVan,fn:()=>after(G.colVan())},
  ]);
  UI.scene={cv:el('sceneCv'),enc:e,col:true,hitAt:0}; (ART.collectors||ART.scene)(UI.scene.cv,ART.collectors?e.agents:e,performance.now(),{calm:UI.settings.calm}); wake();
  say(s.event.text);
}

/* ---------------- game over ---------------- */
function openGameOver(){
  const s=G.state; const r=s.result; if(!r) return;
  if(!r.recorded){ r.recorded=true; recordHi(r,s); persist(); }
  const stash=G.stashValue(s);
  const body='<p'+(r.why==='custody'?' class="red"':'')+'>'+s.event.text+'</p>'+
    '<div class="rank">'+r.rank+'</div><div class="worth '+(r.netWorth>=0?'grn':'red')+'">'+fmt(r.netWorth)+'</div>'+
    '<p class="dim" style="text-align:center">'+G.T(s).name+' · score ×'+G.T(s).scoreMult+' = <b class="amb">'+fmt(r.score)+'</b> · heat '+Math.round(s.heat)+' · jobs '+s.stats.jobs+' done, '+s.stats.jobsFailed+' failed</p>'+
    '<div class="stat-grid"><span>Cash</span><b>'+fmt(s.cash)+'</b><span>Bank</span><b>'+fmt(s.bank)+'</b><span>PayLater</span><b class="red">-'+fmt(s.debt)+'</b>'+
    (stash?'<span class="dim">Unsold stash (worth nothing now)</span><b class="dim">'+fmt(stash)+'</b>':'')+
    '<span>Units bought / sold</span><b>'+s.stats.bought+' / '+s.stats.sold+'</b><span>Trading profit</span><b>'+fmt(s.stats.profit)+'</b>'+
    '<span>Escapes / cases / bribes</span><b>'+s.stats.escapes+' / '+s.stats.cases+' / '+s.stats.bribes+'</b><span>Seed</span><b class="grn">'+s.seedWord+'</b></div>';
  openModal('RUN OVER',body,[{label:'REPLAY SEED',fn:()=>{ closeModal(); startGame(s.seedWord,s.days,s.tier); }},{label:'MENU',cls:'big go',fn:()=>{ closeModal(); showMenu(); }}]);
}

/* ---------------- menu / boot ---------------- */
let chosenDays=30;
function dailySeed(){ const d=new Date(); return 'DAILY-'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function renderMenu(){
  const T=TIERS[UI.tier];
  el('menuBlurb').innerHTML='You owe PayLater <b>'+fmt(T.debt)+'</b> at <b>'+Math.round(T.rate*100)+'% a day</b>. You have <b>'+fmt(T.cash)+'</b>, a trunk that holds <b>'+T.trunk+'</b>, six districts, six people who need things moved, and PayLater\'s people if you fall behind. Buy low. Sell high. Manage the heat.';
  const tr=el('tierRow'); tr.innerHTML='';
  TIERS.forEach((t,i)=>{ const b=document.createElement('button'); b.className='tier'+(i===UI.tier?' on':''); b.innerHTML='<b>'+t.name+'</b><small>'+t.blurb+'</small><small>score ×'+t.scoreMult+'</small>'; b.setAttribute('role','radio'); b.setAttribute('aria-checked',i===UI.tier);
    b.addEventListener('click',()=>{ UI.tier=i; UI.hiTab=i; UI.settings.tier=i; saveSettings(); renderMenu(); }); tr.appendChild(b); });
  const lr=el('lenRow'); lr.innerHTML='<label>DAYS</label>';
  RULES.daysOptions.forEach(d=>{ const b=document.createElement('button'); b.className='opt'+(d===chosenDays?' on':''); b.textContent=d; b.setAttribute('role','radio'); b.setAttribute('aria-checked',d===chosenDays);
    b.addEventListener('click',()=>{ chosenDays=d; renderMenu(); }); lr.appendChild(b); });
  let saved=null; try{ saved=localStorage.getItem(LS.save); }catch(e){}
  el('bResume').classList.toggle('hidden',!saved);
  const hs=el('hiscores'); hs.className='ldr';
  const rows=UI.hi.filter(h=>h.tier===UI.hiTab).slice(0,6);
  hs.innerHTML= UI.hi.length? '<div class="tabs">'+TIERS.map((t,i)=>'<button class="'+(i===UI.hiTab?'on':'')+'" data-t="'+i+'">'+t.name+'</button>').join('')+'</div>'+
    (rows.length? rows.map(h=>'<div class="r"><span>'+h.rank+' <span class="dim">· '+h.seed+' · '+h.days+'d'+(h.why!=='time'?' · '+h.why:'')+'</span></span><b>'+fmt(h.score)+'</b></div>').join('') : '<div class="r"><span>no runs on '+TIERS[UI.hiTab].name+' yet</span></div>') : '';
  hs.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{ UI.hiTab=+b.dataset.t; renderMenu(); }));
}
function showMenu(){ el('game').classList.add('hidden'); el('menu').classList.remove('hidden'); renderMenu(); el('seed').focus(); }
function startGame(seedWord,days,tier){
  G.new(seedWord||randomSeedWord(),days,tier==null?UI.tier:tier); lastPrices=null; UI.sel=0; UI.drive=null;
  el('menu').classList.add('hidden'); el('game').classList.remove('hidden'); msg('');
  renderAll(); wake(); say('New run. '+G.state.event.text);
}
function resumeGame(){
  let saved=null; try{ saved=localStorage.getItem(LS.save); }catch(e){}
  if(!saved||!G.load(saved)) return startGame(el('seed').value,chosenDays,UI.tier);
  lastPrices=null; UI.drive=null;
  el('menu').classList.add('hidden'); el('game').classList.remove('hidden'); renderAll(); wake();
}

function applySettings(){ SFX.setVolume(UI.settings.vol/100); el('vol').value=UI.settings.vol; el('volV').textContent=UI.settings.vol;
  document.body.classList.toggle('calm',UI.settings.calm); el('bCalm').textContent='CALM MODE '+(UI.settings.calm?'ON':'OFF'); wake(); }

function keys(e){
  if(e.target.tagName==='INPUT'&&e.key!=='Escape'&&e.key!=='Enter') return;
  if(!el('menu').classList.contains('hidden')){ if(e.key==='Enter'&&e.target.id==='seed'){ el('bStart').click(); } return; }
  if(UI.modal){ if(e.key==='Escape'&&G.state.phase==='market'){ closeModal(); }
    else if(UI.modal==='TRAVEL'&&/^[1-6]$/.test(e.key)){ const b=el('mBody').querySelector('.dest[data-d="'+(+e.key-1)+'"]'); if(b&&!b.disabled) b.click(); }
    else if(UI.modal==='THE TASK FORCE'){ const k=e.key.toLowerCase(); const bs=el('mBtns').querySelectorAll('button'); if(k==='r') bs[0].click(); if(k==='l'&&!bs[1].disabled) bs[1].click(); if(k==='b'&&!bs[2].disabled) bs[2].click(); }
    else if(UI.modal==='PAYLATER COLLECTIONS'){ const k=e.key.toLowerCase(); const bs=el('mBtns').querySelectorAll('button'); if(k==='p'&&!bs[0].disabled) bs[0].click(); if(k==='b') bs[1].click(); if(k==='v'&&!bs[2].disabled) bs[2].click(); }
    return; }
  if(!G.state||G.state.phase!=='market'||UI.drive) return;
  const k=e.key.toLowerCase();
  if(/^[1-8]$/.test(k)){ UI.sel=+k-1; renderMarket(); }
  else if(k==='b'){ e.preventDefault(); askQty('buy',UI.sel); }
  else if(k==='s'){ e.preventDefault(); askQty('sell',UI.sel); }
  else if(k==='t'){ e.preventDefault(); openTravel(); }
  else if(k==='l'){ e.preventDefault(); layLow(); }
  else if(k==='arrowdown'){ UI.sel=(UI.sel+1)%GOODS.length; renderMarket(); e.preventDefault(); }
  else if(k==='arrowup'){ UI.sel=(UI.sel+GOODS.length-1)%GOODS.length; renderMarket(); e.preventDefault(); }
  else if(k==='escape'&&!el('settings').classList.contains('hidden')){ el('setClose').click(); }
}

function boot(){
  loadSettings(); applySettings();
  el('seed').value=randomSeedWord();
  el('bReroll').addEventListener('click',()=>{ el('seed').value=randomSeedWord(); el('seed').focus(); });
  el('bStart').addEventListener('click',()=>{ SFX.unlock(); SFX.click(); startGame(el('seed').value.trim(),chosenDays,UI.tier); });
  el('bDaily').addEventListener('click',()=>{ el('seed').value=dailySeed(); el('seed').focus(); });
  el('bLayLow').addEventListener('click',()=>{ SFX.click(); layLow(); });
  el('bResume').addEventListener('click',()=>{ SFX.unlock(); resumeGame(); });
  el('bTravel').addEventListener('click',()=>{ SFX.click(); openTravel(); });
  el('bBank').addEventListener('click',openBank); el('bLoan').addEventListener('click',openLoan); el('bClinic').addEventListener('click',openClinic);
  el('bSettings').addEventListener('click',()=>{ el('settings').classList.remove('hidden'); el('setClose').focus(); });
  el('setClose').addEventListener('click',()=>{ el('settings').classList.add('hidden'); });
  el('vol').addEventListener('input',()=>{ UI.settings.vol=+el('vol').value; applySettings(); saveSettings(); SFX.click(); });
  el('bCalm').addEventListener('click',()=>{ UI.settings.calm=!UI.settings.calm; applySettings(); saveSettings(); });
  el('bAbandon').addEventListener('click',()=>{ try{ localStorage.removeItem(LS.save); }catch(e){} G.state=null; el('settings').classList.add('hidden'); closeModal(); showMenu(); });
  el('bReset').addEventListener('click',()=>{ try{ localStorage.removeItem(LS.save); localStorage.removeItem(LS.hi); localStorage.removeItem(LS.set); }catch(e){} UI.hi=[]; UI.settings={vol:70,calm:false}; applySettings(); G.state=null; el('settings').classList.add('hidden'); closeModal(); showMenu(); });
  // the map is a travel control
  const m=el('map');
  m.addEventListener('mousemove',ev=>{ const h=ART.mapHit(m,ev); if(h!==UI.hover){ UI.hover=h; m.title= h>=0? DISTRICTS[h].name : ''; if(UI.settings.calm) renderMap(); } });
  m.addEventListener('mouseleave',()=>{ UI.hover=-1; if(UI.settings.calm) renderMap(); });
  m.addEventListener('click',ev=>{ const h=ART.mapHit(m,ev); if(h<0||!G.state||G.state.phase!=='market'||UI.drive) return; if(h===G.state.loc) return msg('You are already here.'); SFX.click(); goTravel(h); });
  document.addEventListener('keydown',keys);
  window.addEventListener('pagehide',persist);
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) wake(); });
  showMenu();
}
/* debug/test hook — every input path the mouse uses, callable headless */
window.DwDbg={ start:startGame, layLow, resume:resumeGame, travel:goTravel, qty:askQty, open:{travel:openTravel,bank:openBank,loan:openLoan,clinic:openClinic}, close:closeModal, render:renderAll, get modal(){ return UI.modal; }, get ui(){ return UI; }, keys };
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
