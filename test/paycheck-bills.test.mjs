import test from 'node:test';
import assert from 'node:assert/strict';
import {paycheckBillItems,billEvents,paydayEvents,cashForecast} from '../public/income-model.mjs';
const bill=(id,date,amount=10000,extra={})=>({id,name:id,date,amount,source:'manual',repeat:'monthly',...extra});
const inputs=manual=>({legacy:{bills:[]},planner:{manual,paid:[]},linked:{},today:'2026-10-25'});
test('bill occurrences belong to the paycheck before their due date, including both car payments and a payday boundary',()=>{
 const data=inputs([bill('electric','2026-10-30',18742),bill('car-1','2026-11-07',30000,{billKind:'car-payment'}),bill('car-2','2026-11-19',42000,{billKind:'car-payment'}),bill('rent','2026-11-20',80000)]);
 const first=paycheckBillItems(data,'2026-11-06',1),second=paycheckBillItems(data,'2026-11-20',2);
 assert.deepEqual(first.map(b=>b.id),['electric','car-1','car-2']);assert.equal(first.reduce((s,b)=>s+b.amount,0),90742);
 assert.deepEqual(second.map(b=>b.id),['rent','electric']);assert.equal(new Set([...first,...second].map(b=>b.key)).size,5);
});
test('weekly bills and clamped month-end dates recur once in the correct paycheck window',()=>{
 const data=inputs([bill('weekly','2026-11-06',1000,{repeat:'weekly'}),bill('month-end','2026-01-31',2000)]);
 assert.deepEqual(paycheckBillItems(data,'2026-11-06',1).filter(b=>b.id==='weekly').map(b=>b.date),['2026-11-06','2026-11-13']);
 assert.deepEqual(paycheckBillItems(data,'2027-02-26',9).filter(b=>b.id==='month-end').map(b=>b.date),['2027-02-28']);
});
test('covered bills, card-funded bills and matched tracker debts do not consume a second allocation',()=>{
 const data=inputs([bill('normal','2026-11-07'),bill('covered','2026-11-07'),bill('linked','2026-11-07'),bill('card-funded','2026-11-07',10000,{paidByCard:true}),bill('tracker','2026-11-07',10000,{source:'tracker-debt'}),bill('issuer','2026-11-07',10000,{source:'plaid-credit',covered:true})]);data.planner.covered={covered:true};data.linked={linked:1};
 assert.deepEqual(paycheckBillItems(data,'2026-11-06',1).map(b=>b.id),['normal']);
});
test('paid bills remain reserved in their original paycheck, while forecasts do not charge them again',()=>{
 const data=inputs([bill('electric','2026-11-07',20000)]);data.planner.paid=['electric:2026-11-07'];
 assert.equal(paycheckBillItems(data,'2026-11-06',1)[0].amount,20000);
 assert.equal(billEvents(data.legacy,data.planner,{},'2026-11-06','2026-11-19').length,0);
});
test('a bill reserved by the paycheck is deducted only on its due date in the cash forecast',()=>{
 const data=inputs([bill('electric','2026-11-07',20000)]),items=paycheckBillItems(data,'2026-11-06',1);
 const plan={state:{startDate:'2026-11-06',takeHome:1000},schedule:[{paycheck:1,date:'2026-11-06',takeHomeThisCheck:1000,bonusAmount:0,budgetLineItemsThisCheck:[{amount:100}],extrasThisCheck:[],accountBillsThisCheck:items,payments:[700]}]};
 const paydays=paydayEvents(plan,'2026-11-06','2026-11-19'),bills=billEvents(data.legacy,data.planner,{},'2026-11-06','2026-11-19');
 const f=cashForecast([{include:true,balance:50000,currency:'USD'}],paydays,bills,'2026-11-06',13);
 assert.equal(paydays[0].allocations,80000);assert.equal(f.outgoing,100000);assert.equal(f.endBalance,50000);assert.equal(f.rows.filter(r=>r.type==='bill').length,1);
});

test('the initial bill reservation does not disappear as today advances past its due date',()=>{
 const data=inputs([bill('electric','2026-10-30',18742)]);
 assert.equal(paycheckBillItems(data,'2026-11-06',1)[0].amount,18742);
 data.today='2026-11-02';assert.equal(paycheckBillItems(data,'2026-11-06',1)[0].amount,18742);
 data.planner.paid=['electric:2026-10-30'];assert.equal(paycheckBillItems(data,'2026-11-06',1).length,0);
});
