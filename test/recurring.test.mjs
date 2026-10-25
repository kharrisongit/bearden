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
test('does not invent bills from pending, transfers, shopping, refunds, foreign currency or old history',()=>{
 for(const changes of [{pending:true},{amount:-20},{currency:'EUR'},{category:'TRANSFER_OUT'},{name:'Grocery store'},{category:'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'}])assert.equal(recurringBills(history(changes),'2026-10-25').length,0);
 assert.equal(recurringBills(history().slice(1),'2026-10-25')[0].provisional,true);
 assert.equal(recurringBills(history(),'2026-12-25').length,0);
 assert.equal(recurringBills(history().map((t,i)=>({...t,date:['2026-08-01','2026-08-07','2026-09-28'][i]})),'2026-10-25')[0].provisional,true);
});
test('transaction corrections and removals affect detection, and retain category data',()=>{
 const raw=history().map(t=>({...t,iso_currency_code:'USD',personal_finance_category:{detailed:'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY'}}));
 let tx=applyTransactions([],[{added:raw,modified:[],removed:[]}],'bank');assert.match(tx[0].category,/UTILITIES/);assert.equal(recurringBills(tx,'2026-10-25').length,1);
 tx=applyTransactions(tx,[{added:[],modified:[],removed:[{transaction_id:'1'}]}],'bank');assert.equal(recurringBills(tx,'2026-10-25')[0].provisional,true);
 tx=applyTransactions(tx,[{added:[],modified:[],removed:[{transaction_id:'2'}]}],'bank');assert.equal(recurringBills(tx,'2026-10-25').length,0);
});
test('confirmed bills replace matching estimates and coverage excludes a duplicate deduction',()=>{
 const estimate=recurringBills(history(),'2026-10-25')[0],confirmed={...estimate,id:'email',source:'gmail',repeat:'once',date:'2026-10-30',amount:15100};
 let events=billEvents({bills:[estimate,confirmed]},{},{},'2026-10-01','2026-11-30');assert.equal(events.length,2);assert.equal(events[0].source,'gmail');assert.equal(events[1].source,'bank-estimate');assert.equal(events[1].covered,false);
 events=billEvents({bills:[estimate]},{covered:{[estimate.id]:true}},{},'2026-10-01','2026-10-31');assert.equal(events[0].covered,true);
});

test('one recent rent payment seeds next month at the same amount without waiting',()=>{
 const rent={...history()[0],name:'Monthly rent',category:'RENT_AND_UTILITIES_RENT',date:'2026-10-01',amount:950.75};
 const [bill]=recurringBills([rent],'2026-10-25');assert.equal(bill.date,'2026-11-01');assert.equal(bill.amount,95075);assert.equal(bill.provisional,true);assert.equal(bill.billKind,'rent');
 assert.equal(recurringBills([{...rent,date:'2026-09-24'}],'2026-10-25').length,0);
});

test('weekly McDonalds and ordinary purchases become personal spending, never recurring bills',async()=>{
 const {personalSpending,classifyBankTransaction}=await import('../recurring.mjs');
 const tx=['2026-10-06','2026-10-13','2026-10-20'].map((date,i)=>({...history()[0],transaction_id:String(i),name:"McDonald's",category:'FOOD_AND_DRINK_FAST_FOOD',amount:12.5,date}));
 assert.equal(recurringBills(tx,'2026-10-25').length,0);
 const spending=personalSpending(tx,'2026-10-25');assert.equal(spending.total,3750);assert.equal(spending.categories[0].label,'Dining');
 assert.equal(classifyBankTransaction({...tx[0],category:undefined}).kind,'spending');
 assert.equal(classifyBankTransaction({...tx[0],name:'Energy Cafe'}).kind,'spending');
 assert.equal(classifyBankTransaction({...tx[0],name:'Supermarket',category:'FOOD_AND_DRINK_GROCERIES'}).key,'groceries');
});
test('personal spending excludes bill payments, transfers, refunds, pending, and older transactions',async()=>{
 const {personalSpending}=await import('../recurring.mjs');const t={...history()[0],name:'Corner store',date:'2026-10-20',amount:20,category:'GENERAL_MERCHANDISE'};
 const tx=[t,{...t,transaction_id:'b',category:'RENT_AND_UTILITIES_RENT'},{...t,category:'TRANSFER_OUT'},{...t,pending:true},{...t,amount:-20},{...t,date:'2026-09-01'}];
 assert.equal(personalSpending(tx,'2026-10-25').total,2000);
});

test('transaction review requires tracking a bill, remembers spending choices, and uses latest rent',async()=>{
 const {reviewBankActivity,transactionKey}=await import('../public/bank-activity.mjs');
 const rent={...history()[0],name:'Monthly rent',category:'RENT_AND_UTILITIES_RENT',date:'2026-10-01',amount:950.75},key=transactionKey(rent);
 let r=reviewBankActivity([rent],{},[],'2026-10-25');assert.equal(r.bills.length,0);assert.equal(r.rows[0].choice,'suggested');assert.equal(r.spending.total,0);
 const rules={[key]:{choice:'bill',id:'tracked-rent',name:rent.name,amount:95075,lastPayment:rent.date,repeat:'monthly'}};
 r=reviewBankActivity([rent],rules,[],'2026-10-25');assert.equal(r.bills[0].amount,95075);assert.equal(r.bills[0].date,'2026-11-01');assert.equal(r.spending.total,0);
 const latest={...rent,date:'2026-11-01',amount:960.25};r=reviewBankActivity([latest],rules,[],'2026-11-02');assert.equal(r.bills[0].amount,96025);assert.equal(r.bills[0].date,'2026-12-01');
 r=reviewBankActivity([rent],{[key]:{choice:'spending'}},[],'2026-10-25');assert.equal(r.bills.length,0);assert.equal(r.spending.total,95075);
 r=reviewBankActivity([],rules,[],'2026-11-05');assert.equal(r.bills[0].date,'2026-12-01');
});
test('tracked bills and everyday spending remain mutually exclusive in forecast',async()=>{
 const {reviewBankActivity,transactionKey}=await import('../public/bank-activity.mjs');
 const tx={...history()[0],name:'Music club',date:'2026-10-20',amount:15};const key=transactionKey(tx);
 let r=reviewBankActivity([tx],{},[],'2026-10-25');assert.equal(r.spending.total,1500);
 r=reviewBankActivity([tx],{[key]:{choice:'bill',id:'music',name:tx.name,amount:1500,lastPayment:tx.date}},[],'2026-10-25');assert.equal(r.spending.total,0);assert.equal(r.bills.length,1);
 assert.equal(billEvents({bills:r.bills},{},{},'2026-10-25','2026-11-25')[0].covered,false);
});

test('custom bill names and categories survive new bank transactions',async()=>{
 const {reviewBankActivity,transactionKey}=await import('../public/bank-activity.mjs');
 const t={...history()[0],name:'ELGA AUTO ACH',date:'2026-10-20',amount:250},key=transactionKey(t);
 const r=reviewBankActivity([t],{[key]:{id:'car',choice:'bill',name:'Buick payment',billKind:'car-payment',lastPayment:'2026-09-20',amount:24000,repeat:'monthly'}},[],'2026-10-25');
 assert.equal(r.bills[0].name,'Buick payment');assert.equal(r.bills[0].billKind,'car-payment');assert.equal(r.bills[0].amount,25000);
});
