import test from 'node:test';
import assert from 'node:assert/strict';
import {recurringBills} from '../recurring.mjs';
import {applyTransactions} from '../providers.mjs';
import {billEvents} from '../public/income-model.mjs';
const history=(changes={})=>['2026-07-28','2026-08-28','2026-09-28'].map((date,i)=>({transaction_id:String(i),itemId:'bank',account_id:'bills',name:'Consumers Energy',amount:100+i*12,date,currency:'USD',pending:false,...changes}));
test('detects recurring variable bills from hidden accounts with stable IDs and latest amount',()=>{
 const a=recurringBills(history(),'2026-10-25');assert.equal(a.length,1);assert.equal(a[0].date,'2026-10-28');assert.equal(a[0].amount,12400);assert.equal(a[0].repeat,'monthly');
 const next=recurringBills([...history(),{...history()[2],transaction_id:'4',date:'2026-10-28',amount:140}],'2026-10-29');assert.equal(a[0].id,next[0].id);assert.equal(next[0].date,'2026-11-28');
});
test('does not invent bills from pending, transfers, shopping, refunds, foreign currency or insufficient history',()=>{
 for(const changes of [{pending:true},{amount:-20},{currency:'EUR'},{category:'TRANSFER_OUT'},{name:'Grocery store'},{category:'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'}])assert.equal(recurringBills(history(changes),'2026-10-25').length,0);
 assert.equal(recurringBills(history().slice(1),'2026-10-25').length,0);
 assert.equal(recurringBills(history(),'2026-12-25').length,0);
 assert.equal(recurringBills(history().map((t,i)=>({...t,date:['2026-08-01','2026-08-07','2026-09-28'][i]})),'2026-10-25').length,0);
});
test('transaction corrections and removals affect detection, and retain category data',()=>{
 const raw=history().map(t=>({...t,iso_currency_code:'USD',personal_finance_category:{detailed:'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY'}}));
 let tx=applyTransactions([],[{added:raw,modified:[],removed:[]}],'bank');assert.match(tx[0].category,/UTILITIES/);assert.equal(recurringBills(tx,'2026-10-25').length,1);
 tx=applyTransactions(tx,[{added:[],modified:[],removed:[{transaction_id:'1'}]}],'bank');assert.equal(recurringBills(tx,'2026-10-25').length,0);
});
test('confirmed bills replace matching estimates and coverage excludes a duplicate deduction',()=>{
 const estimate=recurringBills(history(),'2026-10-25')[0],confirmed={...estimate,id:'email',source:'gmail',repeat:'once',date:'2026-10-30',amount:15100};
 let events=billEvents({bills:[estimate,confirmed]},{},{},'2026-10-01','2026-11-30');assert.equal(events.length,2);assert.equal(events[0].source,'gmail');assert.equal(events[1].source,'bank-estimate');assert.equal(events[1].covered,false);
 events=billEvents({bills:[estimate]},{covered:{[estimate.id]:true}},{},'2026-10-01','2026-10-31');assert.equal(events[0].covered,true);
});
