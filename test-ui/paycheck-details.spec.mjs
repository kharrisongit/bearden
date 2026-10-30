import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

const budgetAmounts=page=>page.evaluate(()=>window.getDebtPlan().schedule.slice(0,4).map(row=>row.budgetLineItemsThisCheck.find(item=>item.id===1).amount));
async function openBudget(page){await menuGo(page,'settings');await page.locator('#bdHousehold [data-den-go=budget]').click();}
async function setIncome(page){
 await menuGo(page,'settings');await page.locator('#bdHousehold [data-den-go="income-edit"]').click();
 await page.locator('#hourlyRate').fill('25');await page.locator('#hoursPerCheck').fill('80');
 await page.locator('#incomeDropdown summary').filter({hasText:'State & withholding'}).click();
 await page.locator('#tax-state').selectOption('MI');await page.locator('#tax-filing').selectOption('joint');
 await page.locator('#tax-retirement').fill('200');
 await page.locator('#takeHome').fill('1845');
 await page.getByRole('button',{name:'Save income',exact:true}).click();
 await expect(page.locator('#incomeDropdown')).toBeHidden();
}

for(const width of [320,390,1280])test(`${width}px: budget alternates from the selected check, saves and can return to every check`,async({page})=>{
 await page.setViewportSize({width,height:844});
 const f=await fixture(page);await openBudget(page);
 await page.getByRole('checkbox',{name:'Every other paycheck for Groceries',exact:true}).check();
 const start=page.getByRole('combobox',{name:'Start every other paycheck for Groceries'});
 await expect(start).toHaveValue('1');await expect(start).toContainText('Upcoming paycheck · Oct 30, 2026');await expect(start).toContainText('Following paycheck · Nov 13, 2026');
 expect(await budgetAmounts(page)).toEqual([100,0,100,0]);
 await start.selectOption('2');expect(await budgetAmounts(page)).toEqual([0,100,0,100]);
 await page.getByRole('button',{name:'Save budget',exact:true}).click();await expect(page.locator('#budgetDropdown')).toBeHidden();
 expect(JSON.parse(f.tracker.state.values['app-state']).budgetItems[0].everyOtherStartPaycheck).toBe(2);
 await page.reload();await page.evaluate(()=>window.classicReady);await openBudget(page);
 await expect(page.getByRole('checkbox',{name:'Every other paycheck for Groceries',exact:true})).toBeChecked();
 await expect(start).toHaveValue('2');expect(await budgetAmounts(page)).toEqual([0,100,0,100]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width===390){await expect(page.locator('#budgetDropdown')).toHaveCSS('max-height','none');await page.locator('#budgetItemsList').scrollIntoViewIfNeeded();await page.screenshot({path:'/workspace/scratch/6bdf69538846/qa/budget-cadence.png'});}
 await page.getByRole('checkbox',{name:'Every other paycheck for Groceries',exact:true}).uncheck();
 expect(await budgetAmounts(page)).toEqual([100,100,100,100]);await expect(start).toBeHidden();
 await page.evaluate(()=>window.flushBearDenState());
 await page.reload();await page.evaluate(()=>window.classicReady);expect(await budgetAmounts(page)).toEqual([100,100,100,100]);
});

test('budget start follows the upcoming date after reload and leaves past checks unchanged',async({page})=>{
 await fixture(page,{ownStart:'2026-10-02'});await openBudget(page);
 await page.getByRole('checkbox',{name:'Every other paycheck for Groceries',exact:true}).check();
 const start=page.getByRole('combobox',{name:'Start every other paycheck for Groceries'});
 await expect(start).toHaveValue('3');await start.selectOption('4');
 expect(await budgetAmounts(page)).toEqual([100,100,0,100]);
 await page.evaluate(()=>window.flushBearDenState());
 await page.reload();await page.evaluate(()=>window.classicReady);await openBudget(page);
 await expect(start).toHaveValue('4');expect(await budgetAmounts(page)).toEqual([100,100,0,100]);
 await page.clock.setFixedTime(new Date('2026-11-25T12:00:00Z'));
 await page.locator('#bdDetail-budget .bd-popup-close').click();await page.locator('#bdHousehold [data-den-go=budget]').click();
 await expect(start).toHaveValue('4');await expect(start).toContainText('Saved start · Nov 13, 2026');
 await start.selectOption('6');
 expect(await page.evaluate(()=>window.getDebtPlan().schedule.slice(0,6).map(row=>row.budgetLineItemsThisCheck.find(item=>item.id===1).amount))).toEqual([100,100,0,100,0,100]);
});

for(const width of [320,390,1280])test(`${width}px: paycheck opens the withholding estimate and preserves entered take-home`,async({page})=>{
 await page.setViewportSize({width,height:844});await fixture(page);await setIncome(page);await menuGo(page,'overview');
 const button=page.locator('#paycheck-card-1').getByRole('button',{name:'Taxes & withholding'});
 await expect(button).toBeVisible();await button.click();
 const dialog=page.getByRole('dialog',{name:'Taxes & withholding'});
 await expect(dialog).toBeVisible();await expect(dialog).toContainText('Paycheck 1 · Oct 30, 2026');
 const value=label=>dialog.locator('.paycheck-tax-breakdown>div').filter({has:page.locator('dt',{hasText:new RegExp('^'+label+'$')})}).locator('dd');
 await expect(value('Gross pay')).toHaveText('$2,000.00');
 await expect(value('Federal income tax')).toHaveText('$56.15');
 await expect(value('Michigan income tax')).toHaveText('$76.50');
 await expect(value('Social Security')).toHaveText('$124.00');await expect(value('Medicare')).toHaveText('$29.00');
 await expect(value('401\\(k\\) contribution')).toHaveText('$200.00');await expect(value('Total taxes & deductions')).toHaveText('$485.65');
 await expect(value('Estimated take-home')).toHaveText('$1,514.35');
 await expect(dialog).toContainText('Take-home used in your plan: $1,845.00');
 await expect(dialog).toContainText('Your entered take-home differs from this estimate.');
 expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].takeHomeThisCheck)).toBe(1845);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 if(width===390)await page.screenshot({path:'/workspace/scratch/6bdf69538846/qa/paycheck-taxes.png'});
 await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(dialog).toBeHidden();await expect(button).toBeFocused();
 await menuGo(page,'income');await page.locator('#bdNextPaycheck [data-paycheck-taxes]').click();
 await expect(dialog).toBeVisible();await expect(dialog).toContainText('Paycheck 1 · Oct 30, 2026');
 await dialog.getByRole('button',{name:'Done',exact:true}).click();
 if(width===390){
  await menuGo(page,'overview');await page.evaluate(()=>{window.updatePaycheckAmount(2,1700);window.toggleScheduleExpanded();});
  await page.locator('#paycheck-card-2 [data-paycheck-taxes]').click();
  await expect(dialog).toContainText('Paycheck 2 · Nov 13, 2026');await expect(dialog).toContainText('Take-home used in your plan: $1,700.00');
 }
});

test('missing tax inputs do not invent a breakdown and new bonus estimates survive reload',async({page})=>{
 const f=await fixture(page);await menuGo(page,'overview');
 await page.locator('#paycheck-card-1 [data-paycheck-taxes]').click();
 const dialog=page.getByRole('dialog',{name:'Taxes & withholding'});
 await expect(dialog).toContainText('Take-home pay alone does not reveal individual taxes');await expect(dialog.locator('dl')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Done'}).click();await setIncome(page);await menuGo(page,'overview');
 await page.evaluate(()=>{window.toggleBonusInlineInput(1);});
 await page.locator('#bonusInlineAmount-1').fill('1000');await page.evaluate(()=>window.applyBonusToPaycheck(1));
 await page.evaluate(()=>window.flushBearDenState());
 expect(JSON.parse(f.tracker.state.values['app-state']).bonusTaxEstimates[1].net).toBe(661);
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'overview');
 await page.locator('#paycheck-card-1 [data-paycheck-taxes]').click();
 await expect(dialog).toContainText('Estimate saved when this bonus was added');await expect(dialog).toContainText('Bonus take-home: $661.00 · Total take-home in your plan: $2,506.00');
 await expect(dialog.locator('dl').last()).toContainText('$220.00');
 await dialog.getByRole('button',{name:'Done'}).click();await page.evaluate(()=>window.removeBonusFromPaycheck(1));await page.evaluate(()=>window.flushBearDenState());
 expect(JSON.parse(f.tracker.state.values['app-state']).bonusTaxEstimates[1]).toBeUndefined();
 const oldState=JSON.parse(f.tracker.state.values['app-state']);oldState.appliedBonuses={1:500};delete oldState.bonusTaxEstimates;
 f.tracker.state.values['app-state']=JSON.stringify(oldState);
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'overview');await page.locator('#paycheck-card-1 [data-paycheck-taxes]').click();
 await expect(dialog).toContainText('Only the after-tax amount was saved for this bonus');await expect(dialog).toContainText('Bonus take-home: $500.00');
});
