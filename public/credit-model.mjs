// Values exposed to the browser are explicit, nullable and expressed in cents.
const amount=n=>typeof n==='number'&&Number.isFinite(n)&&Number.isSafeInteger(Math.round(n*100))?Math.round(n*100):null;
const date=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+'T12:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null;};
export function normalizeCreditCards(response,item,previous=[],now=new Date().toISOString()){
 const details=new Map((response.liabilities?.credit||[]).map(c=>[c.account_id,c]));
 return (response.accounts||[]).filter(a=>a.type==='credit').map(a=>{
  const d=details.get(a.account_id),id='credit-'+a.account_id,old=previous.find(c=>c.id===id),balance=amount(a.balances?.current);
  const history=(old?.history||[]).filter(p=>p.date!==now.slice(0,10)).slice(-89);if(balance!==null)history.push({date:now.slice(0,10),balance});
  return {id,accountId:a.account_id,itemId:item.id,institution:item.name,name:a.name,mask:a.mask||'',currency:a.balances?.iso_currency_code||null,balance,limit:amount(a.balances?.limit),minimum:amount(d?.minimum_payment_amount),dueDate:date(d?.next_payment_due_date),statementBalance:amount(d?.last_statement_balance),statementDate:date(d?.last_statement_issue_date),lastPayment:amount(d?.last_payment_amount),lastPaymentDate:date(d?.last_payment_date),overdue:d?.is_overdue??null,aprs:(d?.aprs||[]).filter(p=>typeof p.apr_percentage==='number'&&Number.isFinite(p.apr_percentage)).map(p=>({type:String(p.apr_type||'other'),rate:p.apr_percentage})),detailsAvailable:!!d,updated:now,history};
 });
}
export function cardPayments(card,transactions=[]){
 const payments=transactions.filter(t=>t.itemId===card.itemId&&t.account_id===card.accountId&&!t.pending&&t.currency===card.currency&&t.amount<0&&!/refund|reversal|cashback|cash back|reward/i.test(t.name||'')&&(/LOAN_PAYMENTS_CREDIT_CARD_PAYMENT/.test(t.category||'')||/\bpayment\b/i.test(t.name||''))).map(t=>({id:t.transaction_id,date:t.date,amount:Math.round(-t.amount*100),name:t.name,source:'transaction'}));
 if(card.lastPayment>0&&card.lastPaymentDate&&!payments.some(p=>p.date===card.lastPaymentDate&&p.amount===card.lastPayment))payments.push({id:'issuer-'+card.lastPaymentDate,date:card.lastPaymentDate,amount:card.lastPayment,name:'Last payment reported by issuer',source:'issuer'});
 return payments.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,50);
}
export function creditBills(cards,preferences={}){
 return cards.flatMap(card=>{
  const p=preferences[card.id];if(!p?.tracking||card.currency!=='USD')return [];
  const amount=card.minimum??p.fallbackAmount,date=card.dueDate||p.fallbackDate;
  if(!Number.isSafeInteger(amount)||amount<=0||!date||card.balance!==null&&card.balance<=0)return [];
  return [{id:card.id,cardId:card.id,name:p.name||card.name,amount,date,repeat:'once',source:'plaid-credit',billKind:'credit-card',covered:!!p.covered,confirmed:card.minimum!==null&&!!card.dueDate,replaces:p.replaces||null}];
 });
}
