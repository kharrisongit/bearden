import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarEvents,paydayEvents} from '../public/income-model.mjs';

const plan=()=>({state:{startDate:'2026-10-23',takeHome:1500,checkedPaychecks:{1:true},cards:[{id:'visa',name:'Visa',balance:100},{id:'loan',name:'Loan',balance:500}]},schedule:[
 {paycheck:1,date:'2026-10-23',payments:[40,20],balancesAfter:[60,480],takeHomeThisCheck:1500,bonusAmount:0},
 {paycheck:2,date:'2026-11-06',payments:[60,30],balancesAfter:[0,450],takeHomeThisCheck:1500,bonusAmount:0},
 {paycheck:3,date:'2026-11-20',payments:[0,450],balancesAfter:[0,0],takeHomeThisCheck:1500,bonusAmount:0}
]});
const household={enabled:true,personalAccountId:'checking',billsAccountId:'bills',spouseStartDate:'2026-10-23',spouseRepeat:'biweekly',spouseAmount:0};

test('calendar separates all four categories and keeps received paydays without changing the forecast',()=>{
 const p=plan(),payments=[{date:'2026-10-23',billKind:'rent',isPaid:true},{date:'2026-10-23',billKind:'car-payment'},{date:'2026-10-23',source:'plaid-credit'},{date:'2026-10-01',billKind:'rent'}];
 const [date]=calendarEvents(p,household,payments,'2026-10-23','2026-10-23');
 assert.equal(date.billPayments.length,2);assert.equal(date.debtPayments.length,1);
 assert.equal(date.myPayday,true);assert.equal(date.spousePayday,true);
 assert.deepEqual(paydayEvents(p,'2026-10-23','2026-10-23'),[]);
});
test('payoff appears only on each positive-to-zero transition, including when the previous row is outside the month',()=>{
 const events=calendarEvents(plan(),household,[],'2026-11-01','2026-11-30');
 assert.deepEqual(events.filter(d=>d.payoffs.length).map(d=>[d.date,d.payoffs.map(p=>p.name)]),[['2026-11-06',['Visa']],['2026-11-20',['Loan']]]);
 assert.equal(events[0].payoffs[0].completed,false);
 const p=plan();p.state.cards[0].balance=0;p.schedule.forEach(r=>{r.payments[0]=0;r.balancesAfter[0]=0;});
 assert.equal(calendarEvents(p,{},[],'2026-10-01','2026-11-30').some(d=>d.payoffs.some(p=>p.id==='visa')),false);
});
test('payoff completion follows checked payments and reverses when a payment is unchecked',()=>{
 const p=plan();p.state.checkedPaychecks[2]=true;
 const payoff=()=>calendarEvents(p,{},[],'2026-11-06','2026-11-06')[0].payoffs[0];
 assert.equal(payoff().completed,true);
 p.state.checkedPaychecks[1]=false;assert.equal(payoff().completed,false);
 p.state.checkedPaychecks={};assert.equal(payoff().completed,false);
});

test('bills-only calendars retain paid bills, car payments and paydays while excluding every debt source and payoff',()=>{
 const p=plan(),payments=[
  {id:'rent',date:'2026-11-01',amount:80000,billKind:'rent',source:'manual'},
  {id:'car',date:'2026-11-06',amount:29500,billKind:'car-payment',source:'manual',isPaid:true},
  {id:'electric',date:'2026-11-06',amount:10000,billKind:'electric',source:'manual',isPaid:true},
  {id:'tracker',date:'2026-11-06',amount:6000,source:'tracker-debt'},
  {id:'connected',date:'2026-11-06',amount:5000,source:'plaid-credit',isPaid:true},
  {id:'manual-loan',date:'2026-11-10',amount:2500,billKind:'loan',source:'manual'},
  {id:'manual-credit',date:'2026-11-12',amount:3000,billKind:'credit-card',source:'manual',isPaid:true},
  {id:'outside',date:'2026-12-01',amount:80000,billKind:'rent',source:'manual'},
 ];
 const before=structuredClone({p,household,payments}),start='2026-11-01',end='2026-11-30';
 const onlyBills=calendarEvents(p,household,payments,start,end,{includeDebt:false});
 assert.deepEqual(onlyBills.map(event=>event.date),['2026-11-01','2026-11-06','2026-11-20']);
 assert.deepEqual(onlyBills.flatMap(event=>event.billPayments),payments.slice(0,3));
 assert.equal(onlyBills.flatMap(event=>event.debtPayments).length,0);
 assert.equal(onlyBills.flatMap(event=>event.payoffs).length,0);
 assert.equal(onlyBills[1].myPayday,true);assert.equal(onlyBills[1].spousePayday,true);
 assert.equal(onlyBills[2].myPayday,true);assert.equal(onlyBills[2].spousePayday,true);
 const combined=calendarEvents(p,household,payments,start,end,{includeDebt:true});
 assert.deepEqual(combined,calendarEvents(p,household,payments,start,end));
 assert.deepEqual(combined.flatMap(event=>event.debtPayments),payments.slice(3,7));
 assert.deepEqual(combined.flatMap(event=>event.payoffs).map(payoff=>payoff.name),['Visa','Loan']);
 assert.deepEqual({p,household,payments},before);
});

test('bills-only calendars do not create an empty day for a debt payoff without a payday',()=>{
 const p=plan();delete p.state.startDate;
 assert.deepEqual(calendarEvents(p,{},[],'2026-11-01','2026-11-30',{includeDebt:false}),[]);
 assert.deepEqual(calendarEvents(p,{},[],'2026-11-01','2026-11-30').map(event=>event.date),['2026-11-06','2026-11-20']);
});
