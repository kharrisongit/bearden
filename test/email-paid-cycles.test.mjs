import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAccountEmail} from '../email-parser.mjs';
import {emailLink,emailBillPaymentStatuses,matchedEmailBillPayments,emailDebtPaymentStatus} from '../public/email-model.mjs';
import {billEvents,billTrackerSummary} from '../public/income-model.mjs';
const now=Date.parse('2026-10-31T18:00:00Z');
const receipt=(changes={})=>parseAccountEmail({id:'m:paid',mailboxId:'m',from:'receipts@example.com',subject:'Payment received',text:'Payment amount: $100.00 Payment date: October 31, 2026. Confirmation number ABC123',receivedAt:'2026-10-31T12:00:00Z',...changes});
const event=(changes={})=>({id:'bill',key:'bill:2026-11-01',date:'2026-11-01',amount:10000,repeat:'monthly',source:'manual',billKind:'rent',...changes});
const statuses=(events,messages,links={'bill:bill':emailLink(messages[0])})=>emailBillPaymentStatuses(events,messages,links,{now});

test('completed receipts pay every bill category across the month boundary, without paying another month',()=>{
 for(const billKind of ['rent','electric','phone-internet','insurance','car-payment','loan','credit-card','other']){
  const m=receipt(),b=event({billKind}),rows=statuses([b,event({key:'bill:2026-10-01',date:'2026-10-01'}),event({key:'bill:2026-12-01',date:'2026-12-01'})],[m]);
  assert.deepEqual(rows.map(r=>[r.key,r.paid,r.paidDate]),[['bill:2026-11-01',true,'2026-10-31']]);
 }
});
test('split payments add up; duplicates and scheduled or returned payments cannot fill the gap',()=>{
 const first=receipt({text:'Payment amount: $60.00 Confirmation number FIRST1'}),second=receipt({id:'m:second',text:'Payment amount: $40.00 Confirmation number SECOND2'});
 assert.equal(statuses([event()],[first])[0].remaining,4000);
 assert.equal(statuses([event()],[first,second])[0].paid,true);
 assert.equal(statuses([event()],[first,{...first,id:'duplicate'}])[0].paid,false);
 const failed={...second,id:'returned',paymentStatus:'failed',receivedAt:'2026-10-31T15:00:00Z'};
 assert.equal(statuses([event()],[first,second,failed])[0].paid,false);
 assert.deepEqual(statuses([event()],[receipt({subject:'Payment scheduled'})]),[]);
 assert.equal(statuses([event()],[receipt({subject:'Payment failed'})])[0].paid,false);
});
test('explicit due dates, dates near midnight, and future payments stay in the correct cycle',()=>{
 const m=receipt({text:'Payment amount: $100.00 Due date: November 1, 2026.',receivedAt:'2026-10-31T02:00:00Z'});
 assert.equal(statuses([event()],[m])[0].paidDate,'2026-10-30');
 assert.deepEqual(statuses([event()],[{...m,dueDate:'2026-12-01'}]),[]);
 assert.deepEqual(statuses([event()],[{...m,paymentDate:'2026-11-02'}]),[]);
 assert.deepEqual(statuses([event()],[{...m,receivedAt:'2026-11-02T12:00Z'}]),[]);
});
test('selected receipt survives cache rotation and remains scoped to mailbox and account',()=>{
 const m=receipt(),link=emailLink(m),links={'bill:bill':link};
 assert.equal(matchedEmailBillPayments([event()],[],links,{now})[0].paid,true);
 assert.deepEqual(statuses([event()],[{...m,mailboxId:'other'}],{'bill:bill':{...link,selectedMessage:null}}),[]);
 assert.deepEqual(statuses([event()],[m],{'bill:bill':{...link,accountLast4:'9999',selectedMessage:null}}),[]);
 assert.deepEqual(statuses([event(),event({id:'other',key:'other:2026-11-01'})],[m],{...links,'bill:other':link}),[]);
});
test('credit cards and loans use the monthly payment rather than the entire debt or simulated extra payments',()=>{
 const m=receipt({text:'Payment amount: $100.00 Payment date: October 15, 2026. Confirmation number ABC123'});
 for(const target of ['debt:1','credit:connected']){
  const links={[target]:emailLink(m)},details={amount:10000,dueDate:'2026-11-04',now};
  assert.equal(emailDebtPaymentStatus([m],links,target,details).paid,true);
  assert.equal(emailDebtPaymentStatus([m],links,target,{...details,amount:15000}).remaining,5000);
  assert.equal(emailDebtPaymentStatus([m],links,target,{...details,dueDate:'2026-12-04'}),null);
  assert.equal(emailDebtPaymentStatus([m],links,target,{...details,dueDate:null}),null);
 }
});
test('email receipts keep unpaid totals until confirmation without deleting the cash reservation',()=>{
 const bill={...event(),name:'Rent'},planner={manual:[bill],paid:[]},m=receipt(),events=billEvents({},planner,{},'2026-10-01','2026-12-31');
 const paid=matchedEmailBillPayments(events,[m],{'bill:bill':emailLink(m)},{now});
 const display={...planner,paid:paid.filter(p=>p.confirmed).map(p=>p.key),awaitingConfirmation:paid.filter(p=>!p.confirmed).map(p=>p.key)};
 const awaiting=billTrackerSummary({},display,{},'2026-10-31',{month:'2026-11-01'});
 assert.equal(awaiting.paidCount,0);assert.equal(awaiting.remaining,10000);assert.equal(awaiting.bills[0].awaitingConfirmation,true);
 assert.equal(billTrackerSummary({}, {...planner,paid:paid.map(p=>p.key)}, {},'2026-10-31',{month:'2026-11-01'}).paidCount,1);
 assert.equal(billTrackerSummary({},display,{},'2026-10-31',{month:'2026-12-01'}).paidCount,0);
 assert.equal(billEvents({},planner,{},'2026-10-31','2026-11-02').length,1);
 assert.deepEqual(planner.paid,[]);
});


test('receipt wording recognizes received payments and reads generic confirmations conservatively',()=>{
 assert.equal(receipt({subject:"We received your payment"}).paymentStatus,'posted');
 assert.equal(receipt({subject:'Payment confirmation',text:'Your payment has been successfully processed. Payment amount: $100.00'}).paymentStatus,'posted');
 assert.equal(receipt({subject:'Payment receipt',text:'We received your payment of $100.00.'}).paymentStatus,'posted');
 for(const text of ['Your payment is scheduled. It will be processed tomorrow.','Once your payment is processed, a receipt will arrive.','Your payment has not been received.'])assert.equal(receipt({subject:'Payment confirmation',text}).paymentStatus,'pending');
});
