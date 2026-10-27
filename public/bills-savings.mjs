import {occurrences} from './engine.mjs';

// All amounts are integer cents. The supplied ledger extends past the last
// suggested transfer date so the end of a chart is not treated as a free balance.
export function billsSavingsPlan(f,start,{end=f.end,buffer=10000}={}){
 const unavailable={status:'unavailable',now:0,total:0,schedule:[]};
 if(!Number.isSafeInteger(f.opening)||!Number.isSafeInteger(buffer)||buffer<0||end<start||end>f.end)return unavailable;
 const rows=f.rows.filter(r=>r.date>=start&&r.date<=f.end);
 if(rows.some(r=>!Number.isSafeInteger(r.delta)))return unavailable;
 // Bills may settle before a same-day contribution. Preserve those temporary
 // lows instead of using only the chart's end-of-day balances.
 rows.sort((a,b)=>a.date.localeCompare(b.date)||(a.delta<0?0:1)-(b.delta<0?0:1));
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
export function billsReclaimPlan(f,start,{end,buffer=10000,personalStart,spouseStart,contribution=75000}={}){
 const unavailable={status:'unavailable'};
 if(!Number.isSafeInteger(f.opening)||!Number.isSafeInteger(buffer)||buffer<0||!Number.isSafeInteger(contribution)||contribution<=0||!end||end<start||end>f.end||!personalStart||!spouseStart)return unavailable;
 const own=thirdPaycheckDates(personalStart,start,end).slice(0,2),spouse=thirdPaycheckDates(spouseStart,start,end).slice(0,2);
 if(own.length<2||spouse.length<2)return {status:'dates',own,spouse,end};
 const rows=f.rows.filter(r=>r.date>=start&&r.date<=f.end);
 if(rows.some(r=>!Number.isSafeInteger(r.delta)))return unavailable;
 const dates=[...new Set([...own,...spouse])].sort(),planned=dates.map(date=>({date,mine:own.includes(date),spouse:spouse.includes(date),reclaim:true}));
 const rank=e=>e.reclaim?2:e.delta<0?0:1;
 const events=[...rows,...planned].sort((a,b)=>a.date.localeCompare(b.date)||rank(a)-rank(b));
 function evaluate(amount){
  let balance=f.opening,low=f.opening,reclaimed=0,lowAfterReclaim=null,firstShortfall=balance<0?{date:start,balance}:null,firstBelowBuffer=null;
  const schedule=[];
  for(const event of events){
   const withdrawal=event.reclaim?amount*(Number(event.mine)+Number(event.spouse)):0;
   balance+=event.reclaim?-withdrawal:event.delta;
   if(!Number.isSafeInteger(balance))return null;
   reclaimed+=withdrawal;low=Math.min(low,balance);
   if(reclaimed>0){lowAfterReclaim=lowAfterReclaim===null?balance:Math.min(lowAfterReclaim,balance);if(balance<buffer&&!firstBelowBuffer)firstBelowBuffer={date:event.date,balance};}
   if(balance<0&&!firstShortfall)firstShortfall={date:event.date,balance};
   if(event.reclaim)schedule.push({date:event.date,mine:event.mine?amount:0,spouse:event.spouse?amount:0,amount:withdrawal,balanceAfter:balance});
  }
  return {safe:!firstShortfall&&!firstBelowBuffer,low,lowAfterReclaim,firstShortfall,firstBelowBuffer,schedule,total:reclaimed};
 }
 const requested=evaluate(contribution),baseline=evaluate(0);
 if(!requested||!baseline)return unavailable;
 let low=0,high=contribution;
 while(low<high){const mid=Math.ceil((low+high)/2),result=evaluate(mid);if(result?.safe)low=mid;else high=mid-1;}
 return {status:'ready',...requested,baselineLow:baseline.low,baselineShortfall:baseline.firstShortfall,perPerson:contribution*2,safePerContribution:low,safePerPerson:low*2,safeTotal:low*4,safeSchedule:evaluate(low).schedule,buffer,end,checkedThrough:f.end};
}
