'use strict';
/* ==================================================================
   DRUGWARS 2026 — the TI-83 classic, thirty years on. Plain JS, no build.
   Load order (index.html is law):  core → data → game → audio → ui
   Globals are the module system. CONTRACT.md lists who owns what.
   All gameplay randomness goes through RNG so a seed replays a run.
   ================================================================== */

/* seeded PRNG (mulberry32). state is exposed so a save can resume
   bit-identically: the engine stores RNG.state in the game state. */
const RNG = (()=>{ let s=1;
  function next(){ s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s);
    t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }
  return { seed(n){ s=n|0; }, get state(){ return s; }, set state(v){ s=v|0; },
           next, range:(a,b)=>a+next()*(b-a), int:n=>(next()*n)|0,
           chance:p=>next()<p, pick:a=>a[(next()*a.length)|0] };
})();

const clamp=(v,a,b)=> v<a?a : v>b?b : v;

/* money formatting — the whole game is numbers, they must read at a glance */
function fmt(n){
  n=Math.round(n);
  const neg=n<0; n=Math.abs(n);
  const s=n.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
  return (neg?'-$':'$')+s;
}
function fmtK(n){
  const a=Math.abs(n);
  if(a>=1e9) return (n<0?'-':'')+'$'+(a/1e9).toFixed(2)+'B';
  if(a>=1e6) return (n<0?'-':'')+'$'+(a/1e6).toFixed(2)+'M';
  if(a>=1e4) return (n<0?'-':'')+'$'+(a/1e3).toFixed(1)+'K';
  return fmt(n);
}

/* a seed string ("EGGS-2026") → 32-bit int, stable across sessions */
function hashSeed(str){
  let h=2166136261>>>0;
  for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  return h|0;
}
function randomSeedWord(){
  const A=['KEY','BRICK','JAR','RACK','VAN','BAG','POUND','BOTTLE','PORT','MALL','CAMPUS','MARINA'];
  const B=['FLIP','DROP','HAUL','RUN','SPIKE','CRASH','GRIND','MOON','DIP','SPLIT'];
  const a=A[(Math.random()*A.length)|0], b=B[(Math.random()*B.length)|0];
  return a+'-'+b+'-'+((Math.random()*900+100)|0);
}

function el(id){ return document.getElementById(id); }
