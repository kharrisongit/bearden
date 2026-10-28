import test from 'node:test';
import assert from 'node:assert/strict';
import {trackerDebtStatus,paycheckPaidCreditBills,trackerDebtBills,billEvents,cashForecast,accountPaymentRows,isDebtPayment} from '../public/income-model.mjs';
const plan=()=>({state:{cards:[{id:1,name:'Visa',balance:100},{id:2,name:'Second card',balance:500}],checkedPaychecks:{}},schedule:[
 {paycheck:1,date:'2026-10-23',payments:[40,20],interestByAccount:[1,0],balancesAfter:[61,480]},
 {paycheck:2,date:'2026-11-06',payments:[61,30],interestByAccount:[0,0],balancesAfter:[0,450]},
 {paycheck:3,date:'2026-11-20',payments:[0,450],interestByAccount:[0,0],balancesAfter:[0,0]}
]});
const bill={id:'credit-visa',date:'2026-11-10',amount:3500};
const cards=[{id:'credit-visa',statementDate:'2026-10-12'}];
const prefs={'credit-visa':{trackerCardId:'1'}};
test('account payoff counts only checked payments and reverses on undo/reset',()=>{
 const p=plan();assert.equal(trackerDebtStatus(p,1).balance,10000);
 p.state.checkedPaychecks={1:true};assert.equal(trackerDebtStatus(p,1).balance,6100);assert.equal(trackerDebtStatus(p,1).paidOff,false);
 p.state.checkedPaychecks[2]=true;assert.equal(trackerDebtStatus(p,1).paidOff,true);assert.equal(trackerDebtStatus(p,2).balance,45000);
 p.state.checkedPaychecks[1]=false;assert.equal(trackerDebtStatus(p,1).paidOff,false);assert.equal(trackerDebtStatus(p,1).balance,3900);
 p.state.checkedPaychecks={3:true};assert.equal(trackerDebtStatus(p,1).balance,10000);assert.equal(trackerDebtStatus(p,1).paidOff,false);
 p.state.checkedPaychecks={};assert.equal(trackerDebtStatus(p,1).balance,10000);
});
test('matched card minimum is paid from checked paycheck amounts; unrelated, unlinked and prior-cycle payments do not count',()=>{
 const p=plan();assert.deepEqual(paycheckPaidCreditBills(p,[bill],cards,prefs),[]);
 p.state.checkedPaychecks={1:true};assert.deepEqual(paycheckPaidCreditBills(p,[bill],cards,prefs),['credit-visa:2026-11-10']);
 assert.deepEqual(paycheckPaidCreditBills(p,[bill],cards,{}),[]);
 assert.deepEqual(paycheckPaidCreditBills(p,[{...bill,amount:5000}],cards,prefs),[]);
 p.state.checkedPaychecks={3:true};assert.deepEqual(paycheckPaidCreditBills(p,[bill],cards,prefs),[]);
 p.state.checkedPaychecks={1:true,2:true};assert.deepEqual(paycheckPaidCreditBills(p,[{...bill,date:'2026-12-10'}],[{...cards[0],statementDate:'2026-11-12'}],prefs),[]);
 p.state.checkedPaychecks={};assert.deepEqual(paycheckPaidCreditBills(p,[bill],cards,prefs),[]);
});
test('minimum combines split payments, honors full payoff below minimum, and accepts late payment',()=>{
 const p=plan();p.state.checkedPaychecks={1:true,2:true};
 assert.deepEqual(paycheckPaidCreditBills(p,[{...bill,amount:8000}],cards,prefs),['credit-visa:2026-11-10']);
 assert.deepEqual(paycheckPaidCreditBills(p,[{...bill,amount:20000}],cards,prefs),['credit-visa:2026-11-10']);
 assert.deepEqual(paycheckPaidCreditBills(p,[{...bill,date:'2026-11-01'}],cards,prefs),['credit-visa:2026-11-01']);
 assert.deepEqual(paycheckPaidCreditBills(p,[{...bill,date:'2026-12-10'}],[],prefs),[]);
});
test('completed tracker payments remain available for paid calendar entries without becoming unpaid events',()=>{
 const p=plan();p.state.checkedPaychecks={1:true};
 const all=trackerDebtBills(p,[],{},{includePaid:true}),paid=all.filter(b=>b.paidByPaycheck).map(b=>b.id+':'+b.date);
 assert.equal(paid.length,2);assert.equal(trackerDebtBills(p).some(b=>b.date==='2026-10-23'),false);
 const events=billEvents({bills:all},{paid},{},'2026-10-01','2026-11-30');assert.equal(events.some(b=>b.date==='2026-10-23'),false);
});
test('two fixed car payments stay separate in Bills and both enter forecast; paying one leaves the other due',()=>{
 const manual=[{id:'car-1',name:'Car lender',amount:30000,date:'2026-11-03',repeat:'monthly',source:'manual',billKind:'car-payment'},{id:'car-2',name:'Car lender',amount:42000,date:'2026-11-03',repeat:'monthly',source:'manual',billKind:'car-payment'}];
 assert.ok(manual.every(b=>!isDebtPayment(b)));
 const events=billEvents({}, {manual}, {},'2026-11-01','2026-11-30');assert.equal(accountPaymentRows(events).length,2);
 const cash=[{include:true,balance:100000,currency:'USD'}];assert.equal(cashForecast(cash,[],events,'2026-11-01').outgoing,72000);
 const unpaid=billEvents({}, {manual,paid:['car-1:2026-11-03']}, {},'2026-11-01','2026-11-30');assert.equal(unpaid.length,1);assert.equal(unpaid[0].id,'car-2');assert.equal(cashForecast(cash,[],unpaid,'2026-11-01').outgoing,42000);
 const covered=billEvents({}, {manual,covered:{'car-1':true}}, {},'2026-11-01','2026-11-30');assert.equal(cashForecast(cash,[],covered,'2026-11-01').outgoing,42000);
});

test('per-creditor forecasts use each payoff date and total interest, with no partial total for unfinished plans',async()=>{
 const {trackerDebtForecast}=await import('../public/income-model.mjs');const p=plan();
 assert.deepEqual(trackerDebtForecast(p,1),{date:'2026-11-06',interest:100});
 assert.deepEqual(trackerDebtForecast(p,2),{date:'2026-11-20',interest:0});
 p.schedule=p.schedule.slice(0,2);assert.equal(trackerDebtForecast(p,2).interest,null);assert.equal(trackerDebtForecast(p,2).date,null);
 assert.equal(trackerDebtForecast(p,'missing').reason,'Link a payoff plan');
 p.state.checkedPaychecks={1:true};assert.equal(trackerDebtForecast(p,1).interest,100);
 p.state.checkedPaychecks[2]=true;assert.equal(trackerDebtForecast(p,1).paidOff,true);
 p.syncedDebtBalances={1:{balance:5000,date:'2026-11-20'}};assert.equal(trackerDebtForecast(p,1).date,null);
});

test('completed-cycle interest is retained and a refreshed balance cannot reuse a checked payoff',async()=>{
 const {trackerDebtForecast}=await import('../public/income-model.mjs');const p=plan();
 p.state.checkedPaychecks={1:true,2:true};Object.assign(p.state.cards[0],{cycleStartPaycheck:2,activelyPaidOff:true,payoffHistory:[{interestPaid:1}]});
 assert.equal(trackerDebtForecast(p,1).interest,100);
 p.syncedDebtBalances={1:{balance:20000,date:'2026-11-06'}};p.schedule=p.schedule.slice(0,2);p.state.cards[0].cycleStartPaycheck=0;
 assert.equal(trackerDebtForecast(p,1).interest,null);assert.equal(trackerDebtForecast(p,1).date,null);
});
