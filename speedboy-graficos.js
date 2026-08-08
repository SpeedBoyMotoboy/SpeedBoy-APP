/* ═══════════════════════════════════════════════════════════════
   SpeedBoy — gráficos

   Cinco funções de canvas que estavam soltas no meio do index.html, entre
   o cálculo do fechamento e a geração do PDF: quem ia mexer na conta do
   dia tropeçava em 170 linhas de desenho, e quem ia mexer no desenho
   precisava achá-las em três pedaços separados do arquivo.

   Elas saíram inteiras porque não dependem do estado do app: recebem os
   dados já apurados por parâmetro e devolvem um canvas. As únicas coisas
   de fora que usam são fmtMoney e parseMoney, do speedboy-core.js.

   Duas são para a TELA (leem o canvas do documento por id) e três são
   OFFSCREEN, para virar imagem dentro do PDF do fechamento:

     drawDonut(storeMap)              → #donutChart, proporção por loja
     drawChart(flatStops)             → #barChart, entregas por dia
     drawChartOffscreen(stops, w, h)  → o mesmo gráfico, para o PDF
     drawCityChart(stops, w, h)       → distribuição por cidade, para o PDF
     drawTopStoresChart(sm, w, h)     → maiores lojas, para o PDF
     chartToImage(canvas)             → canvas → PNG base64

   Carregado por index.html. As funções ficam no escopo global de
   propósito: é de lá que renderFinance e genPDF as chamam, sem precisar
   de prefixo.
   ═══════════════════════════════════════════════════════════════ */

function drawDonut(storeMap){
  const canvas=document.getElementById('donutChart');
  if(!canvas)return;
  const entries=Object.entries(storeMap).filter(([,v])=>v.t>0);
  const ctx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const W=canvas.parentElement.clientWidth-28, H=200;
  if(W<=0)return;
  canvas.width=W*dpr;canvas.height=H*dpr;canvas.style.width=W+'px';canvas.style.height=H+'px';
  ctx.scale(dpr,dpr);ctx.clearRect(0,0,W,H);
  if(!entries.length){ctx.fillStyle='#555';ctx.font='500 13px Barlow';ctx.textAlign='center';ctx.fillText('Sem dados',W/2,H/2);return;}
  const total=entries.reduce((a,[,v])=>a+v.t,0);
  const colors=['#f5c518','#00e676','#3b82f6','#ff6b00','#e74c3c','#9b59b6','#1abc9c','#e67e22','#2ecc71','#e91e63'];
  const cx=W/2, cy=90, r=70, rInner=42;
  let angle=-Math.PI/2;
  entries.forEach(([name,v],i)=>{
    const slice=v.t/total*Math.PI*2;
    const color=colors[i%colors.length];
    ctx.beginPath();ctx.moveTo(cx+Math.cos(angle)*rInner,cy+Math.sin(angle)*rInner);
    ctx.arc(cx,cy,r,angle,angle+slice);
    const endOuter=angle+slice;
    ctx.lineTo(cx+Math.cos(endOuter)*rInner,cy+Math.sin(endOuter)*rInner);
    ctx.arc(cx,cy,rInner,angle+slice,angle,true);
    ctx.closePath();ctx.fillStyle=color;ctx.fill();
    angle+=slice;
  });
  // Center text
  ctx.fillStyle='#f0f0f0';ctx.font='800 16px "Barlow Condensed"';ctx.textAlign='center';ctx.fillText(fmtMoney(total),cx,cy-2);
  ctx.fillStyle='#888';ctx.font='500 10px Barlow';ctx.fillText('TOTAL',cx,cy+12);
  // Legend
  let ly=H-28;const lx=8;const colW=Math.floor(W/2);
  entries.forEach(([name,v],i)=>{
    const col=i%2, row=Math.floor(i/2);
    const x=lx+col*colW, y=ly+row*16;
    if(y>H-4)return;
    ctx.fillStyle=colors[i%colors.length];ctx.fillRect(x,y-6,8,8);
    ctx.fillStyle='#ccc';ctx.font='600 10px Barlow';ctx.textAlign='left';
    const pct=Math.round(v.t/total*100);
    ctx.fillText(name+' '+pct+'%',x+12,y+1);
  });
}


function drawChart(flatStops){
  const canvas=document.getElementById('chart');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1, W=canvas.parentElement.clientWidth-28, H=140;
  if(W<=0)return;
  canvas.width=W*dpr; canvas.height=H*dpr; canvas.style.width=W+'px'; canvas.style.height=H+'px';
  ctx.scale(dpr,dpr);
  const days=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const dateStr=d.toLocaleDateString('pt-BR');
    const lbl=d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    const dayStops=(flatStops||[]).filter(s=>s._effDate===dateStr);
    const rec=dayStops.filter(s=>s.paid).reduce((a,s)=>a+parseMoney(s.value),0);
    const pend=dayStops.filter(s=>!s.paid).reduce((a,s)=>a+parseMoney(s.value),0);
    days.push({lbl,v:rec+pend,rec,pend});
  }
  const mx=Math.max(...days.map(d=>d.v),1);
  const pL=6,pR=6,pT=10,pB=28,bw=Math.floor((W-pL-pR)/7)-4,bA=H-pT-pB;
  ctx.clearRect(0,0,W,H);
  days.forEach((d,i)=>{
    const x=pL+i*((W-pL-pR)/7)+2, isT=i===6;
    const bhRec=Math.max(0,d.rec/mx*bA), bhPend=Math.max(0,d.pend/mx*bA);
    const yRec=pT+bA-bhRec, yPend=yRec-bhPend;
    // Barra recebido (verde)
    if(bhRec>0){ctx.fillStyle=isT?'rgba(0,230,118,.9)':'rgba(0,230,118,.4)';ctx.beginPath();ctx.roundRect(x,yRec,bw,bhRec,isT?[0,0,4,4]:[0,0,3,3]);ctx.fill();}
    // Barra a receber (amarelo)
    if(bhPend>0){ctx.fillStyle=isT?'rgba(245,197,24,.9)':'rgba(245,197,24,.3)';ctx.beginPath();ctx.roundRect(x,yPend,bw,bhPend,isT?[4,4,0,0]:[3,3,0,0]);ctx.fill();}
    if(d.v>0){ctx.fillStyle=isT?'#f5c518':'#666';ctx.font=`${isT?600:500} 10px Barlow`;ctx.textAlign='center';ctx.fillText('R$'+d.v.toFixed(0),x+bw/2,(yPend||yRec)-3);}
    ctx.fillStyle=isT?'#f0f0f0':'#555';ctx.font=`${isT?700:500} 10px Barlow`;ctx.textAlign='center';ctx.fillText(d.lbl,x+bw/2,H-6);
  });
}

// Helper: draw 7-day bar chart to offscreen canvas for PDF
function drawChartOffscreen(flatStops,w,h){
  const canvas=document.createElement('canvas');
  const dpr=2;
  canvas.width=w*dpr; canvas.height=h*dpr;
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  const days=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const dateStr=d.toLocaleDateString('pt-BR');
    const lbl=d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    const dayStops=(flatStops||[]).filter(s=>s._effDate===dateStr);
    const rec=dayStops.filter(s=>s.paid).reduce((a,s)=>a+parseMoney(s.value),0);
    const pend=dayStops.filter(s=>!s.paid).reduce((a,s)=>a+parseMoney(s.value),0);
    days.push({lbl,v:rec+pend,rec,pend});
  }
  const mx=Math.max(...days.map(d=>d.v),1);
  const pL=6,pR=6,pT=10,pB=22,bw=Math.floor((w-pL-pR)/7)-4,bA=h-pT-pB;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#0e0e14';ctx.fillRect(0,0,w,h);
  days.forEach((d,i)=>{
    const x=pL+i*((w-pL-pR)/7)+2;
    const bhRec=Math.max(0,d.rec/mx*bA),bhPend=Math.max(0,d.pend/mx*bA);
    const yRec=pT+bA-bhRec,yPend=yRec-bhPend;
    if(bhRec>0){ctx.fillStyle='rgba(0,230,118,.7)';ctx.fillRect(x,yRec,bw,bhRec);}
    if(bhPend>0){ctx.fillStyle='rgba(245,197,24,.7)';ctx.fillRect(x,yPend,bw,bhPend);}
    if(d.v>0){ctx.fillStyle='#aaa';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.fillText('R$'+d.v.toFixed(0),x+bw/2,(yPend||yRec)-2);}
    ctx.fillStyle='#888';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText(d.lbl,x+bw/2,h-4);
  });
  return canvas;
}


// Helper: render chart to canvas and return base64 PNG
function chartToImage(canvas){
  try{ return canvas.toDataURL('image/png'); }catch(e){ return null; }
}

// Helper: draw city distribution chart on offscreen canvas
function drawCityChart(allStops, w, h){
  const canvas=document.createElement('canvas');
  canvas.width=w*2; canvas.height=h*2; canvas.style.width=w+'px'; canvas.style.height=h+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(2,2);
  const cityMap={};
  allStops.forEach(s=>{const city=cityName(resolveCityCode(s.city||s.cityId))||'Outro';if(!cityMap[city])cityMap[city]=0;cityMap[city]++;});
  const entries=Object.entries(cityMap).sort((a,b)=>b[1]-a[1]);
  const total=entries.reduce((a,[,v])=>a+v,0);
  if(!total){return null;}
  const colors=['#f5c518','#00e676','#3b82f6','#ff6b00','#e74c3c','#9b59b6'];
  let angle=-Math.PI/2;
  const cx=w/2,cy=h/2-10,r=Math.min(cx,cy)-20;
  if(r<=0){return null;}
  entries.forEach(([name,v],i)=>{
    const slice=v/total*Math.PI*2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,angle,angle+slice);ctx.closePath();
    ctx.fillStyle=colors[i%colors.length];ctx.fill();
    ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.stroke();
    angle+=slice;
  });
  // Legend
  let lx=4,ly=h-entries.length*14-4;
  entries.forEach(([name,v],i)=>{
    ctx.fillStyle=colors[i%colors.length];ctx.fillRect(lx,ly+(i*14),10,10);
    ctx.fillStyle='#ccc';ctx.font='600 9px sans-serif';ctx.textAlign='left';
    ctx.fillText(`${name}: ${v} (${Math.round(v/total*100)}%)`,lx+14,ly+(i*14)+9);
  });
  return canvas;
}

// Helper: draw top stores chart on offscreen canvas
function drawTopStoresChart(sm, w, h){
  const canvas=document.createElement('canvas');
  canvas.width=w*2; canvas.height=h*2; canvas.style.width=w+'px'; canvas.style.height=h+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(2,2);
  const entries=Object.entries(sm).sort((a,b)=>b[1].t-a[1].t).slice(0,6);
  if(!entries.length)return null;
  const mx=entries[0][1].t||1;
  const bh=Math.floor((h-20)/entries.length)-6;
  const lw=80,barArea=w-lw-18;
  ctx.clearRect(0,0,w,h);
  entries.forEach(([name,v],i)=>{
    const y=10+i*(bh+6);
    const bwFill=Math.max(4,v.t/mx*barArea);
    ctx.fillStyle='rgba(245,197,24,.25)';ctx.fillRect(lw,y,barArea,bh);
    ctx.fillStyle='#f5c518';ctx.fillRect(lw,y,bwFill,bh);
    ctx.fillStyle='#ccc';ctx.font='600 9px sans-serif';ctx.textAlign='right';
    ctx.fillText(name.substring(0,14),lw-4,y+bh/2+4);
    ctx.fillStyle='#000';ctx.font='700 9px sans-serif';ctx.textAlign='left';
    ctx.fillText(fmtMoney(v.t),lw+bwFill+3,y+bh/2+4);
  });
  return canvas;
}
