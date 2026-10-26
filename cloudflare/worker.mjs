import {rentPortalUrl} from '../rent-portal.mjs';
import {rememberRentReadings} from '../public/rent-model.mjs';
import {createSunBrowser,publicSun,sunMessage,syncSun,rentCredentials,rentAutoLoginSupported,SunError} from '../sun-rent.mjs';
import {claimSimplefin,publicSimplefin,syncSimplefin,configureSimplefinAccount} from '../simplefin.mjs';
import {plaidAccountEntry,bankAccounts,combineBankConnections} from '../providers.mjs';
import {userScope,googleIdentity,sessionMismatch} from '../user-scope.mjs';
import {mailboxes,connectMailbox,publicMail,forgetMailbox,scanMailbox,refreshSelectedEmail} from '../mailboxes.mjs';
import {incomeFromTracker,incomeFromPlan} from '../income-preset.mjs';
import {creditLinkOptions,syncCredit,publicCredit,publicItem} from '../credit.mjs';
import {recurringBills,personalSpending} from '../recurring.mjs';
import {validateClassic} from '../classic-state.mjs';
// Serverless adapter. No persistent process, local disk, or paid Worker features.
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {blank,validate,cents} from '../public/engine.mjs';
import {applyTransactions} from '../providers.mjs';

const random=()=>randomBytes(32).toString('base64url'),hash=s=>createHash('sha256').update(s).digest('hex');
const sixHours=6*3600000;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.plaid.com wss://live.browser.run; frame-src https://*.plaid.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});}
function cookie(name,value,seconds){return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${seconds}`;}
function cookies(req){return Object.fromEntries((req.headers.get('cookie')||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
function redirect(path,setCookies=[]){const h=new Headers({...headers,Location:path});for(const c of setCookies)h.append('Set-Cookie',c);return new Response(null,{status:302,headers:h});}
async function body(req){if(!req.headers.get('content-type')?.startsWith('application/json'))throw Error('Expected JSON');let length=0,parts=[];for await(const chunk of req.body||[]){length+=chunk.length;if(length>250000)throw Error('Plan/request exceeds 250 KB');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
export function runtime(env,fetcher=fetch){
 const key=env.DATA_KEY?Buffer.from(env.DATA_KEY,'base64'):null,origin=env.APP_URL?new URL(env.APP_URL).origin:null,owner=env.ALLOWED_EMAIL?.toLowerCase();
 const users=userScope(owner),sunBrowser=createSunBrowser(env.BROWSER);
 const configured=!!(env.DB&&key?.length===32&&origin?.startsWith('https:')&&owner&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
 const run=(sql,...args)=>env.DB.prepare(sql).bind(...args).run(),first=(sql,...args)=>env.DB.prepare(sql).bind(...args).first();
 function encrypt(value){if(key?.length!==32)throw Error('Configure a 32-byte DATA_KEY');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(Buffer.from(JSON.stringify(value),'utf8')),cipher.final(),cipher.getAuthTag()]).toString('base64');}
 function decrypt(value){const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString());}
 async function rawRead(id,fallback){const r=await first('SELECT value FROM vault WHERE id=?',id);return r?decrypt(r.value):fallback;}
 const rawWrite=(id,value)=>run('INSERT INTO vault VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',id,encrypt(value));
 const read=(id,fallback)=>rawRead(users.key(id),fallback),write=(id,value)=>rawWrite(users.key(id),value);
 const plan=()=>read('plan',{state:blank(),revision:0});
 const connections=()=>read('connections',{items:[],transactions:[],candidates:[],gmail:null,status:'No connections yet.'});
 async function updatePlan(fn){const p=await plan();fn(p.state);p.revision++;await write('plan',p);return p;}
 async function sessionIdentity(req){if(!configured)return null;const token=cookies(req).bearden;if(!token)return null;const id=hash(token),session=await first('SELECT expires FROM sessions WHERE hash=?',id);return session&&session.expires>Date.now()?await rawRead('auth-session:'+id,token.startsWith('v2.')?null:users.legacy):null;}
 async function authorized(req){return !!await sessionIdentity(req);}

 async function locked(fn){const id=random(),now=Date.now();const r=await run("INSERT INTO locks VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires < ?",users.lock(),id,now+300000,now);if(!r.meta?.changes)throw Error('A sync or save is already running. Try again in a moment.');try{return await fn();}finally{await run("DELETE FROM locks WHERE id=? AND owner=?",users.lock(),id);}}
 async function request(url,options={}){const r=await fetcher(url,{...options,signal:AbortSignal.timeout(15000)});let d;try{d=await r.json();}catch{throw Error('Provider response unreadable');}if(!r.ok){const error=Error(d.error_code||d.error?.status||'Provider request failed ('+r.status+')');error.code=d.error_code;throw error;}return d;}
 async function plaid(path,data){if(!env.PLAID_CLIENT_ID||!env.PLAID_SECRET)throw Error('Plaid is not configured');const mode=env.PLAID_ENV||'sandbox';if(!['sandbox','production'].includes(mode))throw Error('Invalid Plaid environment');return request(`https://${mode}.plaid.com${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:env.PLAID_CLIENT_ID,secret:env.PLAID_SECRET,...data})});}
 const googleToken=data=>request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...data})});
 function publicConnections(c){return {sun:publicSun(c.sun),simplefin:publicSimplefin(c),items:c.items.map(publicItem),creditCards:publicCredit(c),recurringBills:recurringBills(c.transactions),personalSpending:personalSpending(c.transactions),transactions:c.transactions.filter(t=>t.date>=new Date(Date.now()-365*86400000).toISOString().slice(0,10)).slice(0,1500),candidates:c.candidates.filter(x=>!x.dismissed),...publicMail(c,users.current().email),bankUpdated:c.bankUpdated,status:c.status};}
 async function claimRentLogin(now=Date.now()){
  const usage=await read('sun-browser-usage',{since:now,count:0,last:0});if(now-usage.since>=86400000){usage.since=now;usage.count=0;}
  if(usage.count>=6)throw new SunError('quota');if(now-usage.last<20000)throw new SunError('rate');
  usage.count++;usage.last=now;await write('sun-browser-usage',usage);
 }
 async function syncSunRent(c,force=false){return syncSun(c.sun,await read('sun-session',null),{check:s=>sunBrowser.check(s),login:async(...args)=>{await claimRentLogin();return sunBrowser.login(...args);}},value=>write('sun-session',value),{force,credentials:c.sun?.automaticLogin?await read('sun-credentials',null):null});}
 async function syncSimplefinBalances(c){return syncSimplefin(c,async()=>(await plan()).state.accounts,accounts=>updatePlan(s=>{s.accounts=accounts;}),fetcher);}
 async function syncBalances(c,item,live=false){
   item.balanceAttempt=Date.now();
   try{const accounts=await bankAccounts(plaid,item,live);
   await updatePlan(s=>{const active=new Set(accounts.accounts.map(a=>'plaid-'+a.account_id));s.accounts=s.accounts.filter(a=>a.itemId!==item.id||active.has(a.id));for(const a of accounts.accounts){const id='plaid-'+a.account_id,old=s.accounts.find(x=>x.id===id),entry=plaidAccountEntry(a,item,old);if(old)Object.assign(old,entry);else s.accounts.push(entry);}});
  item.balancesUpdated=Date.now();delete item.balanceError;c.bankUpdated=new Date().toISOString();
   }catch(error){item.balanceError=error.code||error.message;throw error;}
 }
 async function syncBank(c,item,force=false){
  item.lastSyncAttempt=Date.now();
  await syncCredit(c,item,plaid,force);
  // One page per invocation, with a staged snapshot. Never commit a partial cursor.
  if(!item.pending)item.pending={original:item.cursor||'',cursor:item.cursor||'',transactions:c.transactions.filter(t=>t.itemId===item.id)};
  try{if(!item.balancesUpdated||Date.now()-item.balancesUpdated>=sixHours)await syncBalances(c,item);const page=await plaid('/transactions/sync',{access_token:item.token,cursor:item.pending.cursor,count:100});item.pending.transactions=applyTransactions(item.pending.transactions,[page],item.id).filter(t=>t.date>=new Date(Date.now()-200*86400000).toISOString().slice(0,10)).slice(0,1500);item.pending.cursor=page.next_cursor;
   if(page.has_more)return 'Bank history is loading in small batches. Next step within 15 minutes.';
   c.transactions=[...c.transactions.filter(t=>t.itemId!==item.id),...item.pending.transactions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3000);item.cursor=item.pending.cursor;delete item.pending;item.nextSync=Date.now()+sixHours;return item.name+' synced. Scheduled again in about 6 hours.'+(item.liabilitiesStatus?' '+item.liabilitiesStatus:'');
  }catch(e){if(e.code==='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')delete item.pending;item.nextSync=Date.now()+900000;throw e;}
 }
 async function syncGmail(c,account,query=null){
  const bills=await scanMailbox(c,account,{request,googleToken,query,limit:query===null?3:4});
  if(bills.length){const p=await plan();let changed=false;for(const bill of bills)if(!p.state.bills.some(b=>b.sourceId===bill.sourceId||b.sourceKey===bill.sourceKey)){p.state.bills.push(bill);changed=true;}if(changed){validate(p.state);if(JSON.stringify(p.state).length>240000)throw Error('Plan storage is full.');p.revision++;await write('plan',p);}}
  return account.status;
 }
 async function sync(force=false,bankOnly=false,targetId=null,gmailOnly=false){return locked(async()=>{const c=await connections(),now=Date.now(),bank=!gmailOnly&&c.items.filter(i=>(!targetId||i.id===targetId)&&(force||i.pending||!i.nextSync||i.nextSync<=now)).sort((a,b)=>(a.lastSyncAttempt||0)-(b.lastSyncAttempt||0))[0],gmail=!bankOnly&&mailboxes(c,users.current().email).filter(a=>force||a.backlog?.length||a.page||!a.nextSync||a.nextSync<=now).sort((a,b)=>(a.lastSyncAttempt||0)-(b.lastSyncAttempt||0))[0];
   if(!bankOnly&&!gmailOnly&&!targetId&&c.sun?.connected&&c.sun.enabled!==false&&!c.sun.needsLogin&&(!c.sun.nextSync||c.sun.nextSync<=now)&&!(c.sun.pending?.expires>now)){c.lastTask='rent';c.status=await syncSunRent(c);await write('connections',c);return {status:c.status};}
   if(!gmailOnly&&!targetId&&c.simplefin&&(force||!c.simplefin.nextSync||c.simplefin.nextSync<=now)&&(!bank||c.lastTask==='bank')){c.lastTask='simplefin';c.status=await syncSimplefinBalances(c);await write('connections',c);return {status:c.status};}
   if(targetId&&!bank)throw Error('Bank connection not found. Reload your connections.');
   if(!bank&&!gmail)return {status:gmailOnly?'No Gmail accounts connected.':c.status};if(bank)bank.lastSyncAttempt=now;try{if(force&&bank)await syncBalances(c,bank,true);if(gmail&&(!bank||c.lastTask==='bank')){c.lastTask='gmail';c.status=await syncGmail(c,gmail);}else{c.lastTask='bank';c.status=await syncBank(c,bank,force);}}catch(e){c.status='Sync needs attention: '+e.message;if(c.lastTask==='gmail'&&gmail){gmail.nextSync=now+sixHours;gmail.status=c.status;}}
   if(bank?.balanceWarning)c.status+=' '+bank.balanceWarning;
   c.lastAttempt=new Date().toISOString();c.candidates=c.candidates.filter(x=>!x.dismissed);await write('connections',c);return {status:c.status,itemId:bank?.id,balanceRefreshed:!!bank&&!bank.balanceError&&bank.balancesUpdated>=now,balanceWarning:bank?.balanceWarning||null,balanceError:bank?.balanceError||null};});}
 async function handleScoped(req){
  const u=new URL(req.url),path=u.pathname;
  if(path==='/health')return json({ok:true,hosting:'cloudflare-free',configured});
  if(path==='/api/config'&&req.method==='GET')return json({authenticated:await authorized(req),accountId:await authorized(req)?users.current().accountId:null,email:await authorized(req)?users.current().email:null,googleConfigured:configured,rentConfigured:!!env.BROWSER?.acquire,plaidConfigured:!!(env.PLAID_CLIENT_ID&&env.PLAID_SECRET),plaidEnvironment:env.PLAID_ENV||'sandbox',syncDescription:'balances loaded on connection; background updates about every 6 hours'});
  if(path==='/auth/google'&&req.method==='GET'){
   if(!configured)return json({error:'Configure Cloudflare D1 and the Google/owner/encryption secrets first.'},503);const gmail=u.searchParams.has('gmail');if(gmail&&!await authorized(req))return redirect('/auth/google');if(gmail&&sessionMismatch(users.current(),u.searchParams.get('account'),'POST'))return json({error:'Your BearDen account changed. Reload before adding Gmail.'},409);
   const state=random(),verifier=random();await run('DELETE FROM oauth WHERE expires < ?',Date.now());await run('INSERT INTO oauth VALUES(?,?,?,?)',hash(state),encrypt(gmail?{verifier,ownerSession:hash(cookies(req).bearden)}:verifier),gmail?1:0,Date.now()+600000);
   const q=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/auth/google/callback',response_type:'code',scope:'openid email'+(gmail?' https://www.googleapis.com/auth/gmail.readonly':''),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:gmail?'consent select_account':'select_account'});return redirect('https://accounts.google.com/o/oauth2/v2/auth?'+q,[cookie('bearden_oauth',state,600)]);
  }
  if(path==='/auth/google/callback'&&req.method==='GET'){
   if(!configured)return json({error:'Server setup incomplete'},503);const state=u.searchParams.get('state')||'';if(!state||cookies(req).bearden_oauth!==state)return json({error:'Invalid sign-in state. Start again.'},400);
   // DELETE RETURNING consumes the state atomically across Worker instances.
   const record=await first('DELETE FROM oauth WHERE hash=? RETURNING *',hash(state));if(!record||record.expires<Date.now()||!u.searchParams.get('code'))return json({error:'Sign-in cancelled or expired'},400);
   const binding=decrypt(record.verifier);if(record.gmail&&(!await authorized(req)||binding.ownerSession!==hash(cookies(req).bearden||'')))return json({error:'Sign in to your BearDen account before adding Gmail.'},403);
   const token=await googleToken({grant_type:'authorization_code',code:u.searchParams.get('code'),redirect_uri:origin+'/auth/google/callback',code_verifier:typeof binding==='string'?binding:binding.verifier}),user=await request('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});
   if(!user.email_verified)return json({error:'Google must verify your email before signing in.'},403);
   if(record.gmail){if(!token.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')||!token.refresh_token)throw Error('Gmail read-only/offline access was not granted. Reconnect.');await locked(async()=>{const c=await connections();connectMailbox(c,user,token.refresh_token,users.current().email);await write('connections',c);});}
   if(record.gmail)return redirect('/?connected=1',[cookie('bearden_oauth','',0)]);
   const identity=googleIdentity(user,owner),session='v2.'+random();await rawWrite('auth-session:'+hash(session),identity);const profile=await rawRead('user-index:'+identity.accountId,{lastSync:0});await rawWrite('user-index:'+identity.accountId,{...profile,...identity});await run('DELETE FROM sessions WHERE expires < ?',Date.now());await run('INSERT INTO sessions VALUES(?,?)',hash(session),Date.now()+7*86400000);return redirect('/?connected=1',[cookie('bearden',session,7*86400),cookie('bearden_oauth','',0)]);
  }
  if(path.startsWith('/api/')){
   if(!await authorized(req))return json({error:'Sign in to access private data.'},401);
   if(sessionMismatch(users.current(),req.headers.get('X-BearDen-Account'),req.method))return json({error:'The signed-in account changed. Reload before continuing; your edits have not been saved to the other account.'},409);
   if(req.method==='GET'&&path==='/api/income/baby-bear'){const saved=await read('income-shortcut',null),classic=await read('classic',{}),preset=saved||incomeFromTracker(classic.state)||incomeFromPlan((await plan()).state);return preset?json(preset):json({error:'Set your income in the Income tab once to save your Baby Bear income shortcut.'},404);}
   if(path==='/api/import/baby-bear')return json({error:'Preset account imports have been retired. Use Accounts or the income-only shortcut.'},410);
   if(req.method==='GET'&&path==='/api/classic')return json(await read('classic',{state:{version:1,values:{}},revision:0}));
   if(req.method==='GET'&&path==='/api/state')return json({...await plan(),connections:publicConnections(await connections())});
   if(req.method!=='POST')return json({error:'Method not allowed'},405);if(req.headers.get('origin')!==origin)return json({error:'Request origin does not match this server'},403);const b=await body(req);
   if(path==='/api/logout'){await run('DELETE FROM sessions WHERE hash=?',hash(cookies(req).bearden));const response=json({ok:true});response.headers.append('Set-Cookie',cookie('bearden','',0));return response;}
   if(path==='/api/bank/refresh')return json(await sync(true,true,b.itemId||null));
   if(path==='/api/sync')return json(await sync(true,false,null,b.gmailOnly===true));
   if(path==='/api/plaid/link'){const c=await connections(),item=c.items.find(i=>i.id===b.itemId);const d=await plaid('/link/token/create',{user:{client_user_id:hash(users.current().scope||owner)},client_name:'BearDen',...creditLinkOptions(b,item),country_codes:['US'],language:'en',...(env.PLAID_REDIRECT_URI?{redirect_uri:env.PLAID_REDIRECT_URI}:{})});return json({link_token:d.link_token});}
   return locked(async()=>{
    if(path.startsWith('/api/rent/')){
     const c=await connections(),now=Date.now();
     try{
      if(path==='/api/rent/settings'){
       if(typeof b.enabled!=='boolean')return json({error:'Choose whether to enable Rent.'},400);
       c.sun={...c.sun,enabled:b.enabled};
       if(!b.enabled&&c.sun.pending){await sunBrowser.close(c.sun.pending.sessionId).catch(()=>{});delete c.sun.pending;}
       await write('connections',c);return json({enabled:b.enabled});
      }
      if(path==='/api/rent/credentials/remove'){
       await write('sun-credentials',null);if(c.sun)c.sun.automaticLogin=false;await write('connections',c);
       return json({status:'Saved rent credentials removed. Your current session is kept.'});
      }
      if(path==='/api/rent/credentials'){
       const credentials=rentCredentials(b),saved=await read('sun-session',null);
       await claimRentLogin(now);
       const expected=c.sun?.connected&&rentAutoLoginSupported(publicSun(c.sun)?.portalUrl)?saved?.agreement:null;
       const result=await sunBrowser.login(credentials,expected);
       // Validate sign-in and property before replacing any working connection.
       await write('sun-credentials',{...credentials,agreement:result.session.agreement});
       await write('sun-session',result.session);
       if(c.sun?.pending)await sunBrowser.close(c.sun.pending.sessionId).catch(()=>{});
       if(c.sun)rememberRentReadings(c.sun);c.sun={...c.sun,portalUrl:credentials.portalUrl,enabled:true,connected:true,automaticLogin:true,snapshot:result.snapshot,updated:now,lastAttempt:now,nextSync:now+86400000,needsLogin:false,status:'Automatic sign-in enabled. Rent balance saved; checks run about daily.'};delete c.sun.pending;
       rememberRentReadings(c.sun);await write('connections',c);return json({status:c.sun.status});
      }
      if(path==='/api/rent/start'){
       const portalUrl=rentPortalUrl(b.portalUrl||publicSun(c.sun)?.portalUrl);
       await claimRentLogin(now);
       if(c.sun?.pending)await sunBrowser.close(c.sun.pending.sessionId).catch(()=>{});
       const started=await sunBrowser.start(portalUrl);c.sun={...c.sun,enabled:true,pending:started.pending,status:'Sign in to your portal in the private window, open the page showing your balance, then select Save connection.'};
       try{await write('connections',c);}catch(error){await sunBrowser.close(started.pending.sessionId).catch(()=>{});throw error;}
       return json({url:started.url,expires:started.pending.expires});
      }
      if(path==='/api/rent/complete'){
       const result=await sunBrowser.finish(c.sun?.pending);await write('sun-session',result.session);
       const credentials=await read('sun-credentials',null);
       if(credentials&&(!rentAutoLoginSupported(c.sun.pending.portalUrl||publicSun(c.sun).portalUrl)||credentials.agreement!==result.session.agreement)){await write('sun-credentials',null);c.sun.automaticLogin=false;}
       const pending=c.sun.pending;rememberRentReadings(c.sun);c.sun={...c.sun,portalUrl:pending.portalUrl||publicSun(c.sun).portalUrl,enabled:true,connected:true,snapshot:result.snapshot,updated:now,lastAttempt:now,nextSync:now+86400000,needsLogin:false,status:'Rent portal connected. Balance saved; checks run about daily.'};delete c.sun.pending;
       rememberRentReadings(c.sun);await write('connections',c);await sunBrowser.close(pending.sessionId).catch(()=>{});return json({status:c.sun.status});
      }
      if(path==='/api/rent/refresh'){const status=await syncSunRent(c,true);await write('connections',c);return json({status});}
      if(path==='/api/rent/cancel'){
       if(c.sun?.pending)await sunBrowser.close(c.sun.pending.sessionId).catch(()=>{});
       if(c.sun){delete c.sun.pending;c.sun.status=c.sun.connected?'Sign-in cancelled. Your existing rent connection is kept.':'Sign-in cancelled.';await write('connections',c);}return json({status:'Sign-in cancelled.'});
      }
      if(path==='/api/rent/disconnect'){
       if(c.sun?.pending)await sunBrowser.close(c.sun.pending.sessionId).catch(()=>{});
       await write('sun-session',null);await write('sun-credentials',null);if(c.sun){rememberRentReadings(c.sun);delete c.sun.pending;c.sun.connected=false;c.sun.automaticLogin=false;c.sun.status='Rent portal disconnected. Your last rent reading is kept.';}await write('connections',c);return json({status:'Rent portal disconnected. Saved credentials and the sign-in session have been removed from BearDen.'});
      }
      return json({error:'Not found'},404);
     }catch(error){return json({error:sunMessage(error)},['quota','rate'].includes(error.code)?429:400);}
    }
    if(path==='/api/simplefin/connect'){
     const c=await connections();if(c.simplefin&&!b.replace)return json({error:'SimpleFIN is already connected. Use Replace token to reconnect it.'},409);
     const accessUrl=await claimSimplefin(b.token,fetcher);c.simplefin={accessUrl,status:'SimpleFIN connected. Loading balances.'};
     await write('connections',c);c.status=await syncSimplefinBalances(c);await write('connections',c);return json({ok:true,status:c.status});
    }
    if(path==='/api/simplefin/refresh'){
     const c=await connections();c.status=await syncSimplefinBalances(c);await write('connections',c);return json({status:c.status});
    }
    if(path==='/api/simplefin/account'){
     await updatePlan(s=>configureSimplefinAccount(s.accounts,b));return json({ok:true});
    }
    if(path==='/api/simplefin/disconnect'){
     const c=await connections();delete c.simplefin;await write('connections',c);await updatePlan(s=>{s.accounts=s.accounts.filter(a=>a.source!=='simplefin');});
     return json({ok:true,status:'SimpleFIN disconnected from BearDen. You can also revoke BearDen in SimpleFIN’s Apps section.'});
    }
    if(path==='/api/classic'){const state=validateClassic(b.state),current=await read('classic',{revision:0});if(current.revision!==b.revision)return json({error:'The tracker changed in another tab. Reload before editing again.'},409);await write('classic',{state,revision:current.revision+1});if(!await read('income-shortcut',null)){const preset=incomeFromTracker(state)||incomeFromPlan((await plan()).state);if(preset)await write('income-shortcut',preset);}return json({revision:current.revision+1});}
    if(path==='/api/state'){const state=validate(b.state);if(state.emailSenders.length>20||state.emailSenders.some(s=>!/^[-\w.+]+@[\w.-]+\.[a-z]{2,}$/i.test(s)))throw Error('Use up to 20 full sender email addresses');const current=await plan();if(current.revision!==b.revision)return json({error:'Plan changed during sync or in another tab. Reload before editing again.'},409);await write('plan',{state,revision:current.revision+1});const c=await connections(),accepted=new Set(state.bills.map(b=>b.sourceId).filter(Boolean));if(c.candidates.some(x=>accepted.has(x.id))){c.candidates=c.candidates.filter(x=>!accepted.has(x.id));await write('connections',c);}return json({revision:current.revision+1});}
    if(path==='/api/plaid/exchange'){if(typeof b.public_token!=='string')throw Error('Missing public token');const c=await connections();if(c.items.length>=10)throw Error('This personal setup supports up to 10 bank connections');const d=await plaid('/item/public_token/exchange',{public_token:b.public_token});let item=c.items.find(i=>i.id===d.item_id);if(!item){item={id:d.item_id,token:d.access_token,name:String(b.name||'Bank').slice(0,150),cursor:'',liabilities:b.kind==='credit'};c.items.push(item);}
     // Persist the exchanged token before fetching balances so a provider failure is recoverable.
     c.status='Bank connected. Loading balances.';await write('connections',c);
     try{await syncBalances(c,item);await syncCredit(c,item,plaid,true);c.status='Bank connected; balances loaded. Transaction history will load in the background.'+(item.liabilitiesStatus?' '+item.liabilitiesStatus:'');}
     catch(e){c.status='Bank connected, but balances could not load: '+e.message+'. Use Sync connections to retry.';}
     await write('connections',c);return json({ok:true,status:c.status});}

    if(path==='/api/plaid/updated'||path==='/api/cards/refresh'){
     const c=await connections(),item=c.items.find(i=>i.id===b.itemId);if(!item)return json({error:'Bank connection not found'},404);
     if(path==='/api/plaid/updated'&&b.kind!=='bank'){item.liabilities=true;await write('connections',c);}
     try{await syncBalances(c,item);}catch(e){c.status='Balance refresh needs attention: '+e.message;}
     try{c.status=await syncBank(c,item,true);}catch(e){c.status=(item.liabilitiesStatus||'')+' Transaction sync needs attention: '+e.message;}
     await write('connections',c);return json({status:c.status});
    }
    if(path==='/api/plaid/combine'){
     const before={connections:await connections(),plan:await plan(),classic:await read('classic',null)};
     if(b.revision!==(before.classic?.revision??0))return json({error:'Your saved data changed. Reload before combining connections.'},409);
     const merged=combineBankConnections(before.connections,before.plan,before.classic,b.removeId,b.keepId);
     await write('bank-combine-backup',before);
     try{await write('plan',merged.plan);if(merged.classic)await write('classic',merged.classic);await write('connections',merged.connections);}catch(e){await write('plan',before.plan);if(before.classic)await write('classic',before.classic);await write('connections',before.connections);throw e;}
     return json({ok:true});
    }
    if(path==='/api/plaid/disconnect'){const c=await connections(),item=c.items.find(i=>i.id===b.id);if(!item)return json({error:'Bank not found'},404);await plaid('/item/remove',{access_token:item.token});c.items=c.items.filter(i=>i.id!==b.id);c.transactions=c.transactions.filter(t=>t.itemId!==b.id);c.creditCards=(c.creditCards||[]).filter(card=>card.itemId!==b.id);await write('connections',c);await updatePlan(s=>{s.accounts=s.accounts.filter(a=>a.itemId!==b.id);});return json({ok:true});}
    if(path==='/api/gmail/message'){
     const c=await connections(),message=await refreshSelectedEmail(c,b,{request,googleToken,owner:users.current().email});await write('connections',c);return json({message});
    }
    if(path==='/api/gmail/search'){
     if(typeof b.query!=='string'||b.query.length>100)throw Error('Use a merchant name of up to 100 characters.');
     const c=await connections();for(const account of mailboxes(c,users.current().email)){try{await syncGmail(c,account,b.query);}catch(e){account.status='Gmail needs attention: '+e.message;}}
     await write('connections',c);return json(publicMail(c,users.current().email));
    }
    if(path==='/api/gmail/disconnect'){
     const c=await connections(),accounts=mailboxes(c,users.current().email),id=b.id||(accounts.length===1?accounts[0].id:null),account=accounts.find(a=>a.id===id);if(!account)return json({error:'Choose the Gmail account to disconnect.'},400);
     const r=await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:account.refreshToken}),signal:AbortSignal.timeout(15000)});if(!r.ok&&r.status!==400)throw Error('Could not revoke Google access; try again.');
     forgetMailbox(c,id,users.current().email);await write('connections',c);return json({ok:true});
    }
    if(path==='/api/candidate/dismiss'){const c=await connections();c.candidates=c.candidates.filter(x=>x.id!==b.id);await write('connections',c);return json({ok:true});}
    return json({error:'Not found'},404);
   });
  }
  if(!['GET','HEAD'].includes(req.method))return json({error:'Method not allowed'},405);
  if(!['/','/index.html','/plaid-return','/style.css','/app.mjs','/engine.mjs','/setup-key','/setup-key.html','/setup-key.mjs','/favicon.ico','/tabs.js','/tabs.css','/theme.css','/income-model.mjs','/debt-payments.mjs','/rent-model.mjs','/rent-browser.mjs','/household-model.mjs','/credit-model.mjs','/transaction-links.mjs','/email-model.mjs','/tax-model.mjs','/tax-ui.mjs','/onboarding.js','/bank-activity.mjs','/classic.js','/classic.css','/classic-theme.js','/classic-events.js','/classic-migrate.mjs','/connections.js','/connections.css','/purify.min.js'].includes(path))return json({error:'Not found'},404);
  const target=new URL(req.url);if(path==='/plaid-return')target.pathname='/';const asset=await env.ASSETS.fetch(new Request(target,req)),response=new Response(asset.body,asset);for(const [k,v]of Object.entries(headers))response.headers.set(k,v);return response;
 }
 async function handle(req){const identity=await sessionIdentity(req);return users.run(identity,()=>handleScoped(req));}
 async function syncNextAccount(){
  const rows=await env.DB.prepare("SELECT value FROM vault WHERE id LIKE 'user-index:%'").bind().all();const profiles=rows.results.map(r=>decrypt(r.value));if(!profiles.some(p=>!p.scope))profiles.push({...users.legacy,lastSync:0});
  const identity=profiles.sort((a,b)=>(a.lastSync||0)-(b.lastSync||0))[0];return users.run(identity,async()=>{const result=await sync();await rawWrite('user-index:'+identity.accountId,{...identity,lastSync:Date.now()});return result;});
 }
 return {handle,sync,syncNextAccount,configured,encrypt,decrypt};
}
export default {
 async fetch(req,env){try{return await runtime(env).handle(req);}catch(e){return json({error:e.message||'Request failed'},400);}},
 async scheduled(_event,env,ctx){const app=runtime(env);if(app.configured)ctx.waitUntil(app.syncNextAccount().catch(()=>{/* Connection errors are stored in the private status. Do not log tokens or payloads. */}));}
};

