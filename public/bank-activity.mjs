import {categorizeTransaction} from './transaction-categories.mjs?v=auto-categories1';
import {transactionAccountId} from './transaction-links.mjs?v=lunchflow-only1';
import {day} from './engine.mjs';
import {matchesPayment,matchingPayments} from './transaction-links.mjs';
export const transactionKey=t=>JSON.stringify([t.itemId,t.account_id,String(t.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()]);
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function classifyBankTransaction(t,preferences={}){
 if(t.pending||t.currency!=='USD'||!Number.isFinite(t.amount)||t.amount<=0)return {kind:'excluded'};
 const result=categorizeTransaction(t,preferences);
 return {...result,...(result.kind==='bill'?{reason:'Recognized '+result.label.toLowerCase()+' payment'}:{})};
}
export function personalSpending(transactions,today=new Date().toISOString().slice(0,10),preferences={}){
 const start=day(today,-29),groups=new Map();let oldest=null;
 for(const t of transactions||[]){
  if(t.date<start||t.date>today)continue;
  const kind=classifyBankTransaction(t,preferences);if(kind.kind!=='spending')continue;
  const amount=Math.round(t.amount*100);if(!Number.isSafeInteger(amount)||amount<=0)continue;
  const g=groups.get(kind.key)||{key:kind.key,label:kind.label,amount:0,count:0};g.amount+=amount;g.count++;groups.set(kind.key,g);
  if(!oldest||t.date<oldest)oldest=t.date;
 }
 const categories=[...groups.values()].sort((a,b)=>b.amount-a.amount);
 return {start,end:today,total:categories.reduce((n,g)=>n+g.amount,0),categories};
}


export function reviewBankActivity(transactions,rules={},suggestions=[],today=new Date().toISOString().slice(0,10),links={},preferences={}){
 const start=day(today,-29),recent=(transactions||[]).filter(t=>!t.pending&&t.currency==='USD'&&Number.isFinite(t.amount)&&t.amount>0&&t.date>=start&&t.date<=today).sort((a,b)=>b.date.localeCompare(a.date));
 const groups=new Map(),categories=new Map();
 const rows=recent.map(t=>{
  const key=transactionKey(t),savedRule=rules[key],rule=savedRule&&(!links['bill:'+savedRule.id]||matchesPayment(t,links['bill:'+savedRule.id]))?savedRule:null,kind=classifyBankTransaction(t,preferences),linkedTarget=Object.keys(links).find(target=>matchesPayment(t,links[target])),choice=linkedTarget||rule?.choice==='bill'?'bill':(kind.source==='automatic'?rule?.choice:null)||(kind.kind==='spending'?'spending':kind.kind==='excluded'?'excluded':'suggested');
  if(!groups.has(key))groups.set(key,t);
  if(choice==='spending'){
   const cat=kind.kind==='spending'?kind:{key:'other',label:'Other spending'},g=categories.get(cat.key)||{key:cat.key,label:cat.label,amount:0,count:0};g.amount+=Math.round(t.amount*100);g.count++;categories.set(cat.key,g);
  }
  return {...t,key,choice,linkedTarget,categoryKey:kind.key,categoryLabel:kind.label,spendingCategoryKey:kind.kind==='spending'?kind.key:'other',label:linkedTarget?'Linked to '+(links[linkedTarget].targetName||'account'):choice==='bill'?'Tracked bill':choice==='excluded'?'Transfer or debt payment':choice==='suggested'?'Possible bill':kind.kind==='spending'?kind.label:'Personal spending',reason:kind.reason};
 });
 const bills=[];
 for(const [key,rule]of Object.entries(rules))if(rule.choice==='bill'){
  const link=links['bill:'+rule.id],latest=link?matchingPayments(transactions,link,today)[0]:groups.get(key),suggestion=suggestions.find(b=>b.groupKey===key),date=latest?.date||rule.lastPayment;
  if(!date)continue;
  const repeat=rule.repeat||'monthly';
  let next=repeat==='monthly'?nextMonth(date):day(date,repeat==='weekly'?7:repeat==='biweekly'?14:0);
  // A user's tracked bill remains scheduled even if the bank has not posted the next payment yet.
  for(let n=0;next<today&&n<120&&repeat!=='once';n++)next=repeat==='monthly'?nextMonth(next):day(next,repeat==='weekly'?7:14);
  bills.push({id:rule.id,name:rule.name||latest?.name,amount:latest?Math.round(latest.amount*100):rule.amount,date:next,repeat,source:'bank-tracked',billKind:rule.billKind||suggestion?.billKind||classifyBankTransaction(latest||{name:rule.name,amount:1,currency:'USD'}).billKind,lastPayment:date,groupKey:key});
 }
 return {rows,bills,spending:{start,end:today,total:[...categories.values()].reduce((n,c)=>n+c.amount,0),categories:[...categories.values()].sort((a,b)=>b.amount-a.amount)}};
}
function nextMonth(date){const d=new Date(date+'T12:00:00Z'),n=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(n,last));return d.toISOString().slice(0,10);}

// Posted outflows from the selected bills account, including tracked bills and debt payments.
export function billsAccountSpending(transactions,account,today,rules={},links={},preferences={}){
 const start=day(today,-29),groups=new Map(),rows=[];
 if(!['lunchflow'].includes(account?.source))return {categories:[],total:0,rows};
 for(const t of transactions){
  if(transactionAccountId(t)!==account.id||t.pending||t.currency!=='USD'||!(t.amount>0)||!Number.isFinite(t.amount)||t.date<start||t.date>today)continue;
  const linked=Object.values(links).find(link=>matchesPayment(t,link)),rule=rules[transactionKey(t)],tracked=rule?.choice==='bill';
  const kind=classifyBankTransaction(t,preferences),billKind=rule?.billKind||kind.billKind,corrected=kind.source!=='automatic';
  if(kind.key==='transfer'&&(corrected||!linked&&!tracked))continue;
  const label=(corrected?kind.label:null)||linked?.targetName||(tracked?rule.name:null)||({rent:'Rent',electric:'Electric',utility:'Utilities',insurance:'Insurance','car-payment':'Car payments'})[billKind]||kind.label||'Other spending';
  const key=normalize(label),amount=Math.round(t.amount*100),group=groups.get(key)||{key,label,amount:0,count:0};group.amount+=amount;group.count++;groups.set(key,group);rows.push({...t,categoryKey:kind.key,categoryLabel:kind.label,spendingLabel:label,spendingCategoryKey:key});
 }
 const categories=[...groups.values()].sort((a,b)=>b.amount-a.amount);return {categories,total:categories.reduce((n,g)=>n+g.amount,0),rows:rows.sort((a,b)=>b.date.localeCompare(a.date))};
}

