import test from 'node:test';
import assert from 'node:assert/strict';
import {emailAccountStatus,emailLink,emailBillPaymentStatuses} from '../public/email-model.mjs';
import {paymentIdentity,rememberPaymentBalances} from '../public/payment-confirmation.mjs';
import {parseAccountEmail} from '../email-parser.mjs';
import {billEvents,cashForecast} from '../public/income-model.mjs';
const now=Date.parse('2026-11-02T18:00Z');
const receipt=parseAccountEmail({id:'mail:receipt',mailboxId:'mail',from:'payments@example.com',subject:'Payment Receipt - Reference # EXAMPLE1',text:'Your payment is pending. Payment amount: $800.00',receivedAt:'2026-10-31T14:00:00Z'});
const snapshot=(changes={})=>({id:'rent',balance:80000,currency:'USD',updated:'2026-10-31T13:00:00Z',...changes});
const bank={id:'bank',date:'2026-11-02',amount:80000,balanceSnapshot:snapshot({id:'checking',balance:120000,updated:'2026-11-02T16:00:00Z'})};
const state=(options={},messages=[receipt])=>emailAccountStatus(messages,emailLink(receipt),{now,creditCard:false,...options});

test('cached pending receipt pays the next month immediately before any bank or portal update',()=>{
 const cached={...receipt,paymentStage:undefined},links={'bill:rent':emailLink(cached)},event={id:'rent',key:'rent:2026-11-01',date:'2026-11-01',amount:80000,repeat:'monthly'};
 assert.equal(receipt.paymentStatus,'pending');
 const p=emailBillPaymentStatuses([event],[cached],links,{now})[0];
 assert.equal(p.paid,true);assert.equal(p.confirmed,false);assert.equal(p.cashReflectedAmount,0);
});
test('bank posting and both refreshed balances are required for final rent confirmation',()=>{
 for(const bankPayments of [[],[{...bank,pending:true}]])assert.equal(state({bankPayments,destinations:[snapshot()]}).payments[0].confirmed,false);
 const posted=state({bankPayments:[bank],destinations:[snapshot({updated:'2026-11-02T17:00:00Z'})]}).payments[0];
 assert.equal(posted.bankPosted,true);assert.equal(posted.cashReflected,true);assert.equal(posted.confirmed,false);assert.equal(posted.awaiting,'account balance');
 const zero=snapshot({balance:0,updated:'2026-11-02T17:00:00Z'});
 assert.equal(state({bankPayments:[{...bank,balanceSnapshot:snapshot()}],destinations:[zero]}).payments[0].confirmed,false);
 assert.equal(state({bankPayments:[bank],destinations:[{...zero,unavailable:true}]}).payments[0].confirmed,false);
 assert.equal(state({bankPayments:[bank],destinations:[zero]}).payments[0].confirmed,true);
});
test('loans confirm a payment from a balance reduction without marking the entire debt paid off',()=>{
 const before=snapshot({id:'loan',balance:200000,updated:'2026-10-31T16:00:00Z',pendingPaymentIds:[paymentIdentity(receipt)]});
 const balanceHistory=rememberPaymentBalances({},[before]);
 const destination=snapshot({id:'loan',balance:120000,updated:'2026-11-02T17:00:00Z'});
 assert.equal(state({bankPayments:[bank],destinations:[destination],balanceHistory}).payments[0].confirmed,true);
 assert.equal(state({bankPayments:[bank],destinations:[{...destination,balance:199999}],balanceHistory}).payments[0].confirmed,false);
 assert.equal(state({bankPayments:[bank],destinations:[{...destination,id:'other'}],balanceHistory}).payments[0].confirmed,false);
});
test('issuer payment plus fresh balance can confirm when purchases offset the balance decrease',()=>{
 const issuer=snapshot({id:'card',balance:250000,updated:'2026-11-02T17:00:00Z',payments:[{id:'issuer',amount:80000,date:'2026-11-02'}]});
 assert.equal(state({bankPayments:[bank],destinations:[issuer]}).payments[0].confirmed,true);
 assert.equal(state({destinations:[issuer]}).payments[0].confirmed,false);
});
test('confirmed evidence survives later charges, but failures and removed bank records invalidate it',()=>{
 const confirmations={[paymentIdentity(receipt)]:{bankPaymentId:bank.id}},options={bankPayments:[bank],destinations:[snapshot()],confirmations};
 assert.equal(state(options).payments[0].confirmed,true);
 assert.equal(state({...options,bankPayments:[]}).payments[0].confirmed,false);
 const failure={...receipt,id:'failed',paymentStatus:'failed',paymentStage:'failed',receivedAt:'2026-11-02T17:00:00Z'};
 const failed=state(options,[receipt,failure]).payments[0];assert.equal(failed.paymentMade,false);assert.equal(failed.confirmed,false);
});
test('past processing receipts reconcile once to the matching posted bank payments',()=>{
 const past=[['a','2026-09-30T14:00:00Z',80000],['b','2026-08-31T14:00:00Z',79000]].map(([id,receivedAt,paymentAmount])=>({...receipt,id,reference:id,receivedAt,paymentAmount}));
 const oldBank=[{...bank,id:'a',date:'2026-10-05'},{...bank,id:'b',date:'2026-09-02',amount:79000}];
 const result=state({bankPayments:oldBank},past);assert.equal(result.pending,80000); // selected current receipt remains awaiting posting
 assert.equal(result.payments.filter(p=>p.bankPosted).length,2);
});
test('forecast reserves the payment until cash is reflected and releases only reflected split payments',()=>{
 const bill={id:'rent',name:'Rent',date:'2026-11-01',amount:80000,repeat:'monthly',source:'manual'},base={manual:[bill],paid:[]};
 const total=reservation=>cashForecast([{balance:200000,include:true,currency:'USD'}],[],billEvents({}, {...base,paymentReservations:{'rent:2026-11-01':reservation}}, {},'2026-10-31','2026-11-02'),'2026-10-31').outgoing;
 assert.equal(total(80000),80000);assert.equal(total(30000),30000);assert.equal(total(0),0);
});
