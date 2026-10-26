import test from 'node:test';
import assert from 'node:assert/strict';
import {categorizeTransaction,transactionMerchantKey,setTransactionCategory} from '../public/transaction-categories.mjs';
import {reviewBankActivity,billsAccountSpending,classifyBankTransaction,transactionKey} from '../public/bank-activity.mjs';
import {paymentLink} from '../public/transaction-links.mjs';

const today='2026-10-26';
const tx=(changes={})=>({itemId:'bank',account_id:'checking',transaction_id:'one',name:'Corner shop',amount:12.34,date:'2026-10-25',currency:'USD',pending:false,...changes});

test('automatic categories use specific bank data first and merchant clues when data is missing or generic',()=>{
 for(const [name,category,key] of [
  ['Target','FOOD_AND_DRINK_GROCERIES','groceries'],['CVS','FOOD_AND_DRINK_GROCERIES','groceries'],
  ['Local shop','TRANSPORTATION_GAS','transport'],['Unknown','LOAN_PAYMENTS_CREDIT_CARD_PAYMENT','debt'],
  ['Netflix','ENTERTAINMENT_TV_AND_MOVIES','subscription'],['Aldi #452','','groceries'],
  ['POS PURCHASE STARBUCKS 1234','','dining'],['Uber Eats','','dining'],['Uber trip','','transport'],
  ['Consumers Energy','','electric'],['Xfinity','','phone-internet'],['State Farm','','insurance'],
  ['Amazon','','shopping'],['Unknown merchant','','other'],['Transfer to savings','','transfer'],
  ['ATM withdrawal','','cash'],['Overdraft fee','','fees'],['Grocery store','','groceries'],
 ])assert.equal(categorizeTransaction(tx({name,category})).key,key,name);
});

test('merchant identities tolerate bank wrappers and store numbers without merging different payment recipients',()=>{
 assert.equal(transactionMerchantKey(tx({name:'POS PURCHASE 10/25 SQ *Corner Cafe #125 123456789'})),'corner cafe');
 assert.equal(transactionMerchantKey(tx({name:'Corner Cafe #912'})),'corner cafe');
 assert.equal(transactionMerchantKey(tx({name:'STARBUCKS 1234'})),'starbucks');
 assert.notEqual(transactionMerchantKey(tx({name:'PAYPAL *Alice Shop'})),transactionMerchantKey(tx({name:'PAYPAL *Bob Shop'})));
 assert.notEqual(transactionMerchantKey(tx({name:'7-Eleven'})),transactionMerchantKey(tx({name:'Eleven'})));
 assert.equal(transactionMerchantKey(tx({name:'Credit One Payment'})),'credit one payment');
 assert.equal(transactionMerchantKey(tx({name:'POS PURCHASE'})),'');
});

test('a remembered correction survives refreshes and applies to future merchant transactions across accounts',()=>{
 const original=tx({name:'Corner shop #12'}),prefs=setTransactionCategory({},original,'groceries');
 const next=tx({name:'Corner shop #19',transaction_id:'next',account_id:'second',category:'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE'});
 assert.equal(categorizeTransaction(next,JSON.parse(JSON.stringify(prefs))).key,'groceries');
 assert.equal(categorizeTransaction(next,prefs).source,'merchant');
 assert.equal(original.category,undefined);
});

test('one-purchase exceptions persist, remain isolated by account, and take priority over later merchant corrections',()=>{
 const t=tx(),other=tx({transaction_id:'two'});
 let prefs=setTransactionCategory({},t,'groceries');
 prefs=setTransactionCategory(prefs,t,'personal',false);
 prefs=setTransactionCategory(prefs,other,'shopping');
 assert.equal(categorizeTransaction(t,prefs).key,'personal');
 assert.equal(categorizeTransaction(other,prefs).key,'shopping');
 assert.equal(categorizeTransaction({...t,account_id:'another'},prefs).key,'shopping');
});

test('Automatic can reset one transaction or the merchant rule without changing the saved input',()=>{
 const t=tx({name:'Aldi'}),other={...t,transaction_id:'two'},saved=setTransactionCategory({},t,'shopping');
 const one=setTransactionCategory(saved,t,'auto',false);
 assert.equal(categorizeTransaction(t,one).key,'groceries');assert.equal(categorizeTransaction(other,one).key,'shopping');
 const all=setTransactionCategory(one,other,'auto');
 assert.equal(categorizeTransaction(other,all).key,'groceries');assert.equal(categorizeTransaction(t,saved).key,'shopping');
 assert.throws(()=>setTransactionCategory(saved,t,'invalid'));
 assert.equal(categorizeTransaction(t,{merchants:{aldi:'invalid'}}).key,'groceries');
});

test('generic descriptions only get a transaction-specific correction',()=>{
 const t=tx({name:'Online payment'}),prefs=setTransactionCategory({},t,'debt');
 assert.equal(categorizeTransaction(t,prefs).key,'debt');
 assert.equal(categorizeTransaction({...t,transaction_id:'other'},prefs).key,'other');
 assert.deepEqual(prefs.merchants,{});
});

test('corrections update personal and bills chart totals, while transfers stay out of spending',()=>{
 const purchase=tx(),transfer=tx({transaction_id:'two',name:'Transfer to savings',amount:50});
 const preferences=setTransactionCategory({},purchase,'groceries'),rows=[purchase,transfer];
 const personal=reviewBankActivity(rows,{},[],today,{},preferences);
 assert.deepEqual(personal.spending.categories,[{key:'groceries',label:'Groceries',amount:1234,count:1}]);
 const bills=billsAccountSpending(rows,{source:'plaid',id:'plaid-checking'},today,{}, {},preferences);
 assert.equal(bills.total,1234);assert.equal(bills.categories[0].label,'Groceries');
 const corrected=setTransactionCategory(preferences,transfer,'shopping',false);
 assert.equal(reviewBankActivity(rows,{},[],today,{},corrected).spending.total,6234);
 assert.equal(billsAccountSpending(rows,{source:'plaid',id:'plaid-checking'},today,{}, {},corrected).total,6234);
});

test('category corrections leave linked bill schedules intact and cannot double-count personal spending',()=>{
 const t=tx({name:'Consumers Energy',amount:120}),key=transactionKey(t);
 const rules={[key]:{choice:'bill',id:'power',name:'Electric bill',billKind:'electric',amount:12000,lastPayment:t.date,repeat:'monthly'}};
 const links={'bill:power':{...paymentLink(t),targetName:'Electric bill'}},prefs=setTransactionCategory({},t,'utilities');
 const before=reviewBankActivity([t],rules,[],today,links),after=reviewBankActivity([t],rules,[],today,links,prefs);
 assert.deepEqual(after.bills,before.bills);assert.equal(after.spending.total,0);assert.equal(after.rows[0].linkedTarget,'bill:power');
 const chart=billsAccountSpending([t],{source:'plaid',id:'plaid-checking'},today,rules,links,prefs);
 assert.equal(chart.categories[0].label,'Utilities');assert.equal(chart.total,12000);
});

test('category edits override an old spending choice without creating a recurring bill',()=>{
 const t=tx(),rules={[transactionKey(t)]:{choice:'spending'}};
 const result=reviewBankActivity([t],rules,[],today,{},setTransactionCategory({},t,'rent'));
 assert.equal(result.rows[0].choice,'suggested');assert.equal(result.spending.total,0);assert.equal(result.bills.length,0);
});

test('manual categories never include pending, refunded, non-USD, nonfinite or out-of-range transactions in totals',()=>{
 const t=tx(),prefs=setTransactionCategory({},t,'shopping');
 const rows=[{...t,pending:true},{...t,amount:-10},{...t,currency:'EUR'},{...t,amount:Infinity},{...t,date:'2026-09-01'},{...t,date:'2026-11-01'}];
 assert.equal(reviewBankActivity(rows,{},[],today,{},prefs).spending.total,0);
 assert.equal(billsAccountSpending(rows,{source:'plaid',id:'plaid-checking'},today,{}, {},prefs).total,0);
 assert.equal(classifyBankTransaction({...t,pending:true},prefs).kind,'excluded');
});
