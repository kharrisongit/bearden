// Monthly amounts are shown in account editors. Legacy per-paycheck values
// remain readable; accounts with calculation rules fund each actual due cycle.
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
export function paymentIsLate(timing,payday,today,checked,amount){
 return !checked&&amount>0&&validDueDate(timing?.dueDate)&&timing.dueDate<(payday>today?payday:today);
}
// Split a complete monthly requirement across the actual biweekly paydays in
// (previous due date, current due date]. The last payday receives cent residue.
export function monthlyPaycheckAllocation(card,payday,startDate){
 if(!validDueDate(card?.dueDate)||!validDueDate(payday)||!validDueDate(startDate))return null;
 const stamp=value=>Date.parse(value+'T12:00Z'),period=14*86400000,p=stamp(payday),start=stamp(startDate);
 if(p<start||(p-start)%period!==0)return null;
 const current=new Date(p),dueDay=Number(card.dueDate.slice(8));
 const dueAt=offset=>{
  const first=new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()+offset,1,12));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
  return Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(dueDay,last),12);
 };
 const offset=p<=dueAt(0)?0:1,due=dueAt(offset),previous=dueAt(offset-1);
 const firstIndex=Math.max(0,Math.floor((previous-start)/period)+1),lastIndex=Math.floor((due-start)/period);
 const count=lastIndex-firstIndex+1,index=Math.round((p-start)/period)-firstIndex;
 if(count<1||index<0||index>=count)return null;
 const monthly=Math.max(0,monthlyMinimum(card)),total=Math.round(monthly*100),base=Math.floor(total/count);
 return {scheduled:true,minimum:(base+(index===count-1?total-base*count:0))/100,
  dueDate:new Date(due).toISOString().slice(0,10),cycleStart:new Date(previous).toISOString().slice(0,10),
  cyclePaychecks:count,cyclePaycheckIndex:index+1,monthlyMinimum:monthly,allocation:'monthly-split',late:false,missingDate:false};
}
// Each monthly due date belongs to the last biweekly payday before its buffer.
// Calendar arithmetic uses UTC noon so daylight-saving changes cannot move a day.
export function scheduledPayment(card,payday,startDate,settings={}){
 const metadata={estimatedMinimum:!!card.estimatedMinimum,missingFutureMinimum:!!card.missingFutureMinimum,forecastMonthlyMinimum:card.forecastMonthlyMinimum??null};
 const timing=paymentTiming(settings),fallback={...metadata,scheduled:true,minimum:Math.max(0,Number(card.min)||0),dueDate:null,late:false,missingDate:false};
 if(timing.mode!=='due-date'){
  const profiled=card.interestRules&&typeof card.interestRules==='object'&&!Array.isArray(card.interestRules);
  return profiled?{...fallback,...monthlyPaycheckAllocation(card,payday,startDate),missingDate:!validDueDate(card.dueDate)}:fallback;
 }
 if(!validDueDate(card.dueDate))return {...fallback,missingDate:true};
 const stamp=value=>Date.parse(value+'T12:00Z'),day=86400000,p=stamp(payday),start=stamp(startDate),next=p+14*day,d=new Date(p),dueDay=Number(card.dueDate.slice(8));
 let due=null;
 for(let offset=-1;offset<=2;offset++){
  const first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+offset,1,12));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
  const at=Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(dueDay,last),12),deadline=at-timing.leadDays*day;
  if((deadline>=p&&deadline<next)||(p===start&&at>=p&&deadline<p))due=at;
 }
 return {...metadata,scheduled:due!==null,minimum:due===null?0:monthlyMinimum(card),dueDate:due===null?null:new Date(due).toISOString().slice(0,10),late:due!==null&&due-timing.leadDays*day<p,missingDate:false};
}

// Synced terms take effect on upcoming paydays. Checked history stays unchanged.
export function effectiveDebtTerms(card,terms,payday,checked=false){
 if(checked||!terms||!validDueDate(terms.date)||payday<terms.date)return card;
 // A provider zero describes one paid statement. User-entered zero stays literal.
 // Future amounts are labeled estimates until a new statement supplies its minimum.
 const afterPaidCycle=terms.monthlyMinimum===0&&terms.currentCycleMinimum&&payday>(validDueDate(terms.currentCycleThrough)?terms.currentCycleThrough:terms.date);
 const future=Number(terms.forecastMonthlyMinimum)>0?Number(terms.forecastMonthlyMinimum):monthlyMinimum(card)>0?monthlyMinimum(card):null;
 const monthly=afterPaidCycle?future??0:terms.monthlyMinimum;
 return {...card,...(validDueDate(terms.dueDate)?{dueDate:terms.dueDate}:{}),
  ...(Number.isFinite(monthly)&&monthly>=0?monthlyPaymentSettings(card,monthly):{}),
  ...(afterPaidCycle?{estimatedMinimum:future!==null,missingFutureMinimum:future===null,forecastMonthlyMinimum:future}:{}),
  ...(Number.isFinite(terms.apr)&&terms.apr>=0&&terms.apr<=100?{apr:terms.apr}:{})};
}

