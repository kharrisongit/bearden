import {day} from './engine.mjs';
import {transactionAccountId,merchantIdentity} from './transaction-links.mjs?v=plaid-restore1';

const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&day(d,0)===d;
const description=t=>[t?.name,t?.original_description,t?.originalDescription,t?.description,t?.merchant_name].filter(Boolean).join(' ');
export const postedPaycheck=t=>!!t?.transaction_id&&!t.pending&&(t.currency||'USD')==='USD'&&Number.isFinite(t.amount)&&t.amount<0&&validDate(t.date)&&!/\b(refund|reversal|reversed|cashback|cash back|reward|interest)\b/i.test(description(t));
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
  const details=description(t),linked=link?.accountId===accountId&&link.merchant===merchantIdentity(t.name);
  const payroll=/^INCOME_(WAGES|SALARY)(_|$)/.test(t.category||'')||/\b(payroll|payrol|salary|salaries|paycheck|pay\s*check|direct\s*dep(?:osit)?)\b/i.test(details);
  const amount=Math.round(-t.amount*100),expected=Math.round(Number(state.takeHome||0)*100);
  const plausible=expected>0&&amount>=expected*.88&&amount<=expected*1.12&&/\b(?:ach\s*(?:credit|deposit)|deposit\s*pay|electronic\s*deposit)\b/i.test(details)&&!/\b(?:transfer|zelle|venmo|paypal|cash|mobile|check\s*deposit|refund|reversal)\b/i.test(details);
  if(link?!linked:!(payroll||plausible))continue;
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
