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
 const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
 let month=new Date(new Date().getFullYear(),new Date().getMonth(),1),selected=null,model,planner={manual:[],covered:{},paid:[],accountVisibility:{},dismissedEstimates:[],estimates:{}},linked={},ready=false;
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
   const rows=visible.map(a=>'<div class="bank-row"><span>'+esc(a.name)+'<small>'+esc(a.include&&(a.currency||'USD')==='USD'?'Included in forecast':'Not included in forecast')+'</small></span><strong>'+esc(money(a.balance,a.currency))+'</strong></div>').join('');
   $('#debtIncomeBalances').innerHTML=rows||'<p class="subtle">'+(accounts.length?'Choose accounts to show your bank balances.':authenticated?'Connect your bank in Settings to see your balances.':'Sign in and connect your bank in Settings.')+'</p>';
   $('#debtBankUpdated').textContent=connections.bankUpdated?'Last synced '+new Date(connections.bankUpdated).toLocaleString():'';
   $('#accountChoices').innerHTML=accounts.map(a=>'<label class="check-label"><input type="checkbox" data-account-visible="'+esc(a.id)+'" '+(visible.some(v=>v.id===a.id)?'checked':'')+'> '+esc(a.name)+'</label>').join('')||'<p class="subtle">Connect a bank in Settings first.</p>';
   $('#restoreBankEstimates').hidden=!planner.dismissedEstimates.length;
   const estimates=(connections.recurringBills||[]).filter(b=>!planner.dismissedEstimates.includes(b.id)).map(b=>({...b,...planner.estimates[b.id]}));
   const billPlan={...legacy,bills:[...(legacy.bills||[]),...estimates]};
   $('#bankBillStatus').textContent=accounts.length?'Bank history automatically adds regular bills after at least three matching payments. Bank dates and amounts are estimates; confirmed email bills take priority. '+estimates.length+' bank estimate(s) detected.':'Connect a bank in Settings to automatically detect recurring bills.';

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
   $('#billAgenda').innerHTML=(selected?paydays.filter(p=>p.date===selected).map(p=>'<div class="bill-entry"><div class="bill-entry-top"><span>'+esc(p.name)+'</span><strong>+'+money(p.amount)+'</strong></div><small>Planned take-home pay · Edit in Debt</small></div>').join(''):'')+list.map(b=>'<div class="bill-entry"><div class="bill-entry-top"><span>'+esc(b.name)+'</span><strong>'+money(b.amount)+'</strong></div><small class="'+(b.date<today?'overdue':'')+'">'+esc(dateLabel(b.date)+(b.date<today?' · Overdue':'')+' · '+(b.source==='bank-estimate'?'Bank estimate · '+b.repeat:b.source==='gmail'?'Gmail':b.source==='manual'?'Added by you':'Existing bill'))+'</small><label class="check-label"><input type="checkbox" data-bill-covered="'+esc(b.id)+'" '+(b.covered?'checked ':'')+(linked[b.id]?'disabled ':'')+'> '+(linked[b.id]?'Added to a Debt paycheck':'Covered by Debt budget')+'</label><div class="bill-actions"><button data-bill-paid="'+esc(b.key)+'">Mark paid</button>'+(b.source==='bank-estimate'?'<button data-estimate-dismiss="'+esc(b.id)+'">Hide estimate</button>':'')+(b.source==='manual'?'<button data-bill-remove="'+esc(b.id)+'">Delete</button>':'')+'</div>'+(b.source==='bank-estimate'?'<details class="add-bill"><summary>Correct estimate</summary><form data-estimate-edit="'+esc(b.id)+'"><label>Amount ($)<input name="amount" type="number" min="0.01" step="0.01" required value="'+b.amount/100+'"></label><label>Next payment<input name="date" type="date" required value="'+esc(b.date)+'"></label><button>Save correction</button></form></details>':'')+'</div>').join('')||'<p class="subtle">No unpaid bills '+(selected?'on this day.':'this month. Add a bill below or connect your bank in Settings.')+'</p>';
   const paidBills=model.billEvents(billPlan,{...planner,paid:[]},linked,start,end).filter(b=>planner.paid.includes(b.key));
   if(paidBills.length)$('#billAgenda').insertAdjacentHTML('beforeend','<details class="add-bill"><summary>Paid bills ('+paidBills.length+')</summary>'+paidBills.map(b=>'<div class="bill-entry"><div class="bill-entry-top"><span>'+esc(b.name)+'</span><strong>'+money(b.amount)+'</strong></div><small>'+esc(dateLabel(b.date))+'</small><button data-bill-unpaid="'+esc(b.key)+'">Mark unpaid</button></div>').join('')+'</details>');
   const future=iso(new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate()+30)),forecastBills=model.billEvents(billPlan,planner,linked,today,future),forecastPays=model.paydayEvents(plan,today,future),f=model.cashForecast(accounts,forecastPays,forecastBills,today);
   const unknown=f.opening===null;
   $('#incomeForecast').innerHTML='<p class="subtle">'+(unknown?'Connect a checking account to see your projected balance.':'Projected available on '+dateLabel(f.end))+'</p><div class="forecast-main">'+(unknown?'—':money(f.endBalance))+'</div><div class="forecast-stats"><div><small>Expected income</small><strong>'+money(f.income)+'</strong></div><div><small>Planned outflow</small><strong>'+money(f.outgoing)+'</strong></div><div><small>Starting balance</small><strong>'+(unknown?'—':money(f.opening))+'</strong></div><div><small>Lowest projected balance</small><strong>'+(unknown?'—':money(f.low))+'</strong></div></div>'+(f.low!==null&&f.low<0?'<p class="forecast-warning">Your planned spending exceeds available cash by up to '+money(-f.low)+'. Review upcoming bills and paycheck allocations.</p>':'')+(!plan.state.startDate?'<p class="forecast-warning">Set your first payday and take-home pay in Debt to include income in this forecast.</p>':'')+f.rows.map(r=>'<div class="forecast-row"><span>'+esc(r.name)+'<small>'+esc(dateLabel(r.date)+(r.type==='income'?' · after planned allocations':r.overdue?' · overdue bill':' · bill'))+'</small></span><strong>'+(r.delta>=0?'+':'−')+money(Math.abs(r.delta))+'</strong></div>').join('');
  }catch(e){error(e);}
 }
 document.addEventListener('click',async e=>{
  if(e.target.closest('[data-choose-accounts]'))$('#accountPicker').showModal();
  const hide=e.target.closest('[data-estimate-dismiss]');if(hide){try{planner.dismissedEstimates.push(hide.dataset.estimateDismiss);await save();}catch(e){error(e);}}
 });
 $('#restoreBankEstimates').onclick=async()=>{try{planner.dismissedEstimates=[];await save();}catch(e){error(e);}};
 $('#closeAccountPicker').onclick=()=>$('#accountPicker').close();
 $('#accountPicker').addEventListener('click',e=>{if(e.target===$('#accountPicker')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
 document.addEventListener('change',async e=>{const input=e.target.closest('[data-account-visible]');if(!input)return;input.disabled=true;const id=input.dataset.accountVisible,old=planner.accountVisibility[id];planner.accountVisibility[id]=input.checked;try{await save();$('#accountPickerStatus').textContent='Saved';}catch(e){if(old===undefined)delete planner.accountVisibility[id];else planner.accountVisibility[id]=old;input.checked=!input.checked;$('#accountPickerStatus').textContent=e.message;}finally{input.disabled=false;}});
 document.addEventListener('submit',async e=>{const form=e.target.closest('[data-estimate-edit]');if(!form)return;e.preventDefault();const d=new FormData(form),amount=Math.round(Number(d.get('amount'))*100),date=d.get('date');if(!Number.isSafeInteger(amount)||amount<=0||!date)return;try{planner.estimates[form.dataset.estimateEdit]={amount,date};await save();}catch(e){error(e);}});
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
