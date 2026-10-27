'use strict';
window.BearDen=(()=>{
 const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
 const keys=new Set(['app-state','notes','runnerHighScore','crushHighScore','questBestWave','catchSave','theme','holiday','linked-bills','income-planner','onboarding']);
 let config={},values={},revision=0,legacy=null,queue=Promise.resolve(),blocked=false,rentLoginUrl=null,requestQueue=Promise.resolve();
 const bridge={loaded:false,storage:{},ready:null};
 const accountHidden=id=>{try{return JSON.parse(values['income-planner']||'{}').hiddenConnectedAccounts?.[id]===true;}catch{return false;}};
 const accountName=a=>{try{return JSON.parse(values['income-planner']||'{}').accountNames?.[a.id]||a.name;}catch{return a.name;}};
 function plaidDiagnosticMarkup(item){
  const d=item.diagnostics;if(!d)return '';
  const line=(label,value)=>'<p><strong>'+label+'</strong> '+esc(value||'Not supplied')+'</p>';
  return '<div class="provider-diagnostics">'+line('Connection',d.errorCode||'No connection error reported')+line('Loan details',d.loanDetailsSupported?(item.liabilities?'Enabled in BearDen':'Available; use Enable / repair loan details'):'Plaid does not list Liabilities for this connection')+line('Consented products',d.consentedProducts?.join(', '))+line('Last bank transaction update',d.lastTransactionUpdate?new Date(d.lastTransactionUpdate).toLocaleString():null)+'<details><summary>Troubleshooting identifiers</summary><div>'+line('Item ID',d.itemId)+line('Institution ID',d.institutionId)+line('Diagnostic request',d.requestId)+line('Live balance request',item.balanceChecks?.live?.requestId)+line('Loan details request',item.liabilitiesRequestId)+'</div></details></div>';
 }
 const renameAccountButton=a=>'<button type="button" class="rename-account-button" data-rename-connected-account="'+esc(a.id)+'" aria-label="Rename '+esc(accountName(a))+'" title="Rename account"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>';
 const hideAccountButton=a=>'<span class="connection-account-actions">'+renameAccountButton(a)+'<button type="button" class="hide-account-button" data-hide-connected-account="'+esc(a.id)+'" aria-label="Hide '+esc(accountName(a))+'">Hide</button></span>';
 function hiddenAccountsMarkup(accounts){const hidden=accounts.filter(a=>accountHidden(a.id));return hidden.length?'<details class="hidden-connection-accounts"><summary>Hidden accounts ('+hidden.length+')</summary>'+hidden.map(a=>'<div class="connection-account-heading"><strong>'+esc(accountName(a))+'</strong><span class="connection-account-actions">'+renameAccountButton(a)+'<button type="button" data-show-connected-account="'+esc(a.id)+'" aria-label="Show '+esc(accountName(a))+'">Show</button></span></div>').join('')+'</details>':'';}
 bridge.refreshAccountLists=()=>renderConnections();
 function setConnectionConfig(id,open){const button=$('#'+id);$('#'+button.getAttribute('aria-controls')).hidden=!open;button.setAttribute('aria-expanded',String(open));}
 for(const id of ['configurePlaid','configureLunchflow','configureRent'])$('#'+id).onclick=()=>setConnectionConfig(id,$('#'+id).getAttribute('aria-expanded')!=='true');
 let syncNoticeDismissed=false,syncNoticeActive=false;
 const notice=$('#connectionMessage'),dismissNotice=$('#dismissConnectionMessage');
 const updateNotice=()=>{dismissNotice.hidden=!notice.textContent;};
 new MutationObserver(updateNotice).observe(notice,{childList:true,characterData:true,subtree:true});
 dismissNotice.onclick=()=>{if(syncNoticeActive)syncNoticeDismissed=true;notice.textContent='';updateNotice();};
 function message(t){notice.textContent=t;updateNotice();}
 function syncMessage(t){if(!syncNoticeDismissed)message(t);}
 async function request(path,body){let r;
  for(let attempt=0;;attempt++){
   r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(config.accountId?{'X-BearDen-Account':config.accountId}:{})},body:body===undefined?undefined:JSON.stringify(body)});let d;try{d=await r.json();}catch{throw Error('Could not read the server response.');}if(!r.ok){
    // A lock rejection happens before work starts, so retrying cannot replay it.
    const busy=d.code==='SYNC_BUSY'||d.error==='A sync or save is already running. Try again in a moment.';
    if(busy&&attempt<5){await new Promise(resolve=>setTimeout(resolve,Math.min(500*2**attempt,4000)));continue;}
    const error=Error(d.error||'Request failed');error.status=r.status;error.code=d.code;throw error;
   }return d;
  }
 }
 function api(path,body){
  if(body===undefined)return request(path);
  const operation=requestQueue.catch(()=>{}).then(()=>request(path,body));requestQueue=operation;return operation;
 }
 function persist(){
  const snapshot=structuredClone(values);
  const operation=queue.catch(()=>{}).then(async()=>{if(blocked)throw Error('Saving is blocked. Your account or saved data changed; reload before editing again.');if(config.authenticated){try{const d=await api('/api/classic',{state:{version:1,values:snapshot},revision});revision=d.revision;bridge.lastSaved=new Date().toISOString();window.dispatchEvent(new Event('bearden-saved'));}catch(e){if(e.status===409&&e.code!=='SYNC_BUSY'||e.status===401)blocked=true;throw e;}}else{for(const k of keys){if(snapshot[k]===undefined)localStorage.removeItem('bearden:classic:'+k);else localStorage.setItem('bearden:classic:'+k,snapshot[k]);}}});
  queue=operation;return operation;
 }
 bridge.storage.get=async key=>{await bridge.ready;if(blocked)throw Error('Tracker could not load safely. Reload to try again.');return values[key]===undefined?null:{key,value:values[key],shared:false};};
 bridge.storage.set=async(key,value)=>{await bridge.ready;if(!keys.has(key))return null;const previous=values[key],next=String(value);values[key]=next;try{await persist();return {key,value,shared:false};}catch(error){if(values[key]===next){if(previous===undefined)delete values[key];else values[key]=previous;}throw error;}};
 bridge.storage.setMany=async changes=>{
  await bridge.ready;
  const entries=Object.entries(changes);if(entries.some(([key])=>!keys.has(key)))throw Error('Invalid saved setting.');
  const previous=Object.fromEntries(entries.map(([key])=>[key,values[key]])),next=Object.fromEntries(entries.map(([key,value])=>[key,String(value)]));
  Object.assign(values,next);
  try{await persist();return true;}catch(error){for(const [key,value]of Object.entries(next))if(values[key]===value){if(previous[key]===undefined)delete values[key];else values[key]=previous[key];}throw error;}
 };
 bridge.storage.delete=async key=>{await bridge.ready;if(!keys.has(key)||values[key]===undefined)return {key,deleted:true};delete values[key];await persist();return {key,deleted:true};};
 bridge.resetSetup=async state=>{await bridge.ready;await queue;const previous=values;values={...values,'app-state':JSON.stringify(state),'income-planner':JSON.stringify({}),'linked-bills':JSON.stringify({}),onboarding:JSON.stringify({version:1,step:0,started:true,completed:false})};try{await persist();}catch(e){values=previous;throw e;}};
 function requireLogin(){if(config.authenticated)return true;message('Sign in with Google or Microsoft in Settings to connect an account.');window.selectBearTab?.('settings');return false;}
 async function reconcileAccountReferences(){
  if(!values['income-planner'])return;
  const {remapConnectedAccountReferences}=await import('./connection-model.mjs?v=lunchflow1');
  const before=values['income-planner'],planner=JSON.parse(before),next=remapConnectedAccountReferences(planner,legacy?.state?.accounts||[]);
  if(next!==planner){values['income-planner']=JSON.stringify(next);try{await persist();}catch(e){values['income-planner']=before;throw e;}}
 }
 async function refresh(){await queue;legacy=await api('/api/state');await reconcileAccountReferences();renderConnections();}
 function renderConnections(){
  $('#accountMode').textContent=config.authenticated?'You are signed in with '+(config.email||'your BearDen')+' account. Your budget, accounts, and income update to the cloud securely via your account.':'Not signed in. Tracker changes are saved on this device.';
  $('#classicLogin').hidden=!!config.authenticated||!config.googleConfigured;$('#classicMicrosoftLogin').hidden=!!config.authenticated||!config.microsoftConfigured;$('#microsoftSetupStatus').hidden=!!config.authenticated||!!config.microsoftConfigured;$('#classicGmail').disabled=!config.googleConfigured;$('#classicOutlook').disabled=!config.microsoftConfigured;$('#classicOutlook').title=config.microsoftConfigured?'':'Microsoft inbox connections are being set up.';$('#classicLogout').hidden=!config.authenticated;$('#classicSync').hidden=!config.authenticated;document.querySelectorAll('[data-refresh-bank],[data-refresh-debts]').forEach(b=>b.hidden=!config.authenticated);$('#privateConnections').hidden=!config.authenticated;$('#rentTrackingOption').hidden=!config.authenticated;
  bridge.config=config;bridge.plan=legacy;window.dispatchEvent(new Event('bearden-connections'));
  if(!config.authenticated)return;
  const c=legacy?.connections||{},s=legacy?.state;
  for(const [id,label,count]of [['plaidAccountSummary','Plaid accounts',(s?.accounts||[]).filter(a=>a.source==='plaid').length],['gmailAccountSummary','Email accounts',(c.mailAccounts||c.gmailAccounts||[]).length]])$('#'+id).textContent=label+' ('+count+')';
  $('#classicBank').hidden=false;$('#classicBank').disabled=!config.plaidConfigured;$('#classicBank').textContent=c.items?.length?'Add another bank':'Connect bank with Plaid';$('#disconnectPlaid').hidden=!c.items?.length;
  $('#classicBankStatus').textContent=c.items?.length?'Connected':'Not connected';$('#classicBankStatus').dataset.connected=String(!!c.items?.length);$('#refreshPlaid').hidden=!c.items?.length;
  const plaidAccounts=(s?.accounts||[]).filter(a=>a.source==='plaid');
  $('#plaidConnections').innerHTML=(c.items||[]).map(item=>{
   const accounts=plaidAccounts.filter(a=>a.itemId===item.id),count=(c.transactions||[]).filter(t=>t.itemId===item.id).length;
   const history=item.transactionsError?'Transactions need attention: '+item.transactionsError:item.transactionsPending?'Transaction history is loading.':item.transactionsLoading?'Plaid is preparing transaction history.':count+' saved transaction(s)'+(item.transactionsUpdated?' · Checked '+new Date(item.transactionsUpdated).toLocaleString():'');
   return '<div class="connection-row"><strong>'+esc(item.name)+'</strong><small>'+accounts.length+' account(s) · '+accounts.filter(a=>!a.balanceUnavailable).length+' with reported balances</small><small>'+esc(history)+'</small>'+(item.balanceError||item.balanceWarning?'<small>'+esc(item.balanceError||item.balanceWarning)+'</small>':'')+'<button type="button" data-bank-update="'+esc(item.id)+'">Choose / repair accounts</button><button type="button" data-bank-diagnose="'+esc(item.id)+'">Check balance connection</button>'+(accounts.some(a=>a.type==='loan')?'<button type="button" data-bank-loans="'+esc(item.id)+'">Enable / repair loan details</button>':'')+(item.liabilitiesStatus?'<small>'+esc(item.liabilitiesStatus)+'</small>':'')+plaidDiagnosticMarkup(item)+'</div>';
  }).join('');
  $('#plaidAccountSummary').textContent='Plaid accounts ('+plaidAccounts.filter(a=>!accountHidden(a.id)).length+' shown)';
  $('#classicBalances').innerHTML=plaidAccounts.filter(a=>!accountHidden(a.id)).map(a=>`<div class="connection-row"><div class="connection-account-heading"><strong>${esc(accountName(a))}</strong>${hideAccountButton(a)}</div>${a.zeroUnconfirmed?(a.balance>0?'Last known balance: '+money(a.balance):'Loan balance needs verification'):a.balanceUnavailable?(a.balanceUpdated?'Last known balance: '+money(a.balance):'Balance not supplied'):money(a.balance)}${a.balanceWarning?'<small>'+esc(a.balanceWarning)+'</small>':''}${a.accountMissing?'<small>Account missing from the latest response. Use Choose / repair accounts for this bank.</small>':a.balanceUnavailable?'<small>The latest response did not include a usable balance.</small>':a.balanceSource==='cached'?'<small>Using the bank’s cached balance.</small>':''}<small>${esc(a.currency||'USD')}${a.balanceRetrieved?' · Retrieved '+esc(new Date(a.balanceRetrieved).toLocaleString()):''}</small>${['loan','credit'].includes(a.type)&&a.balance===0?'<small>Plaid reports zero; verify with your bank. This is a balance, not a payment due.'+(a.lastPositiveBalance>0?' Last positive balance received: '+money(a.lastPositiveBalance)+'.':'')+'</small>':''}<details class="provider-diagnostics"><summary>Balance details</summary><div><p>Connection: ${esc(c.items?.find(i=>i.id===a.itemId)?.name||'Bank')}${c.items?.find(i=>i.id===a.itemId)?.balanceError?'<br>Last balance refresh failed: '+esc(c.items.find(i=>i.id===a.itemId).balanceError):''}<br>Account type: ${esc(a.type||'Not supplied')} / ${esc(a.subtype||'Not supplied')}<br>Live current balance: ${a.reportedLiveCurrent==null?'Not supplied':money(Math.round(a.reportedLiveCurrent*100))}<br>Cached current balance: ${a.reportedCachedCurrent==null?'Not supplied':money(Math.round(a.reportedCachedCurrent*100))}<br>Loan principal from Plaid Liabilities: ${a.liabilityPrincipal==null?'Not supplied':money(a.liabilityPrincipal)}<br>Loan details checked: ${a.liabilityUpdated?esc(new Date(a.liabilityUpdated).toLocaleString()):'Not yet checked'}<br>General account balance reported by Plaid: ${a.reportedCurrent===undefined?'No balance response saved for this account':a.reportedCurrent===null?'Not supplied':money(Math.round(a.reportedCurrent*100))}<br>Available balance reported by Plaid: ${a.reportedAvailable===undefined?'No balance response saved for this account':a.reportedAvailable===null?'Not supplied':money(Math.round(a.reportedAvailable*100))}</p></div></details></div>`).join('')+hiddenAccountsMarkup(plaidAccounts);
  renderLunchflow(c,s);renderRent(c.sun);
  $('#classicGmail').textContent='Add Gmail account';$('#classicDisconnectGmail').hidden=true;$('#checkGmailAccounts').hidden=!(c.emailConnected||c.gmail);
  $('#classicEmailStatus').textContent=(c.emailConnected||c.gmail)?'Connected':'Not connected';$('#classicEmailStatus').dataset.connected=String(!!(c.emailConnected||c.gmail));
  $('#gmailAccountList').innerHTML=(c.mailAccounts||c.gmailAccounts||[]).map(a=>'<div class="connection-row"><strong>'+esc(a.email||'Email account')+'</strong><small>'+esc(a.status||'Connected')+(a.updated?' · '+esc(new Date(a.updated).toLocaleString()):'')+'</small><button type="button" data-gmail-disconnect="'+esc(a.id)+'">Disconnect</button></div>').join('');
 }
 function renderRent(rent){
  const enabled=rent?.enabled??!!rent?.connected;$('#rentEnabledToggle').checked=enabled;$('#rentSection').hidden=!enabled;
  if(document.activeElement!==$('#rentPortalUrl'))$('#rentPortalUrl').value=rent?.pendingPortalUrl||rent?.portalUrl||'';
  $('#rentConnect').disabled=!config.rentConfigured;$('#rentConnect').textContent='Use private sign-in';
  $('#rentSaveCredentials').disabled=!config.rentConfigured;$('#rentAutoLoginStatus').hidden=!rent?.automaticLogin;$('#rentAutoLoginStatus').textContent=rent?.needsLogin?'Automatic sign-in needs attention.':'Automatic sign-in enabled.';$('#rentForgetCredentials').hidden=!rent?.automaticLogin;$('#rentCredentialsSummary').textContent=rent?.automaticLogin?'Replace saved credentials':'Enable automatic sign-in';
  $('#rentStatus').textContent=rent?.needsLogin?'Sign in needed':rent?.connected?'Connected':'Not connected';$('#rentStatus').dataset.connected=String(!!rent?.connected&&!rent?.needsLogin);
  $('#rentFeedback').textContent=!config.rentConfigured?'Rent sign-in is available on the hosted Cloudflare version of BearDen.':rent?.status||'Not connected.';
  $('#rentActions').hidden=!rent?.connected;$('#rentLogin').hidden=!rent?.pendingUntil;if(rent?.pendingUntil)setConnectionConfig('configureRent',true);
  $('#rentLoginLink').hidden=!rentLoginUrl||!rent?.pendingUntil;
  if(rentLoginUrl)$('#rentLoginLink').href=rentLoginUrl;else $('#rentLoginLink').removeAttribute('href');
  $('#rentExpiry').textContent=rent?.pendingUntil?'Window expires at '+new Date(rent.pendingUntil).toLocaleTimeString()+'.'+(!rentLoginUrl?' Use the private window you already opened, or start a new connection.':''):'';
  const r=rent?.snapshot;$('#rentSnapshot').innerHTML=r?'<div class="connection-row"><strong>Latest rent reading</strong><p>Rent balance owed: '+money(r.currentBalance)+'</p><p>Rent due on the 1st: '+esc(r.dueDate||'Not supplied')+'</p><small>Checked '+esc(new Date(r.checkedAt).toLocaleString())+(rent.needsLogin?' · Sign in again to update.':'')+'</small></div>':'';
 }
 async function rentAction(button,action){
  if(!requireLogin())return;button.disabled=true;$('#rentFeedback').textContent=action==='start'?'Opening a private rent sign-in window…':action==='complete'?'Reading your rent balance and saving the connection…':'Updating rent connection…';
  try{await queue;const result=await api('/api/rent/'+action,action==='start'?{portalUrl:$('#rentPortalUrl').value.trim()}:{});
   if(action==='start'){const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='live.browser.run')throw Error('The private sign-in address could not be verified.');rentLoginUrl=url.href;}
   if(['complete','cancel','disconnect'].includes(action))rentLoginUrl=null;
   await refresh();if(result.status)$('#rentFeedback').textContent=result.status;return true;
  }catch(error){$('#rentFeedback').textContent=error.message;return false;}finally{button.disabled=false;}
 }
 $('#rentLoginLink').onclick=async event=>{
  if(!window.matchMedia('(pointer: coarse)').matches&&!navigator.maxTouchPoints)return;
  event.preventDefault();if(!rentLoginUrl)return;
  try{const {openRentBrowser}=await import('./rent-browser.mjs?v=mobile-keyboard1');openRentBrowser({url:rentLoginUrl,expires:legacy?.connections?.sun?.pendingUntil,onSave:async()=>{if(!await rentAction($('#rentComplete'),'complete'))throw Error($('#rentFeedback').textContent);}});}catch(error){$('#rentFeedback').textContent=error.message;}
 };
 $('#rentPortalForm').onsubmit=e=>{e.preventDefault();rentAction($('#rentConnect'),'start');};
 $('#rentCredentialsForm').onsubmit=async event=>{
  event.preventDefault();if(!requireLogin())return;const button=$('#rentSaveCredentials'),credentials={portalUrl:$('#rentPortalUrl').value.trim(),username:$('#rentUsername').value.trim(),password:$('#rentPassword').value};
  if(!credentials.portalUrl){$('#rentFeedback').textContent='Enter your rent portal address first.';$('#rentPortalUrl').focus();return;}
  button.disabled=true;$('#rentPassword').value='';$('#rentFeedback').textContent='Signing in and checking rent…';
  try{await queue;const result=await api('/api/rent/credentials',credentials);$('#rentUsername').value='';rentLoginUrl=null;await refresh();$('#rentCredentialsSetup').open=false;$('#rentFeedback').textContent=result.status;}
  catch(error){$('#rentFeedback').textContent=error.message;}finally{credentials.password='';button.disabled=false;}
 };
 $('#rentForgetCredentials').onclick=async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{await queue;const result=await api('/api/rent/credentials/remove',{});$('#rentPassword').value='';$('#rentUsername').value='';await refresh();$('#rentFeedback').textContent=result.status;}
  catch(error){$('#rentFeedback').textContent=error.message;}finally{button.disabled=false;}
 };
 window.addEventListener('pagehide',()=>{$('#rentPassword').value='';});
 $('#rentEnabledToggle').onchange=async e=>{const button=e.currentTarget,enabled=button.checked;button.disabled=true;try{await queue;await api('/api/rent/settings',{enabled});await refresh();$('#featureSettingsStatus').textContent=enabled?'Rent enabled.':'Rent hidden; your saved connection is kept.';window.showBearToast?.('Preference saved');}catch(error){button.checked=!enabled;$('#featureSettingsStatus').textContent=error.message;}finally{button.disabled=false;}};
 $('#rentComplete').onclick=e=>rentAction(e.currentTarget,'complete');
 $('#rentCancel').onclick=e=>rentAction(e.currentTarget,'cancel');
 $('#rentRefresh').onclick=e=>rentAction(e.currentTarget,'refresh');
 $('#rentDisconnect').onclick=e=>{if(confirm('Remove saved rent credentials and the sign-in session, and stop rent checks? Your entered bills will stay.'))rentAction(e.currentTarget,'disconnect');};
 function lunchflowDiagnosticMarkup(a){
  const d=a.balanceObservation;if(!d)return '';
  return '<details class="provider-diagnostics"><summary>Balance details</summary><div><p>Amount supplied by Lunch Flow: '+(Number.isSafeInteger(d.amount)?esc(money(d.amount)):'Not supplied')+'</p><p>Retrieved: '+esc(new Date(d.retrievedAt).toLocaleString())+'</p><p>Bank balance date: not provided.</p>'+(a.transactionsWarning?'<p>'+esc(a.transactionsWarning)+'</p>':'')+'</div></details>';
 }
 function renderLunchflow(c,s){
  const connected=!!c.lunchflow,accounts=(s?.accounts||[]).filter(a=>a.source==='lunchflow');
  $('#lunchflowStatus').textContent=connected?'Connected':'Not connected';$('#lunchflowStatus').dataset.connected=String(connected);
  $('#lunchflowActions').hidden=!connected;$('#lunchflowSetup').hidden=connected;$('#lunchflowConnect').textContent=connected?'Replace Lunch Flow API key':'Connect Lunch Flow';
  $('#lunchflowFeedback').textContent=c.lunchflow?(c.lunchflow.status+(c.lunchflow.updated?' Last checked '+new Date(c.lunchflow.updated).toLocaleString()+'.':'')):'Not connected.';
  $('#lunchflowAccountSummary').textContent='Lunch Flow accounts ('+accounts.filter(a=>!accountHidden(a.id)).length+' shown)';
  $('#lunchflowAccounts').innerHTML=accounts.filter(a=>!accountHidden(a.id)).map(a=>{
   const kind=a.type==='depository'?a.subtype:a.type,debt=['credit','loan'].includes(a.type),raw=a.rawBalance,known=Number.isSafeInteger(raw);
   const types=[['unknown','Choose account type'],['credit','Credit card'],['loan','Loan'],['checking','Checking'],['savings','Savings']];
   return '<form class="connection-row" data-lunchflow-account="'+esc(a.id)+'"><div class="connection-account-heading"><strong>'+esc(accountName(a))+'</strong>'+hideAccountButton(a)+'</div><small>'+esc(a.institution)+' · Lunch Flow · '+(c.transactions||[]).filter(t=>t.account_id===a.id).length+' saved transaction(s)</small><p>'+(a.providerUnavailable?(a.balanceUpdated?'Last known balance: '+money(a.balance)+'. Latest balance unavailable.':'Balance not supplied.'):(a.balanceStale?'Last reported balance: ':'Reported balance: ')+(known?money(raw):'Not supplied')+' '+esc(a.currency))+(a.balanceUpdated?' · Retrieved '+esc(new Date(a.balanceUpdated).toLocaleString()):'')+'</p>'+(a.accountMissing?'<small>Not returned by Lunch Flow. Check which accounts are shared with BearDen.</small>':'')+(a.balanceWarning?'<small>'+esc(a.balanceWarning)+'</small>':'')+lunchflowDiagnosticMarkup(a)+'<label>Account type<select name="kind">'+types.map(([value,name])=>'<option value="'+value+'" '+(kind===value?'selected':'')+'>'+name+'</option>').join('')+'</select></label><label data-lunchflow-sign '+(debt?'':'hidden')+'>Confirm what the balance means<select name="debtSign"><option value="">Choose the amount you owe</option>'+[['negative',raw<0],['positive',raw>=0]].map(([value,isOwed])=>'<option value="'+value+'" '+(a.debtSign===value?'selected':'')+'>'+(known?(isOwed?money(Math.abs(raw))+' owed':money(Math.abs(raw))+' credit / no amount owed'):(value==='negative'?'Negative means amount owed':'Positive means amount owed'))+'</option>').join('')+'</select></label><button type="submit">Save account type</button><small data-lunchflow-account-status>'+(kind==='unknown'?'Choose a type before using this balance.':debt?'Then open Accounts, edit your debt, and choose this linked account.':'Available under Choose accounts.')+'</small></form>';
  }).join('')+hiddenAccountsMarkup(accounts);
 }
 $('#lunchflowAccounts').addEventListener('change',e=>{const form=e.target.closest('[data-lunchflow-account]');if(form&&e.target.name==='kind')form.querySelector('[data-lunchflow-sign]').hidden=!['credit','loan'].includes(e.target.value);});
 $('#lunchflowAccounts').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target.closest('[data-lunchflow-account]');if(!form)return;const b=form.querySelector('button[type=submit]'),status=form.querySelector('[data-lunchflow-account-status]');b.disabled=true;
  try{await queue;await api('/api/lunchflow/account',{id:form.dataset.lunchflowAccount,kind:form.elements.kind.value,debtSign:form.elements.debtSign.value});await refresh();window.showBearToast?.('Account type saved');$('#lunchflowFeedback').textContent='Account type saved. To update an existing debt, open Accounts, edit that debt, and select its linked account.';}catch(error){status.textContent=error.message;}finally{b.disabled=false;}
 });
 async function finishLunchflow(result,report){
  for(let batch=0;result.pending&&batch<50;batch++){report(result.status);result=await api('/api/lunchflow/refresh',{});}
  return result;
 }
 $('#lunchflowConnectForm').onsubmit=async event=>{
  event.preventDefault();if(!requireLogin())return;const b=$('#lunchflowConnect'),apiKey=$('#lunchflowToken').value.trim();if(!apiKey)return;
  const replace=!!legacy?.connections?.lunchflow;if(replace&&!confirm('Replace the Lunch Flow API key for this login?'))return;
  b.disabled=true;$('#lunchflowToken').value='';const report=text=>$('#lunchflowFeedback').textContent=text;report('Connecting Lunch Flow…');
  try{await queue;let r=await api('/api/lunchflow/connect',{apiKey,replace});r=await finishLunchflow(r,report);await refresh();$('#lunchflowSetup').open=false;report(r.status);}catch(e){report(e.message);}finally{b.disabled=false;}
 };
 $('#lunchflowReplace').onclick=()=>{$('#lunchflowSetup').hidden=false;$('#lunchflowSetup').open=true;$('#lunchflowToken').focus();};
 $('#lunchflowRefresh').onclick=async()=>{const b=$('#lunchflowRefresh'),report=text=>$('#lunchflowFeedback').textContent=text;b.disabled=true;report('Checking Lunch Flow…');try{await queue;const r=await finishLunchflow(await api('/api/lunchflow/refresh',{}),report);await refresh();report(r.status);}catch(e){report(e.message);}finally{b.disabled=false;}};
 $('#lunchflowDisconnect').onclick=async()=>{
  if(!confirm('Disconnect Lunch Flow from BearDen? Your entered debts and bills will stay.'))return;
  const b=$('#lunchflowDisconnect');b.disabled=true;try{await queue;const r=await api('/api/lunchflow/disconnect',{});await refresh();$('#lunchflowFeedback').textContent=r.status;}catch(e){$('#lunchflowFeedback').textContent=e.message;}finally{b.disabled=false;}
 };
 async function connectBank(resume=false,options={}){
  if(!requireLogin())return;if(!config.plaidConfigured)throw Error('Bank connections are unavailable right now.');
  if(resume){if(sessionStorage.getItem('bearden-link-account')!==config.accountId){sessionStorage.removeItem('bearden-link-token');sessionStorage.removeItem('bearden-link-context');sessionStorage.removeItem('bearden-link-account');throw Error('Your BearDen account changed. Start Connect bank again from this account.');}options=JSON.parse(sessionStorage.getItem('bearden-link-context')||'{}');}
  const token=resume?sessionStorage.getItem('bearden-link-token'):(await api('/api/plaid/link',options)).link_token;
  if(!token)throw Error('Bank sign-in expired. Please connect again.');
  sessionStorage.setItem('bearden-link-token',token);sessionStorage.setItem('bearden-link-context',JSON.stringify(options));sessionStorage.setItem('bearden-link-account',config.accountId);
  if(!window.Plaid)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.plaid.com/link/v2/stable/link-initialize.js';s.onload=resolve;s.onerror=()=>reject(Error('Could not load Plaid.'));document.head.append(s);});
  const handler=window.Plaid.create({token,...(resume?{receivedRedirectUri:location.href}:{}),onSuccess:async(public_token,metadata)=>{try{
   let r=options.itemId?await api('/api/plaid/updated',{itemId:options.itemId,kind:options.kind}):await api('/api/plaid/exchange',{public_token,name:metadata.institution?.name||'Bank',kind:options.kind});
   sessionStorage.removeItem('bearden-link-token');sessionStorage.removeItem('bearden-link-context');sessionStorage.removeItem('bearden-link-account');history.replaceState(null,'','/');await refresh();r=await finishBankHistory(r,message);await refresh();message(r.status||'Account connected.');
   if(options.kind==='loan')window.selectBearTab('settings');
   else if(options.kind==='credit'||options.itemId){window.selectBearTab('accounts');window.dispatchEvent(new CustomEvent('bearden-credit-connected',{detail:{options,status:r.status}}));}
  }catch(e){message(e.message);if(options.fromAccount)window.dispatchEvent(new CustomEvent('bearden-credit-cancelled',{detail:{options,error:e.message}}));else window.selectBearTab('settings');}finally{handler.destroy();}},onExit:error=>{handler.destroy();const detail=error?(error.display_message||error.error_message||'Plaid could not connect this account.'):'';if(options.fromAccount)window.dispatchEvent(new CustomEvent('bearden-credit-cancelled',{detail:{options,error:detail}}));else if(error){message(detail);window.selectBearTab('settings');}}});handler.open();
 }
 document.addEventListener('click',async e=>{
  const diagnose=e.target.closest('[data-bank-diagnose]');if(diagnose){diagnose.disabled=true;$('#plaidConfigStatus').textContent='Checking Plaid product access and connection status…';try{await queue;await api('/api/plaid/diagnose',{itemId:diagnose.dataset.bankDiagnose});await refresh();$('#plaidConfigStatus').textContent='Connection check complete. Results appear under this bank.';}catch(error){$('#plaidConfigStatus').textContent=error.message;}finally{diagnose.disabled=false;}return;}
  const loan=e.target.closest('[data-bank-loans]');if(loan){loan.disabled=true;try{await connectBank(false,{kind:'loan',itemId:loan.dataset.bankLoans});}catch(error){message(error.message);$('#plaidConfigStatus').textContent=error.message;}finally{loan.disabled=false;}return;}
  const repair=e.target.closest('[data-bank-update]');if(repair){repair.disabled=true;try{await connectBank(false,{kind:'bank',itemId:repair.dataset.bankUpdate});}catch(error){message(error.message);}finally{repair.disabled=false;}return;}
  const b=e.target.closest('[data-connect-credit],[data-credit-update],[data-refresh-credit]');if(!b)return;b.disabled=true;if(b.hasAttribute('data-refresh-credit'))b.setAttribute('aria-busy','true');
  const status=document.querySelector('#creditStatus'),options={kind:'credit',...(b.dataset.creditUpdate?{itemId:b.dataset.creditUpdate}:{}),...(b.hasAttribute('data-account-connect')?window.prepareDebtConnection():{})};try{
   if(b.hasAttribute('data-refresh-credit')){if(status)status.textContent='Refreshing card…';let r=await api('/api/cards/refresh',{itemId:b.dataset.refreshCredit});r=await finishBankHistory(r,text=>{if(status)status.textContent=text;});await refresh();if(status)status.textContent=r.status||'Card refreshed.';}
   else await connectBank(false,options);
  }catch(e){message(e.message);if(status)status.textContent=e.message;if(options.fromAccount)window.dispatchEvent(new CustomEvent('bearden-credit-cancelled',{detail:{options,error:e.message}}));else window.selectBearTab('settings');}finally{b.disabled=false;b.removeAttribute('aria-busy');}
 });

 function run(fn){return async e=>{const b=e?.currentTarget;if(b)b.disabled=true;try{await fn();}catch(err){message(err.message);}finally{if(b)b.disabled=false;}};}
 $('#classicLogout').onclick=run(async()=>{await window.performSaveAppState?.();await queue;await api('/api/logout',{});location.reload();});
 $('#disconnectPlaid').onclick=run(async()=>{
  if(!confirm('Disconnect Plaid and stop syncing its connected banks?'))return;
  await queue;const items=[...(legacy?.connections?.items||[])],errors=[];
  for(const item of items){try{await api('/api/plaid/disconnect',{id:item.id});}catch(error){errors.push(item.name+': '+error.message);}}
  await refresh();if(errors.length)throw Error(errors.join(' · '));message('Plaid disconnected.');
 });
 async function finishBankHistory(result,report){
  for(let batch=0;result.transactionsPending&&result.itemId&&batch<6;batch++){
   report('Loading remaining transaction history…');
   result=await api('/api/bank/refresh',{itemId:result.itemId,continueTransactions:true});
  }
  return result;
 }
 let refreshingBank=false;
 async function refreshEveryBank(report,{includeLunchflow=true,creditDetails=false}={}){
  if(refreshingBank)return null;refreshingBank=true;
  const buttons=[...document.querySelectorAll('[data-refresh-bank],[data-refresh-debts]'),$('#classicSync'),$('#refreshPlaid')],results=[];
  buttons.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');});
  try{
   await queue;await refresh();const items=[...(legacy?.connections?.items||[])];
   for(const [index,item] of items.entries()){
    report('Refreshing '+item.name+' ('+(index+1)+' of '+items.length+')…');
    try{await queue;let result=await api(creditDetails?'/api/cards/refresh':'/api/bank/refresh',{itemId:item.id});result=await finishBankHistory(result,report);results.push(item.name+': '+(result.status||'No refresh status returned.'));}catch(error){results.push(item.name+': Refresh failed — '+error.message);}
    await refresh();
   }

   if(includeLunchflow&&legacy?.connections?.lunchflow){report('Refreshing Lunch Flow…');try{const r=await finishLunchflow(await api('/api/lunchflow/refresh',{}),report);results.push(r.status);}catch(e){results.push('Lunch Flow: '+e.message);}await refresh();}
   return results.length?results:['No bank connections to refresh.'];
  }finally{refreshingBank=false;buttons.forEach(b=>{if(b.id==='classicSync'&&syncNoticeActive)return;b.disabled=false;b.removeAttribute('aria-busy');});}
 }
 $('#refreshAllDebts').onclick=async()=>{
  const button=$('#refreshAllDebts'),report=text=>$('#creditStatus').textContent=text;
  if(button.disabled)return;
  try{
   const results=await refreshEveryBank(report,{creditDetails:true});if(!results)return;
   button.disabled=true;button.setAttribute('aria-busy','true');
   if(legacy?.connections?.emailConnected||legacy?.connections?.gmail||legacy?.connections?.gmailAccounts?.length){report('Checking email…');try{await bridge.searchGmail('');results.push('Email checked.');}catch(error){results.push('Email: '+error.message);}}
   report(results.join(' · '));
  }catch(error){report(error.message);}finally{button.disabled=false;button.removeAttribute('aria-busy');}
 };
 $('#refreshPlaid').onclick=run(async()=>{const report=text=>$('#plaidConfigStatus').textContent=text;const results=await refreshEveryBank(report,{includeLunchflow:false});if(results)report(results.join(' · '));});
 $('#classicSync').onclick=run(async()=>{
  syncNoticeDismissed=false;syncNoticeActive=true;syncMessage('Syncing connections…');
  try{
  const results=await refreshEveryBank(syncMessage);if(!results)return;
  if(legacy?.connections?.emailConnected||legacy?.connections?.gmail){syncMessage('Checking email…');try{const result=await bridge.searchGmail('');results.push(...(result.mailAccounts||[]).map(a=>(a.email||'Email')+': '+a.status));}catch(error){results.push('Email: '+error.message);}await refresh();}
  if(legacy?.connections?.sun?.connected&&legacy.connections.sun.enabled!==false){syncMessage('Checking rent…');try{const result=await api('/api/rent/refresh',{});results.push(result.status||'Rent checked.');}catch(error){results.push('Rent: '+error.message);}await refresh();}
  syncMessage(results.join(' · '));
  }catch(error){syncMessage(error.message);}finally{syncNoticeActive=false;$('#classicSync').removeAttribute('aria-busy');}
 });
 document.querySelectorAll('[data-refresh-bank]').forEach(button=>button.onclick=async()=>{
  const statuses=document.querySelectorAll('.bank-refresh-status'),report=text=>statuses.forEach(s=>s.textContent=text);
  try{const results=await refreshEveryBank(report);if(results)report(results.join(' · '));}catch(error){report(error.message);}
 });
 $('#classicBank').onclick=run(()=>connectBank());$('#classicGmail').onclick=()=>{if(requireLogin())location.href='/auth/google?gmail=1&account='+encodeURIComponent(config.accountId);};
 $('#classicOutlook').onclick=()=>{if(requireLogin()&&config.microsoftConfigured)location.href='/auth/microsoft?mail=1&account='+encodeURIComponent(config.accountId);};
 bridge.billShare=async(action,body={})=>{await bridge.ready;await queue;if(!config.authenticated)throw Error('Sign in to BearDen to share or import bills.');return api('/api/bills/share/'+action,body);};
 bridge.readGmailMessage=async message=>{await queue;const result=await api('/api/gmail/message',{mailboxId:message.mailboxId,id:message.id});if(!result.message)throw Error('Could not read the selected email. Try again.');legacy.connections.gmailMessages=[...(legacy.connections.gmailMessages||[]).filter(m=>m.id!==result.message.id),result.message];return result.message;};
 bridge.searchGmail=async query=>{await queue;const accounts=legacy?.connections?.mailAccounts||legacy?.connections?.gmailAccounts||[];let result;const errors=[];for(const account of accounts.length?accounts:[null]){try{result=await api('/api/gmail/search',{query:String(query||'').slice(0,100),...(account?{mailboxId:account.id}:{})});Object.assign(legacy.connections,result);}catch(error){errors.push((account?.email||'Email')+': '+error.message);}}renderConnections();if(errors.length)throw Error(errors.join(' · '));return result;};
 $('#checkGmailAccounts').onclick=run(async()=>{$('#gmailFeedback').textContent='Checking email…';try{await bridge.searchGmail('');$('#gmailFeedback').textContent='Email checked.';}catch(error){$('#gmailFeedback').textContent=error.message;}});
 document.addEventListener('click',async e=>{const button=e.target.closest('[data-gmail-disconnect]');if(!button)return;const account=(legacy?.connections?.mailAccounts||legacy?.connections?.gmailAccounts)?.find(a=>a.id===button.dataset.gmailDisconnect);if(!account||!confirm('Disconnect '+account.email+' and stop watching its bill emails?'))return;button.disabled=true;try{await api('/api/gmail/disconnect',{id:account.id});await refresh();}catch(e){message(e.message);}finally{button.disabled=false;}});

 document.addEventListener('click',async e=>{const b=e.target.closest('[data-use-bill],[data-review-accept],[data-review-dismiss]');if(!b)return;b.disabled=true;try{
  if(b.dataset.reviewDismiss){await api('/api/candidate/dismiss',{id:b.dataset.reviewDismiss});await refresh();}
  if(b.dataset.reviewAccept){const id=b.dataset.reviewAccept,c=legacy.connections.candidates.find(c=>c.id===id),row=b.closest('.connection-review'),raw=row.querySelector('[data-review-amount]').value,amount=Math.round(Number(raw)*100),date=row.querySelector('[data-review-date]').value;if(raw===''||!Number.isSafeInteger(amount)||amount<0||!date)throw Error('Enter the bill amount and due date.');await refresh();const state=structuredClone(legacy.state);if(!state.bills.some(x=>x.sourceId===id))state.bills.push({id:crypto.randomUUID(),name:c.name||c.sender,amount,date,repeat:'once',source:'gmail',sourceId:id,sourceKey:c.sourceKey});await api('/api/state',{state,revision:legacy.revision});await refresh();}
  if(b.dataset.useBill){const bill=legacy.state.bills.find(x=>x.id===b.dataset.useBill),d=b.closest('.connection-row').querySelector('[data-bill-date]').value;const n=window.addConnectedBill(bill,d);const linked=JSON.parse(values['linked-bills']||'{}');linked[bill.id]=n;await bridge.storage.set('linked-bills',JSON.stringify(linked));await window.performSaveAppState();renderConnections();message('Bill added to paycheck '+n+'.');}
 }catch(err){message(err.message);}finally{b.disabled=false;}});
 bridge.ready=(async()=>{try{const response=await fetch('/api/config');if(response.status===404)config={};else{if(!response.ok)throw Error('Sign-in status could not be checked. Reload to try again.');config=await response.json();}if(config.authenticated){const [tracker,plan]=await Promise.all([api('/api/classic'),api('/api/state')]);values=tracker.state.values;revision=tracker.revision;legacy=plan;if(!values['app-state']&&(plan.state.debts.length||plan.state.income.length||plan.state.goals.length)){const {migrateLegacy}=await import('./classic-migrate.mjs?v=debt-timing1');values['app-state']=JSON.stringify(migrateLegacy(plan.state,new Date().toLocaleDateString('en-CA')));await persist();message('Your existing debt, income, budget, and savings were copied into the original tracker. Monthly amounts are converted to this tracker’s two-week schedule. Review dates and per-check edits before using the copied plan.');}}else for(const key of keys){const value=localStorage.getItem('bearden:classic:'+key);if(value!==null)values[key]=value;}await reconcileAccountReferences();bridge.isNew=!values['app-state']||!(()=>{try{const s=JSON.parse(values['app-state']);return s.cards?.length||s.budgetItems?.length||Number(s.takeHome)>0||s.startDate;}catch{return true;}})();renderConnections();}catch(e){blocked=true;message(e.message);window.selectBearTab('settings');}})();
 bridge.ready.then(()=>{if(new URLSearchParams(location.search).has('oauth_state_id'))connectBank(true).catch(e=>message(e.message));if(new URLSearchParams(location.search).has('connected')){history.replaceState(null,'','/');window.selectBearTab('settings');}});
 return bridge;
})();

