import {rentPortalUrl,sameRentHost,parseRentPage} from './rent-portal.mjs';
import {nextRentDate,rememberRentReadings} from './public/rent-model.mjs';
// Rent portal reader, with the existing provider adapter retained for saved connections. No payment requests are made.
// Session and pending-browser records must be encrypted by the caller and never returned in public state.
const PORTAL='https://app.sunwebportal.com',DAY=86400000,LOGIN_MS=5*60000;
const domains=['app.sunwebportal.com','*.app.sunwebportal.com','accounts.google.com','*.gstatic.com','*.googleapis.com','www.google.com','www.facebook.com','*.facebook.net'];
export class SunError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new SunError(code);};
export function sunMessage(error){return ({unavailable:'Rent sign-in is unavailable on this server. Cloudflare Browser Run must be enabled.',expired:'The sign-in window expired. Start a new rent connection.',portal:'Enter a public HTTPS rent portal address, without a password or sign-in token in the URL.',login:'Finish signing in to your rent portal and open the balance or Payments page, then select Save connection here.',credentials:'The portal could not sign in with those details. Check your email and password, or use private sign-in if your account needs verification.',verification:'Your rent portal needs verification or another sign-in step. Use private sign-in to finish. Automatic sign-in is paused until you reconnect or retry.',unsupported:'Automatic email-and-password sign-in is not supported for this portal yet. Use private sign-in instead.',rate:'Wait 20 seconds before another rent sign-in attempt.',unreadable:'The portal did not provide one clear, readable balance. Open the page showing your current balance and try again. Your saved amount is unchanged.',property:'The portal opened a different property. Reconnect and select the correct property.',quota:'The rent browser limit has been reached. Try again tomorrow.',browser:'The private rent browser could not connect. Try again in a moment.'})[error?.code]||'The rent portal could not be checked. Your last saved amounts are unchanged. Try again later.';}
export function rentAutoLoginSupported(value){try{return new URL(rentPortalUrl(value)).origin===PORTAL;}catch{return false;}}
export function rentCredentials(value){
 if(!rentAutoLoginSupported(value?.portalUrl))fail('unsupported');
 const username=typeof value.username==='string'?value.username.trim():'',password=value.password;
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)||username.length>254||typeof password!=='string'||!password.length||password.length>1024)fail('credentials');
 return {portalUrl:PORTAL,username,password};
}

// These scripts only return state, never passwords or page text. They are
// restricted to the verified provider's login form, not arbitrary portal forms.
export const rentLoginStateScript=`(()=>{
 if(location.href==='about:blank')return 'loading';
 if(location.origin!==${JSON.stringify(PORTAL)})return 'verification';
 if(location.pathname.startsWith('/portal/')){try{if(JSON.parse(sessionStorage.getItem('session')||'{}').userAccount?.security?.token)return 'signed-in';}catch{}return 'loading';}
 if(location.pathname!=='/auth/login')return document.readyState==='loading'?'loading':'verification';
 const visible=e=>e&&!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
 if([...document.querySelectorAll('iframe[src*="recaptcha"][title*="challenge"],input[autocomplete="one-time-code"],input[name="confirmCode"]')].some(visible))return 'verification';
 if([...document.querySelectorAll('app-login sun-page-notification')].some(e=>visible(e)&&e.textContent.trim()))return 'credentials';
 const user=document.querySelector('app-login input#username'),password=document.querySelector('app-login input#password');
 return visible(user)&&visible(password)&&user.form&&user.form===password.form?'ready':'loading';
})()`;
export function rentLoginFillScript(credentials){
 const {username,password}=rentCredentials(credentials);
 return `(()=>{if(location.origin!==${JSON.stringify(PORTAL)}||location.pathname!=='/auth/login')return false;const user=document.querySelector('app-login input#username'),password=document.querySelector('app-login input#password');if(!user||!password||!user.form||user.form!==password.form||password.type!=='password'||user.disabled||password.disabled)return false;const entries=[[user,${JSON.stringify(username)}],[password,${JSON.stringify(password)}]];for(const [field,value]of entries){if(field.maxLength>0&&value.length>field.maxLength)return false;}const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [field,value]of entries){setter.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()`;
}
export const rentLoginSubmitScript=`(()=>{if(location.origin!==${JSON.stringify(PORTAL)}||location.pathname!=='/auth/login')return false;const user=document.querySelector('app-login input#username'),password=document.querySelector('app-login input#password'),form=user?.form;if(!form||password?.form!==form||password.type!=='password'||!user.value||!password.value||!form.checkValidity())return false;form.requestSubmit();return true;})()`;
function money(value){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e8)fail('unreadable');return Math.round(value*100);}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))return null;const day=value.slice(0,10);return !Number.isNaN(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day?day:null;}
export function parseSunBalance(data,currency,now=Date.now()){
 if(!data||typeof data!=='object')fail('unreadable');
 const code=data.currencyCode||currency;if(code!=='USD')fail('unreadable');
 const amountDue=money(data.totalDue),currentBalance=money(data.balance),dueDate=date(data.dueDate);
 return {amountDue,currentBalance,dueDate,currency:'USD',checkedAt:now};
}
export function publicSun(connection,now=Date.now()){
 if(!connection)return null;
 return {enabled:connection.enabled??!!(connection.connected||connection.snapshot||connection.portalUrl||connection.pending),portalUrl:connection.portalUrl||(connection.connected||connection.snapshot||connection.pending&&!connection.pending.portalUrl?PORTAL:''),pendingPortalUrl:connection.pending?.portalUrl||null,connected:!!connection.connected,automaticLogin:!!connection.automaticLogin,status:(connection.status||'Not connected.').replace(/\bSun\b/g,'Rent portal'),needsLogin:!!connection.needsLogin,updated:connection.updated||null,nextSync:connection.nextSync||null,pendingUntil:connection.pending?.expires>now?connection.pending.expires:null,rentReadings:(connection.rentReadings||[]).map(r=>({date:r.date,currentBalance:r.currentBalance,amountDue:r.amountDue,checkedAt:r.checkedAt})),snapshot:connection.snapshot?{amountDue:connection.snapshot.amountDue,currentBalance:connection.snapshot.currentBalance,dueDate:nextRentDate(connection.snapshot.checkedAt),currency:connection.snapshot.currency,checkedAt:connection.snapshot.checkedAt}:null};
}
function balanceRequest(url){try{const u=new URL(url);return u.origin==='https://portal-api.app.sunwebportal.com'&&/^\/Payment\/GetCurrentBalanceBySelf\/[^/]+$/.test(u.pathname)?decodeURIComponent(u.pathname.split('/').at(-1)):null;}catch{return null;}}
export function createSunBrowser(binding){
 function available(){if(!binding?.acquire||!binding?.connectSession||!binding?.getLiveView)fail('unavailable');}
 async function close(id){if(id)await binding?.closeSession(id);}
 async function acquire(interactive,portal=PORTAL){available();const host=new URL(portal).hostname,legacy=host===new URL(PORTAL).hostname;return binding.acquire({keepAlive:interactive?LOGIN_MS:60000,recording:false,guardrails:legacy?{allowedDomains:domains}:{allowedDomains:[host,'*.'+host,'accounts.google.com','*.googleapis.com','*.gstatic.com','login.microsoftonline.com','*.microsoftonline.com'],allowedDomainSets:['common-cdns']}});}
 async function channel(sessionId,targetId){
  const connection=await binding.connectSession(sessionId,{targetId});
  const response=await connection.webSocket.fetch('https://browser-binding.invalid',{headers:{Upgrade:'websocket'}}),socket=response.webSocket;
  if(!socket)fail('browser');socket.accept();let id=0;const waiting=new Map(),listeners=new Set();
  const rejectAll=()=>{for(const p of waiting.values()){clearTimeout(p.timer);p.reject(new SunError('browser'));}waiting.clear();};
  socket.addEventListener('close',rejectAll);socket.addEventListener('error',rejectAll);
  socket.addEventListener('message',event=>{let message;try{message=JSON.parse(event.data);}catch{return;}if(message.id){const p=waiting.get(message.id);if(!p)return;waiting.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new SunError('browser')):p.resolve(message.result);}else for(const fn of listeners)fn(message);});
  return {send(method,params={}){return new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{waiting.delete(n);reject(new SunError('browser'));},20000);waiting.set(n,{resolve,reject,timer});try{socket.send(JSON.stringify({id:n,method,params}));}catch{clearTimeout(timer);waiting.delete(n);reject(new SunError('browser'));}});},on(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){rejectAll();listeners.clear();socket.close();}};
 }
 async function evaluate(cdp,expression){const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true});if(r.exceptionDetails)fail('unreadable');return r.result?.value;}
 async function waitForLogin(cdp,submitted=false){
  let transientErrors=0;
  for(let attempt=0;attempt<30;attempt++){
   let state;try{state=await evaluate(cdp,rentLoginStateScript);transientErrors=0;}catch(error){if(error.code!=='browser'||++transientErrors>2)throw error;}
   if(state==='signed-in'||!submitted&&state==='ready')return state;
   if(['credentials','verification'].includes(state))fail(state);
   await new Promise(resolve=>setTimeout(resolve,750));
  }
  fail('verification');
 }
 async function observe(cdp,expectedAgreement){
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  let stop,timer;const requests=new Map();
  const result=new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(new SunError('unreadable')),35000);
   stop=cdp.on(event=>{
    const p=event.params;
    if(event.method==='Network.responseReceived'){const agreement=balanceRequest(p.response.url);if(agreement&&[401,403].includes(p.response.status)){reject(new SunError('login'));return;}if(agreement&&p.response.status===200)requests.set(p.requestId,agreement);}
    if(event.method==='Network.loadingFinished'&&requests.has(p.requestId)){
     const agreement=requests.get(p.requestId);requests.delete(p.requestId);
     if(expectedAgreement&&agreement!==expectedAgreement){reject(new SunError('property'));return;}
     cdp.send('Network.getResponseBody',{requestId:p.requestId}).then(r=>{try{const body=r.base64Encoded?atob(r.body):r.body;if(body.length>250000)fail('unreadable');resolve({data:JSON.parse(body),agreement});}catch{reject(new SunError('unreadable'));}},reject);
    }
   });
  });
  // Attach rejection immediately: navigation itself may fail before the response arrives.
  result.catch(()=>{});
  try{await cdp.send('Page.navigate',{url:PORTAL+'/portal/payments'});return await result;}
  catch(error){const url=await evaluate(cdp,'location.href').catch(()=>null);if(url?.startsWith(PORTAL+'/auth/'))fail('login');throw error;}
  finally{clearTimeout(timer);stop?.();}
 }
 async function capture(cdp,observation){
  const saved=await evaluate(cdp,`(()=>{if(location.origin!==${JSON.stringify(PORTAL)}||!location.pathname.startsWith('/portal/'))return null;let dashboard;try{dashboard=JSON.parse(sessionStorage.getItem('customerDashboard')||'{}');}catch{}return {session:sessionStorage.getItem('session'),currency:dashboard?.selectedAgreement?.currencyCode};})()`);
  if(!saved?.session||saved.session.length>64000)fail('login');
  let auth;try{auth=JSON.parse(saved.session);}catch{fail('login');}if(!auth.userAccount?.security?.token)fail('login');
  const snapshot=parseSunBalance(observation.data,saved.currency);
  const {cookies=[]}=await cdp.send('Network.getCookies',{urls:[PORTAL,'https://auth-api.app.sunwebportal.com','https://portal-api.app.sunwebportal.com']});
  const allowed=cookies.filter(c=>{const host=c.domain.replace(/^\./,'');return host==='sunwebportal.com'||host.endsWith('.sunwebportal.com');}).map(c=>({name:c.name,value:c.value,domain:c.domain,path:c.path,secure:c.secure,httpOnly:c.httpOnly,...(c.expires>0?{expires:c.expires}:{}),...(c.sameSite?{sameSite:c.sameSite}:{})}));
  return {snapshot,session:{session:saved.session,cookies:allowed,agreement:observation.agreement}};
 }
 async function genericCapture(cdp,portal,poll=false){
  let page,snapshot;
  for(let attempt=0;attempt<(poll?16:1);attempt++){
   page=await evaluate(cdp,`(()=>{const visible=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);return {url:location.href,text:(document.body?.innerText||'').slice(0,120001),password:[...document.querySelectorAll('input[type=password]')].some(visible),ready:document.readyState};})()`);
   if(page?.password)fail('login');
   if(sameRentHost(page?.url,portal)&&page.ready!=='loading'){
    if(/\/(?:login|signin|sign-in|auth)(?:[/?#]|$)/i.test(new URL(page.url).pathname))fail('login');
    if(/\/(?:checkout|submit|processpayment|makepayment|paynow|confirmation)(?:[/?#]|$)/i.test(new URL(page.url).pathname))fail('unreadable');
    try{snapshot=parseRentPage(page.text);break;}catch(error){if(!poll||attempt===15)throw error;}
   }
   if(!poll)fail('login');
   await new Promise(resolve=>setTimeout(resolve,750));
  }
  if(!snapshot)fail('unreadable');
  const origin=new URL(page.url).origin;
  const storage=await evaluate(cdp,`(()=>{if(location.origin!==${JSON.stringify(origin)})return null;const read=s=>Object.fromEntries(Object.keys(s).filter(k=>!/password|passphrase|cvv|verification.?code/i.test(k)).slice(0,400).map(k=>[k,s.getItem(k)]));return {local:read(localStorage),session:read(sessionStorage)};})()`);
  if(!storage||JSON.stringify(storage).length>128000)fail('unreadable');
  const {cookies=[]}=await cdp.send('Network.getCookies',{urls:[new URL(portal).origin,origin]});
  const savedCookies=cookies.filter(c=>{const host=c.domain.replace(/^\./,'');const portalHost=new URL(portal).hostname,balanceHost=new URL(origin).hostname;return host===portalHost||portalHost.endsWith('.'+host)||host===balanceHost||balanceHost.endsWith('.'+host);}).map(c=>({name:c.name,value:c.value,domain:c.domain,path:c.path,secure:c.secure,httpOnly:c.httpOnly,...(c.expires>0?{expires:c.expires}:{}),...(c.sameSite?{sameSite:c.sameSite}:{})}));
  return {snapshot,session:{adapter:'generic',portalUrl:portal,balanceUrl:page.url,origin,storage,cookies:savedCookies}};
 }
 return {
  async login(value,expectedAgreement){
   const credentials=rentCredentials(value),acquired=await acquire(false,credentials.portalUrl),sessionId=acquired.sessionId;let cdp;
   try{
    const target=await binding.devtools.newTarget(sessionId,PORTAL+'/auth/login');cdp=await channel(sessionId,target.id);
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    if(await waitForLogin(cdp)!=='signed-in'){
     if(!await evaluate(cdp,rentLoginFillScript(credentials)))fail('credentials');
     if(!await evaluate(cdp,rentLoginSubmitScript))fail('credentials');
     await waitForLogin(cdp,true);
    }
    return await capture(cdp,await observe(cdp,expectedAgreement||value.agreement));
   }finally{cdp?.close();await close(sessionId).catch(()=>{});}
  },
  async start(value){const portal=rentPortalUrl(value),acquired=await acquire(true,portal),sessionId=acquired.sessionId;try{
   const target=await binding.devtools.newTarget(sessionId,new URL(portal).origin===PORTAL?PORTAL+'/auth/login':portal);
   const live=await binding.getLiveView(sessionId,{targetId:target.id,mode:'tab',expiresInMs:LOGIN_MS});
   const url=new URL(live.devtoolsFrontendUrl);if(url.protocol!=='https:'||url.hostname!=='live.browser.run')fail('browser');
   return {pending:{sessionId,targetId:target.id,portalUrl:portal,expires:Date.now()+LOGIN_MS},url:url.href};
  }catch(error){await close(sessionId).catch(()=>{});throw error;}},
  async finish(pending){available();if(!pending||pending.expires<=Date.now())fail('expired');const cdp=await channel(pending.sessionId,pending.targetId);try{
   const portal=rentPortalUrl(pending.portalUrl||PORTAL);
   if(new URL(portal).origin!==PORTAL)return await genericCapture(cdp,portal);
   const url=await evaluate(cdp,'location.href');if(typeof url!=='string'||!url.startsWith(PORTAL+'/portal/'))fail('login');
   return await capture(cdp,await observe(cdp));
  }finally{cdp.close();}},
  async check(saved){available();if(!saved?.session&&saved?.adapter!=='generic')fail('login');
   const portal=saved.adapter==='generic'?rentPortalUrl(saved.portalUrl):PORTAL;
   if(saved.adapter==='generic'&&(!sameRentHost(saved.balanceUrl,portal)||new URL(saved.balanceUrl).origin!==saved.origin))fail('login');
   const acquired=await acquire(false,portal),sessionId=acquired.sessionId;let cdp;try{
    const target=await binding.devtools.newTarget(sessionId,'about:blank');cdp=await channel(sessionId,target.id);
    if(saved.cookies?.length)await cdp.send('Network.setCookies',{cookies:saved.cookies});
    if(saved.adapter==='generic'){
     const storage=saved.storage||{};
     await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(saved.origin)}){for(const [key,value]of Object.entries(${JSON.stringify(storage.local||{})}))localStorage.setItem(key,value);for(const [key,value]of Object.entries(${JSON.stringify(storage.session||{})}))sessionStorage.setItem(key,value);}`});
     await cdp.send('Page.navigate',{url:saved.balanceUrl});return await genericCapture(cdp,portal,true);
    }
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(PORTAL)})sessionStorage.setItem('session',${JSON.stringify(saved.session)});`});
    return await capture(cdp,await observe(cdp,saved.agreement));
   }finally{cdp?.close();await close(sessionId).catch(()=>{});}},
  close
 };
}

export async function syncSun(connection,session,browser,saveSession,{force=false,now=Date.now(),credentials=null}={}){
 if(connection?.enabled===false)return 'Rent tracking is turned off.';
 const automatic=connection?.automaticLogin&&credentials&&rentAutoLoginSupported(connection.portalUrl||PORTAL)&&credentials.portalUrl===PORTAL;
 if(!connection?.connected||connection.needsLogin&&!(force&&automatic)||connection.pending?.expires>now)return connection?.status||'Connect your rent portal first.';
 if(connection.lastAttempt&&now-connection.lastAttempt<5*60000)return 'Rent was checked recently. Showing the last saved amounts.';
 if(!force&&connection.nextSync>now)return connection.status;
 connection.lastAttempt=now;connection.nextSync=now+DAY;
 try{let result;try{if(connection.needsLogin)fail('login');result=await browser.check(session);}catch(error){if(error.code!=='login'||!automatic)throw error;result=await browser.login(credentials,session?.agreement||credentials.agreement);}await saveSession(result.session);rememberRentReadings(connection);connection.snapshot=result.snapshot;rememberRentReadings(connection);connection.updated=now;connection.needsLogin=false;connection.status='Rent balance checked. Rent is due on the 1st. Scheduled again in about a day.';}
 catch(error){connection.needsLogin=['login','property','credentials','verification','unsupported'].includes(error.code);connection.status=sunMessage(error);if(!connection.needsLogin)connection.nextSync=now+6*3600000;}
 return connection.status;
}
