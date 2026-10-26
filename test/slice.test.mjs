import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as payments from '../public/debt-payments.mjs';
const source=readFileSync('public/classic.js','utf8');
const calculate=source.slice(source.indexOf('function calculate('),source.indexOf('\nfunction fmtDate('));
const toggle=source.slice(source.indexOf('function payoffActionPayment('),source.indexOf('function updateAccountPayment('));
function plan(options={}){
 const fields={takeHome:{value:'1000'},startDate:{value:'2026-10-26'}};
 const ctx=vm.createContext({window:{BearDenDebtPayments:payments,dispatchEvent(){},syncedDebtBalances:{}},document:{getElementById:id=>fields[id]||null},Event,
 cardsData:[{id:1,name:'A',balance:1000,apr:26,min:20},{id:2,name:'B',balance:500,apr:26,min:30}],paycheckSlices:{},paycheckSquashes:{},budgetItems:[],currentPayoffMethod:'minimum',savingsGoals:[],paycheckOverrides:{},appliedBonuses:{},checkedPaychecks:{},budgetItemOverrides:{},savingsContributionOverrides:{},extraExpenses:{},accountPaymentOverrides:{},queueSaveAppState(){},...options});
 ctx.renderResults=(cards,schedule,interest,savings,goals,date,paycheck,budget,comparison)=>{ctx.lastCardsForSpending=cards;ctx.lastSchedule=schedule;ctx.result={cards,schedule,interest,date,comparison};};
 vm.runInContext(calculate+'\n'+toggle,ctx);vm.runInContext('calculate()',ctx);return ctx;
}
const values=xs=>JSON.parse(JSON.stringify(xs));

test('Minimums leaves unused income available; Slice is half at each selected paycheck',()=>{
 const p=plan();assert.deepEqual(values(p.result.schedule[0].payments),[20,30]);assert.equal(p.result.schedule[0].cashAfterDebt,950);
 vm.runInContext('togglePaycheckSlice(1,1)',p);
 assert.deepEqual(values(p.result.schedule[0].payments),[500,30]);assert.equal(p.result.schedule[0].cashAfterDebt,470);
 vm.runInContext('togglePaycheckSlice(1,2)',p);
 assert.equal(p.result.schedule[1].payments[0],255); // $510 carried from the previous check.
 assert.ok(p.result.comparison.difference>0);
 vm.runInContext('togglePaycheckSlice(1,1)',p);
 assert.equal(p.result.schedule[0].payments[0],20);assert.equal(p.result.schedule[1].payments[0],495);
});

test('multiple Slice selections preserve manual payment edits and restore them on Undo',()=>{
 const p=plan({currentPayoffMethod:'avalanche',accountPaymentOverrides:{2:{1:45}},extraExpenses:{1:[{id:1,amount:10,autoFromCardId:2,label:'Reduced payment'},{id:2,amount:25,label:'Repair'}]}});
 const before=values(p.result.schedule[0].payments);
 vm.runInContext('togglePaycheckSlice(1,1);togglePaycheckSlice(2,1)',p);
 assert.deepEqual(values(p.result.schedule[0].payments),[500,250]);assert.equal(p.result.schedule[0].cashAfterDebt,225);
 assert.equal(p.extraExpenses[1].length,2);assert.equal(p.accountPaymentOverrides[2][1],45);
 vm.runInContext('togglePaycheckSlice(1,1);togglePaycheckSlice(2,1)',p);
 assert.deepEqual(values(p.result.schedule[0].payments),before);assert.deepEqual(values(p.paycheckSlices),{});
});

test('unaffordable saved actions pause without hiding a shortfall in required minimums',()=>{
 const p=plan({cardsData:[{id:1,name:'Small',balance:50,apr:0,min:35},{id:2,name:'Nearly paid',balance:10,apr:0,min:35}],paycheckSlices:{1:{1:true,2:true}},paycheckOverrides:{1:30}});
 assert.deepEqual(values(p.result.schedule[0].payments),[35,10]);assert.equal(p.result.schedule[0].cashAfterDebt,-15);
 assert.deepEqual(values(p.result.schedule[0].balancesAfter),[15,0]);assert.equal(p.result.schedule[0].payoffActionsPaused,true);
});

test('Slice uses a refreshed balance on future rows while preserving earlier checked payments',()=>{
 const p=plan({checkedPaychecks:{1:true},paycheckSlices:{2:{1:true}},window:{BearDenDebtPayments:payments,dispatchEvent(){},syncedDebtBalances:{1:{balance:60000,date:'2026-11-09'}}}});
 assert.equal(p.result.schedule[0].payments[0],20);assert.equal(p.result.schedule[0].balancesAfter[0],990);
 assert.equal(p.result.schedule[1].balancesBefore[0],600);assert.equal(p.result.schedule[1].payments[0],300);
});

test('interest comparison can show Slice costs more than the full avalanche plan',()=>{
 const p=plan({currentPayoffMethod:'avalanche',paycheckSlices:{1:{1:true}}});
 assert.ok(p.result.comparison.difference<0);assert.equal(p.result.comparison.through,null);
 assert.equal(p.result.schedule[0].payments[1],30);
});


test('Squash pays the full balance and projected interest, leaves other debts at minimum, and can be undone',()=>{
 const p=plan();
 vm.runInContext('togglePaycheckSquash(2,1)',p);
 assert.deepEqual(values(p.result.schedule[0].payments),[20,505]);
 assert.equal(p.result.schedule[0].balancesAfter[1],0);
 assert.equal(p.result.schedule[0].cashAfterDebt,475);
 assert.equal(p.result.schedule[1].payments[1],0);
 assert.equal(p.result.comparison.actions,'Squash');
 vm.runInContext('togglePaycheckSquash(2,1)',p);
 assert.deepEqual(values(p.result.schedule[0].payments),[20,30]);
 assert.deepEqual(values(p.paycheckSquashes),{});
});

test('Squash and Slice coexist, restore prior Slice on undo, and use refreshed future balances',()=>{
 const p=plan({paycheckOverrides:{1:2000},paycheckSlices:{1:{1:true}},window:{BearDenDebtPayments:payments,dispatchEvent(){},syncedDebtBalances:{2:{balance:20000,date:'2026-10-26'}}}});
 vm.runInContext('togglePaycheckSquash(2,1)',p);
 assert.deepEqual(values(p.result.schedule[0].payments),[500,202]);
 assert.equal(p.result.comparison.actions,'Slice and Squash');
 vm.runInContext('togglePaycheckSquash(1,1)',p);
 assert.equal(p.result.schedule[0].payments[0],1010);
 assert.equal(p.result.schedule[0].cashAfterDebt,788);
 vm.runInContext('togglePaycheckSquash(1,1)',p);
 assert.equal(p.result.schedule[0].payments[0],500);
 vm.runInContext('togglePaycheckSquash(1,1);togglePaycheckSlice(1,1)',p);
 assert.equal(p.result.schedule[0].payments[0],500);
 assert.equal(p.paycheckSquashes[1][1],undefined);
});


test('Slice and Squash reserve budget, bills, savings, expenses, and already selected debt payments',()=>{
 const p=plan({budgetItems:[{id:1,label:'Budget',amount:200}],savingsGoals:[{id:1,name:'Savings',goal:10000,start:0,contribution:100}],extraExpenses:{1:[{id:1,amount:50}]},window:{BearDenDebtPayments:payments,dispatchEvent(){},syncedDebtBalances:{},accountBillsForPaycheck:()=>[{amount:25000}]}});
 assert.equal(p.result.schedule[0].payoffActionFunds,400);
 vm.runInContext('togglePaycheckSlice(1,1);togglePaycheckSquash(2,1)',p);
 assert.deepEqual(values(p.paycheckSlices),{});assert.deepEqual(values(p.paycheckSquashes),{});
 assert.equal(p.paycheckActionAllowance(p.result.schedule[0],0,'slice').shortfall,130);
 vm.runInContext('togglePaycheckSlice(2,1)',p);
 assert.deepEqual(values(p.result.schedule[0].payments),[20,250]);
 vm.runInContext('togglePaycheckSlice(1,1);togglePaycheckSquash(2,1)',p);
 assert.deepEqual(values(p.paycheckSlices),{'1':{'2':true}});assert.deepEqual(values(p.paycheckSquashes),{});
 assert.deepEqual(values(p.result.schedule[0].payments),[20,250]);
});

test('full payoff reserves interest and other minimums, allowing exact funding but rejecting a one-cent shortfall',()=>{
 const p=plan({paycheckOverrides:{1:524.99}});
 vm.runInContext('togglePaycheckSquash(2,1)',p);
 assert.deepEqual(values(p.paycheckSquashes),{});
 assert.equal(p.paycheckActionAllowance(p.result.schedule[0],1,'squash').shortfall,.01);
 p.paycheckOverrides[1]=525;vm.runInContext('calculate();togglePaycheckSquash(2,1)',p);
 assert.deepEqual(values(p.result.schedule[0].payments),[20,505]);assert.equal(p.result.schedule[0].cashAfterDebt,0);
});

test('future choices pause after a budget cut, resume when funded, and can always be undone; checked history stays intact',()=>{
 const p=plan({paycheckSlices:{1:{1:true}}});
 p.paycheckOverrides[1]=400;vm.runInContext('calculate()',p);
 assert.equal(p.result.schedule[0].payoffActionsPaused,true);assert.deepEqual(values(p.result.schedule[0].payments),[20,30]);assert.equal(p.paycheckSlices[1][1],true);
 assert.equal(p.result.comparison,null);
 p.paycheckOverrides[1]=530;vm.runInContext('calculate()',p);
 assert.equal(p.result.schedule[0].payoffActionsPaused,false);assert.deepEqual(values(p.result.schedule[0].payments),[500,30]);
 p.paycheckOverrides[1]=400;p.checkedPaychecks[1]=true;vm.runInContext('calculate()',p);
 assert.equal(p.result.schedule[0].payments[0],500);assert.equal(p.result.schedule[0].payoffActionsPaused,false);
 p.checkedPaychecks={};vm.runInContext('calculate();togglePaycheckSlice(1,1)',p);
 assert.deepEqual(values(p.paycheckSlices),{});assert.equal(p.result.schedule[0].sliceMode,false);
});
