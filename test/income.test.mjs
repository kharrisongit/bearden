import test from 'node:test';
import assert from 'node:assert/strict';
import {paydayEvents,billEvents,cashForecast} from '../public/income-model.mjs';
test('forecast uses edited paycheck allocations and keeps paydays after debt payoff',()=>{
 const plan={state:{startDate:'2026-10-23',takeHome:1800,budgetItems:[{id:1,amount:200}],paycheckOverrides:{2:1900},checkedPaychecks:{1:true}},schedule:[{paycheck:1,date:'2026-10-23',takeHomeThisCheck:2200,bonusAmount:100,budgetLineItemsThisCheck:[{amount:250}],extrasThisCheck:[{amount:30}],payments:[500],savingsByGoal:[{contribution:75}]}]};
 let p=paydayEvents(plan,'2026-10-23','2026-11-07');assert.equal(p.length,1);assert.equal(p[0].date,'2026-11-06');assert.equal(p[0].amount,190000);assert.equal(p[0].allocations,20000);
 plan.state.checkedPaychecks={};p=paydayEvents(plan,'2026-10-23','2026-11-07');assert.equal(p[0].amount,230000);assert.equal(p[0].allocations,85500);
});
test('calendar recurrence, paid occurrences and coverage avoid duplicate forecast deductions',()=>{
 const legacy={bills:[{id:'gmail',name:'Electric',date:'2026-10-25',repeat:'once',amount:7000,source:'gmail'}],paid:[]},planner={manual:[{id:'rent',name:'Rent',date:'2026-01-31',repeat:'monthly',amount:80000,source:'manual'}],covered:{rent:true},paid:[]};
 const events=billEvents(legacy,planner,{},'2026-10-23','2026-11-22');assert.equal(events.length,2);assert.equal(events[1].date,'2026-10-31');assert.equal(events[1].covered,true);
 let f=cashForecast([{balance:100000,include:true,currency:'USD'},{balance:99999,include:false,currency:'USD'}],[{date:'2026-10-23',type:'income',amount:200000,allocations:150000}],events,'2026-10-23');assert.equal(f.endBalance,143000);assert.equal(f.outgoing,157000);
 planner.paid=['gmail:2026-10-25'];assert.equal(billEvents(legacy,planner,{},'2026-10-23','2026-11-22').length,1);
 planner.paid=[];assert.equal(billEvents(legacy,planner,{gmail:1},'2026-10-23','2026-11-22')[0].covered,true);
 assert.equal(cashForecast([],[],events,'2026-10-23').endBalance,null);
});
test('overdue unpaid one-time bills count once and non-USD balances do not enter the forecast',()=>{
 const bills=billEvents({bills:[{id:'b',name:'Overdue',date:'2026-09-01',repeat:'once',amount:5000,source:'gmail'}]},{},{},'2026-10-23','2026-11-22');assert.equal(bills.length,1);assert.equal(bills[0].overdue,true);
 const f=cashForecast([{balance:4000,include:true,currency:'USD'},{balance:999999,include:true,currency:'EUR'}],[],bills,'2026-10-23');assert.equal(f.low,-1000);assert.equal(f.rows[0].date,'2026-10-23');
});
