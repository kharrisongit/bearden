import {day} from './engine.mjs';

// Keep account/loan numbers significant. Only explicitly labelled reference
// numbers vary freely; fuzzy substring matching could merge two different bills.
export const merchantIdentity=name=>String(name||'').toLowerCase()
 .replace(/\b(?:ref(?:erence)?|confirmation|auth|trace)\s*[:#-]?\s*[a-z0-9-]+\b/g,' ')
 .replace(/[^a-z0-9]+/g,' ').trim();
export const postedPayment=t=>!t.pending&&t.currency==='USD'&&Number.isFinite(t.amount)&&t.amount>0&&!!t.transaction_id&&!/\b(refund|reversal|reversed)\b/i.test(t.name||'');
export function paymentLink(transaction,{exactAmount=false}={}){
 return {itemId:transaction.itemId,accountId:transaction.account_id,merchant:merchantIdentity(transaction.name),name:transaction.name,amount:exactAmount?Math.round(transaction.amount*100):null,sampleAmount:Math.round(transaction.amount*100)};
}
export function matchesPayment(transaction,link){
 return !!link&&!!link.merchant&&postedPayment(transaction)&&transaction.itemId===link.itemId&&transaction.account_id===link.accountId&&merchantIdentity(transaction.name)===link.merchant&&(link.amount==null||Math.round(transaction.amount*100)===link.amount);
}
export function matchingPayments(transactions,link,today=new Date().toISOString().slice(0,10)){
 const seen=new Set();return (transactions||[]).filter(t=>{
  if(t.date>today||!matchesPayment(t,link)||seen.has(t.transaction_id))return false;
  seen.add(t.transaction_id);return true;
 }).sort((a,b)=>b.date.localeCompare(a.date)||String(a.transaction_id).localeCompare(String(b.transaction_id)));
}
export function linkConflict(links,target,link){
 return Object.entries(links).find(([key,other])=>key!==target&&other.itemId===link.itemId&&other.accountId===link.accountId&&other.merchant===link.merchant&&(other.amount==null||link.amount==null||other.amount===link.amount))?.[0]||null;
}
export const paymentTarget=bill=>bill.source==='tracker-debt'?'debt:'+bill.trackerCardId:bill.source==='plaid-credit'?'credit:'+bill.id:'bill:'+bill.id;

// Recomputed from posted transactions, so a removed/corrected bank transaction
// cannot leave a permanent paid flag. One transaction can settle only one date.
export function matchedBillPayments(events,transactions,links,today){
 const paid=new Set(),groups=new Map();
 for(const event of events){const target=paymentTarget(event);if(!links[target])continue;if(!groups.has(target))groups.set(target,[]);groups.get(target).push(event);}
 for(const [target,bills]of groups){
  const totals=new Map();
  for(const transaction of matchingPayments(transactions,links[target],today)){
   const candidates=bills.filter(b=>{
    const early=b.repeat==='weekly'?3:b.source==='tracker-debt'?6:7,late=b.repeat==='weekly'?3:b.source==='tracker-debt'?7:14;
    const start=b.source==='plaid-credit'&&b.statementDate&&b.statementDate<b.date?day(b.statementDate,1):day(b.date,-early);
    return transaction.date>=start&&transaction.date<=day(b.date,late);
   }).sort((a,b)=>Math.abs(Date.parse(a.date)-Date.parse(transaction.date))-Math.abs(Date.parse(b.date)-Date.parse(transaction.date))||a.date.localeCompare(b.date));
   const bill=candidates[0];if(bill)totals.set(bill.key,(totals.get(bill.key)||0)+Math.round(transaction.amount*100));
  }
  for(const bill of bills)if((totals.get(bill.key)||0)>=bill.amount&&bill.amount>0)paid.add(bill.key);
 }
 return [...paid];
}
