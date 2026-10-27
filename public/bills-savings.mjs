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
 if(shortfall)return {...unavailable,status:'shortfall',shortfall,needed:-Math.min(...states.map(s=>s.balance)),checkedThrough:f.end};
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
