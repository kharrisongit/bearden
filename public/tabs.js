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
 const accountViews=['calendar','bills','debt'];
 function selectAccountView(name){
  if(!accountViews.includes(name))return;
  for(const view of accountViews){
   $('#accounts-'+view).hidden=view!==name;
   const button=$('#accounts-nav-'+view);button.setAttribute('aria-selected',String(view===name));button.tabIndex=view===name?0:-1;
  }
 }
 document.addEventListener('click',e=>{const button=e.target.closest('[data-account-view]');if(button)selectAccountView(button.dataset.accountView);});
 $('.account-view-tabs').addEventListener('keydown',e=>{
  const i=accountViews.indexOf(e.target.dataset.accountView);if(i<0)return;
  const n=e.key==='ArrowRight'?(i+1)%3:e.key==='ArrowLeft'?(i+2)%3:e.key==='Home'?0:e.key==='End'?2:-1;if(n<0)return;
  e.preventDefault();selectAccountView(accountViews[n]);$('#accounts-nav-'+accountViews[n]).focus();
 });
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=(n,c='USD')=>new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format(n/100);
 const modelDay=(s,n)=>{const d=new Date(s+'T12:00:00');d.setDate(d.getDate()+n);return iso(d);};
 const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
 const dateLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
 let editingBill=null,spendingCategory=null,forecastViews={},householdBills=[],forecastStart='',forecastLength=30,forecastRowLimit=100;
 const chartColors=['#168b83','#ed896f','#d6a74b','#547eab','#a17ca7','#7fa873','#91847a'];
 const billCategories={electric:'Electric',rent:'Rent',utility:'Utility','car-payment':'Car payment',insurance:'Insurance','phone-internet':'Phone & internet',subscription:'Subscription','credit-card':'Credit card',loan:'Loan payment',other:'Other bill'};
 const pencil='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg>';
 let review={rows:[],bills:[],spending:{categories:[],total:0}};
 let month=new Date(new Date().getFullYear(),new Date().getMonth(),1),selected=null,model,mailModel,rentModel,planner={manual:[],covered:{},paid:[],accountVisibility:{},dismissedEstimates:[],estimates:{},bankRules:{},creditCards:{},transactionLinks:{},emailLinks:{},billFunding:{},household:{},forecastDebtMode:'full'},linked={},ready=false;
 const accountShown=id=>!planner.hiddenConnectedAccounts?.[id];
 function error(e){$('#incomeStatus').textContent=e.message||String(e);$('#accountStatus').textContent=e.message||String(e);$('#accountSaveStatus').textContent=e.message||String(e);}
 async function save(){if(!ready)throw Error('Accounts have not loaded. Reload before saving changes.');await window.BearDen.storage.set('income-planner',JSON.stringify(planner));$('#incomeStatus').textContent='Saved';$('#accountStatus').textContent='Saved';await renderIncome();}
 let initializing;
 $('#configureHousehold').disabled=true;$('#sharedBillsToggle').disabled=true;
 function initialize(){return initializing??=(async()=>{try{await window.classicReady;[model,mailModel,rentModel]=await Promise.all([import('./income-model.mjs?v=rent-portal1'),import('./email-model.mjs?v=balance-fix1'),import('./rent-model.mjs?v=rent-portal1')]);const stored=await window.BearDen.storage.get('income-planner');if(stored)planner={...planner,...JSON.parse(stored.value)};ready=true;$('#configureHousehold').disabled=false;$('#sharedBillsToggle').disabled=false;await renderIncome();}catch(e){error(new Error('Accounts could not load. Reload before editing. '+e.message));}})();}
 window.addEventListener('load',initialize,{once:true});
 window.addEventListener('bearden-connections',()=>{if(ready)renderIncome();});
 window.addEventListener('bearden-plan-changed',()=>{if(ready)renderIncome();});
 function showTransactions(open=true){
  window.selectBearTab('income');$('#bankActivityCard').hidden=!open;$('#incomeTransactionsToggleBtn').setAttribute('aria-expanded',String(open));
 }
 $('#incomeTransactionsToggleBtn').onclick=()=>{spendingCategory=null;$('#transactionFilter').value='all';showTransactions($('#bankActivityCard').hidden);renderIncome();};
 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-forecast-debt-mode]');if(!button)return;
  const old=planner.forecastDebtMode;planner.forecastDebtMode=button.dataset.forecastDebtMode;
  try{await save();}catch(e){planner.forecastDebtMode=old;await renderIncome();error(e);}
 });
 const linkDrafts={};let pickingLink=null;
 const bankTransactions=()=>window.BearDen.plan?.connections?.transactions||[];
 window.getDebtBankPaymentHistory=id=>model?model.matchingPayments(bankTransactions(),planner.transactionLinks['debt:'+id],iso(new Date())):[];
 function bankPaymentHistoryMarkup(history){
  if(!history.length)return '';
  return '<div class="linked-bank-history"><h5>Bank payment history</h5><p class="subtle">'+history.length+' posted payments · '+money(history.reduce((total,t)=>total+Math.round(t.amount*100),0))+'</p><div class="linked-payment-list">'+history.map(t=>'<div class="forecast-row"><span>'+esc(t.name)+'<small>'+esc(dateLabel(t.date))+'</small></span><strong>'+money(Math.round(t.amount*100))+'</strong></div>').join('')+'</div></div>';
 }
 function setEditorLink(prefix,target,link=null,exactAmount=false){
  linkDrafts[prefix]={target,link:link?structuredClone(link):null,exactAmount};renderEditorLink(prefix);setEmailDraft(prefix,target);
 }
 function renderEditorLink(prefix){
  const draft=linkDrafts[prefix],link=draft.link,history=link?model.matchingPayments(bankTransactions(),link,iso(new Date())):[];
  const account=(window.BearDen.plan?.state?.accounts||[]).find(a=>a.id==='plaid-'+link?.accountId);
  $('#'+prefix+'TransactionLink').innerHTML='<strong>Linked bank payments</strong>'+(link?'<p class="subtle">Watching '+esc(link.name)+' · '+esc(account?.name||'selected bank account')+'</p><label class="check-label"><input type="checkbox" data-link-exact="'+prefix+'" '+(link.amount!=null?'checked':'')+'> Only payments of '+money(link.sampleAmount||link.amount||0)+'</label><p class="subtle">'+history.length+' matching posted payment'+(history.length===1?'':'s')+' · '+money(history.reduce((sum,t)=>sum+Math.round(t.amount*100),0))+' total in available history. Future syncs use this merchant and bank account.</p><div class="linked-payment-list">'+history.map(t=>'<div class="forecast-row"><span>'+esc(t.name)+'<small>'+esc(dateLabel(t.date))+'</small></span><strong>'+money(Math.round(t.amount*100))+'</strong></div>').join('')+'</div>':'<p class="subtle">Choose a transaction to identify the merchant, total previous payments, and recognize future payments. Bill emails supply upcoming amounts; past payments are only a fallback estimate.</p>')+(link&&linkError(draft.target,link)?'<p class="subtle" role="status">'+esc(linkError(draft.target,link))+'</p>':'')+'<div class="link-actions"><button type="button" data-pick-link="'+prefix+'">'+(link?'Change transaction':'Link a transaction')+'</button>'+(link?'<button type="button" data-unlink-payment="'+prefix+'">Unlink</button>':'')+'</div>'+(prefix==='bill'?'':'<p class="subtle">Matched payments appear in your history. Starting balances and paycheck checkoffs stay as entered.</p>');
 }
 function linkError(target,link){
  if(!link)return '';
  const conflict=model.linkConflict(planner.transactionLinks,target,link);
  if(conflict)return 'This merchant is already linked to '+(planner.transactionLinks[conflict].targetName||'another account')+'. Use an amount filter to separate payments, or unlink the other account first.';
  const tracked=Object.values(planner.bankRules).find(r=>r.choice==='bill'&&!planner.transactionLinks['bill:'+r.id]&&'bill:'+r.id!==target&&review.bills.some(b=>b.id===r.id&&model.matchingPayments(bankTransactions(),link,iso(new Date())).some(t=>t.key===b.groupKey||model.transactionKey(t)===b.groupKey)));
  return tracked?'This transaction already tracks '+tracked.name+'. Edit or stop tracking that bill first.':'';
 }
 function storeEditorLink(prefix,target,name){
  storeEmailDraft(prefix,target,name);
  const link=linkDrafts[prefix]?.link,message=linkError(target,link);if(message)throw Error(message);
  if(link)planner.transactionLinks[target]={...link,targetName:name};else delete planner.transactionLinks[target];
 }
 function renderTransactionChoices(){
  const query=$('#transactionLinkSearch').value.toLowerCase().trim(),draft=linkDrafts[pickingLink];
  const rows=bankTransactions().filter(t=>model.postedPayment(t)&&t.date<=iso(new Date())&&(!query||(t.name+' '+t.amount+' '+money(Math.round(t.amount*100))).toLowerCase().includes(query))).sort((a,b)=>b.date.localeCompare(a.date));
  $('#transactionLinkChoices').innerHTML=rows.map(t=>{
   const account=(window.BearDen.plan?.state?.accounts||[]).find(a=>a.id==='plaid-'+t.account_id),link=model.paymentLink(t,{exactAmount:draft.exactAmount}),message=linkError(draft.target,link);
   return '<button type="button" class="transaction-choice" data-link-transaction="'+esc(t.transaction_id)+'"><span><strong>'+esc(t.name)+'</strong><b>'+money(Math.round(t.amount*100))+'</b></span><small>'+esc(dateLabel(t.date)+' · '+(account?.name||'Bank account'))+'</small>'+(message?'<small>'+esc(message)+'</small>':'')+'</button>';
  }).join('')||'<p class="subtle">No matching posted payments. Refresh your bank to load available history.</p>';
 }
 $('#transactionLinkSearch').oninput=renderTransactionChoices;
 $('#closeTransactionLinkPicker').onclick=()=>$('#transactionLinkPicker').close();
 document.addEventListener('change',e=>{const checkbox=e.target.closest('[data-link-exact]');if(!checkbox)return;const prefix=checkbox.dataset.linkExact,draft=linkDrafts[prefix];draft.link.amount=checkbox.checked?draft.link.sampleAmount:null;draft.exactAmount=checkbox.checked;renderEditorLink(prefix);});
 document.addEventListener('click',e=>{
  const pick=e.target.closest('[data-pick-link]');if(pick){pickingLink=pick.dataset.pickLink;$('#transactionLinkSearch').value='';$('#transactionLinkError').textContent='';renderTransactionChoices();$('#transactionLinkPicker').showModal();}
  const unlink=e.target.closest('[data-unlink-payment]');if(unlink){linkDrafts[unlink.dataset.unlinkPayment].link=null;renderEditorLink(unlink.dataset.unlinkPayment);}
  const chosen=e.target.closest('[data-link-transaction]');if(chosen){const transaction=bankTransactions().find(t=>t.transaction_id===chosen.dataset.linkTransaction);if(!transaction)return;const draft=linkDrafts[pickingLink],link=model.paymentLink(transaction,{exactAmount:draft.exactAmount}),message=linkError(draft.target,link);draft.link=link;renderEditorLink(pickingLink);$('#transactionLinkPicker').close();}
  const linked=e.target.closest('[data-edit-linked]');if(linked){const target=linked.dataset.editLinked,[type,...parts]=target.split(':'),id=parts.join(':');if(type==='debt')openDebtEditor(id);else if(type==='credit')openCreditEditor(id);else openBillEditor(id);}
 });
 const emailDrafts={};let pickingEmail=null,mailSearchRunning=false,paymentDisplaySignature='';
 const mailMessages=()=>window.BearDen.plan?.connections?.gmailMessages||[];
 function isCreditTarget(target){if(target.startsWith('credit:'))return true;if(target.startsWith('debt:')){const card=window.getDebtPlan().state.cards.find(c=>String(c.id)===target.slice(5));return !!card&&(!card.debtKind||card.debtKind==='credit-card');}return [...planner.manual,...review.bills].some(b=>'bill:'+b.id===target&&b.billKind==='credit-card');}
 function emailStatus(target,link=planner.emailLinks[target]){
  const connections=window.BearDen.plan?.connections||{},credit=target.startsWith('credit:')?(connections.creditCards||[]).find(c=>c.id===target.slice(7)):null,bankLink=planner.transactionLinks[target];
  const bankPayments=credit?(credit.payments||[]):model.matchingPayments(bankTransactions(),bankLink,iso(new Date())).map(t=>({...t,id:t.transaction_id,amount:Math.round(t.amount*100)}));
  const hasPlaid=!!credit||!!bankLink&&(connections.items||[]).some(i=>i.id===bankLink.itemId);
  return {...mailModel.emailAccountStatus(mailMessages(),link,{hasPlaid,bankPayments,creditCard:isCreditTarget(target)}),hasPlaid};
 }
 const mailPaymentLabel=p=>p.status==='pending'?'Pending':p.status==='failed'?'Failed / returned':p.estimated?'Posted (estimated)':'Posted';
 function paymentMarkup(target){
  if(!planner.emailLinks[target]||!isCreditTarget(target))return '';
  const status=emailStatus(target),pending=status.payments.filter(p=>p.status==='pending');
  const latest=status.payments[0],pendingAmount=pending.some(p=>p.paymentAmount==null)?(status.pending?money(status.pending)+' + unknown':'Amount not shared'):money(status.pending);
  return '<div class="email-payment-status"><div><span>Pending payments</span><strong>'+pendingAmount+'</strong></div>'+(pending.length?'<small>'+pending.length+' payment'+(pending.length===1?'':'s')+(status.hasPlaid?' · waiting for bank confirmation':' · estimated posted after 2 days')+'</small>':'<small>No pending payments'+(latest?' · '+esc(mailPaymentLabel(latest)):'')+'</small>')+'<details><summary>Payment history</summary>'+status.payments.slice(0,10).map(p=>'<div class="email-payment-row"><span>'+esc(mailPaymentLabel(p))+'<small>'+esc(dateLabel(p.postedDate||p.paymentDate||p.receivedAt.slice(0,10)))+'</small></span><strong>'+(p.paymentAmount==null?'Amount not shared':money(p.paymentAmount))+'</strong></div>').join('')+'<button type="button" data-refresh-email="'+esc(target)+'">Check Gmail</button></details></div>';
 }
 function setEmailDraft(prefix,target){emailDrafts[prefix]={target,link:planner.emailLinks[target]?structuredClone(planner.emailLinks[target]):null};renderEmailDraft(prefix);}
 function renderEmailDraft(prefix){
  const draft=emailDrafts[prefix],link=draft.link,status=emailStatus(draft.target,link),account=(window.BearDen.plan?.connections?.gmailAccounts||[]).find(a=>a.id===link?.mailboxId),form=$('#'+prefix+'EditorForm');
  const suggestions=mailModel.emailSuggestions(mailMessages(),form.elements.name.value);
  $('#'+prefix+'EmailLink').innerHTML='<strong>Gmail updates</strong>'+(link?'<p class="subtle">'+esc(link.sender)+' · '+esc(account?.email||'Disconnected Gmail account')+'</p><label>Account or card ending in<input type="text" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="Optional last 4 digits" data-email-last4="'+prefix+'" value="'+esc(link.accountLast4)+'"></label><p class="subtle">'+(status.statement?'Latest email'+(status.statement.dueDate?' · due '+esc(dateLabel(status.statement.dueDate)):'')+(status.statement.amount!=null?' · '+money(status.statement.amount):'')+(status.statement.minimum!=null?' · minimum '+money(status.statement.minimum):''):'Waiting for a matching statement.')+'</p>':'<p class="subtle">'+(suggestions.length?suggestions.length+' possible matching emails found. Choose one to start watching.':'Find bills and payment notices across your connected Gmail accounts.')+'</p>')+'<div class="link-actions"><button type="button" data-pick-email="'+prefix+'">'+(link?'Change email':'Link an email')+'</button>'+(link?'<button type="button" data-unlink-email="'+prefix+'">Unlink Gmail</button>':'')+'</div><p class="subtle">'+((prefix==='credit'||prefix==='debt'&&form.elements.debtKind.value==='credit-card'||prefix==='bill'&&form.elements.billKind.value==='credit-card')?'Email updates fill missing card details. Card payments stay pending until Plaid confirms them, or for two days without Plaid.':'Email updates keep the bill amount and due date current. Payments use the bank transaction date, with no pending timer.')+'</p>';
 }
 function storeEmailDraft(prefix,target,name){
  const link=emailDrafts[prefix]?.link;if(!link){delete planner.emailLinks[target];return;}
  const conflict=Object.entries(planner.emailLinks).find(([key,other])=>key!==target&&other.mailboxId===link.mailboxId&&other.sender===link.sender&&(!other.accountLast4||!link.accountLast4||other.accountLast4===link.accountLast4));
  if(conflict)throw Error('That sender is already linked to '+(conflict[1].targetName||'another account')+'. Add the account’s last four digits to separate its emails.');
  planner.emailLinks[target]={...link,targetName:name};
 }
 async function discoverMail(target,name){
  if(!window.BearDen.plan?.connections?.gmail||mailSearchRunning)return;
  mailSearchRunning=true;
  try{const query=planner.emailLinks[target]?.sender||planner.transactionLinks[target]?.merchant||name;await window.BearDen.searchGmail(query);}
  catch(e){$('#accountStatus').textContent='Saved. Gmail check needs attention: '+e.message;}
  finally{mailSearchRunning=false;}
 }
 function renderEmailChoices(){
  const query=$('#emailSearchQuery').value.toLowerCase().trim(),words=query.split(/\s+/).filter(w=>w.length>2),messages=mailMessages().filter(m=>!words.length||words.some(w=>(m.sender+' '+m.senderName+' '+m.subject).toLowerCase().includes(w)));
  $('#emailLinkChoices').innerHTML=messages.map(m=>{const account=(window.BearDen.plan?.connections?.gmailAccounts||[]).find(a=>a.id===m.mailboxId);return '<button type="button" class="transaction-choice" data-link-email="'+esc(m.id)+'"><strong>'+esc(m.subject)+'</strong><small>'+esc(m.senderName+' · '+dateLabel(m.receivedAt.slice(0,10)))+'</small><small>'+esc((account?.email||'Gmail')+(m.accountLast4?' · account ••'+m.accountLast4:''))+'</small><small>'+esc(m.paymentStatus?mailPaymentLabel({status:m.paymentStatus}):m.dueDate?'Due '+dateLabel(m.dueDate):'Statement details need review')+(m.paymentAmount!=null?' · '+money(m.paymentAmount):m.amount!=null?' · '+money(m.amount):'')+'</small></button>';}).join('')||'<p class="subtle">No matching emails loaded yet. Search your connected Gmail accounts or try the sender’s name.</p>';
 }
 $('#debtEditorForm').elements.debtKind.onchange=()=>renderEmailDraft('debt');
 $('#closeEmailLinkPicker').onclick=()=>$('#emailLinkPicker').close();
 $('#emailSearchQuery').oninput=renderEmailChoices;
 $('#emailSearchForm').onsubmit=async e=>{e.preventDefault();const button=$('#emailSearchButton');button.disabled=true;$('#emailSearchStatus').textContent='Searching connected Gmail accounts…';try{const result=await window.BearDen.searchGmail($('#emailSearchQuery').value);renderEmailChoices();$('#emailSearchStatus').textContent=(result.gmailAccounts||[]).map(a=>(a.email||'Gmail')+': '+a.status).join(' ');}catch(e){$('#emailSearchStatus').textContent=e.message;}finally{button.disabled=false;}};
 document.addEventListener('input',e=>{const input=e.target.closest('[data-email-last4]');if(input)emailDrafts[input.dataset.emailLast4].link.accountLast4=input.value.replace(/\D/g,'').slice(0,4);});
 document.addEventListener('click',async e=>{
  const pick=e.target.closest('[data-pick-email]');if(pick){
   if(!window.BearDen.plan?.connections?.gmail){for(const id of ['billEditor','debtEditor','creditEditor'])$('#'+id).close();window.selectBearTab('settings');$('#classicEmailStatus').textContent='Add a Gmail account, then choose an email in this account’s details.';$('#classicGmail').focus();return;}
   pickingEmail=pick.dataset.pickEmail;$('#emailSearchQuery').value=$('#'+pickingEmail+'EditorForm').elements.name.value;$('#emailSearchStatus').textContent='';renderEmailChoices();$('#emailLinkPicker').showModal();
  }
  const chosen=e.target.closest('[data-link-email]');if(chosen){
   let message=mailMessages().find(m=>m.id===chosen.dataset.linkEmail);if(!message)return;chosen.disabled=true;
   try{
    $('#emailSearchStatus').textContent='Reading the selected email…';message=await window.BearDen.readGmailMessage(message);
    emailDrafts[pickingEmail].link=mailModel.emailLink(message);renderEmailDraft(pickingEmail);
    if(pickingEmail==='bill'){
     const form=$('#billEditorForm');
     if(mailModel.usableBillAmount(message)){
      form.elements.amount.value=(message.amount/100).toFixed(2);
      if(mailModel.completeBillStatement(message)){form.elements.date.value=message.dueDate;$('#billEditorError').textContent='Email amount and due date filled in. Save bill to apply them.';}
      else $('#billEditorError').textContent='Email amount filled in. The due date was not readable, so your existing date is kept. Check that date and Save bill.';
     }else $('#billEditorError').textContent=message.paymentStatus?'This email was read as a payment notice, not a new bill. Your estimate is unchanged. Select the bill-ready email or enter its upcoming amount.':'Could not read a clear bill amount from this email. Your estimate is unchanged; enter the amount shown in the email or select another bill email.';
    }
    $('#emailLinkPicker').close();
   }catch(error){$('#emailSearchStatus').textContent=error.message;}finally{chosen.disabled=false;}
  }

  const unlink=e.target.closest('[data-unlink-email]');if(unlink){emailDrafts[unlink.dataset.unlinkEmail].link=null;renderEmailDraft(unlink.dataset.unlinkEmail);}
  const refresh=e.target.closest('[data-refresh-email]');if(refresh){refresh.disabled=true;await discoverMail(refresh.dataset.refreshEmail,planner.emailLinks[refresh.dataset.refreshEmail]?.sender||'');refresh.disabled=false;}
 });
 const mailDisplaySignature=()=>JSON.stringify(Object.keys(planner.emailLinks).map(target=>[target,emailStatus(target).payments.map(p=>[p.id,p.status,p.estimated])]));
 setInterval(()=>{if(ready&&paymentDisplaySignature!==mailDisplaySignature())renderIncome();},60000);
 function emailCredit(card){
  const statement=emailStatus('credit:'+card.id).statement;if(!statement)return card;
  const newerEmail=card.stale&&(!card.updated||Date.parse(statement.receivedAt)>=Date.parse(card.updated));
  const fallback=(field,value)=>newerEmail||card[field]==null||card[field]===''?value??card[field]:card[field];
  return {...card,issuerBalance:card.balance,balance:fallback('balance',statement.balance),minimum:fallback('minimum',statement.minimum),dueDate:fallback('dueDate',statement.dueDate),statementDate:newerEmail?statement.statementDate||null:card.statementDate,emailBalance:statement.balance!=null&&(newerEmail||card.balance==null),emailMinimum:statement.minimum!=null&&(newerEmail||card.minimum==null),emailDue:!!statement.dueDate&&(newerEmail||!card.dueDate)};
 }
 const debtKinds={'credit-card':'Credit card','car-loan':'Car loan',loan:'Personal loan',other:'Debt'};
 function connectionMarkup(target,bill=null){
  const connections=window.BearDen.plan?.connections||{},accounts=window.BearDen.plan?.state?.accounts||[],[kind,...parts]=target.split(':'),id=parts.join(':');
  const accountId=kind==='debt'?planner.debtAccountLinks?.[id]:kind==='bill'?planner.loanLinks?.[id]:null,account=accounts.find(a=>a.id===accountId);
  const email=planner.emailLinks[target];
  const gmail=(connections.gmail||connections.gmailAccounts?.length)&&(email||bill?.source==='gmail'||bill?.emailConfirmed||bill?.emailAmountConfirmed||bill?.gmailConfirmed||bill&&planner.electricBillId===bill.id);
  // Show the primary bill/balance feed. Transaction matching is payment history,
  // and never establishes a provider connection for this bill or debt.
  const source=bill?.rentLinked&&connections.sun?.connected?'Rent portal'
   :kind==='bill'&&gmail?'Gmail'
   :account?.source==='plaid'?'Plaid'
   :account?.source==='simplefin'?'SimpleFIN'
   :kind==='credit'&&(connections.creditCards||[]).some(c=>c.id===id)?'Plaid'
   :gmail?'Gmail':null;
  return source?'<p class="account-connection">Connected via '+source+'</p>':'';
 }
 const refreshIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.35 6.65M20 4v7h-7"/></svg>';
 function renderDebtAccounts(plan,connections,accounts,payments,paidPayments){
  const linkedCards=(connections.creditCards||[]).map(emailCredit),matched=new Set(linkedCards.filter(c=>accountShown('plaid-'+c.accountId)).map(c=>planner.creditCards[c.id]?.trackerCardId).filter(Boolean).map(String));
  const value=(n,c)=>n===null||n===undefined?'Not shared':money(n,c.currency||'USD');
  const badge=text=>'<span class="debt-paid-badge">✓ '+esc(text)+'</span>';
  const connected=linkedCards.filter(c=>accountShown('plaid-'+c.accountId)&&!Object.values(planner.debtAccountLinks||{}).includes('plaid-'+c.accountId)).map(c=>{
   const p=planner.creditCards[c.id]||{},balance=c.emailBalance?c.balance:accounts.find(a=>a.id==='plaid-'+c.accountId)?.balance??c.balance;
   const status=model.trackerDebtStatus(plan,p.trackerCardId),paidOff=status?.paidOff||balance!==null&&balance<=0;
   const util=balance!==null&&c.limit>0?Math.max(0,balance/c.limit*100):null;
   const due=payments.find(b=>b.id===c.id),paid=paidPayments.find(b=>b.id===c.id),history=c.payments||[],dueDate=c.dueDate||p.fallbackDate;
   const state=paidOff?badge(status?.paidOff?'Paid off in plan':'Paid off'):paid?badge('Payment paid'):'';
   const paymentLabel=paid?.paidByPaycheck?'Paid from checked paychecks':paid?.paidByBank?'Matched bank payment':paid?'Marked paid':c.minimum===0?'No minimum due':dueDate?'Due '+dateLabel(dueDate)+(c.emailDue?' · Gmail':c.dueDate?'':' (est.)'):'Due date not shared';
   const action=paid?.paidByPaycheck||paid?.paidByBank||status?.paidOff?'':!p.tracking?'<button data-edit-credit="'+esc(c.id)+'">Track payment</button>':paid?'<button data-bill-unpaid="'+esc(paid.key)+'">Mark unpaid</button>':due?'<button data-bill-paid="'+esc(due.key)+'">✓ Mark paid</button>':'';
   let spark='';if(c.history?.length>1){const values=c.history.map(p=>p.balance),low=Math.min(...values),range=Math.max(...values)-low||1,points=values.map((v,i)=>(i/(values.length-1)*280+5).toFixed(1)+','+(52-(v-low)/range*40).toFixed(1)).join(' ');spark='<svg class="credit-spark" viewBox="0 0 290 60" role="img" aria-label="Balance history since connection"><title>Balance history since connection</title><polyline points="'+points+'" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';}
   return '<article class="debt-account connected-debt'+(paidOff?' is-paid-off':'')+'" data-account-id="'+esc(c.id)+'">'
    +'<button type="button" class="bill-icon-button account-edit" data-edit-credit="'+esc(c.id)+'" aria-label="Edit '+esc(c.name)+'">'+pencil+'</button>'
    +'<div class="debt-compact-main"><div class="debt-compact-info"><h4>'+esc(p.name||c.name)+'</h4><small>'+esc(c.institution+(c.mask?' · ••'+c.mask:''))+'</small>'+state+'</div></div>'
    +'<div class="debt-key-amounts"><div><span>'+(status?.paidOff?'Remaining in plan':c.emailBalance?'Statement balance · Gmail':'Current balance')+'</span><strong>'+esc(value(status?.paidOff?0:balance,c))+'</strong></div><div class="minimum-due"><span>'+(c.emailMinimum?'Minimum due · Gmail':c.minimum===null&&p.fallbackAmount!=null?'Est. minimum due':'Minimum due')+'</span><strong>'+esc(value(c.minimum??p.fallbackAmount,c))+'</strong></div></div>'
    +connectionMarkup('credit:'+c.id)
    +(c.overdue&&!paid?'<p class="subtle overdue">Issuer reports overdue</p>':'')+(c.stale?'<p class="subtle">Plaid needs a refresh'+(c.emailBalance||c.emailMinimum||c.emailDue?'; missing details use Gmail.':'; showing last synced details.')+'</p>':'')
    +'<div class="debt-account-footer"><span class="debt-due-date">'+esc(paymentLabel)+'</span><div class="debt-account-tools">'+action+'<button type="button" class="bill-icon-button credit-refresh" data-refresh-credit="'+esc(c.itemId)+'" aria-label="Refresh '+esc(c.name)+'">'+refreshIcon+'</button></div></div>'
    +paymentMarkup('credit:'+c.id)+'<details class="credit-detail"><summary>Details &amp; payments</summary>'
    +(status?'<p class="subtle">Checked payments update your payoff plan; your issuer balance updates after sync.</p>':'<p class="subtle">Match this card to a debt using Edit to link paycheck checkoffs.</p>')
    +(util!==null?'<div class="debt-progress"><span style="width:'+Math.min(100,util)+'%"></span></div><p class="subtle">'+Math.round(util)+'% of '+esc(value(c.limit,c))+' credit limit</p>':'')+spark
    +(c.statementDate?'<p class="subtle">Statement date: '+esc(dateLabel(c.statementDate))+'</p>':'')
    +(history.length?'<div class="credit-payment-list">'+history.map(t=>'<div class="forecast-row"><span>'+esc(t.name)+'<small>'+esc(dateLabel(t.date))+'</small></span><strong>−'+esc(value(t.amount,c))+'</strong></div>').join('')+'</div>':'<p class="subtle">Posted payments appear after your issuer sends them.</p>')
    +'<p class="subtle">Updated '+esc(new Date(c.updated).toLocaleString())+'</p></details></article>';
  });
  const manual=(plan.state.cards||[]).flatMap(c=>{
   if(matched.has(String(c.id))&&!planner.debtAccountLinks?.[c.id])return [];
   const status=model.trackerDebtStatus(plan,c.id),next=payments.find(b=>b.source==='tracker-debt'&&b.trackerCardId===String(c.id));
   const email=emailStatus('debt:'+c.id),statement=email.statement,issuer=linkedCards.find(card=>'plaid-'+card.accountId===planner.debtAccountLinks?.[c.id]),minimum=statement?.minimum??issuer?.minimum,dueDate=statement?.dueDate||issuer?.dueDate;
   const bankHistory=model.matchingPayments(bankTransactions(),planner.transactionLinks['debt:'+c.id],iso(new Date()));
   const synced=plan.syncedDebtBalances?.[c.id];
   const starting=Math.round(c.balance*100),progress=starting>0?Math.min(100,Math.max(0,(starting-status.balance)/starting*100)):100;
   return '<article class="debt-account manual-debt'+(status.paidOff?' is-paid-off':'')+'" data-tracker-account="'+esc(c.id)+'"><button type="button" class="bill-icon-button account-edit" data-edit-debt="'+esc(c.id)+'" aria-label="Edit '+esc(c.name)+'">'+pencil+'</button><div class="debt-compact-main"><div class="debt-compact-info"><h4>'+esc(c.name)+'</h4><small>'+esc(debtKinds[c.debtKind]||'Debt')+'</small>'+(status.paidOff?badge('Paid off'):status.lastPayment?badge('Payment paid · '+dateLabel(status.lastPayment.date)):bankHistory.length?badge('Bank payment · '+dateLabel(bankHistory[0].date)):'')+'</div></div>'
    +'<div class="debt-key-amounts"><div><span>'+(synced?'Current balance':statement?.balance!=null&&!status.paidOff?'Statement balance · Gmail':'Remaining balance')+'</span><strong>'+money(synced?synced.balance:status.paidOff?0:statement?.balance??status.balance)+'</strong></div><div class="minimum-due"><span>'+(minimum!=null?'Minimum due':'Min. per paycheck')+'</span><strong>'+money(status.paidOff?0:minimum??Math.round(c.min*100))+'</strong></div></div>'
    +connectionMarkup('debt:'+c.id)
    +'<div class="debt-account-footer"><span class="debt-due-date">'+esc(status.paidOff?'Paid from checked paychecks':dueDate?'Due '+dateLabel(dueDate):next?'Next payment '+dateLabel(next.date):'Set up paydays in Income')+(next&&!status.paidOff?'<small>'+money(next.amount)+' planned</small>':'')+'</span></div>'
    +debtAccountMarkup(c.id)+paymentMarkup('debt:'+c.id)+'<details class="credit-detail"><summary>Details &amp; progress</summary><div class="debt-progress"><span style="width:'+progress+'%"></span></div><p class="subtle">'+Math.round(progress)+'% paid down · '+money(status.paid)+' in checked payments</p>'+bankPaymentHistoryMarkup(bankHistory)+'<button type="button" data-edit-debt="'+esc(c.id)+'">Account details &amp; history</button></details></article>';
  });
  const paymentOnly=payments.filter(b=>model.isDebtPayment(b)&&!['tracker-debt','plaid-credit'].includes(b.source)).map(b=>'<article class="debt-account payment-only-debt"><button type="button" class="bill-icon-button account-edit" data-edit-bill="'+esc(b.id)+'" aria-label="Edit '+esc(b.name)+'">'+pencil+'</button><div class="debt-compact-main"><div class="debt-compact-info"><h4>'+esc(b.name)+'</h4><small>Scheduled payment · '+esc(dateLabel(b.date))+'</small></div><div class="debt-compact-amount"><strong>'+money(b.amount)+'</strong></div></div><div class="debt-account-footer"><span>Payment tracking only</span><div class="debt-account-tools"><button data-bill-paid="'+esc(b.key)+'">✓ Mark paid</button></div></div>'+connectionMarkup('bill:'+b.id,b)+'</article>');
  const all=[...connected,...manual,...paymentOnly];$('#debtAccounts').innerHTML=all.join('')||'<p class="subtle">Add a debt to track a balance, or connect your credit card with Plaid.</p>';$('#debtAccountCount').textContent=all.length;
 }
 function debtAccountMarkup(id){
  const accountId=planner.debtAccountLinks?.[id];if(!accountId||!accountShown(accountId))return '';
  const a=(window.BearDen.plan?.state?.accounts||[]).find(a=>a.id===accountId);
  if(a?.balanceUnavailable)return '<p class="subtle">The connection did not supply a current balance. Using your entered payoff balance.</p>';
  if(a?.balance===0)return '<p class="subtle">The connection reports a $0 balance. This is not an amount due or confirmation of payoff. Your entered balance and payments are kept; verify with your lender.</p>';
  return !a?'<p class="subtle">Linked bank or card account unavailable. Reconnect your bank in Settings.</p>':'';
 }
 const debtAccountField=document.createElement('div');debtAccountField.innerHTML='<label>Linked bank or card account<select name="plaidDebtAccount"><option value="">No linked account</option></select></label><p class="subtle" id="debtAccountInfo">Choose an already connected credit card or loan. This debt stays in Debt.</p>';
 $('#debtEditorForm').elements.debtKind.closest('label').after(debtAccountField);
 $('#debtEditorForm').elements.plaidDebtAccount.onchange=()=>{
  const id=$('#debtEditorForm').elements.plaidDebtAccount.value,a=(window.BearDen.plan?.state?.accounts||[]).find(a=>a.id===id);
  $('#debtAccountInfo').textContent=a?a.name+' · Synced balance '+(a.balanceUnavailable?'Not supplied':money(a.balance,a.currency||'USD'))+'. Bank sync updates the current balance and future payoff calculations. Historical checked paychecks stay as entered.':'Choose an already connected credit card or loan. This debt stays in Debt.';
 };
 let editingDebt=null;
 function openDebtEditor(id=null,draft=null){
  const debt=id===null?null:window.getDebtPlan().state.cards.find(c=>String(c.id)===String(id));if(id!==null&&!debt)return;
  editingDebt=debt?.id??null;const form=$('#debtEditorForm');form.reset();
  form.elements.name.value=draft?.name||debt?.name||'';form.elements.debtKind.value=draft?.debtKind||debt?.debtKind||'credit-card';
  for(const [field,key]of [['balance','balance'],['apr','apr'],['minimum','min']])form.elements[field].value=draft?.[field]??debt?.[key]??'';
  const accountId=planner.debtAccountLinks?.[debt?.id]||'',debtAccounts=(window.BearDen.plan?.state?.accounts||[]).filter(a=>['plaid','simplefin'].includes(a.source)&&['credit','loan'].includes(a.type)&&(accountShown(a.id)||a.id===accountId));
  form.elements.plaidDebtAccount.innerHTML='<option value="">No linked account</option>'+debtAccounts.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+' ('+(a.source==='simplefin'?'SimpleFIN':'Plaid')+') · '+esc((a.balanceUnavailable?'Not supplied':money(a.balance,a.currency||'USD')))+'</option>').join('')+(accountId&&!debtAccounts.some(a=>a.id===accountId)?'<option value="'+esc(accountId)+'">Previously linked account (unavailable)</option>':'');form.elements.plaidDebtAccount.value=accountId;form.elements.plaidDebtAccount.onchange();
  $('#debtEditorTitle').textContent=debt?'Debt details':'Add debt';$('#debtConnectionChoice').hidden=!!debt;$('#debtHistoryButton').hidden=!debt;
  $('#debtExistingConnections').innerHTML=(window.BearDen.plan?.connections?.items||[]).map(i=>'<button type="button" data-credit-update="'+esc(i.id)+'" data-account-connect>Use '+esc(i.name)+' connection</button>').join('');
  const start=window.getDebtPlan().state.startDate;$('#debtPlanNote').textContent=(accountId?'The linked bank balance supplies current debt and future payoff calculations. This field preserves the original starting balance for your history. ':'')+'This starting balance belongs to your payoff plan'+(start?' beginning '+dateLabel(start):'')+'. Payments use the payday schedule in Trackers.';
  setEditorLink('debt','debt:'+editingDebt,planner.transactionLinks['debt:'+editingDebt]);
  $('#debtEditorError').textContent='';$('#debtEditor').showModal();
 }
 $('#debtHistoryButton').onclick=()=>{if(editingDebt!==null){$('#debtEditor').close();window.showDebtAccountHistory(editingDebt);}};
 $('#closeDebtHistory').onclick=()=>{$('#debtHistoryDialog').close();renderIncome();};
 $('#closeDebtEditor').onclick=()=>$('#debtEditor').close();$('#closeAccountTypePicker').onclick=()=>$('#accountTypePicker').close();
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-add-account],[data-open-account-add]')){$('#debtHistoryDialog').close();window.selectBearTab('accounts');$('#accountTypePicker').showModal();}
  const type=e.target.closest('[data-account-kind]');if(type){$('#accountTypePicker').close();if(type.dataset.accountKind==='debt'){selectAccountView('debt');openDebtEditor();}else{selectAccountView('bills');openBillEditor(null,null,true);}}
  const debt=e.target.closest('[data-edit-debt]');if(debt)openDebtEditor(debt.dataset.editDebt);
 });
 $('#debtEditorForm').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,d=new FormData(form),button=form.querySelector('[type=submit]'),snapshot=structuredClone(planner);let debtSaved=false;button.disabled=true;
  try{const accountId=String(d.get('plaidDebtAccount')||'');if(accountId&&Object.entries(planner.debtAccountLinks||{}).some(([id,a])=>a===accountId&&id!==String(editingDebt)))throw Error('This connected account is already linked to another debt.');if(accountId&&Object.values(planner.loanLinks||{}).includes(accountId))throw Error('This loan is already linked to a car-payment bill. Unlink that bill first.');const message=linkError('debt:'+editingDebt,linkDrafts.debt?.link);if(message)throw Error(message);editingDebt=await window.saveDebtAccount({id:editingDebt,...Object.fromEntries(d)});debtSaved=true;planner.debtAccountLinks??={};if(accountId)planner.debtAccountLinks[editingDebt]=accountId;else delete planner.debtAccountLinks[editingDebt];storeEditorLink('debt','debt:'+editingDebt,String(d.get('name')).trim());await save();$('#debtEditor').close();discoverMail('debt:'+editingDebt,String(d.get('name')));sessionStorage.removeItem('bearden-debt-draft');$('#accountStatus').textContent='Debt saved to your payoff plan.';}
  catch(e){planner=snapshot;$('#debtEditorError').textContent=(debtSaved?'Debt details saved, but the transaction link could not be saved. Retry Save debt. ':'')+e.message;}finally{button.disabled=false;}
 };
 window.prepareDebtConnection=()=>{const draft=Object.fromEntries(new FormData($('#debtEditorForm')));sessionStorage.setItem('bearden-debt-draft',JSON.stringify(draft));$('#debtEditor').close();return {fromAccount:true,draftName:draft.name,beforeCardIds:(window.BearDen.plan?.connections?.creditCards||[]).map(c=>c.id)};};
 window.addEventListener('bearden-credit-connected',async e=>{
  window.selectBearTab('accounts');selectAccountView('debt');await initialize();if(!ready)return;await renderIncome();
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
  setEditorLink('credit','credit:'+id,planner.transactionLinks['credit:'+id]);
  $('#creditEditorError').textContent='';$('#debtEditor').close();$('#accountTypePicker').close();$('#creditEditor').showModal();
 }
 document.addEventListener('click',e=>{const button=e.target.closest('[data-edit-credit]');if(button)openCreditEditor(button.dataset.editCredit);});
 $('#closeCreditEditor').onclick=()=>$('#creditEditor').close();
 $('#creditEditorForm').onsubmit=async e=>{
  e.preventDefault();if(!editingCredit)return;const form=e.currentTarget,d=new FormData(form),old=planner.creditCards[editingCredit.id],oldLinks=structuredClone(planner.transactionLinks),oldEmailLinks=structuredClone(planner.emailLinks),button=form.querySelector('[type=submit]');
  const fallbackAmount=form.elements.amount.value===''?null:Math.round(Number(form.elements.amount.value)*100),fallbackDate=form.elements.date.value;
  if(d.has('tracking')&&editingCredit.currency!=='USD'){$('#creditEditorError').textContent='Only USD card bills can enter this forecast.';return;}
  if(d.has('tracking')&&((editingCredit.minimum===null&&(!Number.isSafeInteger(fallbackAmount)||fallbackAmount<0))||!editingCredit.dueDate&&!fallbackDate)){$('#creditEditorError').textContent='Add the minimum or due date your issuer has not shared.';return;}
  if(d.has('tracking')&&Object.entries(planner.creditCards).some(([id,p])=>id!==editingCredit.id&&p.tracking&&((d.get('trackerCardId')&&p.trackerCardId===d.get('trackerCardId'))||(d.get('replaces')&&p.replaces===d.get('replaces'))))){$('#creditEditorError').textContent='That debt or bill is already matched to another card.';return;}
  button.disabled=true;try{storeEditorLink('credit','credit:'+editingCredit.id,String(d.get('name')).trim());planner.creditCards[editingCredit.id]={tracking:d.has('tracking'),name:String(d.get('name')).trim(),covered:d.has('covered'),trackerCardId:String(d.get('trackerCardId')||''),replaces:String(d.get('replaces')||''),fallbackAmount,fallbackDate};await save();$('#creditEditor').close();discoverMail('credit:'+editingCredit.id,String(d.get('name')));sessionStorage.removeItem('bearden-debt-draft');}catch(e){planner.emailLinks=oldEmailLinks;planner.transactionLinks=oldLinks;if(old)planner.creditCards[editingCredit.id]=old;else delete planner.creditCards[editingCredit.id];$('#creditEditorError').textContent=e.message;}finally{button.disabled=false;}
 };
 function openHouseholdEditor(){
  const h=planner.household,form=$('#householdForm'),accounts=(window.BearDen.plan?.state?.accounts||[]).filter(a=>['plaid','simplefin'].includes(a.source)&&(a.currency||'USD')==='USD'&&!['credit','loan'].includes(a.type)&&(a.source!=='simplefin'||a.type==='depository'));
  form.reset();for(const key of ['personalAccountId','billsAccountId']){form.elements[key].innerHTML='<option value="">Choose an account</option>'+accounts.filter(a=>accountShown(a.id)||a.id===h[key]).map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+' · '+money(a.balance)+'</option>').join('');form.elements[key].value=h[key]||'';}
  form.elements.enabled.checked=h.enabled??true;form.elements.personalAmount.value=(h.personalAmount??72500)/100;form.elements.spouseAmount.value=(h.spouseAmount??72500)/100;form.elements.spouseStartDate.value=h.spouseStartDate||window.getDebtPlan().state.startDate||'';form.elements.spouseRepeat.value=h.spouseRepeat||'biweekly';
  $('#householdBillChoices').innerHTML=householdBills.map(b=>'<label class="check-label"><input type="checkbox" data-shared-bill="'+esc(b.id)+'" '+(model.sharedBill(b,planner)?'checked':'')+'> '+esc(b.name)+'</label>').join('')||'<p class="subtle">Add bills in Accounts, then choose Shared bills account in their editors.</p>';
  $('#householdEditorStatus').textContent='';$('#householdEditor').showModal();
 }
 $('#sharedBillsToggle').onchange=async e=>{
  const before=structuredClone(planner.household);
  if(e.target.checked&&!model.householdEnabled({...planner.household,enabled:true})){e.target.checked=false;openHouseholdEditor();$('#householdForm').elements.enabled.checked=true;return;}
  e.target.disabled=true;try{planner.household.enabled=e.target.checked;await save();$('#featureSettingsStatus').textContent='Shared bills preference saved.';}catch(error){planner.household=before;e.target.checked=!!before.enabled;$('#featureSettingsStatus').textContent=error.message;}finally{e.target.disabled=false;}
 };
 $('#configureHousehold').onclick=openHouseholdEditor;$('#closeHouseholdEditor').onclick=()=>$('#householdEditor').close();
 $('#householdForm').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,d=new FormData(form),old=structuredClone(planner),button=form.querySelector('[type=submit]'),h={...planner.household,enabled:d.has('enabled'),personalAccountId:String(d.get('personalAccountId')),billsAccountId:String(d.get('billsAccountId')),personalAmount:Math.round(Number(d.get('personalAmount'))*100),spouseAmount:Math.round(Number(d.get('spouseAmount'))*100),spouseStartDate:String(d.get('spouseStartDate')),spouseRepeat:String(d.get('spouseRepeat'))};
  if(h.enabled&&(!model.householdEnabled(h)||![h.personalAmount,h.spouseAmount].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1e11)||(h.spouseAmount>0&&!h.spouseStartDate))){$('#householdEditorStatus').textContent='Choose two different accounts, valid amounts, and your spouse’s first contribution date.';return;}
  button.disabled=true;try{planner.household=h;for(const input of document.querySelectorAll('[data-shared-bill]'))planner.billFunding[input.dataset.sharedBill]=input.checked?'shared':'personal';await save();$('#householdEditor').close();}catch(e){planner=old;$('#householdEditorStatus').textContent=e.message;}finally{button.disabled=false;}
 };
 async function renderIncome(){
  if(!ready)return;
  try{
   const b=window.BearDen,legacy=b.plan?.state||{},connections=b.plan?.connections||{},authenticated=b.config?.authenticated;
   linked=JSON.parse((await b.storage.get('linked-bills'))?.value||'{}');
   const accounts=(legacy.accounts||[]).filter(a=>['plaid','simplefin'].includes(a.source));
   window.setSyncedDebtBalances(model.syncedDebtBalances(planner,accounts,iso(new Date())));
   const plan=window.getDebtPlan(),personalAccount=model.personalChecking(accounts,planner.household),personalTransactions=model.personalCheckingTransactions(connections.transactions||[],personalAccount);
   const personalChoices=accounts.filter(a=>a.type==='depository'&&(a.subtype==='checking'||/checking/i.test(a.name))&&a.id!==planner.household.billsAccountId&&(accountShown(a.id)||a.id===personalAccount?.id));
   $('#personalSpendingAccount').innerHTML='<option value="">Choose personal checking</option>'+personalChoices.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('');$('#personalSpendingAccount').value=personalAccount?.id||'';
   const visible=accounts.filter(a=>accountShown(a.id)&&(planner.accountVisibility[a.id]??(a.source!=='simplefin'&&/^checking(?:\s|$)/i.test(a.name))));
   const currentDay=iso(new Date()),upcoming=model.paydayEvents(plan,currentDay,modelDay(currentDay,90))[0];
   const usd=visible.filter(a=>(a.currency||'USD')==='USD'&&!['credit','loan'].includes(a.type)&&(a.source!=='simplefin'||a.type==='depository')),total=usd.reduce((sum,a)=>sum+a.balance,0);
   const summary='<span class="income-eyebrow">Selected bank balance'+(usd.length===1?'':'s')+'</span><div class="income-total">'+(usd.length?money(total):'—')+'</div><div class="income-meta"><span><i class="income-live-dot"></i>'+visible.length+' account'+(visible.length===1?'':'s')+' shown</span><span>'+(upcoming?'Next payday · '+esc(dateLabel(upcoming.date)):'Your money at a glance')+'</span></div>';
   $('#debtIncomeSummary').innerHTML=summary;$('#incomeSummary').innerHTML=summary;
   const rows=visible.map(a=>'<div class="bank-row"><span>'+esc(a.name)+'<small>'+esc(model.householdEnabled(planner.household)&&a.id===planner.household.billsAccountId?'Shared bills account':model.householdEnabled(planner.household)&&a.id===planner.household.personalAccountId?'Your personal checking':['credit','loan'].includes(a.type)?'Amount owed · Not included in cash':a.include&&(a.currency||'USD')==='USD'?'Included in forecast':'Not included in forecast')+'</small></span><strong>'+esc(a.balanceUnavailable?'Not supplied':money(a.balance,a.currency))+'</strong></div>').join('');
   $('#debtIncomeBalances').innerHTML=rows||'<p class="subtle">'+(accounts.length?'Choose accounts to show your bank balances.':authenticated?'Connect your bank in Settings to see your balances.':'Sign in and connect your bank in Settings.')+'</p>';
   $('#debtBankUpdated').textContent=connections.bankUpdated?'Last synced '+new Date(connections.bankUpdated).toLocaleString():'';
   $('#accountChoices').innerHTML=accounts.filter(a=>accountShown(a.id)).map(a=>'<label class="check-label"><input type="checkbox" data-account-visible="'+esc(a.id)+'" '+(visible.some(v=>v.id===a.id)?'checked':'')+'> '+esc(a.name)+'</label>').join('')||'<p class="subtle">Connect a bank in Settings first.</p>';
   $('#restoreBankEstimates').hidden=true;
   review=model.reviewBankActivity(connections.transactions||[],planner.bankRules,connections.recurringBills||[],currentDay,planner.transactionLinks);
   await syncRentBill();
   const electricRule=Object.values(planner.bankRules).find(r=>r.id===planner.electricBillId&&r.choice==='bill')||planner.manual.find(b=>b.id===planner.electricBillId);
   const electricLabel=$('#electricBillSelection');if(electricLabel)electricLabel.textContent=electricRule?'Linked bill: '+electricRule.name:'Choose Electric and enable Gmail in a bill’s details to link it.';
   const estimates=review.bills.map(b=>rentUpdated(mailModel.emailBillUpdate({...b,...planner.estimates[b.id],paidByCard:accounts.some(a=>a.type==='credit'&&a.id==='plaid-'+JSON.parse(b.groupKey)[1])},mailMessages(),planner.emailLinks)));
   const credit=model.creditBills((connections.creditCards||[]).filter(c=>!Object.values(planner.debtAccountLinks||{}).includes('plaid-'+c.accountId)).map(emailCredit),planner.creditCards);
   for(const bill of credit)bill.statementDate=(connections.creditCards||[]).map(emailCredit).find(c=>c.id===bill.id)?.statementDate;
   for(const bill of credit)if(planner.creditCards[bill.id]?.trackerCardId&&plan.state.cards?.some(c=>String(c.id)===planner.creditCards[bill.id].trackerCardId))bill.covered=true;
   const debtBills=model.trackerDebtBills(plan,credit,planner.creditCards,{includePaid:true});
   const paycheckPaid=new Set(model.paycheckPaidCreditBills(plan,credit,(connections.creditCards||[]).map(emailCredit),planner.creditCards));
   for(const bill of debtBills)if(bill.paidByPaycheck)paycheckPaid.add(bill.id+':'+bill.date);
   for(const bill of credit)bill.paidByPaycheck=paycheckPaid.has(bill.id+':'+bill.date);
   const paymentsPlanner={...planner,manual:planner.manual.map(b=>rentUpdated(mailModel.emailBillUpdate(b,mailMessages(),planner.emailLinks))),paid:[...new Set([...planner.paid,...paycheckPaid])]};
   const billPlan={...legacy,bills:[...(legacy.bills||[]).filter(b=>b.source!=='gmail'||!Object.values(planner.emailLinks).some(link=>link.sender===b.sender&&(!b.mailboxId||link.mailboxId===b.mailboxId)&&(!link.accountLast4||!b.accountLast4||link.accountLast4===b.accountLast4))).filter(b=>b.source!=='gmail'||b.billKind==='electric'||/consumers\s*energy|@(?:[a-z0-9-]+\.)*consumersenergy\.com/i.test((b.name||'')+' '+(b.sender||''))),...estimates,...credit,...debtBills]};
   const allBillEvents=model.billEvents({...billPlan,paid:[]},{...paymentsPlanner,paid:[]},linked,modelDay(currentDay,-365),modelDay(currentDay,366));
   const bankPaymentDetails=model.matchedBillPayments(allBillEvents.filter(b=>b.source!=='tracker-debt'),connections.transactions||[],planner.transactionLinks,currentDay,{details:true}),bankPaidDates=new Map(bankPaymentDetails.map(p=>[p.key,p.paidDate])),bankPaid=new Set(bankPaidDates.keys());
   paymentsPlanner.paid=[...new Set([...paymentsPlanner.paid,...bankPaid])];
   for(const bill of billPlan.bills)bill.paidByBank=bankPaid.has(bill.id+':'+bill.date);
   // Reserve bills before the payoff engine distributes money to debts. Payment
   // status stays in the forecast, where cash leaves on the actual due date.
   const paycheckInputs=structuredClone({legacy:{bills:billPlan.bills.filter(b=>b.source!=='tracker-debt')},planner:{manual:paymentsPlanner.manual,covered:planner.covered,electricBillId:planner.electricBillId,emailLinks:planner.emailLinks,paid:paymentsPlanner.paid,household:planner.household,billFunding:planner.billFunding,transactionLinks:planner.transactionLinks},linked,today:currentDay});
   if(window.setPaycheckBills(JSON.stringify(paycheckInputs),(date,n)=>model.paycheckBillItems(paycheckInputs,date,n)))return;
   householdBills=model.householdBillChoices([...billPlan.bills,...paymentsPlanner.manual]);
   const householdActive=model.householdEnabled(planner.household);
   $('#configureHousehold').textContent=householdActive?'Edit':'Set up';$('#sharedBillsToggle').checked=householdActive;
   $('#householdSummary').textContent=householdActive?money(planner.household.personalAmount)+' from each of your paychecks; '+money(planner.household.spouseAmount)+' from your spouse '+({weekly:'each week',biweekly:'every two weeks',monthly:'each month'})[planner.household.spouseRepeat]+'. Select shared bills here or in each bill’s editor.':'Send a set amount from each paycheck to a shared bills account.';
   $('#bankBillStatus').textContent=estimates.length+' tracked bank bill'+(estimates.length===1?'':'s')+'. The calendar includes recurring bills and scheduled debt payments.';
   const accountName=id=>{const a=accounts.find(a=>a.id==='plaid-'+id);return a?a.name+(a.mask?' · ••'+a.mask:''):'Unavailable account';};
   const selectedAccount=$('#transactionAccountFilter').value,transactionAccounts=[...new Set(review.rows.map(t=>t.account_id))].sort((a,b)=>accountName(a).localeCompare(accountName(b)));
   $('#transactionAccountFilter').innerHTML='<option value="">All accounts</option>'+transactionAccounts.map(id=>'<option value="'+esc(id)+'">'+esc(accountName(id))+'</option>').join('');
   $('#transactionAccountFilter').value=transactionAccounts.includes(selectedAccount)?selectedAccount:'';
   const filter=$('#transactionFilter').value,accountFilter=$('#transactionAccountFilter').value,activity=review.rows.filter(t=>(!accountFilter||t.account_id===accountFilter)&&(filter!=='spending'||personalTransactions.some(p=>p.transaction_id===t.transaction_id))&&(filter==='all'||t.choice===filter)&&(!spendingCategory||t.spendingCategoryKey===spendingCategory));
   activity.sort((a,b)=>($('#transactionSort').value==='account'?accountName(a.account_id).localeCompare(accountName(b.account_id))||a.account_id.localeCompare(b.account_id):0)||b.date.localeCompare(a.date));
   $('#transactionCount').textContent=activity.length+' transaction'+(activity.length===1?'':'s');
   $('#bankTransactions').innerHTML=activity.map(t=>'<div class="transaction-entry"><div class="bill-entry-top"><span>'+esc(t.name)+'</span><strong>'+money(Math.round(t.amount*100))+'</strong></div><small>'+esc(dateLabel(t.date)+' · '+accountName(t.account_id)+' · '+t.label)+'</small><div class="bill-actions">'+(t.linkedTarget?'<button type="button" data-edit-linked="'+esc(t.linkedTarget)+'">Edit linked account</button>':'<button type="button" data-track-transaction="'+esc(t.transaction_id)+'" '+(t.choice==='bill'?'disabled':'')+'>'+(t.choice==='bill'?'Tracking bill':'Track bill')+'</button><button type="button" data-spending-transaction="'+esc(t.transaction_id)+'" '+(planner.bankRules[t.key]?.choice==='spending'?'disabled':'')+'>Personal spending</button>'+(planner.bankRules[t.key]?'<button type="button" data-reset-transaction="'+esc(t.transaction_id)+'">Undo choice</button>':''))+'</div></div>').join('')||'<p class="subtle">'+(review.rows.length?'No transactions in this group.':'Refresh your bank to load recent outgoing transactions.')+'</p>';

   $('#incomeBalances').innerHTML=visible.length?rows:'<p class="subtle">'+(accounts.length?'Choose accounts to show your balances.':authenticated?'Connect your bank in Settings to see your balances here.':'Sign in and connect your bank in Settings to see your balances.')+'</p>';
   $('#incomeBankUpdated').textContent=connections.bankUpdated?'Last synced '+new Date(connections.bankUpdated).toLocaleString():'';
   const today=iso(new Date()),start=iso(month),end=iso(new Date(month.getFullYear(),month.getMonth()+1,0));
   const bills=model.billEvents(billPlan,paymentsPlanner,linked,start,end),paydays=model.paydayEvents(plan,start,end),contributions=model.spouseEvents(planner.household,start,end);
   $('#calendarMonth').textContent=month.toLocaleDateString('en-US',{month:'long',year:'numeric'});
   let cells='<span></span>'.repeat(month.getDay());
   for(let d=1;d<=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();d++){
    const date=iso(new Date(month.getFullYear(),month.getMonth(),d)),due=bills.filter(b=>b.date===date),pay=[...paydays,...contributions].filter(p=>p.date===date);
    cells+='<button type="button" data-calendar-day="'+date+'" aria-label="'+esc(dateLabel(date)+(due.length?', '+due.length+' payments':'')+(pay.length?', payday':''))+'" aria-pressed="'+(selected===date)+'" class="'+(date===today?'today ':'')+(selected===date?'selected':'')+'">'+d+'<span class="day-dots">'+(due.length?'<i class="bill-dot"></i>':'')+(pay.length?'<i class="pay-dot"></i>':'')+'</span></button>';
   }
   $('#billCalendar').innerHTML=cells;$('#clearDay').hidden=!selected;
   $('#agendaHeading').textContent=selected?'Payments · '+dateLabel(selected):'Payments this month';
   const paidBills=model.billEvents({...billPlan,paid:[]},{...paymentsPlanner,paid:[]},linked,start,end).filter(b=>b.date>=start&&paymentsPlanner.paid.includes(b.key)),yearEnd=modelDay(today,366);
   const upcomingBills=model.billEvents(billPlan,paymentsPlanner,linked,today,yearEnd);
   for(const bill of [...billPlan.bills,...planner.manual])if(bill.source!=='tracker-debt'&&bill.date>yearEnd&&!upcomingBills.some(b=>b.id===bill.id))upcomingBills.push(...model.billEvents({bills:[bill]},{...planner,manual:[]},linked,bill.date,bill.date));
   upcomingBills.sort((a,b)=>a.date.localeCompare(b.date));
   const payments=model.accountPaymentRows(upcomingBills),list=payments.filter(b=>!model.isDebtPayment(b));
   const accountPaid=model.billEvents({...billPlan,paid:[]},{...paymentsPlanner,paid:[]},linked,today,yearEnd).filter(b=>paymentsPlanner.paid.includes(b.key));
   renderDebtAccounts(plan,connections,accounts,payments,accountPaid);
   const calendarRows=[...bills,...paidBills.map(b=>({...b,isPaid:true}))].filter(b=>!selected||b.date===selected).sort((a,b)=>a.date.localeCompare(b.date));
   $('#calendarAgenda').innerHTML=(householdActive?paydays.filter(p=>!selected||p.date===selected).map(p=>'<div class="calendar-agenda-row"><span><strong>Fixed Bills transfer</strong><small>'+esc(dateLabel(p.date))+' · Personal → shared account</small></span><strong>'+money(planner.household.personalAmount)+'</strong></div>').join(''):'')+contributions.filter(c=>!selected||c.date===selected).map(c=>'<div class="calendar-agenda-row"><span><strong>Spouse contribution</strong><small>'+esc(dateLabel(c.date))+' · To shared bills account</small></span><strong>+'+money(c.amount)+'</strong></div>').join('')+calendarRows.map(b=>'<button type="button" class="calendar-agenda-row" data-account-view="'+(model.isDebtPayment(b)?'debt':'bills')+'"><span><strong>'+esc(b.name)+'</strong><small>'+esc(dateLabel(b.date))+' · '+(b.isPaid?'✓ Paid':b.shared?'Shared bills account':model.isDebtPayment(b)?'Debt payment':'Bill')+'</small></span><strong>'+money(b.amount)+'</strong></button>').join('')||'<p class="subtle">No payments '+(selected?'on this day.':'this month.')+'</p>';
   const billTile=(b,paid=false)=>{
    const editable=['bank-tracked','manual'].includes(b.source),d=new Date(b.date+'T12:00:00'),category=billCategories[b.billKind]||'Bill',status=paid?(bankPaid.has(b.key)?'Paid '+dateLabel(bankPaidDates.get(b.key))+' · Bank transaction':'Marked paid'):b.rentLinked?(b.rentNeedsLogin?'Portal · last saved amount':b.rentConfirmed?'Updated by rent portal':'Portal · estimated amount'):(b.gmailConfirmed||b.emailConfirmed||b.source==='gmail')?'Confirmed by Gmail':b.emailAmountConfirmed?'Gmail amount · Estimated date':(planner.electricBillId===b.id||planner.emailLinks['bill:'+b.id])?'Gmail linked · Estimated':'Estimated';
    return '<article class="bill-tile recurring-account" data-account-id="'+esc(b.id)+'">'+(editable?'<button type="button" class="bill-icon-button account-edit" data-edit-bill="'+esc(b.id)+'" aria-label="Edit '+esc(b.name)+'">'+pencil+'</button>':'')+'<div class="bill-tile-main"><div class="bill-date '+(b.date<today&&!paid?'is-overdue':'')+'"><span>'+esc(d.toLocaleDateString('en-US',{month:'short'}))+'</span><strong>'+d.getDate()+'</strong></div><div class="bill-tile-info"><h4>'+esc(b.name)+'</h4><span class="bill-category">'+esc(category)+'</span><small>'+esc(b.date<today&&!paid?'Overdue':status)+'</small></div></div><div class="bill-amount"><span>'+(paid?'Amount paid':'Amount owed')+'</span><strong>'+money(b.amount)+'</strong></div>'+connectionMarkup('bill:'+b.id,b)+'<div class="bill-tile-footer"><span>'+esc(b.shared?'Shared account · Fixed Bills':b.paidByCard?'Paid through credit card':({monthly:'Monthly',biweekly:'Every two weeks',weekly:'Weekly',once:'One-time bill'})[b.repeat]||'Scheduled')+'</span>'+(paid&&bankPaid.has(b.key)?'<span>✓ Bank payment</span>':'<button class="bill-paid-button" '+(paid?'data-bill-unpaid':'data-bill-paid')+'="'+esc(b.key)+'">'+(paid?'Mark unpaid':'✓ Mark paid')+'</button>')+'</div>'+billLoanMarkup(b)+paymentMarkup('bill:'+b.id)+'</article>';
   };
   $('#billAgenda').innerHTML=list.map(b=>billTile(b)).join('')||'<p class="subtle">Add a recurring bill or track one from your transactions.</p>';
   $('#billAccountCount').textContent=list.length;
   const paidRecurring=paidBills.filter(b=>!model.isDebtPayment(b));
   if(paidRecurring.length)$('#billAgenda').insertAdjacentHTML('beforeend','<details class="add-bill"><summary>Paid this month ('+paidRecurring.length+')</summary>'+paidRecurring.map(b=>billTile(b,true)).join('')+'</details>');
   const paidAmount=paidBills.reduce((n,b)=>n+b.amount,0),unpaidAmount=bills.reduce((n,b)=>n+b.amount,0),totalBills=paidBills.length+bills.length,paidPercent=paidAmount+unpaidAmount?Math.round(paidAmount/(paidAmount+unpaidAmount)*100):0;
   $('#billVisuals').innerHTML='<div class="bill-progress"><div class="progress-ring" role="img" aria-label="'+paidPercent+' percent of bill amount paid" style="background:conic-gradient(var(--accent) '+paidPercent+'%,var(--line) 0)"><span><strong>'+paidPercent+'%</strong><small>paid</small></span></div><div><span class="chart-eyebrow">Payments this month</span><strong>'+money(unpaidAmount)+'</strong><small>remaining · '+paidBills.length+' of '+totalBills+' paid</small></div></div>';
   forecastStart=today;forecastLength=[30,90,180].includes(planner.forecastDays)?planner.forecastDays:30;
   const future=modelDay(today,forecastLength);
   for(const button of document.querySelectorAll('[data-forecast-days]'))button.setAttribute('aria-pressed',String(Number(button.dataset.forecastDays)===forecastLength));
   const rangeText='Projected through '+new Date(future+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})+'. Future bill amounts remain estimates.';
   $('#forecastRangeStatus').textContent=rangeText;$('#billsForecastRangeStatus').textContent=rangeText;
   const forecastBills=model.billEvents(billPlan,paymentsPlanner,linked,today,future),debtMode=['full','minimum','none'].includes(planner.forecastDebtMode)?planner.forecastDebtMode:'full';
   const personalAccounts=personalAccount?[{...personalAccount,include:true}]:[];
   const f=model.scenarioForecast(householdActive?(personalAccount?accounts:[]):personalAccounts,plan,forecastBills,today,{debtMode,length:forecastLength,household:planner.household,scope:'personal',transactions:connections.transactions||[],includePersonalSpending:true});
   const billsForecast=householdActive?model.scenarioForecast(accounts,plan,forecastBills,today,{debtMode:'none',length:forecastLength,household:planner.household,scope:'shared',transactions:connections.transactions||[]}):model.cashForecast([],[],[],today,forecastLength);
   const billsAccount=accounts.find(a=>a.id===planner.household.billsAccountId);
   $('#billsForecastAccount').textContent=householdActive&&billsAccount?'Bills account: '+billsAccount.name+'. Includes your scheduled transfers and spouse contributions.':'Choose your bills account and set up contributions in Budget to see its forecast.';
   const lastDebtRow=plan.schedule?.at(-1);if(debtMode==='full'&&lastDebtRow?.total>0.01&&future>lastDebtRow.date)$('#forecastRangeStatus').textContent+=' Later debt payments are outside the current payoff plan.';
   for(const button of document.querySelectorAll('[data-forecast-debt-mode]'))button.setAttribute('aria-pressed',String(button.dataset.forecastDebtMode===debtMode));
   $('#forecastModeNote').textContent=({full:'Includes your full planned debt payments.',minimum:'Uses saved per-paycheck minimums.',none:'Shows your personal balance before debt payments.'})[debtMode];
   const spending=model.reviewBankActivity(personalTransactions,planner.bankRules,[],currentDay,planner.transactionLinks).spending;
   const groups=spending.categories||[],spendingTotal=spending.total;let angle=0;
   const stops=groups.map((g,i)=>{const from=angle;angle+=g.amount/spendingTotal*360;return chartColors[i%chartColors.length]+' '+from+'deg '+angle+'deg';});
   $('#spendingDonut').innerHTML='<div class="spending-chart"><div class="spending-ring" role="img" aria-label="'+esc('Personal spending total '+money(spendingTotal))+'" style="background:'+(stops.length?'conic-gradient('+stops.join(',')+')':'var(--line)')+'"><div><small>SPENT</small><strong>'+money(spendingTotal)+'</strong><span>last 30 days</span></div></div><div class="spending-highlight"><span class="chart-eyebrow">Your spending mix</span><strong>'+esc(groups[0]?.label||'A fresh start')+'</strong><p>'+(groups.length?Math.round(groups[0].amount/spendingTotal*100)+'% went to this category. Tap a category below to explore.':'Your chart fills in as bank purchases arrive.')+'</p></div></div>';
   $('#personalSpending').innerHTML=groups.map((g,i)=>'<button type="button" class="spending-category" data-spending-category="'+esc(g.key)+'"><span class="category-heading"><span><i style="background:'+chartColors[i%chartColors.length]+'"></i>'+esc(g.label)+'</span><strong>'+money(g.amount)+'</strong></span><span class="category-bar"><i style="width:'+g.amount/spendingTotal*100+'%;background:'+chartColors[i%chartColors.length]+'"></i></span><small>'+g.count+' purchase'+(g.count===1?'':'s')+' · '+Math.round(g.amount/spendingTotal*100)+'%</small></button>').join('');
   $('#spendingForecastNote').textContent=personalAccount?.source==='simplefin'?'This SimpleFIN connection supplies balances only; purchase history is unavailable.':personalAccount?'Last 30 days from '+personalAccount.name+' only: '+money(spendingTotal)+'. The forecast uses your planned budget; past purchases are already reflected in your balance.':'Choose your personal checking account above. Spending from other accounts is excluded.';
   renderBillsSpending(model.billsAccountSpending(connections.transactions||[],billsAccount,currentDay,planner.bankRules,planner.transactionLinks),billsAccount);
   renderAccountForecast(f,today,plan,'personal');renderAccountForecast(billsForecast,today,plan,'bills');
   paymentDisplaySignature=mailDisplaySignature();
  }catch(e){error(e);}
 }
 function renderBillsSpending(spending,account){
  $('#billsSpendingAccount').textContent=!account?'Choose your bills account below.':account.source==='simplefin'?'Purchase history is unavailable for this SimpleFIN balance connection.':'Posted outgoing payments from '+account.name+' only. Transfers between accounts are excluded.';
  const groups=spending.categories,total=spending.total;let angle=0;
  const stops=groups.map((g,i)=>{const from=angle;angle+=g.amount/total*360;return chartColors[i%chartColors.length]+' '+from+'deg '+angle+'deg';});
  $('#billsSpendingDonut').innerHTML='<div class="spending-chart"><div class="spending-ring" role="img" aria-label="Bills account spending '+esc(money(total))+'" style="background:'+(stops.length?'conic-gradient('+stops.join(',')+')':'var(--line)')+'"><div><small>SPENT</small><strong>'+money(total)+'</strong><span>last 30 days</span></div></div><div class="spending-highlight"><span class="chart-eyebrow">Bills account</span><strong>'+esc(groups[0]?.label||'No posted payments')+'</strong><p>'+spending.rows.length+' payments in the last 30 days.</p></div></div>';
  $('#billsSpendingCategories').innerHTML=groups.map((g,i)=>'<div class="spending-category"><span class="category-heading"><span><i style="background:'+chartColors[i%chartColors.length]+'"></i>'+esc(g.label)+'</span><strong>'+money(g.amount)+'</strong></span><span class="category-bar"><i style="width:'+g.amount/total*100+'%;background:'+chartColors[i%chartColors.length]+'"></i></span><small>'+g.count+' payment'+(g.count===1?'':'s')+'</small></div>').join('');
  $('#billsSpendingTransactions').innerHTML=spending.rows.map(t=>'<div class="forecast-row"><span>'+esc(t.name)+'<small>'+esc(dateLabel(t.date)+' · '+t.spendingLabel)+'</small></span><strong>'+money(Math.round(t.amount*100))+'</strong></div>').join('')||'<p class="subtle">No posted outgoing payments available for this account.</p>';
 }
 function renderAccountForecast(f,today,plan,scope){
  const prefix=scope==='bills'?'billsForecast':'forecast';
   const forecastPoints=model.forecastTimeline(f,today);
   forecastViews[scope]={points:forecastPoints,start:today,length:forecastLength};
   const forecastDate=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',...(forecastLength>180?{year:'numeric'}:{})});
   if(f.opening!==null){
    // Keep extrema from each bucket so a long chart does not hide a shortfall.
    const sampled=[],bucket=Math.max(1,Math.ceil(forecastPoints.length/200));
    for(let i=0;i<forecastPoints.length;i+=bucket){const group=forecastPoints.slice(i,i+bucket);let min=group[0],max=group[0];for(const p of group){if(p.balance<min.balance)min=p;if(p.balance>max.balance)max=p;}for(const p of [...new Set([group[0],min,max,group.at(-1)])].sort((a,b)=>a.date.localeCompare(b.date)))sampled.push(p);}
    let low=0,high=1;for(const p of forecastPoints){low=Math.min(low,p.balance);high=Math.max(high,p.balance);}const span=high-low||1;
    const xy=sampled.map(p=>[12+(Date.parse(p.date+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000/Math.max(1,forecastLength)*276,130-(p.balance-low)/span*110]),path=xy.map(([x,y],i)=>i?'H'+x.toFixed(1)+' V'+y.toFixed(1):'M'+x.toFixed(1)+','+y.toFixed(1)).join(' ');
    $(scope==='bills'?'#billsForecastChart':'#forecastChart').innerHTML='<div class="forecast-chart"><svg viewBox="0 0 300 150" role="img" aria-label="Projected bank balance through '+esc(forecastDate(f.end))+'"><title>Account forecast: '+esc(money(f.endBalance))+' on '+esc(forecastDate(f.end))+'</title><path d="'+path+' L288,140 L12,140 Z" fill="var(--accent)" opacity=".09"/><path d="'+path+'" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/><line id="'+prefix+'Cursor" x1="288" x2="288" y1="12" y2="140" stroke="var(--muted)" stroke-dasharray="3 4"/></svg><div class="chart-axis"><span>'+esc(forecastDate(today))+'</span><span>'+esc(forecastDate(f.end))+'</span></div><label class="chart-scrubber">Explore your balance<input type="range" data-forecast-scrub="'+scope+'" id="'+prefix+'Scrub" min="0" max="'+forecastLength+'" value="'+forecastLength+'" aria-label="Forecast day"></label><output id="'+prefix+'Point" aria-live="polite">'+esc(forecastDate(f.end))+' · '+money(f.endBalance)+'</output></div>';
   }else $(scope==='bills'?'#billsForecastChart':'#forecastChart').innerHTML='';
   const unknown=f.opening===null;
   const firstNegative=f.opening!==null&&f.opening<0?{date:today,balance:f.opening,opening:true}:f.rows.find(r=>r.balance!==null&&r.balance<0);
   const lowest=f.opening===f.low?{date:today}:f.rows.find(r=>r.balance===f.low);
   const shortfall=firstNegative?'<div class="forecast-warning"><strong>'+(firstNegative.opening?'Current balance is negative':'First projected negative balance')+': '+esc(forecastDate(firstNegative.date))+' · '+money(firstNegative.balance)+'</strong>'+(firstNegative.name?'<span>After '+esc(firstNegative.name)+'.</span>':'')+'<span>Lowest projected balance: '+money(f.low)+' on '+esc(forecastDate(lowest?.date||firstNegative.date))+'.</span></div>':'';
   $(scope==='bills'?'#billsForecast':'#incomeForecast').innerHTML='<p class="subtle">'+(unknown?'Choose the account above to see your projected balance.':'Projected available on '+forecastDate(f.end))+'</p><div class="forecast-main">'+(unknown?'—':money(f.endBalance))+'</div><div class="forecast-stats"><div><small>'+(scope==='bills'?'Expected deposits':'Expected income')+'</small><strong>'+money(f.income)+'</strong></div><div><small>Planned outflow</small><strong>'+money(f.outgoing)+'</strong></div><div><small>Lowest projected balance</small><strong>'+(unknown?'—':money(f.low))+'</strong></div></div>'+shortfall+(!plan.state.startDate?'<p class="forecast-warning">Set your first payday and take-home pay in Income to include income in this forecast.</p>':'')+f.rows.filter(r=>r.type!=='spending').slice(0,forecastRowLimit).map(r=>'<div class="forecast-row forecast-ledger-row'+(r.balance!==null&&r.balance<0?' is-negative':'')+'"><span>'+esc(r.name)+'<small>'+esc(forecastDate(r.date)+(r.type==='income'?' · after planned allocations':r.received?' · already in bank balance':r.type==='transfer'?' · between your accounts':r.type==='contribution'?' · to shared bills account':r.overdue?' · overdue bill':' · bill'))+'</small></span><strong>'+(r.delta>=0?'+':'−')+money(Math.abs(r.delta))+'</strong>'+(r.balance===null?'':'<div class="forecast-running-balance"><span>Projected balance'+(r.balance<0?' · Below zero':'')+'</span><strong>'+money(r.balance)+'</strong></div>')+'</div>').join('')+(f.rows.length>forecastRowLimit?'<button type="button" data-more-forecast="'+scope+'">Show next 100 entries ('+(f.rows.length-forecastRowLimit)+' remaining)</button>':'');
 }
 document.addEventListener('click',async e=>{
  if(e.target.closest('[data-choose-accounts]'))$('#accountPicker').showModal();
  const hide=e.target.closest('[data-estimate-dismiss]');if(hide){try{const bill=review.bills.find(b=>b.id===hide.dataset.estimateDismiss);if(bill)delete planner.bankRules[bill.groupKey];await save();}catch(e){error(e);}}
 });
 document.addEventListener('click',async e=>{
  const range=e.target.closest('[data-forecast-days]');if(e.target.closest('[data-more-forecast]')){forecastRowLimit+=100;await renderIncome();return;}if(!range)return;
  const before=structuredClone(planner);try{planner.forecastDays=[30,90,180].includes(Number(range.dataset.forecastDays))?Number(range.dataset.forecastDays):30;delete planner.forecastEnd;forecastRowLimit=100;await save();}catch(error){planner=before;$('#forecastRangeStatus').textContent=error.message;}
 });
 $('#restoreBankEstimates').onclick=async()=>{try{planner.dismissedEstimates=[];await save();}catch(e){error(e);}};
 $('#closeAccountPicker').onclick=()=>$('#accountPicker').close();
 $('#accountPicker').addEventListener('click',e=>{if(e.target===$('#accountPicker')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
 document.addEventListener('change',async e=>{const input=e.target.closest('[data-account-visible]');if(!input)return;input.disabled=true;const id=input.dataset.accountVisible,old=planner.accountVisibility[id];planner.accountVisibility[id]=input.checked;try{await save();$('#accountPickerStatus').textContent='Saved';}catch(e){if(old===undefined)delete planner.accountVisibility[id];else planner.accountVisibility[id]=old;input.checked=!input.checked;$('#accountPickerStatus').textContent=e.message;}finally{input.disabled=false;}});


 document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-hide-connected-account],[data-show-connected-account]');if(!button||!ready)return;
  const id=button.dataset.hideConnectedAccount||button.dataset.showConnectedAccount,old={...planner.hiddenConnectedAccounts};button.disabled=true;
  planner.hiddenConnectedAccounts={...old};if(button.dataset.hideConnectedAccount)planner.hiddenConnectedAccounts[id]=true;else delete planner.hiddenConnectedAccounts[id];
  try{await save();window.BearDen.refreshAccountLists?.();$('#connectionMessage').textContent=button.dataset.hideConnectedAccount?'Account hidden. Restore it under Hidden accounts.':'Account shown.';}catch(e){planner.hiddenConnectedAccounts=old;$('#connectionMessage').textContent=e.message;}finally{button.disabled=false;}
 });
 const sunConnection=()=>window.BearDen.plan?.connections?.sun;
 const rentUpdated=b=>rentModel.sunRentBill(b,planner.sunRent,sunConnection());
 function existingRentBills(){return [...planner.manual,...review.bills].filter((b,i,all)=>all.findIndex(x=>x.id===b.id)===i);}
 function writeRentBill(bill,field,originalAmount){
  const base={...bill,...planner.estimates[bill.id]},manual=planner.manual.find(b=>b.id===bill.id),rule=Object.values(planner.bankRules).find(b=>b.id===bill.id);
  rentModel.linkSunRent(planner,bill.id,field,sunConnection(),originalAmount==null?base:{...base,amount:originalAmount});
  const updated=rentUpdated({...base,billKind:'rent'});
  if(manual)Object.assign(manual,{amount:updated.amount,date:updated.date,billKind:'rent',repeat:'monthly'});
  else if(rule){Object.assign(rule,{billKind:'rent',repeat:'monthly'});planner.estimates[bill.id]={...planner.estimates[bill.id],amount:updated.amount,date:updated.date};}
  planner.paid=planner.paid.map(key=>rentModel.rentPaidKey(key,updated));
 }
 let rentSyncing;
 async function syncRentBill(){
  if(rentSyncing)return rentSyncing;
  const sun=sunConnection(),bills=existingRentBills().filter(b=>b.billKind==='rent'&&!planner.sunRentDisabled?.[b.id]),bill=bills.find(b=>b.id===planner.sunRent?.billId)||(bills.length===1?bills[0]:null);
  $('#rentAutoStatus').textContent=!sun?.snapshot?'':bill?'Automatically updating '+bill.name+' from your rent portal.':bills.length>1?'Choose the rent bill to update by enabling portal updates in its editor.':'Mark your bill as Rent in Accounts to use portal updates. You can turn updates on or off in the bill editor.';
  if(!sun?.snapshot||sun.enabled===false||!bill)return;
  const before=JSON.stringify(planner);writeRentBill(bill,'currentBalance');
  const after=JSON.stringify(planner);if(before===after)return;
  rentSyncing=window.BearDen.storage.set('income-planner',after).catch(e=>{planner=JSON.parse(before);throw e;}).finally(()=>{rentSyncing=null;});
  return rentSyncing;
 }
 const rentField=document.createElement('div');rentField.id='billRentField';rentField.className='email-link';rentField.innerHTML='<strong>Rent schedule</strong><p class="subtle">Due on the 1st of every month.</p><label class="check-label"><input name="sunRent" type="checkbox"> Update amount from rent portal</label><p id="billRentInfo" class="subtle"></p><button type="button" id="billRentSettings">Open rent connection in Settings</button>';
 $('#billCategory').closest('label').after(rentField);
 function renderBillRentInfo(apply=false){
  const form=$('#billEditorForm'),rent=form.elements.billKind.value==='rent',enabled=rent&&form.elements.sunRent.checked,connection=sunConnection();rentField.hidden=!rent;
  form.elements.sunRent.disabled=!connection?.snapshot;
  form.elements.amount.readOnly=enabled&&rentModel.rentReadings(connection).length>0;
  form.elements.repeat.disabled=rent;
  if(rent){form.elements.repeat.value='monthly';if(form.elements.date.value)form.elements.date.value=form.elements.date.value.slice(0,7)+'-01';}
  if(apply&&enabled){const reading=rentModel.rentReadings(connection).at(-1);if(reading)form.elements.amount.value=reading.amount/100;}
  $('#billRentInfo').textContent=enabled?'Your rent portal updates this bill automatically. A zero balance after payment keeps your recurring rent estimate.':connection?.snapshot?'Enable portal updates to use the saved portal amount.':'Configure your rent portal in Settings to enable updates.';
 }
 $('#billRentSettings').onclick=()=>{$('#billEditor').close();window.selectBearTab('settings');(sunConnection()?.enabled===false?$('#rentTrackingOption'):$('#rentSection')).scrollIntoView({block:'start'});};
 $('#billEditorForm').elements.sunRent.onchange=()=>renderBillRentInfo(true);
 $('#billEditorForm').elements.date.addEventListener('change',()=>renderBillRentInfo());
 function billLoanMarkup(b){
  if(!accountShown(planner.loanLinks?.[b.id]))return '';
  const loan=model.linkedBillLoan(b,planner,window.BearDen.plan?.state?.accounts||[]);
  return !loan?'':loan.balanceUnavailable?'<p class="subtle">Loan balance not supplied by Plaid. Your scheduled payment is unchanged.</p>':loan.balance===0?'<p class="subtle">Plaid reports a $0 loan balance; this is not the payment due. Your scheduled payment is unchanged. Verify with your bank.</p>':loan.unavailable?'<p class="subtle">Linked loan unavailable · Reconnect your bank in Settings.</p>':'<p class="subtle">Remaining loan balance <strong>'+esc(money(loan.balance,loan.currency))+'</strong></p>';
 }
 const loanField=document.createElement('div');loanField.id='billLoanField';loanField.innerHTML='<label>Linked loan account<select name="loanAccount"><option value="">No linked loan</option></select></label><p class="subtle" id="billLoanInfo"></p>';
 $('#billCategory').closest('label').after(loanField);
 function renderBillLoanInfo(){
  const form=$('#billEditorForm'),id=form.elements.loanAccount.value,a=(window.BearDen.plan?.state?.accounts||[]).find(a=>a.id===id&&a.type==='loan');
  loanField.hidden=form.elements.billKind.value!=='car-payment';
  $('#billLoanInfo').textContent=a?a.name+' · Remaining loan balance '+(a.balanceUnavailable?'Not supplied':money(a.balance,a.currency||'USD'))+'. Updates when your bank syncs. Keep the monthly payment and due date below.':id?'Linked loan unavailable. Reconnect your bank in Settings.':'Choose the loan for this car, including an ELGA loan. The loan balance does not replace your monthly payment. Use the transaction link below to track payments from checking.';
 }
 $('#billEditorForm').elements.loanAccount.onchange=renderBillLoanInfo;
 function openBillEditor(id,transaction,newManual=false){
  const manual=planner.manual.find(b=>b.id===id),raw=review.bills.find(b=>b.id===id),existing=raw?planner.bankRules[raw.groupKey]:null;
  let base=manual||raw;if(newManual)base={id:null,name:'',amount:0,date:iso(new Date()),repeat:'monthly',billKind:'other'};
  if(transaction){const temporary={choice:'bill',id:'new',name:transaction.name,amount:Math.round(transaction.amount*100),lastPayment:transaction.date,repeat:'monthly'};base=model.reviewBankActivity([transaction],{[transaction.key]:temporary},[],iso(new Date())).bills[0];}
  if(!base)return;
  const b=rentUpdated(mailModel.emailBillUpdate({...base,...planner.estimates[base.id]},mailMessages(),planner.emailLinks)),form=$('#billEditorForm');
  editingBill={id:transaction?null:id,key:transaction?.key||raw?.groupKey,transaction,base,manual:!!manual,newManual};
  form.reset();form.elements.billKind.innerHTML=Object.entries(billCategories).filter(([key])=>!['credit-card','loan'].includes(key)||key===b.billKind).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('');form.elements.name.value=b.name;form.elements.billKind.value=billCategories[b.billKind]?b.billKind:'other';form.elements.amount.value=newManual?'':b.amount/100;form.elements.date.value=b.date;form.elements.repeat.value=b.repeat||'monthly';form.elements.covered.checked=!!planner.covered[id];
  const loanId=planner.loanLinks?.[id]||'',loans=(window.BearDen.plan?.state?.accounts||[]).filter(a=>['plaid','simplefin'].includes(a.source)&&a.type==='loan'&&(accountShown(a.id)||a.id===loanId));
  form.elements.loanAccount.innerHTML='<option value="">No linked loan</option>'+loans.map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+' ('+(a.source==='simplefin'?'SimpleFIN':'Plaid')+') · '+esc((a.balanceUnavailable?'Not supplied':money(a.balance,a.currency||'USD')))+' remaining</option>').join('')+(loanId&&!loans.some(a=>a.id===loanId)?'<option value="'+esc(loanId)+'">Previously linked loan (unavailable)</option>':'');
  form.elements.loanAccount.value=loanId;renderBillLoanInfo();
  form.elements.sunRent.checked=planner.sunRent?.billId===id||!!sunConnection()?.snapshot&&!planner.sunRentDisabled?.[id]&&!planner.sunRent;if(b.billKind==='rent'&&form.elements.date.value<rentModel.nextRentDate())form.elements.date.value=rentModel.nextRentDate();renderBillRentInfo();
  form.elements.funding.value=model.sharedBill(b,planner)?'shared':'personal';$('#billFundingLabel').hidden=!model.householdEnabled(planner.household);$('#billFundingNote').textContent=model.householdEnabled(planner.household)?'Shared bills are covered by your Fixed Bills contribution; their full amounts leave the shared account.':'Set up Fixed Bills in Income → Budget to use a shared bills account.';
  form.elements.covered.closest('label').hidden=model.householdEnabled(planner.household)&&form.elements.funding.value==='shared';
  form.elements.gmailElectric.checked=planner.electricBillId===id||(!planner.electricBillId&&b.billKind==='electric');
  $('#electricLinkOption').hidden=form.elements.billKind.value!=='electric';
  $('#billEditorTitle').textContent=newManual?'Add recurring bill':transaction?'Track a bill':'Bill details';$('#billEditorSource').textContent=transaction?'Bank transaction: '+transaction.name:raw?'Linked to your bank transactions. Your custom name stays the same after a sync.':'Your manually added bill.';
  const seed=transaction||(raw?bankTransactions().find(t=>model.transactionKey(t)===raw.groupKey):null);
  setEditorLink('bill','bill:'+id,planner.transactionLinks['bill:'+id]||(seed?model.paymentLink(seed,{exactAmount:b.billKind==='car-payment'}):null),b.billKind==='car-payment');
  $('#stopTrackingBill').hidden=!!transaction||newManual;$('#billEditorError').textContent='';$('#billEditor').showModal();
 }
 document.addEventListener('click',e=>{const button=e.target.closest('[data-edit-bill]');if(button)openBillEditor(button.dataset.editBill);});
 $('#billEditorForm').elements.funding.onchange=e=>{$('#billEditorForm').elements.covered.closest('label').hidden=e.target.value==='shared';};
 $('#billCategory').onchange=e=>{if(e.target.value==='rent'){$('#billEditorForm').elements.date.value=rentModel.nextRentDate();$('#billEditorForm').elements.sunRent.checked=!!sunConnection()?.snapshot&&!planner.sunRentDisabled?.[editingBill?.id]&&(!planner.sunRent||planner.sunRent.billId===editingBill?.id);}renderBillRentInfo(true);renderBillLoanInfo();const electric=e.target.value==='electric';$('#electricLinkOption').hidden=!electric;if(electric&&!planner.electricBillId)$('#billEditorForm').elements.gmailElectric.checked=true;if(emailDrafts.bill)renderEmailDraft('bill');};
 $('#closeBillEditor').onclick=()=>$('#billEditor').close();
 $('#billEditor').addEventListener('click',e=>{if(e.target===e.currentTarget){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
 $('#billEditorForm').onsubmit=async e=>{
  e.preventDefault();if(!editingBill)return;const form=e.currentTarget,d=new FormData(form),name=String(d.get('name')).trim(),amount=Math.round(Number(d.get('amount'))*100),billKind=d.get('billKind'),selectedDate=String(d.get('date')),date=billKind==='rent'?(!editingBill.newManual&&selectedDate===rentModel.nextRentDate()&&editingBill.base.date<selectedDate?editingBill.base.date:selectedDate).slice(0,7)+'-01':selectedDate,repeat=billKind==='rent'?'monthly':d.get('repeat');
  if(!name||!Number.isSafeInteger(amount)||amount<=0||!date||!billCategories[billKind])return;
  const snapshot=structuredClone(planner),button=form.querySelector('[type=submit]');button.disabled=true;
  try{
   if(d.get('loanAccount')&&Object.values(planner.debtAccountLinks||{}).includes(String(d.get('loanAccount'))))throw Error('This loan is already linked to a debt. Unlink that debt first.');
   const id=editingBill.id||(editingBill.newManual?'manual-':'tracked-')+crypto.randomUUID();
   if(editingBill.newManual){planner.manual.push({id,name,amount,date,repeat,billKind,source:'manual'});}
   else if(editingBill.manual){const b=planner.manual.find(b=>b.id===id);Object.assign(b,{name,amount,date,repeat,billKind});}
   else{
    const old=planner.bankRules[editingBill.key]||{},t=editingBill.transaction;
    planner.bankRules[editingBill.key]={...old,choice:'bill',id,name,billKind,amount:editingBill.base.amount,lastPayment:t?.date||editingBill.base.lastPayment,repeat};
    const correction={};if(amount!==editingBill.base.amount)correction.amount=amount;if(date!==editingBill.base.date)correction.date=date;planner.estimates[id]=correction;
   }
   planner.loanLinks??={};if(billKind==='car-payment'&&d.get('loanAccount'))planner.loanLinks[id]=String(d.get('loanAccount'));else delete planner.loanLinks[id];
   storeEditorLink('bill','bill:'+id,name);
   if(!linkDrafts.bill.link&&!editingBill.manual&&!editingBill.newManual){delete planner.bankRules[editingBill.key];delete planner.estimates[id];planner.manual.push({id,name,amount,date,repeat,billKind,source:'manual'});}
   planner.sunRentDisabled??={};if(billKind==='rent'&&sunConnection()?.snapshot)planner.sunRentDisabled[id]=!d.has('sunRent');
   if(billKind==='rent'&&d.has('sunRent')){
    const current=planner.manual.find(b=>b.id===id)||{...editingBill.base,id,name,amount,date,repeat,billKind};writeRentBill(current,'currentBalance',snapshot.manual.find(b=>b.id===id)?.amount??snapshot.estimates[id]?.amount??editingBill.base.amount);
   }else if(planner.sunRent?.billId===id)delete planner.sunRent;
   planner.billFunding[id]=model.householdEnabled(planner.household)?String(d.get('funding')||'personal'):(planner.billFunding[id]||'personal');
   planner.covered[id]=planner.billFunding[id]==='shared'?false:d.has('covered');
   if(billKind==='electric'&&d.has('gmailElectric')&&!planner.emailLinks['bill:'+id])planner.electricBillId=id;else if(planner.electricBillId===id)delete planner.electricBillId;
   await save();$('#billEditor').close();discoverMail('bill:'+id,name);$('#transactionStatus').textContent='Bill saved.';$('#accountStatus').textContent='Recurring bill saved.';
  }catch(e){planner=snapshot;$('#billEditorError').textContent=e.message;}finally{button.disabled=false;}
 };
 $('#stopTrackingBill').onclick=async()=>{
  if(!editingBill?.id)return;const snapshot=structuredClone(planner),id=editingBill.id;
  try{if(editingBill.manual)planner.manual=planner.manual.filter(b=>b.id!==id);else delete planner.bankRules[editingBill.key];delete planner.estimates[id];delete planner.covered[id];if(planner.sunRent?.billId===id)delete planner.sunRent;if(planner.loanLinks)delete planner.loanLinks[id];delete planner.transactionLinks['bill:'+id];delete planner.emailLinks['bill:'+id];if(planner.electricBillId===id)delete planner.electricBillId;await save();$('#billEditor').close();}catch(e){planner=snapshot;$('#billEditorError').textContent=e.message;}
 };

 document.addEventListener('click',e=>{const category=e.target.closest('[data-spending-category]');if(!category)return;spendingCategory=category.dataset.spendingCategory;$('#transactionFilter').value='spending';$('#transactionAccountFilter').value='';showTransactions(true);renderIncome();});
 document.addEventListener('input',e=>{const scope=e.target.dataset.forecastScrub,view=forecastViews[scope];if(!view)return;const index=Number(e.target.value),date=modelDay(view.start,index),balance=model.forecastBalanceOn(view.points,date);if(balance===null)return;const prefix=scope==='bills'?'billsForecast':'forecast';$('#'+prefix+'Point').textContent=dateLabel(date)+' · '+money(balance);const x=12+index/Math.max(1,view.length)*276;$('#'+prefix+'Cursor').setAttribute('x1',x);$('#'+prefix+'Cursor').setAttribute('x2',x);});
 $('#personalSpendingAccount').onchange=async e=>{const old=structuredClone(planner.household);planner.household.personalAccountId=e.target.value;try{await save();}catch(err){planner.household=old;error(err);}};
 document.addEventListener('click',e=>{if(e.target.closest('[data-forecast-accounts]'))$('#configureHousehold').click();});
 $('#transactionFilter').onchange=()=>{spendingCategory=null;if($('#transactionFilter').value==='spending')$('#transactionAccountFilter').value='';renderIncome();};
 $('#transactionAccountFilter').onchange=()=>{spendingCategory=null;if($('#transactionFilter').value==='spending')$('#transactionFilter').value='all';renderIncome();};
 $('#transactionSort').onchange=()=>renderIncome();
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
  try{if(b.dataset.billUnpaid){planner.paid=planner.paid.filter(k=>{const bill=existingRentBills().find(x=>x.id===b.dataset.billUnpaid.slice(0,-11));return k!==b.dataset.billUnpaid&&(!bill||rentModel.rentPaidKey(k,bill)!==b.dataset.billUnpaid);});await save();}if(b.dataset.billPaid){planner.paid.push(b.dataset.billPaid);await save();$('#accountStatus').textContent='Payment marked paid. Your bank balance changes on the next sync.';}if(b.dataset.billRemove&&confirm('Delete this bill and its future occurrences?')){planner.manual=planner.manual.filter(x=>x.id!==b.dataset.billRemove);delete planner.covered[b.dataset.billRemove];if(planner.sunRent?.billId===b.dataset.billRemove)delete planner.sunRent;await save();}}catch(e){error(e);}finally{b.disabled=false;}
 });
 document.addEventListener('change',async e=>{const b=e.target.closest('[data-bill-covered]');if(!b)return;try{planner.covered[b.dataset.billCovered]=b.checked;await save();}catch(e){error(e);}});

})();
