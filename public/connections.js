'use strict';
window.BearDen=(()=>{
 const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
 const keys=new Set(['app-state','notes','runnerHighScore','crushHighScore','questBestWave','catchSave','theme','holiday','linked-bills','income-planner','onboarding']);
 let config={},values={},revision=0,legacy=null,queue=Promise.resolve(),blocked=false;
 const bridge={loaded:false,storage:{},ready:null};
 function message(t){$('#connectionMessage').textContent=t;}
 async function api(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(config.accountId?{'X-BearDen-Account':config.accountId}:{})},body:body===undefined?undefined:JSON.stringify(body)});let d;try{d=await r.json();}catch{throw Error('Could not read the server response.');}if(!r.ok){const error=Error(d.error||'Request failed');error.status=r.status;throw error;}return d;}
 function persist(){
  const snapshot=structuredClone(values);
  const operation=queue.catch(()=>{}).then(async()=>{if(blocked)throw Error('Saving is blocked. Your account or saved data changed; reload before editing again.');if(config.authenticated){try{const d=await api('/api/classic',{state:{version:1,values:snapshot},revision});revision=d.revision;bridge.lastSaved=new Date().toISOString();window.dispatchEvent(new Event('bearden-saved'));}catch(e){if(e.status===409||e.status===401)blocked=true;throw e;}}else{for(const k of keys){if(snapshot[k]===undefined)localStorage.removeItem('bearden:classic:'+k);else localStorage.setItem('bearden:classic:'+k,snapshot[k]);}}});
  queue=operation;return operation;
 }
 bridge.storage.get=async key=>{await bridge.ready;if(blocked)throw Error('Tracker could not load safely. Reload to try again.');return values[key]===undefined?null:{key,value:values[key],shared:false};};
 bridge.storage.set=async(key,value)=>{await bridge.ready;if(!keys.has(key))return null;values[key]=String(value);await persist();return {key,value,shared:false};};
 bridge.storage.delete=async key=>{await bridge.ready;if(!keys.has(key)||values[key]===undefined)return {key,deleted:true};delete values[key];await persist();return {key,deleted:true};};
 bridge.resetSetup=async state=>{await bridge.ready;await queue;const previous=values;values={...values,'app-state':JSON.stringify(state),'income-planner':JSON.stringify({}),'linked-bills':JSON.stringify({}),onboarding:JSON.stringify({version:1,step:0,started:true,completed:false})};try{await persist();}catch(e){values=previous;throw e;}};
 function requireLogin(){if(!config.googleConfigured){message('Sign-in is unavailable right now.');return false;}if(!config.authenticated){location.href='/auth/google';return false;}return true;}
 async function refresh(){legacy=await api('/api/state');renderConnections();}
 function renderConnections(){
  $('#accountMode').textContent=config.authenticated?'Signed in'+(config.email?' as '+config.email:'')+'. Your budget and connections are private to this login.':'Not signed in. Tracker changes are saved on this device.';
  $('#classicLogin').hidden=!!config.authenticated;$('#classicLogout').hidden=!config.authenticated;$('#classicSync').hidden=!config.authenticated;document.querySelectorAll('[data-refresh-bank]').forEach(b=>b.hidden=!config.authenticated);$('#privateConnections').hidden=!config.authenticated;
  bridge.config=config;bridge.plan=legacy;$('#cloudSaveStatus').textContent=config.authenticated?'Your current data saves automatically to your private BearDen account.':'Not signed in. Changes are saved only on this device.';window.dispatchEvent(new Event('bearden-connections'));
  if(!config.authenticated)return;
  const c=legacy?.connections||{},s=legacy?.state;
  $('#classicBank').textContent=c.items?.length?'Add another bank connection':'Connect bank with Plaid';
  $('#classicBankStatus').textContent=c.items?.length?`${c.items.length} bank connection(s). To sign in again, use Reconnect existing bank below. ${config.syncDescription||''}`:'Connect a bank to see its balances here.';
  $('#classicBalances').innerHTML=(s?.accounts||[]).filter(a=>a.source==='plaid').map(a=>`<div class="connection-row"><strong>${esc(a.name)}</strong>${a.balanceUnavailable?'Balance not supplied':money(a.balance)}<small>${esc(a.currency||'USD')}${a.balanceRetrieved?' · Retrieved '+esc(new Date(a.balanceRetrieved).toLocaleString()):''}</small>${['loan','credit'].includes(a.type)&&a.balance===0?'<small>Plaid reports zero; verify with your bank. This is a balance, not a payment due.'+(a.lastPositiveBalance>0?' Last positive balance received: '+money(a.lastPositiveBalance)+'.':'')+'</small>':''}<details><summary>Balance details</summary><small>Connection: ${esc(c.items?.find(i=>i.id===a.itemId)?.name||'Bank')}${c.items?.find(i=>i.id===a.itemId)?.balanceError?'<br>Last balance refresh failed: '+esc(c.items.find(i=>i.id===a.itemId).balanceError):''}<br>Account type: ${esc(a.type||'Not supplied')} / ${esc(a.subtype||'Not supplied')}<br>Current balance reported by Plaid: ${a.reportedCurrent===undefined?'No balance response saved for this account':a.reportedCurrent===null?'Not supplied':money(Math.round(a.reportedCurrent*100))}<br>Available balance reported by Plaid: ${a.reportedAvailable===undefined?'No balance response saved for this account':a.reportedAvailable===null?'Not supplied':money(Math.round(a.reportedAvailable*100))}</small></details></div>`).join('');
  $('#classicBanks').innerHTML=(c.items||[]).map((i,index)=>`<div class="connection-row"><strong>${esc(i.name)}</strong><button data-bank-reconnect="${esc(i.id)}">Reconnect existing bank</button><button data-credit-update="${esc(i.id)}">${i.liabilities?'Manage extra card permissions':'Request due dates & minimums'}</button><small>Balances already sync. Extra card details may require additional Plaid permission; linking an existing account in Accounts does not.</small><button data-bank-disconnect="${esc(i.id)}">Disconnect</button>${i.balanceError?'<small role="status">Balance refresh failed: '+esc(i.balanceError)+'</small>':i.balanceWarning?'<small role="status">'+esc(i.balanceWarning)+'</small>':''}${i.liabilitiesStatus?'<small>'+esc(i.liabilitiesStatus)+'</small>':''}${c.items.slice(0,index).find(other=>other.name===i.name)?'<button data-bank-combine="'+esc(i.id)+'" data-bank-keep="'+esc(c.items.slice(0,index).find(other=>other.name===i.name).id)+'">Combine duplicate '+esc(i.name)+' connections</button>':''}</div>`).join('');
  $('#classicGmail').textContent='Add Gmail account';$('#classicDisconnectGmail').hidden=true;$('#checkGmailAccounts').hidden=!c.gmail;
  $('#classicEmailStatus').textContent=c.gmail?'Connected. Bills and payment notices update in the background.':'Connect Gmail to find bills and payment notices.';
  $('#gmailAccountList').innerHTML=(c.gmailAccounts||[]).map(a=>'<div class="connection-row"><strong>'+esc(a.email||'Gmail account')+'</strong><small>'+esc(a.status||'Connected')+(a.updated?' · '+esc(new Date(a.updated).toLocaleString()):'')+'</small><button type="button" data-gmail-disconnect="'+esc(a.id)+'">Disconnect</button></div>').join('');
 }
 async function connectBank(resume=false,options={}){
  if(!requireLogin())return;if(!config.plaidConfigured)throw Error('Bank connections are unavailable right now.');
  if(resume){if(sessionStorage.getItem('bearden-link-account')!==config.accountId){sessionStorage.removeItem('bearden-link-token');sessionStorage.removeItem('bearden-link-context');sessionStorage.removeItem('bearden-link-account');throw Error('Your BearDen account changed. Start Connect bank again from this account.');}options=JSON.parse(sessionStorage.getItem('bearden-link-context')||'{}');}
  const token=resume?sessionStorage.getItem('bearden-link-token'):(await api('/api/plaid/link',options)).link_token;
  if(!token)throw Error('Bank sign-in expired. Please connect again.');
  sessionStorage.setItem('bearden-link-token',token);sessionStorage.setItem('bearden-link-context',JSON.stringify(options));sessionStorage.setItem('bearden-link-account',config.accountId);
  if(!window.Plaid)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';s.onload=resolve;s.onerror=()=>reject(Error('Could not load Plaid.'));document.head.append(s);});
  const handler=window.Plaid.create({token,...(resume?{receivedRedirectUri:location.href}:{}),onSuccess:async(public_token,metadata)=>{try{
   const r=options.itemId?await api('/api/plaid/updated',{itemId:options.itemId,kind:options.kind}):await api('/api/plaid/exchange',{public_token,name:metadata.institution?.name||'Bank',kind:options.kind});
   sessionStorage.removeItem('bearden-link-token');sessionStorage.removeItem('bearden-link-context');sessionStorage.removeItem('bearden-link-account');history.replaceState(null,'','/');await refresh();message(r.status||'Account connected.');
   if(options.kind==='credit'||options.itemId){window.selectBearTab('accounts');window.dispatchEvent(new CustomEvent('bearden-credit-connected',{detail:{options,status:r.status}}));}
  }catch(e){message(e.message);if(options.fromAccount)window.dispatchEvent(new CustomEvent('bearden-credit-cancelled',{detail:{options,error:e.message}}));else window.selectBearTab('settings');}finally{handler.destroy();}},onExit:error=>{handler.destroy();const detail=error?(error.display_message||error.error_message||'Plaid could not connect this account.'):'';if(options.fromAccount)window.dispatchEvent(new CustomEvent('bearden-credit-cancelled',{detail:{options,error:detail}}));else if(error){message(detail);window.selectBearTab('settings');}}});handler.open();
 }
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-connect-credit],[data-credit-update],[data-refresh-credit]');if(!b)return;b.disabled=true;if(b.hasAttribute('data-refresh-credit'))b.setAttribute('aria-busy','true');
  const status=document.querySelector('#creditStatus'),options={kind:'credit',...(b.dataset.creditUpdate?{itemId:b.dataset.creditUpdate}:{}),...(b.hasAttribute('data-account-connect')?window.prepareDebtConnection():{})};try{
   if(b.hasAttribute('data-refresh-credit')){if(status)status.textContent='Refreshing card…';const r=await api('/api/cards/refresh',{itemId:b.dataset.refreshCredit});await refresh();if(status)status.textContent=r.status||'Card refreshed.';}
   else await connectBank(false,options);
  }catch(e){message(e.message);if(status)status.textContent=e.message;if(options.fromAccount)window.dispatchEvent(new CustomEvent('bearden-credit-cancelled',{detail:{options,error:e.message}}));else window.selectBearTab('settings');}finally{b.disabled=false;b.removeAttribute('aria-busy');}
 });

 document.addEventListener('click',async e=>{
  const reconnect=e.target.closest('[data-bank-reconnect]');if(reconnect){reconnect.disabled=true;try{await connectBank(false,{kind:'bank',itemId:reconnect.dataset.bankReconnect});}catch(error){message(error.message);}finally{reconnect.disabled=false;}return;}
  const combine=e.target.closest('[data-bank-combine]');if(!combine)return;
  if(!confirm('Combine these only if they are duplicate connections to the SAME bank login, not separate logins for you and your spouse. Matching account names and types will be checked. Bill and debt links will move to the other connection; the duplicate data is kept privately for recovery. Continue?'))return;
  combine.disabled=true;try{await window.flushBearDenState?.();await queue;await api('/api/plaid/combine',{removeId:combine.dataset.bankCombine,keepId:combine.dataset.bankKeep,revision});location.reload();}catch(error){message(error.message);combine.disabled=false;}
 });
 function run(fn){return async e=>{const b=e?.currentTarget;if(b)b.disabled=true;try{await fn();}catch(err){message(err.message);}finally{if(b)b.disabled=false;}};}
 $('#classicLogout').onclick=run(async()=>{await window.performSaveAppState?.();await queue;await api('/api/logout',{});location.reload();});
 let refreshingBank=false;
 async function refreshEveryBank(report){
  if(refreshingBank)return null;refreshingBank=true;
  const buttons=[...document.querySelectorAll('[data-refresh-bank]'),$('#classicSync')],results=[];
  buttons.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');});
  try{
   await queue;await refresh();const items=[...(legacy?.connections?.items||[])];
   for(const [index,item] of items.entries()){
    report('Refreshing '+item.name+' ('+(index+1)+' of '+items.length+')…');
    try{await queue;const result=await api('/api/bank/refresh',{itemId:item.id});results.push(item.name+': '+(result.status||'No refresh status returned.'));}catch(error){results.push(item.name+': Refresh failed — '+error.message);}
    await refresh();
   }
   return results.length?results:['No bank connections to refresh.'];
  }finally{refreshingBank=false;buttons.forEach(b=>{b.disabled=false;b.removeAttribute('aria-busy');});}
 }
 $('#classicSync').onclick=run(async()=>{
  const results=await refreshEveryBank(message);if(!results)return;
  if(legacy?.connections?.gmail){message('Checking Gmail…');try{const result=await api('/api/sync',{gmailOnly:true});results.push(result.status||'Gmail checked.');}catch(error){results.push('Gmail: '+error.message);}await refresh();}
  message(results.join(' · '));
 });
 document.querySelectorAll('[data-refresh-bank]').forEach(button=>button.onclick=async()=>{
  const statuses=document.querySelectorAll('.bank-refresh-status'),report=text=>statuses.forEach(s=>s.textContent=text);
  try{const results=await refreshEveryBank(report);if(results)report(results.join(' · '));}catch(error){report(error.message);}
 });
 $('#classicBank').onclick=run(()=>connectBank());$('#classicGmail').onclick=()=>{if(requireLogin())location.href='/auth/google?gmail=1&account='+encodeURIComponent(config.accountId);};
 bridge.readGmailMessage=async message=>{await queue;const result=await api('/api/gmail/message',{mailboxId:message.mailboxId,id:message.id});if(!result.message)throw Error('Could not read the selected email. Try again.');legacy.connections.gmailMessages=[...(legacy.connections.gmailMessages||[]).filter(m=>m.id!==result.message.id),result.message];return result.message;};
 bridge.searchGmail=async query=>{await queue;const result=await api('/api/gmail/search',{query:String(query||'').slice(0,100)});Object.assign(legacy.connections,result);renderConnections();return result;};
 $('#checkGmailAccounts').onclick=run(async()=>{$('#classicEmailStatus').textContent='Checking Gmail…';await bridge.searchGmail('');});
 document.addEventListener('click',async e=>{const button=e.target.closest('[data-gmail-disconnect]');if(!button)return;const account=legacy?.connections?.gmailAccounts?.find(a=>a.id===button.dataset.gmailDisconnect);if(!account||!confirm('Disconnect '+account.email+' and stop watching its bill emails?'))return;button.disabled=true;try{await api('/api/gmail/disconnect',{id:account.id});await refresh();}catch(e){message(e.message);}finally{button.disabled=false;}});

 $('#classicImport').onchange=run(async()=>{const file=$('#classicImport').files[0];if(!file)return;if(file.size>230000)throw Error('Backup is too large.');let data=JSON.parse(await file.text());if(data.cards&&data.budgetItems)data={version:1,values:{'app-state':JSON.stringify(data)}};if(data.version!==1||!data.values||!data.values['app-state'])throw Error('Choose a tracker backup.');for(const[k,v]of Object.entries(data.values))if(!keys.has(k)||typeof v!=='string')throw Error('Invalid backup.');const app=JSON.parse(data.values['app-state']);if(!Array.isArray(app.cards)||!Array.isArray(app.budgetItems)||!Array.isArray(app.savingsGoals))throw Error('Invalid tracker data.');if(!confirm('Replace your tracker with this backup?'))return;window.prepareClassicImport();await queue;values=data.values;await persist();location.reload();});
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-bank-disconnect],[data-use-bill],[data-review-accept],[data-review-dismiss]');if(!b)return;b.disabled=true;try{
  if(b.dataset.bankDisconnect&&confirm('Disconnect this bank?')){await api('/api/plaid/disconnect',{id:b.dataset.bankDisconnect});await refresh();}
  if(b.dataset.reviewDismiss){await api('/api/candidate/dismiss',{id:b.dataset.reviewDismiss});await refresh();}
  if(b.dataset.reviewAccept){const id=b.dataset.reviewAccept,c=legacy.connections.candidates.find(c=>c.id===id),row=b.closest('.connection-review'),raw=row.querySelector('[data-review-amount]').value,amount=Math.round(Number(raw)*100),date=row.querySelector('[data-review-date]').value;if(raw===''||!Number.isSafeInteger(amount)||amount<0||!date)throw Error('Enter the bill amount and due date.');await refresh();const state=structuredClone(legacy.state);if(!state.bills.some(x=>x.sourceId===id))state.bills.push({id:crypto.randomUUID(),name:c.name||c.sender,amount,date,repeat:'once',source:'gmail',sourceId:id,sourceKey:c.sourceKey});await api('/api/state',{state,revision:legacy.revision});await refresh();}
  if(b.dataset.useBill){const bill=legacy.state.bills.find(x=>x.id===b.dataset.useBill),d=b.closest('.connection-row').querySelector('[data-bill-date]').value;const n=window.addConnectedBill(bill,d);const linked=JSON.parse(values['linked-bills']||'{}');linked[bill.id]=n;await bridge.storage.set('linked-bills',JSON.stringify(linked));await window.performSaveAppState();renderConnections();message('Bill added to paycheck '+n+'.');}
 }catch(err){message(err.message);}finally{b.disabled=false;}});
 bridge.ready=(async()=>{try{const response=await fetch('/api/config');if(response.status===404)config={};else{if(!response.ok)throw Error('Sign-in status could not be checked. Reload to try again.');config=await response.json();}if(config.authenticated){const [tracker,plan]=await Promise.all([api('/api/classic'),api('/api/state')]);values=tracker.state.values;revision=tracker.revision;legacy=plan;if(!values['app-state']&&(plan.state.debts.length||plan.state.income.length||plan.state.goals.length)){const {migrateLegacy}=await import('./classic-migrate.mjs');values['app-state']=JSON.stringify(migrateLegacy(plan.state,new Date().toLocaleDateString('en-CA')));await persist();message('Your existing debt, income, budget, and savings were copied into the original tracker. Monthly amounts are converted to this tracker’s two-week schedule. Review dates and per-check edits before using the copied plan.');}}else for(const key of keys){const value=localStorage.getItem('bearden:classic:'+key);if(value!==null)values[key]=value;}bridge.isNew=!values['app-state']||!(()=>{try{const s=JSON.parse(values['app-state']);return s.cards?.length||s.budgetItems?.length||Number(s.takeHome)>0||s.startDate;}catch{return true;}})();renderConnections();}catch(e){blocked=true;message(e.message);window.selectBearTab('settings');}})();
 bridge.ready.then(()=>{if(new URLSearchParams(location.search).has('oauth_state_id'))connectBank(true).catch(e=>message(e.message));if(new URLSearchParams(location.search).has('connected')){history.replaceState(null,'','/');window.selectBearTab('settings');}});
 return bridge;
})();
