const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
const usable=s=>s&&Number.isSafeInteger(s.balance)&&s.currency==='USD'&&!s.unavailable;
const fresh=(s,after,now)=>usable(s)&&time(s.updated)>=after&&time(s.updated)<=now;
export const paymentIdentity=receipt=>[receipt.mailboxId,receipt.sender,receipt.accountLast4||'',receipt.reference||receipt.id].join(':');

// A processing receipt confirms that payment was made. Scheduling alone does
// not, and neither an email nor elapsed time proves bank settlement.
export function paymentMade(message){
 if(message.paymentStatus==='failed')return false;
 if(message.paymentStatus==='posted')return true;
 if(message.paymentStage)return message.paymentStage==='submitted';
 const subject=message.subject||'';
 if(/\bschedul(?:ed|ing)\b|\bnot (?:yet )?received\b|\bhas not been received\b/i.test(subject))return false;
 return message.paymentStatus==='pending'&&/\breceipt\b|\bsubmitted\b|\bprocessing\b|\binitiated\b/i.test(subject);
}

export function rememberPaymentBalances(previous={},snapshots=[]){
 const next={...previous};
 for(const snapshot of snapshots){
  if(!usable(snapshot)||!time(snapshot.updated))continue;
  const rows=[...(next[snapshot.id]||[])],last=rows.at(-1);
  if(!last||time(snapshot.updated)>time(last.updated)&&last.balance!==snapshot.balance)rows.push({balance:snapshot.balance,updated:snapshot.updated,paymentIds:snapshot.pendingPaymentIds||[]});
  else if(last.balance===snapshot.balance&&snapshot.pendingPaymentIds?.length)rows[rows.length-1]={...last,paymentIds:[...new Set([...(last.paymentIds||[]),...snapshot.pendingPaymentIds])].slice(-100)};
  next[snapshot.id]=rows.slice(-90);
 }
 return next;
}

export function reconcilePayment(receipt,bank,{destinations=[],balanceHistory={},confirmations={},now=Date.now()}={}){
 const bankPaymentId=bank?.id||bank?.transaction_id||null;
 if(bankPaymentId&&confirmations[paymentIdentity(receipt)]?.bankPaymentId===bankPaymentId)return {bankPaymentId,bankPosted:true,cashReflected:true,balanceConfirmed:true,confirmed:true,awaiting:null};
 const submitted=time(receipt.submittedAt||receipt.receivedAt),after=Math.max(submitted,time(bank?.date)),bankPosted=!!bank;
 const cashReflected=bankPosted&&fresh(bank.balanceSnapshot,after,now);
 const balanceConfirmed=!destinations.length||destinations.some(snapshot=>{
  if(!fresh(snapshot,after,now))return false;
  if(snapshot.balance===0)return true;
  // An issuer payment record corroborates the refreshed issuer balance even
  // when new purchases or interest offset the payment's visible decrease.
  if((snapshot.payments||[]).some(p=>!p.pending&&p.amount===receipt.paymentAmount&&time(p.date)>=submitted-86400000&&time(p.date)<=submitted+14*86400000))return true;
  const prior=[...(balanceHistory[snapshot.id]||[]),...(snapshot.history||[])].filter(p=>usable({...p,currency:'USD'})&&time(p.updated||p.date)<time(snapshot.updated)&&(time(p.updated||p.date)<submitted||(p.paymentIds||[]).includes(paymentIdentity(receipt))));
  const before=prior.sort((a,b)=>time(b.updated||b.date)-time(a.updated||a.date))[0];
  return !!before&&before.balance-snapshot.balance>=receipt.paymentAmount;
 });
 return {bankPaymentId,bankPosted,cashReflected,balanceConfirmed,confirmed:bankPosted&&cashReflected&&balanceConfirmed,
  awaiting:!bankPosted?'bank':!cashReflected?'bank balance':!balanceConfirmed?'account balance':null};
}
