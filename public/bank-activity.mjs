import {categorizeTransaction} from './transaction-categories.mjs?v=auto-categories1';
import {transactionAccountId} from './transaction-links.mjs?v=plaid-restore1';
import {day} from './engine.mjs';
import {emailAccountStatus,matchesEmail} from './email-model.mjs';
import {paymentTarget,matchesPayment,matchingPayments,paymentOwner,paymentTargets,postedPayment} from './transaction-links.mjs';
export const transactionKey=t=>JSON.stringify([t.itemId,t.account_id,String(t.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()]);
// Details use every available posted payment, independently of the 30-day
// activity view or selected bill month. Explicit links/assignments take priority.
export function accountPaymentHistory(transactions,target,rules={},links={},today=new Date().toISOString().slice(0,10)){
 if(links[target])return matchingPayments(transactions,links[target],today,links,target);
 const keys=new Set(Object.entries(rules).filter(([,rule])=>rule.choice==='bill'&&'bill:'+rule.id===target).map(([key])=>key)),seen=new Set();
 return (transactions||[]).filter(t=>{
  if(!postedPayment(t)||!t.date||t.date>today||!keys.has(transactionKey(t))||paymentTargets(t,links).length||seen.has(t.transaction_id))return false;
  seen.add(t.transaction_id);return true;
 }).sort((a,b)=>b.date.localeCompare(a.date)||String(a.transaction_id).localeCompare(String(b.transaction_id)));
}
// Receipt-backed matches tolerate changing ACH descriptors. Match the creditor's
// identity as whole words so Capital One and Credit One cannot overlap.
const words=value=>String(value||'').toLowerCase()
 .replace(/\b(?:capital\s*(?:one|1)|cap\s*(?:one|1))\b/g,'capitalone')
 .replace(/\bcredit\s*one(?:bank)?\b/g,'creditone')
 .replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/);
const generic=new Set('account accounts alerts alert ach american autopay auto bank banking bill billing card cards cash center checking com company confirmation corp credit customer debit debt email financial financing info insurance lender lending loan mobile monthly mortgage my net notice notification notifications online org pay payment payments pending personal platinum processing pymt pmt receipt rewards scheduled service services statement submitted support thank transfer visa your'.split(' '));
function debtReceiptMerchant(t,identities,last4){
 const description=[t.name,t.merchant_name].filter(Boolean).join(' ');
 if(/\b(?:refund|reward|cashback|return(?:ed)?|reversal|reversed|failed|declined)\b/i.test(description)||!(/\b(?:payment|pymt|pmt|autopay|epay|e-?payment)\b/i.test(description)||/LOAN_PAYMENTS/.test(t.category||'')))return false;
 const suffix=description.match(/(?:\bending\s+(?:in\s+)?|\bcard\s+(?:no\.?\s*)?|\bx{2,}|\*{2,})(\d{4})\b/i)?.[1];
 if(suffix&&last4&&suffix!==last4)return false;
 const merchant=new Set(words(description));
 return identities.some(identity=>words(identity).some(word=>word.length>=4&&!generic.has(word)&&!/^\d+$/.test(word)&&merchant.has(word)));
}
function conflictingDebtLink(t,target,links){
 return Object.entries(links).some(([other,link])=>other!==target&&link.accountId===t.account_id&&link.itemId===t.itemId&&(link.amount==null||link.amount===Math.round(t.amount*100))&&debtReceiptMerchant(t,[link.merchant,link.targetName]));
}

// Supplement explicit links with corroborated payment evidence. Never save these
// guesses as merchant rules: corrections and removed transactions must undo them.
export function inferredBillPaymentHistory(events,transactions,{rules={},links={},emailLinks={},messages=[],accounts=[],funding={},today=new Date().toISOString().slice(0,10),now=Date.now()}={}){
 const groups=new Map(),result=new Map(),claimed=new Set();
 transactions=[...new Map((transactions||[]).map(t=>[t.transaction_id,t])).values()];
 for(const bill of events){
  const target=paymentTarget(bill);
  if(/^(debt|credit):/.test(target)&&!emailLinks[target])continue;
  if(!groups.has(target))groups.set(target,[]);
  groups.get(target).push(bill);
 }
 // A debt can have a receipt even when it has no scheduled minimum.
 for(const target of Object.keys(emailLinks))if(/^(debt|credit):/.test(target)&&!groups.has(target))groups.set(target,[]);
 const linkedHistory=new Map();
 for(const target of groups.keys()){
  const history=accountPaymentHistory(transactions,target,rules,links,today);
  linkedHistory.set(target,history);
  for(const t of history)claimed.add(t.transaction_id);
 }
 const noise=new Set('payment payments bill billing receipt reference transaction purchase submitted processing scheduled received posted confirmation online automatic debit credit ach pos card account monthly insurance renters renter rent home policy the for and from com net org email mail noreply www'.split(' '));
 const merchantMatches=(t,bill,link,receipt)=>{
  const merchant=normalize(t.name+' '+(t.merchant_name||'')),words=new Set(merchant.split(' '));
  const identity=normalize([bill.name,link?.name,link?.merchant,receipt?.senderName,receipt?.sender?.split('@')[1],receipt?.subject].filter(Boolean).join(' '));
  if(identity.split(' ').some(word=>word.length>=4&&!noise.has(word)&&!/^[0-9]+$/.test(word)&&words.has(word)))return true;
  const kind=categorizeTransaction(t).billKind;
  if(['rent','electric','insurance','phone-internet','utility'].includes(bill.billKind)&&kind===bill.billKind)return true;
  return bill.billKind==='rent'&&/\b(?:sun communities|sun homes|suncommunities|sunwebportal)\b/.test(merchant)
   ||bill.billKind==='insurance'&&/\b(?:assurant|esurance|homesite|lemonade|resident ?shield)\b/.test(merchant);
 };
 const candidates=[];
 for(const [target,bills]of groups){
  const debt=/^(debt|credit):/.test(target),link=links[target];if(link?.sharedMerchant)continue;
  const bankPayments=debt?linkedHistory.get(target).map(t=>({...t,id:t.transaction_id,amount:Math.round(t.amount*100)})):[];
  const notices=emailLinks[target]?emailAccountStatus(messages,emailLinks[target],{now,bankPayments,creditCard:false}).payments:[];
  const receipts=notices.filter(p=>p.paymentMade&&!p.bankPosted&&Object.values(emailLinks).filter(l=>matchesEmail(p,l)).length===1);
  for(const t of transactions||[]){
   if(!postedPayment(t)||!t.date||t.date>today||claimed.has(t.transaction_id)||paymentTargets(t,links).length)continue;
   const account=accounts.find(a=>a.id===transactionAccountId(t));
   if(!account||account.accountMissing||account.type!=='depository'||account.currency!=='USD')continue;
   if(debt&&link&&(link.itemId!==t.itemId||transactionAccountId(link.accountId)!==account.id))continue;
   const rule=rules[transactionKey(t)];if(rule&&(rule.choice!=='bill'||'bill:'+rule.id!==target))continue;
   const amount=Math.round(t.amount*100);if(link?.amount!=null&&link.amount!==amount)continue;
   const matchingReceipts=receipts.filter(p=>{
    const date=p.paymentDate||(p.submittedAt||p.receivedAt).slice(0,10);
    return p.paymentAmount===amount&&t.date>=day(date,-1)&&t.date<=day(date,14)&&(debt?debtReceiptMerchant(t,[bills[0]?.name,link?.targetName,p.senderName,p.sender?.split('@')[1]],emailLinks[target].accountLast4||p.accountLast4):merchantMatches(t,bills[0],link,p));
   });
   if(debt&&matchingReceipts.length!==1)continue;
   const receipt=matchingReceipts[0];
   const bill=debt?null:bills.filter(b=>amount===b.amount&&t.date>=day(b.date,b.repeat==='weekly'?-3:-7)&&t.date<=day(b.date,b.repeat==='weekly'?3:14)&&merchantMatches(t,b,link,null))
    .sort((a,b)=>Math.abs(Date.parse(a.date)-Date.parse(t.date))-Math.abs(Date.parse(b.date)-Date.parse(t.date)))[0];
   // Statement-only links still allow a posted payment to settle the bill,
   // while a nearby failure must not be replaced by a scheduled-amount guess.
   if(!receipt&&!bill||notices.some(p=>p.status==='failed'&&p.paymentAmount===amount&&p.receivedAt.slice(0,10)>=day(t.date,-7)&&p.receivedAt.slice(0,10)<=day(t.date,14)))continue;
   const evidence=receipt?'receipt:'+(receipt.reference||receipt.id):'cycle:'+bill.key;
   candidates.push({target,t,evidence,preferred:funding[target]===account.id});
  }
 }
 for(const candidate of candidates){
  // One bank transaction cannot pay two bills, even if their amounts coincide.
  if(new Set(candidates.filter(c=>c.t.transaction_id===candidate.t.transaction_id).map(c=>c.target)).size!==1)continue;
  if(/^(debt|credit):/.test(candidate.target)&&conflictingDebtLink(candidate.t,candidate.target,links))continue;
  const peers=candidates.filter(c=>c.target===candidate.target&&c.evidence===candidate.evidence);
  // Multiple bank feeds can expose the same payment. Prefer the chosen funding
  // account; otherwise require a single candidate instead of double counting.
  const preferred=peers.filter(c=>c.preferred),pool=preferred.length?preferred:peers;
  if(pool.length!==1||pool[0]!==candidate)continue;
  if(!result.has(candidate.target))result.set(candidate.target,[]);
  if(!result.get(candidate.target).some(t=>t.transaction_id===candidate.t.transaction_id))result.get(candidate.target).push(candidate.t);
 }
 return result;
}
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function classifyBankTransaction(t,preferences={}){
 if(t.pending||t.currency!=='USD'||!Number.isFinite(t.amount)||t.amount<=0)return {kind:'excluded'};
 const result=categorizeTransaction(t,preferences);
 return {...result,...(result.kind==='bill'?{reason:'Recognized '+result.label.toLowerCase()+' payment'}:{})};
}
export function personalSpending(transactions,today=new Date().toISOString().slice(0,10),preferences={}){
 const start=day(today,-29),groups=new Map();let oldest=null;
 for(const t of transactions||[]){
  if(t.date<start||t.date>today)continue;
  const kind=classifyBankTransaction(t,preferences);if(kind.kind!=='spending')continue;
  const amount=Math.round(t.amount*100);if(!Number.isSafeInteger(amount)||amount<=0)continue;
  const g=groups.get(kind.key)||{key:kind.key,label:kind.label,amount:0,count:0};g.amount+=amount;g.count++;groups.set(kind.key,g);
  if(!oldest||t.date<oldest)oldest=t.date;
 }
 const categories=[...groups.values()].sort((a,b)=>b.amount-a.amount);
 return {start,end:today,total:categories.reduce((n,g)=>n+g.amount,0),categories};
}


export function reviewBankActivity(transactions,rules={},suggestions=[],today=new Date().toISOString().slice(0,10),links={},preferences={}){
 const start=day(today,-29),recent=(transactions||[]).filter(t=>t.currency==='USD'&&Number.isFinite(t.amount)&&t.amount!==0&&t.date>=start&&t.date<=today).sort((a,b)=>b.date.localeCompare(a.date));
 const groups=new Map(),categories=new Map();
 const rows=recent.map(t=>{
  if(t.amount<0||t.pending)return {...t,key:transactionKey(t),choice:t.amount<0?'deposit':'pending',categoryLabel:t.amount<0?'Deposit':'Pending payment',label:t.pending?'Pending':'Posted',incoming:t.amount<0};
  const key=transactionKey(t),savedRule=rules[key],rule=savedRule&&(!links['bill:'+savedRule.id]||matchesPayment(t,links['bill:'+savedRule.id],links,'bill:'+savedRule.id))?savedRule:null,kind=classifyBankTransaction(t,preferences),linkedTarget=paymentOwner(t,links),targets=paymentTargets(t,links),needsPaymentAssignment=!linkedTarget&&targets.length>0,choice=needsPaymentAssignment?'excluded':linkedTarget||rule?.choice==='bill'?'bill':(kind.source==='automatic'?rule?.choice:null)||(kind.kind==='spending'?'spending':kind.kind==='excluded'?'excluded':'suggested');
  if(!groups.has(key))groups.set(key,t);
  if(choice==='spending'){
   const cat=kind.kind==='spending'?kind:{key:'other',label:'Other spending'},g=categories.get(cat.key)||{key:cat.key,label:cat.label,amount:0,count:0};g.amount+=Math.round(t.amount*100);g.count++;categories.set(cat.key,g);
  }
  return {...t,key,choice,linkedTarget,paymentTargets:targets,needsPaymentAssignment,categoryKey:kind.key,categoryLabel:kind.label,spendingCategoryKey:kind.kind==='spending'?kind.key:'other',label:needsPaymentAssignment?'Choose payment account':linkedTarget?'Linked to '+(links[linkedTarget].targetName||'account'):choice==='bill'?'Tracked bill':choice==='excluded'?'Transfer or debt payment':choice==='suggested'?'Possible bill':kind.kind==='spending'?kind.label:'Personal spending',reason:kind.reason};
 });
 const bills=[];
 for(const [key,rule]of Object.entries(rules))if(rule.choice==='bill'){
  const link=links['bill:'+rule.id],latest=link?matchingPayments(transactions,link,today,links,'bill:'+rule.id)[0]:groups.get(key),suggestion=suggestions.find(b=>b.groupKey===key),date=latest?.date||rule.lastPayment;
  if(!date)continue;
  const repeat=rule.repeat||'monthly';
  let next=repeat==='monthly'?nextMonth(date):day(date,repeat==='weekly'?7:repeat==='biweekly'?14:0);
  // A user's tracked bill remains scheduled even if the bank has not posted the next payment yet.
  for(let n=0;next<today&&n<120&&repeat!=='once';n++)next=repeat==='monthly'?nextMonth(next):day(next,repeat==='weekly'?7:14);
  bills.push({id:rule.id,name:rule.name||latest?.name,amount:latest?Math.round(latest.amount*100):rule.amount,date:next,repeat,source:'bank-tracked',billKind:rule.billKind||suggestion?.billKind||classifyBankTransaction(latest||{name:rule.name,amount:1,currency:'USD'}).billKind,lastPayment:date,groupKey:key});
 }
 return {rows,bills,spending:{start,end:today,total:[...categories.values()].reduce((n,c)=>n+c.amount,0),categories:[...categories.values()].sort((a,b)=>b.amount-a.amount)}};
}
function nextMonth(date){const d=new Date(date+'T12:00:00Z'),n=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(n,last));return d.toISOString().slice(0,10);}

// Posted outflows from the selected bills account, including tracked bills and debt payments.
export function billsAccountSpending(transactions,account,today,rules={},links={},preferences={}){
 const start=day(today,-29),groups=new Map(),rows=[];
 if(!['plaid','lunchflow'].includes(account?.source))return {categories:[],total:0,rows};
 for(const t of transactions){
  if(transactionAccountId(t)!==account.id||t.pending||t.currency!=='USD'||!(t.amount>0)||!Number.isFinite(t.amount)||t.date<start||t.date>today)continue;
  const linked=links[paymentOwner(t,links)],rule=rules[transactionKey(t)],tracked=rule?.choice==='bill';
  const kind=classifyBankTransaction(t,preferences),billKind=rule?.billKind||kind.billKind,corrected=kind.source!=='automatic';
  if(kind.key==='transfer'&&(corrected||!linked&&!tracked))continue;
  const label=(corrected?kind.label:null)||linked?.targetName||(tracked?rule.name:null)||({rent:'Rent',electric:'Electric',utility:'Utilities',insurance:'Insurance','car-payment':'Car payments'})[billKind]||kind.label||'Other spending';
  const key=normalize(label),amount=Math.round(t.amount*100),group=groups.get(key)||{key,label,amount:0,count:0};group.amount+=amount;group.count++;groups.set(key,group);rows.push({...t,categoryKey:kind.key,categoryLabel:kind.label,spendingLabel:label,spendingCategoryKey:key});
 }
 const categories=[...groups.values()].sort((a,b)=>b.amount-a.amount);return {categories,total:categories.reduce((n,g)=>n+g.amount,0),rows:rows.sort((a,b)=>b.date.localeCompare(a.date))};
}

