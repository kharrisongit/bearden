import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

async function setup(page){
 const f=await fixture(page,{empty:true,goals:false,ownStart:'2026-11-06'});
 const state=JSON.parse(f.tracker.state.values['app-state']);
 Object.assign(state,{cards:[{id:1,name:'Example card',balance:800,apr:0,min:20,monthlyMinimum:40,dueDate:'2026-11-09'}],budgetItems:[],payoffMethod:'minimum',debtPaymentSettings:{mode:'due-date',leadDays:3}});
 f.tracker.state.values['app-state']=JSON.stringify(state);
 await page.reload();await page.evaluate(()=>window.classicReady);
 await menuGo(page,'overview');return f;
}
for(const width of [320,430])test(`${width}px: skip frees a debt allocation, restores it and persists without changing history`,async({page})=>{
 await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await setup(page),card=page.locator('#paycheck-card-1');
 const before=await page.evaluate(()=>window.getDebtPlan());
 await card.getByRole('button',{name:'Skip Example card this paycheck',exact:true}).click();
 await expect(card.locator('[data-paycheck-debt="1"]')).toHaveCount(0);
 await expect(card.getByRole('button',{name:'Restore Example card to this paycheck'})).toBeVisible();
 let plan=await page.evaluate(()=>window.getDebtPlan());
 expect(plan.schedule[0].payments[0]).toBe(0);
 expect(plan.schedule[0].cashAfterDebt).toBe(before.schedule[0].cashAfterDebt+40);
 expect(plan.schedule[2].payments[0]).toBe(40);
 expect(plan.state.cards).toEqual(before.state.cards);expect(plan.schedule[0].extrasThisCheck).toEqual([]);
 await page.evaluate(()=>window.flushBearDenState());
 expect(JSON.parse(f.tracker.state.values['app-state']).paycheckSkippedPayments).toEqual({1:{1:true}});
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'overview');
 await expect(card.getByText('Skipped this paycheck',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:'Restore Example card to this paycheck'}).click();
 await expect(card.getByLabel('Payment for Example card')).toHaveValue('40.00');
 await card.getByRole('button',{name:'Skip Example card this paycheck',exact:true}).click();
 await card.locator('#chk-1').check();
 plan=await page.evaluate(()=>window.getDebtPlan());expect(plan.state.debtPaymentHistory[1][1]).toBe(0);
 await expect(card.getByRole('button',{name:'Restore Example card to this paycheck'})).toHaveCount(0);
 await page.evaluate(()=>window.togglePaycheckPayment(1,1));expect((await page.evaluate(()=>window.getDebtPlan())).state.debtPaymentHistory[1][1]).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('a zero-due cycle removes the false late status and old allocation without erasing next month',async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=await setup(page);
 await page.clock.setFixedTime(new Date('2026-11-10T12:00:00Z'));
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'debts');
 const account=page.locator('[data-tracker-account="1"]');
 await account.getByRole('button',{name:'Details and progress for Example card'}).click();
 const detail=page.locator('#debtProgressDialog');await detail.getByRole('button',{name:'Set $0 due for this cycle'}).click();
 await expect(detail.getByRole('button',{name:'Undo $0 due for this cycle'})).toBeVisible();
 await expect(detail).toContainText('Confirmed for this cycle');
 await page.locator('#closeDebtProgress').click();
 await expect(account).toContainText('No payment due · Nov 9 cycle');
 await expect(account.locator('.minimum-due strong')).toHaveText('$0.00');
 await expect(account.locator('.den-date-stamp')).toHaveCount(0);
 let plan=await page.evaluate(()=>window.getDebtPlan());
 expect(plan.schedule[0].payments[0]).toBe(0);expect(plan.schedule[2].payments[0]).toBe(40);
 expect(plan.state.cards[0].monthlyMinimum).toBe(40);expect(plan.state.cards[0].balance).toBe(800);
 expect(JSON.parse(f.tracker.state.values['income-planner']).debtCycleMinimums[1]['2026-11-09'].amount).toBe(0);
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'overview');
 await expect(page.locator('#paycheck-card-1')).not.toContainText('payment is late');
 await menuGo(page,'debts');await expect(account).toContainText('No payment due');
 await account.getByRole('button',{name:'Details and progress for Example card'}).click();
 await detail.getByRole('button',{name:'Undo $0 due for this cycle'}).click();
 await expect(detail.getByRole('button',{name:'Set $0 due for this cycle'})).toBeVisible();
 plan=await page.evaluate(()=>window.getDebtPlan());expect(plan.schedule[0].payments[0]).toBe(40);
});
