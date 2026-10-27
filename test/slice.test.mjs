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
const reset=source.slice(source.indexOf('function resetCheckedPaychecks('),source.indexOf('\nfunction buildSavingsGoalHeroHTML('));

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

for(const animated of [false,true])test(`reset returns the entire paycheck simulation to the saved plan (${animated?'animated':'immediate'})`,()=>{
 const base={budgetItems:[{id:1,label:'Food',amount:100}],savingsGoals:[{id:1,name:'Goal',goal:5000,start:50,contribution:25,withdrawalHistory:[]}]};
 const p=plan({...structuredClone(base),checkedPaychecks:{1:true,3:true},paycheckSlices:{1:{1:true},3:{2:true},100:{1:true}},paycheckSquashes:{1:{1:true},2:{2:true},101:{2:true}},paycheckOverrides:{1:1500},savingsContributionOverrides:{1:{2:5}},budgetItemOverrides:{1:{2:200}},accountPaymentOverrides:{1:{3:100}},appliedBonuses:{2:500},extraExpenses:{2:[{id:7,label:'Repair',amount:75},{id:8,amount:20,autoFromCardId:1}]},extraExpenseIdCounter:8,bonusInputOpenForPaycheck:2,extraExpenseInputOpenForPaycheck:2});
 p.window.debtPaymentHistory={1:{1:1000}};p.window.debtInterestHistory={1:{1:10}};
 const expected=plan(structuredClone(base)),savedPlan=values({cards:p.cardsData,budget:p.budgetItems,goals:p.savingsGoals,method:p.currentPayoffMethod});
 const cleared=['checkedPaychecks','paycheckSlices','paycheckSquashes','paycheckOverrides','savingsContributionOverrides','budgetItemOverrides','accountPaymentOverrides','appliedBonuses','extraExpenses'];
 const timers=[];let saved,clearCalled=false;
 p.confirm=()=>true;p.saveDebounceTimer=123;p.clearTimeout=()=>{clearCalled=true;};p.setTimeout=fn=>timers.push(fn);
 p.performSaveAppState=()=>{saved=Object.fromEntries(cleared.map(key=>[key,values(p[key])]));};
 const getElement=p.document.getElementById;
 p.document.getElementById=id=>id==='schedulePlanSection'&&animated?{classList:{remove(){},add(){}},offsetHeight:0}:getElement(id);
 vm.runInContext(reset+'\nresetCheckedPaychecks()',p);
 assert.ok(clearCalled);assert.deepEqual(saved,Object.fromEntries(cleared.map(key=>[key,{}]))); // saved before delayed rendering
 for(const timer of timers)timer();
 assert.deepEqual(values(p.result.schedule),values(expected.result.schedule));assert.equal(p.result.comparison,null);
 assert.deepEqual(values({cards:p.cardsData,budget:p.budgetItems,goals:p.savingsGoals,method:p.currentPayoffMethod}),savedPlan);
 assert.deepEqual(values(p.window.debtPaymentHistory),{});assert.deepEqual(values(p.window.debtInterestHistory),{});
 assert.equal(p.extraExpenseIdCounter,0);assert.equal(p.bonusInputOpenForPaycheck,null);assert.equal(p.extraExpenseInputOpenForPaycheck,null);
});

test('canceling the simulation reset preserves every saved choice and does not save',()=>{
 const p=plan({checkedPaychecks:{1:true},paycheckSlices:{1:{1:true}},paycheckSquashes:{2:{2:true}},paycheckOverrides:{1:1500},extraExpenses:{1:[{id:1,amount:25}]}});
 const before=values({checks:p.checkedPaychecks,slices:p.paycheckSlices,squashes:p.paycheckSquashes,overrides:p.paycheckOverrides,expenses:p.extraExpenses,schedule:p.result.schedule});
 p.confirm=()=>false;p.performSaveAppState=()=>assert.fail('Canceled reset must not save');
 vm.runInContext(reset+'\nresetCheckedPaychecks()',p);
 assert.deepEqual(values({checks:p.checkedPaychecks,slices:p.paycheckSlices,squashes:p.paycheckSquashes,overrides:p.paycheckOverrides,expenses:p.extraExpenses,schedule:p.result.schedule}),before);
});
