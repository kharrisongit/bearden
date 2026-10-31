import test from 'node:test';
import assert from 'node:assert/strict';
import {billTrackerSummary,transactionKey,paymentLink} from '../public/income-model.mjs';
const bill=(id,date,amount=10000,extra={})=>({id,name:id,date,amount,repeat:'monthly',source:'manual',billKind:'utility',...extra});
const today='2026-10-26';

test('monthly bill counts and amounts include paid bills and car payments, excluding debt and budgets',()=>{
 const manual=[bill('rent','2026-10-01',80000,{billKind:'rent'}),bill('car','2026-10-28',30000,{billKind:'car-payment'}),bill('electric','2026-10-29',12500),bill('card','2026-10-30',5000,{billKind:'credit-card'}),bill('loan','2026-10-30',6000,{billKind:'loan'}),bill('budget','2026-10-30',10000,{source:'budget'}),bill('transfer','2026-10-30',20000,{transfer:true})];
 const s=billTrackerSummary({}, {manual,paid:['rent:2026-10-01']},{},today);
 assert.equal(s.totalCount,3);assert.equal(s.paidCount,1);assert.equal(s.total,122500);assert.equal(s.remaining,42500);assert.equal(s.paidAmount,80000);
 assert.deepEqual(s.upcoming.map(b=>[b.id,b.date]),[['car','2026-10-28'],['electric','2026-10-29'],['rent','2026-11-01']]);
});

test('overdue bills appear first without pulling earlier-month amounts into this month',()=>{
 const manual=[bill('old','2026-09-10',7000,{repeat:'once'}),bill('late','2026-10-20',5000),bill('today',today,1200),bill('next','2026-10-27',1500)];
 const s=billTrackerSummary({}, {manual},{},today);
 assert.equal(s.total,7700);assert.equal(s.remaining,7700);assert.equal(s.overdueCount,2);assert.deepEqual(s.upcoming.map(b=>b.id),['old','late','today']);
});

test('manual and synced paid flags deduplicate, normalized rent dates work, and covered bills remain unpaid',()=>{
 const rent=bill('rent','2026-10-20',80000,{billKind:'rent'}),water=bill('water','2026-10-29',5000);
 const s=billTrackerSummary({bills:[water],paid:['water:2026-10-29']},{manual:[rent,water,bill('covered','2026-10-30',2000)],paid:['rent:2026-10-20','water:2026-10-29'],covered:{covered:true}},{},today);
 assert.equal(s.totalCount,3);assert.equal(s.paidCount,2);assert.equal(s.remaining,2000);assert.equal(s.total,87000);
});

test('paid marks survive advancing a bill to the next month, but deleted bills never reappear',()=>{
 const manual=[bill('water','2026-11-20',5000),bill('removed','2026-11-15',3000)];
 const s=billTrackerSummary({}, {manual,paid:['water:2026-10-20','removed:2026-10-15'],deletedBills:{removed:true}},{},today);
 assert.equal(s.paidCount,1);assert.equal(s.totalCount,1);assert.equal(s.total,5000);assert.equal(s.remaining,0);assert.ok(s.upcoming.every(b=>b.id!=='removed'));
});

test('monthly bank bills retain the posted cycle and group split payments once',()=>{
 const transactions=[{transaction_id:'a',date:'2026-10-20',name:'Power company',itemId:'bank',account_id:'bills',currency:'USD',amount:40},{transaction_id:'b',date:'2026-10-21',name:'Power company',itemId:'bank',account_id:'bills',currency:'USD',amount:60}];
 const tracked=bill('power','2026-11-21',10000,{source:'bank-tracked',groupKey:transactionKey(transactions[0]),lastPayment:'2026-10-21'});
 const s=billTrackerSummary({bills:[tracked]},{transactionLinks:{'bill:power':paymentLink(transactions[0])}},{},today,{transactions:[...transactions,transactions[0],{...transactions[0],transaction_id:'pending',pending:true},{...transactions[0],transaction_id:'other',account_id:'other'}]});
 assert.equal(s.paidCount,1);assert.equal(s.totalCount,1);assert.equal(s.total,10000);assert.equal(s.remaining,0);assert.equal(s.upcoming[0].date,'2026-11-21');
});

test('weekly bank bill history and upcoming cycles are all counted in the current month',()=>{
 const transactions=['2026-10-02','2026-10-09','2026-10-16','2026-10-23'].map((date,i)=>({transaction_id:String(i),date,name:'Weekly childcare',itemId:'bank',account_id:'bills',currency:'USD',amount:100}));
 const tracked=bill('care','2026-10-30',10000,{repeat:'weekly',source:'bank-tracked',groupKey:transactionKey(transactions[0]),lastPayment:'2026-10-23'});
 const s=billTrackerSummary({bills:[tracked]},{},{},today,{transactions});
 assert.equal(s.paidCount,4);assert.equal(s.totalCount,5);assert.equal(s.total,50000);assert.equal(s.remaining,10000);
});

test('Gmail electric replacement and paid date corrections produce only one monthly bill',()=>{
 const electric=bill('power','2026-10-30',10000,{billKind:'electric',source:'bank-tracked'}),email=bill('email','2026-10-28',12345,{billKind:'electric',source:'gmail',repeat:'once'});
 const s=billTrackerSummary({bills:[electric,email]},{electricBillId:'power',paid:['power:2026-10-30']},{},today);
 assert.equal(s.totalCount,1);assert.equal(s.paidCount,1);assert.equal(s.total,12345);assert.equal(s.remaining,0);
});

test('month boundaries, zero bills and empty accounts do not invent amounts or payments',()=>{
 const p={manual:[bill('month-end','2026-01-31',5000)]};
 const feb=billTrackerSummary({},p,{},'2026-02-20');assert.equal(feb.end,'2026-02-28');assert.equal(feb.totalCount,1);assert.equal(feb.upcoming[0].date,'2026-02-28');
 const leap=billTrackerSummary({},p,{},'2028-02-20');assert.equal(leap.end,'2028-02-29');
 const empty=billTrackerSummary({}, {manual:[bill('zero',today,0)]},{},today);assert.equal(empty.total,0);assert.equal(empty.totalCount,0);assert.equal(empty.paidCount,0);assert.equal(empty.hasBills,false);
});

test('selected months contain only their own paid and unpaid occurrences after a bill advances',()=>{
 const manual=[bill('water','2026-11-20',5000),bill('new','2026-11-03',2000),bill('old','2026-09-15',3000,{repeat:'once'})];
 const planner={manual,paid:['water:2026-10-20','water:2026-11-20']};
 const oct=billTrackerSummary({},planner,{},today,{month:'2026-10-01'});
 assert.deepEqual(oct.bills.map(b=>[b.key,b.paid]),[['water:2026-10-20',true]]);
 assert.equal(oct.total,5000);assert.equal(oct.remaining,0);
 const nov=billTrackerSummary({},planner,{},today,{month:'2026-11-01'});
 assert.deepEqual(nov.bills.map(b=>[b.key,b.paid]),[['new:2026-11-03',false],['water:2026-11-20',true]]);
 assert.equal(nov.total,7000);assert.equal(nov.remaining,2000);
 const dec=billTrackerSummary({},planner,{},today,{month:'2026-12-01'});
 assert.ok(dec.bills.every(b=>b.date.startsWith('2026-12')&&!b.paid));
});

test('month selection keeps weekly occurrences, year boundaries, and distant months in range',()=>{
 const planner={manual:[bill('care','2026-10-02',10000,{repeat:'weekly'}),bill('year-end','2026-12-31',5000)]};
 for(const month of ['2026-10-01','2026-12-01','2027-01-01','2028-01-01']){
  const s=billTrackerSummary({},planner,{},today,{month});
  assert.ok(s.bills.length>=4);assert.ok(s.bills.every(b=>b.date>=s.start&&b.date<=s.end));
  assert.equal(s.totalCount,s.bills.length);assert.equal(s.total,s.bills.reduce((n,b)=>n+b.amount,0));
 }
});

test('browsing a future month does not treat future-dated bank transactions as received',()=>{
 const transactions=[{transaction_id:'future',date:'2026-11-20',name:'Power company',itemId:'bank',account_id:'bills',currency:'USD',amount:100}];
 const tracked=bill('power','2026-12-20',10000,{source:'bank-tracked',groupKey:transactionKey(transactions[0]),lastPayment:'2026-11-20'});
 const s=billTrackerSummary({bills:[tracked]},{},{},today,{transactions,month:'2026-11-01'});
 assert.equal(s.paidCount,0);assert.equal(s.bills.length,0);
});

test('a posted transaction cannot move an awaiting-confirmation cycle into tracker paid totals',()=>{
 const transaction={transaction_id:'posted',date:'2026-10-20',name:'Power company',itemId:'bank',account_id:'bills',currency:'USD',amount:100};
 const tracked=bill('power','2026-10-26',10000,{source:'bank-tracked',groupKey:transactionKey(transaction)});
 const planner={awaitingConfirmation:['power:2026-10-26'],transactionLinks:{'bill:power':paymentLink(transaction)}};
 const pending=billTrackerSummary({bills:[tracked]},planner,{},today,{transactions:[transaction]});
 assert.equal(pending.totalCount,1);assert.equal(pending.paidCount,0);assert.equal(pending.remaining,10000);assert.equal(pending.bills[0].awaitingConfirmation,true);
 const confirmed=billTrackerSummary({bills:[tracked]},{...planner,awaitingConfirmation:[],paid:['power:2026-10-26']},{},today,{transactions:[transaction]});
 assert.equal(confirmed.totalCount,1);assert.equal(confirmed.paidCount,1);assert.equal(confirmed.remaining,0);
});
