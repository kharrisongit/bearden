// A vector PDF built entirely on the device. Every table comes from the report
// snapshot; screen pagination and chart scrubbing never shorten the export.
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
 heading(title,{eyebrow,description,newPage=false}={}){
  const titleLines=this.lines(title,CW,25,'display');
  const needed=(eyebrow?19:0)+titleLines.length*29+14+(description?this.lines(description,CW,9.5).length*14+8:0)+92;
  if(newPage)this.pageStart(title);else this.ensure(needed,title);
  this.sectionName=title;
  if(eyebrow){this.text(eyebrow.toUpperCase(),M,this.y,{size:8.2,font:'bold',fill:C.copper});this.y+=19;}
  for(const line of titleLines){this.text(line,M,this.y,{size:25,font:'display',fill:C.navy});this.y+=29;}
  this.y+=7;if(description)this.paragraph(description,{fill:C.muted});this.y+=7;
 }
 paragraph(value,{size=9.5,lineHeight=14,fill=C.ink,x=M,width=CW,font='body',gap=8}={}){
  const lines=this.lines(value,width,size,font);
  this.ensure(Math.min(lines.length*lineHeight,140));
  for(const line of lines){this.ensure(lineHeight);this.text(line,x,this.y,{size,font,fill});this.y+=lineHeight;}
  this.y+=gap;
 }
 callout(title,body,{negative=false}={}){
  const titleLines=this.lines(title,CW-28,11,'bold'),bodyLines=this.lines(body,CW-28,9.2);
  const height=26+titleLines.length*15+bodyLines.length*13;
  if(height>500){this.paragraph(title,{font:'bold',fill:negative?C.red:C.navy});this.paragraph(body);return;}
  this.ensure(height+12);this.rect(M,this.y,CW,height,negative?C.redBg:C.soft);
  let top=this.y+13;for(const line of titleLines){this.text(line,M+14,top,{size:11,font:'bold',fill:negative?C.red:C.navy});top+=15;}
  top+=4;for(const line of bodyLines){this.text(line,M+14,top,{size:9.2,fill:C.ink});top+=13;}
  this.y+=height+12;
 }
 metrics(items,{columns=3}={}){
  const gap=10,width=(CW-gap*(columns-1))/columns;
  for(let i=0;i<items.length;i+=columns){
   this.ensure(81);const group=items.slice(i,i+columns);
   group.forEach((item,j)=>{
    const x=M+j*(width+gap),value=typeof item.value==='number'?money(item.value):item.value;
    this.rect(x,this.y,width,70,item.negative?C.redBg:C.paper);
    this.text(item.label.toUpperCase(),x+12,this.y+10,{size:7.1,font:'bold',fill:C.muted});
    this.text(value,x+12,this.y+28,{size:this.fit(value,width-24,20,'bold',9),font:'bold',fill:item.negative?C.red:C.navy});
    if(item.note)this.text(item.note,x+12,this.y+54,{size:7.3,fill:C.muted});
   });this.y+=81;
  }
 }
 table(columns,rows,{title,empty='No entries in this period.',fontSize=8.2,lineHeight=11.2}={}){
  if(!rows.length){this.paragraph(empty,{fill:C.muted});return;}
  const cellValue=(row,col)=>typeof col.value==='function'?col.value(row):row[col.key];
  const cellSize=(row,col)=>col.money?Math.min(fontSize,...String(cellValue(row,col)??'').split('\n').map(value=>this.fit(value,col.width-17,fontSize,col.bold?'bold':'body',6))):fontSize;
  const rowLines=row=>columns.map(col=>this.lines(cellValue(row,col),col.width-14,cellSize(row,col),col.bold?'bold':'body'));
  const head=(minimumRow=27)=>{
   this.ensure(29+(title?20:0)+Math.min(540,minimumRow),title||this.sectionName);
   if(title){this.text(title,M,this.y,{size:10.5,font:'bold',fill:C.navy});this.y+=20;}
   this.rect(M,this.y,CW,29,C.navy);
   let x=M;for(const col of columns){const lines=this.lines(col.label,col.width-14,7.4,'bold');lines.slice(0,2).forEach((line,i)=>this.text(line,x+7,this.y+7+i*9,{size:7.4,font:'bold',fill:C.white,width:col.width-14,align:col.align||'left'}));x+=col.width;}
   this.y+=29;
  };
  head(Math.max(27,Math.max(...rowLines(rows[0]).map(c=>c.length))*lineHeight+14));
  rows.forEach((row,rowIndex)=>{
   let cells=rowLines(row);const sizes=columns.map(col=>cellSize(row,col));
   while(cells.some(c=>c.length)){
    const longest=Math.max(...cells.map(c=>c.length)),rowHeight=Math.max(27,longest*lineHeight+14);
    if(this.y+Math.min(rowHeight,70)>BOTTOM){this.pageStart(this.sectionName);head(rowHeight);}
    if(rowHeight>BOTTOM-this.y&&rowHeight<540){this.pageStart(this.sectionName);head(rowHeight);}
    const take=Math.min(longest,Math.max(1,Math.floor((BOTTOM-this.y-14)/lineHeight))),height=Math.max(27,take*lineHeight+14);
    this.rect(M,this.y,CW,height,row.negative?C.redBg:rowIndex%2?C.paper:C.white);
    let x=M;
    columns.forEach((col,j)=>{
     const fill=col.color?col.color(row):row.negative&&col.money?C.red:C.ink;
     cells[j].slice(0,take).forEach((line,k)=>this.text(line,x+7,this.y+7+k*lineHeight,{size:sizes[j],font:col.bold?'bold':'body',fill,width:col.width-14,align:col.align||'left'}));
     cells[j]=cells[j].slice(take);x+=col.width;
    });
    this.y+=height;this.line(M,this.y,W-M,this.y,C.line,.45);
    if(cells.some(c=>c.length)){this.pageStart(this.sectionName);head();}
   }
  });this.y+=16;
 }
 footer(){
  const total=this.pages.length;this.pages.forEach((page,i)=>{
   this.page=page;this.line(M,751,W-M,751,C.line,.6);
   this.text('BearDen  /  Simulation snapshot',M,761,{size:7.5,fill:C.muted});
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

function monthChart(p,rows){
 if(!rows.length)return;
 const height=172;p.ensure(height+37);p.text('Monthly money in and out',M,p.y,{size:11,font:'bold',fill:C.navy});p.y+=24;
 const top=p.y,plot={left:M+51,top:top+19,width:CW-65,height:height-54},base=plot.top+plot.height;
 p.rect(M,top,CW,height,C.paper);const max=Math.max(100,...rows.map(r=>Math.max(r.income,r.outgoing)));
 for(let i=0;i<=3;i++){const py=base-i*plot.height/3;p.line(plot.left,py,plot.left+plot.width,py,C.line,.5);p.text(shortMoney(Math.round(max*i/3)),M+2,py-4,{size:7.1,fill:C.muted,width:43,align:'right'});}
 const slot=plot.width/rows.length,bar=Math.min(14,slot*.28);
 rows.forEach((row,i)=>{
  const x=plot.left+slot*(i+.5);p.rect(x-bar-1,base-row.income/max*plot.height,bar,row.income/max*plot.height,C.green);p.rect(x+1,base-row.outgoing/max*plot.height,bar,row.outgoing/max*plot.height,C.copper);
  const label=String(row.month||'').slice(5,7);p.text(label||String(i+1),x-slot/2,base+8,{size:6.7,fill:C.muted,width:slot,align:'center'});
 });
 p.text('Month numbers follow the dated table below.',M+12,top+height-13,{size:7.2,fill:C.muted});
 p.rect(W-M-154,top+height-11,7,7,C.green);p.text('In',W-M-142,top+height-13,{size:7.2,fill:C.muted});p.rect(W-M-108,top+height-11,7,7,C.copper);p.text('Out',W-M-96,top+height-13,{size:7.2,fill:C.muted});p.y+=height+14;
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
 if(!rows.length){p.callout('No negative balance in this ledger','The current projection stays at or above $0 for the events included in this report.');return;}
 p.table([
  {label:'Starts / recovers',width:116,value:r=>date(r.start)+'\n'+(r.end?'Recovers '+date(r.end):'Not recovered by end')},
  {label:'What triggered the gap',width:203,value:r=>r.cause||'Opening balance'},
  {label:'First negative',width:101,value:r=>money(r.firstBalance),align:'right',money:true},
  {label:'Deepest balance',width:108,value:r=>money(r.low)+'\n'+date(r.lowDate),align:'right',money:true,bold:true},
 ],rows.map(r=>({...r,negative:true})),{title});
 p.paragraph('A period can begin and recover on the same date. The lowest balance uses every ledger event, including bills that settle before a contribution on that day.',{size:9,fill:C.muted});
}

function ledgerTable(p,rows,{title='Complete forecast ledger'}={}){
 p.table([
  {label:'Date',width:72,value:r=>date(r.date)},
  {label:'Activity / explanation',width:234,value:r=>r.name+(r.detail?'\n'+r.detail:'')},
  {label:'In',width:74,value:r=>r.incoming?money(r.incoming):'-',align:'right',money:true},
  {label:'Out',width:74,value:r=>r.outgoing?money(r.outgoing):'-',align:'right',money:true},
  {label:'Balance',width:74,value:r=>money(r.balance),align:'right',money:true,bold:true},
 ],rows.map(r=>({...r,negative:safe(r.balance)&&r.balance<0})),{title,fontSize:8,lineHeight:11.2});
}

function cover(p,report){
 p.pageStart('Overview',{cover:true});p.rect(0,0,W,184,C.navy);p.rect(M,36,29,3,C.gold);
 p.text('BEARDEN  /  SIMULATION REPORT',M+41,30,{size:9,font:'bold',fill:C.white});
 const titleLines=p.lines(report.title||'Your financial forecast',CW,34,'display');
 let y=61;for(const line of titleLines.slice(0,2)){p.text(line,M,y,{size:34,font:'display',fill:C.white});y+=39;}
 const sub=report.subtitle||'A clear view of the money ahead.';
 const subtitleLines=p.lines(sub,CW,10);subtitleLines.slice(0,2).forEach((line,i)=>p.text(line,M,139+i*13,{size:10,fill:C.white}));
 p.text(date(report.start)+' - '+date(report.end),M,165,{size:8.3,fill:C.gold});
 p.y=207;
 p.text('PROJECTED ENDING BALANCE',M,p.y,{size:8.1,font:'bold',fill:C.muted});
 p.text(money(report.summary.closing),M,p.y+18,{size:p.fit(money(report.summary.closing),300,34,'bold',17),font:'bold',fill:report.summary.closing<0?C.red:C.navy});
 p.text('LOWEST BALANCE',M+330,p.y,{size:8.1,font:'bold',fill:C.muted});
 p.text(money(report.summary.low),M+330,p.y+23,{size:p.fit(money(report.summary.low),CW-330,24,'bold',12),font:'bold',fill:report.summary.low<0?C.red:C.navy});
 p.text(report.summary.lowDate?date(report.summary.lowDate):'Balance unavailable',M+330,p.y+55,{size:8,fill:C.muted});
 p.y+=84;p.paragraph(report.accountName+'  |  '+report.debtLabel,{size:8.5,fill:C.muted,gap:9});
 p.metrics([{label:'Starting balance',value:money(report.summary.opening)},{label:'Expected money in',value:money(report.summary.income)},{label:'Planned money out',value:money(report.summary.outgoing)}]);
 balanceChart(p,{start:report.start,end:report.end,series:[{label:'Current plan',color:C.navy,points:seriesPoints(report.summary,report.ledger,report.start,report.end)}],height:218});
 p.paragraph('Created '+stamp(report.createdAt)+'. This is a saved simulation of your selected forecast, including every scheduled ledger entry.',{size:8.5,fill:C.muted});
}

function overview(p,report){
 p.heading('What this forecast means',{eyebrow:'01 / Understand the numbers',newPage:true});
 for(const text of report.narratives||[])p.paragraph(text);
 const s=report.summary;
 if(s.firstNegative)p.callout('First projected negative: '+date(s.firstNegative.date),money(s.firstNegative.balance)+' after '+(s.firstNegative.name||'the starting balance')+'. The deepest balance across the full selected period is '+money(s.low)+' on '+date(s.lowDate)+'.',{negative:true});
 else if(safe(s.opening))p.callout('Reading the total','Starting balance '+money(s.opening)+' + money in '+money(s.income)+' - money out '+money(s.outgoing)+' = projected ending balance '+money(s.closing)+'.');
 else p.callout('Account balance unavailable','The report includes scheduled income and outflow, but it cannot establish ending balances or negative-balance periods without a usable starting balance.');
 if(safe(s.opening))shortfalls(p,report.shortfalls||[]);
 if((report.paychecks||[]).length){
  p.heading('Where each paycheck goes',{description:'Take-home pay is the amount after payroll deductions. The remaining amount is what this simulation adds to personal checking after the allocations shown here.'});
  p.table([
   {label:'Payday',width:71,value:r=>date(r.date)+'\n'+r.name},
   {label:'Take-home pay',width:100,value:r=>money(r.income),align:'right',money:true},
   {label:'Fixed Bills',width:95,value:r=>money(r.fixedBills),align:'right',money:true},
   {label:'Other allocations',width:132,value:r=>money(r.otherAllocations),align:'right',money:true},
   {label:'Remaining',width:130,value:r=>money(r.remaining),align:'right',money:true,bold:true},
  ],report.paychecks.map(r=>({...r,negative:r.remaining<0})),{title:'Paycheck reconciliation'});
  p.paragraph('Other allocations include the planned items used by your selected simulation, such as debt payments, savings and actual one-time expenses. Bills scheduled separately remain in the full ledger on their payment dates.',{size:9,fill:C.muted});
  const allocations=report.paychecks.flatMap(paycheck=>(paycheck.items||[]).map(item=>({...item,date:paycheck.date,paycheck:paycheck.name})));
  if(allocations.length)p.table([
   {label:'Payday',width:86,value:r=>date(r.date)+'\n'+r.paycheck},
   {label:'Allocation',width:96,value:r=>({transfer:'Fixed Bills',debt:'Debt payment',savings:'Savings',expense:'One-time expense',budget:'Budget obligation'})[r.kind]||'Planned payment'},
   {label:'Account / purpose',width:246,key:'label'},
   {label:'Amount',width:100,value:r=>money(r.amount),align:'right',money:true,bold:true},
  ],allocations,{title:'Itemized planned allocations'});
 }
 p.heading('The month-by-month view',{eyebrow:'02 / Cash flow',newPage:true});
 monthChart(p,report.monthly||[]);monthlyTable(p,report.monthly||[]);
}

function reclamation(p,report){
 const r=report.reclamation||{status:'unavailable',reason:'Contribution reclamation is not configured.'};
 p.heading('Contribution reclamation',{eyebrow:'03 / Household planning',newPage:true});
 if(r.status!=='ready'||!r.baseline||!r.projected){p.callout('Reclamation analysis unavailable',r.reason||'Set up a usable shared bills account and both contribution schedules to calculate reclamation.');for(const line of r.explanations||[])p.paragraph(line);return;}
 p.paragraph('Reclamation search: '+date(r.start)+' - '+date(r.end)+'. Bills are checked further ahead, through '+date(r.checkedThrough)+', so the end of the search is not treated as spare money.',{fill:C.muted});
 p.metrics([
  {label:'Total proposed reclaim',value:money(r.totals.total)},
  {label:'Extra funding required',value:money(r.funding.totalExtra)},
  {label:'Net after extra funding',value:money(r.totals.net),negative:r.totals.net<0},
 ]);
 p.callout(r.totals.conditionalNow?'Today’s reclaim is conditional':'Reclaimable at the starting date',money(r.totals.now)+(r.totals.conditionalNow?' after today’s required funding clears.':' under the included contribution plan.')+' These entries form one cumulative proposal; each amount is taken only once.');
 p.table([
  {label:'Contributor',width:143,value:r=>r.label||r.person},
  {label:'Per contribution',width:119,value:r=>money(r.amount),align:'right',money:true},
  {label:'Schedule starts',width:130,value:r=>date(r.start)},
  {label:'Frequency',width:136,value:r=>({biweekly:'Every two weeks',weekly:'Weekly',monthly:'Monthly'})[r.repeat]||r.repeat},
 ],r.contributions||[],{title:'Your configured contributions'});
 for(const line of r.explanations||[])p.paragraph(line,{size:9.3});
 p.heading('Before and after the proposal',{description:'The current plan retains saved, unreceived deposits already in your forecast. The proposed scenario adds the listed new deposits, then subtracts the proposed reclamations.'});
 balanceChart(p,{start:r.start,end:r.checkedThrough,series:[
  {label:'Current plan',color:C.gray,secondary:true,points:seriesPoints(r.baseline.summary,r.baseline.ledger,r.start,r.checkedThrough)},
  {label:'Proposed scenario',color:C.navy,points:seriesPoints(r.projected.summary,r.projected.ledger,r.start,r.checkedThrough)},
 ],height:224,buffer:r.buffer});
 p.table([
  {label:'Measure',width:222,key:'label'},
  {label:'Current plan',width:153,key:'before',align:'right',money:true},
  {label:'With the proposal',width:153,key:'after',align:'right',money:true,bold:true},
 ],[
  {label:'Starting bank balance',before:money(r.baseline.summary.opening),after:money(r.projected.summary.opening)},
  {label:'Expected money in',before:money(r.baseline.summary.income),after:money(r.projected.summary.income)},
  {label:'Planned money out',before:money(r.baseline.summary.outgoing),after:money(r.projected.summary.outgoing)},
  {label:'Ending balance at '+date(r.checkedThrough),before:money(r.baseline.summary.closing),after:money(r.projected.summary.closing)},
  {label:'Lowest event balance',before:money(r.baseline.summary.low)+'\n'+date(r.baseline.summary.lowDate),after:money(r.projected.summary.low)+'\n'+date(r.projected.summary.lowDate)},
 ],{title:'Same account, same future bills'});
 if((r.baseline.shortfalls||[]).length)shortfalls(p,r.baseline.shortfalls,{title:'Gaps already present before reclamation'});
 p.heading('Extra deposits and their cost');
 p.paragraph('Saved pending funding: '+money(r.funding.totalPending)+'. Newly proposed funding: '+money(r.funding.totalRequired)+'. Total funding counted against the reclaim: '+money(r.funding.totalExtra)+'.',{font:'bold',fill:C.navy});
 p.table([
  {label:'Planned date',width:110,value:r=>date(r.date)},
  {label:'Source',width:260,value:r=>({personal:'Personal checking',other:'Spouse or other funds',unassigned:'Source not assigned'})[r.source]||r.source||'Source not assigned'},
  {label:'Amount',width:158,value:r=>money(r.amount),align:'right',money:true,bold:true},
 ],r.funding.pending||[],{title:'Already saved, not yet received',empty:'No saved extra deposits are pending.'});
 p.table([
  {label:'Deposit by / gap date',width:110,value:r=>date(r.date)+'\nGap: '+date(r.neededBy)},
  {label:'Reason',width:210,key:'reason'},
  {label:'Original gap',width:100,value:r=>money(r.shortfall),align:'right',money:true},
  {label:'Deposit needed',width:108,value:r=>money(r.amount),align:'right',money:true,bold:true},
 ],r.funding.required||[],{title:'New deposits assumed by this proposal',empty:'No new deposits are required for the original forecast gaps.'});
 if((r.funding.required||[]).length)p.paragraph('New deposits are proposals with no funding source assigned. Their source must be chosen before adding them to the forecast; this report does not assume that personal checking can supply them.',{size:9,fill:C.muted});
 p.heading('Who can reclaim what, and when',{description:'Each line is part of the same plan. Reclaim only after that day’s deposits and bills have cleared.'});
 p.metrics([{label:'Your proposed total',value:money(r.totals.totalMine)},{label:'Spouse proposed total',value:money(r.totals.totalSpouse)},{label:'Cushion target',value:money(r.buffer)}]);
 p.table([
  {label:'Reclaim date',width:100,value:r=>date(r.date)},
  {label:'Person / third payday',width:188,value:r=>(r.person==='mine'?'Yours':'Your spouse’s')+'\nThird payday: '+date(r.contributionDate)},
  {label:'Amount',width:112,value:r=>money(r.amount),align:'right',money:true},
  {label:'Bills balance after',width:128,value:r=>money(r.balanceAfter),align:'right',money:true,bold:true},
 ],r.schedule||[],{title:'Complete proposed reclamation schedule',empty:'No contribution reclamations are projected within the search period.'});
 p.paragraph('Proposed total '+money(r.totals.total)+' - saved and new extra funding '+money(r.funding.totalExtra)+' = net '+money(r.totals.net)+'. These are returned contributions, not investment earnings or new income.',{font:'bold',fill:r.totals.net<0?C.red:C.navy});
 if((r.projected.shortfalls||[]).length)shortfalls(p,r.projected.shortfalls,{title:'Negative periods in the explicit proposal ledger'});
}

function assumptions(p,report){
 p.heading('How to read this snapshot',{eyebrow:'04 / Assumptions & definitions',newPage:true});
 p.table([{label:'Setting',width:159,key:'label',bold:true},{label:'Used in this report',width:369,key:'value'}],report.assumptions||[],{empty:'Uses the selected forecast settings.'});
 p.paragraph('The full ledger follows. Income and outflow columns show the components of each event; the balance column is the running result after that event. Rows with a negative balance are shaded red. A zero-change row can record a contribution that is already included in the bank balance.',{size:9.3});
 p.paragraph('Graphs follow the same event sequence as the ledger. Multiple movements on a single date are retained, so an intraday low is not hidden by the closing balance for that date.',{size:9.3});
 if(p.simplified)p.paragraph('Uncommon symbols unsupported by the PDF fonts have been simplified in labels.',{size:8.5,fill:C.muted});
}

export async function renderForecastPdf(report,{retry=0}={}){
 if(!report||!report.summary||!Array.isArray(report.ledger))throw new Error('The report snapshot is incomplete. Generate it again.');
 const lib=await import('./vendor/pdf-lib.mjs?v=1.17.1'+(retry?'&retry='+retry:''));
 const {PDFDocument,StandardFonts}=lib;rgb=lib.rgb;C=palette();
 const doc=await PDFDocument.create();
 const fonts={body:await doc.embedFont(StandardFonts.Helvetica),bold:await doc.embedFont(StandardFonts.HelveticaBold),display:await doc.embedFont(StandardFonts.TimesRoman)};
 const p=new Pages(doc,fonts,report);
 doc.setTitle(p.clean(report.title||'BearDen simulation report'));doc.setAuthor('BearDen');doc.setCreator('BearDen forecast report');doc.setProducer('BearDen');doc.setSubject('Forecast, cash flow, negative balances and contribution reclamation');
 doc.setKeywords(['BearDen','forecast','simulation','household','ledger']);
 const created=new Date(report.createdAt);if(Number.isFinite(created.getTime())){doc.setCreationDate(created);doc.setModificationDate(created);}
 cover(p,report);overview(p,report);reclamation(p,report);assumptions(p,report);
 p.heading('Full forecast ledger',{eyebrow:'Appendix A / Selected forecast',newPage:true,description:date(report.start)+' - '+date(report.end)+' | '+report.ledger.length+' events. Starting balance: '+money(report.summary.opening)+'.'});
 ledgerTable(p,report.ledger);p.paragraph('End of selected forecast. Ending balance: '+money(report.summary.closing)+'.',{font:'bold',fill:C.navy});
 const r=report.reclamation;
 if(r?.status==='ready'&&r.projected){
  p.heading('Full reclamation audit ledger',{eyebrow:'Appendix B / Extended safety check',newPage:true,description:date(r.start)+' - '+date(r.checkedThrough)+' | '+r.projected.ledger.length+' events. Includes current scheduled flows, explicitly listed proposed deposits, and every proposed reclaim.'});
  p.paragraph('This ledger starts with the original bank balance '+money(r.projected.summary.opening)+'. Today’s proposed deposits appear as separate entries; they are not hidden inside the opening balance.',{size:9.2,fill:C.muted});
  ledgerTable(p,r.projected.ledger,{title:'Proposed scenario: every movement'});
  p.paragraph('End of extended safety check. Ending balance: '+money(r.projected.summary.closing)+'. Lowest event balance: '+money(r.projected.summary.low)+' on '+date(r.projected.summary.lowDate)+'.',{font:'bold',fill:C.navy});
 }
 p.footer();
 const bytes=await doc.save();
 return {bytes,pageCount:doc.getPageCount(),filename:String(report.filename||`bearden-${report.scope||'forecast'}-${report.start}-to-${report.end}.pdf`).replace(/[^a-zA-Z0-9._-]/g,'-')};
}
