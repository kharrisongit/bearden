import test from 'node:test';import assert from 'node:assert/strict';
import {blank,forecast,validate} from '../public/engine.mjs';
import {importBabyBear,babyBearDebts} from '../baby-bear.mjs';
test('Baby Bear preset preserves source cents and biweekly payments',()=>{
 const s=blank();assert.equal(importBabyBear(s,'2026-11-01').added,8);s.income=[];assert.equal(s.debts.reduce((n,d)=>n+d.balance,0),475300);
 assert.equal(babyBearDebts.find(d=>d.name==='Credit One').minimum,335);
 const rows=forecast(s,'2026-11-01',29).rows.filter(r=>r.type==='minimum'&&r.name==='Elga Credit');assert.deepEqual(rows.map(r=>r.date),['2026-11-01','2026-11-15','2026-11-29']);assert.ok(rows.every(r=>r.amount===-4100));
});
test('invalid first payment dates and unsupported payment schedules are rejected',()=>{
 const s=blank();assert.throws(()=>importBabyBear(s,'2026-02-30'));assert.equal(s.debts.length,0);importBabyBear(s,'2026-11-01');s.debts[0].minimumRepeat='daily';assert.throws(()=>validate(s),/schedule/);
});

test('full setup imports estimated net pay and all per-paycheck budget items only once',()=>{
 const s=blank(),r=importBabyBear(s,'2026-11-06');assert.equal(r.incomeAdded,1);assert.equal(r.budgetAdded,5);assert.equal(s.income[0].amount,183371);assert.equal(s.income[0].gross,230800);assert.equal(s.income[0].repeat,'biweekly');assert.equal(s.bills.reduce((n,b)=>n+b.amount,0),122500);assert.ok(s.bills.every(b=>b.repeat==='biweekly'&&b.date==='2026-11-06'));
 const again=importBabyBear(s,'2026-11-20');assert.equal(again.changed,false);assert.equal(s.income.length,1);assert.equal(s.bills.length,5);
});
test('previous debt-only imports can add income and budget without resetting debts',()=>{
 const s=blank();importBabyBear(s,'2026-11-06');s.income=[];s.bills=[];s.debts[0].balance=123;
 const r=importBabyBear(s,'2026-11-20',190000);assert.equal(r.added,0);assert.equal(r.incomeAdded,1);assert.equal(r.budgetAdded,5);assert.equal(r.changed,true);assert.equal(s.debts[0].balance,123);assert.equal(s.income[0].amount,190000);
});
test('existing income and matching budget entries are preserved',()=>{
 const s=blank();s.income=[{id:'pay',name:'My salary',amount:200000,date:'2026-11-06',repeat:'biweekly'}];s.bills=[{id:'food',name:'Food',amount:30000,date:'2026-11-06',repeat:'monthly'}];
 const r=importBabyBear(s,'2026-11-06');assert.equal(r.incomeAdded,0);assert.equal(r.budgetAdded,4);assert.equal(s.income[0].amount,200000);assert.equal(s.bills[0].amount,30000);
});
