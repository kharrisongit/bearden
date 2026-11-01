import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as payments from '../public/debt-payments.mjs';
import * as interest from '../public/debt-interest.mjs';
import {trackerDebtStatus,trackerDebtForecast} from '../public/income-model.mjs';

const source=readFileSync('public/classic.js','utf8');
const calculation=source.slice(source.indexOf('function calculate('),source.indexOf('\nfunction fmtDate('));
function project({card={},snapshots={},checked={},paymentHistory={},interestHistory={},feeHistory={},terms={}}={}){
 const saved={id:1,name:'Example loan',balance:1000,apr:36.5,min:100,interestRules:{profileId:'daily-simple',balanceBasis:'principal'},...card};
 const fields={takeHome:{value:'1000'},startDate:{value:'2026-11-06'}};
 const ctx=vm.createContext({window:{BearDenDebtPayments:payments,BearDenDebtInterest:interest,debtPaymentSettings:{mode:'every-paycheck'},debtPaymentHistory:paymentHistory,debtInterestHistory:interestHistory,debtFeeHistory:feeHistory,syncedDebtTerms:terms,syncedDebtBalances:structuredClone(snapshots),dispatchEvent(){}},document:{getElementById:id=>fields[id]||null},Event,cardsData:[structuredClone(saved)],paycheckSlices:{},paycheckSquashes:{},budgetItems:[],currentPayoffMethod:'minimum',savingsGoals:[],paycheckOverrides:{},appliedBonuses:{},checkedPaychecks:checked,budgetItemOverrides:{},savingsContributionOverrides:{},extraExpenses:{},accountPaymentOverrides:{},queueSaveAppState(){}});
 ctx.renderResults=(cards,schedule,totalInterest)=>ctx.result={cards,schedule,totalInterest};
 vm.runInContext(calculation+'\ncalculate()',ctx);
 return {result:ctx.result,saved:ctx.cardsData[0],synced:ctx.window.syncedDebtBalances};
}

test('live forecast accrues actual days from the balance date without a first-payday charge',()=>{
 const {result,saved}=project();
 assert.equal(result.schedule[0].interestByAccount[0],0);
 assert.equal(result.schedule[0].balancesAfter[0],900);
 assert.ok(Math.abs(result.schedule[1].interestByAccount[0]-12.6)<1e-9);
 assert.equal(saved.balance,1000);
});

test('a refreshed balance accrues only from its snapshot date and is never overwritten',()=>{
 const snapshots={1:{balance:80000,date:'2026-11-01'}};
 const {result,saved,synced}=project({snapshots});
 assert.ok(Math.abs(result.schedule[0].interestByAccount[0]-4)<1e-9);
 assert.ok(Math.abs(result.schedule[0].balancesAfter[0]-704)<1e-9);
 assert.equal(saved.balance,1000);
 assert.deepEqual(JSON.parse(JSON.stringify(synced)),snapshots);
});

test('completed payment, interest and fee history keep their exact recorded math',()=>{
 const {result}=project({checked:{1:true},paymentHistory:{1:{1:50}},interestHistory:{1:{1:10}},feeHistory:{1:{1:2}}});
 assert.equal(result.schedule[0].interestByAccount[0],10);
 assert.equal(result.schedule[0].feesByAccount[0],2);
 assert.equal(result.schedule[0].payments[0],50);
 assert.equal(result.schedule[0].balancesAfter[0],962);
 assert.ok(Math.abs(result.schedule[1].interestByAccount[0]-962*.001*14)<1e-9);
});

test('a formula minimum stays stable across paydays and funds the full statement cycle',()=>{
 const {result}=project({card:{apr:0,monthlyMinimum:30,min:13.85,dueDate:'2026-11-26',interestRules:{profileId:'credit-one',closingDay:1},minimumRules:{profileId:'credit-one'}}});
 assert.equal(result.schedule[0].payments[0],25);
 assert.equal(result.schedule[1].payments[0],25);
 assert.equal(result.schedule[0].debtTiming[0].dueDate,'2026-11-26');
 assert.equal(result.schedule[1].debtTiming[0].dueDate,'2026-11-26');
});

test('enabling monthly allocation mid-cycle credits a completed partial payment',()=>{
 const {result}=project({card:{apr:0,monthlyMinimum:50,min:23.08,dueDate:'2026-11-26',interestRules:{profileId:'credit-one'},minimumRules:{profileId:'saved'}},checked:{1:true},paymentHistory:{1:{1:20}},interestHistory:{1:{1:0}}});
 assert.equal(result.schedule[0].payments[0],20);
 assert.equal(result.schedule[1].payments[0],30);
});

test('a same-day completed payment is not deducted twice from a refreshed remaining minimum',()=>{
 const {result}=project({card:{apr:0,monthlyMinimum:50,min:23.08,dueDate:'2026-11-26',interestRules:{profileId:'credit-one'},minimumRules:{profileId:'saved'}},checked:{1:true},paymentHistory:{1:{1:20}},interestHistory:{1:{1:0}},terms:{1:{date:'2026-11-06',monthlyMinimum:30,currentCycleMinimum:true,currentCycleThrough:'2026-11-26',dueDate:'2026-11-26'}}});
 assert.equal(result.schedule[0].payments[0],20);
 assert.equal(result.schedule[1].payments[0],30);
});

test('scheduled fees are distinct from interest and included in payoff balances',()=>{
 const {result}=project({card:{apr:0,balance:150,min:100,interestRules:{profileId:'daily-simple',fixedFees:[{date:'2026-11-15',amount:8,repeat:'once'}]}}});
 assert.equal(result.schedule[1].interestByAccount[0],0);
 assert.equal(result.schedule[1].feesByAccount[0],8);
 assert.equal(result.schedule[1].payments[0],58);
 assert.equal(result.schedule[1].balancesAfter[0],0);
});

test('an unidentified Affirm balance does not acquire a second layer of interest',()=>{
 const {result,saved}=project({card:{interestRules:{profileId:'affirm',balanceBasis:'unknown'}}});
 assert.equal(result.totalInterest,0);
 assert.ok(result.schedule[1].interestNotes[0].some(note=>note.includes('Confirm whether')));
 assert.equal(saved.balance,1000);
});

test('account summaries retain checked fees and show unknown loan interest as unavailable',()=>{
 const plan={state:{cards:[{id:1,balance:100,interestRules:{profileId:'affirm',balanceBasis:'unknown'}}],checkedPaychecks:{1:true}},schedule:[{paycheck:1,date:'2026-11-06',payments:[20],interestByAccount:[3],feesByAccount:[2],balancesAfter:[85]},{paycheck:2,date:'2026-11-20',payments:[85],interestByAccount:[0],feesByAccount:[0],balancesAfter:[0]}]};
 assert.equal(trackerDebtStatus(plan,1).balance,8500);
 assert.deepEqual(trackerDebtForecast(plan,1),{date:null,interest:null,reason:'Loan balance type needed'});
});
