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
ok(typeof E.RNG.next==='function' && typeof E.RNG.seed==='function' && 'state' in E.RNG, 'RNG API {seed,state,next}');
ok(E.GOODS.length===8 && E.DISTRICTS.length===6 && E.HOME===0, '8 goods, 6 districts, HOME=0');
ok(E.GOODS.every(g=>g.lo>0 && g.hi>g.lo && g.k && g.name && g.spike && g.crash), 'every good has k/name/lo<hi/spike/crash');
ok(E.DISTRICTS.every(d=>E.GOODS.some(g=>g.k===d.cheap) && E.GOODS.some(g=>g.k===d.dear)), 'district cheap/dear keys resolve to goods');
for(const k of ['find','mugged','van','lawyer','feds','quiet','win','escaped','hit','bribe','custody'])
  ok(Array.isArray(E.EVENTS[k]) && E.EVENTS[k].length>0, 'EVENTS.'+k+' has copy');

const s=E.G.new('BOOT-1', 30);
ok(s===E.G.state && s.v===1 && s.day===1 && s.days===30 && s.loc===E.HOME && s.phase==='market', 'G.new returns G.state: v1, day 1, at HOME, market phase');
ok(s.cash===E.RULES.startCash && s.debt===E.RULES.startDebt && s.trunk===E.RULES.startTrunk && s.health===E.RULES.startHealth, 'start cash/debt/trunk/health from RULES');
ok(s.inv.length===8 && s.inv.every(v=>v===0) && s.paid.every(v=>v===0) && s.prices.length===8, 'empty inventory, 8 prices');
ok(s.prices.filter(p=>p>0).length>=E.RULES.availMin && s.prices.every(p=>Number.isInteger(p)&&p>=0), 'day-1 prices sane');
ok(s.event && s.event.kind==='quiet' && typeof s.event.text==='string' && s.encounter===null && s.result===null, 'day-1 event card, no encounter, no result');
ok(Number.isInteger(s.rng) && s.rng===E.RNG.state && s.seed===E.hashSeed('BOOT-1'), 'state.rng mirrors RNG.state; seed = hashSeed(seedWord)');
ok(typeof E.G.rank(0)==='string' && E.G.netWorth(s)===s.cash+s.bank-s.debt, 'rank + netWorth helpers');
if(hasIndex){
  // the UI must not throw at boot under the stub DOM
  ok(true, 'UI scripts evaluated without throwing under the stub DOM');
}
console.log(fails? fails+' failed' : 'boot OK');
process.exit(fails?1:0);
