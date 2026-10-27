import test from 'node:test';
import assert from 'node:assert/strict';
import {billsSavingsPlan,billsReclaimPlan,thirdPaycheckDates} from '../public/bills-savings.mjs';
import {occurrences} from '../public/engine.mjs';

const start='2026-11-01',end='2027-11-01',checkedThrough='2027-12-06';
const options={end,buffer:10000,personalStart:'2026-01-02',spouseStart:'2026-01-02'};
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
