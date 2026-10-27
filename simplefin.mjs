import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';

const day=86400000, hosts=new Set(['bridge.simplefin.org','beta-bridge.simplefin.org']);
const kinds=new Set(['unknown','credit','loan','checking','savings']);
function bridgeUrl(value,claim=false){
 let u;try{u=new URL(value);}catch{throw Error('Invalid SimpleFIN token. Create a new setup token in SimpleFIN.');}
 if(u.protocol!=='https:'||!hosts.has(u.hostname)||u.port||u.search||u.hash||
    (claim?u.username||u.password||!/^\/simplefin\/claim\/[^/]+$/.test(u.pathname):!u.username||!u.password||!/^\/simplefin\/?$/.test(u.pathname)))
  throw Error('Use a setup token from SimpleFIN Bridge.');
 return u;
}
async function fetchText(fetcher,url,options={}){
 let r;try{r=await fetcher(url,{...options,redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw Error('SimpleFIN could not be reached. Try again later.');}
 if(!r.ok){
  if(r.status===403)throw Error('SimpleFIN access was refused. Check your connection in SimpleFIN; if the setup token was already used, create a new one.');
  if(r.status===402)throw Error('Your SimpleFIN subscription needs attention. Open SimpleFIN to check it.');
  if(r.status===429)throw Error('SimpleFIN is limiting requests. Try again later.');
  throw Error('SimpleFIN returned an error ('+r.status+'). Try again later.');
 }
 const reader=r.body?.getReader();if(!reader)return '';
 let size=0,parts=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error('SimpleFIN response is too large.');}parts.push(value);}}catch{throw Error('SimpleFIN response could not be read safely.');}
 return Buffer.concat(parts).toString('utf8');
}
export async function claimSimplefin(token,fetcher=fetch){
 if(typeof token!=='string'||token.length>8192)throw Error('Paste the setup token from SimpleFIN.');
 const clean=token.trim();if(!/^[A-Za-z0-9+/]+={0,2}$/.test(clean))throw Error('Paste the setup token from SimpleFIN.');
 const claim=bridgeUrl(Buffer.from(clean,'base64').toString('utf8'),true);
 const text=await fetchText(fetcher,claim.href,{method:'POST',body:''});
 return bridgeUrl(text.trim()).href;
}
export async function fetchSimplefin(accessUrl,fetcher=fetch,{balancesOnly=false}={}){
 const u=bridgeUrl(accessUrl),auth=Buffer.from(decodeURIComponent(u.username)+':'+decodeURIComponent(u.password)).toString('base64');
 const end=Math.floor(Date.now()/1000);
 u.username='';u.password='';u.pathname=u.pathname.replace(/\/$/,'')+'/accounts';u.search=new URLSearchParams({version:'2',...(balancesOnly?{'balances-only':'1'}:{'start-date':String(end-90*86400),'end-date':String(end)})}).toString();
 const text=await fetchText(fetcher,u.href,{headers:{Authorization:'Basic '+auth,Accept:'application/json'}});
 let data;try{data=JSON.parse(text);}catch{throw Error('SimpleFIN returned an unreadable response.');}
 if(!data||!Array.isArray(data.accounts)||data.accounts.length>500)throw Error('SimpleFIN returned an invalid account list.');
 return data;
}
const amount=value=>typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&Number.isSafeInteger(Math.round(Number(value)*100))&&Math.abs(Number(value))<=1e10?Math.round(Number(value)*100):null;
const stamp=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value*1000<=Date.now()+day?new Date(value*1000).toISOString():null;
function label(value,fallback){return typeof value==='string'&&value.trim()?value.trim().slice(0,150):fallback;}
export function simplefinAccountBalance(a){
 const debt=['credit','loan'].includes(a.type),raw=a.rawBalance,include=a.type==='depository'&&a.currency==='USD'&&a.include===true;
 if(a.providerUnavailable||raw===null||!Number.isSafeInteger(raw)||debt&&!['negative','positive'].includes(a.debtSign))return {...a,balanceUnavailable:true,include};
 const balance=debt?Math.max(0,a.debtSign==='negative'?-raw:raw):a.type==='depository'?(a.rawAvailable??raw):raw;
 return {...a,balance,balanceUnavailable:!!a.providerUnavailable,include};
}
const identity=(scope,id)=>'simplefin-'+createHash('sha256').update(JSON.stringify([String(scope||''),id])).digest('hex').slice(0,32);
export const simplefinAccountId=a=>identity(a.conn_id||a.org?.id||a.org?.['sfin-url'],a.id);
// A provider can send v1 organization IDs or v2 connection IDs. Names are never
// identity: use only exact provider IDs, and never cross two logins at one bank.
function accountIdentities(data,a){
 const connection=(data.connections||[]).find(c=>a.conn_id&&c.conn_id===a.conn_id);
 const scopes=[a.org?.id,a.org?.['sfin-url'],connection?.org_id,connection?.sfin_url].filter(Boolean);
 const ambiguous=(data.accounts||[]).some(b=>b!==a&&b.id===a.id&&b.conn_id!==a.conn_id)||(data.connections||[]).some(c=>c.conn_id!==a.conn_id&&[c.org_id,c.sfin_url].some(scope=>scope&&scopes.includes(scope)));
 return [...new Set([simplefinAccountId(a),...(!ambiguous?scopes.map(scope=>identity(scope,a.id)):[])])];
}
function resolveAccount(data,a,accounts){
 let ids=accountIdentities(data,a);
 let matches=accounts.filter(old=>old.source==='simplefin'&&(!old.simplefinConnectionId||!a.conn_id||old.simplefinConnectionId===a.conn_id)&&[old.id,...(old.identityAliases||[])].some(id=>ids.includes(id)));
 if(new Set(matches.map(old=>old.simplefinConnectionId).filter(Boolean)).size>1){ids=[simplefinAccountId(a)];matches=matches.filter(old=>old.id===ids[0]);}
 // Prefer the original v1 row if a prior sync already created its v2 duplicate.
 const previous=matches.find(old=>old.id!==ids[0]&&ids.includes(old.id))||matches[0];
 return {id:previous?.id||ids[0],previous,matches,aliases:[...new Set([...ids,...matches.flatMap(old=>[old.id,...(old.identityAliases||[])])])]};
}
function accountErrors(data,account,{transactions=false}={}){
 const structured=(Array.isArray(data.errlist)?data.errlist:[]).filter(e=>e&&typeof e==='object');
 return structured.filter(e=>{
  if(!transactions&&e.code==='act.missingdata')return false; // Transaction completeness, not a balance error.
  if(String(e.code||'').split('.')[0]==='gen')return true;
  if(e.conn_id&&e.conn_id!==account.conn_id)return false;
  if(e.account_id)return e.account_id===account.id;
  return !!e.conn_id&&e.conn_id===account.conn_id;
 });
}
const legacyWarning=data=>!(data.errlist?.length)&&Array.isArray(data.errors)&&data.errors.some(e=>typeof e==='string'&&e.trim());
function errorReason(e){
 return ({'gen.auth':'SimpleFIN access needs to be reconnected.','gen.api':'SimpleFIN rejected the data request.','con.auth':'Sign in to this institution again in SimpleFIN.','act.failed':'SimpleFIN could not refresh this account.','act.missingdata':'SimpleFIN returned incomplete transaction history. Valid returned transactions are kept.'})[e.code]||'SimpleFIN reported a provider error. Check this connection in SimpleFIN.';
}
function diagnostics(data){
 return (Array.isArray(data?.errlist)?data.errlist:[]).filter(e=>e&&typeof e==='object').map(e=>{
  const account=data.accounts?.find(a=>e.account_id===a.id&&(!e.conn_id||e.conn_id===a.conn_id));
  const connection=data.connections?.find(c=>e.conn_id&&e.conn_id===c.conn_id);
  return (account?label(account.name,'Account'):connection?label(connection.name,'Connection'):'SimpleFIN')+': '+errorReason(e);
 });
}
export function mergeSimplefinAccounts(existing,data,now=new Date().toISOString(),{preserveAbsent=false,recoverOnly=false}={}){
 const old=new Map(existing.filter(a=>a.source==='simplefin').map(a=>[a.id,a])),seen=new Set();
 const next=data.accounts.map(a=>{
  if(!a||typeof a.id!=='string'||!a.id||a.id.length>500)throw Error('SimpleFIN returned an invalid account identifier.');
  const {id,previous,matches,aliases}=resolveAccount(data,a,existing);
  if(seen.has(id))throw Error('SimpleFIN returned duplicate accounts. Your previous balances were kept.');seen.add(id);
  for(const match of matches)old.delete(match.id);
  const org=data.connections?.find(c=>a.conn_id&&c.conn_id===a.conn_id),raw=amount(a.balance),date=stamp(a['balance-date']);
  const failed=accountErrors(data,a).length>0;
  const providerUnavailable=raw===null||!date||failed;
  const identityFields={id,identityAliases:aliases.filter(alias=>alias!==id),simplefinConnectionId:a.conn_id||previous?.simplefinConnectionId||null,accountMissing:false};
  if(previous?.balanceUpdated&&date&&date<previous.balanceUpdated)return {...previous,...identityFields,balanceRetrieved:now,balanceWarning:'SimpleFIN returned an older reading; the newer saved amount is kept.'};
  if(recoverOnly&&previous&&!previous.providerUnavailable&&(providerUnavailable||date<=previous.balanceUpdated))return {...previous,...identityFields};
  const entry={...previous,...identityFields,source:'simplefin',itemId:'simplefin',name:label(a.name,'SimpleFIN account'),institution:label(org?.name||a.conn_name||a.org?.name,'SimpleFIN'),currency:typeof a.currency==='string'&&/^[A-Z]{3}$/.test(a.currency)?a.currency:'XXX',type:previous?.type||'unknown',subtype:previous?.subtype||'',balance:previous?.balance??0,rawBalance:raw,rawAvailable:amount(a['available-balance']),providerUnavailable,accountMissing:false,balanceWarning:raw===null?'SimpleFIN did not supply a valid balance.':!date?'SimpleFIN did not supply a valid balance date.':failed?accountErrors(data,a).map(errorReason).join(' '):legacyWarning(data)?'SimpleFIN reported a connection warning. This account’s reported balance and date are shown.':null,balanceRetrieved:now,balanceUpdated:providerUnavailable?(previous?.balanceUpdated||null):date,include:previous?.include??false};
  if(providerUnavailable)return {...entry,balanceUnavailable:true};
  return simplefinAccountBalance(entry);
 });
 // Missing accounts can be an upstream outage. Keep them and their links as stale.
 for(const a of old.values())if(!seen.has(a.id))next.push(preserveAbsent?a:{...a,balanceUnavailable:true,providerUnavailable:true,accountMissing:true,balanceRetrieved:now,balanceWarning:'Not returned by SimpleFIN. Check account sharing in SimpleFIN.'});
 return [...existing.filter(a=>a.source!=='simplefin'),...next];
}
export function configureSimplefinAccount(accounts,{id,kind,debtSign}){
 if(!kinds.has(kind))throw Error('Choose the account type.');
 const a=accounts.find(x=>x.id===id&&x.source==='simplefin');if(!a)throw Error('SimpleFIN account not found.');
 if(['credit','loan'].includes(kind)&&!['negative','positive'].includes(debtSign))throw Error('Choose how this account reports the amount owed.');
 Object.assign(a,simplefinAccountBalance({...a,type:['checking','savings'].includes(kind)?'depository':kind,subtype:['checking','savings'].includes(kind)?kind:'',debtSign:['credit','loan'].includes(kind)?debtSign:null}));
 return a;
}
export const publicSimplefin=c=>c.simplefin?{connected:true,status:c.simplefin.status||'Connected',updated:c.simplefin.updated||null,lastAttempt:c.simplefin.lastAttempt||null,nextSync:c.simplefin.nextSync||null}:null;
export async function syncSimplefin(c,readAccounts,saveAccounts,fetcher=fetch){
 const s=c.simplefin;if(!s)throw Error('Connect SimpleFIN first.');
 const now=Date.now();s.attempts=(s.attempts||[]).filter(t=>t>now-day);
 if(s.lastAttempt&&now-s.lastAttempt<300000)return 'SimpleFIN was checked less than five minutes ago. Showing saved balances; try again after '+new Date(s.lastAttempt+300000).toISOString()+'.';
 if(s.attempts.length>=20){s.status='SimpleFIN has reached today’s refresh limit. Your last balances are kept.';s.nextSync=Math.min(...s.attempts)+day;return s.status;}
 s.lastAttempt=now;s.nextSync=now+6*3600000;
 const read=async balancesOnly=>{if(s.attempts.length>=20)throw Error('SimpleFIN has reached today’s refresh limit.');s.attempts.push(Date.now());return fetchSimplefin(s.accessUrl,fetcher,{balancesOnly});};
 let data,balanceError,historyError,history;
 const save=async (snapshot,options={})=>{
  const accounts=mergeSimplefinAccounts(await readAccounts(),snapshot,new Date().toISOString(),options);await saveAccounts(accounts);
  data??=snapshot;s.updated=new Date().toISOString();c.bankUpdated=s.updated;
  return accounts;
 };
 let accounts;
 try{accounts=await save(await read(true));}catch(e){balanceError=e;}
 // History is independent: it can recover balances if the lightweight request
 // failed, and a history failure cannot roll back already saved balances.
 try{
  history=await read(false);
  accounts=await save(history,{preserveAbsent:!!data,recoverOnly:!!data});
  c.transactions=mergeSimplefinTransactions(c.transactions||[],history,Date.now(),accounts);
 }catch(e){historyError=e;}
 if(data){
  const stale=accounts.filter(a=>a.source==='simplefin'&&a.providerUnavailable).length;
  const errors=(data.errlist?.length||0)+(data.errors?.length||0);
  const returned=accounts.filter(a=>a.source==='simplefin'&&!a.accountMissing).length;
  s.status=stale?`SimpleFIN returned ${returned} account(s); ${stale} balance(s) need attention. Last known amounts are kept. Check account sharing and the affected connection in SimpleFIN.`:returned?`SimpleFIN loaded ${returned} account(s).`:'SimpleFIN is connected but returned no accounts. Add financial institutions or enable accounts for BearDen in SimpleFIN, then refresh here.';
  if(errors&&!stale)s.status+=' SimpleFIN reported a connection warning; valid reported balances are shown with their dates.';
  const historyErrors=(history?.errlist?.length||0)+(history?.errors?.length||0);
  const details=[...new Set([...accounts.filter(a=>a.source==='simplefin'&&a.providerUnavailable).map(a=>a.name+': '+a.balanceWarning),...diagnostics(data),...diagnostics(history)])];
  s.status+=historyError?' Transaction history could not refresh. Saved history is kept.':historyErrors?' Some transaction history needs attention; saved history is kept.':' Available transactions synced.';
  if(details.length)s.status+=' '+details.slice(0,12).join(' ');
  s.nextSync=now+(stale||errors||historyError||historyErrors?6*3600000:day);
 }else s.status=(balanceError?.message||'SimpleFIN could not refresh balances.')+' Your previous balances are kept.';

 return s.status;
}


// SimpleFIN deposits are positive; BearDen uses Plaid's positive-outflow convention.
// Only a complete, successful account window may replace previous transactions.
export function mergeSimplefinTransactions(existing,data,now=Date.now(),accounts=[]){
 const savedIds=new Set(existing.map(t=>t.transaction_id));
 const since=new Date(now-90*day).toISOString().slice(0,10),today=new Date(now).toISOString().slice(0,10),replace=new Set(),incoming=[];
 for(const account of data.accounts||[]){
  const failed=accountErrors(data,account,{transactions:true}).length>0;
  if(!Array.isArray(account.transactions))continue;
  const {id,aliases}=resolveAccount(data,account,accounts),rows=[];let malformed=false;
  for(const t of account.transactions){
   const cents=amount(t?.amount),posted=stamp(t?.posted);
   if(!t||typeof t.id!=='string'||!t.id||cents===null||!posted||typeof t.description!=='string'){if(!t?.pending)malformed=true;continue;}
   const date=posted.slice(0,10);if(t.pending||date<since||date>today)continue;
   const txId=accountId=>'simplefin-tx-'+createHash('sha256').update(JSON.stringify([accountId,t.id])).digest('hex').slice(0,32);
   const savedId=aliases.map(txId).find(id=>savedIds.has(id));
   rows.push({transaction_id:savedId||txId(id),itemId:'simplefin',account_id:id,source:'simplefin',name:label(t.description,'Transaction'),date,amount:-cents/100,pending:false,currency:account.currency,category:''});
  }
  // Legacy warnings have no reliable account scope: merge valid rows, but do
  // not use that possibly partial window to delete previously saved history.
  if(!failed&&!malformed&&!legacyWarning(data))replace.add(id);incoming.push(...rows);
 }
 const aliasPairs=accounts.filter(a=>a.source==='simplefin').flatMap(a=>(a.identityAliases||[]).map(alias=>[alias,a.id]));
 const canonical=new Map(aliasPairs.filter(([alias,id])=>!accounts.some(a=>a.id===alias)&&!aliasPairs.some(([other,target])=>other===alias&&target!==id)));
 existing=existing.map(t=>t.source==='simplefin'&&canonical.has(t.account_id)?{...t,account_id:canonical.get(t.account_id)}:t);
 const map=new Map(existing.filter(t=>!(t.source==='simplefin'&&replace.has(t.account_id)&&t.date>=since)).map(t=>[t.transaction_id,t]));
 for(const t of incoming)map.set(t.transaction_id,t);
 return [...map.values()].filter(t=>t.date>=new Date(now-365*day).toISOString().slice(0,10)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3000);
}
