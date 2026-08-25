/* Boot smoke: loads every script in index.html order (engine-only until the
   UI ships) and asserts the globals exist and G.new yields a sane state. */
'use strict';
const fs=require('fs'), path=require('path');
const { load } = require('./shim');
let fails=0;
function ok(c,name,extra){ if(c) console.log('PASS '+name); else { fails++; console.log('FAIL '+name+(extra?' — '+extra:'')); } }

const hasIndex = fs.existsSync(path.join(__dirname,'..','index.html'));
let E;
try{ E = load({engineOnly:false}); }catch(e){ ok(false,'load '+(hasIndex?'index.html order':'engine only'), e.stack); console.log('1 failed'); process.exit(1); }
ok(true, 'loaded ['+E.order.join(', ')+']'+(hasIndex?'':' (index.html absent — engine only)'));
if(hasIndex){
  const need=['js/core.js','js/data.js','js/game.js'];
  ok(need.every((f,i)=>E.order[i]===f), 'index.html loads core → data → game first', E.order.join(','));
}
for(const k of ['RNG','G','GOODS','DISTRICTS','RULES','EVENTS','RANKS','hashSeed','fmt'])
  ok(E[k]!==undefined, 'global '+k+' defined');
for(const k of ['TIERS','CONTACTS','JOBS','STORY','REP_START','REP_PERK','REP_MIN_JOB'])
  ok(E.probe(k)!==undefined, 'global '+k+' defined');
const TIERS=E.probe('TIERS'), CONTACTS=E.probe('CONTACTS'), JOBS=E.probe('JOBS');
ok(TIERS.length===4 && TIERS.every(t=>t.k&&t.name&&t.cash>0&&t.debt>0&&t.rate>0&&t.fedsMax>0&&t.vol>0&&t.cost>0&&t.trunk>0&&t.scoreMult>0&&typeof t.cutCredit==='boolean'), '4 tiers with every field the engine reads');
ok(CONTACTS.length===E.DISTRICTS.length && CONTACTS.every(c=>JOBS[c.k]&&JOBS[c.k].length>0), 'one contact per district, each with job templates');
ok(Object.values(JOBS).flat().every(t=>['rush','import','cook','case'].includes(t.type) && t.days && t.rep>0), 'job templates use known types');
ok(typeof E.RNG.next==='function' && typeof E.RNG.seed==='function' && 'state' in E.RNG, 'RNG API {seed,state,next}');
ok(E.GOODS.length===8 && E.DISTRICTS.length===6 && E.HOME===0, '8 goods, 6 districts, HOME=0');
ok(E.GOODS.every(g=>g.lo>0 && g.hi>g.lo && g.k && g.name && g.spike && g.crash), 'every good has k/name/lo<hi/spike/crash');
ok(E.DISTRICTS.every(d=>E.GOODS.some(g=>g.k===d.cheap) && E.GOODS.some(g=>g.k===d.dear)), 'district cheap/dear keys resolve to goods');
for(const k of ['find','mugged','van','lawyer','feds','quiet','win','escaped','hit','bribe','custody','collectors','colPay','colBeat','colVan','laylow','jobDone','jobFail','importIn','importLost','cookGood','cookBad','supplier'])
  ok(Array.isArray(E.EVENTS[k]) && E.EVENTS[k].length>0, 'EVENTS.'+k+' has copy');

const s=E.G.new('BOOT-1', 30, 1); const T=TIERS[1];
ok(s===E.G.state && s.v===2 && s.day===1 && s.days===30 && s.tier===1 && s.loc===E.HOME && s.phase==='market', 'G.new returns G.state: v2, day 1, tier 1, at HOME, market phase');
ok(s.cash===T.cash && s.debt===T.debt && s.principal===T.debt && s.trunk===T.trunk && s.health===E.RULES.startHealth, 'start cash/debt/principal/trunk from TIERS[1], health from RULES');
ok(s.heat===10 && s.dayVol===0 && s.overdue===0 && s.creditCut===false && Array.isArray(s.jobs) && s.jobs.length===0 && typeof s.board==='object' && Array.isArray(s.board[E.HOME]) && s.rep.length===CONTACTS.length && s.rep.every(r=>r===E.probe('REP_START')) && s.story && s.story.paid===false && s.supplierOffer===null, 'heat/dayVol/overdue/creditCut/jobs/board/rep/story/supplier fields');
ok(s.inv.length===8 && s.inv.every(v=>v===0) && s.paid.every(v=>v===0) && s.prices.length===8, 'empty inventory, 8 prices');
ok(s.prices.filter(p=>p>0).length>=E.RULES.availMin && s.prices.every(p=>Number.isInteger(p)&&p>=0), 'day-1 prices sane');
ok(s.event && s.event.kind==='quiet' && typeof s.event.text==='string' && s.encounter===null && s.result===null, 'day-1 event card, no encounter, no result');
ok(Number.isInteger(s.rng) && s.rng===E.RNG.state && s.seed===E.hashSeed('BOOT-1|1'), 'state.rng mirrors RNG.state; seed = hashSeed(seedWord|tier)');
ok(typeof E.G.rank(0)==='string' && E.G.netWorth(s)===s.cash+s.bank-s.debt && E.G.score(s)===Math.round(E.G.netWorth(s)*T.scoreMult) && E.G.fedsOdds(s)===0 && E.G.isOverdue(s)===false, 'rank / netWorth / score / fedsOdds / isOverdue helpers');
for(const f of ['layLow','launder','launderFee','supplierBuy','accept','deliver','colPay','colBeat','colVan','hasPerk','heatForecast']) ok(typeof E.G[f]==='function', 'G.'+f+' exists');
if(hasIndex){
  // the UI must not throw at boot under the stub DOM
  ok(true, 'UI scripts evaluated without throwing under the stub DOM');
}
console.log(fails? fails+' failed' : 'boot OK');
process.exit(fails?1:0);
