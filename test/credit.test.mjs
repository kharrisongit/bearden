import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCreditCards,cardPayments,creditBills} from '../public/credit-model.mjs';
import {creditLinkOptions,syncCredit,publicCredit} from '../credit.mjs';
import {trackerDebtBills,billEvents,cashForecast,paydayEvents} from '../public/income-model.mjs';
const item={id:'bank',name:'ELGA',token:'secret',liabilities:true};
const response={accounts:[{account_id:'visa',name:'Visa',mask:'1234',type:'credit',balances:{current:861.21,available:4138.79,limit:5000,iso_currency_code:'USD'}}],liabilities:{credit:[{account_id:'visa',minimum_payment_amount:35,next_payment_due_date:'2026-11-05',last_payment_amount:100,last_payment_date:'2026-10-20',last_statement_balance:900,last_statement_issue_date:'2026-10-10',aprs:[{apr_type:'purchase_apr',apr_percentage:24.99}]}]}};
test('card details preserve unknown versus zero, current debt and multiple APRs',()=>{
 const [card]=normalizeCreditCards(response,item,[],'2026-10-25T10:00:00Z');assert.equal(card.balance,86121);assert.equal(card.minimum,3500);assert.equal(card.limit,500000);assert.equal(card.aprs[0].rate,24.99);assert.equal(card.lastPayment,10000);assert.equal(card.id,'credit-visa');
 const [unknown]=normalizeCreditCards({...response,liabilities:{credit:[]}},item);assert.equal(unknown.minimum,null);assert.equal(unknown.dueDate,null);assert.equal(unknown.detailsAvailable,false);assert.deepEqual(unknown.aprs,[]);
 const empty=structuredClone(response);empty.liabilities.credit[0].minimum_payment_amount=0;assert.equal(normalizeCreditCards(empty,item)[0].minimum,0);
 const updated=normalizeCreditCards(response,item,[card],'2026-10-25T12:00:00Z')[0];assert.equal(updated.history.length,1);assert.equal(normalizeCreditCards(response,item,[updated],'2026-10-26T12:00:00Z')[0].history.length,2);
});
test('payment tracking excludes purchases, refunds, pending and other accounts; issuer last payment deduplicates',()=>{
 const [card]=normalizeCreditCards(response,item),base={itemId:'bank',account_id:'visa',date:'2026-10-20',amount:-100,name:'Payment thank you',currency:'USD'};
 const payments=cardPayments(card,[{...base,transaction_id:'payment'},{...base,transaction_id:'refund',name:'Payment refund'},{...base,transaction_id:'pending',pending:true},{...base,transaction_id:'other',account_id:'checking'},{...base,transaction_id:'purchase',amount:100},{...base,transaction_id:'reward',name:'Reward credit'}]);
 assert.equal(payments.length,1);assert.equal(payments[0].id,'payment');assert.equal(payments[0].amount,10000);
 assert.equal(cardPayments(card,[])[0].source,'issuer');
});
test('tracked cards use confirmed minimum and due date; never invent a recurring date or zero missing details',()=>{
 const [card]=normalizeCreditCards(response,item),prefs={[card.id]:{tracking:true,name:'My Visa',fallbackAmount:10000,fallbackDate:'2026-11-20'}};
 const [bill]=creditBills([card],prefs);assert.equal(bill.name,'My Visa');assert.equal(bill.amount,3500);assert.equal(bill.date,'2026-11-05');assert.equal(bill.repeat,'once');assert.equal(bill.covered,false);
 assert.equal(creditBills([{...card,minimum:0}],prefs).length,0);assert.equal(creditBills([{...card,currency:'EUR'}],prefs).length,0);
 assert.equal(creditBills([{...card,minimum:null,dueDate:null}],{[card.id]:{tracking:true}}).length,0);
 assert.equal(creditBills([{...card,minimum:null,dueDate:null}],prefs)[0].confirmed,false);
 // A prior payment is not proof the current statement has been paid.
 assert.equal(creditBills([{...card,lastPayment:100000}],prefs)[0].amount,3500);
});
test('Baby Bear debt plan payments appear in Bills and are deducted once in forecast',()=>{
 const plan={state:{cards:[{id:1,name:'Visa'},{id:2,name:'Auto'}],startDate:'2026-11-01'},schedule:[{paycheck:1,date:'2026-11-01',takeHomeThisCheck:1000,bonusAmount:0,payments:[100,200]}]};
 const debts=trackerDebtBills(plan);assert.equal(debts.length,2);assert.equal(debts[0].amount,10000);
 const bills=billEvents({bills:debts},{},{},'2026-11-01','2026-11-30');assert.ok(bills.every(b=>b.covered));
 const forecast=cashForecast([{include:true,balance:100000,currency:'USD'}],paydayEvents(plan,'2026-11-01','2026-11-01',{billsOnly:true}),bills,'2026-11-01');assert.equal(forecast.outgoing,30000);assert.equal(forecast.endBalance,170000);
 const [card]=normalizeCreditCards(response,item),prefs={[card.id]:{tracking:true,trackerCardId:'1',covered:true}},credit=creditBills([card],prefs),matched=trackerDebtBills(plan,credit,prefs);assert.equal(matched.length,1);assert.equal(matched[0].name,'Auto');
 plan.state.checkedPaychecks={1:true};assert.equal(trackerDebtBills(plan).length,0);
});
test('card bills replace selected existing bill and card-funded bills do not duplicate forecast',()=>{
 const legacy={bills:[{id:'card',name:'Visa',amount:3500,date:'2026-11-05',source:'plaid-credit',repeat:'once',replaces:'old',covered:false},{id:'netflix',name:'Netflix',amount:1500,date:'2026-11-06',source:'bank-tracked',paidByCard:true,repeat:'monthly'}]};
 const bills=billEvents(legacy,{manual:[{id:'old',name:'Old Visa',amount:3500,date:'2026-11-05',repeat:'monthly'}]}, {},'2026-11-01','2026-11-30');assert.equal(bills.length,2);assert.equal(cashForecast([{include:true,balance:10000}],[],bills,'2026-11-01').outgoing,3500);
});
test('existing bank update reuses its token and requests additional consent without a new Item',()=>{
 const options=creditLinkOptions({itemId:'bank'},item);assert.equal(options.access_token,'secret');assert.equal(options.products,undefined);assert.deepEqual(options.additional_consented_products,['liabilities','transactions']);
 assert.deepEqual(creditLinkOptions({kind:'credit'}).products,['liabilities','transactions']);assert.deepEqual(creditLinkOptions({}).products,['transactions']);assert.throws(()=>creditLinkOptions({itemId:'missing'}),/not found/);
});
test('liabilities sync preserves last successful data on errors, recovers, and throttles daily',async()=>{
 const c={items:[{...item}],transactions:[]},i=c.items[0];let calls=0;const call=async()=>{calls++;return response;};
 await syncCredit(c,i,call);assert.equal(c.creditCards[0].balance,86121);assert.equal(publicCredit(c)[0].stale,false);
 await syncCredit(c,i,call);assert.equal(calls,1);
 await syncCredit(c,i,async()=>{throw Object.assign(Error('Not ready'),{code:'PRODUCT_NOT_READY'});},true);assert.equal(c.creditCards[0].balance,86121);assert.equal(publicCredit(c)[0].stale,true);
 await syncCredit(c,i,call,true);assert.equal(i.liabilitiesError,undefined);assert.equal(c.creditCards.length,1);
});
