import {day} from './engine.mjs';
import {transactionAccountId,merchantIdentity} from './transaction-links.mjs?v=plaid-restore1';

// Bank posting dates can move around a payday without changing its recurrence.
export const contributionWindow=3;
const distance=(a,b)=>Math.abs(Date.parse(a)-Date.parse(b))/86400000;
const transactionId=t=>JSON.stringify([transactionAccountId(t),t.transaction_id]);
const near=(t,event)=>distance(t.date,event.date)<=contributionWindow;
const validDate=date=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&day(date,0)===date;
const excluded=t=>/\b(refund|reversal|reversed|return(?:ed)?|cashback|cash back|reward|interest)\b/i.test((t.name||'')+' '+String(t.category||'').replaceAll('_',' '));
const transfer=t=>/TRANSFER_(IN|OUT)/.test(t.category||'')||/\b(transfer|xfer|xfr|tfr|trnsfr)\b/i.test(t.name||'');
const deposit=t=>!t.category||/^(TRANSFER_IN|INCOME)(_|$)/.test(t.category)||/\b(deposit|payroll|ach|transfer|xfer|xfr|tfr|trnsfr)\b/i.test(t.name||'');

// Recompute from bank evidence on every refresh. Do not save permanent received
// flags: modified/removed transactions must be able to undo a match.
export function matchContributions(events,transactions,h,today){
 const used=new Set(),matches=new Map(),seen=new Set();
 const posted=(transactions||[]).filter(t=>{
  if(!t?.transaction_id||t.pending||t.currency!=='USD'||!Number.isFinite(t.amount)||!validDate(t.date)||t.date>today||excluded(t))return false;
  const id=transactionId(t);if(seen.has(id))return false;seen.add(id);return true;
 }).sort((a,b)=>a.date.localeCompare(b.date)||transactionId(a).localeCompare(transactionId(b)));
 const credits=posted.filter(t=>transactionAccountId(t)===h.billsAccountId&&t.amount<0&&(deposit(t)||Object.values(h.contributionLinks||{}).some(link=>link.accountId===transactionAccountId(t)&&link.merchant===merchantIdentity(t.name))));
 const debits=posted.filter(t=>transactionAccountId(t)===h.personalAccountId&&t.amount>0&&transfer(t));
 const candidates=events.filter(e=>Number.isSafeInteger(e.amount)&&e.amount>0);
 const fits=(t,event)=>near(t,event)&&Math.round(-t.amount*100)===event.amount;
 // Saved extra deposits have a separate confirmation flow. Do not consume one
 // as a recurring contribution just because it happens to have the same amount.
 const extra=t=>(h.additionalDeposits||[]).some(d=>validDate(d.date)&&d.amount===Math.round(-t.amount*100)&&near(t,d));
 const record=(event,credit,debit)=>{
  used.add(transactionId(credit));if(debit)used.add(transactionId(debit));
  matches.set(event.id,{bankMatched:true,receivedDate:credit.date,transactionId:credit.transaction_id,...(debit?{debitTransactionId:debit.transaction_id}:{})});
 };
 // A user-confirmed source resolves overlapping dates and uncategorized bank deposits.
 for(const credit of credits){
  const people=Object.entries(h.contributionLinks||{}).filter(([,link])=>link.accountId===transactionAccountId(credit)&&link.merchant===merchantIdentity(credit.name));
  if(people.length!==1)continue;
  const type=people[0][0]==='mine'?'transfer':'contribution';
  const options=candidates.filter(e=>e.type===type&&!matches.has(e.id)&&fits(credit,e)).sort((a,b)=>distance(credit.date,a.date)-distance(credit.date,b.date));
  if(options[0]&&!extra(credit))record(options[0],credit);
 }
 // A posted transfer pair identifies your contribution even when the amounts
 // and scheduled dates overlap. Both sides may post on different days.
 for(const credit of credits){
  if(used.has(transactionId(credit))||extra(credit)||!transfer(credit))continue;
  const own=candidates.filter(e=>e.type==='transfer'&&!matches.has(e.id)&&fits(credit,e)).sort((a,b)=>distance(credit.date,a.date)-distance(credit.date,b.date));
  const event=own[0];if(!event||own[1]&&distance(credit.date,event.date)===distance(credit.date,own[1].date))continue;
  const debit=debits.filter(t=>!used.has(transactionId(t))&&near(t,event)&&distance(t.date,credit.date)<=contributionWindow&&Math.round(t.amount*100)===event.amount).sort((a,b)=>distance(a.date,credit.date)-distance(b.date,credit.date))[0];
  if(debit)record(event,credit,debit);
 }
 // Direct deposits and providers without categories need only the selected
 // bills account, exact amount, and one unambiguous nearby scheduled occurrence.
 // Include both people's schedules, even for the personal-only forecast.
 for(const credit of credits){
  if(used.has(transactionId(credit))||extra(credit))continue;
  const eligible=candidates.filter(e=>!matches.has(e.id)&&fits(credit,e)).sort((a,b)=>distance(credit.date,a.date)-distance(credit.date,b.date));
  const event=eligible[0];
  if(!event||eligible[1]&&distance(credit.date,event.date)===distance(credit.date,eligible[1].date))continue;
  record(event,credit);
 }
 return matches;
}
