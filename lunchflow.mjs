import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
function accountBalance(a){
 const debt=['credit','loan'].includes(a.type),raw=a.rawBalance,include=a.type==='depository'&&a.currency==='USD'&&a.include===true;
 if(a.providerUnavailable||raw===null||!Number.isSafeInteger(raw)||debt&&!['negative','positive'].includes(a.debtSign))return {...a,balanceUnavailable:true,include};
 const balance=debt?Math.max(0,a.debtSign==='negative'?-raw:raw):a.type==='depository'?(a.rawAvailable??raw):raw;
 return {...a,balance,balanceUnavailable:!!a.providerUnavailable,include};
}
const day=86400000;
const label=(v,fallback)=>typeof v==='string'&&v.trim()?v.trim().slice(0,150):fallback;
const id=v=>typeof v==='number'&&Number.isSafeInteger(v)?String(v):typeof v==='string'&&/^[\w.:-]{1,200}$/.test(v)?v:null;
const money=v=>((typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v)))&&Math.abs(Number(v))<=1e10&&Number.isSafeInteger(Math.round(Number(v)*100))?Math.round(Number(v)*100):null;
const currency=v=>typeof v==='string'&&/^[A-Z]{3}$/.test(v)?v:null;
async function request(key,path,fetcher){
 // The apex host redirects API requests to www; use the canonical host directly.
 let response;try{response=await fetcher('https://www.lunchflow.app/api/v1'+path,{headers:{'x-api-key':key,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{throw Error('Lunch Flow could not be reached. Try again later.');}
 if(!response.ok)throw Error(response.status===401||response.status===403?'Lunch Flow refused access. Check your API key and the accounts enabled for its API destination.':response.status===429?'Lunch Flow is limiting requests. Try again later.':'Lunch Flow request failed ('+response.status+').');
 const reader=response.body?.getReader();if(!reader)throw Error('Lunch Flow returned an empty response.');
 const parts=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2000000){await reader.cancel();throw Error('Lunch Flow response is too large. Try sharing fewer accounts.');}parts.push(value);}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw Error('Lunch Flow returned an unreadable response.');}
}
async function discover(key,fetcher){
 const data=await request(key,'/accounts',fetcher);
 if(!Array.isArray(data.accounts)||data.accounts.length>250||(data.total!=null&&Number(data.total)!==data.accounts.length))throw Error('Lunch Flow returned an invalid account list.');
 const seen=new Set();return data.accounts.map(a=>{
  const providerId=id(a?.id);if(providerId===null||seen.has(providerId))throw Error('Lunch Flow returned invalid or duplicate account IDs.');seen.add(providerId);
  return {id:'lunchflow-'+createHash('sha256').update(providerId).digest('hex').slice(0,32),providerId,name:label(a.name,'Lunch Flow account'),institution:label(a.institutionName||a.institution_name,'Lunch Flow'),currency:currency(a.currency)||'XXX'};
 });
}
export async function connectLunchflow(apiKey,fetcher=fetch){
 if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.trim().length>2048||!/^[\x21-\x7e]+$/.test(apiKey.trim()))throw Error('Paste your Lunch Flow REST API key.');
 const key=apiKey.trim(),pending=await discover(key,fetcher);
 return {apiKey:key,pending,total:pending.length,completed:0,issues:[],status:'Lunch Flow connected. Loading accounts.',needsDiscovery:true};
}
export const publicLunchflow=c=>c.lunchflow?{connected:true,status:c.lunchflow.status||'Connected',updated:c.lunchflow.updated||null,nextSync:c.lunchflow.nextSync||null,pending:!!c.lunchflow.pending?.length}:null;
export function configureLunchflowAccount(accounts,{id:accountId,kind,debtSign}){
 if(!['unknown','credit','loan','checking','savings'].includes(kind))throw Error('Choose the account type.');
 const a=accounts.find(a=>a.source==='lunchflow'&&a.id===accountId);if(!a)throw Error('Lunch Flow account not found.');
 if(['credit','loan'].includes(kind)&&!['positive','negative'].includes(debtSign))throw Error('Choose how this account reports the amount owed.');
 Object.assign(a,accountBalance({...a,type:['checking','savings'].includes(kind)?'depository':kind,subtype:['checking','savings'].includes(kind)?kind:'',debtSign:['credit','loan'].includes(kind)?debtSign:null}));
}
const normalized=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const transactionId=(account,transaction)=>'lunchflow-tx-'+createHash('sha256').update(JSON.stringify([account,transaction])).digest('hex').slice(0,32);
const fingerprint=t=>JSON.stringify([t.date,t.amount,t.currency,normalized(t.name)]);
const sameInstitution=(a,b)=>a.currency===b.currency&&normalized(a.institution)===normalized(b.institution)&&a.institution!=='Lunch Flow';
const accountSuffix=a=>String(a.name||'').match(/(?:[xX*•]{2,}|ending(?: in)?|last.?4)\s*(\d{4})\b/)?.[1];
// Retire accounts only after a complete discovery. Keep their records privately
// so a returning ID can recover its configuration without duplicating a balance.
function discoverAccounts(c,accounts,pending){
 const archive=new Map((c.lunchflowArchivedAccounts||[]).map(a=>[a.id,a]));
 const activeIds=new Set(pending.map(a=>a.providerId));
 for(const a of accounts)if(a.source==='lunchflow'&&!activeIds.has(a.providerId))archive.set(a.id,a);
 const active=accounts.filter(a=>a.source!=='lunchflow'||activeIds.has(a.providerId));
 for(const meta of pending){
  const old=active.find(a=>a.source==='lunchflow'&&a.providerId===meta.providerId)||[...archive.values()].find(a=>a.providerId===meta.providerId||a.id===meta.id||(a.identityAliases||[]).includes(meta.id));
  if(old){
   meta.id=old.id;Object.assign(old,meta,{accountMissing:false});archive.delete(old.id);
   if(!active.includes(old))active.push(old);
  }else active.push({...meta,source:'lunchflow',itemId:'lunchflow',type:'unknown',subtype:'',balance:0,rawBalance:null,balanceUnavailable:true,providerUnavailable:true,include:false});
 }
 c.lunchflowArchivedAccounts=[...archive.values()];
 return active;
}
function reconnectAccount(c,accounts,account,rows,providerRows){
 const archived=c.lunchflowArchivedAccounts||[],suffix=accountSuffix(account);
 const candidates=archived.filter(old=>{
  if(old.currency!==account.currency||account.type!=='unknown'&&old.type!=='unknown'&&account.type!==old.type)return false;
  if(suffix&&sameInstitution(old,account)&&accountSuffix(old)===suffix&&normalized(old.name)===normalized(account.name))return true;
  // Bank-supplied transaction IDs plus date, amount and merchant corroborate
  // identity. A common name or balance alone must never merge two accounts.
  const oldRows=new Map((c.transactions||[]).filter(t=>t.account_id===old.id).map(t=>[t.transaction_id,t]));
  const matches=rows.filter((row,i)=>{
   const saved=oldRows.get(transactionId(old.providerId,providerRows[i]));
   return saved&&fingerprint(saved)===fingerprint(row);
  });
  return matches.length>=2&&new Set(matches.map(t=>t.date)).size>=2;
 });
 if(candidates.length!==1)return account;
 const old=candidates[0];
 // Another current account with the same masked identity makes it ambiguous.
 if(suffix&&accounts.some(a=>a!==account&&sameInstitution(a,account)&&accountSuffix(a)===suffix))return account;
 const alias=account.id,configured=account.type!=='unknown';
 const restored={...old,...account,id:old.id,
  type:configured?account.type:old.type,subtype:configured?account.subtype:old.subtype,
  debtSign:configured?account.debtSign:old.debtSign,include:configured?account.include:old.include,
  identityAliases:[...new Set([...(old.identityAliases||[]),...(account.identityAliases||[]),alias])].filter(id=>id!==old.id)};
 if(account.providerUnavailable){
  for(const key of ['balance','rawBalance','rawAvailable','balanceUpdated'])restored[key]=old[key];
 }else if(['credit','loan'].includes(restored.type)&&restored.rawBalance===0&&old.balance>0){
  Object.assign(restored,{balance:old.balance,rawBalance:old.rawBalance,balanceUpdated:old.balanceUpdated,providerUnavailable:true,balanceUnavailable:true,balanceWarning:'Lunch Flow returned zero; verify this debt before treating it as paid off.'});
 }
 Object.assign(account,accountBalance(restored));
 c.lunchflowArchivedAccounts=archived.filter(a=>a!==old);
 const prior=(c.transactions||[]).filter(t=>t.account_id===old.id),aliased=(c.transactions||[]).filter(t=>t.account_id===alias),duplicates=aliased.map(t=>({...t}));
 retainTransactionIds(rows,prior);retainTransactionIds(duplicates,prior);
 const redirects=new Map(duplicates.map((t,i)=>[aliased[i].transaction_id,t.transaction_id]));
 account.transactionIdentityAliases=[...(old.transactionIdentityAliases||[]),...(account.transactionIdentityAliases||[]),...[...redirects].filter(([from,to])=>from!==to)];
 c.transactions=[...new Map((c.transactions||[]).map(t=>{const row=t.account_id===alias?{...t,account_id:account.id,transaction_id:redirects.get(t.transaction_id)||t.transaction_id}:t;return [row.transaction_id,row];})).values()];
 for(const row of rows)row.account_id=account.id;
 return account;
}
// Reauthentication can replace transaction IDs too. Reuse a saved identity only
// for a one-to-one exact match within the already verified account.
function retainTransactionIds(rows,previous){
 const saved=new Map(),counts=new Map();
 for(const row of previous){const key=fingerprint(row);saved.set(key,saved.has(key)?null:row.transaction_id);}
 for(const row of rows){const key=fingerprint(row);counts.set(key,(counts.get(key)||0)+1);}
 for(const row of rows){const key=fingerprint(row);if(counts.get(key)===1&&saved.get(key))row.transaction_id=saved.get(key);}
}
export async function syncLunchflow(c,readAccounts,saveAccounts,fetcher=fetch){
 const s=c.lunchflow;if(!s)throw Error('Connect Lunch Flow first.');
 const now=Date.now(),at=new Date(now).toISOString();let accounts=await readAccounts();
 if(!s.pending){
  if(s.lastAttempt&&now-s.lastAttempt<300000)return {status:'Lunch Flow was checked less than five minutes ago. Showing saved readings.',pending:false,cached:true};
  s.lastAttempt=now;s.nextSync=now+6*3600000;
  try{s.pending=await discover(s.apiKey,fetcher);s.total=s.pending.length;s.completed=0;s.issues=[];s.needsDiscovery=true;}
  catch(error){s.status=error.message+' Saved balances and history are kept.';return {status:s.status,pending:false,needsAttention:true};}
 }
 s.lastAttempt=now;
 if(s.needsDiscovery){
  accounts=discoverAccounts(c,accounts,s.pending);
  delete s.needsDiscovery;
 }
 const batch=s.pending.slice(0,6),from=new Date(now-90*day).toISOString().slice(0,10),to=at.slice(0,10);
 // Bound each batch to twelve provider requests for the free Worker runtime.
 const responses=await Promise.all(batch.map(async a=>({a,results:await Promise.allSettled([
  request(s.apiKey,'/accounts/'+encodeURIComponent(a.providerId)+'/balance',fetcher),
  request(s.apiKey,'/accounts/'+encodeURIComponent(a.providerId)+'/transactions?'+new URLSearchParams({from,to,include_pending:'false'}),fetcher)
 ])})));
 for(const {a:meta,results:[balance,history]} of responses){
  const a=accounts.find(a=>a.id===meta.id);
  const b=balance.status==='fulfilled'?balance.value.balance:null,raw=money(b?.amount),unit=currency(b?.currency),wrongCurrency=unit&&a.currency!=='XXX'&&unit!==a.currency;
  const zero=raw===0&&(a.type==='loan'||a.type==='credit'&&a.balance>0);
  if(raw===null||!unit||wrongCurrency||zero){a.providerUnavailable=true;a.balanceUnavailable=true;a.balanceWarning=balance.status==='rejected'?balance.reason.message:zero?'Lunch Flow returned zero; verify this debt before treating it as paid off.':wrongCurrency?'Lunch Flow returned a different currency; the saved balance is kept.':'Lunch Flow did not supply a usable balance.';s.issues.push(a.name+': '+a.balanceWarning);}
  else Object.assign(a,accountBalance({...a,rawBalance:raw,rawAvailable:null,currency:unit,balanceUpdated:at,balanceRetrieved:at,providerUnavailable:false,balanceStale:false,balanceWarning:null}));
  a.balanceRetrieved=at;a.balanceObservation={amount:raw,amountStatus:raw===null?'missing':'reported',retrievedAt:at};
  a.balanceDateUnknown=true; // The API supplies a reading without a bank balance timestamp.
  if(history.status==='fulfilled'&&Array.isArray(history.value.transactions)){
   const rows=[],providerRows=[];let malformed=false;
   for(const t of history.value.transactions){
    if(t.isPending===true)continue;const tid=id(t.id),amount=money(t.amount),date=typeof t.date==='string'?t.date.slice(0,10):'';
    if(tid===null||amount===null||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||currency(t.currency)!==a.currency||(t.accountId!=null&&id(t.accountId)!==a.providerId)){malformed=true;continue;}
    if(date<from||date>to)continue;
    rows.push({transaction_id:transactionId(a.providerId,tid),account_id:a.id,itemId:'lunchflow',source:'lunchflow',date,name:label(t.merchant||t.description,'Transaction'),amount:-amount/100,currency:a.currency,pending:false,category:''});providerRows.push(tid);
   }
   reconnectAccount(c,accounts,a,rows,providerRows);
   retainTransactionIds(rows,(c.transactions||[]).filter(t=>t.account_id===a.id));
   const complete=!malformed&&Number(history.value.total)===history.value.transactions.length;
   const map=new Map((c.transactions||[]).filter(t=>!(complete&&t.source==='lunchflow'&&t.account_id===a.id&&t.date>=from&&t.date<=to)).map(t=>[t.transaction_id,t]));for(const row of rows)map.set(row.transaction_id,row);
   c.transactions=[...map.values()].filter(t=>t.date>=new Date(now-365*day).toISOString().slice(0,10)).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,3000);
   a.transactionsWarning=malformed?'Some Lunch Flow transactions were unreadable; saved history is kept.':!complete?'Lunch Flow returned partial history; saved history is kept.':null;
  }else a.transactionsWarning=history.status==='rejected'?history.reason.message:'Lunch Flow returned unreadable transaction history.';
  if(a.transactionsWarning)s.issues.push(a.name+': '+a.transactionsWarning);
 }
 await saveAccounts(accounts);s.completed+=batch.length;s.pending=s.pending.slice(batch.length);s.updated=at;c.bankUpdated=at;
 const pending=!!s.pending.length;
 s.status=pending?'Lunch Flow: '+s.completed+' of '+s.total+' accounts refreshed.':s.total?'Lunch Flow refreshed '+s.total+' account(s).':'Lunch Flow returned no accounts. Enable accounts under Account Access in your REST API destination.';
 if(s.issues.length)s.status+=' '+[...new Set(s.issues)].slice(0,8).join(' ');
 if(pending)s.nextSync=now;else{delete s.pending;s.nextSync=now+(s.issues.length?6*3600000:day);}
 return {status:s.status,pending,needsAttention:s.issues.length>0||s.total===0};
}
