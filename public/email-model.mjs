import {day,occurrences} from './engine.mjs';
import {paymentTarget} from './transaction-links.mjs?v=plaid-restore1';
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const emailLink=message=>({mailboxId:message.mailboxId,sender:message.sender,accountLast4:message.accountLast4||'',selectedAt:new Date().toISOString(),selectedMessage:Object.fromEntries(['id','mailboxId','sender','accountLast4','receivedAt','amount','minimum','balance','dueDate','creditLimit','apr','paymentStatus','paymentAmount','paymentDate','reference'].map(key=>[key,message[key]??null]))});
export const matchesEmail=(message,link)=>!!link&&message.mailboxId===link.mailboxId&&message.sender===link.sender&&(!link.accountLast4||message.accountLast4===link.accountLast4);
export const usableBillAmount=m=>!!m&&!m.paymentStatus&&Number.isSafeInteger(m.amount)&&m.amount>=0;
export const emailDueDate=m=>m&&!m.paymentStatus&&/^\d{4}-\d{2}-\d{2}$/.test(m.dueDate||'')&&Number.isFinite(Date.parse(m.dueDate+'T12:00:00Z'))&&new Date(m.dueDate+'T12:00:00Z').toISOString().slice(0,10)===m.dueDate?m.dueDate:null;
export const completeBillStatement=m=>usableBillAmount(m)&&!!emailDueDate(m);
export function billStatement(messages,link,{now=Date.now()}={}){
 const matched=messages.filter(m=>matchesEmail(m,link)&&Date.parse(m.receivedAt)<=now);
 const selected=matched.find(m=>m.id===link?.selectedMessage?.id)||link?.selectedMessage;
 const anchor=matchesEmail(selected||{},link)&&Date.parse(selected.receivedAt)<=now&&usableBillAmount(selected)?selected:null;
 const candidates=matched.filter(completeBillStatement).sort((a,b)=>b.dueDate.localeCompare(a.dueDate)||b.receivedAt.localeCompare(a.receivedAt));
 if(!anchor)return candidates[0];
 return candidates.find(m=>Date.parse(m.receivedAt)>Date.parse(link.selectedAt||anchor.receivedAt)&&m.dueDate>=(anchor.dueDate||''))||anchor;
}
export function emailSuggestions(messages,name){const words=norm(name).split(' ').filter(w=>w.length>=4&&!['payment','credit','account','card','bill','loan','monthly','manual','personal'].includes(w));return messages.filter(m=>words.some(w=>norm(m.senderName+' '+m.sender+' '+m.subject).split(' ').includes(w)));}
export function emailAccountStatus(messages,link,{now=Date.now(),hasPlaid=false,bankPayments=[],creditCard=true,debtAccount=false}={}){
 const matched=messages.filter(m=>matchesEmail(m,link)&&Date.parse(m.receivedAt)<=now).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
 const selected=link?.selectedMessage;
 const debtStatements=[...matched];
 // Keep the fully read, explicitly linked statement when search results rotate.
 if(matchesEmail(selected||{},link)&&Date.parse(selected.receivedAt)<=now){
  const cached=debtStatements.find(m=>m.id===selected.id);
  if(!cached)debtStatements.push(selected);
  else if(!emailDueDate(cached)&&emailDueDate(selected))debtStatements[debtStatements.indexOf(cached)]={...cached,dueDate:selected.dueDate};
 }
 debtStatements.sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
 let statement=creditCard||debtAccount?debtStatements.find(m=>!m.paymentStatus&&(emailDueDate(m)||m.balance!=null||m.minimum!=null||m.amount!=null||m.apr!=null||m.creditLimit!=null)):billStatement(messages,link,{now});
 if(statement&&(creditCard||debtAccount)){
  statement={...statement,fieldUpdated:{}};
  for(const key of ['dueDate','minimum','balance','amount','apr','creditLimit']){
   if(statement[key]!=null){statement.fieldUpdated[key]=statement.receivedAt;continue;}
   const older=debtStatements.find(m=>!m.paymentStatus&&m[key]!=null&&Date.parse(statement.receivedAt)-Date.parse(m.receivedAt)<=31*86400000&&emailDueDate(m)&&
    (statement.dueDate?m.dueDate===statement.dueDate:m.dueDate>=statement.receivedAt.slice(0,10)));
   if(older){statement[key]=older[key];statement.fieldUpdated[key]=older.receivedAt;}
  }
 }
 const payments=[],usedBank=new Set(),usedMail=new Set(),events=debtStatements.filter(m=>m.paymentStatus);
 // Newest notice wins for an explicit confirmation number. Without one, pair
 // only an unambiguous amount/date match, so two equal payments stay separate.
 for(const message of events){
  if(usedMail.has(message.id))continue;
  let event={...message},related=message.reference?events.filter(m=>m.reference===message.reference):[];
  if(!related.length&&message.paymentStatus!=='pending'){
   const pending=events.filter(m=>!usedMail.has(m.id)&&m.paymentStatus==='pending'&&!m.reference&&m.paymentAmount===message.paymentAmount&&Date.parse(message.receivedAt)>=Date.parse(m.receivedAt)&&Date.parse(message.receivedAt)-Date.parse(m.receivedAt)<=7*86400000);
   if(pending.length===1)related=pending;
  }
  for(const m of related)usedMail.add(m.id);usedMail.add(message.id);
  const notices=[event,...related].filter(m=>m.paymentStatus==='pending');
  const submittedAt=Math.min(...(notices.length?notices:[event]).map(m=>Date.parse(m.receivedAt)));
  const paymentDate=event.paymentDate||notices.find(m=>m.paymentDate)?.paymentDate;
  let status=event.paymentStatus,estimated=false,postedDate=null;
  if(status==='pending'){
   const submitted=paymentDate?Date.parse(paymentDate):Date.parse(new Date(submittedAt).toISOString().slice(0,10));
   const bank=event.paymentAmount>0&&bankPayments.find(p=>!p.pending&&!usedBank.has(p.id||p.transaction_id)&&p.amount===event.paymentAmount&&Date.parse(p.date)>=submitted-86400000&&Date.parse(p.date)<=submitted+7*86400000);
   if(bank){status='posted';postedDate=bank.date;usedBank.add(bank.id||bank.transaction_id);}
   else if(!creditCard)status='pending';
   else if(!hasPlaid&&now-Math.max(submittedAt,paymentDate?Date.parse(paymentDate+'T00:00:00Z'):0)>=2*86400000){status='posted';estimated=true;postedDate=new Date(Math.max(submittedAt,paymentDate?Date.parse(paymentDate+'T00:00:00Z'):0)+2*86400000).toISOString().slice(0,10);}
   else status='pending';
  }
  payments.push({...event,paymentDate,status,estimated,postedDate});
 }
 return {statement,payments,pending:payments.filter(p=>p.status==='pending').reduce((sum,p)=>sum+(p.paymentAmount||0),0)};
}
export function emailBillUpdate(bill,messages,links){const statement=billStatement(messages,links['bill:'+bill.id]);return statement?{...bill,amount:statement.amount,date:completeBillStatement(statement)?statement.dueDate:bill.date,emailConfirmed:completeBillStatement(statement),emailAmountConfirmed:true,emailDueDate:completeBillStatement(statement)?statement.dueDate:null,emailMessageId:statement.id}:bill;}

// Match completed receipts to due-date occurrences, not the receipt's calendar month.
// Derive the result on every refresh so a returned payment removes confirmation.
export function emailBillPaymentStatuses(events,messages,links,{now=Date.now()}={}){
 const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 const localDate=value=>{
  if(!Number.isFinite(Date.parse(value)))return null;
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
 };
 const today=localDate(new Date(now).toISOString()),groups=new Map(),paid=new Map();
 for(const event of events){
  const target=event.emailTarget||paymentTarget(event);
  if(event.source==='tracker-debt'||!links?.[target]||!validDate(event.date))continue;
  if(!groups.has(target))groups.set(target,[]);
  groups.get(target).push(event);
 }
 for(const [target,bills]of groups){
  // A completed merchant receipt confirms the bill before the bank posts it.
  // Pending notices never use the credit-card two-day estimate.
  const {payments}=emailAccountStatus(messages,links[target],{now,creditCard:false});
  const totals=new Map(),dates=new Map(),seen=new Set();
  for(const receipt of payments){
   if(receipt.status!=='posted'||receipt.estimated||!Number.isSafeInteger(receipt.paymentAmount)||receipt.paymentAmount<=0)continue;
   const date=validDate(receipt.paymentDate)?receipt.paymentDate:localDate(receipt.receivedAt);
   if(!date||date>today)continue;
   // Never apply a sender shared by ambiguous account links to multiple bills.
   if(Object.values(links).filter(link=>matchesEmail(receipt,link)).length!==1)continue;
   const identity=receipt.reference||date+':'+receipt.paymentAmount;
   if(seen.has(identity))continue;seen.add(identity);
   // Without a shared reference, a nearby return makes the receipt uncertain.
   if(payments.some(p=>p.status==='failed'&&(!p.reference||!receipt.reference)&&p.paymentAmount===receipt.paymentAmount&&p.receivedAt>=receipt.receivedAt&&Date.parse(p.receivedAt)-Date.parse(receipt.receivedAt)<=7*86400000))continue;
   const candidates=bills.filter(b=>{
    if(validDate(receipt.dueDate))return b.date===receipt.dueDate;
    const start=b.statementDate&&b.statementDate<b.date?day(b.statementDate,1):day(b.date,b.repeat==='weekly'?-3:-7);
    return date>=start&&date<=day(b.date,b.repeat==='weekly'?3:14);
   })
    .sort((a,b)=>Math.abs(Date.parse(a.date)-Date.parse(date))-Math.abs(Date.parse(b.date)-Date.parse(date))||a.date.localeCompare(b.date));
   const bill=candidates[0];
   if(bill){totals.set(bill.key,(totals.get(bill.key)||0)+receipt.paymentAmount);if(!dates.has(bill.key)||dates.get(bill.key)<date)dates.set(bill.key,date);}
  }
  for(const bill of bills)if(bill.amount>0&&totals.has(bill.key))paid.set(bill.key,{key:bill.key,dueDate:bill.date,paidDate:dates.get(bill.key),paidAmount:totals.get(bill.key),remaining:Math.max(0,bill.amount-totals.get(bill.key)),paid:totals.get(bill.key)>=bill.amount});
 }
 return [...paid.values()];
}
export function matchedEmailBillPayments(events,messages,links,options){return emailBillPaymentStatuses(events,messages,links,options).filter(p=>p.paid);}

// Debt cards use the statement minimum/installment, never the whole balance or
// a simulated snowball payment, to determine whether this cycle has been paid.
export function emailDebtPaymentStatus(messages,links,target,{amount,dueDate,statementDate,now=Date.now()}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate||'')||!(amount>0))return null;
 const today=new Date(now).toISOString().slice(0,10),month=today.slice(0,7)+'-01';
 if(dueDate<month)dueDate=occurrences(dueDate,'monthly',month,day(month,31))[0];
 if(!dueDate)return null;
 const d=new Date(dueDate+'T12:00Z'),previous=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0,12));
 previous.setUTCDate(Math.min(d.getUTCDate(),previous.getUTCDate()));
 const event={id:target,key:target+':'+dueDate,emailTarget:target,date:dueDate,amount,repeat:'monthly',statementDate:statementDate&&statementDate<dueDate?statementDate:previous.toISOString().slice(0,10)};
 return emailBillPaymentStatuses([event],messages,links,{now})[0]||null;
}
