import {day,monthly,occurrences} from './engine.mjs';
const cashOrder=r=>r.type==='reclaim'?3:r.type==='extra-deposit'&&r.delta>0?0:r.delta<0?1:2;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&day(s,0)===s;

export function reclaimHorizon(start,personalStart,spouseStart){
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&day(s,0)===s;
 if(![start,personalStart,spouseStart].every(valid))return null;
 const searchEnd=day([start,personalStart,spouseStart].sort().at(-1),366*3);
 const own=thirdPaycheckDates(personalStart,start,searchEnd).slice(0,2),spouse=thirdPaycheckDates(spouseStart,start,searchEnd).slice(0,2);
 if(own.length<2||spouse.length<2)return null;
 const lastReclaim=[own[1],spouse[1]].sort().at(-1);
 return {own,spouse,lastReclaim,end:monthly(lastReclaim,12)};
}

// Find the deposits required by this ledger. Savings repairs only existing
// gaps; reclaim comparisons also use a matching minimum cushion in both cases.
export function coverBillShortfalls(f,start,{buffer=10000,minimum=0}={}){
 if(!Number.isSafeInteger(f.opening)||!Number.isSafeInteger(buffer)||buffer<0||!Number.isSafeInteger(minimum)||minimum<0||minimum>buffer)return null;
 const rows=f.rows.filter(r=>r.date>=start&&r.date<=f.end).map(r=>({...r}));
 if(rows.some(r=>!Number.isSafeInteger(r.delta)))return null;
 const rank=cashOrder;
 rows.sort((a,b)=>a.date.localeCompare(b.date)||rank(a)-rank(b));
 // Pending top-ups dated today are conditional funding, not current bank cash.
 const todayFunding=rows.filter(r=>r.date===start&&r.type==='extra-deposit').reduce((n,r)=>n+r.delta,0);
 let running=f.opening+todayFunding,opening=running;
 const deposits=[],adjusted=rows.filter(r=>!(r.date===start&&r.type==='extra-deposit'));
 if(running<minimum){const amount=buffer-running;deposits.push({date:start,amount,shortfall:Math.max(0,-running),neededBy:start,reason:'Current balance'});running+=amount;opening=running;}
 for(let i=0;i<rows.length;){
  const date=rows[i].date;let delta=0,low=running,reason='Upcoming bills';
  while(i<rows.length&&rows[i].date===date){const row=rows[i++];if(date===start&&row.type==='extra-deposit')continue;delta+=row.delta;if(running+delta<low){low=running+delta;reason=row.name||reason;}}
  if(low<minimum){
   const amount=buffer-low,depositDate=date===start?start:day(date,-1);
   deposits.push({date:depositDate,amount,shortfall:Math.max(0,-low),neededBy:date,reason});
   running+=amount;
   if(depositDate===start)opening+=amount;
   else adjusted.push({date:depositDate,delta:amount,amount,incoming:amount,outgoing:0,type:'extra-deposit',name:'Planned extra deposit'});
  }
  running+=delta;if(!Number.isSafeInteger(running)||!Number.isSafeInteger(opening))return null;
 }
 adjusted.sort((a,b)=>a.date.localeCompare(b.date)||rank(a)-rank(b));
 const extraFunding=rows.filter(r=>r.type==='extra-deposit'&&r.delta>0).reduce((n,r)=>n+r.delta,0)+deposits.reduce((n,d)=>n+d.amount,0);
 return {forecast:{...f,opening,rows:adjusted},deposits,extraFunding,conditionalNow:todayFunding>0||deposits.some(d=>d.date===start)};
}

// Compare identical cash flows, changing only one withdrawal. Keep the original
// comparison separate from any conditional deposits used to make a plan fit.
export function singleReclaimPlan(f,start,{date=start,amount,buffer=10000,searchEnd=date}={}){
 const unavailable={status:'unavailable'};
 if(![start,date,searchEnd,f.end].every(validDate)||date<start||searchEnd<date||monthly(searchEnd,12)>f.end||!Number.isSafeInteger(f.opening)||!Number.isSafeInteger(amount)||amount<=0||!Number.isSafeInteger(buffer)||buffer<0)return unavailable;
 const rows=f.rows.filter(r=>r.date>=start&&r.date<=f.end).map(r=>({...r}));
 if(rows.some(r=>!validDate(r.date)||!Number.isSafeInteger(r.delta)))return unavailable;
 rows.sort((a,b)=>a.date.localeCompare(b.date)||cashOrder(a)-cashOrder(b));
 const withdrawal=on=>({date:on,delta:-amount,type:'reclaim',name:'One-time reclaim',reclaimPreview:true});
 function compare(forecast,on){
  const candidate=withdrawal(on),events=[...forecast.rows,candidate].sort((a,b)=>a.date.localeCompare(b.date)||cashOrder(a)-cashOrder(b));
  let before=forecast.opening,after=before,taken=false,lowAfter=null,impact=null;
  const baseline={low:before,lowDate:start,firstShortfall:before<0?{date:start,balance:before}:null};
  const requested={...baseline,withoutAtLow:before};
  for(const event of events){
   if(event===candidate){after-=amount;taken=true;}else{before+=event.delta;after+=event.delta;}
   if(!Number.isSafeInteger(before)||!Number.isSafeInteger(after))return null;
   for(const [state,balance]of [[baseline,before],[requested,after]]){
    if(balance<state.low){state.low=balance;state.lowDate=event.date;if(state===requested)state.withoutAtLow=before;}
    if(balance<0&&!state.firstShortfall)state.firstShortfall={date:event.date,balance};
   }
   if(taken){
    lowAfter=lowAfter===null?after:Math.min(lowAfter,after);
    const kind=after<0?(before<0?'worsened':'created'):after<buffer&&before>=buffer?'cushion':null;
    // A real shortfall takes priority over an earlier cushion-only warning.
    if(kind&&(!impact||impact.kind==='cushion'&&kind!=='cushion'))impact={date:event.date,before,after,kind,name:event.name};
   }
  }
  return {baseline,requested,impact,lowAfter,safe:!requested.firstShortfall&&lowAfter>=buffer};
 }
 const original={...f,rows},raw=compare(original,date);
 // Both cases protect the same cushion; these deposits are needed even when
 // nothing is reclaimed. Previously saved pending deposits remain in both.
 const funding=coverBillShortfalls(original,start,{buffer,minimum:buffer});
 if(!raw||!funding)return unavailable;
 const funded=compare(funding.forecast,date);if(!funded)return unavailable;
 const maxOnDate=Math.max(0,Math.min(amount,funded.lowAfter+amount-buffer));
 const candidates=[...new Set([date,...rows.map(r=>r.date)])].filter(d=>d>=date&&d<=searchEnd).sort();
 let earliest=null;
 for(const on of candidates){const result=on===date?funded:compare(funding.forecast,on);if(result?.safe){earliest={date:on,lowAfter:result.lowAfter};break;}}
 // Show the cost of insisting on the requested date, never silently fund it.
 const repair=coverBillShortfalls({...funding.forecast,rows:[...funding.forecast.rows,withdrawal(date)]},start,{buffer,minimum:buffer});
 if(!repair)return unavailable;
 const additionalDeposits=repair.deposits,additionalFunding=additionalDeposits.reduce((sum,d)=>sum+d.amount,0);
 const afterDeposits=compare({...repair.forecast,rows:repair.forecast.rows.filter(r=>!r.reclaimPreview)},date);
 if(!afterDeposits)return unavailable;
 return {status:'ready',...raw,safe:funded.safe,fundedLow:funded.lowAfter,date,amount,buffer,searchEnd,checkedThrough:f.end,funding,maxOnDate,earliest,additionalDeposits,additionalFunding,depositPlan:{safe:afterDeposits.safe,lowAfterReclaim:afterDeposits.lowAfter},netReclaim:amount-additionalFunding,netAfterAllFunding:amount-additionalFunding-funding.extraFunding};
}

// All amounts are integer cents. The supplied ledger extends past the last
// suggested transfer date so the end of a chart is not treated as a free balance.
export function billsSavingsPlan(f,start,{end=f.end,buffer=10000}={}){
 const unavailable={status:'unavailable',now:0,total:0,schedule:[]};
 if(!Number.isSafeInteger(f.opening)||!Number.isSafeInteger(buffer)||buffer<0||end<start||end>f.end)return unavailable;
 const rows=f.rows.filter(r=>r.date>=start&&r.date<=f.end);
 if(rows.some(r=>!Number.isSafeInteger(r.delta)))return unavailable;
 // Bills may settle before a same-day contribution. Preserve those temporary
 // lows instead of using only the chart's end-of-day balances.
 rows.sort((a,b)=>a.date.localeCompare(b.date)||cashOrder(a)-cashOrder(b));
 const states=[{date:start,balance:f.opening,now:true}];let running=f.opening;
 for(const row of rows){running+=row.delta;if(!Number.isSafeInteger(running))return unavailable;states.push({date:row.date,balance:running,name:row.name});}
 const shortfall=states.find(s=>s.balance<0);
 if(shortfall)return {...unavailable,status:'shortfall',shortfall,needed:-states.reduce((low,s)=>Math.min(low,s.balance),f.opening),checkedThrough:f.end};
 const floors=Array(states.length);let floor=Infinity;
 for(let i=states.length-1;i>=0;i--){floor=Math.min(floor,states[i].balance);floors[i]=floor;}
 const schedule=[];let total=0,lowAfter=f.opening;
 for(let i=0;i<states.length;i++){
  const state=states[i],dayComplete=i===states.length-1||states[i+1].date!==state.date;
  if(state.date<=end&&(state.now||dayComplete)){
   // The suffix minimum is the most that can leave by this date while every
   // remaining event retains the cushion. Earlier suggestions are subtracted.
   const capacity=Math.max(0,floors[i]-buffer),amount=capacity-total;
   if(amount>0){total+=amount;schedule.push({date:state.date,now:!!state.now,amount,total,balanceAfter:state.balance-total});}
  }
  lowAfter=Math.min(lowAfter,state.balance-total);
 }
 return {status:'ready',now:schedule.find(s=>s.now)?.amount||0,total,schedule,lowAfter,buffer,checkedThrough:f.end};
}

export function thirdPaycheckDates(anchor,start,end){
 const counts=new Map();
 // Count the whole first month, even when the forecast begins mid-month.
 return occurrences(anchor,'biweekly',start.slice(0,7)+'-01',end).filter(date=>{
  const month=date.slice(0,7),count=(counts.get(month)||0)+1;counts.set(month,count);
  return count===3&&date>=start;
 });
}

// Compare a specific annual reclaim plan, rather than calling the third
// paycheck spare. Each person's next two third paydays are counted separately.
export function billsReclaimPlan(f,start,{end,periodStart=start,buffer=10000,personalStart,spouseStart,contribution,personalContribution=contribution,spouseContribution=contribution}={}){
 const unavailable={status:'unavailable'};
 if(!Number.isSafeInteger(f.opening)||!Number.isSafeInteger(buffer)||buffer<0||![personalContribution,spouseContribution].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(2*(personalContribution+spouseContribution))||!end||end<start||end>f.end||!personalStart||!spouseStart)return unavailable;
 const own=thirdPaycheckDates(personalStart,periodStart,end).slice(0,2),spouse=thirdPaycheckDates(spouseStart,periodStart,end).slice(0,2);
 if(own.length<2||spouse.length<2)return {status:'dates',own,spouse,end};
 const rows=f.rows.filter(r=>r.date>=start&&r.date<=f.end);
 if(rows.some(r=>!Number.isSafeInteger(r.delta)))return unavailable;
 const dates=[...new Set([...own,...spouse])].sort(),planned=dates.map(date=>({date,mine:own.includes(date),spouse:spouse.includes(date),reclaim:true}));
 const rank=e=>e.reclaim?3:cashOrder(e);
 const events=[...rows,...planned].sort((a,b)=>a.date.localeCompare(b.date)||rank(a)-rank(b));
 const scaleMax=Math.max(personalContribution,spouseContribution);
 const scaled=(amount,scale)=>Number(BigInt(amount)*BigInt(scale)/BigInt(scaleMax));
 function evaluate(scale,forecast=f){
  const mine=scaled(personalContribution,scale),spouseAmount=scaled(spouseContribution,scale);
  let balance=forecast.opening,without=balance,low=balance,lowDate=start,withoutAtLow=balance,impact=null,reclaimed=0,lowAfterReclaim=null,firstShortfall=balance<0?{date:start,balance}:null,firstBelowBuffer=null;
  const schedule=[];
  const sequence=forecast===f?events:[...forecast.rows,...planned].sort((a,b)=>a.date.localeCompare(b.date)||rank(a)-rank(b));
  for(const event of sequence){
   const withdrawal=event.reclaim?(event.mine?mine:0)+(event.spouse?spouseAmount:0):0;
   balance+=event.reclaim?-withdrawal:event.delta;
   if(!event.reclaim)without+=event.delta;
   if(!Number.isSafeInteger(balance)||!Number.isSafeInteger(without))return null;
   reclaimed+=withdrawal;if(balance<low){low=balance;lowDate=event.date;withoutAtLow=without;}
   if(reclaimed>0){
    lowAfterReclaim=lowAfterReclaim===null?balance:Math.min(lowAfterReclaim,balance);if(balance<buffer&&!firstBelowBuffer)firstBelowBuffer={date:event.date,balance};
    const kind=balance<0?(without<0?'worsened':'created'):balance<buffer&&without>=buffer?'cushion':null;
    if(kind&&(!impact||impact.kind==='cushion'&&kind!=='cushion'))impact={kind,date:event.date,before:without,after:balance};
   }
   if(balance<0&&!firstShortfall)firstShortfall={date:event.date,balance};
   if(event.reclaim)schedule.push({date:event.date,mine:event.mine?mine:0,spouse:event.spouse?spouseAmount:0,amount:withdrawal,balanceAfter:balance});
  }
  return {safe:!firstShortfall&&!firstBelowBuffer,low,lowDate,withoutAtLow,impact,endBalance:balance,lowAfterReclaim,firstShortfall,firstBelowBuffer,schedule,total:reclaimed};
 }
 const requested=evaluate(scaleMax),baseline=evaluate(0);
 if(!requested||!baseline)return unavailable;
 let low=0,high=scaleMax;
 while(low<high){const mid=Math.ceil((low+high)/2),result=evaluate(mid);if(result?.safe)low=mid;else high=mid-1;}
 const smaller=evaluate(low),safeMine=scaled(personalContribution,low),safeSpouse=scaled(spouseContribution,low);
 let depositPlan=null;
 if(!requested.safe){
  const withdrawals=requested.schedule.map(r=>({date:r.date,delta:-r.amount,type:'reclaim',name:'Full contribution reclaim',reclaimPreview:true}));
  const repair=coverBillShortfalls({...f,rows:[...rows,...withdrawals]},start,{buffer,minimum:buffer});
  if(!repair)return unavailable;
  // Re-evaluate the complete schedule with exactly the proposed deposits. The
  // withdrawals in the repair ledger must not also be applied a second time.
  const funded=evaluate(scaleMax,{...repair.forecast,rows:repair.forecast.rows.filter(r=>!r.reclaimPreview)});
  if(!funded)return unavailable;
  const additionalFunding=repair.deposits.reduce((sum,d)=>sum+d.amount,0);
  depositPlan={safe:funded.safe,deposits:repair.deposits,additionalFunding,netReclaim:requested.total-additionalFunding,lowAfterReclaim:funded.lowAfterReclaim,schedule:funded.schedule};
 }
 return {status:'ready',...requested,depositPlan,baselineLow:baseline.low,baselineLowDate:baseline.lowDate,baselineEndBalance:baseline.endBalance,baselineShortfall:baseline.firstShortfall,personalContribution,spouseContribution,perPerson:personalContribution*2,spouseTotal:spouseContribution*2,safePerContribution:safeMine,safeSpouseContribution:safeSpouse,safePerPerson:safeMine*2,safeSpouseTotal:safeSpouse*2,safeTotal:smaller.total,safeSchedule:smaller.schedule,buffer,periodStart,end,checkedThrough:f.end};
}
