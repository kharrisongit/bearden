export {resolveDebtConnections,resolveDebtDetails} from './connection-model.mjs?v=connections-audit1';
import {transactionAccountId} from './transaction-links.mjs?v=connections-audit1';
import {scheduledPayment,effectiveDebtTerms} from './debt-payments.mjs?v=connections-audit1';
export {monthlyMinimum} from './debt-payments.mjs?v=connections-audit1';
import {rentSchedule,rentOccurrence,rentPaidKey} from './rent-model.mjs?v=rent-portal1';
import {householdEnabled,sharedBill,spouseEvents,householdForecast,householdBillChoices} from './household-model.mjs?v=connections-audit1';
export {householdEnabled,sharedBill,spouseEvents,householdBillChoices};
export {reviewBankActivity,transactionKey,billsAccountSpending} from './bank-activity.mjs?v=connections-audit1';
export {creditBills,creditCapacity} from './credit-model.mjs?v=available-credit1';
export {transactionAccountId};
export {paymentLink,matchesPayment,matchingPayments,linkConflict,matchedBillPayments,postedPayment} from './transaction-links.mjs?v=connections-audit1';
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
 const synced=plan.syncedDebtBalances?.[card.id];
 const balance=synced? synced.balance : Math.max(0,cents(card.balance)+interest-paid);
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
// Calendar markers retain received paydays and paid bills; forecasts exclude them.
export function calendarEvents(plan,household,payments,start,end){
 const days=new Map(),state=plan.state||{};
 const entry=date=>{
  if(!days.has(date))days.set(date,{date,billPayments:[],debtPayments:[],myPayday:false,spousePayday:false,payoffs:[]});
  return days.get(date);
 };
 for(const payment of payments)if(payment.date>=start&&payment.date<=end){
  entry(payment.date)[isDebtPayment(payment)?'debtPayments':'billPayments'].push(payment);
 }
 if(state.startDate)for(const date of occurrences(state.startDate,'biweekly',start,end))entry(date).myPayday=true;
 if(householdEnabled(household)&&household.spouseStartDate)for(const date of occurrences(household.spouseStartDate,household.spouseRepeat||'biweekly',start,end))entry(date).spousePayday=true;
 const previous=(state.cards||[]).map(c=>cents(c.balance));
 for(const row of plan.schedule||[])for(const [index,card] of (state.cards||[]).entries()){
  const balance=row.balancesAfter?.[index];
  if(!Number.isFinite(balance))continue;
  const remaining=cents(balance);
  if(previous[index]>1&&remaining<=1&&cents(row.payments?.[index])>0&&row.date>=start&&row.date<=end){
   entry(row.date).payoffs.push({id:String(card.id),name:card.name,completed:!!state.checkedPaychecks?.[row.paycheck]&&!!trackerDebtStatus(plan,card.id)?.paidOff});
  }
  previous[index]=remaining;
 }
 return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export function accountPaymentRows(events,selected=null){
 const seen=new Set(),rows=[];
 for(const event of events){
  if(selected&&event.date!==selected)continue;
  const key=event.source==='tracker-debt'?'tracker-'+event.trackerCardId:event.id;
  if(seen.has(key))continue;seen.add(key);rows.push(event);
 }
 return rows;
}
export function paydayEvents(plan,start,end,{billsOnly=false,debtMode='full'}={}){
 const s=plan.state||{},rows=new Map((plan.schedule||[]).map(r=>[r.paycheck,r]));
 if(!s.startDate)return [];
 // A comparison starts from completed payments, not future full-plan payoff dates.
 // Keep its own balances so minimums continue after the full plan would finish.
 const remaining=debtMode==='minimum'?(s.cards||[]).map(c=>trackerDebtStatus(plan,c.id).balance):[];
 const out=[];
 for(const date of occurrences(s.startDate,'biweekly',start,end)){
  const n=Math.round((Date.parse(date+'T12:00Z')-Date.parse(s.startDate+'T12:00Z'))/86400000/14)+1;
  if(s.checkedPaychecks?.[n])continue;
  const row=rows.get(n),income=cents(row?row.takeHomeThisCheck+row.bonusAmount:(s.paycheckOverrides?.[n]??s.takeHome))+(row?0:cents(s.appliedBonuses?.[n]));
  const budget=row?row.budgetLineItemsThisCheck:(s.budgetItems||[]).map(b=>({...b,amount:s.budgetItemOverrides?.[b.id]?.[n]??b.amount}));
  const extras=row?row.extrasThisCheck:(s.extraExpenses?.[n]||[]);
  let debtAllocations=(row?.payments||[]).reduce((sum,p)=>sum+cents(p),0);
  if(debtMode==='none')debtAllocations=0;
  if(debtMode==='minimum')debtAllocations=(s.cards||[]).reduce((sum,card,index)=>{
   card=effectiveDebtTerms(card,plan.syncedDebtTerms?.[card.id],date);
   const interest=Math.round(remaining[index]*Math.max(0,Number(card.apr)||0)/100/26);
   const owed=remaining[index]+interest,payment=Math.min(owed,Math.max(0,cents(scheduledPayment(card,date,s.startDate,s.debtPaymentSettings).minimum)));
   remaining[index]=owed-payment;return sum+payment;
  },0);
  const allocations=[...(budget||[]),...(extras||[])].filter(b=>!billsOnly||!isPersonal(b)).reduce((a,b)=>a+cents(b.amount),0)+debtAllocations+(row&&!billsOnly?(row.savingsByGoal||[]).reduce((a,b)=>a+cents(b.contribution),0):0);
  if(income||allocations)out.push({id:'paycheck-'+n,date,name:'Paycheck '+n,type:'income',amount:income,allocations});
 }
 return out;
}
export function scenarioForecast(accounts,plan,bills,start,{debtMode='full',length=30,household,scope,transactions=[],includePersonalSpending=false}={}){
 const mode=['full','minimum','none'].includes(debtMode)?debtMode:'full';
 const paydays=paydayEvents(plan,start,day(start,length),{billsOnly:!includePersonalSpending,debtMode:mode});
 // Matched credit cards remain covered by the paycheck allocation, preventing
 // an issuer minimum and a tracker minimum from being deducted twice.
 const scheduled=mode==='none'?bills.filter(b=>!isDebtPayment(b)):bills;
 return {...(householdEnabled(household)?householdForecast(accounts,plan,paydays,scheduled,start,{household,scope,length,transactions}):cashForecast(accounts,paydays,scheduled,start,length)),debtMode:mode};
}
export function billEvents(legacy,planner,linked,start,end){
 const paid=new Set(planner.paid||[]),overrides=planner.covered||{},out=[];
 let bills=[...(legacy?.bills||[]).filter(b=>!['budget','baby-bear-budget'].includes(b.source)),...(planner.manual||[])];
 const replaced=new Set(bills.filter(b=>b.source==='plaid-credit').map(b=>b.replaces).filter(Boolean));
 bills=bills.filter(b=>!replaced.has(b.id));
 const electric=bills.find(b=>b.id===planner.electricBillId&&b.billKind==='electric'&&b.source!=='gmail'&&!planner.emailLinks?.['bill:'+b.id]);
 if(electric){
  const monthlyEmails=new Map();
  for(const b of bills)if(b.source==='gmail'&&(b.billKind==='electric'||/consumers\s*energy/i.test(b.name))){const key=b.date.slice(0,7),old=monthlyEmails.get(key);if(!old||b.date>old.date)monthlyEmails.set(key,b);}
  bills=bills.filter(b=>b.source!=='gmail'||!(b.billKind==='electric'||/consumers\s*energy/i.test(b.name)));
  bills.push(...[...monthlyEmails.values()].map(b=>({...b,id:electric.id,name:electric.name,billKind:'electric',source:electric.source,groupKey:electric.groupKey,repeat:'once',gmailConfirmed:true,originalEmailId:b.id})));
 }
 for(const original of bills){
  const bill=rentSchedule(original);
  if(!bill.date)continue;
  const dates=occurrences(bill.date,bill.repeat||'once',start,end);
  if(bill.repeat==='once'&&bill.date<start&&bill.source!=='tracker-debt')dates.unshift(bill.date);
  for(const date of dates){
   if(!bill.gmailConfirmed&&bill.id===electric?.id&&bills.some(b=>b.gmailConfirmed&&b.date.slice(0,7)===date.slice(0,7)))continue;
   // Prefer a manually entered or confirmed bill over a matching bank estimate.
   const norm=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
   if(!bill.gmailConfirmed&&['bank-estimate','bank-tracked'].includes(bill.source)&&bills.some(other=>!['bank-estimate','bank-tracked'].includes(other.source)&&(norm(other.name)===norm(bill.name)||(!electric&&bill.billKind==='electric'&&(other.billKind==='electric'||/consumers\s*energy/i.test(other.name))))&&occurrences(other.date,other.repeat||'once',day(date,-7),day(date,7)).length))continue;
   const key=bill.id+':'+date;
   if((bill.billKind==='rent'&&[...paid,...(legacy?.paid||[])].some(k=>rentPaidKey(k,bill)===key))||paid.has(key)||legacy?.paid?.includes(key)||(bill.gmailConfirmed&&[...paid,...(legacy?.paid||[])].some(k=>k.startsWith(bill.id+':'+date.slice(0,7)))))continue;
   const covered=Boolean(linked[bill.id])||bill.paidByCard||bill.source==='tracker-debt'||(bill.source==='plaid-credit'?bill.covered:(overrides[bill.id]??(bill.source!=='gmail'&&bill.source!=='manual'&&bill.source!=='bank-estimate'&&bill.source!=='bank-tracked')));
   const shared=sharedBill(bill,planner);
   out.push({...rentOccurrence(bill,date),date,key,type:'bill',covered:shared?false:covered,shared,overdue:date<start,emailConfirmed:!!bill.emailConfirmed&&date===(bill.emailDueDate||bill.date)});
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

// Each occurrence belongs to exactly one biweekly pay window. Keep paid bills
// in their original window so checking a paycheck does not inflate debt money.
// Forecasts still deduct unpaid bills separately on their actual due dates.
export function paycheckBillItems({legacy,planner,linked},date,paycheck){
 const start=paycheck===1?day(date,-14):date,end=day(date,13);
 const paid=new Set(planner.paid||[]);
 const bills=billEvents({...legacy,paid:[]},{...planner,paid:[]},linked,start,end)
  .filter(b=>!b.covered&&(b.date>=date||(paycheck===1&&!paid.has(b.key))))
  .filter((b,index,rows)=>rows.findIndex(other=>other.key===b.key)===index);
 const personal=bills.filter(b=>!b.shared),h=planner.household;
 if(householdEnabled(h))personal.unshift({id:'household-contribution',key:'household:'+date,name:'Fixed Bills',date,amount:h.personalAmount,transfer:true,sharedBills:bills.filter(b=>b.shared),spouseContributions:spouseEvents(h,date,end)});
 return personal;
}

// A paycheck's expanded Fixed Bills section uses the same shared-account
// ledger as the Accounts forecast, through the day before the next payday.
export function paycheckBillsBalance({legacy,planner,linked,accounts=[],plan={},today,transactions=[]},date){
 const h=planner.household,end=day(date,13);
 const account=accounts.find(a=>a.id===h?.billsAccountId&&(a.currency||'USD')==='USD'&&!['credit','loan'].includes(a.type));
 const currentBalance=account&&!account.balanceUnavailable&&Number.isSafeInteger(account.balance)?account.balance:null;
 const result={accountName:account?.displayName||account?.name||'Bills account',currentBalance,projectedBalance:null,end,historical:!!today&&end<today};
 if(!today||result.historical||currentBalance===null||!householdEnabled(h))return result;
 const length=Math.round((Date.parse(end+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/86400000);
 const bills=billEvents(legacy,planner,linked,today,end);
 const forecast=householdForecast([account],plan,[],bills,today,{household:h,scope:'shared',length,transactions});
 return {...result,projectedBalance:forecast.endBalance};
}

// Keep the ledger and its totals inclusive of every event on the selected day.
export function forecastThrough(f,date){
 const end=date<f.end?date:f.end,rows=f.rows.filter(r=>r.date<=end);
 let income=0,outgoing=0,low=f.opening;
 for(const r of rows){
  income+=r.incoming??(r.type==='income'?r.amount:0);
  outgoing+=r.outgoing??(r.type==='income'?r.allocations:r.amount);
  if(r.balance!==null&&low!==null)low=Math.min(low,r.balance);
 }
 return {...f,rows,end,income,outgoing,low,endBalance:rows.length?rows.at(-1).balance:f.opening};
}

// Store day-end changes, not one point per calendar day, for long forecasts.
export function forecastTimeline(f,start){
 if(f.opening===null)return [];
 const points=[{date:start,balance:f.opening}];let balance=f.opening;
 for(const row of f.rows){balance+=row.delta;if(points.at(-1).date===row.date)points.at(-1).balance=balance;else points.push({date:row.date,balance});}
 if(points.at(-1).date!==f.end)points.push({date:f.end,balance});return points;
}
export function forecastBalanceOn(points,date){
 let lo=0,hi=points.length-1,index=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(points[mid].date<=date){index=mid;lo=mid+1;}else hi=mid-1;}return index<0?null:points[index].balance;
}

// Loan balances describe the debt, never the recurring payment amount.
export function linkedBillLoan(bill,planner,accounts=[]){
 const id=planner.loanLinks?.[bill.id];
 if(!id||bill.billKind!=='car-payment')return null;
 const account=accounts.find(a=>a.id===id&&['plaid','simplefin'].includes(a.source)&&a.type==='loan');
 return account?{id,name:account.displayName||account.name,balance:account.balance,balanceUnavailable:!!account.balanceUnavailable,currency:account.currency||'USD'}:{id,unavailable:true};
}

export function syncedDebtBalances(planner,accounts,today){
 const result={};
 for(const [id,accountId] of Object.entries(planner.debtAccountLinks||{})){
  const a=accounts.find(a=>a.id===accountId&&['credit','loan'].includes(a.type));
  // A disputed zero must not wipe an existing debt or stop its scheduled payments.
  if(a&&!a.balanceUnavailable&&a.currency==='USD'&&Number.isSafeInteger(a.balance)&&a.balance>0)result[id]={balance:a.balance,date:today};
 }
 return result;
}

// The debt list and Dashboard share these current balances. Bank/statement
// snapshots never replace starting balances or historical paycheck payments.
export function accountDebtBalances(planner,accounts,creditCards,cards,today,statements={}){
 const result=syncedDebtBalances(planner,accounts,today);
 const known=new Set(cards.map(c=>String(c.id)));
 for(const card of creditCards){
  if(planner.hiddenConnectedAccounts?.['plaid-'+card.accountId])continue;
  const id=planner.creditCards?.[card.id]?.trackerCardId;
  if(!id||!known.has(String(id))||planner.debtAccountLinks?.[id])continue;
  const balance=card.emailBalance?card.balance:accounts.find(a=>a.id==='plaid-'+card.accountId)?.balance??card.balance;
  if((card.currency||'USD')==='USD'&&Number.isSafeInteger(balance)&&balance>=0)result[id]={balance,date:today};
 }
 for(const card of cards){
  const balance=statements[card.id]?.balance;
  if(!result[card.id]&&Number.isSafeInteger(balance)&&balance>=0)result[card.id]={balance,date:today};
 }
 return result;
}
export function debtAccountSummary(accounts){
 const totals=new Map();let missing=0,starting=0;
 const known=accounts.filter(a=>{if(!Number.isFinite(a.amount)){missing++;return false;}return true;});
 for(const a of known){const currency=a.currency||'USD';totals.set(currency,(totals.get(currency)||0)+Math.max(0,a.amount));starting+=Math.max(0,a.startingBalance??a.amount);}
 return {accounts:known.map(a=>({...a,amount:Math.max(0,a.amount)})),totals:[...totals].map(([currency,amount])=>({currency,amount})),missing,starting};
}

export function personalChecking(accounts,household={}){
 const checking=accounts.filter(a=>(a.currency||'USD')==='USD'&&a.type==='depository'&&(a.subtype==='checking'||/checking/i.test(a.name||''))&&a.id!==household.billsAccountId);
 return household.personalAccountId?checking.find(a=>a.id===household.personalAccountId)||null:checking.length===1?checking[0]:null;
}
export function personalCheckingTransactions(transactions,account){
 return ['plaid','simplefin'].includes(account?.source)?transactions.filter(t=>transactionAccountId(t)===account.id):[];
}
