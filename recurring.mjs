import {day,monthly} from './public/engine.mjs';
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
// Conservative local detection: posted USD bill payments with three regular occurrences.
// No extra Plaid product is activated. Transfers, shopping and debt payments are excluded.
export function recurringBills(transactions,today=new Date().toISOString().slice(0,10)){
 const groups=new Map();
 for(const t of transactions||[]){
  if(t.pending||t.currency!=='USD'||!Number.isFinite(t.amount)||t.amount<=0||t.date>today)continue;
  const category=t.category||'',name=normalize(t.name);
  if(/TRANSFER|LOAN_PAYMENTS|BANK_FEES|GENERAL_MERCHANDISE|FOOD_AND_DRINK|GROCERIES|TRAVEL/.test(category)||/\b(transfer|credit card|visa payment|loan payment)\b/.test(name))continue;
  if(!/RENT_AND_UTILITIES|INSURANCE/.test(category)&&!/\b(electric|energy|water|sewer|internet|wireless|insurance|rent|netflix|spotify|hulu|disney|subscription|comcast|spectrum|verizon|at t)\b/.test(name))continue;
  const key=JSON.stringify([t.itemId,t.account_id,name]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);
 }
 const out=[];
 for(const [key,history]of groups){
  const rows=history.sort((a,b)=>a.date.localeCompare(b.date)).slice(-6);
  if(rows.length<3||new Set(rows.map(t=>t.date)).size!==rows.length)continue;
  const gaps=rows.slice(1).map((t,i)=>(Date.parse(t.date)-Date.parse(rows[i].date))/86400000);
  const cadence=[['weekly',7,1],['biweekly',14,2],['monthly',30.44,4]].find(([,days,tolerance])=>gaps.every(g=>Math.abs(g-days)<=tolerance));
  if(!cadence)continue;
  const [repeat,days]=cadence,last=rows.at(-1),age=(Date.parse(today)-Date.parse(last.date))/86400000;
  if(age>days+7)continue; // Do not project indefinitely after a cancelled payment.
  let date=repeat==='monthly'?monthly(last.date,1):day(last.date,days);
  if(date<today)continue; // A missing payment is not proof of an overdue bill.
  const amount=Math.round(last.amount*100);if(!Number.isSafeInteger(amount)||amount>1e12)continue;
  // Encode the full identity to keep streams stable and separate across accounts.
  const id='bank-'+Buffer.from(key).toString('base64url');
  out.push({id,name:last.name.slice(0,200),amount,date,repeat,source:'bank-estimate',accountId:'plaid-'+last.account_id,lastPayment:last.date,samples:rows.length});
 }
 return out;
}
