import {userScope,googleIdentity,sessionMismatch} from './user-scope.mjs';
import {mailboxes,connectMailbox,publicMail,forgetMailbox,scanMailbox,refreshSelectedEmail} from './mailboxes.mjs';
import {incomeFromTracker,incomeFromPlan} from './income-preset.mjs';
import {creditLinkOptions,syncCredit,publicCredit,publicItem} from './credit.mjs';
import {recurringBills,personalSpending} from './recurring.mjs';
import {validateClassic} from './classic-state.mjs';
import http from 'node:http';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {blank,validate,cents} from './public/engine.mjs';
import {request,plaid,transactionSync,applyTransactions} from './providers.mjs';

const root=dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||3000),origin=new URL(process.env.APP_URL||`http://localhost:${port}`).origin,secure=origin.startsWith('https:'),allowed=process.env.ALLOWED_EMAIL?.toLowerCase(),key=process.env.DATA_KEY?Buffer.from(process.env.DATA_KEY,'base64'):null;
if(key&&key.length!==32)throw Error('DATA_KEY must be 32 random bytes in base64');
if(process.env.NODE_ENV==='production'&&(!key||!secure||!allowed||!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET))throw Error('Production requires DATA_KEY, HTTPS APP_URL, ALLOWED_EMAIL, and Google credentials');
const googleConfigured=!!(key&&allowed&&process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),dataDir=process.env.DATA_DIR||resolve(root,'data');mkdirSync(dataDir,{recursive:true,mode:0o700});
const db=new DatabaseSync(resolve(dataDir,'bearden.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS oauth (hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, gmail INTEGER NOT NULL, expires INTEGER NOT NULL);');
const hash=s=>createHash('sha256').update(s).digest('hex'),random=()=>randomBytes(32).toString('base64url');
function encrypt(value){if(!key)throw Error('Storage key missing');const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');}
function decrypt(value){const b=Buffer.from(value,'base64'),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString());}
const users=userScope(allowed);
function rawRead(id,fallback){const r=db.prepare('SELECT value FROM vault WHERE id=?').get(id);return r?decrypt(r.value):fallback;}
function rawWrite(id,data){db.prepare('INSERT INTO vault(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,encrypt(data));}
const read=(id,fallback)=>rawRead(users.key(id),fallback),write=(id,data)=>rawWrite(users.key(id),data);
function getPlan(){return read('plan',{state:blank(),revision:0});}
function updatePlan(fn){const p=getPlan();fn(p.state);p.revision++;write('plan',p);return p;}
function connections(){return read('connections',{items:[],transactions:[],candidates:[],seen:[],gmail:null,status:'No connections yet.'});}
function publicConnections(c){return {items:c.items.map(publicItem),creditCards:publicCredit(c),...publicMail(c,users.current().email),recurringBills:recurringBills(c.transactions),personalSpending:personalSpending(c.transactions),transactions:c.transactions.filter(t=>t.date>=new Date(Date.now()-365*86400000).toISOString().slice(0,10)).slice(0,1500),candidates:c.candidates,bankUpdated:c.bankUpdated,status:c.status};}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
function sessionIdentity(req){const s=cookies(req).bearden;if(!s)return null;const id=hash(s),r=db.prepare('SELECT expires FROM sessions WHERE hash=?').get(id);return r&&r.expires>Date.now()?rawRead('auth-session:'+id,s.startsWith('v2.')?null:users.legacy):null;}
function authenticated(req){return !!sessionIdentity(req);}
function cookie(name,value,seconds){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${secure?'; Secure':''}`;}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
function redirect(res,path,headers={}){res.writeHead(302,{Location:path,...headers});res.end();}
async function body(req){let n=0,parts=[];for await(const p of req){n+=p.length;if(n>1000000)throw Error('Request too large');parts.push(p);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
async function googleToken(params){return request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,...params})});}
const syncs=new Map();const runningSync=()=>syncs.get(users.current().accountId);
async function doSync(bankOnly=false){
 let c=connections(),errors=[],now=new Date().toISOString();
 for(const item of c.items){await syncCredit(c,item,plaid);if(item.liabilitiesError)errors.push(item.liabilitiesStatus);try{const synced=await transactionSync(item),accounts=await plaid('/accounts/get',{access_token:item.token});c.transactions=applyTransactions(c.transactions,synced.changes,item.id);item.cursor=synced.cursor;
  updatePlan(s=>{const activeIds=new Set(accounts.accounts.map(a=>'plaid-'+a.account_id));s.accounts=s.accounts.filter(a=>a.itemId!==item.id||activeIds.has(a.id));for(const a of accounts.accounts){const id='plaid-'+a.account_id,old=s.accounts.find(x=>x.id===id),balance=['credit','loan'].includes(a.type)?a.balances.current:(a.balances.available??a.balances.current);if(balance===null)continue;const eligible=a.type==='depository'&&a.subtype==='checking'&&a.balances.iso_currency_code==='USD';const entry={id,itemId:item.id,name:a.name+(a.mask?' •'+a.mask:''),balance:cents(balance),include:eligible?(old?.include??true):false,source:'plaid',type:a.type,subtype:a.subtype,currency:a.balances.iso_currency_code};if(old)Object.assign(old,entry);else s.accounts.push(entry);}});c.bankUpdated=now;
 }catch(e){errors.push(`${item.name}: ${e.message}`);}}
 if(!bankOnly)for(const account of mailboxes(c,users.current().email)){try{await syncMailbox(c,account);}catch(e){account.status='Gmail needs attention: '+e.message;errors.push(account.email+': '+account.status);}}
 c.status=errors.length?'Sync needs attention — '+errors.join(' · '):'Last sync: '+now;c.lastAttempt=now;write('connections',c);return c;
}
async function syncMailbox(c,account,query=null){
 const bills=await scanMailbox(c,account,{request,googleToken,query,limit:query===null?3:4});
 if(bills.length){const p=getPlan();let changed=false;for(const bill of bills)if(!p.state.bills.some(b=>b.sourceId===bill.sourceId||b.sourceKey===bill.sourceKey)){p.state.bills.push(bill);changed=true;}if(changed){validate(p.state);p.revision++;write('plan',p);}}
}
async function sync(bankOnly=false){const id=users.current().accountId;if(!syncs.has(id))syncs.set(id,doSync(bankOnly).finally(()=>syncs.delete(id)));return syncs.get(id);}
const staticFiles={'/tax-model.mjs':['tax-model.mjs','text/javascript'],'/tax-ui.mjs':['tax-ui.mjs','text/javascript'],'/onboarding.js':['onboarding.js','text/javascript'],'/email-model.mjs':['email-model.mjs','text/javascript'],'/transaction-links.mjs':['transaction-links.mjs','text/javascript'],'/credit-model.mjs':['credit-model.mjs','text/javascript'],'/bank-activity.mjs':['bank-activity.mjs','text/javascript'],'/tabs.js':['tabs.js','text/javascript'],'/tabs.css':['tabs.css','text/css'],'/income-model.mjs':['income-model.mjs','text/javascript'],'/classic.js':['classic.js','text/javascript'],'/classic.css':['classic.css','text/css'],'/classic-theme.js':['classic-theme.js','text/javascript'],'/classic-events.js':['classic-events.js','text/javascript'],'/classic-migrate.mjs':['classic-migrate.mjs','text/javascript'],'/connections.js':['connections.js','text/javascript'],'/connections.css':['connections.css','text/css'],'/purify.min.js':['purify.min.js','text/javascript'],'/setup-key.html':['setup-key.html','text/html'],'/setup-key.mjs':['setup-key.mjs','text/javascript'],'/':['index.html','text/html'],'/plaid-return':['index.html','text/html'],'/index.html':['index.html','text/html'],'/style.css':['style.css','text/css'],'/app.mjs':['app.mjs','text/javascript'],'/engine.mjs':['engine.mjs','text/javascript']};
async function handle(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 try{const u=new URL(req.url,origin),path=u.pathname;if(req.method==='GET'&&path==='/health')return json(res,200,{ok:true});
  if(req.method==='GET'&&path==='/api/config')return json(res,200,{authenticated:authenticated(req),accountId:authenticated(req)?users.current().accountId:null,email:authenticated(req)?users.current().email:null,googleConfigured,plaidConfigured:!!(process.env.PLAID_CLIENT_ID&&process.env.PLAID_SECRET),plaidEnvironment:process.env.PLAID_ENV||'sandbox'});
  if(req.method==='GET'&&path==='/auth/google'){
   if(!googleConfigured)return json(res,503,{error:'Configure Google credentials, ALLOWED_EMAIL, APP_URL and DATA_KEY on the server first.'});const gmail=u.searchParams.has('gmail');if(gmail&&!authenticated(req))return redirect(res,'/auth/google');if(gmail&&sessionMismatch(users.current(),u.searchParams.get('account'),'POST'))return json(res,409,{error:'Your BearDen account changed. Reload before adding Gmail.'});
   db.prepare('DELETE FROM oauth WHERE expires < ?').run(Date.now());const state=random(),verifier=random();db.prepare('INSERT INTO oauth VALUES(?,?,?,?)').run(hash(state),encrypt(gmail?{verifier,ownerSession:hash(cookies(req).bearden)}:verifier),gmail?1:0,Date.now()+600000);
   const params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/auth/google/callback',response_type:'code',scope:'openid email'+(gmail?' https://www.googleapis.com/auth/gmail.readonly':''),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:gmail?'consent select_account':'select_account'});return redirect(res,'https://accounts.google.com/o/oauth2/v2/auth?'+params,{'Set-Cookie':cookie('bearden_oauth',state,600)});
  }
  if(req.method==='GET'&&path==='/auth/google/callback'){
   const state=u.searchParams.get('state')||'',binding=cookies(req).bearden_oauth;if(!binding||binding!==state)return json(res,400,{error:'Invalid sign-in state. Start sign-in again.'});const record=db.prepare('SELECT * FROM oauth WHERE hash=?').get(hash(state));db.prepare('DELETE FROM oauth WHERE hash=?').run(hash(state));if(!record||record.expires<Date.now()||!u.searchParams.get('code'))return json(res,400,{error:'Sign-in cancelled or expired. Start again.'});
   const proof=decrypt(record.verifier);if(record.gmail&&(!authenticated(req)||proof.ownerSession!==hash(cookies(req).bearden||'')))return json(res,403,{error:'Sign in to your BearDen account before adding Gmail.'});
   const token=await googleToken({grant_type:'authorization_code',code:u.searchParams.get('code'),redirect_uri:origin+'/auth/google/callback',code_verifier:typeof proof==='string'?proof:proof.verifier}),user=await request('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});
   if(!user.email_verified)return json(res,403,{error:'Google must verify your email before signing in.'});
   if(record.gmail){if(!token.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')||!token.refresh_token)throw Error('Gmail read-only and offline access were not granted. Reconnect and allow Gmail access.');if(runningSync())await runningSync();const c=connections();connectMailbox(c,user,token.refresh_token,users.current().email);write('connections',c);}
   if(record.gmail)return redirect(res,'/?connected=1',{'Set-Cookie':cookie('bearden_oauth','',0)});
   db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());const identity=googleIdentity(user,allowed),session='v2.'+random();rawWrite('auth-session:'+hash(session),identity);rawWrite('user-index:'+identity.accountId,{...rawRead('user-index:'+identity.accountId,{lastSync:0}),...identity});db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(session),Date.now()+7*86400000);return redirect(res,'/?connected=1',{'Set-Cookie':[cookie('bearden',session,7*86400),cookie('bearden_oauth','',0)]});
  }
  if(path.startsWith('/api/')){
   if(!authenticated(req))return json(res,401,{error:'Sign in to access private data.'});if(sessionMismatch(users.current(),req.headers['x-bearden-account'],req.method))return json(res,409,{error:'The signed-in account changed. Reload before continuing; your edits have not been saved to the other account.'});if(req.method==='POST'&&req.headers.origin!==origin)return json(res,403,{error:'Request origin does not match this server.'});
   if(req.method==='GET'&&path==='/api/income/baby-bear'){const preset=read('income-shortcut',null)||incomeFromTracker(read('classic',{}).state)||incomeFromPlan(getPlan().state);return preset?json(res,200,preset):json(res,404,{error:'Set your income in the Income tab once to save your Baby Bear income shortcut.'});}
   if(path==='/api/import/baby-bear')return json(res,410,{error:'Preset account imports have been retired. Use Accounts or the income-only shortcut.'});
   if(req.method==='GET'&&path==='/api/classic')return json(res,200,read('classic',{state:{version:1,values:{}},revision:0}));
   if(req.method==='GET'&&path==='/api/state')return json(res,200,{...getPlan(),connections:publicConnections(connections())});
   if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});const b=await body(req);
   if(path==='/api/classic'){const state=validateClassic(b.state),current=read('classic',{revision:0});if(current.revision!==b.revision)return json(res,409,{error:'The tracker changed in another tab. Reload before editing again.'});write('classic',{state,revision:current.revision+1});if(!read('income-shortcut',null)){const preset=incomeFromTracker(state)||incomeFromPlan(getPlan().state);if(preset)write('income-shortcut',preset);}return json(res,200,{revision:current.revision+1});}
   if(path==='/api/state'){const s=validate(b.state),p=getPlan();if(p.revision!==b.revision)return json(res,409,{error:'This plan changed during sync or in another tab. Reload before editing again.'});if(s.emailSenders.some(x=>!/^[-\w.+]+@[\w.-]+\.[a-z]{2,}$/i.test(x)))throw Error('Use full sender email addresses');write('plan',{state:s,revision:p.revision+1});return json(res,200,{revision:p.revision+1});}
   if(path==='/api/logout'){db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(cookies(req).bearden));res.setHeader('Set-Cookie',cookie('bearden','',0));return json(res,200,{ok:true});}
   if(path==='/api/bank/refresh'){if(runningSync())await runningSync();const c=await sync(true);return json(res,200,{status:c.status});}
   if(path==='/api/sync'){const c=await sync();return json(res,200,{status:c.status});}
   if(path==='/api/plaid/link'){const c=connections(),item=c.items.find(i=>i.id===b.itemId);const d=await plaid('/link/token/create',{user:{client_user_id:hash(users.current().scope||allowed)},client_name:'BearDen',...creditLinkOptions(b,item),country_codes:['US'],language:'en',...(process.env.PLAID_REDIRECT_URI?{redirect_uri:process.env.PLAID_REDIRECT_URI}:{})});return json(res,200,{link_token:d.link_token});}
   if(path==='/api/plaid/exchange'){if(typeof b.public_token!=='string')throw Error('Missing public token');const d=await plaid('/item/public_token/exchange',{public_token:b.public_token});if(runningSync())await runningSync();const c=connections();if(!c.items.some(i=>i.id===d.item_id)){c.items.push({id:d.item_id,token:d.access_token,cursor:'',name:String(b.name||'Bank').slice(0,150),liabilities:b.kind==='credit'});write('connections',c);}await sync();return json(res,200,{ok:true});}
   if(path==='/api/plaid/updated'||path==='/api/cards/refresh'){if(runningSync())await runningSync();const c=connections(),item=c.items.find(i=>i.id===b.itemId);if(!item)return json(res,404,{error:'Bank connection not found'});if(path==='/api/plaid/updated')item.liabilities=true;await syncCredit(c,item,plaid,true);write('connections',c);const result=await sync(true);return json(res,200,{status:result.status});}
   if(path==='/api/plaid/disconnect'){if(runningSync())await runningSync();let c=connections();const item=c.items.find(i=>i.id===b.id);if(!item)return json(res,404,{error:'Bank not found'});await plaid('/item/remove',{access_token:item.token});if(runningSync())await runningSync();c=connections();c.items=c.items.filter(i=>i.id!==b.id);c.transactions=c.transactions.filter(t=>t.itemId!==b.id);c.creditCards=(c.creditCards||[]).filter(card=>card.itemId!==b.id);write('connections',c);updatePlan(s=>{s.accounts=s.accounts.filter(a=>a.itemId!==b.id);});return json(res,200,{ok:true});}
   if(path==='/api/gmail/message'){
    if(runningSync())await runningSync();const c=connections();let message;
    syncs.set(users.current().accountId,(async()=>{message=await refreshSelectedEmail(c,b,{request,googleToken,owner:users.current().email});write('connections',c);})().finally(()=>syncs.delete(users.current().accountId)));await runningSync();return json(res,200,{message});
   }
   if(path==='/api/gmail/search'){
    if(typeof b.query!=='string'||b.query.length>100)throw Error('Use a merchant name of up to 100 characters.');if(runningSync())await runningSync();
    const c=connections();syncs.set(users.current().accountId,(async()=>{for(const account of mailboxes(c,users.current().email)){try{await syncMailbox(c,account,b.query);}catch(e){account.status='Gmail needs attention: '+e.message;}}write('connections',c);})().finally(()=>syncs.delete(users.current().accountId)));await runningSync();return json(res,200,publicMail(c,users.current().email));
   }
   if(path==='/api/gmail/disconnect'){
    if(runningSync())await runningSync();const c=connections(),accounts=mailboxes(c,users.current().email),id=b.id||(accounts.length===1?accounts[0].id:null),account=accounts.find(a=>a.id===id);if(!account)return json(res,400,{error:'Choose the Gmail account to disconnect.'});
    const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:account.refreshToken}),signal:AbortSignal.timeout(25000)});if(!r.ok&&r.status!==400)throw Error('Could not revoke Google access; try again');forgetMailbox(c,id,users.current().email);write('connections',c);return json(res,200,{ok:true});
   }
   if(path==='/api/candidate/dismiss'){if(runningSync())await runningSync();const c=connections(),candidate=c.candidates.find(x=>x.id===b.id);if(candidate)candidate.dismissed=true;write('connections',c);return json(res,200,{ok:true});}
   return json(res,404,{error:'Not found'});
  }
  if(req.method==='GET'&&staticFiles[path]){const [file,type]=staticFiles[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(readFileSync(resolve(root,'public',file)));}
  return json(res,404,{error:'Not found'});
 }catch(e){/* Deliberately exclude request bodies, provider payloads, and tokens from logs. */json(res,400,{error:e.message||'Request failed'});}
}
const server=http.createServer((req,res)=>users.run(sessionIdentity(req),()=>handle(req,res)));
server.listen(port,()=>console.log('BearDen listening on port '+port+' ('+(googleConfigured?'secure connections configured':'manual mode')+')'));
// An always-on single server is required. Sync continues with no browser open.
const timer=setInterval(()=>{if(!googleConfigured)return;const profiles=db.prepare("SELECT value FROM vault WHERE id LIKE 'user-index:%'").all().map(r=>decrypt(r.value));if(!profiles.some(p=>!p.scope))profiles.push(users.legacy);for(const profile of profiles)users.run(profile,()=>{const c=connections();if(c.lastAttempt&&Date.now()-Date.parse(c.lastAttempt)<6*3600000)return;if(mailboxes(c,users.current().email).length||c.items.length)sync().catch(()=>console.error('Background sync failed; check provider setup.'));});},60000);timer.unref();
process.on('SIGTERM',()=>{clearInterval(timer);server.close(()=>{db.close();process.exit(0);});});

