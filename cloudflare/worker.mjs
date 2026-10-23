// Serverless adapter. No persistent process, local disk, or paid Worker features.
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {blank,validate,cents} from '../public/engine.mjs';
import {classifyBillEmail,billMailQuery,messageText,applyTransactions} from '../providers.mjs';

const random=()=>randomBytes(32).toString('base64url'),hash=s=>createHash('sha256').update(s).digest('hex');
const sixHours=6*3600000;
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
 'Content-Security-Policy':"default-src 'self'; script-src 'self' https://cdn.plaid.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.plaid.com; frame-src https://*.plaid.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json'}});}
function cookie(name,value,seconds){return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${seconds}`;}
function cookies(req){return Object.fromEntries((req.headers.get('cookie')||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
function redirect(path,setCookies=[]){const h=new Headers({...headers,Location:path});for(const c of setCookies)h.append('Set-Cookie',c);return new Response(null,{status:302,headers:h});}
async function body(req){if(!req.headers.get('content-type')?.startsWith('application/json'))throw Error('Expected JSON');let length=0,parts=[];for await(const chunk of req.body||[]){length+=chunk.length;if(length>250000)throw Error('Plan/request exceeds 250 KB');parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
export function runtime(env,fetcher=fetch){
 const key=env.DATA_KEY?Buffer.from(env.DATA_KEY,'base64'):null,origin=env.APP_URL?new URL(env.APP_URL).origin:null,owner=env.ALLOWED_EMAIL?.toLowerCase();
 const configured=!!(env.DB&&key?.length===32&&origin?.startsWith('https:')&&owner&&env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET);
 const run=(sql,...args)=>env.DB.prepare(sql).bind(...args).run(),first=(sql,...args)=>env.DB.prepare(sql).bind(...args).first();
 function encrypt(value){if(key?.length!==32)throw Error('Configure a 32-byte DATA_KEY');const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,cipher.update(Buffer.from(JSON.stringify(value),'utf8')),cipher.final(),cipher.getAuthTag()]).toString('base64');}
 function decrypt(value){const b=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));cipher.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString());}
 async function read(id,fallback){const r=await first('SELECT value FROM vault WHERE id=?',id);return r?decrypt(r.value):fallback;}
 const write=(id,value)=>run('INSERT INTO vault VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',id,encrypt(value));
 const plan=()=>read('plan',{state:blank(),revision:0});
 const connections=()=>read('connections',{items:[],transactions:[],candidates:[],gmail:null,status:'No connections yet.'});
 async function updatePlan(fn){const p=await plan();fn(p.state);p.revision++;await write('plan',p);return p;}
 async function authorized(req){if(!configured)return false;const token=cookies(req).bearden;if(!token)return false;const s=await first('SELECT expires FROM sessions WHERE hash=?',hash(token));return !!s&&s.expires>Date.now();}
 async function locked(fn){const id=random(),now=Date.now();const r=await run("INSERT INTO locks VALUES('sync',?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires < ?",id,now+300000,now);if(!r.meta?.changes)throw Error('A sync or save is already running. Try again in a moment.');try{return await fn();}finally{await run("DELETE FROM locks WHERE id='sync' AND owner=?",id);}}
 async function request(url,options={}){const r=await fetcher(url,{...options,signal:AbortSignal.timeout(15000)});let d;try{d=await r.json();}catch{throw Error('Provider response unreadable');}if(!r.ok){const error=Error(d.error_code||d.error?.status||'Provider request failed ('+r.status+')');error.code=d.error_code;throw error;}return d;}
 async function plaid(path,data){if(!env.PLAID_CLIENT_ID||!env.PLAID_SECRET)throw Error('Plaid is not configured');const mode=env.PLAID_ENV||'sandbox';if(!['sandbox','production'].includes(mode))throw Error('Invalid Plaid environment');return request(`https://${mode}.plaid.com${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:env.PLAID_CLIENT_ID,secret:env.PLAID_SECRET,...data})});}
 const googleToken=data=>request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...data})});
 function publicConnections(c){return {items:c.items.map(i=>({id:i.id,name:i.name})),transactions:c.transactions.slice(0,100),candidates:c.candidates.filter(x=>!x.dismissed),gmail:!!c.gmail,bankUpdated:c.bankUpdated,gmailUpdated:c.gmailUpdated,status:c.status};}
 async function syncBank(c,item){
  // One page per invocation, with a staged snapshot. Never commit a partial cursor.
  if(!item.pending)item.pending={original:item.cursor||'',cursor:item.cursor||'',transactions:c.transactions.filter(t=>t.itemId===item.id)};
  try{const page=await plaid('/transactions/sync',{access_token:item.token,cursor:item.pending.cursor,count:100});item.pending.transactions=applyTransactions(item.pending.transactions,[page],item.id).slice(0,200);item.pending.cursor=page.next_cursor;
   if(page.has_more)return 'Bank history is loading in small batches. Next step within 15 minutes.';
   const accounts=await plaid('/accounts/get',{access_token:item.token});
   await updatePlan(s=>{const active=new Set(accounts.accounts.map(a=>'plaid-'+a.account_id));s.accounts=s.accounts.filter(a=>a.itemId!==item.id||active.has(a.id));for(const a of accounts.accounts){const balance=a.balances.available??a.balances.current;if(balance===null)continue;const id='plaid-'+a.account_id,old=s.accounts.find(x=>x.id===id),eligible=a.type==='depository'&&a.subtype==='checking'&&a.balances.iso_currency_code==='USD',entry={id,itemId:item.id,name:a.name+(a.mask?' •'+a.mask:''),balance:cents(balance),include:eligible?(old?.include??true):false,source:'plaid',currency:a.balances.iso_currency_code};if(old)Object.assign(old,entry);else s.accounts.push(entry);}});
   c.transactions=[...c.transactions.filter(t=>t.itemId!==item.id),...item.pending.transactions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,1000);item.cursor=item.pending.cursor;delete item.pending;item.nextSync=Date.now()+sixHours;c.bankUpdated=new Date().toISOString();return item.name+' synced. Scheduled again in about 6 hours.';
  }catch(e){if(e.code==='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')delete item.pending;item.nextSync=Date.now()+900000;throw e;}
 }
 async function syncGmail(c){
  const signature='automatic-bills-v1';if(c.gmail.signature!==signature){c.gmail.signature=signature;delete c.gmail.page;delete c.gmail.backlog;}
  const token=await googleToken({grant_type:'refresh_token',refresh_token:c.gmail.refreshToken}),h={Authorization:'Bearer '+token.access_token};
  if(!c.gmail.backlog?.length){const q=new URLSearchParams({q:billMailQuery,maxResults:'10'});if(c.gmail.page)q.set('pageToken',c.gmail.page);const page=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+q,{headers:h});c.gmail.backlog=(page.messages||[]).map(m=>m.id);c.gmail.page=page.nextPageToken||'';}
  // Up to three messages keeps external and database subrequests below the Free limit.
  for(let i=0;i<3&&c.gmail.backlog.length;i++){const id=c.gmail.backlog[0];if(!await first('SELECT id FROM mail_seen WHERE id=?',hash(signature+'|'+id))){
    const msg=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(id)+'?format=full',{headers:h}),header=n=>msg.payload?.headers?.find(h=>h.name.toLowerCase()===n)?.value||'',from=header('from');
    const result=classifyBillEmail({id,from,subject:header('subject'),snippet:msg.snippet||'',text:messageText(msg.payload).slice(0,32000)});
    if(result.action==='add'){
     const p=await plan();
     if(!p.state.bills.some(b=>b.sourceId===id||b.sourceKey===result.bill.sourceKey)){
      if(p.state.bills.length>=1000)throw Error('Bill storage is full. Export and remove old bills before continuing.');
      p.state.bills.push(result.bill);validate(p.state);if(JSON.stringify(p.state).length>240000)throw Error('Plan storage is full. Export and remove old records before continuing.');p.revision++;await write('plan',p);
     }
     c.candidates=c.candidates.filter(x=>x.id!==id);
    }else if(result.action==='review'&&!c.candidates.some(x=>x.id===id)){
     if(c.candidates.length>=100)throw Error('Review or dismiss unclear emails to make room for more. Automatic scanning will resume.');
     c.candidates.push(result.candidate);await write('connections',c);
    }
   }await run('INSERT OR IGNORE INTO mail_seen VALUES(?,?)',hash(signature+'|'+id),Date.now());c.gmail.backlog.shift();}
  c.gmailUpdated=new Date().toISOString();const more=c.gmail.backlog.length||c.gmail.page;c.gmail.nextSync=more?0:Date.now()+sixHours;
  return more?'Email batch scanned; clear bills added automatically. More emails will be checked on the next scheduled run.':'Gmail checked; clear bills added automatically. Only unclear emails need review. Next check in about 6 hours.';
 }
 async function sync(force=false){return locked(async()=>{const c=await connections(),now=Date.now(),bank=c.items.find(i=>i.pending||!i.nextSync||i.nextSync<=now)||(force?c.items[0]:null),gmail=c.gmail&&(force||c.gmail.backlog?.length||c.gmail.page||!c.gmail.nextSync||c.gmail.nextSync<=now);
   if(!bank&&!gmail)return {status:c.status};try{if(gmail&&(!bank||c.lastTask==='bank')){c.lastTask='gmail';c.status=await syncGmail(c);}else{c.lastTask='bank';c.status=await syncBank(c,bank);}}catch(e){c.status='Sync needs attention: '+e.message;if(c.lastTask==='gmail'&&c.gmail)c.gmail.nextSync=now+sixHours;}
   c.lastAttempt=new Date().toISOString();c.candidates=c.candidates.filter(x=>!x.dismissed);await write('connections',c);return {status:c.status};});}
 async function handle(req){
  const u=new URL(req.url),path=u.pathname;
  if(path==='/health')return json({ok:true,hosting:'cloudflare-free',configured});
  if(path==='/api/config'&&req.method==='GET')return json({authenticated:await authorized(req),googleConfigured:configured,plaidConfigured:!!(env.PLAID_CLIENT_ID&&env.PLAID_SECRET),plaidEnvironment:env.PLAID_ENV||'sandbox',syncDescription:'scheduled in small batches; completed connections refresh about every 6 hours'});
  if(path==='/auth/google'&&req.method==='GET'){
   if(!configured)return json({error:'Configure Cloudflare D1 and the Google/owner/encryption secrets first.'},503);const gmail=u.searchParams.has('gmail');if(gmail&&!await authorized(req))return redirect('/auth/google');
   const state=random(),verifier=random();await run('DELETE FROM oauth WHERE expires < ?',Date.now());await run('INSERT INTO oauth VALUES(?,?,?,?)',hash(state),encrypt(verifier),gmail?1:0,Date.now()+600000);
   const q=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:origin+'/auth/google/callback',response_type:'code',scope:'openid email'+(gmail?' https://www.googleapis.com/auth/gmail.readonly':''),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:gmail?'consent':'select_account'});return redirect('https://accounts.google.com/o/oauth2/v2/auth?'+q,[cookie('bearden_oauth',state,600)]);
  }
  if(path==='/auth/google/callback'&&req.method==='GET'){
   if(!configured)return json({error:'Server setup incomplete'},503);const state=u.searchParams.get('state')||'';if(!state||cookies(req).bearden_oauth!==state)return json({error:'Invalid sign-in state. Start again.'},400);
   // DELETE RETURNING consumes the state atomically across Worker instances.
   const record=await first('DELETE FROM oauth WHERE hash=? RETURNING *',hash(state));if(!record||record.expires<Date.now()||!u.searchParams.get('code'))return json({error:'Sign-in cancelled or expired'},400);
   const token=await googleToken({grant_type:'authorization_code',code:u.searchParams.get('code'),redirect_uri:origin+'/auth/google/callback',code_verifier:decrypt(record.verifier)}),user=await request('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});
   if(!user.email_verified||user.email?.toLowerCase()!==owner)return json({error:'This BearDen is restricted to its owner.'},403);
   if(record.gmail){if(!token.scope?.split(' ').includes('https://www.googleapis.com/auth/gmail.readonly')||!token.refresh_token)throw Error('Gmail read-only/offline access was not granted. Reconnect.');await locked(async()=>{const c=await connections();c.gmail={refreshToken:token.refresh_token};await write('connections',c);});}
   const session=random();await run('DELETE FROM sessions WHERE expires < ?',Date.now());await run('INSERT INTO sessions VALUES(?,?)',hash(session),Date.now()+7*86400000);return redirect('/?connected=1',[cookie('bearden',session,7*86400),cookie('bearden_oauth','',0)]);
  }
  if(path.startsWith('/api/')){
   if(!await authorized(req))return json({error:'Sign in to access private data.'},401);
   if(req.method==='GET'&&path==='/api/state')return json({...await plan(),connections:publicConnections(await connections())});
   if(req.method!=='POST')return json({error:'Method not allowed'},405);if(req.headers.get('origin')!==origin)return json({error:'Request origin does not match this server'},403);const b=await body(req);
   if(path==='/api/logout'){await run('DELETE FROM sessions WHERE hash=?',hash(cookies(req).bearden));const response=json({ok:true});response.headers.append('Set-Cookie',cookie('bearden','',0));return response;}
   if(path==='/api/sync')return json(await sync(true));
   if(path==='/api/plaid/link'){const d=await plaid('/link/token/create',{user:{client_user_id:hash(owner)},client_name:'BearDen',products:['transactions'],transactions:{days_requested:30},country_codes:['US'],language:'en',...(env.PLAID_REDIRECT_URI?{redirect_uri:env.PLAID_REDIRECT_URI}:{})});return json({link_token:d.link_token});}
   return locked(async()=>{
    if(path==='/api/state'){const state=validate(b.state);if(state.emailSenders.length>20||state.emailSenders.some(s=>!/^[-\w.+]+@[\w.-]+\.[a-z]{2,}$/i.test(s)))throw Error('Use up to 20 full sender email addresses');const current=await plan();if(current.revision!==b.revision)return json({error:'Plan changed during sync or in another tab. Export edits and reload before saving.'},409);await write('plan',{state,revision:current.revision+1});const c=await connections(),accepted=new Set(state.bills.map(b=>b.sourceId).filter(Boolean));if(c.candidates.some(x=>accepted.has(x.id))){c.candidates=c.candidates.filter(x=>!accepted.has(x.id));await write('connections',c);}return json({revision:current.revision+1});}
    if(path==='/api/plaid/exchange'){if(typeof b.public_token!=='string')throw Error('Missing public token');const c=await connections();if(c.items.length>=10)throw Error('This personal setup supports up to 10 bank connections');const d=await plaid('/item/public_token/exchange',{public_token:b.public_token});if(!c.items.some(i=>i.id===d.item_id))c.items.push({id:d.item_id,token:d.access_token,name:String(b.name||'Bank').slice(0,150),cursor:''});c.status='Bank connected. Use Sync connections or wait for the next scheduled batch.';await write('connections',c);return json({ok:true});}
    if(path==='/api/plaid/disconnect'){const c=await connections(),item=c.items.find(i=>i.id===b.id);if(!item)return json({error:'Bank not found'},404);await plaid('/item/remove',{access_token:item.token});c.items=c.items.filter(i=>i.id!==b.id);c.transactions=c.transactions.filter(t=>t.itemId!==b.id);await write('connections',c);await updatePlan(s=>{s.accounts=s.accounts.filter(a=>a.itemId!==b.id);});return json({ok:true});}
    if(path==='/api/gmail/disconnect'){const c=await connections();if(c.gmail){const r=await fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:c.gmail.refreshToken}),signal:AbortSignal.timeout(15000)});if(!r.ok&&r.status!==400)throw Error('Could not revoke Google access; try again.');}c.gmail=null;c.candidates=[];await write('connections',c);await run('DELETE FROM mail_seen');return json({ok:true});}
    if(path==='/api/candidate/dismiss'){const c=await connections();c.candidates=c.candidates.filter(x=>x.id!==b.id);await write('connections',c);return json({ok:true});}
    return json({error:'Not found'},404);
   });
  }
  if(!['GET','HEAD'].includes(req.method))return json({error:'Method not allowed'},405);
  if(!['/','/index.html','/plaid-return','/style.css','/app.mjs','/engine.mjs','/setup-key','/setup-key.html','/setup-key.mjs','/favicon.ico'].includes(path))return json({error:'Not found'},404);
  const target=new URL(req.url);if(path==='/plaid-return')target.pathname='/';const asset=await env.ASSETS.fetch(new Request(target,req)),response=new Response(asset.body,asset);for(const [k,v]of Object.entries(headers))response.headers.set(k,v);return response;
 }
 return {handle,sync,configured,encrypt,decrypt};
}
export default {
 async fetch(req,env){try{return await runtime(env).handle(req);}catch(e){return json({error:e.message||'Request failed'},400);}},
 async scheduled(_event,env,ctx){const app=runtime(env);if(app.configured)ctx.waitUntil(app.sync().catch(()=>{/* Connection errors are stored in the private status. Do not log tokens or payloads. */}));}
};

