import http from 'node:http';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {blank,validate,cents} from './public/engine.mjs';
import {request,plaid,transactionSync,applyTransactions,messageText,parseBill} from './providers.mjs';

const root=dirname(fileURLToPath(import.meta.url)),port=Number(process.env.PORT||3000),origin=new URL(process.env.APP_URL||`http://localhost:${port}`).origin,secure=origin.startsWith('https:'),allowed=process.env.ALLOWED_EMAIL?.toLowerCase(),key=process.env.DATA_KEY?Buffer.from(process.env.DATA_KEY,'base64'):null;
if(key&&key.length!==32)throw Error('DATA_KEY must be 32 random bytes in base64');
if(process.env.NODE_ENV==='production'&&(!key||!secure||!allowed||!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET))throw Error('Production requires DATA_KEY, HTTPS APP_URL, ALLOWED_EMAIL, and Google credentials');
const googleConfigured=!!(key&&allowed&&process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET),dataDir=process.env.DATA_DIR||resolve(root,'data');mkdirSync(dataDir,{recursive:true,mode:0o700});
const db=new DatabaseSync(resolve(dataDir,'bearden.sqlite'));db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS vault (id TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS oauth (hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, gmail INTEGER NOT NULL, expires INTEGER NOT NULL);');
const hash=s=>createHash('sha256').update(s).digest('hex'),random=()=>randomBytes(32).toString('base64url');
function encrypt(value){if(!key)throw Error('Storage key missing');const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64');}
function decrypt(value){const b=Buffer.from(value,'base64'),c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([c.update(b.subarray(28)),c.final()]).toString());}
function read(id,fallback){const r=db.prepare('SELECT value FROM vault WHERE id=?').get(id);return r?decrypt(r.value):fallback;}
function write(id,data){db.prepare('INSERT INTO vault(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(id,encrypt(data));}
function getPlan(){return read('plan',{state:blank(),revision:0});}
function updatePlan(fn){const p=getPlan();fn(p.state);p.revision++;write('plan',p);return p;}
function connections(){return read('connections',{items:[],transactions:[],candidates:[],seen:[],gmail:null,status:'No connections yet.'});}
function publicConnections(c){return {...c,gmail:!!c.gmail,items:c.items.map(i=>({id:i.id,name:i.name})),seen:undefined,transactions:c.transactions.slice(0,100)};}
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
function authenticated(req){const s=cookies(req).bearden;if(!s)return false;const r=db.prepare('SELECT expires FROM sessions WHERE hash=?').get(hash(s));return !!r&&r.expires>Date.now();}
function cookie(name,value,seconds){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${secure?'; Secure':''}`;}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}
function redirect(res,path,headers={}){res.writeHead(302,{Location:path,...headers});res.end();}
async function body(req){let n=0,parts=[];for await(const p of req){n+=p.length;if(n>1000000)throw Error('Request too large');parts.push(p);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
async function googleToken(params){return request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,...params})});}
let syncing=null;
async function doSync(){
 let c=connections(),errors=[],now=new Date().toISOString();
 for(const item of c.items){try{const synced=await transactionSync(item),accounts=await plaid('/accounts/get',{access_token:item.token});c.transactions=applyTransactions(c.transactions,synced.changes,item.id);item.cursor=synced.cursor;
  updatePlan(s=>{const activeIds=new Set(accounts.accounts.map(a=>'plaid-'+a.account_id));s.accounts=s.accounts.filter(a=>a.itemId!==item.id||activeIds.has(a.id));for(const a of accounts.accounts){const id='plaid-'+a.account_id,old=s.accounts.find(x=>x.id===id),balance=a.balances.available??a.balances.current;if(balance===null)continue;const eligible=a.type==='depository'&&a.subtype==='checking'&&a.balances.iso_currency_code==='USD';const entry={id,itemId:item.id,name:a.name+(a.mask?' •'+a.mask:''),balance:cents(balance),include:eligible?(old?.include??true):false,source:'plaid',currency:a.balances.iso_currency_code};if(old)Object.assign(old,entry);else s.accounts.push(entry);}});c.bankUpdated=now;
 }catch(e){errors.push(`${item.name}: ${e.message}`);}}
 if(c.gmail){try{const token=await googleToken({grant_type:'refresh_token',refresh_token:c.gmail.refreshToken}),senders=getPlan().state.emailSenders;
  if(!senders.length)errors.push('Gmail: add bill sender addresses in Settings');else{const query=`newer_than:90d {${senders.map(s=>'from:'+s).join(' ')}}`,headers={Authorization:'Bearer '+token.access_token},seen=new Set(c.seen);let pageToken='',scanned=0;do{const q=new URLSearchParams({q:query,maxResults:'50'});if(pageToken)q.set('pageToken',pageToken);const page=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+q,{headers});for(const m of page.messages||[]){if(seen.has(m.id))continue;const msg=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(m.id)+'?format=full',{headers});const header=name=>msg.payload?.headers?.find(h=>h.name.toLowerCase()===name)?.value||'',from=header('from'),address=(from.match(/<([^>]+)>/)?.[1]||from).trim().toLowerCase();seen.add(m.id);if(!senders.some(s=>s.toLowerCase()===address))continue;const text=messageText(msg.payload);c.candidates.push({id:m.id,sender:address,subject:header('subject').slice(0,300),snippet:(msg.snippet||'').slice(0,350),...parseBill(text)});scanned++;}pageToken=page.nextPageToken||'';if(scanned>=200&&pageToken){errors.push('Gmail: more messages remain; run another sync');break;}}while(pageToken);c.seen=[...seen];c.gmailUpdated=now;}
 }catch(e){errors.push('Gmail: '+e.message+'; reconnect if authorization expired');}}
 c.status=errors.length?'Sync needs attention — '+errors.join(' · '):'Last sync: '+now;c.lastAttempt=now;write('connections',c);return c;
}
async function sync(){if(!syncing)syncing=doSync().finally(()=>syncing=null);return syncing;}
const staticFiles={'/':['index.html','text/html'],'/plaid-return':['index.html','text/html'],'/index.html':['index.html','text/html'],'/style.css':['style.css','text/css'],'/app.mjs':['app.mjs','text/javascript'],'/engine.mjs':['engine.mjs','text/javascript']};
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 try{const u=new URL(req.url,origin),path=u.pathname;if(req.method==='GET'&&path==='/health')return json(res,200,{ok:true});
  if(req.method==='GET'&&path==='/api/config')return json(res,200,{authenticated:authenticated(req),googleConfigured,plaidConfigured:!!(process.env.PLAID_CLIENT_ID&&process.env.PLAID_SECRET),plaidEnvironment:process.env.PLAID_ENV||'sandbox'});
  if(req.method==='GET'&&path==='/auth/google'){
   if(!googleConfigured)return json(res,503,{error:'Configure Google credentials, ALLOWED_EMAIL, APP_URL and DATA_KEY on the server first.'});const gmail=u.searchParams.has('gmail');if(gmail&&!authenticated(req))return redirect(res,'/auth/google');
   db.prepare('DELETE FROM oauth WHERE expires < ?').run(Date.now());const state=random(),verifier=random();db.prepare('INSERT INTO oauth VALUES(?,?,?,?)').run(hash(state),encrypt(verifier),gmail?1:0,Date.now()+600000);
   const params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/auth/google/callback',response_type:'code',scope:'openid email'+(gmail?' https://www.googleapis.com/auth/gmail.readonly':''),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:gmail?'consent':'select_account'});return redirect(res,'https://accounts.google.com/o/oauth2/v2/auth?'+params,{'Set-Cookie':cookie('bearden_oauth',state,600)});
  }
  if(req.method==='GET'&&path==='/auth/google/callback'){
   const state=u.searchParams.get('state')||'',binding=cookies(req).bearden_oauth;if(!binding||binding!==state)return json(res,400,{error:'Invalid sign-in state. Start sign-in again.'});const record=db.prepare('SELECT * FROM oauth WHERE hash=?').get(hash(state));db.prepare('DELETE FROM oauth WHERE hash=?').run(hash(state));if(!record||record.expires<Date.now()||!u.searchParams.get('code'))return json(res,400,{error:'Sign-in cancelled or expired. Start again.'});
   const token=await googleToken({grant_type:'authorization_code',code:u.searchParams.get('code'),redirect_uri:origin+'/auth/google/callback',code_verifier:decrypt(record.verifier)}),user=await request('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});
   if(!user.email_verified||user.email?.toLowerCase()!==allowed)return json(res,403,{error:'This BearDen is restricted to its owner.'});
   if(record.gmail){if(!token.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')||!token.refresh_token)throw Error('Gmail read-only and offline access were not granted. Reconnect and allow Gmail access.');if(syncing)await syncing;const c=connections();c.gmail={refreshToken:token.refresh_token};write('connections',c);}
   db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());const session=random();db.prepare('INSERT INTO sessions VALUES(?,?)').run(hash(session),Date.now()+7*86400000);return redirect(res,'/?connected=1',{'Set-Cookie':[cookie('bearden',session,7*86400),cookie('bearden_oauth','',0)]});
  }
  if(path.startsWith('/api/')){
   if(!authenticated(req))return json(res,401,{error:'Sign in to access private data.'});if(req.method==='POST'&&req.headers.origin!==origin)return json(res,403,{error:'Request origin does not match this server.'});
   if(req.method==='GET'&&path==='/api/state')return json(res,200,{...getPlan(),connections:publicConnections(connections())});
   if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});const b=await body(req);
   if(path==='/api/state'){const s=validate(b.state),p=getPlan();if(p.revision!==b.revision)return json(res,409,{error:'This plan changed during sync or in another tab. Export your edits, then reload before saving again.'});if(s.emailSenders.some(x=>!/^[-\w.+]+@[\w.-]+\.[a-z]{2,}$/i.test(x)))throw Error('Use full sender email addresses');write('plan',{state:s,revision:p.revision+1});return json(res,200,{revision:p.revision+1});}
   if(path==='/api/logout'){db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(cookies(req).bearden));res.setHeader('Set-Cookie',cookie('bearden','',0));return json(res,200,{ok:true});}
   if(path==='/api/sync'){const c=await sync();return json(res,200,{status:c.status});}
   if(path==='/api/plaid/link'){const d=await plaid('/link/token/create',{user:{client_user_id:hash(allowed)},client_name:'BearDen',products:['transactions'],country_codes:['US'],language:'en',...(process.env.PLAID_REDIRECT_URI?{redirect_uri:process.env.PLAID_REDIRECT_URI}:{})});return json(res,200,{link_token:d.link_token});}
   if(path==='/api/plaid/exchange'){if(typeof b.public_token!=='string')throw Error('Missing public token');const d=await plaid('/item/public_token/exchange',{public_token:b.public_token});if(syncing)await syncing;const c=connections();if(!c.items.some(i=>i.id===d.item_id)){c.items.push({id:d.item_id,token:d.access_token,cursor:'',name:String(b.name||'Bank').slice(0,150)});write('connections',c);}await sync();return json(res,200,{ok:true});}
   if(path==='/api/plaid/disconnect'){if(syncing)await syncing;let c=connections();const item=c.items.find(i=>i.id===b.id);if(!item)return json(res,404,{error:'Bank not found'});await plaid('/item/remove',{access_token:item.token});if(syncing)await syncing;c=connections();c.items=c.items.filter(i=>i.id!==b.id);c.transactions=c.transactions.filter(t=>t.itemId!==b.id);write('connections',c);updatePlan(s=>{s.accounts=s.accounts.filter(a=>a.itemId!==b.id);});return json(res,200,{ok:true});}
   if(path==='/api/gmail/disconnect'){if(syncing)await syncing;let c=connections();if(c.gmail){const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:c.gmail.refreshToken}),signal:AbortSignal.timeout(25000)});if(!r.ok&&r.status!==400)throw Error('Could not revoke Google access; try again');}if(syncing)await syncing;c=connections();c.gmail=null;c.candidates=[];c.seen=[];write('connections',c);return json(res,200,{ok:true});}
   if(path==='/api/candidate/dismiss'){if(syncing)await syncing;const c=connections(),candidate=c.candidates.find(x=>x.id===b.id);if(candidate)candidate.dismissed=true;write('connections',c);return json(res,200,{ok:true});}
   return json(res,404,{error:'Not found'});
  }
  if(req.method==='GET'&&staticFiles[path]){const [file,type]=staticFiles[path];res.writeHead(200,{'Content-Type':type+'; charset=utf-8'});return res.end(readFileSync(resolve(root,'public',file)));}
  return json(res,404,{error:'Not found'});
 }catch(e){/* Deliberately exclude request bodies, provider payloads, and tokens from logs. */json(res,400,{error:e.message||'Request failed'});}
});
server.listen(port,()=>console.log('BearDen listening on port '+port+' ('+(googleConfigured?'secure connections configured':'manual mode')+')'));
// An always-on single server is required. Sync continues with no browser open.
const timer=setInterval(()=>{if(!googleConfigured)return;const c=connections();if(c.lastAttempt&&Date.now()-Date.parse(c.lastAttempt)<6*3600000)return;if(c.gmail||c.items.length)sync().catch(()=>console.error('Background sync failed; check provider setup.'));},60000);timer.unref();
process.on('SIGTERM',()=>{clearInterval(timer);server.close(()=>{db.close();process.exit(0);});});
