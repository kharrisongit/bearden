import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

test('settings is a compact hub with profile, working search and the original detailed editors',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);await menuGo(page,'settings');
 await expect(page.locator('#bdAccountEmail')).toHaveText('you@example.com');
 await expect(page.locator('#bdSettingsHub .bd-setting-group')).toHaveCount(4);
 await expect(page.locator('#classicLogin')).toBeHidden();
 const row=await page.locator('#bdHousehold .bd-setting-row').first().boundingBox();expect(row.height).toBeLessThan(50);
 await page.locator('#bdSettingsSearch').fill('contributions');
 await expect(page.locator('#bdHousehold')).toBeVisible();await expect(page.locator('#bdConnections')).toBeHidden();
 await page.locator('[data-bd-household]').click();await expect(page.locator('#householdEditor')).toBeVisible();await page.locator('#closeHouseholdEditor').click();
 await page.locator('#bdSettingsSearch').fill('nothingmatches');await expect(page.locator('#bdSearchEmpty')).toBeVisible();
 await page.locator('#bdSettingsSearch').clear();
 for(const [key,control] of [['plaid','#classicBank'],['lunchflow','#lunchflowSetup'],['email','#classicGmail'],['rent','#rentEnabledToggle']]){
  await page.locator('[data-bd-detail="'+key+'"]').click();
  await expect(page.locator('#bdDetail-'+key)).toBeVisible();await expect(page.locator(control)).toBeVisible();
  await page.locator('#bdDetail-'+key+' .bd-detail-heading button').click();
 }
 await page.locator('[data-bd-detail=account]').click();await expect(page.locator('#accountMode')).toContainText('you@example.com');await expect(page.locator('#classicLogout')).toBeVisible();
 await page.locator('#bdDetail-account .bd-detail-heading button').click();
 await page.screenshot({path:'test-results/wallet-v3-settings.png',fullPage:true});
});

test('settings preferences retain save, reload and failure recovery behavior',async({page})=>{
 const f=await fixture(page);await menuGo(page,'settings');
 await page.locator('#payoffControlsToggle').check();await expect(page.locator('#featureSettingsStatus')).toContainText('Slice / Squash preference saved');
 await page.locator('#bonusControlsToggle').uncheck();await expect(page.locator('#featureSettingsStatus')).toContainText('Bonus preference saved');
 await page.locator('[data-bd-detail=timing]').click();await page.locator('#debtPaymentTiming').selectOption('due-date');await page.locator('#debtPaymentLeadDays').fill('5');await page.locator('#debtPaymentLeadDays').blur();
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().state.debtPaymentSettings.leadDays)).toBe(5);
 await page.locator('#bdDetail-timing .bd-detail-heading button').click();await expect(page.locator('#bdTimingValue')).toHaveText('By due date');
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'settings');await expect(page.locator('#payoffControlsToggle')).toBeChecked();await expect(page.locator('#bonusControlsToggle')).not.toBeChecked();
 f.failSavings=true;await page.locator('#savingsTrackerToggle').uncheck();await expect(page.locator('#featureSettingsStatus')).toContainText('Could not save');await expect(page.locator('#savingsTrackerToggle')).toBeChecked();
 await expect(page.locator('#bdOptions #carPaymentsInDebtToggle')).toBeVisible();await expect(page.locator('#bdOptions #sharedBillsToggle')).toBeVisible();await page.locator('[data-bd-detail=preferences]').click();await expect(page.locator('#openGuidedSetup')).toBeVisible();
});

test('appearance swatches and automatic mode are functional and persist without altering the plan',async({page})=>{
 await fixture(page);const before=await page.evaluate(()=>window.getDebtPlan().state);await menuGo(page,'settings');
 await page.locator('[data-bd-palette=lavender]').click();await expect(page.locator('html')).toHaveAttribute('data-color-scheme','lavender');
 await page.emulateMedia({colorScheme:'dark'});await page.locator('[data-bd-mode=auto]').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).not.toHaveAttribute('data-theme','dark');
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'settings');await expect(page.locator('[data-bd-mode=auto]')).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-bd-palette=""]').click();await expect(page.locator('html')).not.toHaveAttribute('data-color-scheme');
 expect(await page.evaluate(()=>window.getDebtPlan().state)).toEqual(before);
});

test('income allocation links reach the real paycheck inputs and forecast controls remain available',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);await menuGo(page,'income');
 await expect(page.locator('#bdNextPaycheck')).toContainText('$1,845.00');await expect(page.locator('#bdRecentTransactions')).toBeVisible();
 await page.locator('[data-bd-paycheck-edit=income]').click();await expect(page.locator('#paycheck-card-1 .paycheck-income input')).toBeFocused();
 await page.locator('#paycheck-card-1 .paycheck-income input').fill('1950');await page.locator('#paycheck-card-1 .paycheck-income input').blur();
 await menuGo(page,'income');await expect(page.locator('#bdNextPaycheck')).toContainText('$1,950.00');
 await page.locator('.bd-chart-explore summary').click();await expect(page.locator('#forecastScrub')).toBeVisible();
 await page.locator('.bd-forecast-details summary').click();await expect(page.locator('#incomeForecast')).toBeVisible();
 await page.locator('[data-forecast-debt-mode=none]').click();await expect(page.locator('#forecastModeNote')).toContainText('before debt payments');
 await page.locator('#incomeTransactionsToggleBtn').click();await expect(page.locator('#bankActivityCard')).toBeVisible();
 await page.locator('#transactionSort').selectOption('account');await expect(page.locator('#transactionSort')).toHaveValue('account');
});

test('account cards keep details, list tools, totals and their original actions in a compact structure',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);await menuGo(page,'bills');
 const bill=page.locator('[data-account-id=electric]');expect((await bill.boundingBox()).height).toBeLessThan(205);
 await bill.locator('.bd-bill-details').click();await expect(bill.locator('dialog')).toBeVisible();await expect(bill.locator('dialog')).toContainText('Due Oct 29');await bill.locator('dialog .bd-detail-heading button').click();
 await page.locator('#billListCard .bd-list-options summary').click();await page.locator('#billsSort').selectOption('date-asc');await expect(page.locator('#billAgenda .bill-tile').first()).toHaveAttribute('data-account-id','car');
 await page.locator('#accounts-bills .bd-list-tools summary').click();await expect(page.locator('#billsTotalAmount')).toBeVisible();await expect(page.locator('#accounts-bills [data-open-bill-sharing]')).toBeVisible();
 await menuGo(page,'debts');await expect(page.locator('#tab-debts .bd-page-heading [data-account-kind=debt]')).toBeVisible();
 const debt=page.locator('[data-tracker-account="1"]');expect((await debt.boundingBox()).height).toBeLessThan(210);
 await debt.locator('[data-show-debt-details]').click();await expect(page.locator('#debtProgressDialog')).toContainText('Capital One');await page.locator('#closeDebtProgress').click();
 await page.screenshot({path:'test-results/wallet-v3-debt.png',fullPage:true});
});

test('the rebuilt DOM preserves every existing ID exactly once',async({page})=>{
 await page.addInitScript(()=>{if(!localStorage.getItem('layout-audit'))localStorage.setItem('bearden:design','classic');});await fixture(page);
 const before=await page.locator('[id]').evaluateAll(els=>els.map(e=>e.id));
 await page.evaluate(()=>{localStorage.setItem('bearden:design','den');localStorage.setItem('layout-audit','1');});
 await page.reload();await page.evaluate(()=>window.classicReady);
 await expect(page.locator('.bd-tracker')).toHaveCount(4);
 const after=await page.locator('[id]').evaluateAll(els=>els.map(e=>e.id));
 expect(before.filter(id=>!after.includes(id))).toEqual([]);expect(after.filter((id,i)=>after.indexOf(id)!==i)).toEqual([]);
});


test('signed-out users keep their local plan and reach sign-in from connection rows',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page,{authenticated:false});await menuGo(page,'settings');
 await expect(page.locator('#bdAccountBadge')).toHaveText('Local');await expect(page.locator('#bdAccountEmail')).toHaveText('On this device');await expect(page.locator('#bdSyncAll')).toBeDisabled();
 await page.locator('[data-bd-detail=plaid]').click();await expect(page.locator('#bdDetail-account')).toBeVisible();await expect(page.locator('#classicLogin')).toBeVisible();await expect(page.locator('#classicMicrosoftLogin')).toBeVisible();await expect(page.locator('#bdDetail-plaid')).toBeHidden();
 await page.locator('#bdDetail-account .bd-detail-heading button').click();await page.locator('#savingsTrackerToggle').uncheck();await expect(page.locator('#featureSettingsStatus')).toContainText('saved');
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'settings');await expect(page.locator('#savingsTrackerToggle')).not.toBeChecked();expect(errors).toEqual([]);
});
