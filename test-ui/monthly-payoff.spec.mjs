import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

async function setup(page,{saved=null}={}){
 const f=await fixture(page,{empty:true,goals:false,ownStart:'2026-10-02'});
 const state=JSON.parse(f.tracker.state.values['app-state']);
 Object.assign(state,{
  cards:[
   {id:1,name:'Small example debt',balance:110,apr:0,min:5,monthlyMinimum:10,dueDate:'2026-11-15'},
   {id:2,name:'Large example debt',balance:940,apr:0,min:20,monthlyMinimum:40,dueDate:'2026-11-20'}
  ],cardIdCounter:2,budgetItems:[],payoffMethod:'minimum',
  checkedPaychecks:{1:true},debtPaymentHistory:{1:{1:10,2:40}},
  debtInterestHistory:{1:{1:0,2:0}},debtFeeHistory:{1:{1:0,2:0}},
  monthlyPayoffPlan:saved
 });
 f.tracker.state.values['app-state']=JSON.stringify(state);
 await page.reload();await page.evaluate(()=>window.classicReady);
 await menuGo(page,'debts');
 await expect(page.locator('#monthlyPayoffPlanner')).toBeVisible();
 return f;
}

function records(plan){
 return Object.fromEntries(['cards','checkedPaychecks','debtPaymentHistory','debtInterestHistory','debtFeeHistory','payoffMethod','accountPaymentOverrides']
  .map(key=>[key,plan.state[key]]));
}

for(const width of [320,430])test(`${width}px: monthly budget covers minimums, rolls payments, and saves without changing debt history`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const f=await setup(page),before=await page.evaluate(()=>window.getDebtPlan());
 await page.locator('#monthlyPayoffMethod').selectOption('snowball');
 await page.locator('#monthlyPayoffBudget').fill('200');
 await expect(page.locator('#monthlyPayoffDuration')).toHaveText('5 months to pay off');
 await expect(page.locator('#monthlyPayoffInterest')).toHaveText('$0.00');
 await expect(page.locator('#monthlyPayoffTotal')).toHaveText('$1,000.00');
 const first=page.locator('[data-monthly-payoff-debt="1"]'),second=page.locator('[data-monthly-payoff-debt="2"]');
 await expect(first.locator('.monthly-payoff-payment-heading > strong')).toHaveText('$100.00');
 await expect(first).toContainText('Paid off this month');
 await expect(second.locator('.monthly-payoff-payment-heading > strong')).toHaveText('$100.00');
 await page.locator('#monthlyPayoffNext').click();
 await expect(first).toHaveCount(0);
 await expect(second.locator('.monthly-payoff-payment-heading > strong')).toHaveText('$200.00');
 await page.locator('#monthlyPayoffBudget').fill('25');
 await expect(page.locator('#monthlyPayoffNotice')).toContainText('$25.00 short');
 await expect(page.locator('#monthlyPayoffInterest')).toHaveText('—');
 await expect(page.locator('#monthlyPayoffDate')).toHaveText('Not yet available');
 await page.locator('#monthlyPayoffBudget').fill('200');
 await page.locator('#saveMonthlyPayoff').click();
 await expect(page.locator('#monthlyPayoffSaveStatus')).toHaveText('Monthly plan saved');
 expect(JSON.parse(f.tracker.state.values['app-state']).monthlyPayoffPlan).toEqual({monthlyBudget:200,method:'snowball'});
 expect(records(await page.evaluate(()=>window.getDebtPlan()))).toEqual(records(before));
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'debts');
 await expect(page.locator('#monthlyPayoffBudget')).toHaveValue('200');
 await expect(page.locator('#monthlyPayoffMethod')).toHaveValue('snowball');
 await expect(page.locator('#monthlyPayoffDuration')).toHaveText('5 months to pay off');
 expect(records(await page.evaluate(()=>window.getDebtPlan()))).toEqual(records(before));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('failed save keeps the draft and previous preference; refreshed balances update its estimate',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const f=await setup(page,{saved:{monthlyBudget:200,method:'snowball'}});
 await page.locator('#monthlyPayoffBudget').fill('300');
 await expect(page.locator('#monthlyPayoffDuration')).toHaveText('4 months to pay off');
 await page.route('**/api/classic',async route=>route.request().method()==='POST'
  ?route.fulfill({status:500,json:{error:'Could not save monthly plan.'}}):route.fallback());
 await page.locator('#saveMonthlyPayoff').click();
 await expect(page.locator('#monthlyPayoffSaveStatus')).toContainText('Could not save monthly plan');
 await expect(page.locator('#monthlyPayoffBudget')).toHaveValue('300');
 expect((await page.evaluate(()=>window.getDebtPlan())).state.monthlyPayoffPlan).toEqual({monthlyBudget:200,method:'snowball'});
 expect(JSON.parse(f.tracker.state.values['app-state']).monthlyPayoffPlan).toEqual({monthlyBudget:200,method:'snowball'});
 await page.evaluate(()=>{
  const original=window.getDebtPlan;
  window.getDebtPlan=()=>({...original(),syncedDebtBalances:{1:{balance:10000,date:'2026-10-28'},2:{balance:50000,date:'2026-10-28'}}});
  window.dispatchEvent(new Event('bearden-plan-changed'));
 });
 await expect(page.locator('#monthlyPayoffDuration')).toHaveText('2 months to pay off');
 await expect(page.locator('#monthlyPayoffTotal')).toHaveText('$600.00');
 await expect(page.locator('#monthlyPayoffBudget')).toHaveValue('300');
 await expect(page.locator('#monthlyPayoffSaveStatus')).toContainText('Could not save monthly plan');
 await page.evaluate(()=>{
  const original=window.getDebtPlan;
  window.getDebtPlan=()=>({...original(),syncedDebtBalances:{1:{balance:0,date:'2026-10-28'},2:{balance:0,date:'2026-10-28'}}});
  window.dispatchEvent(new Event('bearden-plan-changed'));
 });
 await expect(page.locator('#monthlyPayoffDate')).toHaveText('No debt remaining');
 await expect(page.locator('#monthlyPayoffSplit').locator('strong')).toHaveText(['$0.00','$0.00']);
});
