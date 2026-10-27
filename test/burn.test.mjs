import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as payments from '../public/debt-payments.mjs';

const source=readFileSync('public/classic.js','utf8');
const calculate=source.slice(source.indexOf('function calculate('),source.indexOf('\nfunction fmtDate('));
const edits=source.slice(source.indexOf('function payoffActionPayment('),source.indexOf('// ---- One-time unexpected expenses'));
const plain=value=>JSON.parse(JSON.stringify(value));
function plan({income=1000,cards=[{id:1,name:'Small',balance:1000,apr:0,min:50},{id:2,name:'Large',balance:5000,apr:26,min:100}],bills=[],window:windowOptions={},...options}={}){
 const fields={takeHome:{value:String(income)},startDate:{value:'2026-11-06'}};
 const ctx=vm.createContext({window:{BearDenDebtPayments:payments,dispatchEvent(){},syncedDebtBalances:{},accountBillsForPaycheck:()=>bills,...windowOptions},document:{getElementById:id=>fields[id]||null},Event,
  cardsData:structuredClone(cards),paycheckSlices:{},paycheckSquashes:{},budgetItems:[],currentPayoffMethod:'burn',savingsGoals:[],paycheckOverrides:{},appliedBonuses:{},checkedPaychecks:{},budgetItemOverrides:{},savingsContributionOverrides:{},extraExpenses:{},extraExpenseIdCounter:0,accountPaymentOverrides:{},queueSaveAppState(){},...options});
 ctx.renderResults=(cards,schedule,interest,savings,goals,date,paycheck,budget,comparison)=>{ctx.lastCardsForSpending=cards;ctx.lastSchedule=schedule;ctx.result={cards,schedule,interest,date,comparison};};
 vm.runInContext(calculate+'\n'+edits+'\ncalculate()',ctx);return ctx;
}
const card=balance=>({id:1,name:'Small',balance,apr:0,min:0});

test('Burn reserves bills, budget, savings, expenses and every minimum before halving spare income',()=>{
 const p=plan({income:2000,appliedBonuses:{1:200},bills:[{id:'car',amount:50000}],budgetItems:[{id:1,label:'Budget',amount:400}],savingsGoals:[{id:1,name:'Savings',goal:1000,start:0,contribution:100}],extraExpenses:{1:[{id:1,amount:50}]}});
 const row=p.result.schedule[0];
 assert.deepEqual(plain(row.payments),[550,100]);assert.equal(row.cashAfterDebt,500);
 assert.deepEqual(plain(row.naturalPayments),[550,100]);assert.equal(row.savingsByGoal[0].contribution,100);
 assert.equal(row.accountBillsThisCheck[0].amount,50000);assert.ok(p.result.date);
});

test('Burn uses paycheck income, budget and savings overrides when calculating its half',()=>{
 const p=plan({paycheckOverrides:{1:1200},appliedBonuses:{1:200},bills:[{amount:10000}],budgetItems:[{id:1,label:'Budget',amount:200}],budgetItemOverrides:{1:{1:300}},savingsGoals:[{id:1,name:'Savings',goal:1000,start:0,contribution:100}],savingsContributionOverrides:{1:{1:150}},extraExpenses:{1:[{id:1,amount:50}]}});
 assert.deepEqual(plain(p.result.schedule[0].payments),[375,100]);assert.equal(p.result.schedule[0].cashAfterDebt,325);
});

test('Burn clears a $10 remainder, leaves $10.01, and never borrows from reserved costs to finish',()=>{
 for(const [balance,income,payment,left]of [[110,200,110,90],[110.01,200,100,100],[10,10,10,0],[10,9,4.5,4.5],[10,0,0,0]]){
  const row=plan({cards:[card(balance)],income}).result.schedule[0];
  assert.equal(row.payments[0],payment);assert.equal(row.cashAfterDebt,left);
 }
 const row=plan({cards:[card(10),{...card(500),id:2,min:95}],income:100}).result.schedule[0];
 assert.deepEqual(plain(row.payments),[2.5,95]);assert.equal(row.cashAfterDebt,2.5);
});

test('unused Burn allocation moves to the next smallest debt without halving spare cash again',()=>{
 const p=plan({cards:[card(200),{...card(1000),id:2}]});
 assert.deepEqual(plain(p.result.schedule[0].payments),[200,300]);assert.equal(p.result.schedule[0].cashAfterDebt,500);
 const finish=plan({cards:[card(510),{...card(2000),id:2}]}).result.schedule[0];
 assert.deepEqual(plain(finish.payments),[510,0]);assert.equal(finish.cashAfterDebt,490);
});

test('Burn can target a small debt between due dates while reserving other required monthly minimums',()=>{
 const p=plan({cards:[{...card(1000),monthlyMinimum:50,dueDate:'2026-11-30'},{...card(5000),id:2,monthlyMinimum:100,dueDate:'2026-11-15'}],window:{debtPaymentSettings:{mode:'due-date',leadDays:3}}});
 const row=p.result.schedule[0];assert.deepEqual(plain(row.minimumPayments),[0,100]);
 assert.deepEqual(plain(row.payments),[450,100]);assert.deepEqual(plain(row.naturalPayments),[450,100]);assert.equal(row.cashAfterDebt,450);
});

test('Burn honors fixed payment edits and keeps checked payment and interest history intact',()=>{
 const p=plan({accountPaymentOverrides:{2:{1:300}},checkedPaychecks:{2:true},window:{debtPaymentHistory:{2:{1:17,2:80}},debtInterestHistory:{2:{1:3,2:7}}}});
 assert.deepEqual(plain(p.result.schedule[0].payments),[375,300]);assert.equal(p.result.schedule[0].cashAfterDebt,325);
 assert.deepEqual(plain(p.result.schedule[1].payments),[17,80]);assert.deepEqual(plain(p.result.schedule[1].interestByAccount),[3,7]);
});

test('repeated manual payment reductions retain the true Burn baseline without accumulating expenses',()=>{
 const p=plan();assert.equal(p.result.schedule[0].naturalPayments[0],475);
 vm.runInContext('updateAccountPayment(1,1,200,result.schedule[0].naturalPayments[0])',p);
 assert.equal(p.result.schedule[0].payments[0],200);assert.equal(p.result.schedule[0].naturalPayments[0],475);assert.equal(p.extraExpenses[1][0].amount,275);
 vm.runInContext('updateAccountPayment(1,1,175,result.schedule[0].naturalPayments[0])',p);
 assert.equal(p.result.schedule[0].payments[0],175);assert.equal(p.result.schedule[0].naturalPayments[0],475);assert.equal(p.extraExpenses[1][0].amount,300);assert.equal(p.extraExpenses[1].length,1);
});

test('Burn rounds its half down to cents and leaves required-payment shortfalls visible',()=>{
 const odd=plan({cards:[card(1000)],income:100.01}).result.schedule[0];assert.equal(odd.payments[0],50);assert.equal(Math.round(odd.cashAfterDebt*100),5001);
 const short=plan({income:120}).result.schedule[0];assert.deepEqual(plain(short.payments),[50,100]);assert.equal(short.cashAfterDebt,-30);
 const interest=plan({cards:[{...card(110),apr:26}],income:200}).result.schedule[0];assert.equal(interest.payments[0],100);assert.ok(interest.balancesAfter[0]>10);
});

test('explicit Slice and Squash take priority over Burn and keep an interest comparison',()=>{
 for(const [action,expected]of [['paycheckSlices',500],['paycheckSquashes',1000]]){
  const p=plan({income:1500,[action]:{1:{1:true}}});assert.deepEqual(plain(p.result.schedule[0].payments),[expected,100]);assert.ok(p.result.comparison);
 }
});
