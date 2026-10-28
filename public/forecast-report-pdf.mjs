// A compact summary by default, with complete ledgers available on request.
// Every number uses the full snapshot, regardless of screen pagination or scrubbing.
const W=612,H=792,M=42,BOTTOM=735,CW=W-2*M;
let rgb,C;
const color=hex=>rgb(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255);
function palette(){return {navy:color('#183343'),ink:color('#263b47'),muted:color('#62717b'),copper:color('#ae6a42'),gold:color('#e6b58b'),paper:color('#faf8f3'),line:color('#dce2e3'),soft:color('#edf2f4'),green:color('#386c56'),greenBg:color('#eaf3ec'),red:color('#a33d44'),redBg:color('#f9ebea'),white:rgb(1,1,1),gray:color('#9baab4')};}
const money=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100):'Unavailable';
const shortMoney=n=>{const magnitude=Math.abs(n),unit=magnitude>=1e14?[1e14,'t']:magnitude>=1e11?[1e11,'b']:magnitude>=1e8?[1e8,'m']:magnitude>=1e6?[1e5,'k']:null;return unit?(n<0?'-$':'$')+(magnitude/unit[0]).toFixed(1)+unit[1]:new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n/100);};
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?new Date(s+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}):String(s||'Not set');
const smallDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?new Date(s+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):String(s||'');
const month=s=>/^\d{4}-\d{2}$/.test(s||'')?new Date(s+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}):String(s||'');
const stamp=s=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}):String(s||'');};
const safe=n=>Number.isSafeInteger(n);

class Pages{
 constructor(doc,fonts,report){this.doc=doc;this.fonts=fonts;this.report=report;this.pages=[];this.y=0;this.page=null;this.sectionName='Simulation report';this.simplified=false;this.encoded=new Map();}
 clean(value){
  const input=String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\u00a0/g,' ').replace(/[\u200b-\u200f\ufeff\ufe0e\ufe0f]/g,'');
  return Array.from(input).map(ch=>{
   if(ch==='\n'||ch==='\t')return ch;
   if(this.encoded.has(ch))return this.encoded.get(ch);
   let result=ch;try{this.fonts.body.encodeText(ch);}catch{
    const ascii=ch.normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
    try{this.fonts.body.encodeText(ascii);result=ascii;}catch{result='?';}
    this.simplified=true;
   }
   this.encoded.set(ch,result);return result;
  }).join('');
 }
 text(value,x,top,{size=10,font='body',fill=C.ink,width,align='left'}={}){
  const text=this.clean(value).replace(/\s*\n\s*/g,' '),face=this.fonts[font];
  if(width&&align!=='left')x+=Math.max(0,width-face.widthOfTextAtSize(text,size))*(align==='right'?1:.5);
  this.page.drawText(text,{x,y:H-top-size,font:face,size,color:fill});
 }
 fit(value,width,size=20,font='bold',min=10){const text=this.clean(value);while(size>min&&this.fonts[font].widthOfTextAtSize(text,size)>width)size-=.25;return size;}
 lines(value,width,size=9.5,font='body'){
  width=Math.max(1,width-2);
  const face=this.fonts[font],paragraphs=this.clean(value).replace(/\t/g,' ').split('\n'),result=[];
  for(const paragraph of paragraphs){
   let line='';const words=paragraph.trim().split(/\s+/).filter(Boolean);
   if(!words.length){result.push('');continue;}
   for(const word of words){
    if(face.widthOfTextAtSize((line?line+' ':'')+word,size)<=width){line+=(line?' ':'')+word;continue;}
    if(line){result.push(line);line='';}
    if(face.widthOfTextAtSize(word,size)<=width){line=word;continue;}
    // Break a very long identifier instead of letting it overlap a money column.
    for(const ch of Array.from(word)){if(line&&face.widthOfTextAtSize(line+ch,size)>width){result.push(line);line='';}line+=ch;}
   }
   if(line)result.push(line);
  }
  return result;
 }
 rect(x,top,width,height,fill=C.paper,border){this.page.drawRectangle({x,y:H-top-height,width,height,color:fill,...(border?{borderColor:border,borderWidth:.6}:{})});}
 line(x1,y1,x2,y2,fill=C.line,thickness=.7,dashArray){this.page.drawLine({start:{x:x1,y:H-y1},end:{x:x2,y:H-y2},color:fill,thickness,...(dashArray?{dashArray}:{})});}
 circle(x,top,size,fill){this.page.drawCircle({x,y:H-top,size,color:fill});}
 pageStart(section=this.sectionName,{cover=false}={}){
  this.sectionName=section;this.page=this.doc.addPage([W,H]);this.pages.push(this.page);
  if(!cover){
   this.text('BEARDEN',M,25,{size:10,font:'bold',fill:C.navy});
   this.text(section,M+92,26,{size:8.5,fill:C.muted,width:CW-92,align:'right'});
   this.line(M,46,W-M,46,C.line);this.y=64;
  }else this.y=M;
 }
 ensure(height,section=this.sectionName){if(!this.page||this.y+height>BOTTOM)this.pageStart(section);}
 heading(title,{description,newPage=false}={}){
  const titleLines=this.lines(title,CW,15,'bold');
  const needed=titleLines.length*19+12+(description?this.lines(description,CW,9.5).length*13+6:0)+45;
  if(newPage)this.pageStart(title);else this.ensure(needed,title);
  this.sectionName=title;
  for(const line of titleLines){this.text(line,M,this.y,{size:15,font:'bold',fill:C.navy});this.y+=19;}
  this.y+=7;if(description)this.paragraph(description,{fill:C.muted});
 }
 paragraph(value,{size=9.5,lineHeight=13,fill=C.ink,x=M,width=CW,font='body',gap=6}={}){
  const lines=this.lines(value,width,size,font);
  this.ensure(Math.min(lines.length*lineHeight,140));
  for(const line of lines){this.ensure(lineHeight);this.text(line,x,this.y,{size,font,fill});this.y+=lineHeight;}
  this.y+=gap;
 }
 callout(title,body,{negative=false}={}){
  const titleLines=this.lines(title,CW-28,11,'bold'),bodyLines=this.lines(body,CW-28,9.2);
  const height=20+titleLines.length*15+bodyLines.length*13;
  if(height>500){this.paragraph(title,{font:'bold',fill:negative?C.red:C.navy});this.paragraph(body);return;}
  this.ensure(height+8);this.rect(M,this.y,CW,height,negative?C.redBg:C.soft);
  let top=this.y+9;for(const line of titleLines){this.text(line,M+14,top,{size:11,font:'bold',fill:negative?C.red:C.navy});top+=15;}
  top+=4;for(const line of bodyLines){this.text(line,M+14,top,{size:9.2,fill:C.ink});top+=13;}
  this.y+=height+8;
 }
 metrics(items,{columns=3}={}){
  const gap=10,width=(CW-gap*(columns-1))/columns;
  for(let i=0;i<items.length;i+=columns){
   this.ensure(60);const group=items.slice(i,i+columns);
   group.forEach((item,j)=>{
    const x=M+j*(width+gap),value=typeof item.value==='number'?money(item.value):item.value;
    this.rect(x,this.y,width,52,item.negative?C.redBg:C.paper);
    this.text(item.label.toUpperCase(),x+12,this.y+10,{size:7.1,font:'bold',fill:C.muted});
    this.text(value,x+12,this.y+25,{size:this.fit(value,width-24,17,'bold',9),font:'bold',fill:item.negative?C.red:C.navy});
    if(item.note)this.text(item.note,x+12,this.y+43,{size:7.3,fill:C.muted});
   });this.y+=60;
  }
 }
 table(columns,rows,{title,empty='No entries in this period.',fontSize=8.5,lineHeight=11}={}){
  if(!rows.length){this.paragraph(empty,{fill:C.muted});return;}
  const cellValue=(row,col)=>typeof col.value==='function'?col.value(row):row[col.key];
  const cellSize=(row,col)=>col.money?Math.min(fontSize,...String(cellValue(row,col)??'').split('\n').map(value=>this.fit(value,col.width-17,fontSize,col.bold?'bold':'body',6))):fontSize;
  const rowLines=row=>columns.map(col=>this.lines(cellValue(row,col),col.width-14,cellSize(row,col),col.bold?'bold':'body'));
  const head=(minimumRow=20)=>{
   this.ensure(26+(title?18:0)+Math.min(540,minimumRow),title||this.sectionName);
   if(title){this.text(title,M,this.y,{size:10.5,font:'bold',fill:C.navy});this.y+=18;}
   this.rect(M,this.y,CW,26,C.navy);
   let x=M;for(const col of columns){const lines=this.lines(col.label,col.width-14,7.4,'bold');lines.slice(0,2).forEach((line,i)=>this.text(line,x+7,this.y+7+i*9,{size:7.4,font:'bold',fill:C.white,width:col.width-14,align:col.align||'left'}));x+=col.width;}
   this.y+=26;
  };
  head(Math.max(20,Math.max(...rowLines(rows[0]).map(c=>c.length))*lineHeight+8));
  rows.forEach((row,rowIndex)=>{
   let cells=rowLines(row);const sizes=columns.map(col=>cellSize(row,col));
   while(cells.some(c=>c.length)){
    const longest=Math.max(...cells.map(c=>c.length)),rowHeight=Math.max(20,longest*lineHeight+8);
    if(this.y+Math.min(rowHeight,70)>BOTTOM){this.pageStart(this.sectionName);head(rowHeight);}
    if(rowHeight>BOTTOM-this.y&&rowHeight<540){this.pageStart(this.sectionName);head(rowHeight);}
    const take=Math.min(longest,Math.max(1,Math.floor((BOTTOM-this.y-8)/lineHeight))),height=Math.max(20,take*lineHeight+8);
    this.rect(M,this.y,CW,height,row.negative?C.redBg:rowIndex%2?C.paper:C.white);
    let x=M;
    columns.forEach((col,j)=>{
     const fill=col.color?col.color(row):row.negative&&col.money?C.red:C.ink;
     cells[j].slice(0,take).forEach((line,k)=>this.text(line,x+7,this.y+4+k*lineHeight,{size:sizes[j],font:col.bold?'bold':'body',fill,width:col.width-14,align:col.align||'left'}));
     cells[j]=cells[j].slice(take);x+=col.width;
    });
    this.y+=height;this.line(M,this.y,W-M,this.y,C.line,.45);
    if(cells.some(c=>c.length)){this.pageStart(this.sectionName);head();}
   }
  });this.y+=10;
 }
 footer(){
  const total=this.pages.length;this.pages.forEach((page,i)=>{
   this.page=page;this.line(M,751,W-M,751,C.line,.6);
   this.text('BearDen / Simulation snapshot / Created '+stamp(this.report.createdAt),M,761,{size:7.5,fill:C.muted});
   this.text(`${i+1} / ${total}`,W-M-70,760,{size:8,font:'bold',fill:C.navy,width:70,align:'right'});
  });
 }
}

function seriesPoints(summary,ledger,start,end){
 if(!safe(summary?.opening))return [];
 const points=[{date:start,balance:summary.opening}];
 for(const row of ledger||[])if(safe(row.balance))points.push({date:row.date,balance:row.balance});
 if(points.at(-1).date!==end)points.push({date:end,balance:points.at(-1).balance});
 return points;
}

function balanceChart(p,{start,end,series,height=222,title='Projected account balance',buffer=null}){
 p.ensure(height+51);p.text(title,M,p.y,{size:11,font:'bold',fill:C.navy});p.y+=23;
 const top=p.y,plot={left:M+58,top:top+24,width:CW-76,height:height-66},bottom=plot.top+plot.height;
 p.rect(M,top,CW,height,C.paper);
 const all=series.flatMap(s=>s.points||[]).filter(v=>safe(v.balance));
 if(!all.length){p.text('A usable account balance is needed to draw this forecast.',M+18,top+75,{size:10,fill:C.muted});p.y+=height+14;return;}
 let low=0,high=100;for(const point of all){low=Math.min(low,point.balance);high=Math.max(high,point.balance);}if(safe(buffer))high=Math.max(high,buffer);
 const padding=(high-low)*.075;low=low<0?low-padding:0;high+=padding;
 const span=high-low||1,first=Date.parse(start+'T12:00:00Z'),last=Date.parse(end+'T12:00:00Z'),timeSpan=Math.max(86400000,last-first);
 const x=s=>plot.left+Math.max(0,Math.min(1,(Date.parse(s+'T12:00:00Z')-first)/timeSpan))*plot.width;
 const y=n=>bottom-(n-low)/span*plot.height;
 for(let i=0;i<=4;i++){
  const n=low+(high-low)*i/4,py=y(n);p.line(plot.left,py,plot.left+plot.width,py,C.line,.5);
  p.text(shortMoney(Math.round(n)),M+3,py-4,{size:7.3,fill:C.muted,width:48,align:'right'});
 }
 p.line(plot.left,y(0),plot.left+plot.width,y(0),C.muted,.8,[3,3]);
 if(safe(buffer)&&buffer>0)p.line(plot.left,y(buffer),plot.left+plot.width,y(buffer),C.copper,.8,[2,3]);
 for(const item of series){
  const points=item.points||[];let previous=points[0];if(!previous)continue;
  for(const point of points.slice(1)){
   p.line(x(previous.date),y(previous.balance),x(point.date),y(previous.balance),previous.balance<0?C.red:item.color,item.secondary?1:1.7,item.secondary?[3,2]:undefined);
   p.line(x(point.date),y(previous.balance),x(point.date),y(point.balance),point.balance<0||previous.balance<0?C.red:item.color,item.secondary?1:1.7,item.secondary?[3,2]:undefined);
   previous=point;
  }
  if(!item.secondary){const minimum=points.reduce((a,b)=>a.balance<=b.balance?a:b);p.circle(x(minimum.date),y(minimum.balance),3,minimum.balance<0?C.red:item.color);}
 }
 p.text(smallDate(start),plot.left,bottom+10,{size:7.8,fill:C.muted});
 p.text(smallDate(end),plot.left+plot.width-66,bottom+10,{size:7.8,fill:C.muted,width:66,align:'right'});
 let legendX=M+14;for(const item of series){p.line(legendX,top+height-10,legendX+13,top+height-10,item.color,2,item.secondary?[3,2]:undefined);p.text(item.label,legendX+18,top+height-15,{size:7.5,fill:C.muted});legendX+=p.fonts.body.widthOfTextAtSize(p.clean(item.label),7.5)+37;}
 if(safe(buffer)&&buffer>0){p.line(legendX,top+height-10,legendX+13,top+height-10,C.copper,1,[2,3]);p.text('Cushion',legendX+18,top+height-15,{size:7.5,fill:C.muted});}
 p.y+=height+13;
}

function monthlyTable(p,rows){
 p.table([
  {label:'Month',width:69,value:r=>month(r.month)},
  {label:'Money in',width:91,value:r=>money(r.income),align:'right',money:true},
  {label:'Money out',width:91,value:r=>money(r.outgoing),align:'right',money:true},
  {label:'Net change',width:89,value:r=>money(r.net),align:'right',money:true},
  {label:'Month end',width:96,value:r=>money(r.closing),align:'right',money:true,bold:true},
  {label:'Lowest',width:92,value:r=>money(r.low),align:'right',money:true,color:r=>r.low<0?C.red:C.ink},
 ],rows);
}

function shortfalls(p,rows,{title='Negative balance periods'}={}){
 if(!rows.length)return;
 p.table([
  {label:'Starts',width:82,value:r=>date(r.start)},
  {label:'Recovers',width:82,value:r=>r.end?date(r.end):'Not by end'},
  {label:'Trigger',width:164,value:r=>r.cause||'Opening balance'},
  {label:'Lowest balance',width:100,value:r=>money(r.low),align:'right',money:true,bold:true},
  {label:'Lowest on',width:100,value:r=>date(r.lowDate)},
 ],rows.map(r=>({...r,negative:true})),{title});
}

function ledgerTable(p,rows,{title='Complete forecast ledger'}={}){
 p.table([
  {label:'Date',width:72,value:r=>date(r.date)},
  {label:'Activity / explanation',width:234,value:r=>r.name+(r.detail?'\n'+r.detail:'')},
  {label:'In',width:74,value:r=>r.incoming?money(r.incoming):'-',align:'right',money:true},
  {label:'Out',width:74,value:r=>r.outgoing?money(r.outgoing):'-',align:'right',money:true},
  {label:'Balance',width:74,value:r=>money(r.balance),align:'right',money:true,bold:true},
 ],rows.map(r=>({...r,negative:safe(r.balance)&&r.balance<0})),{title,fontSize:8.5,lineHeight:11});
}

function overview(p,report){
 const s=report.summary;
 p.pageStart('Forecast summary');
 p.heading(report.title||'Your financial forecast');
 p.paragraph(report.accountName+' | '+date(report.start)+' - '+date(report.end),{font:'bold',fill:C.navy});
 p.paragraph(report.debtLabel,{size:8.5,fill:C.muted});
 p.metrics([
  {label:'Starting balance',value:money(s.opening)},
  {label:'Money in',value:money(s.income)},
  {label:'Money out',value:money(s.outgoing)},
  {label:'Ending balance',value:money(s.closing),negative:s.closing<0},
 ],{columns:4});
 const quality=(report.assumptions||[]).find(a=>a.label==='Balance quality');
 if(quality)p.callout('Refresh the bank balance',quality.value,{negative:true});
 if(!safe(s.opening))p.callout('Account balance unavailable','Scheduled money in and out are shown; balances and shortfalls cannot be confirmed.');
 else p.callout('Lowest balance: '+money(s.low)+' on '+date(s.lowDate),s.firstNegative
  ?'First negative: '+money(s.firstNegative.balance)+' on '+date(s.firstNegative.date)+' after '+s.firstNegative.name+'.'
  :'No negative balance projected. Starting balance + money in - money out = ending balance.',{negative:s.low<0});
 balanceChart(p,{start:report.start,end:report.end,series:[{label:'Current plan',color:C.navy,points:seriesPoints(s,report.ledger,report.start,report.end)}],height:140});
 monthlyTable(p,report.monthly||[]);
 shortfalls(p,report.shortfalls||[]);
 if((report.paychecks||[]).length){
  const totals=report.paychecks.reduce((sum,row)=>({income:sum.income+row.income,fixedBills:sum.fixedBills+row.fixedBills,otherAllocations:sum.otherAllocations+row.otherAllocations,remaining:sum.remaining+row.remaining}),{income:0,fixedBills:0,otherAllocations:0,remaining:0});
  p.table([
   {label:'Take-home',width:132,value:r=>money(r.income),align:'right',money:true},
   {label:'Fixed Bills',width:132,value:r=>money(r.fixedBills),align:'right',money:true},
   {label:'Other payments',width:132,value:r=>money(r.otherAllocations),align:'right',money:true},
   {label:'Left over',width:132,value:r=>money(r.remaining),align:'right',money:true,bold:true},
  ],[totals],{title:'Paycheck totals for this period ('+report.paychecks.length+' checks)'});
 }
 p.paragraph(report.scope==='personal'
  ?'Take-home pay is after payroll deductions. Fixed Bills and other planned payments are deducted once; unspent personal allowances remain available.'
  :'This forecast includes only the bills account, its contributions and assigned bills.',{size:8.5,fill:C.muted});
 const method=(report.assumptions||[]).find(a=>a.label==='Saved payoff method');
 const retrieved=(report.assumptions||[]).find(a=>a.label==='Bank balance retrieved');
 p.paragraph('Balances include same-day lows. Future bill amounts are estimates.'+(method?' Payoff method: '+method.value+'.':'')+(retrieved?' Bank balance retrieved: '+(retrieved.value==='Timestamp unavailable'?'unknown':stamp(retrieved.value))+'.':''),{size:8,fill:C.muted});
}

function reclamation(p,report){
 const r=report.reclamation||{status:'unavailable',reason:'Contribution reclamation is not configured.'};
 if(r.status!=='ready'||!r.baseline||!r.projected){
  p.paragraph('Reclamation unavailable: '+(r.reason||'Set up shared bills and contribution schedules.'),{size:8.5,fill:C.muted});return;
 }
 // Keep the heading and main figures together, but use spare space on an
 // overflow page instead of forcing another mostly empty page.
 p.ensure(190,'Contribution reclamation');
 p.heading('Contribution reclamation');
 p.paragraph('Shared bills account | '+date(r.start)+' - '+date(r.end)+'. Future bills checked through '+date(r.checkedThrough)+'.',{size:9,fill:C.muted});
 p.metrics([
  {label:'Proposed reclaim',value:money(r.totals.total)},
  {label:'Extra funding needed',value:money(r.funding.totalExtra)},
  {label:'Net returned',value:money(r.totals.net),negative:r.totals.net<0},
 ]);
 const contributionText=(r.contributions||[]).map(c=>(c.person==='mine'?'Yours':'Spouse')+': '+money(c.amount)+' '+({biweekly:'every two weeks',weekly:'weekly',monthly:'monthly'}[c.repeat]||c.repeat));
 p.paragraph(contributionText.join(' | ')+'. Cushion: '+money(r.buffer)+'.',{size:9});
 p.paragraph('Only third biweekly paychecks qualify, up to each person’s contribution. Each reclaim accounts for later bills and earlier withdrawals. Existing dips below the cushion can remain.',{size:9});
 const before=r.baseline.summary,after=r.projected.summary,gaps=r.baseline.shortfalls||[];
 p.paragraph(gaps.length
  ?gaps.length+' negative period'+(gaps.length===1?'':'s')+' already exist before reclaiming. First: '+money(before.firstNegative.balance)+' on '+date(before.firstNegative.date)+'. Extra deposits below address those original gaps.'
  :'No negative balance is projected before reclaiming.',{size:9,fill:gaps.length?C.red:C.ink});
 p.paragraph('Lowest before: '+money(before.low)+' on '+date(before.lowDate)+'. Lowest with deposits and reclaims: '+money(after.low)+' on '+date(after.lowDate)+'.',{size:9,font:'bold',fill:after.low<0?C.red:C.navy});
 if(r.totals.conditionalNow)p.callout('Today’s funding must clear first','The audit includes the original bank shortage. After today’s required funding, the calculator’s lowest balance is '+money(r.totals.lowestAfter)+'.',{negative:true});
 if(r.totals.net<0)p.paragraph('This plan needs more extra funding than it returns.',{font:'bold',fill:C.red});
 const deposits=[
  ...(r.funding.pending||[]).map(d=>({...d,detail:'Saved - '+({personal:'personal checking',other:'spouse or other funds',unassigned:'source unassigned'}[d.source]||'source unassigned')})),
  ...(r.funding.required||[]).map(d=>({...d,detail:'New - source unassigned. '+d.reason+' (gap '+date(d.neededBy)+')'})),
 ].sort((a,b)=>a.date.localeCompare(b.date));
 if(deposits.length){
  p.table([
   {label:'Deposit by',width:90,value:r=>date(r.date)},
   {label:'Source / reason',width:318,key:'detail'},
   {label:'Amount',width:120,value:r=>money(r.amount),align:'right',money:true,bold:true},
  ],deposits,{title:'Extra deposits required before reclaiming'});
  p.paragraph('Saved, not received: '+money(r.funding.totalPending)+'. Newly proposed: '+money(r.funding.totalRequired)+'. New deposits have no assigned source and are not deducted from personal checking in this simulation.',{size:8.5,fill:C.muted});
 }
 p.table([
  {label:'Reclaim date',width:90,value:r=>date(r.date)},
  {label:'Person / third payday',width:198,value:r=>(r.person==='mine'?'Yours':'Spouse')+' - '+date(r.contributionDate)},
  {label:'Take back',width:112,value:r=>money(r.amount),align:'right',money:true},
  {label:'Bills balance after',width:128,value:r=>money(r.balanceAfter),align:'right',money:true,bold:true},
 ],r.schedule||[],{title:'When you could take contributions back',empty:'No contributions can be reclaimed during this period.'});
 p.paragraph('Your total: '+money(r.totals.totalMine)+'. Spouse total: '+money(r.totals.totalSpouse)+'. Net returned = proposed reclaim - saved and new extra funding.',{size:9,font:'bold'});
 if((r.projected.shortfalls||[]).length)shortfalls(p,r.projected.shortfalls,{title:'Negative periods remaining in the proposal'});
 p.paragraph('One combined plan: take each amount once, after that day’s bills and deposits clear. Returned contributions are not new income. Exporting does not move money or save deposits.',{size:8.5,fill:C.muted});
}

function detailedLedgers(p,report){
 const allocations=(report.paychecks||[]).flatMap(pay=>pay.items.map(item=>({date:pay.date,...item})));
 if(allocations.length){
  p.heading('Paycheck allocations',{newPage:true});
  p.table([
   {label:'Payday',width:90,value:r=>date(r.date)},
   {label:'Planned payment',width:310,key:'label'},
   {label:'Amount',width:128,value:r=>money(r.amount),align:'right',money:true},
  ],allocations);
 }
 p.heading('Full forecast ledger',{newPage:true,description:date(report.start)+' - '+date(report.end)+' | '+report.ledger.length+' events. Starting balance: '+money(report.summary.opening)+'.'});
 ledgerTable(p,report.ledger);
 p.paragraph('Ending balance: '+money(report.summary.closing)+'.',{font:'bold',fill:C.navy});
 const r=report.reclamation;
 if(r?.status==='ready'&&r.projected){
  p.heading('Full reclamation audit ledger',{newPage:true,description:date(r.start)+' - '+date(r.checkedThrough)+' | '+r.projected.ledger.length+' events. Starting bank balance: '+money(r.projected.summary.opening)+'.'});
  p.paragraph('Includes all scheduled flows, proposed extra deposits and reclaims. Today’s deposits are separate entries; the opening balance includes any original shortage. Negative balances are shaded red.',{size:9,fill:C.muted});
  ledgerTable(p,r.projected.ledger,{title:'Proposed scenario'});
  p.paragraph('Ending balance: '+money(r.projected.summary.closing)+'. Lowest balance: '+money(r.projected.summary.low)+' on '+date(r.projected.summary.lowDate)+'.',{font:'bold',fill:C.navy});
 }
}

export async function renderForecastPdf(report,{retry=0,includeLedgers=false}={}){
 if(!report||!report.summary||!Array.isArray(report.ledger))throw new Error('The report snapshot is incomplete. Generate it again.');
 const lib=await import('./vendor/pdf-lib.mjs?v=1.17.1'+(retry?'&retry='+retry:''));
 const {PDFDocument,StandardFonts}=lib;rgb=lib.rgb;C=palette();
 const doc=await PDFDocument.create();
 const fonts={body:await doc.embedFont(StandardFonts.Helvetica),bold:await doc.embedFont(StandardFonts.HelveticaBold)};
 const p=new Pages(doc,fonts,report);
 doc.setTitle(p.clean(report.title||'BearDen simulation report'));doc.setAuthor('BearDen');doc.setCreator('BearDen forecast report');doc.setProducer('BearDen');doc.setSubject('Forecast, cash flow, negative balances and contribution reclamation');
 doc.setKeywords(['BearDen','forecast','simulation','household','ledger']);
 const created=new Date(report.createdAt);if(Number.isFinite(created.getTime())){doc.setCreationDate(created);doc.setModificationDate(created);}
 overview(p,report);reclamation(p,report);
 if(includeLedgers)detailedLedgers(p,report);
 p.footer();
 const bytes=await doc.save();
 const filename=String(report.filename||`bearden-${report.scope||'forecast'}-${report.start}-to-${report.end}.pdf`).replace(/[^a-zA-Z0-9._-]/g,'-');
 return {bytes,pageCount:doc.getPageCount(),filename:filename.replace(/\.pdf$/i,includeLedgers?'-detailed.pdf':'-summary.pdf')};
}
