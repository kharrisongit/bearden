export const cents = n => Math.round(Number(n || 0) * 100);
export const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function day(s,n=0){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function monthly(s,n){const d=new Date(s+'T12:00:00Z'), original=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(original,last));return d.toISOString().slice(0,10);}
export function blank(){return {version:1,settings:{cushion:25000,method:'snowball',intensity:'balanced',bonusMode:'split',horizon:90},accounts:[],bills:[],debts:[],goals:[],income:[],bonuses:[],squash:[],paid:[],emailSenders:[]};}
export function occurrences(date,repeat,start,end){
 const out=[];if(!date||!start||!end||start>end||![date,start,end].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T12:00:00Z'))))return out;
 if(!['monthly','weekly','biweekly'].includes(repeat))return date>=start&&date<=end?[date]:[];
 const step=repeat==='weekly'?7:14,months=(a,b)=>(Number(b.slice(0,4))-Number(a.slice(0,4)))*12+Number(b.slice(5,7))-Number(a.slice(5,7));
 const offset=repeat==='monthly'?months(date,start):Math.floor((Date.parse(start+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000/step);
 const last=repeat==='monthly'?months(date,end):Math.floor((Date.parse(end+'T12:00:00Z')-Date.parse(date+'T12:00:00Z'))/86400000/step);
 for(let i=Math.max(0,offset);i<=last;i++){const d=repeat==='monthly'?monthly(date,i):day(date,i*step);if(d>=start&&d<=end)out.push(d);}
 return out;
}

export function validate(s){
 if(!s||s.version!==1||!s.settings)throw Error('This is not a BearDen backup.');
 const collections=['accounts','bills','debts','goals','income','bonuses'];
 for(const key of collections){if(!Array.isArray(s[key])||s[key].length>1000)throw Error('Invalid '+key);const ids=new Set();for(const x of s[key]){if(!x||typeof x.id!=='string'||x.id.includes(':')||ids.has(x.id))throw Error('Invalid or duplicate ID');ids.add(x.id);if(typeof x.name!=='string'||!x.name.trim()||x.name.length>200)throw Error('Invalid name');const required={accounts:['balance'],bills:['amount'],income:['amount'],bonuses:['amount'],debts:['balance','minimum'],goals:['target','saved','contribution']}[key];for(const field of required)if(!Number.isSafeInteger(x[field])||Math.abs(x[field])>1e12||(x[field]<0&&key!=='accounts'))throw Error('Invalid amount');if(key==='debts'&&x.minimumRepeat!==undefined&&!['monthly','biweekly'].includes(x.minimumRepeat))throw Error('Invalid debt payment schedule');if(key==='debts'&&(!Number.isFinite(x.apr)||x.apr<0||x.apr>100))throw Error('Invalid APR');if(['bills','income','bonuses','debts'].includes(key)&&(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||day(x.date)!==x.date))throw Error('Invalid date');if(['bills','income'].includes(key)&&!['once','monthly','weekly','biweekly'].includes(x.repeat))throw Error('Invalid recurrence');if(key==='accounts'&&typeof x.include!=='boolean')throw Error('Invalid account selection');}}
 for(const key of ['paid','squash','emailSenders'])if(!Array.isArray(s[key])||s[key].length>10000||s[key].some(x=>typeof x!=='string'))throw Error('Invalid '+key);
 if(s.checkEdits!==undefined){
  if(!s.checkEdits||typeof s.checkEdits!=='object'||Array.isArray(s.checkEdits)||Object.keys(s.checkEdits).length>2000)throw Error('Invalid paycheck edits');
  const amount=n=>{if(!Number.isSafeInteger(n)||n<0||n>1e12)throw Error('Invalid paycheck amount');};
  for(const [date,edit] of Object.entries(s.checkEdits)){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||day(date)!==date||!edit||typeof edit!=='object'||Array.isArray(edit))throw Error('Invalid paycheck edit');
   if(edit.income!==undefined)amount(edit.income);
   for(const key of ['bills','debt','savings'])if(edit[key]!==undefined){if(!edit[key]||typeof edit[key]!=='object'||Array.isArray(edit[key])||Object.keys(edit[key]).length>2000)throw Error('Invalid paycheck breakdown');Object.values(edit[key]).forEach(amount);}
   if(edit.expenses!==undefined){if(!Array.isArray(edit.expenses)||edit.expenses.length>100)throw Error('Invalid one-time expenses');const ids=new Set();for(const x of edit.expenses){if(!x||typeof x.id!=='string'||x.id.includes(':')||ids.has(x.id)||typeof x.name!=='string'||!x.name.trim()||x.name.length>200)throw Error('Invalid one-time expense');ids.add(x.id);amount(x.amount);}}
  }
 }
 if(!Number.isSafeInteger(s.settings.cushion)||s.settings.cushion<0||![30,60,90,180,365].includes(s.settings.horizon)||!['snowball','avalanche','squasher','cushionCascade'].includes(s.settings.method))throw Error('Invalid planner settings');return s;
}
export function forecast(s,start=today(),length=s.settings.horizon){
 const end=day(start,length), events=[],paid=new Set(s.paid), balances=s.debts.map(d=>d.balance), savings=s.goals.map(g=>g.saved);
 for(const p of s.income)for(const date of occurrences(p.date,p.repeat,start,end))events.push({date,type:'income',id:p.id+':'+date,name:p.name,amount:p.amount});
 for(const b of s.bonuses)if(b.date>=start&&b.date<=end)events.push({date:b.date,type:'bonus',id:b.id,name:b.name,amount:b.amount});
 for(const b of s.bills){const dates=b.repeat==='once'&&b.date<start?[b.date]:occurrences(b.date,b.repeat,start,end);for(const date of dates)if(!paid.has(b.id+':'+date))events.push({date:date<start?start:date,type:['budget','baby-bear-budget'].includes(b.source)?'budget':'bill',id:b.id+':'+date,name:b.name+(date<start?' (overdue)':''),amount:-b.amount});}
 // Debt payments follow their configured schedule; existing debts default to monthly.
 for(const [i,d] of s.debts.entries())for(const date of occurrences(d.date,d.minimumRepeat||'monthly',start,end))if(!paid.has(d.id+':'+date))events.push({date,type:'minimum',id:d.id+':'+date,name:d.name,amount:-d.minimum,debt:i});
 // Overrides are keyed by date and occurrence, so changing one check never rewrites a recurring default.
 const edits=s.checkEdits||{}, billEdits=Object.assign({},...Object.values(edits).map(x=>x.bills||{}));
 for(const event of events)if(['bill','budget','minimum'].includes(event.type)&&billEdits[event.id]!==undefined)event.amount=-billEdits[event.id];
 for(const [date,edit] of Object.entries(edits)){
  const deposits=events.filter(x=>x.date===date&&x.type==='income');
  if(edit.income!==undefined&&deposits.length){deposits[0].amount=edit.income;deposits.slice(1).forEach(x=>x.amount=0);}
  if(date>=start&&date<=end&&events.some(x=>x.date===date&&['income','bonus'].includes(x.type)))for(const x of edit.expenses||[])events.push({date,type:'expense',id:'extra:'+date+':'+x.id,name:x.name,amount:-x.amount});
 }
 const priority={bill:0,minimum:1,income:2,bonus:2,budget:3,expense:3};events.sort((a,b)=>a.date.localeCompare(b.date)||priority[a.type]-priority[b.type]);
 let cash=s.accounts.filter(a=>a.include).reduce((n,a)=>n+a.balance,0), low=cash,firstShortfall=cash<0?start:null,interest=0,lastDate=start;
 const rows=[],checks=[];let accrued=balances.map(()=>0),minimumPaid=balances.map(()=>0);
 let debtFreeDate=balances.every(b=>b===0)?start:null;
 for(let idx=0;idx<events.length;idx++){
  const e=events[idx],elapsed=Math.round((new Date(e.date)-new Date(lastDate))/86400000);
  if(elapsed>0){balances.forEach((b,i)=>{const add=Math.round(b*s.debts[i].apr/100*elapsed/365);balances[i]+=add;interest+=add;accrued[i]+=add;});lastDate=e.date;}
  if(e.type==='minimum'){const due=Math.min(balances[e.debt],-e.amount);e.amount=-due;balances[e.debt]-=due;minimumPaid[e.debt]+=due;}
  cash+=e.amount;low=Math.min(low,cash);if(cash<0&&!firstShortfall)firstShortfall=e.date;
  rows.push({...e,balance:cash});
  // Combine all deposits on a day, then plan once. Bills on payday conservatively precede deposits.
  if(['income','bonus'].includes(e.type)&&!(events[idx+1]?.date===e.date&&['income','bonus'].includes(events[idx+1].type))){
   const next=events.slice(idx+1).find(x=>['income','bonus'].includes(x.type))?.date||end;
   const obligations=events.slice(idx+1).filter(x=>x.date<=next&&x.amount<=0&&!['income','bonus'].includes(x.type)&&(x.type!=='expense'||x.date===e.date)&&(x.type!=='budget'||x.date<next||x.date===e.date));
   const reserve=obligations.reduce((n,x)=>n-x.amount,0),edit=edits[e.date]||{};let capped=false;
   const baseCushion=s.settings.cushion, bonus=events.filter(x=>x.date===e.date&&x.type==='bonus').reduce((n,x)=>n+x.amount,0);
   const multiplier=s.settings.method==='cushionCascade'?({conservative:1.5,balanced:1,aggressive:.5}[s.settings.intensity]||1):1;
   const keepBonus=s.settings.method==='cushionCascade'?Math.round(bonus*({retain:1,split:.5,apply:0}[s.settings.bonusMode]??.5)):0;
   let pool=Math.max(0,cash-reserve-Math.round(baseCushion*multiplier)-keepBonus);
   const save=s.goals.map((g,i)=>{const target=edit.savings?.[g.id]??g.contribution,n=Math.min(pool,target,Math.max(0,g.target-savings[i]));if(edit.savings?.[g.id]!==undefined&&n<target)capped=true;pool-=n;savings[i]+=n;return n;});
   const debt=balances.map(()=>0), largest=new Set(balances.map((b,i)=>({b,i})).filter(x=>x.b>0).sort((a,b)=>b.b-a.b).slice(0,3).map(x=>x.i));
   let order=balances.map((_,i)=>i).sort((a,b)=>s.settings.method==='avalanche'?s.debts[b].apr-s.debts[a].apr:balances[a]-balances[b]);
   // Reserve explicit extra payments before distributing remaining money automatically.
   order.sort((a,b)=>Number(edit.debt?.[s.debts[b].id]!==undefined)-Number(edit.debt?.[s.debts[a].id]!==undefined));
   for(const i of order){let target=balances[i];if(s.settings.method==='squasher'&&!s.squash.includes(e.date))target=(bonus>0?largest.has(i):!largest.has(i))?Math.ceil(balances[i]/2):0;const requested=edit.debt?.[s.debts[i].id];if(requested!==undefined)target=Math.min(requested,balances[i]);const n=Math.min(pool,target);if(requested!==undefined&&n<requested)capped=true;pool-=n;balances[i]-=n;debt[i]=n;}
   const allocated=save.reduce((a,b)=>a+b,0)+debt.reduce((a,b)=>a+b,0);cash-=allocated;
   if(allocated)rows.push({date:e.date,type:'plan',name:'Suggested debt & savings',amount:-allocated,balance:cash});
   checks.push({date:e.date,next,reserve,bonus,debt,save,obligations:obligations.map(x=>({...x})),balances:[...balances],savings:[...savings],accrued:[...accrued],minimumPaid:[...minimumPaid],capped,left:cash,shortfall:Math.max(0,reserve+baseCushion-cash),income:events.filter(x=>x.date===e.date&&['income','bonus'].includes(x.type)).reduce((n,x)=>n+x.amount,0)});
   accrued.fill(0);minimumPaid.fill(0);
   low=Math.min(low,cash);
  }
  if(!debtFreeDate&&balances.every(b=>b===0))debtFreeDate=e.date;
 }
 return {debtFreeDate,rows,checks,low,firstShortfall,endBalance:cash,balances,savings,interest,end};
}
