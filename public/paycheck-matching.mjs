import {day} from './engine.mjs';
import {transactionAccountId,merchantIdentity} from './transaction-links.mjs?v=plaid-restore1';

const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&day(d,0)===d;
const names=t=>[t?.name,t?.originalName,t?.original_description,t?.originalDescription,t?.description,t?.merchant_name].filter(name=>typeof name==='string'&&name.trim());
const description=t=>[...names(t),String(t.category||'').replaceAll('_',' ')].join(' ');
const payrollEvidence=t=>/^INCOME_(WAGES|SALARY)(_|$)/.test(t.category||'')||/\b(payroll|payrol|pay\s*check|salary|salaries)\b/i.test(description(t));
const identities=t=>names(t).map(merchantIdentity);
const genericEmployerWords=new Set(['ach','credit','deposit','direct','dep','dd','income','payroll','payrol','salary','payment','pay','check','paycheck','wages','transfer','online','electronic','from','to','account','checking','savings']);
const employerIdentity=name=>name.split(' ').some(word=>/[a-z]/.test(word)&&!genericEmployerWords.has(word));
export const postedPaycheck=t=>!!t?.transaction_id&&!t.pending&&t.currency==='USD'&&Number.isFinite(t.amount)&&t.amount<0&&validDate(t.date)&&!/\b(refund|reversal|reversed|returned|cashback|cash back|reward|interest)\b/i.test(description(t));
export function paycheckOccurrence(startDate,date){
 if(!validDate(startDate)||!validDate(date))return null;
 const n=Math.round((Date.parse(date)-Date.parse(startDate))/86400000/14),scheduledDate=day(startDate,n*14);
 return n>=0&&Math.abs(Date.parse(date)-Date.parse(scheduledDate))/86400000<=3?{paycheck:n+1,scheduledDate}:null;
}

// Checkboxes record completed plans; they are not required to advance the
// calendar. A received early deposit also removes its scheduled payday from
// "next", without changing that payday or completing any planned payments.
export function nextPaycheckNumber(state,today,receipts={}){
 if(!validDate(state?.startDate)||!validDate(today))return null;
 let n=Math.max(1,Math.ceil((Date.parse(today)-Date.parse(state.startDate))/86400000/14)+1);
 while(state.checkedPaychecks?.[n]||receipts[n])n++;
 return n;
}

// Use one selected account, a confirmed employer or explicit payroll evidence,
// and one unambiguous posted deposit. Recompute so corrections can undo matches.
export function matchPaychecks({state={},transactions=[],accountId,link,today}){
 if(!accountId||!validDate(today))return {};
 const source=link?.accountId===accountId?link:null;
 const posted=transactions.filter(t=>postedPaycheck(t)&&t.date<=today&&transactionAccountId(t)===accountId);
 // Banks sometimes omit the category on a new deposit. A prior, explicitly
 // identified payroll deposit on this same account can identify its employer.
 const employers=new Set(posted.filter(t=>payrollEvidence(t)&&paycheckOccurrence(state.startDate,t.date)).flatMap(identities).filter(employerIdentity));
 const groups=new Map(),seen=new Set();
 for(const t of posted){
  const key=JSON.stringify([accountId,t.transaction_id]);if(seen.has(key))continue;seen.add(key);
  const occurrence=paycheckOccurrence(state.startDate,t.date);if(!occurrence||state.checkedPaychecks?.[occurrence.paycheck])continue;
  const linked=source&&identities(t).includes(merchantIdentity(source.merchant));
  if(source?!linked:!payrollEvidence(t)&&!identities(t).some(name=>employers.has(name)))continue;
  const receipt={...occurrence,amount:Math.round(-t.amount*100),receivedDate:t.date,transactionId:t.transaction_id,accountId,name:t.name};
  if(!Number.isSafeInteger(receipt.amount)||receipt.amount<=0)continue;
  const group=groups.get(occurrence.paycheck)||[];group.push(receipt);groups.set(occurrence.paycheck,group);
 }
 return Object.fromEntries([...groups].flatMap(([n,rows])=>{
  const selected=rows.find(r=>source?.assignments?.[r.scheduledDate]===r.transactionId);
  return selected||rows.length===1?[[n,selected||rows[0]]]:[];
 }));
}
