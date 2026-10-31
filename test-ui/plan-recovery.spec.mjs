import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

for(const width of [320,390])test(`${width}px: paycheck completion explains consequences and can be undone immediately or from completed plans`,async({page})=>{
 await page.setViewportSize({width,height:844});await fixture(page);await menuGo(page,'overview');
 const first=page.locator('#paycheck-card-1');
 await expect(first.locator('.paycheck-completion-help')).toContainText('BearDen does not send payments');
 await expect(first.getByRole('checkbox',{name:'Mark paycheck 1 plan complete',exact:true})).toBeVisible();
 await first.getByRole('checkbox').check();
 const toast=page.locator('#bearToast');await expect(toast).toContainText('No payments were sent');
 await expect(toast.getByRole('button',{name:'Undo',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(window.debtPaymentHistory[1]||{}).length)).toBeGreaterThan(0);
 await toast.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(first.getByRole('checkbox')).not.toBeChecked();
 expect(await page.evaluate(()=>window.debtPaymentHistory[1])).toBeUndefined();
 expect(await page.evaluate(()=>window.debtInterestHistory[1])).toBeUndefined();
 await first.getByRole('checkbox').check();
 await expect(page.locator('#completedPaychecksBtn')).toBeVisible();
 await page.evaluate(()=>window.dismissBearToast('paycheck-complete'));
 await page.locator('#completedPaychecksBtn').click();
 await expect(page.locator('#scheduleRestOut')).toHaveClass(/open/);
 await expect(first.getByRole('checkbox')).toBeFocused();
 await first.getByRole('checkbox').uncheck();
 await expect(page.locator('#completedPaychecksBtn')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('failed autosave stays visible, retries real persistence, and clears only after success',async({page})=>{
 await fixture(page);await page.evaluate(()=>window.flushBearDenState());
 let failed=true;
 await page.route('https://bearden.test/api/classic',route=>route.request().method()==='POST'&&failed?route.fulfill({status:500,json:{error:'Temporary save failure'}}):route.fallback());
 await page.evaluate(()=>performSaveAppState());
 await expect(page.locator('#bearToast')).toContainText('Changes have not saved');
 await expect(page.locator('#bearToast')).toBeVisible();
 await page.waitForTimeout(3200);await expect(page.locator('#bearToast')).toBeVisible();
 await page.locator('#bearToast').getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.locator('#bearToast')).toContainText('Changes have not saved');
 failed=false;
 await page.locator('#bearToast').getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.locator('#bearToast')).toContainText('Changes saved');
 await expect(page.locator('#bearToast')).not.toContainText('have not saved');
});

test('revision conflict offers a guarded reload instead of a misleading retry',async({page})=>{
 await fixture(page);await page.evaluate(()=>window.flushBearDenState());
 await page.route('https://bearden.test/api/classic',route=>route.request().method()==='POST'?route.fulfill({status:409,json:{error:'Your saved data changed; reload before editing again.'}}):route.fallback());
 await page.evaluate(()=>performSaveAppState(true));
 const toast=page.locator('#bearToast');await expect(toast).toContainText('Your session or saved data changed');
 await expect(toast.getByRole('button',{name:'Reload',exact:true})).toBeVisible();
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('Unsaved changes');await dialog.dismiss();});
 await toast.getByRole('button',{name:'Reload',exact:true}).click();
 await expect(toast).toBeVisible();
});
