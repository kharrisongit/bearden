// Rent is scheduled on the first. The portal's account-level due date is not a lease due date.
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const positive=value=>Number.isSafeInteger(value)&&value>0;
export function nextRentDate(when=Date.now()){
 const timestamp=new Date(when);if(!Number.isFinite(timestamp.getTime()))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Detroit',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(timestamp).map(p=>[p.type,p.value]));
 return new Date(Date.UTC(Number(parts.year),Number(parts.month)-1+(Number(parts.day)>1?1:0),1)).toISOString().slice(0,10);
}
export function rentSchedule(bill){return bill.billKind==='rent'&&validDate(bill.date)?{...bill,date:bill.date.slice(0,7)+'-01',repeat:'monthly'}:bill;}
export function rentReadings(sun,field='currentBalance'){
 if(!['currentBalance','amountDue'].includes(field))return [];
 const readings=(sun?.rentReadings||[]).filter(r=>validDate(r.date)&&r.date.endsWith('-01')&&positive(r[field]));
 const snapshot=sun?.snapshot,date=nextRentDate(snapshot?.checkedAt);
 if(snapshot?.currency==='USD'&&date&&positive(snapshot[field]))readings.push({date,[field]:snapshot[field],checkedAt:snapshot.checkedAt});
 const byDate=new Map();for(const r of readings){const old=byDate.get(r.date);if(!old||r.checkedAt>=old.checkedAt)byDate.set(r.date,{date:r.date,amount:r[field],checkedAt:r.checkedAt});}
 return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-24);
}
export function rememberRentReadings(sun){
 const byDate=new Map();for(const field of ['currentBalance','amountDue'])for(const r of rentReadings(sun,field))byDate.set(r.date,{...byDate.get(r.date),date:r.date,[field]:r.amount,checkedAt:r.checkedAt});
 sun.rentReadings=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-24);
}
export function linkSunRent(planner,id,field,sun,bill){
 if(!id){delete planner.sunRent;return;}
 if(!bill||bill.id!==id)throw Error('Choose an existing rent bill.');
 if(!['currentBalance','amountDue'].includes(field))throw Error('Choose which Sun amount to use.');
 if(!sun?.connected&&!sun?.snapshot)throw Error('Connect Sun in Settings first.');
 const old=planner.sunRent?.billId===id?planner.sunRent:null;
 const readings=new Map((old?.amountField==='currentBalance'?old.readings||[]:[]).map(r=>[r.date,r]));
 for(const reading of rentReadings(sun))readings.set(reading.date,reading);
 planner.sunRent={billId:id,amountField:'currentBalance',baseAmount:old?.baseAmount??bill.amount,readings:[...readings.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-24),linkedAt:old?.linkedAt||new Date().toISOString()};
}
export function sunRentBill(bill,link,sun){
 const scheduled=rentSchedule(bill);if(bill.billKind!=='rent'||link?.billId!==bill.id)return scheduled;
 const byDate=new Map((link.amountField==='amountDue'?[]:link.readings||[]).filter(r=>validDate(r.date)&&positive(r.amount)).map(r=>[r.date,r]));
 for(const r of rentReadings(sun))byDate.set(r.date,r);
 const readings=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
 return {...scheduled,amount:readings.at(-1)?.amount??scheduled.amount,rentBaseAmount:positive(link.baseAmount)?link.baseAmount:scheduled.amount,rentReadings:readings,rentLinked:true,rentNeedsLogin:!!sun?.needsLogin||!sun?.connected};
}
export function rentOccurrence(bill,date){
 if(!bill.rentLinked)return bill;
 const reading=bill.rentReadings?.filter(r=>r.date<=date).at(-1);
 return {...bill,amount:reading?.amount??bill.rentBaseAmount??bill.amount,rentConfirmed:reading?.date===date,rentEstimated:reading?.date!==date};
}
export function rentPaidKey(key,bill){
 if(bill.billKind!=='rent'||!key.startsWith(bill.id+':'))return key;
 const date=key.slice(bill.id.length+1);return validDate(date)?bill.id+':'+date.slice(0,7)+'-01':key;
}
