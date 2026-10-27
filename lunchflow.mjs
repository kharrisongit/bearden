import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {simplefinAccountBalance} from './simplefin.mjs';
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
 if(!Array.isArray(data.accounts)||data.accounts.length>250)throw Error('Lunch Flow returned an invalid account list.');
 const seen=new Set();return data.accounts.map(a=>{
  const providerId=id(a?.id);if(providerId===null||seen.has(providerId))throw Error('Lunch Flow returned invalid or duplicate account IDs.');seen.add(providerId);
  return {id:'lunchflow-'+createHash('sha256').update(providerId).digest('hex').slice(0,32),providerId,name:label(a.name,'Lunch Flow account'),institution:label(a.institutionName,'Lunch Flow'),currency:currency(a.currency)||'XXX'};
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
 Object.assign(a,simplefinAccountBalance({...a,type:['checking','savings'].includes(kind)?'depository':kind,subtype:['checking','savings'].includes(kind)?kind:'',debtSign:['credit','loan'].includes(kind)?debtSign:null}));
}
export async function syncLunchflow(c,readAccounts,saveAccounts,fetcher=fetch){
 const s=c.lunchflow;if(!s)throw Error('Connect Lunch Flow first.');
 const now=Date.now(),at=new Date(now).toISOString();let accounts=await readAccounts();
 if(!s.pending){
  if(s.lastAttempt&&now-s.lastAttempt<300000)return {status:'Lunch Flow was checked less than five minutes ago. Showing saved readings.',pending:false};
  s.lastAttempt=now;s.nextSync=now+6*3600000;
  try{s.pending=await discover(s.apiKey,fetcher);s.total=s.pending.length;s.completed=0;s.issues=[];s.needsDiscovery=true;}
  catch(error){s.status=error.message+' Saved balances and history are kept.';return {status:s.status,pending:false};}
 }
 s.lastAttempt=now;
 if(s.needsDiscovery){
  const ids=new Set(s.pending.map(a=>a.id));
  accounts=accounts.map(a=>a.source==='lunchflow'&&!ids.has(a.id)?{...a,accountMissing:true,providerUnavailable:true,balanceUnavailable:true,balanceWarning:'Not returned by Lunch Flow. Check Account Access in your API destination.'}:a);
  for(const meta of s.pending){const old=accounts.find(a=>a.id===meta.id);if(old)Object.assign(old,meta,{accountMissing:false});else accounts.push({...meta,source:'lunchflow',itemId:'lunchflow',type:'unknown',subtype:'',balance:0,rawBalance:null,balanceUnavailable:true,providerUnavailable:true,include:false});}
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
  const zero=raw===0&&(a.type==='loan'||a.balance>0);
  if(raw===null||!unit||wrongCurrency||zero){a.providerUnavailable=true;a.balanceUnavailable=true;a.balanceWarning=balance.status==='rejected'?balance.reason.message:zero?'Lunch Flow returned zero; verify this debt before treating it as paid off.':wrongCurrency?'Lunch Flow returned a different currency; the saved balance is kept.':'Lunch Flow did not supply a usable balance.';s.issues.push(a.name+': '+a.balanceWarning);}
  else Object.assign(a,simplefinAccountBalance({...a,rawBalance:raw,rawAvailable:null,currency:unit,balanceUpdated:at,balanceRetrieved:at,providerUnavailable:false,balanceStale:false,balanceWarning:null}));
  a.balanceRetrieved=at;a.balanceObservation={amount:raw,amountStatus:raw===null?'missing':'reported',retrievedAt:at};
  a.balanceDateUnknown=true; // The API supplies a reading without a bank balance timestamp.
  if(history.status==='fulfilled'&&Array.isArray(history.value.transactions)){
   const rows=[];let malformed=false;
   for(const t of history.value.transactions){
    if(t.isPending===true)continue;const tid=id(t.id),amount=money(t.amount),date=typeof t.date==='string'?t.date.slice(0,10):'';
    if(tid===null||amount===null||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||currency(t.currency)!==a.currency||(t.accountId!=null&&id(t.accountId)!==a.providerId)){malformed=true;continue;}
    if(date<from||date>to)continue;
    rows.push({transaction_id:'lunchflow-tx-'+createHash('sha256').update(JSON.stringify([a.providerId,tid])).digest('hex').slice(0,32),account_id:a.id,itemId:'lunchflow',source:'lunchflow',date,name:label(t.merchant||t.description,'Transaction'),amount:-amount/100,currency:a.currency,pending:false,category:''});
   }
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
 return {status:s.status,pending};
}
