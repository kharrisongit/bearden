import test from 'node:test';
import assert from 'node:assert/strict';
import {billsSavingsPlan,billsReclaimPlan,thirdPaycheckDates,coverBillShortfalls,reclaimHorizon,singleReclaimPlan} from '../public/bills-savings.mjs';
import {occurrences} from '../public/engine.mjs';

const start='2026-11-01',end='2027-11-01',checkedThrough='2027-12-06';
const options={end,buffer:10000,contribution:75000,personalStart:'2026-01-02',spouseStart:'2026-01-02'};
const ledger=(opening,rows=[])=>({opening,end:checkedThrough,rows});

test('third paychecks count the full first month and independent spouse dates',()=>{
 assert.deepEqual(thirdPaycheckDates('2026-01-02','2026-01-20','2026-02-28'),['2026-01-30']);
 assert.deepEqual(thirdPaycheckDates('2026-01-09','2026-01-20','2026-02-28'),[]);
 assert.deepEqual(thirdPaycheckDates('2026-01-02',start,end),['2027-01-29','2027-07-30']);
});

test('reclaiming two $750 contributions per person costs $3,000 total without mutating the ledger',()=>{
 const f=ledger(400000),copy=structuredClone(f),result=billsReclaimPlan(f,start,options);
 assert.equal(result.safe,true);assert.equal(result.total,300000);assert.equal(result.perPerson,150000);
 assert.deepEqual(result.schedule.map(r=>r.amount),[150000,150000]);assert.equal(result.lowAfterReclaim,100000);
 assert.equal(result.safePerPerson,150000);assert.deepEqual(f,copy);
});

test('a later bill prevents reclaiming the full amount even when it fits on both paydays',()=>{
 const result=billsReclaimPlan(ledger(400000,[{date:'2027-10-15',delta:-150000}]),start,options);
 assert.equal(result.safe,false);assert.deepEqual(result.firstShortfall,{date:'2027-10-15',balance:-50000});
 assert.equal(result.safePerContribution,60000);assert.equal(result.safePerPerson,120000);assert.equal(result.safeTotal,240000);
});

test('the extra billing cycle and cushion protect money beyond the visible year',()=>{
 const result=billsReclaimPlan(ledger(400000,[{date:'2027-11-15',delta:-95000}]),start,options);
 assert.equal(result.safe,false);assert.equal(result.firstShortfall,null);assert.equal(result.firstBelowBuffer.balance,5000);
 assert.equal(result.safePerContribution,73750);assert.equal(result.checkedThrough,checkedThrough);
});

test('same-day bills run before deposits and future income cannot hide a temporary shortfall',()=>{
 const result=billsReclaimPlan(ledger(10000,[{date:'2027-01-29',delta:500000},{date:'2027-01-29',delta:-20000}]),start,options);
 assert.equal(result.safe,false);assert.equal(result.baselineShortfall.balance,-10000);assert.equal(result.safeTotal,0);
});

test('offset spouse dates reclaim exactly twice for each person',()=>{
 const result=billsReclaimPlan(ledger(400000),start,{...options,spouseStart:'2026-01-09'});
 assert.equal(result.schedule.length,4);assert.equal(result.schedule.reduce((n,r)=>n+r.mine,0),150000);
 assert.equal(result.schedule.reduce((n,r)=>n+r.spouse,0),150000);assert.equal(result.total,300000);
});

test('the calculation uses full biweekly funding for a year plus the protection period',()=>{
 const rows=occurrences('2026-01-02','biweekly',start,checkedThrough).map(date=>({date,delta:150000}));
 rows.push(...occurrences('2026-01-10','monthly',start,checkedThrough).map(date=>({date,delta:-250000})));
 const result=billsReclaimPlan(ledger(400000,rows),start,options);
 assert.equal(result.safe,true);assert.equal(result.total,300000);assert.ok(result.lowAfterReclaim>=10000);
});

test('unknown balances, amounts, or missing future paydays do not claim money is safe',()=>{
 assert.equal(billsReclaimPlan(ledger(null),start,options).status,'unavailable');
 assert.equal(billsReclaimPlan(ledger(400000,[{date:start,delta:NaN}]),start,options).status,'unavailable');
 assert.equal(billsReclaimPlan(ledger(400000),start,{...options,spouseStart:'2027-10-29'}).status,'dates');
});

test('general savings suggestions are incremental and reserve later bills',()=>{
 const f=ledger(100000,[{date:'2026-11-06',delta:100000},{date:'2026-11-10',delta:-150000},{date:'2026-11-20',delta:100000}]);
 const r=billsSavingsPlan(f,start,{end:'2026-11-30',buffer:10000});
 assert.equal(r.now,40000);assert.equal(r.total,140000);assert.deepEqual(r.schedule.map(s=>s.amount),[40000,100000]);assert.equal(r.lowAfter,10000);
 assert.equal(billsSavingsPlan({...f,opening:null},start).status,'unavailable');
});

test('the horizon follows both second reclaims and protects a full calendar year afterward',()=>{
 const h=reclaimHorizon(start,'2026-01-02','2026-01-09');
 assert.deepEqual(h.own,['2027-01-29','2027-07-30']);assert.deepEqual(h.spouse,['2027-04-30','2027-10-29']);
 assert.equal(h.lastReclaim,'2027-10-29');assert.equal(h.end,'2028-10-29');
 assert.equal(reclaimHorizon(start,options.personalStart,''),null);
 const later=reclaimHorizon(start,options.personalStart,'2027-09-03');assert.ok(later.lastReclaim>'2027-11-01');assert.equal(later.end.slice(0,4),String(Number(later.lastReclaim.slice(0,4))+1));
});

test('a bill nearly a year after the last reclaim still blocks an unsafe withdrawal',()=>{
 const h=reclaimHorizon(start,options.personalStart,'2026-01-09');
 const result=billsReclaimPlan({opening:400000,end:h.end,rows:[{date:'2028-09-01',delta:-150000}]},start,{...options,end:h.lastReclaim,spouseStart:'2026-01-09'});
 assert.equal(result.safe,false);assert.equal(result.firstShortfall.date,'2028-09-01');assert.equal(result.firstShortfall.balance,-50000);
});

test('small gaps receive one-time deposits and later savings continue, with extra funding deducted from the gain',()=>{
 const f=ledger(10000,[{date:'2026-11-05',name:'Water',delta:-12500},{date:'2026-11-10',delta:30000}]),copy=structuredClone(f);
 const funded=coverBillShortfalls(f,start,{buffer:10000});
 assert.deepEqual(funded.deposits,[{date:'2026-11-04',amount:12500,shortfall:2500,neededBy:'2026-11-05',reason:'Water'}]);
 const savings=billsSavingsPlan(funded.forecast,start,{end:'2026-11-30',buffer:10000});
 assert.equal(savings.total,30000);assert.equal(savings.now,0);assert.equal(savings.lowAfter,10000);assert.equal(savings.total-funded.extraFunding,17500);
 assert.deepEqual(f,copy);
});

test('multiple gaps only request the additional funding needed, not the same deficit twice',()=>{
 const funded=coverBillShortfalls(ledger(10000,[{date:'2026-11-05',delta:-15000},{date:'2026-11-07',delta:-12000},{date:'2026-11-20',delta:50000}]),start,{buffer:10000});
 assert.deepEqual(funded.deposits.map(d=>[d.date,d.amount]),[['2026-11-04',15000],['2026-11-06',12000]]);
 assert.equal(funded.extraFunding,27000);assert.equal(billsSavingsPlan(funded.forecast,start,{end,buffer:10000}).total,50000);
});

test('saved deposits and today’s negative balance are handled without asking for the same top-up twice',()=>{
 const f=ledger(-5000,[{date:start,type:'extra-deposit',delta:15000},{date:'2026-11-10',delta:20000}]);
 const funded=coverBillShortfalls(f,start,{buffer:10000});assert.deepEqual(funded.deposits,[]);assert.equal(funded.extraFunding,15000);assert.equal(funded.conditionalNow,true);
 assert.equal(billsSavingsPlan(funded.forecast,start,{end,buffer:10000}).total,20000);
 const gap=coverBillShortfalls(ledger(-5000),start,{buffer:10000});assert.equal(gap.deposits[0].amount,15000);assert.equal(billsSavingsPlan(gap.forecast,start,{end,buffer:10000}).total,0);
});

test('repairing original bill gaps never adds more funding merely to finance reclaiming money',()=>{
 const funded=coverBillShortfalls(ledger(400000,[{date:'2027-10-15',delta:-150000}]),start,{buffer:10000});
 assert.deepEqual(funded.deposits,[]);assert.equal(billsReclaimPlan(funded.forecast,start,options).safe,false);
});

const singleOptions={date:start,searchEnd:end,buffer:10000,amount:75000};
const longLedger=(opening,rows=[])=>({opening,rows,end:'2028-11-01'});
test('one contribution can fit even when two per person do not, with identical baseline bills',()=>{
 const f=longLedger(100000),copy=structuredClone(f),r=singleReclaimPlan(f,start,singleOptions);
 assert.equal(r.safe,true);assert.equal(r.baseline.low,100000);assert.equal(r.requested.low,25000);assert.equal(r.earliest.date,start);
 assert.equal(r.additionalFunding,0);assert.equal(r.netReclaim,75000);assert.deepEqual(f,copy);
 assert.equal(billsReclaimPlan(f,start,options).safe,false);
});
test('a new shortfall shows the smaller safe amount, exact additional funding, and a later date',()=>{
 const f=longLedger(100000,[{date:'2026-11-05',delta:-40000,name:'Rent'},{date:'2026-11-10',delta:100000}]);
 const r=singleReclaimPlan(f,start,singleOptions);
 assert.equal(r.safe,false);assert.equal(r.baseline.low,60000);assert.equal(r.requested.low,-15000);assert.equal(r.impact.kind,'created');
 assert.equal(r.maxOnDate,50000);assert.equal(r.additionalFunding,25000);assert.equal(r.netReclaim,50000);
 assert.equal(r.additionalDeposits[0].date,'2026-11-04');assert.equal(r.earliest.date,'2026-11-10');
});
test('existing gaps remain separate from the extra funding caused by the reclaim',()=>{
 const f=longLedger(10000,[{date:'2026-11-05',delta:-20000},{date:'2026-11-10',delta:100000}]);
 const r=singleReclaimPlan(f,start,{...singleOptions,date:'2026-11-06'});
 assert.equal(r.baseline.firstShortfall.balance,-10000);assert.equal(r.impact.kind,'worsened');
 assert.equal(r.funding.extraFunding,20000);assert.equal(r.additionalFunding,75000);assert.equal(r.netReclaim,0);assert.equal(r.netAfterAllFunding,-20000);
 assert.equal(r.earliest.date,'2026-11-10');
 // Applying exactly the disclosed deposits makes the requested plan retain the cushion.
 const funded={...f,rows:[...f.rows,...r.funding.deposits,...r.additionalDeposits].map(row=>row.delta===undefined?{...row,type:'extra-deposit',delta:row.amount}:row)};
 const verified=singleReclaimPlan(funded,start,{...singleOptions,date:'2026-11-06'});assert.equal(verified.safe,true);assert.equal(verified.additionalFunding,0);
});
test('a cushion breach is distinct from a negative balance, including same-day bill ordering',()=>{
 const r=singleReclaimPlan(longLedger(80000),start,singleOptions);assert.equal(r.requested.firstShortfall,null);assert.equal(r.impact.kind,'cushion');assert.equal(r.additionalFunding,5000);assert.equal(r.maxOnDate,70000);
 const same=singleReclaimPlan(longLedger(10000,[{date:start,delta:100000},{date:start,delta:-20000}]),start,singleOptions);
 assert.equal(same.baseline.firstShortfall.balance,-10000);assert.equal(same.funding.extraFunding,20000);assert.equal(same.safe,true);
});
test('saved funding is not requested twice and the full year beyond a later reclaim is protected',()=>{
 const f=longLedger(60000,[{date:'2026-11-10',type:'extra-deposit',delta:50000},{date:'2028-10-01',delta:-50000}]);
 const r=singleReclaimPlan(f,start,singleOptions);assert.equal(r.earliest,null);assert.equal(r.funding.extraFunding,50000);assert.deepEqual(r.funding.deposits,[]);assert.equal(r.maxOnDate,50000);
 assert.equal(singleReclaimPlan({...f,end:'2027-12-01'},start,singleOptions).status,'unavailable');
 assert.equal(singleReclaimPlan({...f,opening:null},start,singleOptions).status,'unavailable');
 assert.equal(singleReclaimPlan(f,start,{...singleOptions,date:'2026-11-31'}).status,'unavailable');
});
test('single and annual reclaims use different saved contribution amounts for each person',()=>{
 const f=longLedger(500000);
 assert.equal(singleReclaimPlan(f,start,{...singleOptions,amount:72500}).requested.low,427500);
 const r=billsReclaimPlan(f,start,{...options,personalContribution:72500,spouseContribution:60000});
 assert.equal(r.total,265000);assert.equal(r.perPerson,145000);assert.equal(r.spouseTotal,120000);
 assert.equal(r.schedule.reduce((n,row)=>n+row.mine,0),145000);assert.equal(r.schedule.reduce((n,row)=>n+row.spouse,0),120000);
 const smaller=billsReclaimPlan(longLedger(150000),start,{...options,personalContribution:72500,spouseContribution:60000});
 assert.equal(smaller.safe,false);assert.ok(smaller.safeTotal<=140000);assert.ok(smaller.safeSpouseContribution<smaller.safePerContribution);
 assert.equal(billsReclaimPlan(f,start,{...options,personalContribution:0,spouseContribution:60000}).status,'unavailable');
 assert.equal(billsReclaimPlan(f,start,{...options,contribution:undefined}).status,'unavailable');
 assert.equal(singleReclaimPlan(f,start,{...singleOptions,amount:undefined}).status,'unavailable');
});
