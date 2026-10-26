// Sun portal adapter. Only the portal's own balance response is observed; no payment requests are made.
// Session and pending-browser records must be encrypted by the caller and never returned in public state.
const PORTAL='https://app.sunwebportal.com',DAY=86400000,LOGIN_MS=5*60000;
const domains=['app.sunwebportal.com','*.app.sunwebportal.com','accounts.google.com','*.gstatic.com','*.googleapis.com','www.google.com','www.facebook.com','*.facebook.net'];
export class SunError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new SunError(code);};
export function sunMessage(error){return ({unavailable:'Rent sign-in is unavailable on this server. Cloudflare Browser Run must be enabled.',expired:'The sign-in window expired. Start a new rent connection.',login:'Finish signing in to Sun and open Payments, then select Save connection here.',unreadable:'Sun did not provide a readable balance. Your last saved amounts are unchanged. Try again from the Payments page.',property:'Sun opened a different property. Reconnect and select the correct property.',quota:'The rent browser limit has been reached. Try again tomorrow.',browser:'The private rent browser could not connect. Try again in a moment.'})[error?.code]||'Sun could not be checked. Your last saved amounts are unchanged. Try again later.';}
function money(value){if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e8)fail('unreadable');return Math.round(value*100);}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))return null;const day=value.slice(0,10);return !Number.isNaN(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day?day:null;}
export function parseSunBalance(data,currency,now=Date.now()){
 if(!data||typeof data!=='object')fail('unreadable');
 const code=data.currencyCode||currency;if(code!=='USD')fail('unreadable');
 const amountDue=money(data.totalDue),currentBalance=money(data.balance),dueDate=date(data.dueDate);
 if(amountDue>0&&!dueDate)fail('unreadable');
 return {amountDue,currentBalance,dueDate,currency:'USD',checkedAt:now};
}
export function publicSun(connection,now=Date.now()){
 if(!connection)return null;
 return {connected:!!connection.connected,status:connection.status||'Not connected.',needsLogin:!!connection.needsLogin,updated:connection.updated||null,nextSync:connection.nextSync||null,pendingUntil:connection.pending?.expires>now?connection.pending.expires:null,snapshot:connection.snapshot?{amountDue:connection.snapshot.amountDue,currentBalance:connection.snapshot.currentBalance,dueDate:connection.snapshot.dueDate,currency:connection.snapshot.currency,checkedAt:connection.snapshot.checkedAt}:null};
}
function balanceRequest(url){try{const u=new URL(url);return u.origin==='https://portal-api.app.sunwebportal.com'&&/^\/Payment\/GetCurrentBalanceBySelf\/[^/]+$/.test(u.pathname)?decodeURIComponent(u.pathname.split('/').at(-1)):null;}catch{return null;}}
export function createSunBrowser(binding){
 function available(){if(!binding?.acquire||!binding?.connectSession||!binding?.getLiveView)fail('unavailable');}
 async function close(id){if(id)await binding?.closeSession(id);}
 async function acquire(interactive){available();return binding.acquire({keepAlive:interactive?LOGIN_MS:60000,recording:false,guardrails:{allowedDomains:domains}});}
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
 async function observe(cdp,expectedAgreement){
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  let stop,timer;const requests=new Map();
  const result=new Promise((resolve,reject)=>{
   timer=setTimeout(()=>reject(new SunError('unreadable')),35000);
   stop=cdp.on(event=>{
    const p=event.params;
    if(event.method==='Network.responseReceived'){const agreement=balanceRequest(p.response.url);if(agreement&&p.response.status===200)requests.set(p.requestId,agreement);}
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
 return {
  async start(){const acquired=await acquire(true),sessionId=acquired.sessionId;try{
   const target=await binding.devtools.newTarget(sessionId,PORTAL+'/auth/login');
   const live=await binding.getLiveView(sessionId,{targetId:target.id,mode:'tab',expiresInMs:LOGIN_MS});
   const url=new URL(live.devtoolsFrontendUrl);if(url.protocol!=='https:'||url.hostname!=='live.browser.run')fail('browser');
   return {pending:{sessionId,targetId:target.id,expires:Date.now()+LOGIN_MS},url:url.href};
  }catch(error){await close(sessionId).catch(()=>{});throw error;}},
  async finish(pending){available();if(!pending||pending.expires<=Date.now())fail('expired');const cdp=await channel(pending.sessionId,pending.targetId);try{
   const url=await evaluate(cdp,'location.href');if(typeof url!=='string'||!url.startsWith(PORTAL+'/portal/'))fail('login');
   return await capture(cdp,await observe(cdp));
  }finally{cdp.close();}},
  async check(saved){available();if(!saved?.session)fail('login');const acquired=await acquire(false),sessionId=acquired.sessionId;let cdp;try{
   const target=await binding.devtools.newTarget(sessionId,'about:blank');cdp=await channel(sessionId,target.id);
   if(saved.cookies?.length)await cdp.send('Network.setCookies',{cookies:saved.cookies});
   await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(PORTAL)})sessionStorage.setItem('session',${JSON.stringify(saved.session)});`});
   return await capture(cdp,await observe(cdp,saved.agreement));
  }finally{cdp?.close();await close(sessionId).catch(()=>{});}},
  close
 };
}
export async function syncSun(connection,session,browser,saveSession,{force=false,now=Date.now()}={}){
 if(!connection?.connected||connection.needsLogin||connection.pending?.expires>now)return connection?.status||'Connect Sun first.';
 if(connection.lastAttempt&&now-connection.lastAttempt<5*60000)return 'Sun was checked recently. Showing the last saved amounts.';
 if(!force&&connection.nextSync>now)return connection.status;
 connection.lastAttempt=now;connection.nextSync=now+DAY;
 try{const result=await browser.check(session);await saveSession(result.session);connection.snapshot=result.snapshot;connection.updated=now;connection.needsLogin=false;connection.status='Sun balance and due date checked. Scheduled again in about a day.';}
 catch(error){connection.needsLogin=error.code==='login'||error.code==='property';connection.status=sunMessage(error);if(!connection.needsLogin)connection.nextSync=now+6*3600000;}
 return connection.status;
}
