'use strict';
(()=>{
 const $=s=>document.querySelector(s),tabs=['debt','income','tools','settings'],positions={};let active='debt';
 window.selectBearTab=name=>{
  if(!tabs.includes(name))return;
  if(active==='tools'&&name!=='tools'&&$('#gamesSection').classList.contains('open'))window.toggleGamesSection();
  positions[active]=scrollY;active=name;
  for(const tab of tabs){$('#tab-'+tab).hidden=tab!==name;const b=$('#nav-'+tab);b.setAttribute('aria-selected',String(tab===name));b.tabIndex=tab===name?0:-1;}
  window.scrollTo(0,positions[name]||0);
  if(name==='income')renderIncome();
  if(name==='tools')window.dispatchEvent(new Event('resize'));
 };
 document.addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(tab)window.selectBearTab(tab.dataset.tab);if(e.target.closest('[data-open-settings]'))window.selectBearTab('settings');});
 $('.bottom-tabs').addEventListener('keydown',e=>{const i=tabs.indexOf(e.target.closest('[data-tab]')?.dataset.tab);if(i<0)return;const n=e.key==='ArrowRight'?(i+1)%4:e.key==='ArrowLeft'?(i+3)%4:e.key==='Home'?0:e.key==='End'?3:-1;if(n<0)return;e.preventDefault();window.selectBearTab(tabs[n]);$('#nav-'+tabs[n]).focus();});
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format(n/100);
 const modelDay=(s,n)=>{const d=new Date(s+'T12:00:00');d.setDate(d.getDate()+n);return iso(d);};
 const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
 let editingBill=null,spendingCategory=null,forecastPoints=[];
 const chartColors=['#168b83','#ed896f','#d6a74b','#547eab','#a17ca7','#7fa873','#91847a'];
 const billCategories={electric:'Electric',rent:'Rent',utility:'Utility','car-payment':'Car payment',insurance:'Insurance','phone-internet':'Phone & internet',subscription:'Subscription',loan:'Loan payment',other:'Other bill'};
 const pencil='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg>';
 let review={rows:[],bills:[],spending:{categories:[],total:0}},transactionLimit=10;
 let month=new Date(new Date().getFullYear(),new Date().getMonth(),1),selected=null,model,planner={manual:[],covered:{},paid:[],accountVisibility:{},dismissedEstimates:[],estimates:{},bankRules:{}},linked={},ready=false;
 function error(e){$('#incomeStatus').textContent=e.message||String(e);$('#accountSaveStatus').textContent=e.message||String(e);}
 async function save(){await window.BearDen.storage.set('income-planner',JSON.stringify(planner));$('#incomeStatus').textContent='Saved';renderIncome();}
 async function initialize(){try{await window.classicReady;model=await import('./income-model.mjs');const stored=await window.BearDen.storage.get('income-planner');if(stored)planner={...planner,...JSON.parse(stored.value)};ready=true;renderIncome();}catch(e){error(e);}}
 window.addEventListener('load',initialize,{once:true});
 window.addEventListener('bearden-connections',()=>{if(ready)renderIncome();});
 async function renderIncome(){
  if(!ready)return;
  try{
   const b=window.BearDen,plan=window.getDebtPlan(),legacy=b.plan?.state||{},connections=b.plan?.connections||{},authenticated=b.config?.authenticated;
   linked=JSON.parse((await b.storage.get('linked-bills'))?.value||'{}');
   const accounts=(legacy.accounts||[]).filter(a=>a.source==='plaid');
   const visible=accounts.filter(a=>planner.accountVisibility[a.id]??(/^checking(?:\s|$)/i.test(a.name)));
   const currentDay=iso(new Date()),upcoming=model.paydayEvents(plan,currentDay,modelDay(currentDay,90))[0];
   const usd=visible.filter(a=>(a.currency||'USD')==='USD'&&!['credit','loan'].includes(a.type)),total=usd.reduce((sum,a)=>sum+a.balance,0);
   const summary='<span class="income-eyebrow">Selected bank balance'+(usd.length===1?'':'s')+'</span><div class="income-total">'+(usd.length?money(total):'—')+'</div><div class="income-meta"><span><i class="income-live-dot"></i>'+visible.length+' account'+(visible.length===1?'':'s')+' shown</span><span>'+(upcoming?'Next payday · '+esc(dateLabel(upcoming.date)):'Your money at a glance')+'</span></div>';
   $('#debtIncomeSummary').innerHTML=summary;$('#incomeSummary').innerHTML=summary;
   const rows=visible.map(a=>'<div class="bank-row"><span>'+esc(a.name)+'<small>'+esc(['credit','loan'].includes(a.type)?'Amount owed · Not included in cash':a.include&&(a.currency||'USD')==='USD'?'Included in forecast':'Not included in forecast')+'</small></span><strong>'+esc(money(a.balance,a.currency))+'</strong></div>').join('');
   $('#debtIncomeBalances').innerHTML=rows||'<p class="subtle">'+(accounts.length?'Choose accounts to show your bank balances.':authenticated?'Connect your bank in Settings to see your balances.':'Sign in and connect your bank in Settings.')+'</p>';
   $('#debtBankUpdated').textContent=connections.bankUpdated?'Last synced '+new Date(connections.bankUpdated).toLocaleString():'';
   $('#accountChoices').innerHTML=accounts.map(a=>'<label class="check-label"><input type="checkbox" data-account-visible="'+esc(a.id)+'" '+(visible.some(v=>v.id===a.id)?'checked':'')+'> '+esc(a.name)+'</label>').join('')||'<p class="subtle">Connect a bank in Settings first.</p>';
   $('#restoreBankEstimates').hidden=true;
   review=model.reviewBankActivity(connections.transactions||[],planner.bankRules,connections.recurringBills||[],currentDay);
   const electricRule=Object.values(planner.bankRules).find(r=>r.id===planner.electricBillId&&r.choice==='bill')||planner.manual.find(b=>b.id===planner.electricBillId);
   const electricLabel=$('#electricBillSelection');if(electricLabel)electricLabel.textContent=electricRule?'Linked bill: '+electricRule.name:'Choose Electric and enable Gmail in a bill’s details to link it.';
   const estimates=review.bills.map(b=>({...b,...planner.estimates[b.id]}));
   const billPlan={...legacy,bills:[...(legacy.bills||[]).filter(b=>b.source!=='gmail'||b.billKind==='electric'||/consumers\s*energy|@(?:[a-z0-9-]+\.)*consumersenergy\.com/i.test((b.name||'')+' '+(b.sender||''))),...estimates]};
   $('#bankBillStatus').textContent=estimates.length+' tracked bank bill'+(estimates.length===1?'':'s')+'. Rent uses the latest payment amount; Gmail confirms your electric bill.';
   $('#transactionCount').textContent=review.rows.length+' transactions';
   const filter=$('#transactionFilter').value,activity=review.rows.filter(t=>(filter==='all'||t.choice===filter)&&(!spendingCategory||t.spendingCategoryKey===spendingCategory));
   $('#bankTransactions').innerHTML=activity.slice(0,transactionLimit).map(t=>'<div class="transaction-entry"><div class="bill-entry-top"><span>'+esc(t.name)+'</span><strong>'+money(Math.round(t.amount*100))+'</strong></div><small>'+esc(dateLabel(t.date)+' · '+t.label)+'</small><div class="bill-actions"><button type="button" data-track-transaction="'+esc(t.transaction_id)+'" '+(t.choice==='bill'?'disabled':'')+'>'+(t.choice==='bill'?'Tracking bill':'Track bill')+'</button><button type="button" data-spending-transaction="'+esc(t.transaction_id)+'" '+(planner.bankRules[t.key]?.choice==='spending'?'disabled':'')+'>Personal spending</button>'+(planner.bankRules[t.key]?'<button type="button" data-reset-transaction="'+esc(t.transaction_id)+'">Undo choice</button>':'')+'</div></div>').join('')||'<p class="subtle">'+(review.rows.length?'No transactions in this group.':'Refresh your bank to load recent outgoing transactions.')+'</p>';
   $('#moreTransactions').hidden=activity.length<=transactionLimit;

   $('#incomeBalances').innerHTML=visible.length?rows:'<p class="subtle">'+(accounts.length?'Choose accounts to show your balances.':authenticated?'Connect your bank in Settings to see your balances here.':'Sign in and connect your bank in Settings to see your balances.')+'</p>';
   $('#incomeBankUpdated').textContent=connections.bankUpdated?'Last synced '+new Date(connections.bankUpdated).toLocaleString():'';
   const today=iso(new Date()),start=iso(month),end=iso(new Date(month.getFullYear(),month.getMonth()+1,0));
   const bills=model.billEvents(billPlan,planner,linked,start,end),paydays=model.paydayEvents(plan,start,end);
   $('#calendarMonth').textContent=month.toLocaleDateString('en-US',{month:'long',year:'numeric'});
   let cells='<span></span>'.repeat(month.getDay());
   for(let d=1;d<=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();d++){
    const date=iso(new Date(month.getFullYear(),month.getMonth(),d)),due=bills.filter(b=>b.date===date),pay=paydays.filter(p=>p.date===date);
    cells+='<button type="button" data-calendar-day="'+date+'" aria-label="'+esc(dateLabel(date)+(due.length?', '+due.length+' bills':'')+(pay.length?', payday':''))+'" aria-pressed="'+(selected===date)+'" class="'+(date===today?'today ':'')+(selected===date?'selected':'')+'">'+d+'<span class="day-dots">'+(due.length?'<i class="bill-dot"></i>':'')+(pay.length?'<i class="pay-dot"></i>':'')+'</span></button>';
   }
   $('#billCalendar').innerHTML=cells;$('#clearDay').hidden=!selected;
   $('#agendaHeading').textContent=selected?dateLabel(selected):'Bills this month';
   const list=bills.filter(b=>selected?b.date===selected:true);
   const paydayHtml=selected?paydays.filter(p=>p.date===selected).map(p=>'<div class="bill-entry"><div class="bill-entry-top"><span>'+esc(p.name)+'</span><strong>+'+money(p.amount)+'</strong></div><small>Planned take-home pay · Edit in Trackers</small></div>').join(''):'';
   $('#billAgenda').innerHTML=paydayHtml+list.map(b=>{
    const editable=['bank-tracked','manual'].includes(b.source),d=new Date(b.date+'T12:00:00'),category=billCategories[b.billKind]||'Bill',gmail=(b.gmailConfirmed||b.source==='gmail')?'Confirmed by Gmail':planner.electricBillId===b.id?'Gmail linked · Estimated':'Estimated';
    return '<article class="bill-tile"><div class="bill-tile-main"><div class="bill-date '+(b.date<today?'is-overdue':'')+'"><span>'+esc(d.toLocaleDateString('en-US',{month:'short'}))+'</span><strong>'+d.getDate()+'</strong></div><div class="bill-tile-info"><h4>'+esc(b.name)+'</h4><span class="bill-category">'+esc(category)+'</span><small>'+esc(b.date<today?'Overdue':gmail)+'</small></div><div class="bill-tile-right"><strong>'+money(b.amount)+'</strong>'+(editable?'<button type="button" class="bill-icon-button" data-edit-bill="'+esc(b.id)+'" aria-label="Edit '+esc(b.name)+'" title="Edit bill">'+pencil+'</button>':'')+'</div></div><div class="bill-tile-footer"><span>'+esc(b.covered?'Included in tracker budget':b.repeat==='once'?'One-time payment':({monthly:'Monthly',biweekly:'Every two weeks',weekly:'Weekly'})[b.repeat]||'Scheduled')+'</span><button class="bill-paid-button" data-bill-paid="'+esc(b.key)+'">✓ Mark paid</button></div></article>';
   }).join('')||'<p class="subtle">No unpaid bills '+(selected?'on this day.':'this month. Track a bill from your recent transactions.')+'</p>';
   const paidBills=model.billEvents(billPlan,{...planner,paid:[]},linked,start,end).filter(b=>planner.paid.includes(b.key));
   if(paidBills.length)$('#billAgenda').insertAdjacentHTML('beforeend','<details class="add-bill"><summary>Paid bills ('+paidBills.length+')</summary>'+paidBills.map(b=>'<div class="bill-entry"><div class="bill-entry-top"><span>'+esc(b.name)+'</span><strong>'+money(b.amount)+'</strong></div><small>'+esc(dateLabel(b.date))+'</small><button data-bill-unpaid="'+esc(b.key)+'">Mark unpaid</button></div>').join('')+'</details>');
   const paidAmount=paidBills.reduce((n,b)=>n+b.amount,0),unpaidAmount=bills.reduce((n,b)=>n+b.amount,0),totalBills=paidBills.length+bills.length,paidPercent=paidAmount+unpaidAmount?Math.round(paidAmount/(paidAmount+unpaidAmount)*100):0;
   $('#billVisuals').innerHTML='<div class="bill-progress"><div class="progress-ring" role="img" aria-label="'+paidPercent+' percent of bill amount paid" style="background:conic-gradient(var(--accent) '+paidPercent+'%,var(--line) 0)"><span><strong>'+paidPercent+'%</strong><small>paid</small></span></div><div><span class="chart-eyebrow">Bills overview</span><strong>'+money(unpaidAmount)+'</strong><small>remaining · '+paidBills.length+' of '+totalBills+' paid</small></div></div>';
   const future=iso(new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()+30)),forecastBills=model.billEvents(billPlan,planner,linked,today,future),forecastPays=model.paydayEvents(plan,today,future,{billsOnly:true}),f=model.cashForecast(accounts,forecastPays,forecastBills,today);
   const groups=review.spending.categories||[],spendingTotal=review.spending.total;let angle=0;
   const stops=groups.map((g,i)=>{const from=angle;angle+=g.amount/spendingTotal*360;return chartColors[i%chartColors.length]+' '+from+'deg '+angle+'deg';});
   $('#spendingDonut').innerHTML='<div class="spending-chart"><div class="spending-ring" role="img" aria-label="'+esc('Personal spending total '+money(spendingTotal))+'" style="background:'+(stops.length?'conic-gradient('+stops.join(',')+')':'var(--line)')+'"><div><small>SPENT</small><strong>'+money(spendingTotal)+'</strong><span>last 30 days</span></div></div><div class="spending-highlight"><span class="chart-eyebrow">Your spending mix</span><strong>'+esc(groups[0]?.label||'A fresh start')+'</strong><p>'+(groups.length?Math.round(groups[0].amount/spendingTotal*100)+'% went to this category. Tap a category below to explore.':'Your chart fills in as bank purchases arrive.')+'</p></div></div>';
   $('#personalSpending').innerHTML=groups.map((g,i)=>'<button type="button" class="spending-category" data-spending-category="'+esc(g.key)+'"><span class="category-heading"><span><i style="background:'+chartColors[i%chartColors.length]+'"></i>'+esc(g.label)+'</span><strong>'+money(g.amount)+'</strong></span><span class="category-bar"><i style="width:'+g.amount/spendingTotal*100+'%;background:'+chartColors[i%chartColors.length]+'"></i></span><small>'+g.count+' purchase'+(g.count===1?'':'s')+' · '+Math.round(g.amount/spendingTotal*100)+'%</small></button>').join('');
   $('#spendingForecastNote').textContent='Total spent in the last 30 days: '+money(review.spending.total)+'. For tracking only; these purchases are not deducted from your forecast.';
   forecastPoints=[];
   if(f.opening!==null){
    let running=f.opening;
    for(let i=0;i<=30;i++){const date=modelDay(today,i);for(const r of f.rows.filter(r=>r.date===date))running+=r.delta;forecastPoints.push({date,balance:running});}
    const values=forecastPoints.map(p=>p.balance),low=Math.min(...values,0),high=Math.max(...values,1),span=high-low||1,xy=forecastPoints.map((p,i)=>[12+i*9.2,130-(p.balance-low)/span*110]),path=xy.map(([x,y],i)=>(i?'L':'M')+x.toFixed(1)+','+y.toFixed(1)).join(' ');
    $('#forecastChart').innerHTML='<div class="forecast-chart"><svg viewBox="0 0 300 150" role="img" aria-label="Projected bank balance over the next 30 days"><title>Bill forecast: '+esc(money(f.endBalance))+' at the end of 30 days</title><path d="'+path+' L288,140 L12,140 Z" fill="var(--accent)" opacity=".09"/><path d="'+path+'" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/><line id="forecastCursor" x1="288" x2="288" y1="12" y2="140" stroke="var(--muted)" stroke-dasharray="3 4"/></svg><div class="chart-axis"><span>'+esc(dateLabel(today))+'</span><span>'+esc(dateLabel(f.end))+'</span></div><label class="chart-scrubber">Explore your balance<input type="range" id="forecastScrub" min="0" max="30" value="30" aria-label="Forecast day"></label><output id="forecastPoint" aria-live="polite">'+esc(dateLabel(f.end))+' · '+money(f.endBalance)+'</output></div>';
   }else $('#forecastChart').innerHTML='';
   const unknown=f.opening===null;
   $('#incomeForecast').innerHTML='<p class="subtle">'+(unknown?'Connect a checking account to see your projected balance.':'Projected available on '+dateLabel(f.end))+'</p><div class="forecast-main">'+(unknown?'—':money(f.endBalance))+'</div><div class="forecast-stats"><div><small>Expected income</small><strong>'+money(f.income)+'</strong></div><div><small>Planned outflow</small><strong>'+money(f.outgoing)+'</strong></div><div><small>Starting balance</small><strong>'+(unknown?'—':money(f.opening))+'</strong></div><div><small>Lowest projected balance</small><strong>'+(unknown?'—':money(f.low))+'</strong></div></div>'+(f.low!==null&&f.low<0?'<p class="forecast-warning">Your planned spending exceeds available cash by up to '+money(-f.low)+'. Review upcoming bills and paycheck allocations.</p>':'')+(!plan.state.startDate?'<p class="forecast-warning">Set your first payday and take-home pay in Trackers to include income in this forecast.</p>':'')+f.rows.filter(r=>r.type!=='spending').map(r=>'<div class="forecast-row"><span>'+esc(r.name)+'<small>'+esc(dateLabel(r.date)+(r.type==='income'?' · after planned allocations':r.overdue?' · overdue bill':' · bill'))+'</small></span><strong>'+(r.delta>=0?'+':'−')+money(Math.abs(r.delta))+'</strong></div>').join('');
  }catch(e){error(e);}
 }
 document.addEventListener('click',async e=>{
  if(e.target.closest('[data-choose-accounts]'))$('#accountPicker').showModal();
  const hide=e.target.closest('[data-estimate-dismiss]');if(hide){try{const bill=review.bills.find(b=>b.id===hide.dataset.estimateDismiss);if(bill)delete planner.bankRules[bill.groupKey];await save();}catch(e){error(e);}}
 });
 $('#restoreBankEstimates').onclick=async()=>{try{planner.dismissedEstimates=[];await save();}catch(e){error(e);}};
 $('#closeAccountPicker').onclick=()=>$('#accountPicker').close();
 $('#accountPicker').addEventListener('click',e=>{if(e.target===$('#accountPicker')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
 document.addEventListener('change',async e=>{const input=e.target.closest('[data-account-visible]');if(!input)return;input.disabled=true;const id=input.dataset.accountVisible,old=planner.accountVisibility[id];planner.accountVisibility[id]=input.checked;try{await save();$('#accountPickerStatus').textContent='Saved';}catch(e){if(old===undefined)delete planner.accountVisibility[id];else planner.accountVisibility[id]=old;input.checked=!input.checked;$('#accountPickerStatus').textContent=e.message;}finally{input.disabled=false;}});


 function openBillEditor(id,transaction){
  const manual=planner.manual.find(b=>b.id===id),raw=review.bills.find(b=>b.id===id),existing=raw?planner.bankRules[raw.groupKey]:null;
  let base=manual||raw;
  if(transaction){const temporary={choice:'bill',id:'new',name:transaction.name,amount:Math.round(transaction.amount*100),lastPayment:transaction.date,repeat:'monthly'};base=model.reviewBankActivity([transaction],{[transaction.key]:temporary},[],iso(new Date())).bills[0];}
  if(!base)return;
  const b={...base,...planner.estimates[base.id]},form=$('#billEditorForm');
  editingBill={id:transaction?null:id,key:transaction?.key||raw?.groupKey,transaction,base,manual:!!manual};
  form.reset();form.elements.name.value=b.name;form.elements.billKind.value=billCategories[b.billKind]?b.billKind:'other';form.elements.amount.value=b.amount/100;form.elements.date.value=b.date;form.elements.repeat.value=b.repeat||'monthly';form.elements.covered.checked=!!planner.covered[id];
  form.elements.gmailElectric.checked=planner.electricBillId===id||(!planner.electricBillId&&b.billKind==='electric');
  $('#electricLinkOption').hidden=form.elements.billKind.value!=='electric';
  $('#billEditorTitle').textContent=transaction?'Track a bill':'Bill details';$('#billEditorSource').textContent=transaction?'Bank transaction: '+transaction.name:raw?'Linked to your bank transactions. Your custom name stays the same after a sync.':'Your manually added bill.';
  $('#stopTrackingBill').hidden=!!transaction;$('#billEditorError').textContent='';$('#billEditor').showModal();
 }
 document.addEventListener('click',e=>{const button=e.target.closest('[data-edit-bill]');if(button)openBillEditor(button.dataset.editBill);});
 $('#billCategory').onchange=e=>{const electric=e.target.value==='electric';$('#electricLinkOption').hidden=!electric;if(electric&&!planner.electricBillId)$('#billEditorForm').elements.gmailElectric.checked=true;};
 $('#closeBillEditor').onclick=()=>$('#billEditor').close();
 $('#billEditor').addEventListener('click',e=>{if(e.target===e.currentTarget){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
 $('#billEditorForm').onsubmit=async e=>{
  e.preventDefault();if(!editingBill)return;const form=e.currentTarget,d=new FormData(form),name=String(d.get('name')).trim(),amount=Math.round(Number(d.get('amount'))*100),date=d.get('date'),repeat=d.get('repeat'),billKind=d.get('billKind');
  if(!name||!Number.isSafeInteger(amount)||amount<=0||!date||!billCategories[billKind])return;
  const snapshot=structuredClone(planner),button=form.querySelector('[type=submit]');button.disabled=true;
  try{
   const id=editingBill.id||'tracked-'+crypto.randomUUID();
   if(editingBill.manual){const b=planner.manual.find(b=>b.id===id);Object.assign(b,{name,amount,date,repeat,billKind});}
   else{
    const old=planner.bankRules[editingBill.key]||{},t=editingBill.transaction;
    planner.bankRules[editingBill.key]={...old,choice:'bill',id,name,billKind,amount:editingBill.base.amount,lastPayment:t?.date||editingBill.base.lastPayment,repeat};
    const correction={};if(amount!==editingBill.base.amount)correction.amount=amount;if(date!==editingBill.base.date)correction.date=date;planner.estimates[id]=correction;
   }
   planner.covered[id]=d.has('covered');
   if(billKind==='electric'&&d.has('gmailElectric'))planner.electricBillId=id;else if(planner.electricBillId===id)delete planner.electricBillId;
   await save();$('#billEditor').close();$('#transactionStatus').textContent='Bill saved.';
  }catch(e){planner=snapshot;$('#billEditorError').textContent=e.message;}finally{button.disabled=false;}
 };
 $('#stopTrackingBill').onclick=async()=>{
  if(!editingBill?.id)return;const snapshot=structuredClone(planner),id=editingBill.id;
  try{if(editingBill.manual)planner.manual=planner.manual.filter(b=>b.id!==id);else delete planner.bankRules[editingBill.key];delete planner.estimates[id];delete planner.covered[id];if(planner.electricBillId===id)delete planner.electricBillId;await save();$('#billEditor').close();}catch(e){planner=snapshot;$('#billEditorError').textContent=e.message;}
 };

 document.addEventListener('click',e=>{const category=e.target.closest('[data-spending-category]');if(!category)return;spendingCategory=category.dataset.spendingCategory;$('#transactionFilter').value='spending';transactionLimit=10;$('#bankActivityCard').open=true;renderIncome();$('#bankActivityCard').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
 document.addEventListener('input',e=>{if(e.target.id!=='forecastScrub')return;const index=Number(e.target.value),point=forecastPoints[index];if(!point)return;$('#forecastPoint').textContent=dateLabel(point.date)+' · '+money(point.balance);$('#forecastCursor').setAttribute('x1',12+index*9.2);$('#forecastCursor').setAttribute('x2',12+index*9.2);});
 $('#transactionFilter').onchange=()=>{spendingCategory=null;transactionLimit=10;renderIncome();};
 $('#moreTransactions').onclick=()=>{transactionLimit+=20;renderIncome();};
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-track-transaction],[data-spending-transaction],[data-reset-transaction]');if(!button)return;
  const id=button.dataset.trackTransaction||button.dataset.spendingTransaction||button.dataset.resetTransaction,t=review.rows.find(t=>t.transaction_id===id);if(!t)return;
  if(button.dataset.trackTransaction){openBillEditor(null,t);return;}
  const old=planner.bankRules[t.key];button.disabled=true;
  try{
   if(button.dataset.resetTransaction)delete planner.bankRules[t.key];
   else if(button.dataset.spendingTransaction)planner.bankRules[t.key]={choice:'spending'};
   else planner.bankRules[t.key]={choice:'bill',id:old?.id||'tracked-'+crypto.randomUUID(),name:t.name,amount:Math.round(t.amount*100),lastPayment:t.date,repeat:'monthly'};
   if(old?.id===planner.electricBillId)delete planner.electricBillId;
   await save();$('#transactionStatus').textContent=button.dataset.trackTransaction?'Bill added to your calendar. You can edit its amount, date, and frequency below.':button.dataset.spendingTransaction?'Marked as personal spending. Spending history updated.':'Choice removed.';
  }catch(e){if(old)planner.bankRules[t.key]=old;else delete planner.bankRules[t.key];error(e);}finally{button.disabled=false;}
 });

 $('#monthPrev').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);selected=null;renderIncome();};
 $('#monthNext').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);selected=null;renderIncome();};
 $('#clearDay').onclick=()=>{selected=null;renderIncome();};
 document.addEventListener('click',async e=>{
  const day=e.target.closest('[data-calendar-day]');if(day){selected=day.dataset.calendarDay;renderIncome();}
  const b=e.target.closest('[data-bill-paid],[data-bill-remove],[data-bill-unpaid]');if(!b)return;
  b.disabled=true;
  try{if(b.dataset.billUnpaid){planner.paid=planner.paid.filter(k=>k!==b.dataset.billUnpaid);await save();}if(b.dataset.billPaid){planner.paid.push(b.dataset.billPaid);await save();$('#incomeStatus').textContent='Bill marked paid. Your bank balance changes on the next sync.';}if(b.dataset.billRemove&&confirm('Delete this bill and its future occurrences?')){planner.manual=planner.manual.filter(x=>x.id!==b.dataset.billRemove);delete planner.covered[b.dataset.billRemove];await save();}}catch(e){error(e);}finally{b.disabled=false;}
 });
 document.addEventListener('change',async e=>{const b=e.target.closest('[data-bill-covered]');if(!b)return;try{planner.covered[b.dataset.billCovered]=b.checked;await save();}catch(e){error(e);}});
 $('#incomeBillForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button'),d=new FormData(f),amount=Math.round(Number(d.get('amount'))*100),name=d.get('name').trim(),date=d.get('date');if(!name||!Number.isSafeInteger(amount)||amount<=0||!/^\d{4}-\d{2}-\d{2}$/.test(date))return;const id='manual-'+crypto.randomUUID();b.disabled=true;try{planner.manual.push({id,name,amount,date,repeat:d.get('repeat'),source:'manual'});planner.covered[id]=d.has('covered');await save();f.reset();month=new Date(date+'T12:00:00');month.setDate(1);selected=null;renderIncome();}catch(e){error(e);}finally{b.disabled=false;}};
})();
