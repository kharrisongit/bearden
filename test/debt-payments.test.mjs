import test from 'node:test';
import assert from 'node:assert/strict';
import {monthlyMinimum,monthlyPaymentSettings} from '../public/debt-payments.mjs';
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
