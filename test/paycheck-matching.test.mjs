import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchPaychecks,paycheckOccurrence} from '../public/paycheck-matching.mjs';
import {paydayEvents,scenarioForecast} from '../public/income-model.mjs';

const state={startDate:'2026-11-06',takeHome:1800};
const deposit={transaction_id:'pay',account_id:'checking',date:'2026-11-04',name:'Employer payroll',amount:-1923.47,currency:'USD',pending:false};
const match=(transactions,extra={})=>matchPaychecks({state,transactions,accountId:'plaid-checking',today:'2026-11-04',...extra});
test('posted early payroll uses exact net and keeps the biweekly anchor',()=>{
 const result=match([deposit,deposit]);
 assert.equal(result[1].amount,192347);assert.equal(result[1].receivedDate,'2026-11-04');assert.equal(result[1].scheduledDate,'2026-11-06');
 assert.deepEqual(paycheckOccurrence(state.startDate,'2026-11-18'),{paycheck:2,scheduledDate:'2026-11-20'});
 assert.deepEqual(match([]),{});
});
test('ignores pending, wrong accounts, ambiguous, non-payroll, refunds, future and completed payments',()=>{
 for(const change of [{pending:true},{account_id:'bills'},{currency:'CAD'},{name:'Transfer from savings'},{name:'Payroll reversal'},{date:'2026-11-05'},{amount:1923.47},{date:'2026-10-31'}])assert.deepEqual(match([{...deposit,...change}]),{});
 assert.deepEqual(match([deposit,{...deposit,transaction_id:'other'}]),{});
 assert.deepEqual(match([deposit],{state:{...state,checkedPaychecks:{1:true}}}),{});
});
test('confirmed employer tolerates variable pay and explicit deposit resolves ambiguity',()=>{
 const t={...deposit,name:'Employer ACH',amount:-2150.09},link={accountId:'plaid-checking',merchant:'employer ach',assignments:{'2026-11-06':'pay'}};
 assert.equal(match([t,{...t,transaction_id:'other'}],{link})[1].amount,215009);
 assert.equal(match([{...t,date:'2026-11-18',transaction_id:'next',amount:-1874.31}],{link,today:'2026-11-18'})[2].amount,187431);
 assert.deepEqual(match([deposit],{link}),{});
 assert.deepEqual(match([{...t,account_id:'bills'}],{link}),{});
});
test('received pay is not added to synced balances again, while planned outflows remain',()=>{
 const receipt=match([deposit])[1];
 const plan={state,schedule:[{paycheck:1,date:'2026-11-06',takeHomeThisCheck:1923.47,bonusAmount:0,paycheckReceipt:receipt,budgetLineItemsThisCheck:[{label:'Fixed Bills',amount:750}],payments:[],savingsByGoal:[]}]};
 const upcoming=paydayEvents(plan,'2026-11-04','2026-11-30',{excludeReceived:true});assert.equal(upcoming[0].date,'2026-11-20');assert.equal(upcoming[0].amount,180000);
 const forecast=scenarioForecast([{id:'plaid-checking',include:true,balance:200000,currency:'USD'}],plan,[],'2026-11-04',{length:7});
 assert.equal(forecast.income,0);assert.equal(forecast.outgoing,75000);assert.equal(forecast.endBalance,125000);assert.equal(forecast.rows[0].receivedDate,'2026-11-04');
});
