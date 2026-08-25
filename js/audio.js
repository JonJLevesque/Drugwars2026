'use strict';
/* ==================================================================
   AUDIO — tiny Web Audio synth. Everything is a blip; nothing here
   is gameplay. Safe to call before any user gesture (it no-ops).
   ================================================================== */
const SFX=(()=>{
  let ctx=null, vol=0.7, muted=false;
  function ac(){ if(ctx) return ctx; try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ ctx=null; } return ctx; }
  function unlock(){ const c=ac(); if(c&&c.state==='suspended') c.resume(); }
  function tone(f,dur,type,gain,when,slide){
    const c=ac(); if(!c||muted||vol<=0) return;
    const t=c.currentTime+(when||0);
    const o=c.createOscillator(), g=c.createGain();
    o.type=type||'square'; o.frequency.setValueAtTime(f,t);
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(20,slide),t+dur);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime((gain||0.2)*vol,t+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+dur+0.02);
  }
  return {
    unlock, setVolume(v){ vol=clamp(v,0,1); }, get volume(){ return vol; },
    click(){ tone(880,0.05,'square',0.08); },
    buy(){ tone(520,0.07,'square',0.12); tone(780,0.08,'square',0.12,0.06); },
    sell(){ tone(780,0.07,'square',0.12); tone(1040,0.1,'square',0.12,0.06); },
    cash(){ [0,1,2].forEach(i=>tone(660+i*220,0.06,'triangle',0.15,i*0.05)); },
    travel(){ tone(200,0.25,'sawtooth',0.08,0,90); },
    bad(){ tone(180,0.18,'sawtooth',0.15,0,120); },
    siren(){ tone(700,0.18,'square',0.1,0,900); tone(900,0.18,'square',0.1,0.2,700); },
    win(){ [0,4,7,12].forEach((n,i)=>tone(440*Math.pow(2,n/12),0.16,'triangle',0.18,i*0.09)); },
    over(){ [12,7,4,0].forEach((n,i)=>tone(330*Math.pow(2,n/12),0.22,'sawtooth',0.12,i*0.14)); },
  };
})();
