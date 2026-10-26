import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCreditCards} from '../public/credit-model.mjs';
import {resolveDebtConnections} from '../public/connection-model.mjs';
import {effectiveDebtTerms,scheduledPayment} from '../public/debt-payments.mjs';
import {paydayEvents} from '../public/income-model.mjs';

const card={id:1,name:'Credit One',balance:142.03,apr:29,min:16.15,monthlyMinimum:35,dueDate:'2026-11-23'};
const terms={date:'2026-10-26',monthlyMinimum:0,currentCycleMinimum:true,currentCycleThrough:'2026-11-23',dueDate:'2026-11-23',forecastMonthlyMinimum:35};
test('a paid statement stays zero through its due date and resumes an estimated minimum next cycle',()=>{
  assert.equal(effectiveDebtTerms(card,terms,'2026-11-20').monthlyMinimum,0);
  const future=effectiveDebtTerms(card,terms,'2026-12-04');
  assert.equal(future.monthlyMinimum,35);assert.equal(future.estimatedMinimum,true);
  assert.equal(scheduledPayment(future,'2026-12-18','2026-11-06',{mode:'due-date',leadDays:3}).minimum,35);
  assert.equal(effectiveDebtTerms(card,terms,'2026-11-06',true),card);
  assert.equal(effectiveDebtTerms(card,{...terms,monthlyMinimum:40},'2026-12-04').monthlyMinimum,40);
});
test('unknown future amounts remain unknown and an intentional manual zero is not replaced',()=>{
  const zero={...card,min:0,monthlyMinimum:0};
  const future=effectiveDebtTerms(zero,{...terms,forecastMonthlyMinimum:null},'2026-12-04');
  assert.equal(future.missingFutureMinimum,true);assert.equal(future.monthlyMinimum,0);
  assert.equal(effectiveDebtTerms(card,{...terms,currentCycleMinimum:false},'2026-12-04').monthlyMinimum,0);
});
test('Plaid retains the last positive minimum across zero, repeat refresh, and missing liabilities',()=>{
  const response=minimum=>({accounts:[{account_id:'a',name:'Credit One',type:'credit',balances:{current:142.03,iso_currency_code:'USD'}}],liabilities:{credit:minimum===null?[]:[{account_id:'a',minimum_payment_amount:minimum}]}});
  let cards=normalizeCreditCards(response(35),{id:'bank'},[],'2026-10-20T12:00Z');
  for(const [minimum,date]of [[0,'2026-10-26T12:00Z'],[0,'2026-10-27T12:00Z'],[null,'2026-10-28T12:00Z']]){
    cards=normalizeCreditCards(response(minimum),{id:'bank'},cards,date);
    assert.equal(cards[0].minimum,minimum===null?null:0);assert.equal(cards[0].lastPositiveMinimum.amount,3500);
    assert.equal(cards[0].lastPositiveMinimum.updated,'2026-10-20T12:00Z');
  }
});
test('a mapped card keeps zero current due separately from saved future estimates and fallback dates',()=>{
  const issuer={id:'credit-a',accountId:'a',itemId:'bank',currency:'USD',balance:14203,minimum:0,dueDate:null,updated:'2026-10-26T12:00Z',lastPositiveMinimum:{amount:3500,updated:'2026-10-20T12:00Z'}};
  const planner={creditCards:{'credit-a':{trackerCardId:'1',fallbackDate:'2026-11-23',fallbackAmount:4000}}};
  const resolve=()=>resolveDebtConnections(planner,[],[issuer],[{...card,dueDate:'2026-11-15'}],{},[],Date.parse('2026-10-26T13:00Z'))[1];
  let r=resolve();assert.equal(r.monthlyMinimum.value,0);assert.equal(r.forecastMinimum.value,4000);assert.equal(r.dueDate.value,'2026-11-23');assert.equal(r.dueDate.source,'Entered manually');
  planner.debtFutureMinimums={1:4500};assert.equal(resolve().forecastMinimum.value,4500);
  delete planner.debtFutureMinimums;delete planner.creditCards['credit-a'].fallbackAmount;assert.equal(resolve().forecastMinimum.value,3500);
  issuer.minimum=5000;assert.equal(resolve().monthlyMinimum.value,5000);assert.equal(resolve().forecastMinimum.value,5000);
});
test('Income minimum comparison skips the paid cycle and includes the following monthly payment once',()=>{
  const plan={state:{cards:[card],startDate:'2026-11-06',takeHome:1000,debtPaymentSettings:{mode:'due-date',leadDays:3}},syncedDebtTerms:{1:terms},schedule:[]};
  assert.deepEqual(paydayEvents(plan,'2026-11-06','2026-12-31',{debtMode:'minimum'}).map(p=>p.allocations),[0,0,0,3500]);
  plan.state.cards[0]={...card,balance:0};
  assert.ok(paydayEvents(plan,'2026-11-06','2026-12-31',{debtMode:'minimum'}).every(p=>p.allocations===0));
});
