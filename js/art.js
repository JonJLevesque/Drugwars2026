'use strict';
/* ==================================================================
   ART — everything procedural and visual. Pixel icons, the city map,
   price sparklines, the Task Force scene, gauges. Pure canvas drawing;
   reads state, never mutates it, never touches RNG (cosmetic-only
   randomness comes from a fixed local hash so the map is stable).
   ================================================================== */
const ART=(()=>{
  const C={ bg:'#0b0d10', road:'#2a323d', roadLit:'#3b4653', block:'#151a21', water:'#0f1b2a', waterLit:'#183050',
            glow:'#9fe870', amber:'#ffb454', red:'#ff6b6b', blue:'#5aa0ff', txt:'#e8ecf1', dim:'#8b95a3' };

  /* ---- pixel icons: 12×12, letters index the palette below ---- */
  const PAL={ w:'#f2f4f7', W:'#c9cfd8', b:'#5aa0ff', t:'#b8865a', T:'#8a6238', g:'#b9d9f5', G:'#7fb3e0',
              p:'#ff6fb0', P:'#c94e88', c:'#f0e6c8', k:'#6b4a2b', l:'#5fc06a', L:'#2f8a3a', o:'#ff9a3c', O:'#d9732a',
              d:'#1a1f26', y:'#ffd86b' };
  const ICONS={
    coke:['............','..wwwwwwww..','.wwwwwwwwww.','.wwbbbbbbww.','.wwwwwwwwww.','.wwwwwwwwww.','.wwbbbbbbww.','.wwwwwwwwww.','.WWWWWWWWWW.','..WWWWWWWW..','............','............'],
    her: ['............','..tttttttt..','.tttttttttt.','.ttttTTtttt.','.tttTTTTttt.','.ttttTTtttt.','.tttttttttt.','.tttttttttt.','.TTTTTTTTTT.','..TTTTTTTT..','............','............'],
    ket: ['.....WW.....','.....WW.....','....dddd....','....gggg....','...gggggg...','...ggGGgg...','...ggGGgg...','...gGGGGg...','...gGGGGg...','...GGGGGG...','....GGGG....','............'],
    mol: ['....WWWW....','...WWWWWW...','...dddddd...','..pppppppp..','..pPPppPPp..','..pppppppp..','..ppPPppPP..','..pppppppp..','..PPPPPPPP..','...PPPPPP...','............','............'],
    shr: ['....kkkk....','..kkkkkkkk..','.kkckkkkckk.','.kkkkkkkkkk.','.kkkkckkkkk.','..kkkkkkkk..','....cccc....','....cccc....','....cccc....','....cccc....','...cccccc...','............'],
    weed:['.....l......','....lLl.....','.l..lLl..l..','.lL.lLl.Ll..','..lLlLlLl...','...lLLLl....','..lLLLLLl...','.lLLlLlLLl..','....lLl.....','.....L......','.....L......','............'],
    xan: ['............','............','.wwwwwwwwww.','.wwWwwWwwWw.','.wwWwwWwwWw.','.wwWwwWwwWw.','.wwWwwWwwWw.','.wwWwwWwwWw.','.WWWWWWWWWW.','............','............','............'],
    add: ['....wwww....','....wwww....','...oooooo...','..oooooooo..','..ooOOOOoo..','..oowwwwoo..','..oowwwwoo..','..ooOOOOoo..','..oooooooo..','..OOOOOOOO..','...OOOOOO...','............'],
  };
  const iconCache={};
  function icon(k,size){
    const key=k+'@'+size; if(iconCache[key]) return iconCache[key];
    const cv=document.createElement('canvas'); cv.width=cv.height=size;
    const x=cv.getContext('2d'); const rows=ICONS[k]||ICONS.xan; const s=size/12;
    rows.forEach((r,j)=>{ for(let i=0;i<12;i++){ const ch=r[i]; if(ch!=='.'){ x.fillStyle=PAL[ch]||'#fff'; x.fillRect(Math.floor(i*s),Math.floor(j*s),Math.ceil(s),Math.ceil(s)); } } });
    iconCache[key]=cv; return cv;
  }

  /* ---- the city map ---- */
  const W=300,H=210;
  const NODES=[ [150,100],[52,158],[242,46],[62,46],[262,122],[232,186] ]; // by DISTRICTS index
  const RING=[3,2,4,5,1,3];
  let h=7; function hsh(){ h=(h*1103515245+12345)&0x7fffffff; return h/0x7fffffff; }
  let blocks=null;
  function genBlocks(){ h=7; blocks=[];
    for(let i=0;i<70;i++){ const x=8+hsh()*(W-16), y=8+hsh()*(H-40); const w=6+hsh()*18, hh=5+hsh()*12;
      // keep blocks off the nodes
      if(NODES.some(n=>Math.abs(n[0]-x)<22&&Math.abs(n[1]-y)<18)) continue;
      if(y+hh>172 && x<200) continue; // water
      blocks.push([x,y,w,hh,hsh()]); } }
  function road(x,a,b,lit){ x.strokeStyle=lit?C.roadLit:C.road; x.lineWidth=lit?3:2; x.beginPath(); x.moveTo(a[0],a[1]); x.lineTo(b[0],b[1]); x.stroke(); }
  function map(cv,s,opt){
    opt=opt||{}; if(!blocks) genBlocks();
    const x=cv.getContext('2d'); x.clearRect(0,0,W,H);
    x.fillStyle=C.bg; x.fillRect(0,0,W,H);
    // water: bottom-left bay + right inlet
    x.fillStyle=C.water; x.beginPath(); x.moveTo(0,150); x.quadraticCurveTo(80,140,130,185); x.quadraticCurveTo(170,215,300,205); x.lineTo(300,H); x.lineTo(0,H); x.closePath(); x.fill();
    x.strokeStyle=C.waterLit; x.lineWidth=1; x.beginPath(); x.moveTo(0,150); x.quadraticCurveTo(80,140,130,185); x.quadraticCurveTo(170,215,300,205); x.stroke();
    // blocks
    blocks.forEach(b=>{ x.fillStyle=C.block; x.fillRect(b[0],b[1],b[2],b[3]); if(b[4]>0.55){ x.fillStyle='rgba(255,216,107,'+(0.08+b[4]*0.15)+')'; x.fillRect(b[0]+2,b[1]+2,2,2); } });
    // roads
    for(let i=0;i<RING.length-1;i++) road(x,NODES[RING[i]],NODES[RING[i+1]],false);
    for(let i=1;i<NODES.length;i++) road(x,NODES[0],NODES[i],false);
    if(opt.route) road(x,NODES[opt.route[0]],NODES[opt.route[1]],true);
    // nodes
    const time=opt.t||0;
    DISTRICTS.forEach((d,i)=>{
      const [nx,ny]=NODES[i]; const here=s&&s.loc===i; const hov=opt.hover===i;
      if(here){ const r=12+3*Math.sin(time/300); const g=x.createRadialGradient(nx,ny,2,nx,ny,r+8); g.addColorStop(0,'rgba(159,232,112,.45)'); g.addColorStop(1,'rgba(159,232,112,0)'); x.fillStyle=g; x.fillRect(nx-30,ny-30,60,60); }
      x.fillStyle= here?C.glow : hov?C.amber : (i===HOME?C.txt:C.dim);
      x.beginPath(); x.arc(nx,ny,here?5:4,0,Math.PI*2); x.fill();
      x.fillStyle= here?C.glow: hov?C.amber: C.txt; x.font='bold 9px ui-monospace,Menlo,monospace'; x.textAlign='center';
      const label=d.name.replace('The ','').toUpperCase();
      const ly= ny<60? ny+16 : ny-10;
      x.fillStyle='rgba(11,13,16,.8)'; const tw=x.measureText(label).width; x.fillRect(nx-tw/2-3,ly-8,tw+6,11);
      x.fillStyle= here?C.glow: hov?C.amber: C.txt; x.fillText(label,nx,ly);
    });
    // the car (during a drive)
    if(opt.car){ const [a,b,f]=opt.car; const A=NODES[a],B=NODES[b]; const cx=A[0]+(B[0]-A[0])*f, cy=A[1]+(B[1]-A[1])*f;
      x.fillStyle=C.amber; x.beginPath(); x.arc(cx,cy,4,0,Math.PI*2); x.fill();
      x.fillStyle='rgba(255,180,84,.25)'; x.beginPath(); x.arc(cx,cy,9,0,Math.PI*2); x.fill(); }
    // scanline sheen
    x.fillStyle='rgba(255,255,255,.02)'; for(let yy=0;yy<H;yy+=3) x.fillRect(0,yy,W,1);
  }
  function mapHit(cv,ev){
    const r=cv.getBoundingClientRect(); const px=(ev.clientX-r.left)*W/r.width, py=(ev.clientY-r.top)*H/r.height;
    let best=-1,bd=1e9; NODES.forEach((n,i)=>{ const d=Math.hypot(n[0]-px,n[1]-py); if(d<bd){bd=d;best=i;} });
    return bd<22? best : -1;
  }

  /* ---- sparkline of one good's price over the days visited (log scale, band shaded) ---- */
  function spark(cv,vals,lo,hi,cur){
    const w=cv.width,hh=cv.height; const x=cv.getContext('2d'); x.clearRect(0,0,w,hh);
    const pts=vals.map((v,i)=>v?[ (vals.length>1? i/(vals.length-1):1)*(w-4)+2, hh-2-(Math.log(Math.max(1,v))-Math.log(lo/5))/(Math.log(hi*5)-Math.log(lo/5))*(hh-4)]:null);
    // band shading
    const yLo=hh-2-(Math.log(lo)-Math.log(lo/5))/(Math.log(hi*5)-Math.log(lo/5))*(hh-4);
    const yHi=hh-2-(Math.log(hi)-Math.log(lo/5))/(Math.log(hi*5)-Math.log(lo/5))*(hh-4);
    x.fillStyle='rgba(255,255,255,.05)'; x.fillRect(0,yHi,w,yLo-yHi);
    x.strokeStyle=C.dim; x.lineWidth=1; x.beginPath(); let pen=false;
    pts.forEach(p=>{ if(!p){ pen=false; return; } if(!pen){ x.moveTo(p[0],p[1]); pen=true; } else x.lineTo(p[0],p[1]); });
    x.stroke();
    pts.forEach((p,i)=>{ if(!p) return; const v=vals[i]; x.fillStyle= v>hi?C.glow: v<lo?C.red: C.txt; x.fillRect(p[0]-1,p[1]-1,2,2); });
    if(cur){ const last=pts[pts.length-1]; if(last){ x.fillStyle= cur>hi?C.glow: cur<lo?C.red: C.amber; x.beginPath(); x.arc(last[0],last[1],2.2,0,Math.PI*2); x.fill(); } }
  }

  /* ---- the Task Force scene ---- */
  const FIG=['..dd..','..dd..','.dddd.','dddddd','d.dd.d','..dd..','..dd..','.d..d.','.d..d.'];
  function scene(cv,enc,t,opt){
    opt=opt||{}; const w=cv.width,hh=cv.height; const x=cv.getContext('2d');
    x.fillStyle='#07090c'; x.fillRect(0,0,w,hh);
    // road perspective
    x.fillStyle='#141920'; x.beginPath(); x.moveTo(0,hh); x.lineTo(w,hh); x.lineTo(w*0.62,hh*0.45); x.lineTo(w*0.38,hh*0.45); x.closePath(); x.fill();
    x.strokeStyle='#2a323d'; x.setLineDash([6,8]); x.lineDashOffset=-(t/40)%14; x.beginPath(); x.moveTo(w/2,hh*0.45); x.lineTo(w/2,hh); x.stroke(); x.setLineDash([]);
    // light bars
    if(!opt.calm){ const ph=Math.floor(t/220)%2; const g=x.createRadialGradient(ph?w*0.25:w*0.75,0,10,ph?w*0.25:w*0.75,0,w*0.7);
      g.addColorStop(0,ph?'rgba(255,60,60,.35)':'rgba(70,140,255,.35)'); g.addColorStop(1,'rgba(0,0,0,0)'); x.fillStyle=g; x.fillRect(0,0,w,hh); }
    // agents
    const n=Math.max(0,Math.min(8,enc.agents)); const sz=4;
    for(let i=0;i<n;i++){ const ax=w/2+(i-(n-1)/2)*34, ay=hh*0.46;
      FIG.forEach((r,j)=>{ for(let c=0;c<6;c++) if(r[c]==='d'){ x.fillStyle='#050608'; x.fillRect(ax+c*sz-12,ay+j*sz,sz,sz); } });
      x.fillStyle=C.amber; x.fillRect(ax-2,ay+14,3,3); // badge glint
      // flashlight cone
      x.fillStyle='rgba(255,255,255,.04)'; x.beginPath(); x.moveTo(ax,ay+8); x.lineTo(ax-40,hh); x.lineTo(ax+40,hh); x.closePath(); x.fill(); }
    // your car (bottom-left corner)
    x.fillStyle='#1c2229'; x.fillRect(14,hh-34,54,20); x.fillRect(24,hh-44,32,12);
    x.fillStyle=C.amber; x.fillRect(62,hh-30,6,5); x.fillStyle='#0b0d10'; x.fillRect(20,hh-16,10,8); x.fillRect(52,hh-16,10,8);
    if(opt.hit){ x.fillStyle='rgba(255,90,90,'+Math.max(0,0.5-opt.hit/600)+')'; x.fillRect(0,0,w,hh); }
  }


  /* ---- the big chart: one good's history, readable ---- */
  function chart(cv,s,i){
    const g=GOODS[i]; const w=cv.width,hh=cv.height; const x=cv.getContext('2d');
    x.fillStyle='#0b0d10'; x.fillRect(0,0,w,hh);
    const L=58,R=14,T=14,B=22; const pw=w-L-R, ph=hh-T-B;
    const hist=s.hist; const vals=hist.map(h=>h.prices[i]);
    const seen=vals.filter(v=>v>0); const paid=G.avgPaid(s,i);
    let lo=Math.min(g.lo,...seen,paid||g.lo)/1.25, hi=Math.max(g.hi,...seen,paid||g.hi)*1.25;
    const Y=v=>T+ph-(Math.log(v)-Math.log(lo))/(Math.log(hi)-Math.log(lo))*ph;
    const n=Math.max(2,hist.length); const X=k=>L+(hist.length>1? k/(hist.length-1):1)*pw;
    x.font='10px ui-monospace,Menlo,monospace'; x.textBaseline='middle';
    // everyday band
    x.fillStyle='rgba(159,232,112,.07)'; x.fillRect(L,Y(g.hi),pw,Y(g.lo)-Y(g.hi));
    x.strokeStyle='rgba(159,232,112,.35)'; x.setLineDash([3,4]); x.lineWidth=1;
    [[g.lo,'low'],[g.hi,'high']].forEach(([v,lab])=>{ x.beginPath(); x.moveTo(L,Y(v)); x.lineTo(L+pw,Y(v)); x.stroke();
      x.fillStyle=C.dim; x.textAlign='right'; x.fillText(fmtK(v),L-6,Y(v)); });
    // your average paid
    if(paid>0&&s.inv[i]>0){ x.strokeStyle=C.amber; x.setLineDash([2,3]); x.beginPath(); x.moveTo(L,Y(paid)); x.lineTo(L+pw,Y(paid)); x.stroke();
      x.fillStyle=C.amber; x.textAlign='right'; x.textBaseline='bottom'; x.fillText('paid '+fmtK(paid),L+pw-2,Y(paid)-2); x.textBaseline='middle'; }
    x.setLineDash([]);
    // the line
    x.strokeStyle=C.txt; x.lineWidth=1.5; x.beginPath(); let pen=false;
    vals.forEach((v,k)=>{ if(!v){ pen=false; return; } if(!pen){ x.moveTo(X(k),Y(v)); pen=true; } else x.lineTo(X(k),Y(v)); });
    x.stroke();
    // points + markers
    vals.forEach((v,k)=>{ const px=X(k);
      x.fillStyle=C.dim; x.textAlign='center'; x.textBaseline='top';
      if(hist.length<=16 || k%Math.ceil(hist.length/16)===0 || k===hist.length-1) x.fillText('d'+hist[k].day,px,T+ph+6);
      x.textBaseline='middle';
      if(!v){ x.fillStyle='#2a323d'; x.fillRect(px-1,T+ph-3,2,3); return; }
      const spike=v>g.hi, crash=v<g.lo;
      x.fillStyle= spike?C.glow: crash?C.red: C.txt; x.beginPath(); x.arc(px,Y(v),spike||crash?3.5:2.5,0,Math.PI*2); x.fill();
      if(spike||crash){ x.textAlign='center'; x.fillText(spike?'▲ '+fmtK(v):'▼ '+fmtK(v),px,Y(v)+(spike?-12:12)); } });
    // current price, labelled
    const cur=s.prices[i]; const lastK=hist.length-1;
    if(cur){ x.fillStyle=C.amber; x.beginPath(); x.arc(X(lastK),Y(cur),4,0,Math.PI*2); x.fill();
      x.textAlign='right'; x.textBaseline='bottom'; x.fillText('now '+fmt(cur),L+pw,T-2); }
    x.textAlign='left'; x.textBaseline='bottom'; x.fillStyle=C.txt; x.font='bold 11px ui-monospace,Menlo,monospace';
    x.fillText(g.name.toUpperCase()+'  /'+g.unit+'  ·  '+seen.length+' of '+hist.length+' stops',L,T-2);
    if(seen.length<2){ x.fillStyle=C.dim; x.font='10px ui-monospace,Menlo,monospace'; x.textAlign='center'; x.textBaseline='middle'; x.fillText('history fills in as you travel',L+pw/2,T+ph/2); }
  }

  /* ---- trunk gauge: one colored segment per good, in inventory ---- */
  const GCOL={coke:'#f2f4f7',her:'#b8865a',ket:'#7fb3e0',mol:'#ff6fb0',shr:'#f0e6c8',weed:'#5fc06a',xan:'#c9cfd8',add:'#ff9a3c'};
  function gauge(cv,s){
    const w=cv.width,hh=cv.height; const x=cv.getContext('2d'); x.clearRect(0,0,w,hh);
    x.fillStyle='#0b0d10'; x.fillRect(0,0,w,hh); let px=0;
    GOODS.forEach((g,i)=>{ const n=s.inv[i]; if(!n) return; const ww=n/s.trunk*w; x.fillStyle=GCOL[g.k]||'#fff'; x.fillRect(px,0,Math.max(1,ww-1),hh); px+=ww; });
    x.strokeStyle='#232a33'; x.strokeRect(0.5,0.5,w-1,hh-1);
  }
  function bar(cv,frac,col){ const w=cv.width,hh=cv.height; const x=cv.getContext('2d'); x.fillStyle='#0b0d10'; x.fillRect(0,0,w,hh); x.fillStyle=col; x.fillRect(0,0,w*clamp(frac,0,1),hh); x.strokeStyle='#232a33'; x.strokeRect(0.5,0.5,w-1,hh-1); }


  /* ---- generic char-grid → canvas (n×n cells, palette merged over PAL) ---- */
  const PPAL=Object.assign({}, PAL, { s:'#e8b48a', S:'#c98d63', n:'#8a5a3c', h:'#e6e8ec', H:'#3a2a20', u:'#b0b7c2',
              v:'#9b5de5', r:'#e0245e', e:'#d8f542', N:'#1f2a44', q:'#4a5260', x:'#111418', z:'#3d4656', a:'#ffb454', i:'#0b0d10' });
  function gridCanvas(rows,size,n){
    const cv=document.createElement('canvas'); cv.width=cv.height=size;
    const x=cv.getContext('2d'); const s=size/n;
    rows.forEach((r,j)=>{ for(let i=0;i<n;i++){ const ch=r[i]; if(ch&&ch!=='.'){ x.fillStyle=PPAL[ch]||'#fff'; x.fillRect(Math.floor(i*s),Math.floor(j*s),Math.ceil(s),Math.ceil(s)); } } });
    return cv;
  }

  /* ---- contact portraits: 16×16 ---- */
  const PORTRAITS={
    vic:[ '................','.....NNNNNN.....','....NNNNNNNN....','...NNNNNNNNNNNN.','.....ssssss.....','.....ssssss.....','.....sHssHs.....','.....ssssss.....',
          '.....suuuus.....','......ssss......','...eeNNNNNNee...','..eeeNNNNNNeee..','..eWWNNNNNNWWe..','..eeeNNNNNNeee..','..eeeNNNNNNeee..','................'],
    dee:[ '................','.....vvvvvv.....','....vvvvvvvv....','...vxggxxggxv...','...vvssssssvv...','...vvssssssvv...','...vvsHssHsvv...','...vvssssssvv...',
          '...vvssssssvv...','...vvvssssvvv...','...wwwxxxxwww...','..wwwwxxxxwwww..','..wwwwwxxwwwww..','..wwwwwxxwwwww..','..wwwwwxxwwwww..','................'],
    kev:[ '................','.....iiiiii.....','....izzzzzzi....','...izzzzzzzzi...','..bbzznnnnzzbb..','..bbznnnnnnzbb..','..bbznHnnHnzbb..','..bbznnnnnnzbb..',
          '...zznnnnnnzz...','...zzznnnnzzz...','....zzzwwzzz....','...zzzzwwzzzz...','..zzzzzwwzzzzz..','..zzzzzzzzzzzz..','..zzzzzzzzzzzz..','................'],
    tanya:['................','.....HHHHHH.....','....HHHHHHHH....','...HHHHHHHHHH...','...HHSSSSSSHH...','...HHSSSSSSHH...','...HHSHSSHSHH...','...HHSSSSSSHH...',
          '..yHHSSrrSSHHy..','..y.HHSSSSHH.y..','..yy.HSSSSH.yy..','....PPPwwPPP....','...PPPPwwPPPP...','...PPPPPPPPPP...','...PPPPPPPPPP...','................'],
    hale:['................','.....hhhhhh.....','....hhhhhhhh....','....hhsssshh....','....hssssssh....','.....ssssss.....','....xxxxxxxx....','....xxxssxxx....',
          '.....ssssss.....','.....ssssss.....','......ssss......','...qqqxxxxqqq...','..qqqqxxxxqqqq..','..qqqqqxxqqqqq..','..qqqqqqqqqqqq..','................'],
    lorna:['................','.....HHHHHH.....','....HHHHHHHH....','...HHHHHHHHHH...','...HHssssssHH...','...HHssssssHH...','...HHsHssHsHH...','...HHssssssHH...',
          '...HHssrrssHH...','...HHHssssHHH...','......ssss......','...NNNNwwNNNN...','..NNNNNwwNNNNN..','..NNNNNNwNNNNN..','..NNNNNNNNNNNN..','................'],
    paylater:['................','......zzzz......','.....zzzzzz.....','....zzzzzzzz....','....zziiiizz....','....zziiiizz....','....zziiiazz....','....zziiiizz....',
          '.....zziizz.....','....zzzzzzzzaa..','...zzzzzzzzaya..','..zzzzzzzzzaya..','..zzzzzzzzzaya..','..zzzzzzzzzaya..','..zzzzzzzzzaa...','................'],
    feds:['................','.....HHHHHH.....','....HHHHHHHH....','....HssssssH....','.....ssssss.....','....xxxxxxxx....','....xxxssxxx....','.....ssssss.....',
          '.....ssssss.w...','......ssss..w...','...NNNNwwNNNN...','..NNNNNwwNNNNN..','..NNNNNxxNNNNN..','..NNNNNxxNNNNN..','..NNNNNNNNNNNN..','................'],
  };
  const portraitCache={};
  function portrait(k,size){
    const key=k+'@'+size; if(portraitCache[key]) return portraitCache[key];
    const cv=gridCanvas(PORTRAITS[k]||PORTRAITS.paylater,size,16); portraitCache[key]=cv; return cv;
  }

  /* ---- job-type glyphs: 12×12 ---- */
  const JOBS={
    rush:  ['.......yy...','......yy....','.....yy.....','....yyyyyy..','.....yyyy...','......yy....','.....yy.....','....yy......','...yy.......','..yy........','............','............'],
    import:['............','............','.oooooooooo.','.oOoOoOoOoo.','.oOoOoOoOoo.','.oOoOoOoOoo.','.oOoOoOoOoo.','.oooooooooo.','..bbbbbbbb..','...bbbbbb...','............','............'],
    cook:  ['....wwww....','.....ww.....','.....ww.....','.....ww.....','....gggg....','...gggggg...','..gggggggg..','..ggllllgg..','.ggllllllgg.','.gglllLllgg.','.gggggggggg.','............'],
    case:  ['.....ww.....','.wwwwwwwwww.','.w...ww...w.','.w...ww...w.','.w...ww...w.','yyy..ww..yyy','.y...ww...y.','.....ww.....','.....ww.....','....wwww....','..wwwwwwww..','............'],
    story: ['.....yy.....','.....yy.....','....yyyy....','....yyyy....','yyyyyyyyyyyy','.yyyyyyyyyy.','..yyyyyyyy..','...yyyyyy...','...yyyyyy...','..yyy..yyy..','.yy......yy.','............'],
  };
  const jobCache={};
  function job(cv,kind){
    // (cv, kind) draws into cv; (kind, size) returns a cached canvas
    if(typeof cv==='string'){ const key=cv+'@'+kind; if(jobCache[key]) return jobCache[key]; const c=gridCanvas(JOBS[cv]||JOBS.story,kind,12); jobCache[key]=c; return c; }
    const size=Math.min(cv.width,cv.height); const key=kind+'@'+size; const src=jobCache[key]||(jobCache[key]=gridCanvas(JOBS[kind]||JOBS.story,size,12));
    const x=cv.getContext('2d'); x.clearRect(0,0,cv.width,cv.height); x.drawImage(src,(cv.width-size)/2,(cv.height-size)/2); return cv;
  }

  /* ---- heat meter: 0..100, cool→hot gradient, ticks, glow when hot ---- */
  function heat(cv,heat,t){
    const w=cv.width,hh=cv.height; const x=cv.getContext('2d'); const f=clamp((heat||0)/100,0,1);
    x.clearRect(0,0,w,hh); x.fillStyle='#0b0d10'; x.fillRect(0,0,w,hh);
    const g=x.createLinearGradient(0,0,w,0); g.addColorStop(0,C.glow); g.addColorStop(0.5,C.amber); g.addColorStop(1,C.red);
    if(f>0){
      if(heat>=70){ const pulse= t==null? 0.7 : 0.55+0.45*Math.sin(t/180); x.save(); x.shadowColor=C.red; x.shadowBlur=8+12*pulse; x.fillStyle=g; x.fillRect(1,1,(w-2)*f,hh-2); x.restore();
        x.fillStyle='rgba(255,107,107,'+(0.10+0.18*pulse)+')'; x.fillRect(0,0,w,hh); }
      x.fillStyle=g; x.fillRect(1,1,(w-2)*f,hh-2);
    }
    [25,50,75].forEach(p=>{ const tx=Math.round(1+(w-2)*p/100)+0.5; x.strokeStyle= f*100>=p?'rgba(11,13,16,.7)':'rgba(139,149,163,.5)'; x.lineWidth=1; x.beginPath(); x.moveTo(tx,1); x.lineTo(tx,hh-1); x.stroke(); });
    x.strokeStyle= heat>=70?'rgba(255,107,107,.6)':'#232a33'; x.strokeRect(0.5,0.5,w-1,hh-1);
  }

  /* ---- the Collectors scene: night lot under a bridge, sodium light ---- */
  const BIGFIG=['..dddd..','..dddd..','.dddddd.','dddddddd','dddddddd','dddddddd','d.dddd.d','d.dddd.d','..dddd..','..dddd..','.dd..dd.','.dd..dd.','.dd..dd.'];
  function collectors(cv,n,t,opt){
    opt=opt||{}; t=t||0; const w=cv.width,hh=cv.height; const x=cv.getContext('2d');
    x.fillStyle='#07090c'; x.fillRect(0,0,w,hh);
    // bridge underside + pillars
    x.fillStyle='#0f1318'; x.fillRect(0,0,w,hh*0.22);
    x.fillStyle='#121821'; [0.08,0.92].forEach(f=>x.fillRect(w*f-10,0,20,hh*0.62));
    x.fillStyle='#0b0f14'; x.fillRect(0,hh*0.22,w,3);
    // lot
    x.fillStyle='#141920'; x.fillRect(0,hh*0.6,w,hh*0.4);
    x.fillStyle='#1c2229'; for(let i=0;i<6;i++) x.fillRect(w*0.3+i*40,hh*0.62,3,hh*0.38); // bay lines
    // sodium streetlight cone from top center
    const flick= opt.calm? 1 : 0.9+0.1*Math.sin(t/90)*Math.sin(t/37);
    const lg=x.createLinearGradient(0,0,0,hh); lg.addColorStop(0,'rgba(255,190,80,'+(0.30*flick)+')'); lg.addColorStop(1,'rgba(255,190,80,0.02)');
    x.fillStyle=lg; x.beginPath(); x.moveTo(w/2-6,0); x.lineTo(w/2+6,0); x.lineTo(w*0.9,hh); x.lineTo(w*0.1,hh); x.closePath(); x.fill();
    x.fillStyle='rgba(255,210,120,'+(0.8*flick)+')'; x.fillRect(w/2-5,0,10,3);
    // pool of light on the ground
    const pg=x.createRadialGradient(w/2,hh*0.85,4,w/2,hh*0.85,w*0.32); pg.addColorStop(0,'rgba(255,190,80,'+(0.18*flick)+')'); pg.addColorStop(1,'rgba(255,190,80,0)');
    x.fillStyle=pg; x.fillRect(0,hh*0.5,w,hh*0.5);
    // your van (left, bigger than the scene() car)
    x.fillStyle='#1c2229'; x.fillRect(12,hh-48,78,30); x.fillRect(22,hh-62,50,16);
    x.fillStyle='#2a323d'; x.fillRect(26,hh-59,18,10); x.fillRect(48,hh-59,20,10); // windows
    x.fillStyle=C.amber; x.fillRect(84,hh-42,6,6); x.fillStyle='#0b0d10'; x.fillRect(20,hh-22,14,10); x.fillRect(66,hh-22,14,10);
    // collectors
    const k=Math.max(0,Math.min(6,n|0)); const sz=5;
    for(let i=0;i<k;i++){ const cx=w*0.62+(i-(k-1)/2)*52, cy=hh*0.30;
      // shadow on ground
      x.fillStyle='rgba(0,0,0,.45)'; x.beginPath(); x.ellipse(cx+4,cy+sz*13+2,22,5,0,0,Math.PI*2); x.fill();
      BIGFIG.forEach((r,j)=>{ for(let c=0;c<8;c++) if(r[c]==='d'){ x.fillStyle='#050608'; x.fillRect(cx+c*sz-16,cy+j*sz,sz,sz); } });
      // rim light from the sodium lamp
      x.fillStyle='rgba(255,190,80,'+(0.22*flick)+')'; x.fillRect(cx-6,cy,sz*4,2); x.fillRect(cx-16,cy+sz*3,2,sz*3);
      if(i===0){ // bat, resting on the shoulder
        x.save(); x.translate(cx+sz*6-16,cy+sz*5); x.rotate(-0.75); x.fillStyle='#8a6a40'; x.fillRect(-3,-44,7,46); x.fillStyle='#5a4426'; x.fillRect(-3,-2,7,8); x.restore(); }
      if(i===k-1){ // glowing phone in hand
        const px=cx-22, py=cy+sz*7; const gg=x.createRadialGradient(px+3,py+5,1,px+3,py+5,22); gg.addColorStop(0,'rgba(255,180,84,.45)'); gg.addColorStop(1,'rgba(255,180,84,0)');
        x.fillStyle=gg; x.fillRect(px-22,py-20,50,50); x.fillStyle='#111418'; x.fillRect(px-1,py-1,8,12); x.fillStyle=C.amber; x.fillRect(px,py,6,10); }
    }
    if(opt.hit){ x.fillStyle='rgba(255,90,90,'+Math.max(0,0.5-opt.hit/600)+')'; x.fillRect(0,0,w,hh); }
  }

  return { icon, map, mapHit, spark, chart, scene, gauge, bar, portrait, heat, collectors, job, GCOL, MAP_W:W, MAP_H:H };
})();
