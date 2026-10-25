'use strict';
(()=>{
 const $=s=>document.querySelector(s),tabs=['debt','income','accounts','tools','settings'],positions={};let active='debt';
 window.selectBearTab=name=>{
  if(!tabs.includes(name))return;
  if(active==='tools'&&name!=='tools'&&$('#gamesSection').classList.contains('open'))window.toggleGamesSection();
  positions[active]=scrollY;active=name;
  for(const tab of tabs){$('#tab-'+tab).hidden=tab!==name;const b=$('#nav-'+tab);b.setAttribute('aria-selected',String(tab===name));b.tabIndex=tab===name?0:-1;}
  window.scrollTo(0,positions[name]||0);
  if(['income','accounts','debt'].includes(name))renderIncome();
  if(name==='tools')window.dispatchEvent(new Event('resize'));
 };
 document.addEventListener('click',e=>{const tab=e.target.closest('[data-tab]');if(tab)window.selectBearTab(tab.dataset.tab);if(e.target.closest('[data-open-settings]'))window.selectBearTab('settings');});
 $('.bottom-tabs').addEventListener('keydown',e=>{const i=tabs.indexOf(e.target.closest('[data-tab]')?.dataset.tab);if(i<0)return;const n=e.key==='ArrowRight'?(i+1)%tabs.length:e.key==='ArrowLeft'?(i+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:-1;if(n<0)return;e.preventDefault();window.selectBearTab(tabs[n]);$('#nav-'+tabs[n]).focus();});
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format(n/100);
 const modelDay=(s,n)=>{const d=new Date(s+'T12:00:00');d.setDate(d.getDate()+n);return iso(d);};
 const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
 let editingBill=null,spendingCategory=null,forecastPoints=[];
 const chartColors=['#168b83','#ed896f','#d6a74b','#547eab','#a17ca7','#7fa873','#91847a'];
 const billCategories={electric:'Electric',rent:'Rent',utility:'Utility','car-payment':'Car payment',insurance:'Insurance','phone-internet':'Phone & internet',subscription:'Subscription','credit-card':'Credit card',loan:'Loan payment',other:'Other bill'};
 const pencil='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg>';
 let review={rows:[],bills:[],spending:{categories:[],total:0}};
 let month=new Date(new Date().getFullYear(),new Date().getMonth(),1),selected=null,model,planner={manual:[],covered:{},paid:[],accountVisibility:{},dismissedEstimates:[],estimates:{},bankRules:{},creditCards:{}},linked={},ready=false;
 function error(e){$('#incomeStatus').textContent=e.message||String(e);$('#accountStatus').textContent=e.message||String(e);$('#accountSaveStatus').textContent=e.message||String(e);}
 async function save(){await window.BearDen.storage.set('income-planner',JSON.stringify(planner));$('#incomeStatus').textContent='Saved';$('#accountStatus').textContent='Saved';await renderIncome();}
 let initializing;
 function initialize(){return initializing??=(async()=>{try{await window.classicReady;model=await import('./income-model.mjs');const stored=await window.BearDen.storage.get('income-planner');if(stored)planner={...planner,...JSON.parse(stored.value)};ready=true;await renderIncome();}catch(e){error(e);}})();}
 window.addEventListener('load',initialize,{once:true});
 window.addEventListener('bearden-connections',()=>{if(ready)renderIncome();});
 function renderCreditSummary(connections,accounts){
  const cards=connections.creditCards||[],value=(n,c)=>n===null||n===undefined?'Not shared':money(n,c.currency||'USD');
  $('#trackerCreditSection').hidden=!cards.length;
  $('#trackerCreditCards').innerHTML=cards.map(c=>'<div class="forecast-row"><span>'+esc(planner.creditCards[c.id]?.name||c.name)+'<small>'+esc(c.dueDate?'Minimum '+value(c.minimum,c)+' · due '+dateLabel(c.dueDate):'Due date not shared')+'</small></span><strong>'+esc(value(accounts.find(a=>a.id==='plaid-'+c.accountId)?.balance??c.balance,c))+'</strong></div>').join('');
 }
 const debtKinds={'credit-card':'Credit card','car-loan':'Car loan',loan:'Personal loan',other:'Debt'};
 function renderDebtAccounts(plan,connections,accounts,payments,paidPayments){
  const linkedCards=connections.creditCards||[],matched=new Set(linkedCards.map(c=>planner.creditCards[c.id]?.trackerCardId).filter(Boolean).map(String)),value=(n,c)=>n===null||n===undefined?'Not shared':money(n,c.currency||'USD');
  const connected=linkedCards.filter(c=>!selected||payments.some(b=>b.id===c.id||b.source==='tracker-debt'&&b.trackerCardId===planner.creditCards[c.id]?.trackerCardId)||paidPayments.some(b=>b.id===c.id&&b.date===selected)).map(c=>{
   const p=planner.creditCards[c.id]||{},balance=accounts.find(a=>a.id==='plaid-'+c.accountId)?.balance??c.balance,util=balance!==null&&c.limit>0?Math.max(0,balance/c.limit*100):null,apr=c.aprs.find(a=>a.type==='purchase_apr'),history=c.payments||[],due=payments.find(b=>b.id===c.id),paid=paidPayments.find(b=>b.id===c.id);
   let spark='';if(c.history?.length>1){const values=c.history.map(p=>p.balance),low=Math.min(...values),range=Math.max(...values)-low||1,points=values.map((v,i)=>(i/(values.length-1)*280+5).toFixed(1)+','+(52-(v-low)/range*40).toFixed(1)).join(' ');spark='<svg class="credit-spark" viewBox="0 0 290 60" role="img" aria-label="Balance history since connection"><title>Balance history since connection</title><polyline points="'+points+'" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';}
   const action=!p.tracking?'<button data-edit-credit="'+esc(c.id)+'">Track due date</button>':paid?'<button data-bill-unpaid="'+esc(paid.key)+'">Mark unpaid</button>':due?'<button data-bill-paid="'+esc(due.key)+'">✓ Mark paid</button>':'';
   return '<article class="debt-account connected-debt" data-account-id="'+esc(c.id)+'"><div class="debt-account-heading"><div><span class="chart-eyebrow">Credit card · Connected</span><h4>'+esc(p.name||c.name)+'</h4><small>'+esc(c.institution+(c.mask?' · ••'+c.mask:''))+'</small></div><div class="debt-account-tools"><button type="button" class="bill-icon-button" data-refresh-credit="'+esc(c.itemId)+'" aria-label="Refresh '+esc(c.name)+'">↻</button><button class="bill-icon-button" data-edit-credit="'+esc(c.id)+'" aria-label="Edit '+esc(c.name)+'">'+pencil+'</button></div></div><small class="debt-balance-label">Current balance</small><strong class="debt-balance">'+esc(value(balance,c))+'</strong>'+(c.overdue?'<p class="forecast-warning">Issuer reports this account overdue.</p>':'')+(c.stale?'<p class="subtle">Refresh needs attention; showing the last synced details.</p>':'')+(util!==null?'<div class="debt-progress"><span style="width:'+Math.min(100,util)+'%"></span></div><p class="subtle">'+Math.round(util)+'% of '+esc(value(c.limit,c))+' credit limit</p>':'')+'<div class="debt-metrics"><div><small>Minimum due</small><strong>'+esc(value(c.minimum,c))+'</strong></div><div><small>Purchase APR</small><strong>'+esc(apr?Number(apr.rate.toFixed(2))+'%':'Not shared')+'</strong></div></div><div class="debt-account-footer"><span>'+esc(paid?'Marked paid':c.minimum===0?'No minimum due':c.dueDate?'Due '+dateLabel(c.dueDate):'Due date not shared')+'</span>'+action+'</div><details class="credit-detail"><summary>Payments &amp; statement</summary>'+spark+'<p class="subtle">Statement: '+esc(value(c.statementBalance,c))+(c.statementDate?' · '+esc(dateLabel(c.statementDate)):'')+'</p>'+c.aprs.map(a=>'<p class="subtle">'+esc(a.type.replaceAll('_',' '))+': '+Number(a.rate.toFixed(2))+'%</p>').join('')+(history.length?'<div class="credit-payment-list">'+history.map(t=>'<div class="forecast-row"><span>'+esc(t.name)+'<small>'+esc(dateLabel(t.date))+'</small></span><strong>−'+esc(value(t.amount,c))+'</strong></div>').join('')+'</div>':'<p class="subtle">Posted payments appear here after your issuer sends them.</p>')+'<p class="subtle">'+(p.trackerCardId?'Matched to your payoff plan. ':'')+'Minimum payments use the issuer’s reported amount until marked paid or reported as zero.</p><p class="subtle">'+(c.stale?'Refresh needs attention. Last update: ':'Updated ')+esc(new Date(c.updated).toLocaleString())+'</p></details></article>';
  });
  const checked=Object.keys(plan.state.checkedPaychecks||{}).filter(k=>plan.state.checkedPaychecks[k]).map(Number),last=(plan.schedule||[]).find(r=>r.paycheck===Math.max(0,...checked));
  const manual=(plan.state.cards||[]).flatMap((c,index)=>{
   if(matched.has(String(c.id)))return [];
   const next=payments.find(b=>b.source==='tracker-debt'&&b.trackerCardId===String(c.id));if(selected&&!next)return [];
   const balance=Math.round((last?.balancesAfter?.[index]??c.balance)*100),starting=Math.round(c.balance*100),progress=starting>0?Math.min(100,Math.max(0,(starting-balance)/starting*100)):100;
   return '<article class="debt-account manual-debt" data-tracker-account="'+esc(c.id)+'"><div class="debt-account-heading"><div><span class="chart-eyebrow">'+esc(debtKinds[c.debtKind]||'Debt')+' · Payoff plan</span><h4>'+esc(c.name)+'</h4></div><button class="bill-icon-button" data-edit-debt="'+esc(c.id)+'" aria-label="Edit '+esc(c.name)+'">'+pencil+'</button></div><small class="debt-balance-label">'+(last?'Estimated remaining':'Starting balance')+'</small><strong class="debt-balance">'+money(balance)+'</strong><div class="debt-progress"><span style="width:'+progress+'%"></span></div><p class="subtle">'+Math.round(progress)+'% paid down in your plan</p><div class="debt-metrics"><div><small>Minimum per paycheck</small><strong>'+money(Math.round(c.min*100))+'</strong></div><div><small>APR</small><strong>'+esc(Number(Number(c.apr).toFixed(2)))+'%</strong></div></div><div class="debt-account-footer"><span>'+esc(next?dateLabel(next.date)+' · '+money(next.amount)+' planned':balance<=0?'Paid off in your plan':'Set up paydays in Income')+'</span><button type="button" data-tab="debt">Payoff plan</button></div></article>';
  });
  const paymentOnly=payments.filter(b=>model.isDebtPayment(b)&&!['tracker-debt','plaid-credit'].includes(b.source)).map(b=>'<article class="debt-account payment-only-debt"><div class="debt-account-heading"><div><span class="chart-eyebrow">Debt payment</span><h4>'+esc(b.name)+'</h4></div><button class="bill-icon-button" data-edit-bill="'+esc(b.id)+'" aria-label="Edit '+esc(b.name)+'">'+pencil+'</button></div><small class="debt-balance-label">Scheduled payment · '+esc(dateLabel(b.date))+'</small><strong class="debt-balance">'+money(b.amount)+'</strong><p class="subtle">Payment tracking only; no remaining balance has been entered.</p><div class="debt-account-footer"><span>'+esc(b.covered?'Included in payoff plan':'Scheduled payment')+'</span><button data-bill-paid="'+esc(b.key)+'">✓ Mark paid</button></div></article>');
  const all=[...connected,...manual,...paymentOnly];$('#debtAccounts').innerHTML=all.join('')||'<p class="subtle">'+(selected?'No debt payments on this day.':'Add a debt to track a balance, or connect your credit card with Plaid.')+'</p>';$('#debtAccountCount').textContent=all.length;
 }
 let editingDebt=null;
 function openDebtEditor(id=null,draft=null){
  const debt=id===null?null:window.getDebtPlan().state.cards.find(c=>String(c.id)===String(id));if(id!==null&&!debt)return;
  editingDebt=debt?.id??null;const form=$('#debtEditorForm');form.reset();
  form.elements.name.value=draft?.name||debt?.name||'';form.elements.debtKind.value=draft?.debtKind||debt?.debtKind||'credit-card';
  for(const [field,key]of [['balance','balance'],['apr','apr'],['minimum','min']])form.elements[field].value=draft?.[field]??debt?.[key]??'';
  $('#debtEditorTitle').textContent=debt?'Debt details':'Add debt';$('#debtConnectionChoice').hidden=!!debt;$('#debtHistoryButton').hidden=!debt;
  $('#debtExistingConnections').innerHTML=(window.BearDen.plan?.connections?.items||[]).map(i=>'<button type="button" data-credit-update="'+esc(i.id)+'" data-account-connect>Use '+esc(i.name)+' connection</button>').join('');
  const start=window.getDebtPlan().state.startDate;$('#debtPlanNote').textContent='This starting balance belongs to your payoff plan'+(start?' beginning '+dateLabel(start):'')+'. Payments use the payday schedule in Trackers.';
  $('#debtEditorError').textContent='';$('#debtEditor').showModal();
 }
 $('#debtHistoryButton').onclick=()=>{if(editingDebt!==null){$('#debtEditor').close();window.showDebtAccountHistory(editingDebt);}};
 $('#closeDebtHistory').onclick=()=>{$('#debtHistoryDialog').close();renderIncome();};
 $('#closeDebtEditor').onclick=()=>$('#debtEditor').close();$('#closeAccountTypePicker').onclick=()=>$('#accountTypePicker').close();
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-add-account],[data-open-account-add]')){$('#debtHistoryDialog').close();window.selectBearTab('accounts');$('#accountTypePicker').showModal();}
  const type=e.target.closest('[data-account-kind]');if(type){$('#accountTypePicker').close();if(type.dataset.accountKind==='debt')openDebtEditor();else openBillEditor(null,null,true);}
  const debt=e.target.closest('[data-edit-debt]');if(debt)openDebtEditor(debt.dataset.editDebt);
 });
 $('#debtEditorForm').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,d=new FormData(form),button=form.querySelector('[type=submit]');button.disabled=true;try{await window.saveDebtAccount({id:editingDebt,...Object.fromEntries(d)});await renderIncome();$('#debtEditor').close();sessionStorage.removeItem('bearden-debt-draft');$('#accountStatus').textContent='Debt saved to your payoff plan.';}catch(e){$('#debtEditorError').textContent=e.message;}finally{button.disabled=false;}};
 window.prepareDebtConnection=()=>{const draft=Object.fromEntries(new FormData($('#debtEditorForm')));sessionStorage.setItem('bearden-debt-draft',JSON.stringify(draft));$('#debtEditor').close();return {fromAccount:true,draftName:draft.name,beforeCardIds:(window.BearDen.plan?.connections?.creditCards||[]).map(c=>c.id)};};
 window.addEventListener('bearden-credit-connected',async e=>{
  window.selectBearTab('accounts');await initialize();if(!ready)return;await renderIncome();
  const options=e.detail.options,cards=window.BearDen.plan?.connections?.creditCards||[],newCards=cards.filter(c=>options.itemId?c.itemId===options.itemId:!(options.beforeCardIds||[]).includes(c.id));
  $('#creditStatus').textContent=e.detail.status||'Connected. Choose a debt below to finish setup.';
  if(options.fromAccount&&newCards.length===1)openCreditEditor(newCards[0].id,options.draftName);
 });
 window.addEventListener('bearden-credit-cancelled',e=>{if(!e.detail.options?.fromAccount)return;const draft=JSON.parse(sessionStorage.getItem('bearden-debt-draft')||'null');openDebtEditor(null,draft);$('#debtEditorError').textContent=e.detail.error||'';});
 for(const id of ['accountTypePicker','debtEditor','creditEditor','debtHistoryDialog'])$('#'+id).addEventListener('click',e=>{if(e.target!==e.currentTarget)return;const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();});
 let editingCredit=null;
 function openCreditEditor(id,draftName=''){
  const card=window.BearDen.plan?.connections?.creditCards?.find(c=>c.id===id);if(!card)return;editingCredit=card;
  const p=planner.creditCards[card.id]||{},form=$('#creditEditorForm'),cards=window.getDebtPlan().state.cards||[];
  form.reset();form.elements.name.value=draftName||p.name||card.name;form.elements.tracking.checked=p.tracking!==false;form.elements.covered.checked=!!p.covered;
  form.elements.amount.value=(card.minimum??p.fallbackAmount)!==undefined&&(card.minimum??p.fallbackAmount)!==null?(card.minimum??p.fallbackAmount)/100:'';form.elements.amount.disabled=card.minimum!==null;
  form.elements.date.value=card.dueDate||p.fallbackDate||'';form.elements.date.disabled=!!card.dueDate;
  form.elements.trackerCardId.innerHTML='<option value="">No matching debt</option>'+cards.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');form.elements.trackerCardId.value=p.trackerCardId||'';
  form.elements.replaces.innerHTML='<option value="">Keep my other bills</option>'+[...planner.manual,...review.bills].map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('');form.elements.replaces.value=p.replaces||'';
  $('#creditEditorError').textContent='';$('#debtEditor').close();$('#accountTypePicker').close();$('#creditEditor').showModal();
 }
 document.addEventListener('click',e=>{const button=e.target.closest('[data-edit-credit]');if(button)openCreditEditor(button.dataset.editCredit);});
 $('#closeCreditEditor').onclick=()=>$('#creditEditor').close();
 $('#creditEditorForm').onsubmit=async e=>{
  e.preventDefault();if(!editingCredit)return;const form=e.currentTarget,d=new FormData(form),old=planner.creditCards[editingCredit.id],button=form.querySelector('[type=submit]');
  const fallbackAmount=form.elements.amount.value===''?null:Math.round(Number(form.elements.amount.value)*100),fallbackDate=form.elements.date.value;
  if(d.has('tracking')&&editingCredit.currency!=='USD'){$('#creditEditorError').textContent='Only USD card bills can enter this forecast.';return;}
  if(d.has('tracking')&&((editingCredit.minimum===null&&(!Number.isSafeInteger(fallbackAmount)||fallbackAmount<0))||!editingCredit.dueDate&&!fallbackDate)){$('#creditEditorError').textContent='Add the minimum or due date your issuer has not shared.';return;}
  if(d.has('tracking')&&Object.entries(planner.creditCards).some(([id,p])=>id!==editingCredit.id&&p.tracking&&((d.get('trackerCardId')&&p.trackerCardId===d.get('trackerCardId'))||(d.get('replaces')&&p.replaces===d.get('replaces'))))){$('#creditEditorError').textContent='That debt or bill is already matched to another card.';return;}
  button.disabled=true;try{planner.creditCards[editingCredit.id]={tracking:d.has('tracking'),name:String(d.get('name')).trim(),covered:d.has('covered'),trackerCardId:String(d.get('trackerCardId')||''),replaces:String(d.get('replaces')||''),fallbackAmount,fallbackDate};await save();$('#creditEditor').close();sessionStorage.removeItem('bearden-debt-draft');}catch(e){if(old)planner.creditCards[editingCredit.id]=old;else delete planner.creditCards[editingCredit.id];$('#creditEditorError').textContent=e.message;}finally{button.disabled=false;}
 };
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
   const estimates=review.bills.map(b=>({...b,...planner.estimates[b.id],paidByCard:accounts.some(a=>a.type==='credit'&&a.id==='plaid-'+JSON.parse(b.groupKey)[1])}));
   const credit=model.creditBills(connections.creditCards||[],planner.creditCards);
   for(const bill of credit)if(planner.creditCards[bill.id]?.trackerCardId&&plan.state.cards?.some(c=>String(c.id)===planner.creditCards[bill.id].trackerCardId))bill.covered=true;
   renderCreditSummary(connections,accounts);
   const debtBills=model.trackerDebtBills(plan,credit,planner.creditCards);
   const billPlan={...legacy,bills:[...(legacy.bills||[]).filter(b=>b.source!=='gmail'||b.billKind==='electric'||/consumers\s*energy|@(?:[a-z0-9-]+\.)*consumersenergy\.com/i.test((b.name||'')+' '+(b.sender||''))),...estimates,...credit,...debtBills]};
   $('#bankBillStatus').textContent=estimates.length+' tracked bank bill'+(estimates.length===1?'':'s')+'. The calendar includes recurring bills and scheduled debt payments.';
   $('#transactionCount').textContent=review.rows.length+' transactions';
   const filter=$('#transactionFilter').value,activity=review.rows.filter(t=>(filter==='all'||t.choice===filter)&&(!spendingCategory||t.spendingCategoryKey===spendingCategory));
   $('#bankTransactions').innerHTML=activity.map(t=>'<div class="transaction-entry"><div class="bill-entry-top"><span>'+esc(t.name)+'</span><strong>'+money(Math.round(t.amount*100))+'</strong></div><small>'+esc(dateLabel(t.date)+' · '+t.label)+'</small><div class="bill-actions"><button type="button" data-track-transaction="'+esc(t.transaction_id)+'" '+(t.choice==='bill'?'disabled':'')+'>'+(t.choice==='bill'?'Tracking bill':'Track bill')+'</button><button type="button" data-spending-transaction="'+esc(t.transaction_id)+'" '+(planner.bankRules[t.key]?.choice==='spending'?'disabled':'')+'>Personal spending</button>'+(planner.bankRules[t.key]?'<button type="button" data-reset-transaction="'+esc(t.transaction_id)+'">Undo choice</button>':'')+'</div></div>').join('')||'<p class="subtle">'+(review.rows.length?'No transactions in this group.':'Refresh your bank to load recent outgoing transactions.')+'</p>';

   $('#incomeBalances').innerHTML=visible.length?rows:'<p class="subtle">'+(accounts.length?'Choose accounts to show your balances.':authenticated?'Connect your bank in Settings to see your balances here.':'Sign in and connect your bank in Settings to see your balances.')+'</p>';
   $('#incomeBankUpdated').textContent=connections.bankUpdated?'Last synced '+new Date(connections.bankUpdated).toLocaleString():'';
   const today=iso(new Date()),start=iso(month),end=iso(new Date(month.getFullYear(),month.getMonth()+1,0));
   const bills=model.billEvents(billPlan,planner,linked,start,end),paydays=model.paydayEvents(plan,start,end);
   $('#calendarMonth').textContent=month.toLocaleDateString('en-US',{month:'long',year:'numeric'});
   let cells='<span></span>'.repeat(month.getDay());
   for(let d=1;d<=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();d++){
    const date=iso(new Date(month.getFullYear(),month.getMonth(),d)),due=bills.filter(b=>b.date===date),pay=paydays.filter(p=>p.date===date);
    cells+='<button type="button" data-calendar-day="'+date+'" aria-label="'+esc(dateLabel(date)+(due.length?', '+due.length+' payments':'')+(pay.length?', payday':''))+'" aria-pressed="'+(selected===date)+'" class="'+(date===today?'today ':'')+(selected===date?'selected':'')+'">'+d+'<span class="day-dots">'+(due.length?'<i class="bill-dot"></i>':'')+(pay.length?'<i class="pay-dot"></i>':'')+'</span></button>';
   }
   $('#billCalendar').innerHTML=cells;$('#clearDay').hidden=!selected;
   $('#agendaHeading').textContent=selected?'Due '+dateLabel(selected):'Your accounts';
   const paidBills=model.billEvents(billPlan,{...planner,paid:[]},linked,start,end).filter(b=>planner.paid.includes(b.key)),yearEnd=modelDay(today,366);
   const upcomingBills=model.billEvents(billPlan,planner,linked,today,yearEnd);
   for(const bill of [...billPlan.bills,...planner.manual])if(bill.source!=='tracker-debt'&&bill.date>yearEnd&&!upcomingBills.some(b=>b.id===bill.id))upcomingBills.push(...model.billEvents({bills:[bill]},{...planner,manual:[]},linked,bill.date,bill.date));
   upcomingBills.sort((a,b)=>a.date.localeCompare(b.date));
   const payments=model.accountPaymentRows(selected?bills:upcomingBills,selected),list=payments.filter(b=>!model.isDebtPayment(b));
   const accountPaid=model.billEvents(billPlan,{...planner,paid:[]},linked,today,yearEnd).filter(b=>planner.paid.includes(b.key));
   renderDebtAccounts(plan,connections,accounts,payments,accountPaid);
   const billTile=(b,paid=false)=>{
    const editable=['bank-tracked','manual'].includes(b.source),d=new Date(b.date+'T12:00:00'),category=billCategories[b.billKind]||'Bill',status=paid?'Marked paid':(b.gmailConfirmed||b.source==='gmail')?'Confirmed by Gmail':planner.electricBillId===b.id?'Gmail linked · Estimated':'Estimated';
    return '<article class="bill-tile recurring-account" data-account-id="'+esc(b.id)+'"><div class="bill-tile-main"><div class="bill-date '+(b.date<today&&!paid?'is-overdue':'')+'"><span>'+esc(d.toLocaleDateString('en-US',{month:'short'}))+'</span><strong>'+d.getDate()+'</strong></div><div class="bill-tile-info"><h4>'+esc(b.name)+'</h4><span class="bill-category">'+esc(category)+'</span><small>'+esc(b.date<today&&!paid?'Overdue':status)+'</small></div><div class="bill-tile-right"><strong>'+money(b.amount)+'</strong>'+(editable?'<button type="button" class="bill-icon-button" data-edit-bill="'+esc(b.id)+'" aria-label="Edit '+esc(b.name)+'">'+pencil+'</button>':'')+'</div></div><div class="bill-tile-footer"><span>'+esc(b.paidByCard?'Paid through credit card':b.covered?'Included in tracker budget':({monthly:'Monthly',biweekly:'Every two weeks',weekly:'Weekly',once:'One-time bill'})[b.repeat]||'Scheduled')+'</span><button class="bill-paid-button" '+(paid?'data-bill-unpaid':'data-bill-paid')+'="'+esc(b.key)+'">'+(paid?'Mark unpaid':'✓ Mark paid')+'</button></div></article>';
   };
   $('#billAgenda').innerHTML=list.map(b=>billTile(b)).join('')||'<p class="subtle">'+(selected?'No recurring bills on this day.':'Add a recurring bill or track one from your transactions.')+'</p>';
   $('#billAccountCount').textContent=list.length;
   const paidRecurring=paidBills.filter(b=>!model.isDebtPayment(b)&&(!selected||b.date===selected));
   if(paidRecurring.length)$('#billAgenda').insertAdjacentHTML('beforeend','<details class="add-bill"><summary>Paid this month ('+paidRecurring.length+')</summary>'+paidRecurring.map(b=>billTile(b,true)).join('')+'</details>');
   const paidAmount=paidBills.reduce((n,b)=>n+b.amount,0),unpaidAmount=bills.reduce((n,b)=>n+b.amount,0),totalBills=paidBills.length+bills.length,paidPercent=paidAmount+unpaidAmount?Math.round(paidAmount/(paidAmount+unpaidAmount)*100):0;
   $('#billVisuals').innerHTML='<div class="bill-progress"><div class="progress-ring" role="img" aria-label="'+paidPercent+' percent of bill amount paid" style="background:conic-gradient(var(--accent) '+paidPercent+'%,var(--line) 0)"><span><strong>'+paidPercent+'%</strong><small>paid</small></span></div><div><span class="chart-eyebrow">Payments this month</span><strong>'+money(unpaidAmount)+'</strong><small>remaining · '+paidBills.length+' of '+totalBills+' paid</small></div></div>';
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


 function openBillEditor(id,transaction,newManual=false){
  const manual=planner.manual.find(b=>b.id===id),raw=review.bills.find(b=>b.id===id),existing=raw?planner.bankRules[raw.groupKey]:null;
  let base=manual||raw;if(newManual)base={id:null,name:'',amount:0,date:iso(new Date()),repeat:'monthly',billKind:'other'};
  if(transaction){const temporary={choice:'bill',id:'new',name:transaction.name,amount:Math.round(transaction.amount*100),lastPayment:transaction.date,repeat:'monthly'};base=model.reviewBankActivity([transaction],{[transaction.key]:temporary},[],iso(new Date())).bills[0];}
  if(!base)return;
  const b={...base,...planner.estimates[base.id]},form=$('#billEditorForm');
  editingBill={id:transaction?null:id,key:transaction?.key||raw?.groupKey,transaction,base,manual:!!manual,newManual};
  form.reset();form.elements.billKind.innerHTML=Object.entries(billCategories).filter(([key])=>!['credit-card','loan','car-payment'].includes(key)||key===b.billKind).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('');form.elements.name.value=b.name;form.elements.billKind.value=billCategories[b.billKind]?b.billKind:'other';form.elements.amount.value=newManual?'':b.amount/100;form.elements.date.value=b.date;form.elements.repeat.value=b.repeat||'monthly';form.elements.covered.checked=!!planner.covered[id];
  form.elements.gmailElectric.checked=planner.electricBillId===id||(!planner.electricBillId&&b.billKind==='electric');
  $('#electricLinkOption').hidden=form.elements.billKind.value!=='electric';
  $('#billEditorTitle').textContent=newManual?'Add recurring bill':transaction?'Track a bill':'Bill details';$('#billEditorSource').textContent=transaction?'Bank transaction: '+transaction.name:raw?'Linked to your bank transactions. Your custom name stays the same after a sync.':'Your manually added bill.';
  $('#stopTrackingBill').hidden=!!transaction||newManual;$('#billEditorError').textContent='';$('#billEditor').showModal();
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
   const id=editingBill.id||(editingBill.newManual?'manual-':'tracked-')+crypto.randomUUID();
   if(editingBill.newManual){planner.manual.push({id,name,amount,date,repeat,billKind,source:'manual'});}
   else if(editingBill.manual){const b=planner.manual.find(b=>b.id===id);Object.assign(b,{name,amount,date,repeat,billKind});}
   else{
    const old=planner.bankRules[editingBill.key]||{},t=editingBill.transaction;
    planner.bankRules[editingBill.key]={...old,choice:'bill',id,name,billKind,amount:editingBill.base.amount,lastPayment:t?.date||editingBill.base.lastPayment,repeat};
    const correction={};if(amount!==editingBill.base.amount)correction.amount=amount;if(date!==editingBill.base.date)correction.date=date;planner.estimates[id]=correction;
   }
   planner.covered[id]=d.has('covered');
   if(billKind==='electric'&&d.has('gmailElectric'))planner.electricBillId=id;else if(planner.electricBillId===id)delete planner.electricBillId;
   await save();$('#billEditor').close();$('#transactionStatus').textContent='Bill saved.';$('#accountStatus').textContent='Recurring bill saved.';
  }catch(e){planner=snapshot;$('#billEditorError').textContent=e.message;}finally{button.disabled=false;}
 };
 $('#stopTrackingBill').onclick=async()=>{
  if(!editingBill?.id)return;const snapshot=structuredClone(planner),id=editingBill.id;
  try{if(editingBill.manual)planner.manual=planner.manual.filter(b=>b.id!==id);else delete planner.bankRules[editingBill.key];delete planner.estimates[id];delete planner.covered[id];if(planner.electricBillId===id)delete planner.electricBillId;await save();$('#billEditor').close();}catch(e){planner=snapshot;$('#billEditorError').textContent=e.message;}
 };

 document.addEventListener('click',e=>{const category=e.target.closest('[data-spending-category]');if(!category)return;spendingCategory=category.dataset.spendingCategory;$('#transactionFilter').value='spending';$('#bankActivityCard').open=true;window.selectBearTab('accounts');renderIncome();$('#bankActivityCard').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});});
 document.addEventListener('input',e=>{if(e.target.id!=='forecastScrub')return;const index=Number(e.target.value),point=forecastPoints[index];if(!point)return;$('#forecastPoint').textContent=dateLabel(point.date)+' · '+money(point.balance);$('#forecastCursor').setAttribute('x1',12+index*9.2);$('#forecastCursor').setAttribute('x2',12+index*9.2);});
 $('#transactionFilter').onchange=()=>{spendingCategory=null;renderIncome();};
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
  try{if(b.dataset.billUnpaid){planner.paid=planner.paid.filter(k=>k!==b.dataset.billUnpaid);await save();}if(b.dataset.billPaid){planner.paid.push(b.dataset.billPaid);await save();$('#accountStatus').textContent='Payment marked paid. Your bank balance changes on the next sync.';}if(b.dataset.billRemove&&confirm('Delete this bill and its future occurrences?')){planner.manual=planner.manual.filter(x=>x.id!==b.dataset.billRemove);delete planner.covered[b.dataset.billRemove];await save();}}catch(e){error(e);}finally{b.disabled=false;}
 });
 document.addEventListener('change',async e=>{const b=e.target.closest('[data-bill-covered]');if(!b)return;try{planner.covered[b.dataset.billCovered]=b.checked;await save();}catch(e){error(e);}});

})();
