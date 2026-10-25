import {day} from './engine.mjs';
export const transactionKey=t=>JSON.stringify([t.itemId,t.account_id,String(t.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()]);
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function classifyBankTransaction(t){
 const name=normalize(t.name),category=t.category||'';
 if(t.pending||t.currency!=='USD'||!Number.isFinite(t.amount)||t.amount<=0)return {kind:'excluded'};
 if(/TRANSFER|LOAN_PAYMENTS|BANK_FEES|INCOME/.test(category)||/\b(transfer|credit card|visa payment|loan payment|mortgage|cash withdrawal|atm withdrawal)\b/.test(name))return {kind:'excluded'};
 // Spending categories take precedence over timing and merchant keywords.
 const spending=[[/FOOD_AND_DRINK.*GROCERIES|GROCERIES/,'groceries','Groceries'],[/FOOD_AND_DRINK/,'dining','Dining'],[/TRANSPORTATION|GAS_STATIONS/,'transport','Transport'],[/GENERAL_MERCHANDISE|HOME_IMPROVEMENT/,'shopping','Shopping'],[/MEDICAL|PERSONAL_CARE/,'personal','Health & personal'],[/TRAVEL/,'travel','Travel']];
 for(const [pattern,key,label]of spending)if(pattern.test(category))return {kind:'spending',key,label};
 if(/\b(mc ?donald s?|mcdonalds|starbucks|taco bell|burger king|wendy s?|restaurant|cafe|coffee|pizza|grocery|groceries|supermarket)\b/.test(name))return {kind:'spending',key:'dining',label:'Dining'};
 if(/RENT_AND_UTILITIES_RENT$/.test(category)||/\b(rent|apartment lease)\b/.test(name))return {kind:'bill',billKind:'rent',reason:'Rent payment'};
 if(/RENT_AND_UTILITIES|INSURANCE/.test(category))return {kind:'bill',billKind:/ELECTRICITY/.test(category)?'electric':'utility',reason:'Bank classified this as a utility or insurance payment'};
 if(/\b(consumers energy|electric(?:ity)?(?: bill| payment| company)?|insurance|sewer|water (?:bill|department|dept|utility)|internet|wireless|comcast|spectrum|verizon|at t)\b/.test(name))return {kind:'bill',billKind:/consumers energy|electric/.test(name)?'electric':'utility',reason:'Recognized utility or insurance payment'};
 if(/\b(netflix|spotify|hulu|disney plus|disneyplus|apple music|youtube premium|subscription)\b/.test(name))return {kind:'bill',billKind:'subscription',reason:'Recognized subscription'};
 if(/ENTERTAINMENT/.test(category))return {kind:'spending',key:'entertainment',label:'Entertainment'};
 return {kind:'spending',key:'other',label:'Other spending'};
}
export function personalSpending(transactions,today=new Date().toISOString().slice(0,10)){
 const start=day(today,-29),groups=new Map();let oldest=null;
 for(const t of transactions||[]){
  if(t.date<start||t.date>today)continue;
  const kind=classifyBankTransaction(t);if(kind.kind!=='spending')continue;
  const amount=Math.round(t.amount*100);if(!Number.isSafeInteger(amount)||amount<=0)continue;
  const g=groups.get(kind.key)||{key:kind.key,label:kind.label,amount:0,count:0};g.amount+=amount;g.count++;groups.set(kind.key,g);
  if(!oldest||t.date<oldest)oldest=t.date;
 }
 const categories=[...groups.values()].sort((a,b)=>b.amount-a.amount);
 return {start,end:today,total:categories.reduce((n,g)=>n+g.amount,0),categories};
}


export function reviewBankActivity(transactions,rules={},suggestions=[],today=new Date().toISOString().slice(0,10)){
 const start=day(today,-29),recent=(transactions||[]).filter(t=>!t.pending&&t.currency==='USD'&&t.amount>0&&t.date>=start&&t.date<=today).sort((a,b)=>b.date.localeCompare(a.date));
 const groups=new Map(),categories=new Map();
 const rows=recent.map(t=>{
  const key=transactionKey(t),rule=rules[key],kind=classifyBankTransaction(t),choice=rule?.choice|| (kind.kind==='spending'?'spending':kind.kind==='excluded'?'excluded':'suggested');
  if(!groups.has(key))groups.set(key,t);
  if(choice==='spending'){
   const cat=kind.kind==='spending'?kind:{key:'other',label:'Other spending'},g=categories.get(cat.key)||{key:cat.key,label:cat.label,amount:0,count:0};g.amount+=Math.round(t.amount*100);g.count++;categories.set(cat.key,g);
  }
  return {...t,key,choice,label:choice==='bill'?'Tracked bill':choice==='excluded'?'Transfer or debt payment':choice==='suggested'?'Possible bill':kind.kind==='spending'?kind.label:'Personal spending',reason:kind.reason};
 });
 const bills=[];
 for(const [key,rule]of Object.entries(rules))if(rule.choice==='bill'){
  const latest=groups.get(key),suggestion=suggestions.find(b=>b.groupKey===key),date=latest?.date||rule.lastPayment;
  if(!date)continue;
  const repeat=rule.repeat||'monthly';
  let next=repeat==='monthly'?nextMonth(date):day(date,repeat==='weekly'?7:repeat==='biweekly'?14:0);
  // A user's tracked bill remains scheduled even if the bank has not posted the next payment yet.
  for(let n=0;next<today&&n<120&&repeat!=='once';n++)next=repeat==='monthly'?nextMonth(next):day(next,repeat==='weekly'?7:14);
  bills.push({id:rule.id,name:latest?.name||rule.name,amount:latest?Math.round(latest.amount*100):rule.amount,date:next,repeat,source:'bank-tracked',billKind:suggestion?.billKind||classifyBankTransaction(latest||{name:rule.name,amount:1,currency:'USD'}).billKind,lastPayment:date,groupKey:key});
 }
 return {rows,bills,spending:{start,end:today,total:[...categories.values()].reduce((n,c)=>n+c.amount,0),categories:[...categories.values()].sort((a,b)=>b.amount-a.amount)}};
}
function nextMonth(date){const d=new Date(date+'T12:00:00Z'),n=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(n,last));return d.toISOString().slice(0,10);}
