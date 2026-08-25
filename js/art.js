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

  return { icon, map, mapHit, spark, chart, scene, gauge, bar, GCOL, MAP_W:W, MAP_H:H };
})();
