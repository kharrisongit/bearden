import test from 'node:test';import assert from 'node:assert/strict';
import {incomeFromTracker,incomeFromPlan} from '../income-preset.mjs';
test('private income snapshot accepts pay-only setup, never includes accounts, and rejects missing pay',()=>{
 assert.equal(incomeFromTracker({values:{'app-state':'{}'}}),null);
 const preset=incomeFromTracker({values:{'app-state':JSON.stringify({takeHome:'1500',cards:[{name:'Debt'}],budgetItems:[{label:'Rent'}]})}});
 assert.deepEqual(preset,{hourlyRate:0,hoursPerCheck:0,amount:150000,estimated:false,repeat:'biweekly'});
 assert.equal(incomeFromTracker({values:{'app-state':'not json'}}),null);
});
test('legacy private income can seed the shortcut without importing any debt or budget',()=>{
 const preset=incomeFromPlan({income:[{amount:75000,repeat:'weekly',hourlyRate:24,hoursPerCheck:80}],debts:[{name:'Debt'}]});assert.equal(preset.amount,150000);assert.equal(preset.debts,undefined);assert.equal(incomeFromPlan({income:[]}),null);
});
