import test from 'node:test';import assert from 'node:assert/strict';
import {blank,forecast,validate} from '../public/engine.mjs';
import {importBabyBear,babyBearDebts} from '../baby-bear.mjs';
test('Baby Bear preset preserves source cents and biweekly payments',()=>{
 const s=blank();assert.deepEqual(importBabyBear(s,'2026-11-01'),{added:8,skipped:0});assert.equal(s.debts.reduce((n,d)=>n+d.balance,0),475300);
 assert.equal(babyBearDebts.find(d=>d.name==='Credit One').minimum,335);
 const rows=forecast(s,'2026-11-01',29).rows.filter(r=>r.type==='minimum'&&r.name==='Elga Credit');assert.deepEqual(rows.map(r=>r.date),['2026-11-01','2026-11-15','2026-11-29']);assert.ok(rows.every(r=>r.amount===-4100));
});
test('invalid first payment dates and unsupported payment schedules are rejected',()=>{
 const s=blank();assert.throws(()=>importBabyBear(s,'2026-02-30'));assert.equal(s.debts.length,0);importBabyBear(s,'2026-11-01');s.debts[0].minimumRepeat='daily';assert.throws(()=>validate(s),/schedule/);
});
