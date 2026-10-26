'use strict';
window.BearDen=(()=>{
 const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
 const keys=new Set(['app-state','notes','runnerHighScore','crushHighScore','questBestWave','catchSave','theme','holiday','linked-bills','income-planner','onboarding']);
 let config={},values={},revision=0,legacy=null,queue=Promise.resolve(),blocked=false,rentLoginUrl=null;
 const bridge={loaded:false,storage:{},ready:null};
 const accountHidden=id=>{try{return JSON.parse(values['income-planner']||'{}').hiddenConnectedAccounts?.[id]===true;}catch{return false;}};
 const accountName=a=>{try{return JSON.parse(values['income-planner']||'{}').accountNames?.[a.id]||a.name;}catch{return a.name;}};
 const renameAccountButton=a=>'<button type="button" class="rename-account-button" data-rename-connected-account="'+esc(a.id)+'" aria-label="Rename '+esc(accountName(a))+'" title="Rename account"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>';
 const hideAccountButton=a=>'<span class="connection-account-actions">'+renameAccountButton(a)+'<button type="button" class="hide-account-button" data-hide-connected-account="'+esc(a.id)+'" aria-label="Hide '+esc(accountName(a))+'">Hide</button></span>';
 function hiddenAccountsMarkup(accounts){const hidden=accounts.filter(a=>accountHidden(a.id));return hidden.length?'<details class="hidden-connection-accounts"><summary>Hidden accounts ('+hidden.length+')</summary>'+hidden.map(a=>'<div class="connection-account-heading"><strong>'+esc(accountName(a))+'</strong><span class="connection-account-actions">'+renameAccountButton(a)+'<button type="button" data-show-connected-account="'+esc(a.id)+'" aria-label="Show '+esc(accountName(a))+'">Show</button></span></div>').join('')+'</details>':'';}
 bridge.refreshAccountLists=()=>renderConnections();
 function setConnectionConfig(id,open){const button=$('#'+id);$('#'+button.getAttribute('aria-controls')).hidden=!open;button.setAttribute('aria-expanded',String(open));}
 for(const id of ['configurePlaid','configureSimplefin','configureRent'])$('#'+id).onclick=()=>setConnectionConfig(id,$('#'+id).getAttribute('aria-expanded')!=='true');
 let syncNoticeDismissed=false,syncNoticeActive=false;
 const notice=$('#connectionMessage'),dismissNotice=$('#dismissConnectionMessage');
 const updateNotice=()=>{dismissNotice.hidden=!notice.textContent;};
 new MutationObserver(updateNotice).observe(notice,{childList:true,characterData:true,subtree:true});
 dismissNotice.onclick=()=>{if(syncNoticeActive)syncNoticeDismissed=true;notice.textContent='';updateNotice();};
 function message(t){notice.textContent=t;updateNotice();}
 function syncMessage(t){if(!syncNoticeDismissed)message(t);}
 async function api(path,body){const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(config.accountId?{'X-BearDen-Account':config.accountId}:{})},body:body===undefined?undefined:JSON.stringify(body)});let d;try{d=await r.json();}catch{throw Error('Could not read the server response.');}if(!r.ok){const error=Error(d.error||'Request failed');error.status=r.status;throw error;}return d;}
 function persist(){
  const snapshot=structuredClone(values);
  const operation=queue.catch(()=>{}).then(async()=>{if(blocked)throw Error('Saving is blocked. Your account or saved data changed; reload before editing again.');if(config.authenticated){try{const d=await api('/api/classic',{state:{version:1,values:snapshot},revision});revision=d.revision;bridge.lastSaved=new Date().toISOString();window.dispatchEvent(new Event('bearden-saved'));}catch(e){if(e.status===409||e.status===401)blocked=true;throw e;}}else{for(const k of keys){if(snapshot[k]===undefined)localStorage.removeItem('bearden:classic:'+k);else localStorage.setItem('bearden:classic:'+k,snapshot[k]);}}});
  queue=operation;return operation;
 }
 bridge.storage.get=async key=>{await bridge.ready;if(blocked)throw Error('Tracker could not load safely. Reload to try again.');return values[key]===undefined?null:{key,value:values[key],shared:false};};
 bridge.storage.set=async(key,value)=>{await bridge.ready;if(!keys.has(key))return null;const previous=values[key],next=String(value);values[key]=next;try{await persist();return {key,value,shared:false};}catch(error){if(values[key]===next){if(previous===undefined)delete values[key];else values[key]=previous;}throw error;}};
 bridge.storage.delete=async key=>{await bridge.ready;if(!keys.has(key)||values[key]===undefined)return {key,deleted:true};delete values[key];await persist();return {key,deleted:true};};
 bridge.resetSetup=async state=>{await bridge.ready;await queue;const previous=values;values={...values,'app-state':JSON.stringify(state),'income-planner':JSON.stringify({}),'linked-bills':JSON.stringify({}),onboarding:JSON.stringify({version:1,step:0,started:true,completed:false})};try{await persist();}catch(e){values=previous;throw e;}};
 function requireLogin(){if(config.authenticated)return true;message('Sign in with Google or Microsoft in Settings to connect an account.');window.selectBearTab?.('settings');return false;}
 async function refresh(){legacy=await api('/api/state');renderConnections();}
 function renderConnections(){
  $('#accountMode').textContent=config.authenticated?'You are signed in with '+(config.email||'your BearDen')+' account. Your budget, accounts, and income update to the cloud securely via your account.':'Not signed in. Tracker changes are saved on this device.';
  $('#classicLogin').hidden=!!config.authenticated||!config.googleConfigured;$('#classicMicrosoftLogin').hidden=!!config.authenticated||!config.microsoftConfigured;$('#microsoftSetupStatus').hidden=!!config.authenticated||!!config.microsoftConfigured;$('#classicGmail').disabled=!config.googleConfigured;$('#classicOutlook').disabled=!config.microsoftConfigured;$('#classicOutlook').title=config.microsoftConfigured?'':'Microsoft inbox connections are being set up.';$('#classicLogout').hidden=!config.authenticated;$('#classicSync').hidden=!config.authenticated;document.querySelectorAll('[data-refresh-bank],[data-refresh-debts]').forEach(b=>b.hidden=!config.authenticated);$('#privateConnections').hidden=!config.authenticated;$('#rentTrackingOption').hidden=!config.authenticated;
  bridge.config=config;bridge.plan=legacy;window.dispatchEvent(new Event('bearden-connections'));
  if(!config.authenticated)return;
  const c=legacy?.connections||{},s=legacy?.state;
  for(const [id,label,count]of [['plaidAccountSummary','Plaid accounts',(s?.accounts||[]).filter(a=>a.source==='plaid').length],['simplefinAccountSummary','SimpleFIN accounts',(s?.accounts||[]).filter(a=>a.source==='simplefin').length],['gmailAccountSummary','Email accounts',(c.mailAccounts||c.gmailAccounts||[]).length]])$('#'+id).textContent=label+' ('+count+')';
  $('#classicBank').hidden=!!c.items?.length;$('#disconnectPlaid').hidden=!c.items?.length;
  $('#classicBankStatus').textContent=c.items?.length?'Connected':'Not connected';$('#classicBankStatus').dataset.connected=String(!!c.items?.length);$('#refreshPlaid').hidden=!c.items?.length;
  const plaidAccounts=(s?.accounts||[]).filter(a=>a.source==='plaid');
  $('#plaidAccountSummary').textContent='Plaid accounts ('+plaidAccounts.filter(a=>!accountHidden(a.id)).length+' shown)';
  $('#classicBalances').innerHTML=plaidAccounts.filter(a=>!accountHidden(a.id)).map(a=>`<div class="connection-row"><div class="connection-account-heading"><strong>${esc(accountName(a))}</strong>${hideAccountButton(a)}</div>${a.balanceUnavailable?'Balance not supplied':money(a.balance)}<small>${esc(a.currency||'USD')}${a.balanceRetrieved?' · Retrieved '+esc(new Date(a.balanceRetrieved).toLocaleString()):''}</small>${['loan','credit'].includes(a.type)&&a.balance===0?'<small>Plaid reports zero; verify with your bank. This is a balance, not a payment due.'+(a.lastPositiveBalance>0?' Last positive balance received: '+money(a.lastPositiveBalance)+'.':'')+'</small>':''}<details><summary>Balance details</summary><small>Connection: ${esc(c.items?.find(i=>i.id===a.itemId)?.name||'Bank')}${c.items?.find(i=>i.id===a.itemId)?.balanceError?'<br>Last balance refresh failed: '+esc(c.items.find(i=>i.id===a.itemId).balanceError):''}<br>Account type: ${esc(a.type||'Not supplied')} / ${esc(a.subtype||'Not supplied')}<br>Current balance reported by Plaid: ${a.reportedCurrent===undefined?'No balance response saved for this account':a.reportedCurrent===null?'Not supplied':money(Math.round(a.reportedCurrent*100))}<br>Available balance reported by Plaid: ${a.reportedAvailable===undefined?'No balance response saved for this account':a.reportedAvailable===null?'Not supplied':money(Math.round(a.reportedAvailable*100))}</small></details></div>`).join('')+hiddenAccountsMarkup(plaidAccounts);
  renderSimplefin(c,s);renderRent(c.sun);
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
 $('#rentEnabledToggle').onchange=async e=>{const button=e.currentTarget,enabled=button.checked;button.disabled=true;try{await queue;await api('/api/rent/settings',{enabled});await refresh();$('#featureSettingsStatus').textContent=enabled?'Rent enabled.':'Rent hidden; your saved connection is kept.';}catch(error){button.checked=!enabled;$('#featureSettingsStatus').textContent=error.message;}finally{button.disabled=false;}};
 $('#rentComplete').onclick=e=>rentAction(e.currentTarget,'complete');
 $('#rentCancel').onclick=e=>rentAction(e.currentTarget,'cancel');
 $('#rentRefresh').onclick=e=>rentAction(e.currentTarget,'refresh');
 $('#rentDisconnect').onclick=e=>{if(confirm('Remove saved rent credentials and the sign-in session, and stop rent checks? Your entered bills will stay.'))rentAction(e.currentTarget,'disconnect');};
 function renderSimplefin(c,s){
  const connected=!!c.simplefin,accounts=(s?.accounts||[]).filter(a=>a.source==='simplefin');
  $('#simplefinStatus').textContent=connected?'Connected':'Not connected';$('#simplefinStatus').dataset.connected=String(connected);
  $('#simplefinActions').hidden=!connected;$('#simplefinSetup').hidden=connected;$('#simplefinConnect').textContent=connected?'Replace SimpleFIN token':'Connect SimpleFIN';
  $('#simplefinFeedback').textContent=c.simplefin?(c.simplefin.status+(c.simplefin.updated?' Last checked '+new Date(c.simplefin.updated).toLocaleString()+'.':'')):'Not connected.';
  $('#simplefinAccountSummary').textContent='SimpleFIN accounts ('+accounts.filter(a=>!accountHidden(a.id)).length+' shown)';
  $('#simplefinAccounts').innerHTML=accounts.filter(a=>!accountHidden(a.id)).map(a=>{
   const kind=a.type==='depository'?a.subtype:a.type,debt=['credit','loan'].includes(a.type),raw=a.rawBalance,known=Number.isSafeInteger(raw);
   const types=[['unknown','Choose account type'],['credit','Credit card'],['loan','Loan'],['checking','Checking'],['savings','Savings']];
   return '<form class="connection-row" data-simplefin-account="'+esc(a.id)+'"><div class="connection-account-heading"><strong>'+esc(accountName(a))+'</strong>'+hideAccountButton(a)+'</div><small>'+esc(a.institution)+' · SimpleFIN</small><p>'+(a.providerUnavailable?'Balance unavailable; keeping the last known amount.':'Reported balance: '+(known?money(raw):'Not supplied')+' '+esc(a.currency))+(a.balanceUpdated?' · As of '+esc(new Date(a.balanceUpdated).toLocaleString()):'')+'</p><label>Account type<select name="kind">'+types.map(([value,name])=>'<option value="'+value+'" '+(kind===value?'selected':'')+'>'+name+'</option>').join('')+'</select></label><label data-simplefin-sign '+(debt?'':'hidden')+'>Confirm what the balance means<select name="debtSign"><option value="">Choose the amount you owe</option>'+[['negative',raw<0],['positive',raw>=0]].map(([value,isOwed])=>'<option value="'+value+'" '+(a.debtSign===value?'selected':'')+'>'+(known?(isOwed?money(Math.abs(raw))+' owed':money(Math.abs(raw))+' credit / no amount owed'):(value==='negative'?'Negative means amount owed':'Positive means amount owed'))+'</option>').join('')+'</select></label><button type="submit">Save account type</button><small data-simplefin-account-status>'+(kind==='unknown'?'Choose a type before using this balance.':debt?'Then open Accounts, edit your debt, and choose this linked account.':'Available under Choose accounts.')+'</small></form>';
  }).join('')+hiddenAccountsMarkup(accounts);
 }
 $('#simplefinConnectForm').onsubmit=async event=>{
  event.preventDefault();if(!requireLogin())return;const button=$('#simplefinConnect'),token=$('#simplefinToken').value.trim();if(!token)return;
  const replace=!!legacy?.connections?.simplefin;if(replace&&!confirm('Replace the saved SimpleFIN access token? Existing debt links will be kept.'))return;
  button.disabled=true;$('#simplefinToken').value='';$('#simplefinFeedback').textContent='Connecting SimpleFIN and loading balances…';
  try{await queue;const result=await api('/api/simplefin/connect',{token,replace});await refresh();$('#simplefinSetup').open=false;$('#simplefinFeedback').textContent=result.status;}
  catch(e){$('#simplefinFeedback').textContent=e.message+' If the token was consumed, create a new token in SimpleFIN.';}
  finally{button.disabled=false;}
 };
 $('#simplefinReplace').onclick=()=>{$('#simplefinSetup').hidden=false;$('#simplefinSetup').open=true;$('#simplefinToken').focus();};
 $('#simplefinRefresh').onclick=async()=>{const b=$('#simplefinRefresh');b.disabled=true;$('#simplefinFeedback').textContent='Checking SimpleFIN…';try{await queue;const r=await api('/api/simplefin/refresh',{});await refresh();$('#simplefinFeedback').textContent=r.status;}catch(e){$('#simplefinFeedback').textContent=e.message;}finally{b.disabled=false;}};
 $('#simplefinDisconnect').onclick=async()=>{
  if(!confirm('Disconnect SimpleFIN from BearDen? Your debts and entered payment details will stay. You can also revoke BearDen in SimpleFIN’s Apps section.'))return;
  const b=$('#simplefinDisconnect');b.disabled=true;try{await queue;const r=await api('/api/simplefin/disconnect',{});await refresh();$('#simplefinFeedback').textContent=r.status;}catch(e){$('#simplefinFeedback').textContent=e.message;}finally{b.disabled=false;}
 };
 $('#simplefinAccounts').addEventListener('change',e=>{const form=e.target.closest('[data-simplefin-account]');if(form&&e.target.name==='kind')form.querySelector('[data-simplefin-sign]').hidden=!['credit','loan'].includes(e.target.value);});
 $('#simplefinAccounts').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target.closest('[data-simplefin-account]');if(!form)return;const b=form.querySelector('button[type=submit]'),status=form.querySelector('[data-simplefin-account-status]');b.disabled=true;
  try{await queue;await api('/api/simplefin/account',{id:form.dataset.simplefinAccount,kind:form.elements.kind.value,debtSign:form.elements.debtSign.value});await refresh();$('#simplefinFeedback').textContent='Account type saved. To update an existing debt, open Accounts, edit that debt, and select its linked account.';}catch(error){status.textContent=error.message;}finally{b.disabled=false;}
 });
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

 function run(fn){return async e=>{const b=e?.currentTarget;if(b)b.disabled=true;try{await fn();}catch(err){message(err.message);}finally{if(b)b.disabled=false;}};}
 $('#classicLogout').onclick=run(async()=>{await window.performSaveAppState?.();await queue;await api('/api/logout',{});location.reload();});
 $('#disconnectPlaid').onclick=run(async()=>{
  if(!confirm('Disconnect Plaid and stop syncing its connected banks?'))return;
  await queue;const items=[...(legacy?.connections?.items||[])],errors=[];
  for(const item of items){try{await api('/api/plaid/disconnect',{id:item.id});}catch(error){errors.push(item.name+': '+error.message);}}
  await refresh();if(errors.length)throw Error(errors.join(' · '));message('Plaid disconnected.');
 });
 let refreshingBank=false;
 async function refreshEveryBank(report,{includeSimplefin=true,creditDetails=false}={}){
  if(refreshingBank)return null;refreshingBank=true;
  const buttons=[...document.querySelectorAll('[data-refresh-bank],[data-refresh-debts]'),$('#classicSync'),$('#refreshPlaid')],results=[];
  buttons.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');});
  try{
   await queue;await refresh();const items=[...(legacy?.connections?.items||[])];
   for(const [index,item] of items.entries()){
    report('Refreshing '+item.name+' ('+(index+1)+' of '+items.length+')…');
    try{await queue;const result=await api(creditDetails?'/api/cards/refresh':'/api/bank/refresh',{itemId:item.id});results.push(item.name+': '+(result.status||'No refresh status returned.'));}catch(error){results.push(item.name+': Refresh failed — '+error.message);}
    await refresh();
   }
   if(includeSimplefin&&legacy?.connections?.simplefin){report('Refreshing SimpleFIN…');try{const r=await api('/api/simplefin/refresh',{});results.push('SimpleFIN: '+r.status);}catch(e){results.push('SimpleFIN: '+e.message);}await refresh();}
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
 $('#refreshPlaid').onclick=run(async()=>{const report=text=>$('#plaidConfigStatus').textContent=text;const results=await refreshEveryBank(report,{includeSimplefin:false});if(results)report(results.join(' · '));});
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
 bridge.ready=(async()=>{try{const response=await fetch('/api/config');if(response.status===404)config={};else{if(!response.ok)throw Error('Sign-in status could not be checked. Reload to try again.');config=await response.json();}if(config.authenticated){const [tracker,plan]=await Promise.all([api('/api/classic'),api('/api/state')]);values=tracker.state.values;revision=tracker.revision;legacy=plan;if(!values['app-state']&&(plan.state.debts.length||plan.state.income.length||plan.state.goals.length)){const {migrateLegacy}=await import('./classic-migrate.mjs?v=debt-timing1');values['app-state']=JSON.stringify(migrateLegacy(plan.state,new Date().toLocaleDateString('en-CA')));await persist();message('Your existing debt, income, budget, and savings were copied into the original tracker. Monthly amounts are converted to this tracker’s two-week schedule. Review dates and per-check edits before using the copied plan.');}}else for(const key of keys){const value=localStorage.getItem('bearden:classic:'+key);if(value!==null)values[key]=value;}bridge.isNew=!values['app-state']||!(()=>{try{const s=JSON.parse(values['app-state']);return s.cards?.length||s.budgetItems?.length||Number(s.takeHome)>0||s.startDate;}catch{return true;}})();renderConnections();}catch(e){blocked=true;message(e.message);window.selectBearTab('settings');}})();
 bridge.ready.then(()=>{if(new URLSearchParams(location.search).has('oauth_state_id'))connectBank(true).catch(e=>message(e.message));if(new URLSearchParams(location.search).has('connected')){history.replaceState(null,'','/');window.selectBearTab('settings');}});
 return bridge;
})();
