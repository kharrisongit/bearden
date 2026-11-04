import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

const deposit={transaction_id:'payroll',account_id:'personal',date:'2026-10-28',name:'Employer payroll',amount:-1923.47,currency:'USD',pending:false};
test('early payroll updates actual schedule, allocations and forecast without shifting future paydays',async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await fixture(page,{transactions:[deposit]});
 await expect(page.locator('#paycheck-card-1 .paycheck-received')).toContainText('$1,923.47');
 await expect(page.locator('#paycheck-card-1 .paycheck-income .amount-input')).toHaveValue('1923.47');
 let plan=await page.evaluate(()=>window.getDebtPlan());expect(plan.schedule[0].date).toBe('2026-10-30');expect(plan.schedule[1].date).toBe('2026-11-13');expect(plan.schedule[1].takeHomeThisCheck).toBe(1845);
 expect(plan.schedule[0].payments[0]).toBeCloseTo(843.47,2);
 await expect(page.locator('#paycheck-card-1 .bd-paycheck-status')).toHaveText('Received');
 await expect(page.locator('#paycheck-card-1 .bd-paycheck-title')).toContainText('Oct 28');
 await menuGo(page,'income');await expect(page.locator('#incomeSummary .income-next-payday')).toContainText('Nov 13');
 await expect(page.locator('#incomeForecast [data-forecast-date="2026-10-30"]').filter({hasText:'Paycheck 1'})).toContainText('already in bank balance');
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('#paycheck-card-1 .paycheck-income .amount-input')).toHaveValue('1923.47');
 await page.evaluate(()=>window.toggleChecked(1,true));
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().schedule[0].takeHomeThisCheck)).toBe(1923.47);
 await page.evaluate(()=>{window.toggleChecked(1,false);window.BearDen.plan.connections.transactions=[];window.dispatchEvent(new Event('bearden-connections'));});
 await expect(page.locator('#paycheck-card-1 .paycheck-income .amount-input')).toHaveValue('1845.00');
 expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('user can identify an uncategorized paycheck source once and change the amount on refresh',async({page})=>{
 const transactions=[{...deposit,name:'Employer direct deposit'}];const f=await fixture(page,{transactions});
 await expect(page.locator('#paycheck-card-1 .paycheck-income .amount-input')).toHaveValue('1845.00');
 await menuGo(page,'income');await page.locator('#incomeTransactionsToggleBtn').click();await page.locator('[data-match-paycheck="payroll"]').click();
 await expect(page.locator('#paycheck-card-1 .paycheck-income .amount-input')).toHaveValue('1923.47');
 expect(JSON.parse(f.tracker.state.values['income-planner']).paycheckLink.merchant).toBe('employer direct deposit');
 transactions[0].amount=-1999.23;await page.reload();await page.evaluate(()=>window.classicReady);
 await expect(page.locator('#paycheck-card-1 .paycheck-income .amount-input')).toHaveValue('1999.23');
});
