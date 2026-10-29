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
 await page.getByRole('tab',{name:'Contributions',exact:true}).click();await form.locator('[name=personalAmount]').fill('800');await form.locator('[name=spouseAmount]').fill('825');
 await form.locator('[name=spouseRepeat]').selectOption('monthly');await form.locator('[type=submit]').click();
 await expect(page.locator('#householdEditor')).toBeHidden();
 await page.locator('[data-bd-household]').click();
 await expect(form.locator('[name=personalAmount]')).toHaveValue('800');await expect(form.locator('[name=spouseAmount]')).toHaveValue('825');await expect(form.locator('[name=spouseRepeat]')).toHaveValue('monthly');
});

test('nested transaction picker returns to the bill draft and saves the original editor',async({page})=>{
 await page.setViewportSize({width:390,height:740});await fixture(page);await menuGo(page,'bills');
 await page.locator('[data-edit-bill=electric]').click();const form=page.locator('#billEditorForm');
 await form.locator('[name=name]').fill('Electric service');
 await page.getByRole('tab',{name:'Connections',exact:true}).click();await page.locator('#billTransactionLink').getByRole('button',{name:'Link a transaction'}).click();
 await expect(page.locator('#transactionLinkPicker')).toBeVisible();await page.locator('#closeTransactionLinkPicker').click();
 await expect(form.locator('[name=name]')).toHaveValue('Electric service');
 await form.locator('[type=submit]').click();await expect(page.locator('#billEditor')).toBeHidden();
 await expect(page.locator('[data-account-id=electric]')).toContainText('Electric service');
});

test('tabbed editors expose invalid fields, keep loan fields with Account, and save changes across tabs',async({page})=>{
 await page.setViewportSize({width:390,height:740});await fixture(page);await menuGo(page,'bills');
 await page.locator('[data-edit-bill=car]').click();const bill=page.locator('#billEditorForm');
 await expect(bill.locator('[name=carLoanBalance]')).toBeVisible();await bill.locator('[name=carLoanBalance]').fill('9000');
 await bill.locator('[name=name]').fill('ELGA car loan');await page.getByRole('tab',{name:'Payments',exact:true}).click();await bill.locator('[name=amount]').fill('310');
 await page.getByRole('tab',{name:'Connections',exact:true}).click();await bill.locator('[type=submit]').click();await expect(page.locator('#billEditor')).toBeHidden();
 await page.locator('[data-edit-bill=car]').click();await expect(bill.locator('[name=carLoanBalance]')).toHaveValue('9000');await expect(bill.locator('[name=amount]')).toHaveValue('310');await page.locator('#closeBillEditor').click();
 await menuGo(page,'debts');await page.locator('#tab-debts .bd-page-heading [data-account-kind=debt]').click();
 const debt=page.locator('#debtEditorForm');await page.getByRole('tab',{name:'Connections',exact:true}).click();await debt.locator('[type=submit]').click();
 await expect(page.getByRole('tab',{name:'Account',exact:true})).toHaveAttribute('aria-selected','true');await expect(debt.locator('[name=name]')).toBeFocused();
 await debt.locator('[name=name]').fill('Test debt');await page.getByRole('tab',{name:'Balance',exact:true}).click();await debt.locator('[name=balance]').fill('300');await debt.locator('[name=apr]').fill('10');await debt.locator('[name=minimum]').fill('25');
 await page.getByRole('tab',{name:'Connections',exact:true}).click();await debt.locator('[type=submit]').click();await expect(page.locator('#debtEditor')).toBeHidden();await expect(page.locator('#debtAccounts')).toContainText('Test debt');
});

test('wallet fits one page, settings toggles save on the hub, and brand images load locally',async({page})=>{
 const f=await fixture(page);
 for(const [width,height] of [[320,480],[320,568],[390,667],[390,844],[844,390],[1280,800]]){
  await page.setViewportSize({width,height});await page.locator('#denOpen').click();
  expect(await page.locator('#denMenu').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  for(const card of await page.locator('.den-wallet-card').all()){await expect(card).toBeInViewport({ratio:1});expect((await card.boundingBox()).height).toBeGreaterThanOrEqual(44);}
  await expect(page.locator('#denMenu footer button')).toBeInViewport({ratio:1});await page.locator('#denClose').click();
 }
 await menuGo(page,'settings');await expect(page.locator('#bdOptions #sharedBillsToggle')).toBeVisible();await expect(page.locator('#bdOptions #carPaymentsInDebtToggle')).toBeVisible();
 await page.locator('#carPaymentsInDebtToggle').check();await expect.poll(()=>JSON.parse(f.tracker.state.values['income-planner']).showCarPaymentsInDebt).toBe(true);
 await page.locator('#sharedBillsToggle').uncheck();await expect.poll(()=>JSON.parse(f.tracker.state.values['income-planner']).household.enabled).toBe(false);
 await expect(page.locator('#bdConnections .bd-status').first()).toHaveAttribute('aria-label','Disconnected');
 await page.evaluate(()=>{const source=document.querySelector('#classicBankStatus');source.dataset.connected='true';source.textContent='Connected';window.dispatchEvent(new Event('bearden-connections'));});
 await expect(page.locator('[data-bd-status=classicBankStatus]')).toHaveAttribute('aria-label','Connected');expect((await page.locator('[data-bd-status=classicBankStatus]').boundingBox()).width).toBeLessThanOrEqual(12);
 await menuGo(page,'debts');const logo=page.locator('[data-brand=capitalone] img');await expect(logo).toHaveAttribute('src',/^data:image/);expect(await logo.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
});
