const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const emailLink=message=>({mailboxId:message.mailboxId,sender:message.sender,accountLast4:message.accountLast4||'',selectedAt:new Date().toISOString(),selectedMessage:Object.fromEntries(['id','mailboxId','sender','accountLast4','receivedAt','amount','minimum','balance','dueDate','paymentStatus'].map(key=>[key,message[key]??null]))});
export const matchesEmail=(message,link)=>!!link&&message.mailboxId===link.mailboxId&&message.sender===link.sender&&(!link.accountLast4||message.accountLast4===link.accountLast4);
export const usableBillAmount=m=>!!m&&!m.paymentStatus&&Number.isSafeInteger(m.amount)&&m.amount>=0;
export const completeBillStatement=m=>usableBillAmount(m)&&/^\d{4}-\d{2}-\d{2}$/.test(m.dueDate||'')&&Number.isFinite(Date.parse(m.dueDate+'T12:00:00Z'))&&new Date(m.dueDate+'T12:00:00Z').toISOString().slice(0,10)===m.dueDate;
export function billStatement(messages,link,{now=Date.now()}={}){
 const matched=messages.filter(m=>matchesEmail(m,link)&&Date.parse(m.receivedAt)<=now);
 const selected=matched.find(m=>m.id===link?.selectedMessage?.id)||link?.selectedMessage;
 const anchor=matchesEmail(selected||{},link)&&Date.parse(selected.receivedAt)<=now&&usableBillAmount(selected)?selected:null;
 const candidates=matched.filter(completeBillStatement).sort((a,b)=>b.dueDate.localeCompare(a.dueDate)||b.receivedAt.localeCompare(a.receivedAt));
 if(!anchor)return candidates[0];
 return candidates.find(m=>Date.parse(m.receivedAt)>Date.parse(link.selectedAt||anchor.receivedAt)&&m.dueDate>=(anchor.dueDate||''))||anchor;
}
export function emailSuggestions(messages,name){const words=norm(name).split(' ').filter(w=>w.length>=4&&!['payment','credit','account','card','bill','loan','monthly','manual','personal'].includes(w));return messages.filter(m=>words.some(w=>norm(m.senderName+' '+m.sender+' '+m.subject).split(' ').includes(w)));}
export function emailAccountStatus(messages,link,{now=Date.now(),hasPlaid=false,bankPayments=[],creditCard=true}={}){
 const matched=messages.filter(m=>matchesEmail(m,link)&&Date.parse(m.receivedAt)<=now).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt));
 const statement=creditCard?matched.find(m=>!m.paymentStatus&&(m.dueDate||m.balance!=null||m.minimum!=null||m.amount!=null)):billStatement(messages,link,{now});
 const payments=[],usedBank=new Set(),usedMail=new Set(),events=matched.filter(m=>m.paymentStatus);
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
  if(status==='pending'||status==='posted'&&hasPlaid){
   const submitted=paymentDate?Date.parse(paymentDate):Date.parse(new Date(submittedAt).toISOString().slice(0,10));
   const bank=event.paymentAmount>0&&bankPayments.find(p=>!p.pending&&!usedBank.has(p.id||p.transaction_id)&&p.amount===event.paymentAmount&&Date.parse(p.date)>=submitted-86400000&&Date.parse(p.date)<=submitted+7*86400000);
   if(bank){status='posted';postedDate=bank.date;usedBank.add(bank.id||bank.transaction_id);}
   else if(!creditCard)continue;
   else if(!hasPlaid&&now-Math.max(submittedAt,paymentDate?Date.parse(paymentDate+'T00:00:00Z'):0)>=2*86400000){status='posted';estimated=true;postedDate=new Date(Math.max(submittedAt,paymentDate?Date.parse(paymentDate+'T00:00:00Z'):0)+2*86400000).toISOString().slice(0,10);}
   else status='pending';
  }
  payments.push({...event,status,estimated,postedDate});
 }
 return {statement,payments,pending:payments.filter(p=>p.status==='pending').reduce((sum,p)=>sum+(p.paymentAmount||0),0)};
}
export function emailBillUpdate(bill,messages,links){const statement=billStatement(messages,links['bill:'+bill.id]);return statement?{...bill,amount:statement.amount,date:completeBillStatement(statement)?statement.dueDate:bill.date,emailConfirmed:completeBillStatement(statement),emailAmountConfirmed:true,emailDueDate:completeBillStatement(statement)?statement.dueDate:null,emailMessageId:statement.id}:bill;}
