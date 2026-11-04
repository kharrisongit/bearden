import {day} from './engine.mjs';
import {transactionAccountId,merchantIdentity} from './transaction-links.mjs?v=plaid-restore1';

const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&day(d,0)===d;
export const postedPaycheck=t=>!!t?.transaction_id&&!t.pending&&t.currency==='USD'&&Number.isFinite(t.amount)&&t.amount<0&&validDate(t.date)&&!/\b(refund|reversal|reversed|cashback|cash back|reward|interest)\b/i.test(t.name||'');
export function paycheckOccurrence(startDate,date){
 if(!validDate(startDate)||!validDate(date))return null;
 const n=Math.round((Date.parse(date)-Date.parse(startDate))/86400000/14),scheduledDate=day(startDate,n*14);
 return n>=0&&Math.abs(Date.parse(date)-Date.parse(scheduledDate))/86400000<=3?{paycheck:n+1,scheduledDate}:null;
}

// Use one selected account, a confirmed employer or explicit payroll evidence,
// and one unambiguous posted deposit. Recompute so corrections can undo matches.
export function matchPaychecks({state={},transactions=[],accountId,link,today}){
 if(!accountId||!validDate(today))return {};
 const groups=new Map(),seen=new Set();
 for(const t of transactions){
  if(!postedPaycheck(t)||t.date>today||transactionAccountId(t)!==accountId)continue;
  const key=JSON.stringify([accountId,t.transaction_id]);if(seen.has(key))continue;seen.add(key);
  const linked=link?.accountId===accountId&&link.merchant===merchantIdentity(t.name);
  const payroll=/^INCOME_(WAGES|SALARY)(_|$)/.test(t.category||'')||/\b(payroll|payrol|salary|salaries)\b/i.test(t.name||'');
  if(link?!linked:!payroll)continue;
  const occurrence=paycheckOccurrence(state.startDate,t.date);if(!occurrence||state.checkedPaychecks?.[occurrence.paycheck])continue;
  const receipt={...occurrence,amount:Math.round(-t.amount*100),receivedDate:t.date,transactionId:t.transaction_id,accountId,name:t.name};
  if(!Number.isSafeInteger(receipt.amount)||receipt.amount<=0)continue;
  const group=groups.get(occurrence.paycheck)||[];group.push(receipt);groups.set(occurrence.paycheck,group);
 }
 return Object.fromEntries([...groups].flatMap(([n,rows])=>{
  const selected=rows.find(r=>link?.assignments?.[r.scheduledDate]===r.transactionId);
  return selected||rows.length===1?[[n,selected||rows[0]]]:[];
 }));
}
