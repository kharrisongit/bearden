import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecastReport} from '../public/forecast-report-data.mjs';
import {billEvents,scenarioForecast,paydayEvents} from '../public/income-model.mjs';

const start='2026-10-28',generatedAt='2026-10-28T16:00:00Z';
function fixture({opening=500000,billAmount=200000,personalStart='2026-11-06',spouseRepeat='biweekly',additionalDeposits=[]}={}){
 const accounts=[{id:'plaid-own',name:'Personal checking',type:'depository',subtype:'checking',currency:'USD',balance:5872,balanceUpdated:'2026-10-28T15:00:00Z'},{id:'plaid-bills',name:'Bills checking',type:'depository',subtype:'checking',currency:'USD',balance:opening,balanceUpdated:'2026-10-28T15:00:00Z'}];
 const household={enabled:true,personalAccountId:'plaid-own',billsAccountId:'plaid-bills',personalAmount:75500,spouseAmount:75500,spouseStartDate:personalStart,spouseRepeat,additionalDeposits};
 const budgetItems=[{id:1,label:'Car Fuel',amount:100},{id:2,label:'Groceries',amount:100},{id:3,label:'Personal spending',amount:25}];
 const plan={state:{startDate:personalStart,takeHome:1840.23,budgetItems,cards:[{id:1,name:'Visa',balance:10000,apr:0,min:50}],checkedPaychecks:{}},schedule:[1,2].map((paycheck,index)=>({paycheck,date:index?'2026-11-20':'2026-11-06',takeHomeThisCheck:1840.23,bonusAmount:0,budgetLineItemsThisCheck:budgetItems,extrasThisCheck:[],payments:[860.23],savingsByGoal:[]}))};
 const billPlan={bills:[]},paymentsPlanner={household,manual:[{id:'rent',name:'Rent',amount:billAmount,date:'2026-11-01',repeat:'monthly',billKind:'rent',source:'manual'}],billFunding:{rent:'shared'},paid:[]};
 const context={accounts,plan,billPlan,paymentsPlanner,linked:{},today:start,end:'2026-11-27',length:30,household,transactions:[],account:accounts[1]};
 const bills=billEvents(billPlan,paymentsPlanner,{},start,context.end);
 const forecast=scenarioForecast(accounts,plan,bills,start,{scope:'shared',debtMode:'none',household,length:30});
 return {scope:'bills',forecast,start,plan,account:accounts[1],context,buffer:10000,generatedAt};
}
const total=(rows,key)=>rows.reduce((n,row)=>n+row[key],0);
function assertReconciles(section){
 const s=section.summary;
 assert.equal(s.income,total(section.ledger,'incoming'));
 assert.equal(s.outgoing,total(section.ledger,'outgoing'));
 assert.equal(s.closing,s.opening+s.income-s.outgoing);
 let running=s.opening;
 for(const row of section.ledger){running+=row.delta;assert.equal(row.incoming-row.outgoing,row.delta);assert.equal(row.balance,running);}
}

test('report preserves the selected forecast totals and includes every ledger entry beyond UI limits',()=>{
 const input=fixture();
 input.forecast={opening:10000,end:'2026-11-27',debtMode:'none',rows:Array.from({length:140},(_,i)=>({date:'2026-11-06',name:'Bill '+i,type:'bill',amount:25,delta:-25}))};
 const copy=structuredClone(input),r=buildForecastReport(input);
 assert.equal(r.ledger.length,140);assert.equal(r.summary.opening,10000);assert.equal(r.summary.outgoing,3500);assert.equal(r.summary.closing,6500);assert.equal(r.summary.low,6500);
 assert.equal(r.monthly.length,2);assert.equal(r.monthly[1].outgoing,3500);assert.equal(r.monthly[1].closing,6500);
 assert.equal(r.end,'2026-11-27');assert.match(r.filename,/\.pdf$/);assertReconciles(r);assert.deepEqual(input,copy);
});

test('personal paycheck report reconciles take-home, Fixed Bills and planned payments without spending the allowance',()=>{
 const input=fixture();
 input.scope='personal';input.account=input.context.accounts[0];
 const bills=billEvents(input.context.billPlan,input.context.paymentsPlanner,{},start,input.context.end);
 input.forecast=scenarioForecast(input.context.accounts,input.plan,bills,start,{scope:'personal',household:input.context.household,length:30,personalSpending:true});
 const r=buildForecastReport(input);
 assert.equal(r.debtLabel,'Full debt plan');assert.equal(r.summary.income,368046);assert.equal(r.summary.outgoing,323046);assert.equal(r.summary.closing,50872);
 assert.deepEqual(r.paychecks[0],{date:'2026-11-06',name:'Paycheck 1',income:184023,allocations:161523,fixedBills:75500,otherAllocations:86023,remaining:22500,items:[{kind:'transfer',label:'Fixed Bills transfer',amount:75500},{kind:'debt',label:'Visa',amount:86023}]});
 assert.ok(r.narratives.some(text=>text.includes('not gross wages')));assertReconciles(r);
});

test('paycheck line items use actual debt-mode deductions and count Fixed Bills once',()=>{
 const input=fixture();input.scope='personal';input.account=input.context.accounts[0];
 input.plan.schedule[0]={...input.plan.schedule[0],budgetLineItemsThisCheck:[{label:'Insurance',amount:40},{label:'Groceries',amount:100}],extrasThisCheck:[{label:'Repair',amount:20}],payments:[100],savingsByGoal:[{name:'Rainy day',contribution:30}]};
 const bills=billEvents(input.context.billPlan,input.context.paymentsPlanner,{},start,input.context.end);
 for(const [debtMode,debt,remaining]of [['full',10000,89523],['minimum',5000,94523],['none',0,99523]]){
  input.forecast=scenarioForecast(input.context.accounts,input.plan,bills,start,{scope:'personal',household:input.context.household,length:30,personalSpending:true,debtMode});
  const r=buildForecastReport(input),pay=r.paychecks[0];
  assert.equal(pay.income,184023);assert.equal(pay.remaining,remaining);assert.equal(total(pay.items,'amount'),pay.allocations);
  assert.equal(pay.items[0].kind,'transfer');assert.equal(pay.items[0].amount,75500);assert.equal(pay.items.filter(item=>item.kind==='transfer').length,1);
  assert.deepEqual(pay.items.filter(item=>item.kind==='debt'),debt?[{kind:'debt',label:'Visa',amount:debt}]:[]);
  assert.deepEqual(pay.items.filter(item=>['budget','expense','savings'].includes(item.kind)),[{kind:'budget',label:'Insurance',amount:4000},{kind:'expense',label:'Repair',amount:2000},{kind:'savings',label:'Rainy day',amount:3000}]);
  assert.ok(!pay.items.some(item=>item.label==='Groceries'));
 }
});

test('older snapshots use a reconciled fallback item and omit zero allocations',()=>{
 const input=fixture();input.scope='personal';input.context=null;
 input.forecast={opening:100,end:'2026-11-27',debtMode:'none',rows:[{date:'2026-11-06',name:'Paycheck',type:'income',amount:100000,allocations:80000,fixedBillsTransfer:75500,delta:20000}]};
 let pay=buildForecastReport(input).paychecks[0];
 assert.deepEqual(pay.items,[{kind:'transfer',label:'Fixed Bills transfer',amount:75500},{kind:'allocation',label:'Other planned payments',amount:4500}]);
 assert.equal(total(pay.items,'amount'),pay.allocations);
 // Partial metadata must not invent an itemized breakdown that disagrees with the total.
 input.forecast.rows[0].allocationDetails=[{kind:'debt',label:'Visa',amount:5000}];
 assert.deepEqual(buildForecastReport(input).paychecks[0].items,pay.items);
 input.forecast.rows=[{date:'2026-11-06',name:'Paycheck',type:'income',amount:100000,allocations:0,delta:100000,allocationDetails:[]}];
 pay=buildForecastReport(input).paychecks[0];assert.deepEqual(pay.items,[]);assert.equal(pay.remaining,100000);
});

test('reports identify the saved payoff method and filenames distinguish complete simulation ranges and modes',()=>{
 const input=fixture();input.scope='personal';
 for(const [method,label]of [['snowball','Snowball'],['avalanche','Avalanche'],['burn','Burn'],['squasher','Squasher'],['cushion-cascade','Cushion Cascade'],['minimum','Minimums'],['Custom\n repayment\u0000 plan','Custom repayment plan']]){
  input.plan.state.payoffMethod=method;
  const r=buildForecastReport(input);assert.equal(r.assumptions.find(a=>a.label==='Saved payoff method').value,label);
 }
 for(const mode of ['full','minimum','none']){
  input.forecast.debtMode=mode;
  assert.equal(buildForecastReport(input).filename,'BearDen-Personal-'+mode+'-2026-10-28-to-2026-11-27.pdf');
 }
 input.scope='bills';const shared=buildForecastReport(input);
 assert.equal(shared.filename,'BearDen-Bills-2026-10-28-to-2026-11-27.pdf');assert.ok(!shared.assumptions.some(a=>a.label==='Saved payoff method'));
});

test('allocation metadata preserves checked-payment interest, payoff caps and unnamed debt labels in every mode',()=>{
 const plan={state:{startDate:'2026-10-23',takeHome:2000,cards:[{id:1,name:'Visa',balance:100,apr:26,min:50},{id:2,balance:30,apr:0,min:30}],budgetItems:[{label:'Rent',amount:600}],checkedPaychecks:{1:true}},schedule:[{paycheck:1,date:'2026-10-23',payments:[50,30],interestByAccount:[1,0]}]};
 const snapshot=structuredClone(plan);
 const minimum=paydayEvents(plan,start,'2026-11-27',{billsOnly:true,debtMode:'minimum'});
 assert.deepEqual(minimum.map(row=>row.allocations),[65000,60153]);
 assert.deepEqual(minimum.map(row=>row.allocationDetails.filter(item=>item.kind==='debt')),[ [{kind:'debt',label:'Visa',amount:5000}], [{kind:'debt',label:'Visa',amount:153}] ]);
 for(const mode of ['full','minimum','none'])for(const row of paydayEvents(plan,start,'2026-11-27',{billsOnly:true,debtMode:mode}))assert.equal(total(row.allocationDetails,'amount'),row.allocations);
 assert.deepEqual(plan,snapshot);
 plan.state.checkedPaychecks={};plan.schedule[0]={...plan.schedule[0],takeHomeThisCheck:2000,bonusAmount:0,budgetLineItemsThisCheck:[],extrasThisCheck:[]};
 const full=paydayEvents(plan,'2026-10-23','2026-10-23',{debtMode:'full'});
 assert.deepEqual(full[0].allocationDetails,[{kind:'debt',label:'Visa',amount:5000},{kind:'debt',label:'Debt payment 2',amount:3000}]);assert.equal(full[0].allocations,8000);
 assert.deepEqual(paydayEvents(plan,'2026-10-23','2026-10-23',{debtMode:'none'})[0].allocationDetails,[]);
});

test('negative episodes retain same-day lows and recoveries as well as later unresolved shortages',()=>{
 const input=fixture();
 input.forecast={opening:1000,end:'2026-11-27',rows:[
  {date:'2026-11-01',type:'bill',name:'Electric',delta:-1500},
  {date:'2026-11-01',type:'contribution',name:'Payday',delta:1000},
  {date:'2026-11-10',type:'bill',name:'Rent',delta:-2500},
  {date:'2026-11-20',type:'bill',name:'Water',delta:-100}
 ]};
 const r=buildForecastReport(input);
 assert.deepEqual(r.summary.firstNegative,{date:'2026-11-01',balance:-500,name:'Electric'});
 assert.deepEqual(r.shortfalls,[{start:'2026-11-01',end:'2026-11-01',low:-500,lowDate:'2026-11-01',firstBalance:-500,cause:'Electric'},{start:'2026-11-10',end:null,low:-2100,lowDate:'2026-11-20',firstBalance:-2000,cause:'Rent'}]);
 assert.equal(r.monthly[1].low,-2100);assert.equal(r.summary.lowDate,'2026-11-20');
});

test('reclamation uses its independent search and guarded bill horizons with a full replayed audit',()=>{
 const input=fixture(),copy=structuredClone(input),r=buildForecastReport(input),reclaim=r.reclamation;
 assert.equal(r.end,'2026-11-27');assert.equal(reclaim.status,'ready');assert.equal(reclaim.end,'2028-01-01');assert.equal(reclaim.checkedThrough,'2029-01-01');
 assert.ok(reclaim.baseline.ledger.some(row=>row.date==='2029-01-01'&&row.name==='Rent'));
 assert.ok(reclaim.schedule.every(row=>row.date<='2028-01-01'));
 assert.equal(reclaim.totals.total,total(reclaim.schedule,'amount'));assert.equal(reclaim.totals.total,reclaim.totals.totalMine+reclaim.totals.totalSpouse);
 assert.equal(reclaim.projected.summary.closing,reclaim.baseline.summary.closing+reclaim.funding.totalRequired-reclaim.totals.total);
 assert.equal(reclaim.projected.summary.low,reclaim.totals.lowestAfter);
 assertReconciles(reclaim.baseline);assertReconciles(reclaim.projected);assert.deepEqual(input,copy);
});

test('saved and newly proposed funding remain separate and source-unassigned proposals do not change the personal simulation',()=>{
 const input=fixture({opening:10000,billAmount:200000,additionalDeposits:[{id:'pending',date:'2026-11-01',amount:2500,source:'other',received:false}]});
 const r=buildForecastReport(input),c=r.reclamation;
 assert.equal(c.status,'ready');assert.ok(c.funding.totalRequired>0);assert.equal(c.funding.totalPending,2500);
 assert.equal(c.funding.totalExtra,c.funding.totalRequired+c.funding.totalPending);
 assert.equal(c.totals.net,c.totals.total-c.funding.totalExtra);
 assert.equal(c.funding.pending[0].source,'other');
 assert.ok(c.projected.ledger.some(row=>row.name==='Proposed extra deposit'&&row.detail.includes('source unassigned')));
 assert.ok(c.baseline.shortfalls.length>0);assert.ok(c.explanations.some(text=>text.includes('before any reclamation')));
 assert.equal(c.projected.summary.low,c.totals.lowestAfter);
 assert.equal(r.summary.closing,input.forecast.endBalance);
 assertReconciles(c.baseline);assertReconciles(c.projected);
});

test('today top-ups are explicit once rather than folded invisibly into the bank opening',()=>{
 const input=fixture({opening:-5000,billAmount:1000,additionalDeposits:[{id:'today',date:start,amount:3000,source:'personal',received:false}]});
 const c=buildForecastReport(input).reclamation;
 assert.equal(c.status,'ready');assert.equal(c.funding.totalPending,3000);assert.equal(c.funding.required[0].date,start);assert.equal(c.funding.required[0].amount,12000);
 assert.equal(c.projected.summary.opening,-5000);
 const today=c.projected.ledger.filter(row=>row.date===start);
 assert.equal(today.filter(row=>row.type==='extra-deposit').length,2);
 assert.equal(total(today,'incoming'),15000);assert.equal(today.at(-1).balance,10000);
 assert.equal(c.projected.summary.low,-5000);assert.equal(c.totals.conditionalNow,true);assert.ok(c.totals.lowestAfter>=0);
 assert.ok(c.explanations.some(text=>text.includes('actual negative bank balance')));
 assert.equal(c.projected.summary.closing,c.baseline.summary.closing+c.funding.totalRequired-c.totals.total);
 assertReconciles(c.projected);
});

test('funding that exceeds released contributions stays a negative net result',()=>{
 const c=buildForecastReport(fixture({opening:0,billAmount:500000})).reclamation;
 assert.equal(c.status,'ready');assert.ok(c.funding.totalExtra>c.totals.total);
 assert.equal(c.totals.net,c.totals.total-c.funding.totalExtra);assert.ok(c.totals.net<0);
 assert.ok(c.explanations.some(text=>text.includes('more added funding than it releases')));
 assertReconciles(c.projected);
});

test('stale, unknown and unconfigured balances produce explanations instead of safe reclamation claims',()=>{
 for(const override of [{balanceUpdated:'2026-10-25T15:00:00Z'},{balanceStale:true},{balanceUnavailable:true},{providerUnavailable:true},{balance:null}]){
  const input=fixture();Object.assign(input.context.account,override);
  const r=buildForecastReport(input);
  assert.equal(r.reclamation.status,'unavailable');assert.match(r.reclamation.reason,/usable bills-account balance/);assert.equal(r.reclamation.projected,null);assert.equal(r.reclamation.schedule.length,0);
 }
 const input=fixture();input.forecast={...input.forecast,opening:null};input.context=null;
 const r=buildForecastReport(input);
 assert.equal(r.summary.opening,null);assert.equal(r.summary.closing,null);assert.equal(r.summary.low,null);assert.equal(r.summary.firstNegative,null);assert.deepEqual(r.shortfalls,[]);assert.ok(r.ledger.every(row=>row.balance===null));
 assert.ok(r.narratives.some(text=>text.includes('cannot be confirmed')));assert.equal(r.reclamation.status,'unavailable');
});

test('missing schedules, invalid cushions and no assigned shared bills do not produce a reclamation plan',()=>{
 for(const change of [input=>{input.context.household.spouseStartDate='';},input=>{input.buffer=-1;},input=>{input.context.paymentsPlanner.manual=[];}]){
  const input=fixture();change(input);const r=buildForecastReport(input);
  assert.equal(r.reclamation.status,'unavailable');assert.ok(r.reclamation.reason);assert.equal(r.reclamation.schedule.length,0);
 }
});

test('weekly spouse deposits fund the guard forecast but do not become third-paycheck reclamations',()=>{
 const r=buildForecastReport(fixture({spouseRepeat:'weekly'})).reclamation;
 assert.equal(r.status,'ready');assert.ok(r.schedule.length>0);assert.ok(r.schedule.every(row=>row.person==='mine'));
 assert.equal(r.totals.totalSpouse,0);assert.ok(r.baseline.ledger.some(row=>row.type==='contribution'));
 assert.ok(r.explanations.some(text=>text.includes('weekly contributions')));
});

test('invalid ledger cents fail explicitly rather than silently inventing zero amounts',()=>{
 const input=fixture();input.forecast.rows=[{date:start,name:'Broken bill',type:'bill',delta:NaN}];
 assert.throws(()=>buildForecastReport(input),/invalid amount/);
 input.forecast.rows=[{date:start,name:'Broken paycheck',type:'income',delta:100,incoming:200,outgoing:0}];
 assert.throws(()=>buildForecastReport(input),/does not reconcile/);
});

test('invalid, out-of-period or unordered event dates cannot silently disappear from monthly totals',()=>{
 for(const date of ['2026-11-31','2026-10-27','2026-11-28']){
  const input=fixture();input.forecast.rows=[{date,name:'Bad date',type:'bill',delta:-100}];
  assert.throws(()=>buildForecastReport(input),/invalid date|outside the selected period/);
 }
 const input=fixture();input.forecast.rows=[{date:'2026-11-20',type:'bill',delta:-100},{date:'2026-11-01',type:'bill',delta:-100}];
 assert.throws(()=>buildForecastReport(input),/chronological order/);
});
