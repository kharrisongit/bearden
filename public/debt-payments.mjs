// Monthly amounts are shown in account editors. The payoff engine retains
// its existing 26-paycheck annual allocation, including legacy saved amounts.
const money=value=>Math.round((Number(value)||0)*100)/100;
export function monthlyMinimum(card){
 return money(Number.isFinite(card?.monthlyMinimum)?card.monthlyMinimum:(Number(card?.min)||0)*26/12);
}
export function monthlyPaymentSettings(card,amount){
 const monthly=money(amount);
 return {monthlyMinimum:monthly,min:card&&monthly===monthlyMinimum(card)?card.min:money(monthly*12/26)};
}


export function paymentTiming(value={}){
 value=value||{};
 return {mode:value.mode==='due-date'?'due-date':'every-paycheck',leadDays:Math.min(14,Math.max(1,Math.round(Number(value.leadDays)||3)))};
}
export function validDueDate(value){
 return /^\d{4}-\d{2}-\d{2}$/.test(value||'')&&Number.isFinite(Date.parse(value+'T12:00Z'))&&new Date(value+'T12:00Z').toISOString().slice(0,10)===value;
}
// Each monthly due date belongs to the last biweekly payday before its buffer.
// Calendar arithmetic uses UTC noon so daylight-saving changes cannot move a day.
export function scheduledPayment(card,payday,startDate,settings={}){
 const timing=paymentTiming(settings),fallback={scheduled:true,minimum:Math.max(0,Number(card.min)||0),dueDate:null,late:false,missingDate:false};
 if(timing.mode!=='due-date')return fallback;
 if(!validDueDate(card.dueDate))return {...fallback,missingDate:true};
 const stamp=value=>Date.parse(value+'T12:00Z'),day=86400000,p=stamp(payday),start=stamp(startDate),next=p+14*day,d=new Date(p),dueDay=Number(card.dueDate.slice(8));
 let due=null;
 for(let offset=-1;offset<=2;offset++){
  const first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+offset,1,12));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
  const at=Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(dueDay,last),12),deadline=at-timing.leadDays*day;
  if((deadline>=p&&deadline<next)||(p===start&&at>=p&&deadline<p))due=at;
 }
 return {scheduled:due!==null,minimum:due===null?0:monthlyMinimum(card),dueDate:due===null?null:new Date(due).toISOString().slice(0,10),late:due!==null&&due-timing.leadDays*day<p,missingDate:false};
}
