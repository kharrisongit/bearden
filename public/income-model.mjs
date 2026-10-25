export {reviewBankActivity,transactionKey} from './bank-activity.mjs';
import {day,occurrences} from './engine.mjs';
const cents=n=>Math.round((Number(n)||0)*100);
export function paydayEvents(plan,start,end){
 const s=plan.state||{},rows=new Map((plan.schedule||[]).map(r=>[r.paycheck,r]));
 if(!s.startDate)return [];
 const out=[];
 for(const date of occurrences(s.startDate,'biweekly',start,end)){
  const n=Math.round((Date.parse(date+'T12:00Z')-Date.parse(s.startDate+'T12:00Z'))/86400000/14)+1;
  if(s.checkedPaychecks?.[n])continue;
  const row=rows.get(n),income=cents(row?row.takeHomeThisCheck+row.bonusAmount:(s.paycheckOverrides?.[n]??s.takeHome))+(row?0:cents(s.appliedBonuses?.[n]));
  const budget=row?row.budgetLineItemsThisCheck:(s.budgetItems||[]).map(b=>({...b,amount:s.budgetItemOverrides?.[b.id]?.[n]??b.amount}));
  const extras=row?row.extrasThisCheck:(s.extraExpenses?.[n]||[]);
  const allocations=[...(budget||[]),...(extras||[])].reduce((a,b)=>a+cents(b.amount),0)+(row?(row.payments||[]).reduce((a,b)=>a+cents(b),0)+(row.savingsByGoal||[]).reduce((a,b)=>a+cents(b.contribution),0):0);
  if(income||allocations)out.push({id:'paycheck-'+n,date,name:'Paycheck '+n,type:'income',amount:income,allocations});
 }
 return out;
}
export function billEvents(legacy,planner,linked,start,end){
 const paid=new Set(planner.paid||[]),overrides=planner.covered||{},out=[];
 const bills=[...(legacy?.bills||[]).filter(b=>!['budget','baby-bear-budget'].includes(b.source)),...(planner.manual||[])];
 for(const bill of bills){
  if(!bill.date)continue;
  const dates=occurrences(bill.date,bill.repeat||'once',start,end);
  if(bill.repeat==='once'&&bill.date<start)dates.unshift(bill.date);
  for(const date of dates){
   // Prefer a manually entered or confirmed bill over a matching bank estimate.
   const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
   if(['bank-estimate','bank-tracked'].includes(bill.source)&&bills.some(other=>!['bank-estimate','bank-tracked'].includes(other.source)&&(norm(other.name)===norm(bill.name)||(bill.billKind==='electric'&&(other.billKind==='electric'||/consumers\s*energy/i.test(other.name))))&&occurrences(other.date,other.repeat||'once',day(date,-7),day(date,7)).length))continue;
   const key=bill.id+':'+date;
   if(paid.has(key)||legacy?.paid?.includes(key))continue;
   const covered=Boolean(linked[bill.id])||(overrides[bill.id]??(bill.source!=='gmail'&&bill.source!=='manual'&&bill.source!=='bank-estimate'&&bill.source!=='bank-tracked'));
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

// Estimate future everyday spending separately from scheduled bills. Existing
// personal-spending allocations are deducted so they are not counted twice.
export function spendingProjection(plan,summary,start,enabled=true,length=30){
 const end=day(start,length),s=plan.state||{},rows=new Map((plan.schedule||[]).map(r=>[r.paycheck,r]));
 let reserved=0;
 const personal=/\b(food|dining|grocer(?:y|ies)|gas|fuel|transport|shopping|personal|spending|entertainment|misc(?:ellaneous)?|allowance|fun|restaurants)\b/i;
 const matched=new Set();
 for(const p of paydayEvents(plan,start,end)){
  const n=Number(p.id.replace('paycheck-','')),row=rows.get(n),budget=row?row.budgetLineItemsThisCheck:(s.budgetItems||[]).map(b=>({...b,amount:s.budgetItemOverrides?.[b.id]?.[n]??b.amount}));
  for(const b of budget||[])if(personal.test(b.name||'')){reserved+=cents(b.amount);matched.add(b.name);}
 }
 const baseline=Math.round((summary?.total||0)*length/30),additional=enabled?Math.max(0,baseline-reserved):0;
 const events=[];
 for(let n=1;n<=length;n++){
  const amount=Math.floor(additional*n/length)-Math.floor(additional*(n-1)/length);
  if(amount)events.push({id:'spending-'+n,name:'Personal spending estimate',date:day(start,n),type:'spending',amount,covered:false});
 }
 return {baseline,reserved,additional,events,matched:[...matched]};
}
