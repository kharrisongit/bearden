export const cents = n => Math.round(Number(n || 0) * 100);
export const money = n => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
export const today = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export function day(s,n=0){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function monthly(s,n){const d=new Date(s+'T12:00:00Z'), original=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(original,last));return d.toISOString().slice(0,10);}
export function blank(){return {version:1,settings:{cushion:25000,method:'snowball',intensity:'balanced',bonusMode:'split',horizon:90},accounts:[],bills:[],debts:[],goals:[],income:[],bonuses:[],squash:[],paid:[],emailSenders:[]};}
export function occurrences(date,repeat,start,end){let out=[];if(!date)return out;for(let i=0;i<2400;i++){const d=repeat==='monthly'?monthly(date,i):day(date,i*(repeat==='weekly'?7:repeat==='biweekly'?14:0));if(d>end)break;if(d>=start)out.push(d);if(!['monthly','weekly','biweekly'].includes(repeat))break;}return out;}
export function validate(s){
 if(!s||s.version!==1||!s.settings)throw Error('This is not a BearDen backup.');
 const collections=['accounts','bills','debts','goals','income','bonuses'];
 for(const key of collections){if(!Array.isArray(s[key])||s[key].length>1000)throw Error('Invalid '+key);const ids=new Set();for(const x of s[key]){if(!x||typeof x.id!=='string'||x.id.includes(':')||ids.has(x.id))throw Error('Invalid or duplicate ID');ids.add(x.id);if(typeof x.name!=='string'||!x.name.trim()||x.name.length>200)throw Error('Invalid name');const required={accounts:['balance'],bills:['amount'],income:['amount'],bonuses:['amount'],debts:['balance','minimum'],goals:['target','saved','contribution']}[key];for(const field of required)if(!Number.isSafeInteger(x[field])||Math.abs(x[field])>1e12||(x[field]<0&&key!=='accounts'))throw Error('Invalid amount');if(key==='debts'&&(!Number.isFinite(x.apr)||x.apr<0||x.apr>100))throw Error('Invalid APR');if(['bills','income','bonuses','debts'].includes(key)&&(!/^\d{4}-\d{2}-\d{2}$/.test(x.date)||day(x.date)!==x.date))throw Error('Invalid date');if(['bills','income'].includes(key)&&!['once','monthly','weekly','biweekly'].includes(x.repeat))throw Error('Invalid recurrence');if(key==='accounts'&&typeof x.include!=='boolean')throw Error('Invalid account selection');}}
 for(const key of ['paid','squash','emailSenders'])if(!Array.isArray(s[key])||s[key].length>10000||s[key].some(x=>typeof x!=='string'))throw Error('Invalid '+key);
 if(!Number.isSafeInteger(s.settings.cushion)||s.settings.cushion<0||![30,60,90,180,365].includes(s.settings.horizon)||!['snowball','avalanche','squasher','cushionCascade'].includes(s.settings.method))throw Error('Invalid planner settings');return s;
}
export function forecast(s,start=today(),length=s.settings.horizon){
 const end=day(start,length), events=[],paid=new Set(s.paid), balances=s.debts.map(d=>d.balance), savings=s.goals.map(g=>g.saved);
 for(const p of s.income)for(const date of occurrences(p.date,p.repeat,start,end))events.push({date,type:'income',id:p.id+':'+date,name:p.name,amount:p.amount});
 for(const b of s.bonuses)if(b.date>=start&&b.date<=end)events.push({date:b.date,type:'bonus',id:b.id,name:b.name,amount:b.amount});
 for(const b of s.bills){const dates=b.repeat==='once'&&b.date<start?[b.date]:occurrences(b.date,b.repeat,start,end);for(const date of dates)if(!paid.has(b.id+':'+date))events.push({date:date<start?start:date,type:'bill',id:b.id+':'+date,name:b.name+(date<start?' (overdue)':''),amount:-b.amount});}
 // Debt minimums are actual monthly obligations, separate from extra payoff suggestions.
 for(const [i,d] of s.debts.entries())for(const date of occurrences(d.date,'monthly',start,end))if(!paid.has(d.id+':'+date))events.push({date,type:'minimum',id:d.id+':'+date,name:d.name,amount:-d.minimum,debt:i});
 const priority={bill:0,minimum:1,income:2,bonus:2};events.sort((a,b)=>a.date.localeCompare(b.date)||priority[a.type]-priority[b.type]);
 let cash=s.accounts.filter(a=>a.include).reduce((n,a)=>n+a.balance,0), low=cash,firstShortfall=cash<0?start:null,interest=0,lastDate=start;
 const rows=[],checks=[];
 for(let idx=0;idx<events.length;idx++){
  const e=events[idx],elapsed=Math.round((new Date(e.date)-new Date(lastDate))/86400000);
  if(elapsed>0){balances.forEach((b,i)=>{const add=Math.round(b*s.debts[i].apr/100*elapsed/365);balances[i]+=add;interest+=add;});lastDate=e.date;}
  if(e.type==='minimum'){const due=Math.min(balances[e.debt],-e.amount);e.amount=-due;balances[e.debt]-=due;}
  cash+=e.amount;low=Math.min(low,cash);if(cash<0&&!firstShortfall)firstShortfall=e.date;
  rows.push({...e,balance:cash});
  // Combine all deposits on a day, then plan once. Bills on payday conservatively precede deposits.
  if(['income','bonus'].includes(e.type)&&!(events[idx+1]?.date===e.date&&['income','bonus'].includes(events[idx+1].type))){
   const next=events.slice(idx+1).find(x=>['income','bonus'].includes(x.type))?.date||end;
   const reserve=events.slice(idx+1).filter(x=>x.date<=next&&x.amount<0).reduce((n,x)=>n-x.amount,0);
   const baseCushion=s.settings.cushion, bonus=events.filter(x=>x.date===e.date&&x.type==='bonus').reduce((n,x)=>n+x.amount,0);
   const multiplier=s.settings.method==='cushionCascade'?({conservative:1.5,balanced:1,aggressive:.5}[s.settings.intensity]||1):1;
   const keepBonus=s.settings.method==='cushionCascade'?Math.round(bonus*({retain:1,split:.5,apply:0}[s.settings.bonusMode]??.5)):0;
   let pool=Math.max(0,cash-reserve-Math.round(baseCushion*multiplier)-keepBonus);
   const save=s.goals.map((g,i)=>{const n=Math.min(pool,g.contribution,Math.max(0,g.target-savings[i]));pool-=n;savings[i]+=n;return n;});
   const debt=balances.map(()=>0), largest=new Set(balances.map((b,i)=>({b,i})).filter(x=>x.b>0).sort((a,b)=>b.b-a.b).slice(0,3).map(x=>x.i));
   let order=balances.map((_,i)=>i).sort((a,b)=>s.settings.method==='avalanche'?s.debts[b].apr-s.debts[a].apr:balances[a]-balances[b]);
   for(const i of order){let target=balances[i];if(s.settings.method==='squasher'&&!s.squash.includes(e.date))target=(bonus>0?largest.has(i):!largest.has(i))?Math.ceil(balances[i]/2):0;const n=Math.min(pool,target);pool-=n;balances[i]-=n;debt[i]=n;}
   const allocated=save.reduce((a,b)=>a+b,0)+debt.reduce((a,b)=>a+b,0);cash-=allocated;
   if(allocated)rows.push({date:e.date,type:'plan',name:'Suggested debt & savings',amount:-allocated,balance:cash});
   checks.push({date:e.date,next,reserve,bonus,debt,save,left:cash,shortfall:Math.max(0,reserve+baseCushion-cash),income:events.filter(x=>x.date===e.date&&['income','bonus'].includes(x.type)).reduce((n,x)=>n+x.amount,0)});
   low=Math.min(low,cash);
  }
 }
 return {rows,checks,low,firstShortfall,endBalance:cash,balances,savings,interest,end};
}
