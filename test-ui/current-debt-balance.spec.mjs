import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {blank} from '../public/engine.mjs';

async function setup(page,{issuer=false,legacyBalance}={}){
 const f=await fixture(page,{empty:true,goals:false,ownStart:'2026-10-02'});
 const bank={id:issuer?'plaid-example':'lunchflow-example',name:'Example debt',type:'credit',source:issuer?'plaid':'lunchflow',balance:80000,currency:'USD',balanceUpdated:'2026-10-27T12:00:00Z'};
 f.accounts.push(bank);
 const planner=JSON.parse(f.tracker.state.values['income-planner']);
 if(issuer)planner.creditCards={'credit-example':{tracking:true,trackerCardId:'1'}};
 else planner.debtAccountLinks={1:bank.id};
 planner.accountVisibility[bank.id]=true;
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 const state=JSON.parse(f.tracker.state.values['app-state']);
 Object.assign(state,{cards:[{id:1,name:'Example debt',balance:1000,apr:0,min:50,monthlyMinimum:100,dueDate:'2026-11-15'}],cardIdCounter:1,budgetItems:[],payoffMethod:'minimum',checkedPaychecks:{1:true},debtPaymentHistory:{1:{1:50}},debtInterestHistory:{1:{1:0}},debtFeeHistory:{1:{1:0}},monthlyPayoffPlan:{monthlyBudget:200,method:'avalanche'}});
 if(legacyBalance!==undefined)state.cards[0].balanceOverride=legacyBalance;
 f.tracker.state.values['app-state']=JSON.stringify(state);
 if(issuer)await page.route('**/api/state',route=>route.fulfill({json:{state:{...blank(),accounts:f.accounts},connections:{items:[],transactions:[],creditCards:[{id:'credit-example',accountId:'example',name:'Example debt',institution:'Example bank',balance:80000,currency:'USD',minimum:10000,dueDate:'2026-11-15',aprs:[{type:'purchase_apr',rate:0}],updated:'2026-10-28T10:00:00Z'}],gmailMessages:[],recurringBills:[]},revision:0}}));
 await page.reload();await page.evaluate(()=>window.classicReady);
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtBalances[1]?.balance)).toBe(legacyBalance??80000);
 await menuGo(page,'debts');
 const toggle=page.locator('#monthlyPayoffToggle');if(await toggle.count()&&await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 return {f,bank};
}
async function balanceEditor(page){
 await page.locator('[data-edit-debt="1"]').first().click();
 await page.locator('#debtEditor').getByRole('tab',{name:'Balance',exact:true}).click();
 return page.locator('#debtEditorForm');
}
const history=plan=>Object.fromEntries(['checkedPaychecks','debtPaymentHistory','debtInterestHistory','debtFeeHistory'].map(key=>[key,plan.state[key]]));

test('manual current balance updates every total, survives delayed sync, and can return to automatic',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const {f,bank}=await setup(page),before=await page.evaluate(()=>window.getDebtPlan());
 let form=await balanceEditor(page);
 await expect(form.locator('[name=currentBalance]')).toHaveValue('800.00');
 await expect(form.locator('#debtStartingBalanceNote')).toContainText('$1,000.00');
 await form.locator('[name=currentBalance]').fill('650');
 await form.getByRole('button',{name:'Save debt',exact:true}).click();
 await expect(page.locator('#debtEditor')).toBeHidden();
 await expect(page.locator('[data-tracker-account="1"] .debt-key-amounts strong').first()).toHaveText('$650.00');
 await expect(page.locator('#debtTotalAmount')).toContainText('$650.00');
 await expect(page.locator('#heroTotal')).toHaveText('$650.00');
 await expect(page.locator('#monthlyPayoffTotal')).toHaveText('$650.00');
 const saved=JSON.parse(f.tracker.state.values['app-state']);
 expect(saved.cards[0].balance).toBe(1000);expect(saved.cards[0].currentBalanceOverride.balance).toBe(65000);
 expect(history(await page.evaluate(()=>window.getDebtPlan()))).toEqual(history(before));
 bank.balance=90000;bank.balanceUpdated='2026-10-28T12:30:00Z';
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'debts');
 await expect(page.locator('#debtTotalAmount')).toContainText('$650.00');
 await expect(page.locator('[data-tracker-account="1"]')).toContainText('Manual current balance');
 form=await balanceEditor(page);
 await form.locator('#useAutomaticDebtBalance').click();
 await expect(form.locator('[name=currentBalance]')).toHaveValue('900.00');
 await form.getByRole('button',{name:'Save debt',exact:true}).click();
 await expect(page.locator('#debtEditor')).toBeHidden();
 await expect(page.locator('#debtTotalAmount')).toContainText('$900.00');
 expect(JSON.parse(f.tracker.state.values['app-state']).cards[0].currentBalanceOverride).toBeUndefined();
 form=await balanceEditor(page);
 await form.locator('[name=currentBalance]').fill('0');
 await form.getByRole('button',{name:'Save debt',exact:true}).click();
 await expect(page.locator('#debtEditor')).toBeHidden();
 await expect(page.locator('#debtTotalAmount')).toContainText('$0.00');
 await expect(page.locator('#monthlyPayoffDate')).toHaveText('No debt remaining');
 await expect(page.locator('[data-tracker-account="1"]')).not.toContainText('Paid from checked paychecks');
 expect(history(await page.evaluate(()=>window.getDebtPlan()))).toEqual(history(before));
});

test('a mapped issuer card exposes current balance correction and uses it in the connected card total',async({page})=>{
 await setup(page,{issuer:true});
 await page.locator('[data-account-id="credit-example"] [data-edit-credit]').first().click();
 await page.locator('#creditBalanceButton').click();
 await page.locator('#debtEditor').getByRole('tab',{name:'Balance',exact:true}).click();
 const form=page.locator('#debtEditorForm');
 await expect(form.locator('[name=currentBalance]')).toHaveValue('800.00');
 await form.locator('[name=currentBalance]').fill('525');
 await form.getByRole('button',{name:'Save debt',exact:true}).click();
 await expect(page.locator('#debtEditor')).toBeHidden();
 await expect(page.locator('#debtTotalAmount')).toContainText('$525.00');
 await expect(page.locator('#heroTotal')).toHaveText('$525.00');
});


test('a balance saved by the released editor migrates on reload and clears when automatic is selected',async({page})=>{
 const {f}=await setup(page,{legacyBalance:65000});
 await expect(page.locator('#debtTotalAmount')).toContainText('$650.00');
 await expect(page.locator('[data-tracker-account="1"]')).toContainText('Manual current balance');
 let form=await balanceEditor(page);
 await expect(form.locator('[name=currentBalance]')).toHaveValue('650.00');
 await expect(form.locator('#debtCurrentBalanceNote')).toContainText('manual current balance');
 await form.getByRole('button',{name:'Save debt',exact:true}).click();
 await expect(page.locator('#debtEditor')).toBeHidden();
 const migrated=JSON.parse(f.tracker.state.values['app-state']).cards[0];
 expect(migrated.currentBalanceOverride.balance).toBe(65000);expect(migrated.balanceOverride).toBeUndefined();expect(migrated.balance).toBe(1000);
 form=await balanceEditor(page);
 await form.locator('#useAutomaticDebtBalance').click();
 await expect(form.locator('[name=currentBalance]')).toHaveValue('800.00');
 await form.getByRole('button',{name:'Save debt',exact:true}).click();
 await expect(page.locator('#debtEditor')).toBeHidden();
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'debts');
 await expect(page.locator('#debtTotalAmount')).toContainText('$800.00');
 const restored=JSON.parse(f.tracker.state.values['app-state']).cards[0];
 expect(restored.currentBalanceOverride).toBeUndefined();expect(restored.balanceOverride).toBeUndefined();
});


test('mapped issuer cards retain the manual balance source in their Wallet caption',async({page})=>{
 await setup(page,{issuer:true,legacyBalance:65000});
 const card=page.locator('[data-account-id="credit-example"]');
 await expect(card.locator('.bd-amount-caption')).toHaveText('Manual current balance');
 await expect(page.locator('#debtTotalAmount')).toContainText('$650.00');
});
