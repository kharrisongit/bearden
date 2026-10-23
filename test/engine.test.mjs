import test from 'node:test';import assert from 'node:assert/strict';
import {blank,forecast,monthly,validate} from '../public/engine.mjs';
const start='2026-10-01';
function setup(){const s=blank();s.accounts=[{id:'cash',name:'Cash',balance:100000,include:true}];s.income=[{id:'pay',name:'Pay',amount:100000,date:'2026-10-05',repeat:'biweekly'}];return s;}
test('month-end recurrence does not drift after February',()=>{assert.equal(monthly('2027-01-31',1),'2027-02-28');assert.equal(monthly('2027-01-31',2),'2027-03-31');assert.equal(monthly('2028-01-31',1),'2028-02-29');});
test('detects shortfall before payday despite later positive income',()=>{const s=setup();s.bills=[{id:'bill',name:'Rent',amount:150000,date:'2026-10-02',repeat:'once'}];const p=forecast(s,start,30);assert.equal(p.firstShortfall,'2026-10-02');assert.equal(p.low,-50000);assert.ok(p.endBalance>0);});
test('same-day bill clears before paycheck conservatively',()=>{const s=setup();s.bills=[{id:'bill',name:'Rent',amount:150000,date:'2026-10-05',repeat:'once'}];assert.equal(forecast(s,start,30).firstShortfall,'2026-10-05');});
test('paid bill is not charged again',()=>{const s=setup();s.bills=[{id:'bill',name:'Rent',amount:150000,date:'2026-10-02',repeat:'once'}];s.paid=['bill:2026-10-02'];assert.equal(forecast(s,start,30).firstShortfall,null);});
test('overdue one-time obligations remain in forecast',()=>{const s=setup();s.bills=[{id:'bill',name:'Old bill',amount:10000,date:'2026-09-20',repeat:'once'}];assert.equal(forecast(s,start).rows[0].amount,-10000);});
test('reserves obligations on next payday before allocating surplus',()=>{const s=setup();s.bills=[{id:'bill',name:'Rent',amount:150000,date:'2026-10-19',repeat:'once'}];s.debts=[{id:'d',name:'Debt',balance:500000,minimum:0,apr:0,date:'2026-10-25'}];const p=forecast(s,start,30);assert.equal(p.checks[0].reserve,150000);assert.equal(p.checks[0].debt[0],25000);assert.ok(p.low>=25000);});
test('minimums are monthly and capped at remaining balance',()=>{const s=setup();s.income=[];s.debts=[{id:'d',name:'Debt',balance:5000,minimum:9000,apr:0,date:'2026-10-10'}];const p=forecast(s,start,60);assert.equal(p.rows.filter(x=>x.type==='minimum').reduce((n,x)=>n-x.amount,0),5000);assert.equal(p.balances[0],0);});
test('avalanche prioritizes high APR; snowball prioritizes small balance',()=>{const s=setup();s.accounts[0].balance=0;s.settings.cushion=0;s.income[0].amount=10000;s.income[0].repeat='once';s.debts=[{id:'a',name:'Small',balance:20000,minimum:0,apr:0,date:'2026-10-25'},{id:'b',name:'High',balance:50000,minimum:0,apr:30,date:'2026-10-25'}];assert.deepEqual(forecast(s,start,30).checks[0].debt,[10000,0]);s.settings.method='avalanche';assert.deepEqual(forecast(s,start,30).checks[0].debt,[0,10000]);});
test('savings capped at goal and cushion is preserved',()=>{const s=setup();s.goals=[{id:'g',name:'Goal',target:10000,saved:9000,contribution:5000}];const p=forecast(s,start,30);assert.equal(p.checks[0].save[0],1000);assert.equal(p.savings[0],10000);});
test('bonuses do not recur and same-day income produces one allocation',()=>{const s=setup();s.bonuses=[{id:'b',name:'Bonus',amount:50000,date:'2026-10-05'}];const p=forecast(s,start,60);assert.equal(p.rows.filter(x=>x.type==='bonus').length,1);assert.equal(p.checks[0].income,150000);assert.equal(p.checks.filter(x=>x.date==='2026-10-05').length,1);});
test('Squasher regular targets smaller debts; bonus targets largest three',()=>{const s=setup();s.settings.method='squasher';s.debts=[10000,20000,30000,40000].map((balance,i)=>({id:'d'+i,name:'Debt '+i,balance,minimum:0,apr:0,date:'2026-10-25'}));let p=forecast(s,start,30);assert.deepEqual(p.checks[0].debt,[5000,0,0,0]);s.bonuses=[{id:'b',name:'Bonus',date:'2026-10-05',amount:10000}];p=forecast(s,start,30);assert.deepEqual(p.checks[0].debt,[0,10000,15000,20000]);s.squash=['2026-10-05'];assert.deepEqual(forecast(s,start,30).checks[0].debt,[10000,20000,30000,40000]);});
test('cascade retains requested bonus portion',()=>{const s=setup();s.settings.method='cushionCascade';s.settings.bonusMode='retain';s.bonuses=[{id:'b',name:'Bonus',date:'2026-10-05',amount:50000}];s.debts=[{id:'d',name:'Debt',balance:900000,minimum:0,apr:0,date:'2026-10-25'}];assert.equal(forecast(s,start,30).checks[0].left,75000);});
test('invalid backups rejected and overdraft accepted',()=>{const s=setup();s.accounts[0].balance=-100;assert.doesNotThrow(()=>validate(s));s.bills=[{id:'bad',name:'Bad',amount:100,date:'2026-02-30',repeat:'once'}];assert.throws(()=>validate(s));});
test('debt-free estimate includes payoff by minimums and extra payments, and stays unknown outside forecast',()=>{
 const s=setup();s.debts=[{id:'d',name:'Debt',balance:5000,minimum:5000,apr:0,date:'2026-10-03'}];
 assert.equal(forecast(s,start,30).debtFreeDate,'2026-10-03');
 s.debts[0].minimum=0;assert.equal(forecast(s,start,30).debtFreeDate,'2026-10-05');
 s.debts[0].balance=90000000;assert.equal(forecast(s,start,365).debtFreeDate,null);
 s.debts[0].balance=0;assert.equal(forecast(s,start,30).debtFreeDate,start);
});
test('one paycheck income and bill edits do not change recurring defaults',()=>{
 const s=setup();s.bills=[{id:'food',name:'Food',amount:10000,date:'2026-10-07',repeat:'biweekly'}];s.checkEdits={'2026-10-05':{income:150000,bills:{'food:2026-10-07':20000}}};
 const p=forecast(validate(s),start,40);assert.equal(p.checks[0].income,150000);assert.equal(p.checks[1].income,100000);assert.equal(p.rows.find(r=>r.id==='food:2026-10-07').amount,-20000);assert.equal(p.rows.find(r=>r.id==='food:2026-10-21').amount,-10000);assert.equal(s.income[0].amount,100000);assert.equal(s.bills[0].amount,10000);
});
test('explicit extra payments and savings edits persist and recalculate future balances',()=>{
 const s=setup();s.debts=[{id:'debt',name:'Debt',balance:500000,minimum:0,apr:0,date:'2026-10-25'}];s.goals=[{id:'fund',name:'Fund',target:500000,saved:0,contribution:10000}];s.checkEdits={'2026-10-05':{debt:{debt:20000},savings:{fund:5000}}};
 const p=forecast(validate(s),start,30);assert.equal(p.checks[0].debt[0],20000);assert.equal(p.checks[0].save[0],5000);assert.equal(p.checks[0].balances[0],480000);assert.equal(p.checks[1].save[0],10000);assert.ok(p.checks[1].balances[0]<480000);
 s.checkEdits['2026-10-05'].debt.debt=0;assert.equal(forecast(s,start,30).checks[0].debt[0],0);
});
test('one-time expenses are reserved once on their own check and never the preceding check',()=>{
 const s=setup();s.checkEdits={'2026-10-19':{expenses:[{id:'repair',name:'Repair',amount:30000}]}};const p=forecast(validate(s),start,45);
 assert.equal(p.checks[0].reserve,0);assert.equal(p.checks[1].reserve,30000);assert.equal(p.rows.filter(r=>r.type==='expense').length,1);assert.equal(p.rows.find(r=>r.type==='expense').amount,-30000);
});
test('edited debt payments cannot overpay balances or consume protected cash',()=>{
 const s=setup();s.debts=[{id:'d',name:'Debt',balance:1000000,minimum:0,apr:0,date:'2026-10-25'}];s.checkEdits={'2026-10-05':{debt:{d:99999999}}};const p=forecast(validate(s),start,30);assert.equal(p.checks[0].left,25000);assert.ok(p.checks[0].capped);assert.ok(p.checks[0].balances[0]>=0);
});
test('invalid paycheck override payloads are rejected and legacy plans still validate',()=>{
 const s=setup();assert.doesNotThrow(()=>validate(s));s.checkEdits={'2026-10-05':{income:-1}};assert.throws(()=>validate(s));s.checkEdits={'2026-02-30':{income:10}};assert.throws(()=>validate(s));s.checkEdits={'2026-10-05':{expenses:[{id:'x',name:'Test',amount:1.5}]}};assert.throws(()=>validate(s));
});
test('per-paycheck budgets are allocated after their own deposit and editable on that check',()=>{
 const s=setup();s.accounts[0].balance=0;s.bills=[{id:'food',name:'Food',amount:10000,date:'2026-10-05',repeat:'biweekly',source:'budget'}];s.checkEdits={'2026-10-05':{bills:{'food:2026-10-05':12000}}};const p=forecast(validate(s),start,30);
 assert.equal(p.firstShortfall,null);assert.equal(p.checks[0].reserve,12000);assert.equal(p.checks[0].obligations[0].id,'food:2026-10-05');assert.equal(p.checks[1].reserve,10000);assert.equal(p.rows.find(r=>r.id==='food:2026-10-05').amount,-12000);
});
