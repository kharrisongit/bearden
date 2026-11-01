import test from 'node:test';
import assert from 'node:assert/strict';
import {monthlyMinimum,monthlyPaymentSettings,scheduledPayment,monthlyPaycheckAllocation} from '../public/debt-payments.mjs';
import {migrateLegacy} from '../public/classic-migrate.mjs';
import {blank} from '../public/engine.mjs';

test('monthly editing preserves saved paycheck allocations and exact monthly cents across reloads',()=>{
 const old={min:25};
 assert.equal(monthlyMinimum(old),54.17);
 const confirmed={...old,...monthlyPaymentSettings(old,54.17)};
 assert.deepEqual(confirmed,{min:25,monthlyMinimum:54.17});
 const changed={...confirmed,...monthlyPaymentSettings(confirmed,35.01)};
 assert.equal(changed.min,16.16);
 const reloaded=JSON.parse(JSON.stringify(changed));
 assert.equal(monthlyMinimum(reloaded),35.01);
 assert.deepEqual(monthlyPaymentSettings(reloaded,35.01),{min:16.16,monthlyMinimum:35.01});
 assert.deepEqual(monthlyPaymentSettings(reloaded,0),{min:0,monthlyMinimum:0});
 assert.deepEqual(old,{min:25});
});

test('legacy monthly statements keep their exact due amount independently of rounded paycheck funding',()=>{
 const state=blank();state.debts=[{id:'card',name:'Card',balance:40000,apr:20,minimum:3501,minimumRepeat:'monthly'}];
 const card=migrateLegacy(state,'2026-10-26').cards[0];
 assert.equal(card.monthlyMinimum,35.01);assert.equal(card.min,16.16);
});

const profiled={id:1,balance:1000,apr:24,monthlyMinimum:100,min:46.15,dueDate:'2026-11-20',interestRules:{profileId:'generic'}};
test('profiled monthly payments fund the full two- or three-paycheck due cycle with exact final cents',()=>{
 const two=['2026-11-06','2026-11-20'].map(date=>scheduledPayment({...profiled,monthlyMinimum:35.01},date,'2026-11-06'));
 assert.deepEqual(two.map(row=>row.minimum),[17.50,17.51]);assert.ok(two.every(row=>row.dueDate==='2026-11-20'&&row.cyclePaychecks===2));
 const three=['2026-10-23','2026-11-06','2026-11-20'].map(date=>scheduledPayment(profiled,date,'2026-10-23'));
 assert.deepEqual(three.map(row=>row.minimum),[33.33,33.33,33.34]);assert.deepEqual(three.map(row=>row.cyclePaycheckIndex),[1,2,3]);
 assert.equal(three.reduce((sum,row)=>sum+Math.round(row.minimum*100),0),10000);
 assert.ok(three.every(row=>row.cycleStart==='2026-10-20'&&row.allocation==='monthly-split'&&row.monthlyMinimum===100));
});

test('a plan starting on the last eligible payday funds that cycle fully without counting earlier checks',()=>{
 const first=scheduledPayment(profiled,'2026-11-20','2026-11-20');
 assert.equal(first.minimum,100);assert.equal(first.cyclePaychecks,1);assert.equal(first.dueDate,'2026-11-20');
 const next=['2026-12-04','2026-12-18'].map(date=>scheduledPayment(profiled,date,'2026-11-20'));
 assert.deepEqual(next.map(row=>row.minimum),[50,50]);assert.ok(next.every(row=>row.dueDate==='2026-12-20'&&row.cycleStart==='2026-11-20'));
});

test('month-end due dates clamp independently and leap-day paydays belong to the ending cycle',()=>{
 const card={...profiled,monthlyMinimum:1,dueDate:'2028-01-31'};
 const rows=['2028-02-01','2028-02-15','2028-02-29'].map(date=>monthlyPaycheckAllocation(card,date,'2028-02-01'));
 assert.deepEqual(rows.map(row=>row.minimum),[.33,.33,.34]);assert.ok(rows.every(row=>row.dueDate==='2028-02-29'&&row.cycleStart==='2028-01-31'));
 const march=monthlyPaycheckAllocation(card,'2028-03-14','2028-02-01');
 assert.equal(march.dueDate,'2028-03-31');assert.equal(march.cycleStart,'2028-02-29');assert.equal(march.cyclePaychecks,2);
});

test('legacy fallback and due-date timing remain unchanged; zero due remains zero',()=>{
 const legacy={...profiled};delete legacy.interestRules;
 assert.equal(scheduledPayment(legacy,'2026-11-06','2026-10-23').minimum,46.15);
 assert.equal(scheduledPayment(legacy,'2026-11-06','2026-10-23').dueDate,null);
 assert.equal(scheduledPayment(profiled,'2026-11-06','2026-10-23',{mode:'due-date',leadDays:3}).minimum,100);
 assert.equal(scheduledPayment(profiled,'2026-11-20','2026-10-23',{mode:'due-date',leadDays:3}).minimum,0);
 assert.equal(scheduledPayment({...profiled,monthlyMinimum:0,min:0},'2026-11-06','2026-10-23').minimum,0);
 assert.equal(scheduledPayment({...profiled,dueDate:''},'2026-11-06','2026-10-23').missingDate,true);
});
