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
 await expect(page.locator('#debtIncomeSummary .income-next-payday')).toContainText('Nov 13');
 await expect(page.locator('#denMenu [data-wallet-value="payday"]')).toContainText('Nov 13');
 await expect(page.locator('#scheduleOut .paycheck')).toHaveAttribute('id','paycheck-card-2');
 await menuGo(page,'income');await expect(page.locator('#incomeSummary .income-next-payday')).toContainText('Nov 13');
 await expect(page.locator('#bdNextPaycheck h3')).toContainText('Nov 13');
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

test('unchecked older plans do not pin next paycheck or the default starting card',async({page})=>{
 const f=await fixture(page,{ownStart:'2026-10-02'});
 await expect(page.locator('#scheduleOut .paycheck')).toHaveAttribute('id','paycheck-card-3');
 await expect(page.locator('#scheduleRestOut .paycheck').first()).toHaveAttribute('id','paycheck-card-4');
 await expect(page.locator('#paycheck-card-1')).toBeHidden();
 await expect(page.locator('#debtIncomeSummary .income-next-payday')).toContainText('Oct 30');
 await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.locator('#scheduleOut .paycheck')).toHaveAttribute('id','paycheck-card-4');
 await expect(page.locator('#debtIncomeSummary .income-next-payday')).toContainText('Nov 13');
 await expect(page.locator('#denMenu [data-wallet-value="payday"]')).toContainText('Nov 13');
 await menuGo(page,'overview');await page.locator('#scheduleExpandBtn').click();
 await expect(page.locator('#paycheck-card-1')).toBeVisible();
 await page.evaluate(()=>window.flushBearDenState());
 const state=JSON.parse(f.tracker.state.values['app-state']);
 expect(state.startDate).toBe('2026-10-02');expect(state.checkedPaychecks).toEqual({});
});

test('an early payroll advances dashboard, Income, and budget start on the scheduled payday without checkoffs',async({page})=>{
 const spouse={...deposit,transaction_id:'spouse-pay',account_id:'lunchflow-bills',amount:-755};
 const f=await fixture(page,{ownStart:'2026-10-02',now:'2026-10-30T12:00:00Z',transactions:[deposit,spouse]});
 await expect(page.locator('#paycheck-card-3 .paycheck-received')).toContainText('$1,923.47');
 await expect(page.locator('#scheduleOut .paycheck')).toHaveAttribute('id','paycheck-card-4');
 await expect(page.locator('#debtIncomeSummary .income-next-payday')).toContainText('Nov 13');
 await expect(page.locator('#denMenu [data-wallet-value="payday"]')).toContainText('Nov 13');
 await menuGo(page,'income');await expect(page.locator('#bdNextPaycheck h3')).toContainText('Nov 13');
 await menuGo(page,'settings');await page.locator('#bdHousehold [data-den-go=budget]').click();
 await page.getByRole('checkbox',{name:'Every other paycheck for Groceries',exact:true}).check();
 const start=page.getByRole('combobox',{name:'Start every other paycheck for Groceries'});
 await expect(start).toHaveValue('4');await expect(start).toContainText('Upcoming paycheck · Nov 13, 2026');
 await page.getByRole('button',{name:'Save budget',exact:true}).click();
 const state=JSON.parse(f.tracker.state.values['app-state']);
 expect(state.startDate).toBe('2026-10-02');expect(state.checkedPaychecks).toEqual({});
});
