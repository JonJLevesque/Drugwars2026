/* Headless loader for Drugwars 2026: stubs the DOM/audio/storage, concatenates
   the game modules in index.html's script order (or just the engine), and
   evaluates them with vm.runInThisContext.
   Usage:  const {G, RNG} = require('./shim').load({engineOnly:true});
   Every load() returns a FRESH set of globals (fresh RNG closure, fresh G) —
   suites use two loads to prove save/resume ≡ straight-through. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const ENGINE = ['js/core.js', 'js/data.js', 'js/game.js'];

const noop = new Proxy(function(){}, {
  get: (t,p) => p===Symbol.toPrimitive ? ()=>'' : noop,
  apply: () => noop,
});
function ctxStub(){
  return new Proxy({}, {
    get(t,p){
      if(p==='createImageData') return (w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h});
      if(p in t) return t[p];
      return noop;
    },
    set(t,p,v){ t[p]=v; return true; },
  });
}
function makeEl(){
  const ctx = ctxStub();
  return {
    style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){},contains:()=>false},
    addEventListener(){}, removeEventListener(){}, appendChild(){}, append(){}, remove(){},
    querySelector:()=>makeEl(), querySelectorAll:()=>[], closest:()=>null,
    getContext:()=>ctx, focus(){}, blur(){}, click(){}, select(){},
    setAttribute(){}, getAttribute:()=>null, removeAttribute(){},
    insertAdjacentHTML(){}, scrollIntoView(){},
    getBoundingClientRect:()=>({left:0,top:0,width:1280,height:720}),
    innerHTML:'', textContent:'', className:'', title:'', id:'', value:'',
    width:0, height:0, disabled:false, hidden:false, children:[],
  };
}
function AudioContextStub(){
  const node = new Proxy({}, { get:(t,p)=> p in t ? t[p] : (p==='connect'? ()=>node : noop), set:(t,p,v)=>{t[p]=v;return true;} });
  return {
    state:'running', currentTime:0, sampleRate:44100, destination:node,
    resume(){ return Promise.resolve(); }, suspend(){ return Promise.resolve(); }, close(){ return Promise.resolve(); },
    createGain:()=>node, createOscillator:()=>node, createBiquadFilter:()=>node,
    createDynamicsCompressor:()=>node, createStereoPanner:()=>node, createBufferSource:()=>node,
    createBuffer:(c,l)=>({ getChannelData:()=>new Float32Array(l), length:l }),
    createDelay:()=>node, createWaveShaper:()=>node, createAnalyser:()=>node,
    createPeriodicWave:()=>({}), createConvolver:()=>node,
  };
}

function scriptOrder(engineOnly){
  const idx = path.join(ROOT,'index.html');
  if(engineOnly || !fs.existsSync(idx)) return ENGINE;
  const html = fs.readFileSync(idx,'utf8');
  const order = [...html.matchAll(/<script\s+src="([^"]+)"[^>]*><\/script>/g)].map(m=>m[1]);
  return order.length ? order : ENGINE;
}

function load(opts={}){
  const els = {};
  global.document = {
    getElementById: id => els[id] || (els[id] = makeEl()),
    createElement: () => makeEl(), createTextNode: t => ({textContent:t}),
    querySelector: () => makeEl(), querySelectorAll: () => [],
    addEventListener(){}, removeEventListener(){},
    body: makeEl(), documentElement: makeEl(), head: makeEl(),
    hidden:false, visibilityState:'visible', activeElement:null, title:'',
  };
  global.window = global;
  try{ Object.defineProperty(global,'navigator',{value:{maxTouchPoints:0,userAgent:'node-test',vibrate(){}},configurable:true}); }catch(e){}
  global.performance = global.performance || { now: () => Date.now() };
  global.requestAnimationFrame = () => 0;
  global.cancelAnimationFrame = () => {};
  global.matchMedia = () => ({ matches:false, addEventListener(){}, addListener(){} });
  global.AudioContext = AudioContextStub;
  global.webkitAudioContext = AudioContextStub;
  global.innerWidth = 1280; global.innerHeight = 720;
  global.addEventListener = global.addEventListener || function(){};
  global.removeEventListener = global.removeEventListener || function(){};
  const store = {};
  global.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k,v) => { store[k]=String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for(const k in store) delete store[k]; },
  };

  const order = scriptOrder(opts.engineOnly);
  const src = order.map(f => fs.readFileSync(path.join(ROOT,f),'utf8')
                              .replace(/^'use strict';/m,'')).join('\n;\n');
  // Wrapped in a function so each load() yields fresh top-level consts
  // (RNG, G, ...) instead of "identifier already declared" on the 2nd load.
  const wrapped = "(function(){ 'use strict';\n" + src +
    "\n;return { RNG, G, GOODS, DISTRICTS, HOME, RULES, EVENTS, RANKS, hashSeed, fmt, fmtK, clamp," +
    " probe:(e)=>eval(e) }; })()";
  const out = vm.runInThisContext(wrapped, { filename: 'graymarket-bundle.js' });
  out.order = order;
  return out;
}
module.exports = { load, ENGINE };
