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
   const key=bill.id+':'+date;
   if(paid.has(key)||legacy?.paid?.includes(key))continue;
   const covered=Boolean(linked[bill.id])||(overrides[bill.id]??(bill.source!=='gmail'&&bill.source!=='manual'));
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
