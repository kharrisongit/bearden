import test from 'node:test';import assert from 'node:assert/strict';
import {nextRentDate,rentSchedule,linkSunRent,sunRentBill,rememberRentReadings,rentReadings} from '../public/rent-model.mjs';
import {billEvents,cashForecast,paycheckBillItems} from '../public/income-model.mjs';
const bill={id:'my-rent',name:'Home rent',billKind:'rent',date:'2026-10-05',repeat:'monthly',amount:100000,source:'manual'};
const connection=()=>({connected:true,snapshot:{currentBalance:123456,amountDue:120000,currency:'USD',dueDate:'2026-10-26',checkedAt:Date.parse('2026-10-26T12:00:00Z')}});
test('rent defaults to the first, including month/year boundaries and local midnight',()=>{
 assert.equal(nextRentDate('2026-10-26T12:00:00Z'),'2026-11-01');assert.equal(nextRentDate('2026-11-01T12:00:00Z'),'2026-11-01');assert.equal(nextRentDate('2026-12-31T12:00:00Z'),'2027-01-01');assert.equal(nextRentDate('2026-11-02T02:00:00Z'),'2026-11-01');
 assert.equal(rentSchedule(bill).date,'2026-10-01');assert.equal(rentSchedule({...bill,billKind:'electric'}).date,'2026-10-05');
});
test('link updates the existing rent ID in calendar, forecast and paycheck without rewriting earlier amounts',()=>{
 const sun=connection(),planner={manual:[bill],paid:[],covered:{}};linkSunRent(planner,bill.id,'currentBalance',sun,bill);
 const updated=sunRentBill(bill,planner.sunRent,sun);planner.manual=[updated];
 const rows=billEvents({},planner,{},'2026-10-01','2026-12-31');assert.deepEqual(rows.map(b=>[b.id,b.date,b.amount,b.rentConfirmed]),[['my-rent','2026-10-01',100000,false],['my-rent','2026-11-01',123456,true],['my-rent','2026-12-01',123456,false]]);
 assert.equal(cashForecast([{include:true,currency:'USD',balance:300000}],[],[rows[1]],'2026-10-26').endBalance,176544);
 assert.equal(paycheckBillItems({legacy:{},planner,linked:{}},'2026-10-23',2)[0].amount,123456);
});
test('paid occurrences still match their billing month after correcting a due day',()=>{
 const sun=connection(),planner={manual:[bill],paid:['my-rent:2026-11-05']};linkSunRent(planner,bill.id,'currentBalance',sun,bill);planner.manual=[sunRentBill(bill,planner.sunRent,sun)];
 const rows=billEvents({},planner,{},'2026-11-01','2026-12-31');assert.deepEqual(rows.map(r=>r.date),['2026-12-01']);
});
test('zero balances preserve the last positive rent estimate and do not mark bills paid',()=>{
 const sun=connection(),planner={manual:[bill],paid:[]};rememberRentReadings(sun);linkSunRent(planner,bill.id,'currentBalance',sun,bill);
 sun.snapshot={...sun.snapshot,currentBalance:0,amountDue:0,checkedAt:Date.parse('2026-11-02T12:00:00Z')};rememberRentReadings(sun);
 const updated=sunRentBill(bill,planner.sunRent,sun);assert.equal(updated.amount,123456);assert.deepEqual(planner.paid,[]);
 assert.equal(billEvents({},{...planner,manual:[updated]},{},'2026-12-01','2026-12-01')[0].amount,123456);
});
test('daily sync changes the selected bill only and keeps prior cycle readings',()=>{
 const sun=connection(),planner={};rememberRentReadings(sun);linkSunRent(planner,bill.id,'currentBalance',sun,bill);
 sun.snapshot={...sun.snapshot,currentBalance:135000,checkedAt:Date.parse('2026-11-26T12:00:00Z')};rememberRentReadings(sun);
 const updated=sunRentBill(bill,planner.sunRent,sun),other=sunRentBill({...bill,id:'another-rent'},planner.sunRent,sun);
 assert.equal(other.amount,100000);assert.deepEqual(billEvents({},{manual:[updated]},{},'2026-11-01','2026-12-31').map(b=>b.amount),[123456,135000]);
});
test('minimum payment can be selected explicitly and malformed/foreign/zero readings are ignored',()=>{
 const sun=connection(),planner={};linkSunRent(planner,bill.id,'amountDue',sun,bill);assert.equal(sunRentBill(bill,planner.sunRent,sun).amount,120000);
 assert.throws(()=>linkSunRent(planner,bill.id,'password',sun,bill));assert.deepEqual(rentReadings({...sun,snapshot:{...sun.snapshot,currency:'CAD'}}),[]);
 assert.deepEqual(rentReadings({...sun,snapshot:{...sun.snapshot,currentBalance:null}}),[]);
});
