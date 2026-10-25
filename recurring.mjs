import {day,monthly} from './public/engine.mjs';
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export {classifyBankTransaction,personalSpending} from './public/bank-activity.mjs';
import {classifyBankTransaction} from './public/bank-activity.mjs';
// Seed monthly estimates immediately from likely bills in the last 30 days.
// With three regular payments, refine the cadence using the longer history.
// No extra Plaid product is activated. Transfers, shopping and debt payments are excluded.
export function recurringBills(transactions,today=new Date().toISOString().slice(0,10)){
 const groups=new Map();
 for(const t of transactions||[]){
  if(t.date>today||classifyBankTransaction(t).kind!=='bill')continue;
  const name=normalize(t.name);
  const key=JSON.stringify([t.itemId,t.account_id,name]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);
 }
 const out=[];
 for(const [key,history]of groups){
  const rows=history.sort((a,b)=>a.date.localeCompare(b.date)).slice(-6);
  if(!rows.length)continue;
  const gaps=rows.slice(1).map((t,i)=>(Date.parse(t.date)-Date.parse(rows[i].date))/86400000);
  const cadence=rows.length>=3&&new Set(rows.map(t=>t.date)).size===rows.length?[['weekly',7,1],['biweekly',14,2],['monthly',30.44,4]].find(([,days,tolerance])=>gaps.every(g=>Math.abs(g-days)<=tolerance)):null;
  const last=rows.at(-1),age=(Date.parse(today)-Date.parse(last.date))/86400000;
  if(!cadence&&age>30)continue;
  const [repeat,days]=cadence||['monthly',30.44];
  if(age>days+7)continue; // Do not project indefinitely after a cancelled payment.
  let date=repeat==='monthly'?monthly(last.date,1):day(last.date,days);
  if(date<today)continue; // A missing payment is not proof of an overdue bill.
  const amount=Math.round(last.amount*100);if(!Number.isSafeInteger(amount)||amount>1e12)continue;
  // Encode the full identity to keep streams stable and separate across accounts.
  const id='bank-'+Buffer.from(key).toString('base64url');
  out.push({id,groupKey:key,name:last.name.slice(0,200),amount,date,repeat,source:'bank-estimate',accountId:'plaid-'+last.account_id,lastPayment:last.date,samples:rows.length,provisional:!cadence,billKind:classifyBankTransaction(last).billKind,reason:classifyBankTransaction(last).reason});
 }
 return out;
}
