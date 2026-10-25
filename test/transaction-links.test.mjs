import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentLink,matchesPayment,matchingPayments,linkConflict,matchedBillPayments} from '../public/transaction-links.mjs';
import {reviewBankActivity,transactionKey} from '../public/bank-activity.mjs';
const transaction=(overrides={})=>({transaction_id:'t1',itemId:'bank',account_id:'checking',name:'Auto Lender REF 1234',date:'2026-10-24',amount:300,currency:'USD',pending:false,...overrides});
test('merchant matching handles punctuation and reference changes, but not broad name or account matches',()=>{
 const link=paymentLink(transaction());assert.ok(matchesPayment(transaction({name:'AUTO LENDER ref: 5678'}),link));assert.ok(matchesPayment(transaction({name:'Auto-Lender'}),link));
 for(const change of [{name:'Other Auto Lender'},{name:'Auto Lender 2'},{account_id:'other'},{itemId:'another bank'},{pending:true},{currency:'CAD'},{amount:-300},{name:'Auto Lender reversal'}])assert.equal(matchesPayment(transaction(change),link),false);
});
test('optional amount filters keep two car payments to the same lender separate',()=>{
 const first=paymentLink(transaction(),{exactAmount:true}),second=paymentLink(transaction({amount:450}),{exactAmount:true});
 assert.equal(matchesPayment(transaction({amount:450}),first),false);assert.ok(matchesPayment(transaction({amount:450}),second));
 assert.equal(linkConflict({'bill:one':first},'bill:two',second),null);assert.equal(linkConflict({'bill:one':first},'debt:two',paymentLink(transaction())),'bill:one');
 assert.equal(linkConflict({'bill:one':first},'bill:one',first),null);
});
test('available historical and future synced payments match without duplicate or pending entries',()=>{
 const t=transaction(),link=paymentLink(t),history=[t,t,transaction({transaction_id:'old',date:'2026-08-24'}),transaction({transaction_id:'pending',pending:true}),transaction({transaction_id:'future',date:'2026-11-24'})];
 assert.deepEqual(matchingPayments(history,link,'2026-10-25').map(t=>t.transaction_id),['t1','old']);
 assert.equal(matchingPayments(history,link,'2026-11-25').length,3);
});
test('linked debt payments leave personal spending and do not generate an extra recurring bill',()=>{
 const t=transaction({category:'GENERAL_MERCHANDISE'}),links={'debt:1':{...paymentLink(t),targetName:'Car loan'}};
 const r=reviewBankActivity([t],{},[],'2026-10-25',links);assert.equal(r.spending.total,0);assert.equal(r.bills.length,0);assert.equal(r.rows[0].linkedTarget,'debt:1');assert.equal(r.rows[0].label,'Linked to Car loan');
});
test('tracked bills retain their ID and custom name as new merchant references arrive',()=>{
 const t=transaction(),key=transactionKey(t),rule={id:'car',name:'Richard’s car',choice:'bill',amount:30000,lastPayment:t.date,repeat:'monthly',billKind:'car-payment'};
 const fresh=transaction({transaction_id:'new',name:'Auto Lender REF 6789',date:'2026-11-24',amount:310});
 const r=reviewBankActivity([t,fresh],{[key]:rule},[],'2026-11-25',{'bill:car':paymentLink(t)});
 assert.equal(r.bills.length,1);assert.equal(r.bills[0].id,'car');assert.equal(r.bills[0].name,'Richard’s car');assert.equal(r.bills[0].amount,31000);assert.equal(r.bills[0].date,'2026-12-24');
});
test('posted payments settle a matching bill once, partials sum, corrections and unlinking undo derived status',()=>{
 const t=transaction(),links={'bill:car':paymentLink(t)},bill={id:'car',key:'car:2026-10-25',date:'2026-10-25',amount:30000,repeat:'monthly',source:'manual'},next={...bill,key:'car:2026-11-25',date:'2026-11-25'};
 assert.deepEqual(matchedBillPayments([bill,next],[t,t],links,'2026-10-25'),[bill.key]);
 assert.deepEqual(matchedBillPayments([bill,next],[{...t,amount:100}],links,'2026-10-25'),[]);
 assert.deepEqual(matchedBillPayments([bill,next],[{...t,amount:100},{...t,transaction_id:'part2',amount:200}],links,'2026-10-25'),[bill.key]);
 assert.deepEqual(matchedBillPayments([bill],[],links,'2026-10-25'),[]);assert.deepEqual(matchedBillPayments([bill],[t],{},'2026-10-25'),[]);
});
test('a previous cycle payment never marks the following month paid',()=>{
 const t=transaction({date:'2026-10-01'}),bill={id:'car',key:'car:2026-11-01',date:'2026-11-01',amount:30000,repeat:'monthly',source:'manual'};
 assert.deepEqual(matchedBillPayments([bill],[t],{'bill:car':paymentLink(t)},'2026-10-25'),[]);
});
test('connected card minimums reconcile only posted payments after the statement date',()=>{
 const t=transaction(),bill={id:'card',key:'card:2026-11-05',date:'2026-11-05',statementDate:'2026-10-10',amount:30000,repeat:'once',source:'plaid-credit'},links={'credit:card':paymentLink(t)};
 assert.deepEqual(matchedBillPayments([bill],[t],links,'2026-10-25'),[bill.key]);assert.deepEqual(matchedBillPayments([bill],[{...t,date:'2026-10-09'}],links,'2026-10-25'),[]);
});
test('paid bills retain the actual matched bank transaction date',()=>{
 const t=transaction(),bill={id:'car',key:'car:2026-10-25',date:'2026-10-25',amount:30000,repeat:'monthly',source:'manual'};
 assert.deepEqual(matchedBillPayments([bill],[t],{'bill:car':paymentLink(t)},'2026-10-25',{details:true}),[{key:bill.key,paidDate:'2026-10-24'}]);
});
