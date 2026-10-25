// Derive the income shortcut from private saved records, never public presets.
const number=value=>value===''||value===null||value===undefined?null:Number(value);
export function incomeFromTracker(state){
 let app;try{app=JSON.parse(state?.values?.['app-state']||'null');}catch{return null;}
 if(!app)return null;
 const pay=number(app.takeHome),hourlyRate=number(app.hourlyRate)??0,hoursPerCheck=number(app.hoursPerCheck)??0,amount=pay===null?null:Math.round(pay*100);
 if(!Number.isSafeInteger(amount)||amount<=0||amount>1e12||!Number.isFinite(hourlyRate)||hourlyRate<0||!Number.isFinite(hoursPerCheck)||hoursPerCheck<0)return null;
 return {hourlyRate,hoursPerCheck,amount,estimated:false,repeat:'biweekly'};
}
export function incomeFromPlan(state){
 const pay=state?.income?.find(p=>p.amount>0&&['biweekly','weekly','monthly'].includes(p.repeat));if(!pay)return null;
 const amount=pay.repeat==='weekly'?pay.amount*2:pay.repeat==='monthly'?Math.round(pay.amount*12/26):pay.amount;
 if(!Number.isSafeInteger(amount)||amount<=0)return null;
 return {hourlyRate:Number(pay.hourlyRate)||0,hoursPerCheck:Number(pay.hoursPerCheck)||0,amount,estimated:!!pay.estimated,repeat:'biweekly'};
}
