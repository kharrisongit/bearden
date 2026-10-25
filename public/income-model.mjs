export {reviewBankActivity,transactionKey} from './bank-activity.mjs';
export {creditBills} from './credit-model.mjs';
import {day,occurrences} from './engine.mjs';
const cents=n=>Math.round((Number(n)||0)*100);
const isPersonal=b=>/\b(food|dining|grocer(?:y|ies)|gas|fuel|transport|shopping|personal|spending|entertainment|misc(?:ellaneous)?|allowance|fun|restaurants)\b/i.test(b.name||'');
// Derive completion from checked payments so undo/reset never leaves a stale paid flag.
export function trackerDebtStatus(plan,id){
 const index=(plan.state?.cards||[]).findIndex(c=>String(c.id)===String(id));
 if(index<0)return null;
 const card=plan.state.cards[index],checked=(plan.schedule||[]).filter(r=>plan.state?.checkedPaychecks?.[r.paycheck]);
 const payments=checked.filter(r=>cents(r.payments?.[index])>0);
 const paid=checked.reduce((sum,r)=>sum+cents(r.payments?.[index]),0);
 const interest=checked.reduce((sum,r)=>sum+cents(r.interestByAccount?.[index]),0);
 const balance=Math.max(0,cents(card.balance)+interest-paid);
 return {index,balance,paid,paidOff:balance<=1,lastPayment:payments.at(-1)||null};
}
export function paycheckPaidCreditBills(plan,cardBills=[],cards=[],preferences={}){
 return cardBills.flatMap(bill=>{
  const status=trackerDebtStatus(plan,preferences[bill.id]?.trackerCardId);
  if(!status)return [];
  const card=cards.find(c=>c.id===bill.id),due=new Date(bill.date+'T12:00:00Z');
  // Use the statement boundary when shared; otherwise use one billing month.
  const previous=new Date(Date.UTC(due.getUTCFullYear(),due.getUTCMonth(),0,12));
  previous.setUTCDate(Math.min(due.getUTCDate(),previous.getUTCDate()));
  const start=card?.statementDate&&card.statementDate<bill.date?card.statementDate:previous.toISOString().slice(0,10);
  const rows=(plan.schedule||[]).filter(r=>plan.state?.checkedPaychecks?.[r.paycheck]&&r.date>start);
  const paid=rows.reduce((sum,r)=>sum+cents(r.payments?.[status.index]),0);
  return paid>=bill.amount||status.paidOff&&paid>0?[bill.id+':'+bill.date]:[];
 });
}
export function trackerDebtBills(plan,cardBills=[],preferences={}, {includePaid=false}={}){
 const matched=new Set(cardBills.map(b=>String(preferences[b.id]?.trackerCardId||'')).filter(Boolean));
 return (plan.schedule||[]).filter(row=>includePaid||!plan.state?.checkedPaychecks?.[row.paycheck]).flatMap(row=>(plan.state?.cards||[]).flatMap((card,index)=>{
  const amount=cents(row.payments?.[index]);if(amount<=0||matched.has(String(card.id)))return [];
  return [{id:'tracker-debt-'+card.id+'-'+row.paycheck,trackerCardId:String(card.id),name:card.name,amount,date:row.date,repeat:'once',source:'tracker-debt',billKind:'loan',covered:true,paidByPaycheck:!!plan.state?.checkedPaychecks?.[row.paycheck]}];
 }));
}
export const isDebtPayment=b=>b.billKind!=='car-payment'&&(['tracker-debt','plaid-credit'].includes(b.source)||['credit-card','loan'].includes(b.billKind));
export function accountPaymentRows(events,selected=null){
 const seen=new Set(),rows=[];
 for(const event of events){
  if(selected&&event.date!==selected)continue;
  const key=event.source==='tracker-debt'?'tracker-'+event.trackerCardId:event.id;
  if(seen.has(key))continue;seen.add(key);rows.push(event);
 }
 return rows;
}
export function paydayEvents(plan,start,end,{billsOnly=false}={}){
 const s=plan.state||{},rows=new Map((plan.schedule||[]).map(r=>[r.paycheck,r]));
 if(!s.startDate)return [];
 const out=[];
 for(const date of occurrences(s.startDate,'biweekly',start,end)){
  const n=Math.round((Date.parse(date+'T12:00Z')-Date.parse(s.startDate+'T12:00Z'))/86400000/14)+1;
  if(s.checkedPaychecks?.[n])continue;
  const row=rows.get(n),income=cents(row?row.takeHomeThisCheck+row.bonusAmount:(s.paycheckOverrides?.[n]??s.takeHome))+(row?0:cents(s.appliedBonuses?.[n]));
  const budget=row?row.budgetLineItemsThisCheck:(s.budgetItems||[]).map(b=>({...b,amount:s.budgetItemOverrides?.[b.id]?.[n]??b.amount}));
  const extras=row?row.extrasThisCheck:(s.extraExpenses?.[n]||[]);
  const allocations=[...(budget||[]),...(extras||[])].filter(b=>!billsOnly||!isPersonal(b)).reduce((a,b)=>a+cents(b.amount),0)+(row?(row.payments||[]).reduce((a,b)=>a+cents(b),0)+(billsOnly?0:(row.savingsByGoal||[]).reduce((a,b)=>a+cents(b.contribution),0)):0);
  if(income||allocations)out.push({id:'paycheck-'+n,date,name:'Paycheck '+n,type:'income',amount:income,allocations});
 }
 return out;
}
export function billEvents(legacy,planner,linked,start,end){
 const paid=new Set(planner.paid||[]),overrides=planner.covered||{},out=[];
 let bills=[...(legacy?.bills||[]).filter(b=>!['budget','baby-bear-budget'].includes(b.source)),...(planner.manual||[])];
 const replaced=new Set(bills.filter(b=>b.source==='plaid-credit').map(b=>b.replaces).filter(Boolean));
 bills=bills.filter(b=>!replaced.has(b.id));
 const electric=bills.find(b=>b.id===planner.electricBillId&&b.billKind==='electric'&&b.source!=='gmail');
 if(electric){
  const monthlyEmails=new Map();
  for(const b of bills)if(b.source==='gmail'&&(b.billKind==='electric'||/consumers\s*energy/i.test(b.name))){const key=b.date.slice(0,7),old=monthlyEmails.get(key);if(!old||b.date>old.date)monthlyEmails.set(key,b);}
  bills=bills.filter(b=>b.source!=='gmail'||!(b.billKind==='electric'||/consumers\s*energy/i.test(b.name)));
  bills.push(...[...monthlyEmails.values()].map(b=>({...b,id:electric.id,name:electric.name,billKind:'electric',source:electric.source,groupKey:electric.groupKey,repeat:'once',gmailConfirmed:true,originalEmailId:b.id})));
 }
 for(const bill of bills){
  if(!bill.date)continue;
  const dates=occurrences(bill.date,bill.repeat||'once',start,end);
  if(bill.repeat==='once'&&bill.date<start&&bill.source!=='tracker-debt')dates.unshift(bill.date);
  for(const date of dates){
   if(!bill.gmailConfirmed&&bill.id===electric?.id&&bills.some(b=>b.gmailConfirmed&&b.date.slice(0,7)===date.slice(0,7)))continue;
   // Prefer a manually entered or confirmed bill over a matching bank estimate.
   const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
   if(!bill.gmailConfirmed&&['bank-estimate','bank-tracked'].includes(bill.source)&&bills.some(other=>!['bank-estimate','bank-tracked'].includes(other.source)&&(norm(other.name)===norm(bill.name)||(!electric&&bill.billKind==='electric'&&(other.billKind==='electric'||/consumers\s*energy/i.test(other.name))))&&occurrences(other.date,other.repeat||'once',day(date,-7),day(date,7)).length))continue;
   const key=bill.id+':'+date;
   if(paid.has(key)||legacy?.paid?.includes(key)||(bill.gmailConfirmed&&[...paid,...(legacy?.paid||[])].some(k=>k.startsWith(bill.id+':'+date.slice(0,7)))))continue;
   const covered=Boolean(linked[bill.id])||bill.paidByCard||bill.source==='tracker-debt'||(bill.source==='plaid-credit'?bill.covered:(overrides[bill.id]??(bill.source!=='gmail'&&bill.source!=='manual'&&bill.source!=='bank-estimate'&&bill.source!=='bank-tracked')));
   out.push({...bill,date,key,type:'bill',covered,overdue:date<start});
  }
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
}
export function cashForecast(accounts,paydays,bills,start,length=30){
 const included=(accounts||[]).filter(a=>a.include&&(a.currency||'USD')==='USD');
 const opening=included.length?included.reduce((n,a)=>n+a.balance,0):null,end=day(start,length);
 const events=[];
 for(const p of paydays)if(p.date>=start&&p.date<=end)events.push({...p,delta:p.amount-p.allocations});
 for(const b of bills)if(!b.covered&&b.date<=end)events.push({...b,date:b.date<start?start:b.date,delta:-b.amount});
 events.sort((a,b)=>a.date.localeCompare(b.date)||(a.type==='bill'?-1:1));
 let running=opening,low=opening,income=0,outgoing=0;
 const rows=events.map(e=>{if(e.type==='income'){income+=e.amount;outgoing+=e.allocations;}else outgoing+=e.amount;if(running!==null){running+=e.delta;low=Math.min(low,running);}return {...e,balance:running};});
 return {opening,endBalance:running,low,income,outgoing,rows,end};
}
