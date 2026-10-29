import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

for(const [width,theme] of [[320,'light'],[390,'dark'],[1280,'light']])test(`Wallet popups fit ${width}px ${theme} and keep their titles and close controls reachable`,async({page})=>{
 await page.setViewportSize({width,height:740});const errors=[];page.on('pageerror',error=>errors.push(error.message));await fixture(page);
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const ids=await page.locator('dialog.bd-popup[id]').evaluateAll(nodes=>nodes.map(node=>node.id));
 expect(ids.length).toBeGreaterThan(20);
 for(const id of ids){
  const popup=page.locator('#'+id);await popup.evaluate(node=>node.showModal());
  await expect(popup.locator('.bd-popup-close')).toBeVisible();
  expect(await popup.evaluate(node=>{
   const rect=node.getBoundingClientRect(),body=node.querySelector('.bd-popup-body');
   return rect.left>=0&&rect.right<=innerWidth&&rect.top>=0&&rect.bottom<=innerHeight&&body.scrollWidth<=body.clientWidth+1&&!!document.getElementById(node.getAttribute('aria-labelledby'));
  }),id).toBe(true);
  await popup.locator('.bd-popup-body').evaluate(node=>node.scrollTop=node.scrollHeight);
  await expect(popup.locator('.bd-popup-close')).toBeInViewport();
  await popup.locator('.bd-popup-close').click();await expect(popup).toBeHidden();
 }
 expect(errors).toEqual([]);
});

test('grouped household editor keeps the shared bill choices and saves every contribution field',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);await menuGo(page,'settings');
 await page.locator('[data-bd-household]').click();
 const form=page.locator('#householdForm');
 await expect(form.locator(':scope > section > h4')).toHaveText(['Your accounts','Contributions','Bills paid from the shared account']);
 await expect(form.locator('#householdBillChoices input').first()).toBeAttached();
 await form.locator('[name=personalAmount]').fill('800');await form.locator('[name=spouseAmount]').fill('825');
 await form.locator('[name=spouseRepeat]').selectOption('monthly');await form.locator('[type=submit]').click();
 await expect(page.locator('#householdEditor')).toBeHidden();
 await page.locator('[data-bd-household]').click();
 await expect(form.locator('[name=personalAmount]')).toHaveValue('800');await expect(form.locator('[name=spouseAmount]')).toHaveValue('825');await expect(form.locator('[name=spouseRepeat]')).toHaveValue('monthly');
});

test('nested transaction picker returns to the bill draft and saves the original editor',async({page})=>{
 await page.setViewportSize({width:390,height:740});await fixture(page);await menuGo(page,'bills');
 await page.locator('[data-edit-bill=electric]').click();const form=page.locator('#billEditorForm');
 await form.locator('[name=name]').fill('Electric service');
 await page.locator('#billTransactionLink').getByRole('button',{name:'Link a transaction'}).click();
 await expect(page.locator('#transactionLinkPicker')).toBeVisible();await page.locator('#closeTransactionLinkPicker').click();
 await expect(form.locator('[name=name]')).toHaveValue('Electric service');
 await form.locator('[type=submit]').click();await expect(page.locator('#billEditor')).toBeHidden();
 await expect(page.locator('[data-account-id=electric]')).toContainText('Electric service');
});
