import {MONTHS,readCents,parseStatement,analyzeStatement} from './statement-model.mjs';
import {readStatementFile} from './statement-reader.mjs';

const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const monthLabel=month=>new Date(month+'-15T12:00:00').toLocaleDateString('en-US',{month:'short',year:'numeric'});
const monthName=month=>MONTHS[Number(month.slice(5))-1];
const KEY='statement-reports';
const newId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
let reports=[],draft=null,report=null,request=0,dirty=false;
const selected={cost:0,reserve:0};
const card=document.createElement('section');
card.className='income-card statement-entry';card.id='statementInsightsCard';
card.innerHTML='<div class="card-heading"><div><span class="chart-eyebrow">Plan for the expensive months</span><h3>Statement insights</h3></div><button type="button" id="openStatementInsights" aria-haspopup="dialog" disabled>Analyze statement</button></div><p class="subtle">Turn a year of utility bills into a monthly budget and a seasonal buffer.</p><div id="savedStatementReports"></div><p id="statementCardStatus" class="subtle" role="status"></p>';
$('billListCard').before(card);
const dialog=document.createElement('dialog');dialog.id='statementInsightsDialog';dialog.className='statement-dialog';dialog.setAttribute('aria-labelledby','statementTitle');
dialog.innerHTML=`<header class="statement-heading"><div><span class="chart-eyebrow">BEARDEN / BILLS</span><h2 id="statementTitle">Statement insights</h2></div><button type="button" id="closeStatementInsights" aria-label="Close statement insights">Close</button></header>
<div class="statement-body bd-popup-body">
 <section id="statementImport">
  <h3>Understand your bill's seasons</h3><p class="subtle">Upload a billing history with up to 12 full months. We’ll find the expensive stretch and show how a steady monthly budget could cover it.</p>
  <label class="statement-upload" for="statementFile"><strong>Choose a statement</strong><span>PDF, CSV, or text · up to 15 MB</span><input id="statementFile" type="file" accept=".pdf,.csv,.txt,application/pdf,text/csv,text/plain"></label>
  <p class="subtle">PDFs are read on your device. Only the reviewed monthly figures are saved with your report. Scanned images need a text PDF, CSV, or manual entry.</p>
  <div class="statement-inline-actions"><button type="button" id="statementManual">Enter months manually</button></div>
 </section>
 <p id="statementStatus" role="status" aria-live="polite"></p>
 <section id="statementReview" hidden>
  <h3>Review monthly charges</h3><label>Bill or provider name<input id="statementName" maxlength="80" placeholder="e.g. Consumers Energy"></label>
  <p id="statementReviewNotes" class="subtle"></p><p class="subtle">Use new charges including tax. Check the rows you want to include; the report uses the latest 12 selected bill months. Short move-in periods are left out automatically.</p>
  <div class="statement-review-labels" aria-hidden="true"><span>Use</span><span>Bill month</span><span>Total ($)</span><span></span></div><div id="statementRows"></div>
  <div class="statement-inline-actions"><button type="button" id="statementAddRow">+ Add month</button><button type="button" id="statementRun" class="statement-primary">Create report</button></div>
 </section>
 <section id="statementResult" hidden>
  <div class="statement-report-heading"><div><span class="chart-eyebrow">Your seasonal picture</span><h3 id="statementReportName"></h3><p id="statementPeriod" class="subtle"></p></div><button type="button" id="statementEdit">Edit months</button></div>
  <div id="statementMetrics" class="statement-metrics"></div><p id="statementCoverage" class="statement-notice"></p>
  <div class="statement-controls"><label>Monthly budget ($)<input id="statementBudget" type="number" min="0" max="1000000" step="0.01" inputmode="decimal"></label><label>Starting utility reserve ($)<input id="statementReserve" type="number" min="0" max="1000000" step="0.01" inputmode="decimal"></label><label id="statementStartLabel">Simulate starting in<select id="statementStart">${MONTHS.map((m,i)=>'<option value="'+(i+1)+'">'+m+'</option>').join('')}</select></label></div>
  <label class="statement-budget-slider">Try a different monthly budget<input type="range" id="statementBudgetSlider" min="0" step="5" aria-label="Monthly budget slider"></label>
  <div class="statement-inline-actions"><button type="button" id="statementRecommended">Use suggested budget &amp; reserve</button></div>
  <div id="statementFindings" class="statement-findings"></div>
  <section class="statement-chart-section"><h4>Monthly bill costs</h4><p class="subtle">Drag across the graph or move the slider to explore each bill.</p><div id="statementCostChart"></div></section>
  <section class="statement-chart-section"><h4>How your reserve changes</h4><p id="statementReserveExplanation" class="subtle"></p><div id="statementReserveChart"></div></section>
  <details class="statement-ledger"><summary>Monthly breakdown</summary><div id="statementLedger"></div></details>
  <p class="statement-assumptions subtle">This is a seasonal planning estimate for this bill only. It assumes the monthly allocation arrives before the bill is paid and repeats the recorded costs. Weather, rates, other bills, and payday timing can change what you need. Keep cheaper-month leftovers reserved for future bills. Saving this report does not change your bills, contributions, or reclamation forecast.</p>
  <div class="statement-inline-actions"><button type="button" id="statementSave" class="statement-primary">Save report</button><button type="button" id="statementNew">Analyze another statement</button><button type="button" id="statementDelete" hidden>Delete report</button></div><p id="statementSaveStatus" class="subtle" role="status"></p>
 </section>
</div>`;
document.body.append(dialog);

function markDirty(){dirty=true;$('statementSaveStatus').textContent='Unsaved changes.';}
function renderSaved(){
 $('savedStatementReports').innerHTML=reports.map(r=>{
  let a;try{a=analyzeStatement(r.rows,r.options);}catch{return '';}
  return `<button type="button" class="statement-saved" data-statement-open="${esc(r.id)}"><span><strong>${esc(r.name)}</strong><small>${a.count} months · ${esc(monthLabel(a.rows[0].month))}–${esc(monthLabel(a.rows.at(-1).month))}</small></span><span><strong>${money(a.budget)}/mo</strong><small>View report ›</small></span></button>`;
 }).join('');
}
function openNew(){
 request++;draft={id:newId(),name:'Utility bill',rows:[],warnings:[]};report=null;dirty=false;
 $('statementImport').hidden=false;$('statementReview').hidden=true;$('statementResult').hidden=true;$('statementStatus').textContent='';$('statementFile').value='';
 if(!dialog.open)dialog.showModal();
}
function review(){
 $('statementImport').hidden=false;$('statementReview').hidden=false;$('statementResult').hidden=true;
 $('statementName').value=draft.name;$('statementReviewNotes').textContent=draft.warnings.join(' ');
 $('statementRows').innerHTML=draft.rows.map((r,i)=>`<div class="statement-review-row" data-statement-row="${i}"><input type="checkbox" aria-label="Include bill ${i+1}" data-field="included" ${r.included!==false?'checked':''}><label><span class="statement-sr-only">Bill month ${i+1}</span><input type="month" min="2000-01" max="2099-12" data-field="month" value="${esc(r.month)}" required></label><label><span class="statement-sr-only">Bill amount ${i+1}</span><input type="number" step="0.01" min="-1000000" max="1000000" inputmode="decimal" data-field="amount" value="${Number.isSafeInteger(r.amount)?(r.amount/100).toFixed(2):''}" required></label><button type="button" data-remove-statement-row="${i}" aria-label="Remove bill ${i+1}">×</button>${r.note?'<small>'+esc(r.note)+'</small>':''}</div>`).join('');
}
function collectRows(){
 draft.name=$('statementName').value.trim()||'Utility bill';
 for(const element of $('statementRows').children){
  const row=draft.rows[Number(element.dataset.statementRow)],amount=readCents(element.querySelector('[data-field=amount]').value);
  if(amount!==row.amount)for(const key of ['electric','gas','tax'])delete row[key];
  const month=element.querySelector('[data-field=month]').value;
  if(month!==row.month){delete row.dueDate;delete row.days;delete row.note;}
  Object.assign(row,{month,amount,included:element.querySelector('[data-field=included]').checked});
 }
}
function createReport(options){
 report=analyzeStatement(draft.rows,options);draft.options={budget:report.budget,reserve:report.reserve,startMonth:report.startMonth};
 $('statementImport').hidden=true;$('statementReview').hidden=true;$('statementResult').hidden=false;$('statementStatus').textContent='';
 $('statementBudget').value=(report.budget/100).toFixed(2);$('statementReserve').value=(report.reserve/100).toFixed(2);$('statementStart').value=report.startMonth;
 $('statementBudgetSlider').max=Math.ceil(Math.max(report.peak.amount*1.5,report.budget*1.25)/5000)*50;
 $('statementBudgetSlider').value=report.budget/100;$('statementStartLabel').hidden=!report.complete;
 $('statementDelete').hidden=!reports.some(r=>r.id===draft.id);renderReport();
 dialog.scrollTop=0;dialog.querySelector('.statement-body').scrollTop=0;
}
function renderReport(){
 const a=report;
 $('statementReportName').textContent=draft.name;
 $('statementPeriod').textContent=monthLabel(a.rows[0].month)+' – '+monthLabel(a.rows.at(-1).month)+' · '+a.count+' bill months';
 $('statementMetrics').innerHTML=[[a.complete?'Annual total':'Recorded total',money(a.total)],['Monthly average',money(a.average)],['Highest bill',money(a.peak.amount),monthLabel(a.peak.month)],['Lowest bill',money(a.lowest.amount),monthLabel(a.lowest.month)]].map(([l,v,n])=>`<div><span>${l}</span><strong>${v}</strong>${n?'<small>'+n+'</small>':''}</div>`).join('');
 $('statementCoverage').hidden=a.complete;
 $('statementCoverage').textContent='Partial history: '+a.count+' recorded months. Missing months are not treated as $0. Add 12 consecutive full months for an annual seasonal estimate; these suggestions only describe the available bills.';
 const top=a.highestStretch,above=a.rows.filter(r=>r.amount>a.budget),peakPercent=Math.round((a.peak.amount/a.average-1)*100);
 $('statementFindings').innerHTML=`<article><span class="chart-eyebrow">${top?'Most expensive stretch':'Highest bill'}</span><h4>${top?esc(monthName(top.rows[0].month)+'–'+monthName(top.rows[2].month)):esc(monthLabel(a.peak.month))}</h4><p>${top?money(top.total)+' across those three bills; '+money(top.extra)+' above three monthly allocations.':money(a.peak.amount)+' for the highest recorded bill.'} ${esc(monthName(a.peak.month))}'s bill was ${peakPercent}% above your average.</p></article>
 <article><span class="chart-eyebrow">Seasonal reserve target</span><h4>${money(a.suggestedReserve)}</h4><p>The largest stretch of bills above your budget needs ${money(a.seasonalDraw)}. This target adds 25% of your highest bill and rounds up to $100 for breathing room. Build it before the expensive stretch; it is a one-time reserve, not another monthly payment.</p></article>
 <article class="${a.surplus<0||a.minBalance<0?'statement-shortfall':''}"><span class="chart-eyebrow">Your ${money(a.budget)} monthly plan</span><h4>${a.surplus<0?money(-a.surplus)+' funding shortfall':money(a.surplus)+' left after bills'}</h4><p>Across ${a.count} recorded months, ${above.length} bills exceed your monthly budget. ${a.surplus<0?'This budget does not cover the recorded costs. A reserve delays the shortfall but cannot make this sustainable each year.':'Leave the difference from cheaper months in the account to cover the higher bills.'} ${a.minBalance<0?'With this starting reserve, the simulation falls '+money(-a.minBalance)+' below $0.':'The lowest simulated reserve is '+money(a.minBalance)+'.'}</p></article>`;
 $('statementReserveExplanation').textContent=(a.complete?'Repeats each calendar month’s recorded bill, starting in '+MONTHS[a.startMonth-1]+'. ':'Replays the recorded months only, in order. ')+money(a.reserve)+' is already in the utility reserve at the start. Add '+money(a.budget)+' before each bill.';
 chart('cost',a.rows,['amount','budget']);chart('reserve',a.simulation,['balance']);
 $('statementLedger').innerHTML=a.simulation.map(r=>`<div class="statement-ledger-row"><strong>${esc(a.complete?monthName(r.month):monthLabel(r.month))}</strong><span>Bill <b>${money(r.amount)}</b></span><span>${r.change>=0?'Added to reserve':'Used from reserve'} <b>${money(Math.abs(r.change))}</b></span><span>Reserve after bill <b class="${r.balance<0?'statement-negative':''}">${money(r.balance)}</b></span></div>`).join('');
}
function chart(kind,rows,keys){
 const id=kind==='cost'?'statementCostChart':'statementReserveChart',values=rows.flatMap(r=>keys.map(k=>k==='budget'?report.budget:r[k]));
 if(kind==='reserve')values.push(report.reserve);
 const low=Math.min(0,...values),high=Math.max(100,...values),span=high-low||100;
 const width=Math.min(670,Math.max(260,window.innerWidth-90)),right=width-30,plotWidth=right-50;
 const x=i=>50+i/Math.max(1,rows.length-1)*plotWidth,y=v=>180-(v-low)/span*152;
 const grid=[0,0.5,1].map(f=>{const value=low+span*f;return `<line x1="50" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="statement-grid"/><text x="43" y="${y(value)+4}" text-anchor="end">${esc(money(value).replace(/\.00$/,''))}</text>`;}).join('');
 const paths=keys.map((key,i)=>'<polyline points="'+rows.map((r,j)=>x(j)+','+y(key==='budget'?report.budget:r[key])).join(' ')+'" fill="none" stroke="'+(i?'var(--chart-bill, var(--muted))':'var(--accent)')+'" stroke-width="3" '+(i?'stroke-dasharray="7 6"':'')+'/>').join('');
 const points=rows.map((r,i)=>`<circle cx="${x(i)}" cy="${y(kind==='cost'?r.amount:r.balance)}" r="4" fill="var(--accent)"/>`).join('');
 const index=Math.min(selected[kind],rows.length-1);selected[kind]=index;
 $(id).innerHTML=`<div class="statement-chart" data-statement-chart="${kind}" data-chart-width="${width}"><svg viewBox="0 0 ${width} 210" role="img" aria-label="${kind==='cost'?'Monthly costs and monthly budget':'Simulated utility reserve'}; use the slider below for exact amounts">${grid}${paths}${points}<line data-cursor x1="${x(index)}" x2="${x(index)}" y1="18" y2="188" stroke="var(--ink)" stroke-dasharray="3 4"/><text x="50" y="205">${esc(kind==='cost'?monthLabel(rows[0].month):monthName(rows[0].month))}</text><text x="${right}" y="205" text-anchor="end">${esc(kind==='cost'?monthLabel(rows.at(-1).month):monthName(rows.at(-1).month))}</text></svg><div class="statement-legend"><span>● ${kind==='cost'?'Actual bill':'Utility reserve'}</span>${kind==='cost'?'<span>┄ Monthly budget</span>':''}</div><label class="statement-sr-only" for="statementScrub-${kind}">Explore ${kind==='cost'?'bill months':'reserve months'}</label><input id="statementScrub-${kind}" data-statement-scrub="${kind}" type="range" min="0" max="${rows.length-1}" step="1" value="${index}"><output class="statement-chart-point" aria-live="polite"></output></div>`;
 const svg=$(id).querySelector('svg');let dragging=false;
 const move=event=>{
  const rect=svg.getBoundingClientRect(),px=(event.clientX-rect.left)/rect.width*width;
  selectPoint(kind,Math.round(Math.max(0,Math.min(1,(px-50)/plotWidth))*(rows.length-1)));
 };
 svg.addEventListener('pointerdown',event=>{dragging=true;svg.setPointerCapture(event.pointerId);move(event);});
 svg.addEventListener('pointermove',event=>{if(dragging||event.pointerType==='mouse')move(event);});
 svg.addEventListener('pointerup',()=>{dragging=false;});svg.addEventListener('pointercancel',()=>{dragging=false;});
 selectPoint(kind,index);
}
function selectPoint(kind,index){
 const rows=kind==='cost'?report.rows:report.simulation,row=rows[index];if(!row)return;
 selected[kind]=index;const root=dialog.querySelector('[data-statement-chart="'+kind+'"]'),x=50+index/Math.max(1,rows.length-1)*(Number(root.dataset.chartWidth)-80);
 root.querySelector('[data-cursor]').setAttribute('x1',x);root.querySelector('[data-cursor]').setAttribute('x2',x);root.querySelector('input').value=index;
 const change=report.budget-row.amount;
 root.querySelector('output').innerHTML=kind==='cost'?`<strong>${esc(monthLabel(row.month))} · ${money(row.amount)}</strong><span>${money(Math.abs(change))} ${change>=0?'under':'over'} your monthly budget</span>${['electric','gas','tax'].some(k=>row[k]!=null)?'<small>'+['electric','gas','tax'].filter(k=>row[k]!=null).map(k=>k[0].toUpperCase()+k.slice(1)+' '+money(row[k])).join(' · ')+'</small>':''}${row.dueDates?.length?'<small>Due '+esc(row.dueDates.join(', '))+'</small>':''}`:`<strong>${esc(report.complete?monthName(row.month):monthLabel(row.month))} · ${money(row.balance)} remaining</strong><span>${money(row.opening)} opening + ${money(report.budget)} allocated − ${money(row.amount)} bill</span>`;
}
function updateScenario(){
 try{
  const budget=readCents($('statementBudget').value),reserve=readCents($('statementReserve').value);
  if(budget===null||reserve===null)throw Error('Enter both a monthly budget and starting reserve.');
  report=analyzeStatement(draft.rows,{budget,reserve,startMonth:Number($('statementStart').value)});
  draft.options={budget,reserve,startMonth:report.startMonth};
  $('statementBudgetSlider').max=Math.max(Number($('statementBudgetSlider').max),Math.ceil(budget/500)*5);$('statementBudgetSlider').value=budget/100;
  $('statementStatus').textContent='';renderReport();markDirty();
 }catch(error){$('statementStatus').textContent=error.message;}
}
$('openStatementInsights').onclick=openNew;$('closeStatementInsights').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>{request++;$('statementFile').disabled=false;$('openStatementInsights').focus({preventScroll:true});});
$('statementManual').onclick=()=>{if(!draft.rows.length)draft.rows.push({month:'',amount:null,included:true});review();};
$('statementName').oninput=markDirty;
$('statementFile').onchange=async event=>{
 const file=event.target.files[0];if(!file)return;const token=++request;event.target.disabled=true;
 $('statementStatus').textContent='Reading statement…';
 try{
  const text=await readStatementFile(file,message=>{if(token===request)$('statementStatus').textContent=message;});
  if(token!==request)return;
  const parsed=parseStatement(text);draft={id:newId(),...parsed};markDirty();review();
  $('statementStatus').textContent=parsed.rows.length?parsed.rows.length+' bill rows found. Review the selected months, then create your report.':'No monthly rows found. You can enter the figures manually below.';
 }catch(error){if(token===request)$('statementStatus').textContent=error.message;}
 finally{if(token===request){event.target.disabled=false;event.target.value='';}}
};
$('statementRows').addEventListener('input',markDirty);
$('statementRows').onclick=event=>{const button=event.target.closest('[data-remove-statement-row]');if(!button)return;collectRows();draft.rows.splice(Number(button.dataset.removeStatementRow),1);markDirty();review();};
$('statementAddRow').onclick=()=>{collectRows();if(draft.rows.length>=120){$('statementStatus').textContent='Use at most 120 rows per report.';return;}draft.rows.push({month:'',amount:null,included:true});markDirty();review();$('statementRows').lastElementChild.querySelector('[type=month]').focus();};
$('statementRun').onclick=()=>{try{collectRows();selected.cost=0;selected.reserve=0;createReport();markDirty();}catch(error){$('statementStatus').textContent=error.message;}};
$('statementEdit').onclick=()=>{review();$('statementName').focus();};
for(const id of ['statementBudget','statementReserve','statementStart'])$(id).addEventListener('input',updateScenario);
$('statementBudgetSlider').oninput=event=>{$('statementBudget').value=Number(event.target.value).toFixed(2);updateScenario();};
$('statementRecommended').onclick=()=>{createReport();markDirty();};
dialog.addEventListener('input',event=>{const kind=event.target.dataset.statementScrub;if(kind)selectPoint(kind,Number(event.target.value));});
window.addEventListener('resize',()=>{if(dialog.open&&report){chart('cost',report.rows,['amount','budget']);chart('reserve',report.simulation,['balance']);}});
$('statementNew').onclick=()=>{if(!dirty||confirm('Discard the unsaved report changes and start another?'))openNew();};
$('savedStatementReports').onclick=event=>{
 const button=event.target.closest('[data-statement-open]');if(!button)return;
 draft=structuredClone(reports.find(r=>r.id===button.dataset.statementOpen));draft.warnings??=[];dirty=false;selected.cost=0;selected.reserve=0;
 try{createReport(draft.options);$('statementSaveStatus').textContent='Saved report';dialog.showModal();}catch(error){$('statementCardStatus').textContent=error.message;}
};
$('statementSave').onclick=async()=>{
 const button=$('statementSave');button.disabled=true;
 try{
  // Revalidate the visible controls; never save a stale scenario after invalid input.
  const budget=readCents($('statementBudget').value),reserve=readCents($('statementReserve').value);
  if(budget===null||reserve===null)throw Error('Enter a valid budget and reserve before saving.');
  const current=analyzeStatement(draft.rows,{budget,reserve,startMonth:Number($('statementStart').value)});
  const saved={id:draft.id,name:draft.name,rows:structuredClone(draft.rows.filter(r=>r.included!==false)),warnings:draft.warnings,options:{budget:current.budget,reserve:current.reserve,startMonth:current.startMonth},savedAt:new Date().toISOString()};
  const next=[saved,...reports.filter(r=>r.id!==saved.id)];
  if(next.length>12)throw Error('You can save 12 reports. Delete an older report first.');
  await window.BearDen.storage.set(KEY,JSON.stringify(next));reports=next;dirty=false;renderSaved();$('statementDelete').hidden=false;$('statementSaveStatus').textContent='Report saved. Your bill amounts and payment schedule are unchanged.';
 }catch(error){$('statementSaveStatus').textContent='Could not save: '+error.message;}
 finally{button.disabled=false;}
};
$('statementDelete').onclick=async()=>{
 if(!confirm('Delete this saved statement report? Your bills will stay unchanged.'))return;
 const button=$('statementDelete');button.disabled=true;
 try{const next=reports.filter(r=>r.id!==draft.id);await window.BearDen.storage.set(KEY,JSON.stringify(next));reports=next;renderSaved();dialog.close();}
 catch(error){$('statementSaveStatus').textContent='Could not delete: '+error.message;}
 finally{button.disabled=false;}
};
try{
 if(!window.BearDen)await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
 await window.BearDen.ready;const saved=await window.BearDen.storage.get(KEY);
 if(saved){const value=JSON.parse(saved.value);if(!Array.isArray(value)||value.length>12)throw Error('Saved reports could not be read.');reports=value;}
 renderSaved();$('openStatementInsights').disabled=false;
}catch(error){$('statementCardStatus').textContent='Statement reports could not load: '+error.message;}
