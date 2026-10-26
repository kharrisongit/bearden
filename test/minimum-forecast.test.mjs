import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as payments from '../public/debt-payments.mjs';

const source=readFileSync('public/classic.js','utf8');
const calculation=source.slice(source.indexOf('function calculate('),source.indexOf('\nfunction fmtDate('));
const notice=source.slice(source.indexOf('function debtForecastNotice('),source.indexOf('\nfunction renderResults('));
function plan({cards=[{id:1,name:'Visa',balance:4125.31,apr:18,min:0}],timing={mode:'every-paycheck'},method='minimum',checked={},history={},terms={}}={}){
  const fields={takeHome:{value:'1000'},startDate:{value:'2026-11-06'}};
  const ctx=vm.createContext({window:{BearDenDebtPayments:payments,debtPaymentSettings:timing,debtPaymentHistory:history,syncedDebtTerms:terms,syncedDebtBalances:{},dispatchEvent(){}},document:{getElementById:id=>fields[id]||null},Event,cardsData:structuredClone(cards),paycheckSlices:{},paycheckSquashes:{},budgetItems:[],currentPayoffMethod:method,savingsGoals:[],paycheckOverrides:{},appliedBonuses:{},checkedPaychecks:checked,budgetItemOverrides:{},savingsContributionOverrides:{},extraExpenses:{},accountPaymentOverrides:{},queueSaveAppState(){}});
  ctx.renderResults=(cards,schedule,interest,savings,goals,date)=>ctx.result={cards,schedule,interest,date};
  vm.runInContext(calculation+'\n'+notice+'\ncalculate()',ctx);
  ctx.result.notice=vm.runInContext("debtForecastNotice(result.cards,result.schedule,result.date,checkedPaychecks,new Date('2026-10-26T00:00:00'))",ctx);
  return ctx.result;
}

test('zero minimum reproduces runaway capped interest and identifies the unpaid account',()=>{
  const p=plan();assert.equal(p.date,null);assert.equal(p.schedule.length,780);assert.ok(p.interest>800000);
  assert.match(p.notice,/No payments scheduled.*Visa/);assert.match(p.notice,/Total payoff interest is unavailable/);
  assert.equal(p.schedule[0].payments[0],0); // Reporting must not invent a payment.
});
test('payments below or equal to interest identify the debt that is not reducing',()=>{
  for(const min of [5,10]){
    const p=plan({cards:[{id:1,name:'Loan',balance:1000,apr:26,min}]});
    assert.equal(p.date,null);assert.match(p.notice,/Payments do not exceed projected interest.*Loan/);
  }
});
test('small but positive principal reduction is distinguished from a non-amortizing plan',()=>{
  const p=plan({cards:[{id:1,name:'Slow loan',balance:1000,apr:0,min:1}]});
  assert.equal(p.date,null);assert.match(p.notice,/end of the 30-year forecast/);assert.doesNotMatch(p.notice,/No payments|do not exceed/);
});
test('minimums that pay off retain their date and interest; due-date off weeks do not cause warnings',()=>{
  for(const timing of [{mode:'every-paycheck'},{mode:'due-date',leadDays:3}]){
    const p=plan({cards:[{id:1,name:'Visa',balance:1000,apr:18,min:46.15,monthlyMinimum:100,dueDate:'2026-11-15'}],timing});
    assert.ok(p.date);assert.ok(p.interest>0&&p.interest<200);assert.equal(p.notice,'');
  }
});
test('paid-off accounts are excluded and checked history is not mistaken for future payments',()=>{
  const p=plan({cards:[{id:1,name:'Paid off',balance:10,apr:0,min:10},{id:2,name:'Missing minimum',balance:1000,apr:26,min:0}],checked:{1:true},history:{1:{1:10,2:50}}});
  assert.doesNotMatch(p.notice,/Paid off/);assert.match(p.notice,/No payments scheduled.*Missing minimum/);assert.equal(p.schedule[0].payments[1],50);
});
test('synced minimum terms and extra-payment methods can resolve the warning',()=>{
  const terms={1:{date:'2026-11-06',monthlyMinimum:150,apr:18}};
  for(const p of [plan({terms}),plan({method:'avalanche'}),plan({method:'snowball'})]){
    assert.ok(p.date);assert.equal(p.notice,'');
  }
});
