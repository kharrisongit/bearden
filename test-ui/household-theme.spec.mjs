import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

for(const width of [320,390,1280])for(const mode of ['light','dark'])test(`${width}px ${mode}: Household editors calculate, save, and reopen`,async({page})=>{
 await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await fixture(page);await menuGo(page,'income');await expect(page.locator('#tab-income #incomeToggleBtn,#tab-income #incomeBudgetToggleBtn')).toHaveCount(0);
 await menuGo(page,'settings');await page.locator(`[data-bd-mode=${mode}]`).click();
 await expect(page.locator('#bdHousehold [data-bd-detail=timing]')).toBeVisible();await expect(page.locator('#bdOptions [data-bd-detail=timing]')).toHaveCount(0);
 await page.locator('#bdHousehold [data-den-go="income-edit"]').click();
 const dialog=page.locator('#bdDetail-income');await expect(dialog).toBeVisible();await expect(dialog.locator('button.editor-save-action')).toHaveCount(1);await expect(page.locator('#useIncomeEstimate')).toHaveCount(0);
 await page.locator('#hourlyRate').fill('25');await page.locator('#hoursPerCheck').fill('80');
 await page.locator('.income-estimate-options > summary').click();await page.locator('#tax-state').selectOption('MI');await page.locator('#tax-filing').selectOption('joint');
 await expect(page.locator('#takeHome')).toHaveValue('1685.85');
 await page.locator('#tax-retirement').fill('200');await expect(page.locator('#takeHome')).toHaveValue('1514.35');
 await page.locator('#tax-retirementType').selectOption('roth');await expect(page.locator('#takeHome')).toHaveValue('1485.85');
 await page.locator('#withholdingControls details > summary').click();await page.locator('#tax-extraFederal').fill('30');await expect(page.locator('#takeHome')).toHaveValue('1455.85');
 await page.locator('#hourlyRate').fill('26');await expect(page.locator('#takeHome')).not.toHaveValue('1455.85');
 const computed=await page.locator('#takeHome').inputValue();await expect(page.locator('#incomeEstimate')).toContainText(computed.replace(/(\d)(?=(\d{3})+\.)/g,'$1,'));
 expect(await page.locator('#takeHome').evaluate(el=>{
  const row=el.closest('.field-row'),save=document.querySelector('#incomeDropdown .editor-save-action'),before=document.querySelector('#incomeEstimate');
  return !!(before.compareDocumentPosition(row)&Node.DOCUMENT_POSITION_FOLLOWING)&&row.nextElementSibling===save;
 })).toBe(true);
 await page.locator('#takeHome').scrollIntoViewIfNeeded();
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth&&el.querySelector('.bd-popup-body').scrollWidth<=el.querySelector('.bd-popup-body').clientWidth)).toBe(true);
 if(width===390&&mode==='light')await page.screenshot({path:'/tmp/bearden-income-total.png'});
 await page.getByRole('button',{name:'Save income',exact:true}).click();await expect(dialog).toBeHidden();await expect(page.locator('#bdHousehold [data-den-go="income-edit"]')).toBeFocused();
 expect(await page.evaluate(()=>window.getDebtPlan().state.takeHome)).toBe(computed);
 await page.locator('#bdHousehold [data-den-go=budget]').click();await expect(page.locator('#bdDetail-budget')).toBeVisible();
 const budget=page.locator('#budgetDropdown input[type=number]').first();await budget.fill('150');await budget.blur();
 expect(await page.locator('#bdDetail-budget .bd-popup-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 expect(await page.locator('#budgetItemsList .field-row').evaluateAll(rows=>rows.every(row=>{const name=row.querySelector('.field-name'),input=row.querySelector('input');return name.scrollWidth<=name.clientWidth&&name.getBoundingClientRect().right<=input.getBoundingClientRect().left;}))).toBe(true);
 if(width===390&&mode==='light')await page.screenshot({path:'/tmp/bearden-budget-editor.png'});
 await page.getByRole('button',{name:'Save budget',exact:true}).click();await expect(page.locator('#bdDetail-budget')).toBeHidden();
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'settings');await page.locator('#bdHousehold [data-den-go="income-edit"]').click();
 await expect(page.locator('#takeHome')).toHaveValue(computed);await page.locator('#takeHome').fill('1700');await page.getByRole('button',{name:'Save income',exact:true}).click();
 await page.locator('#bdHousehold [data-den-go=budget]').click();await expect(budget).toHaveValue('150');await page.locator('#bdDetail-budget .bd-popup-close').click();
 expect(errors).toEqual([]);
});

for(const width of [320,390,1280])test(`${width}px: custom colors support dragging, independent controls, modes, reload, presets and gradients`,async({page})=>{
 await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page);const before=await page.evaluate(()=>window.getDebtPlan().state);
 await menuGo(page,'settings');await page.locator('#openColorPicker').click();await page.locator('[data-theme-tab=custom]').click();
 await page.locator('#themeHex').fill('#7b4c90');
 await page.locator('[data-theme-target=button]').click();await page.locator('#themeHex').fill('#dbb83b');
 await page.locator('[data-theme-target=accent]').click();await page.locator('#themeHex').fill('#21765a');
 const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('bearden:custom-theme')));
 expect(await stored()).toEqual({surface:'#7b4c90',button:'#dbb83b',accent:'#21765a'});
 const field=page.locator('#themeColorField');await field.scrollIntoViewIfNeeded();const box=await field.boundingBox();
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.3,{steps:5});await page.mouse.up();
 expect((await stored()).accent).not.toBe('#21765a');expect((await stored()).button).toBe('#dbb83b');expect((await stored()).surface).toBe('#7b4c90');
 const dragged=(await stored()).accent;await field.press('ArrowLeft');expect((await stored()).accent).not.toBe(dragged);
 const chosen=await stored();
 for(const mode of ['dark','light']){
  await page.locator(`[data-color-mode=${mode}]`).click();
  expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--accent-fill'))).toBe('#dbb83b');
  expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--custom-accent'))).toBe(chosen.accent);
  expect(await page.locator('#colorPickerDialog .bd-popup-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 }
 await page.locator('#closeColorPicker').click();await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('html')).toHaveAttribute('data-color-scheme','custom');
 expect(await stored()).toEqual(chosen);await menuGo(page,'settings');await page.locator('#openColorPicker').click();await expect(field).toBeFocused();
 await page.locator('[data-theme-tab=gradients]').click();await page.locator('[data-color-scheme-choice=twilight]').click();await expect(page.locator('html')).toHaveAttribute('data-color-scheme','twilight');
 expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--accent-fill'))).toBe('');
 await page.locator('[data-theme-tab=presets]').click();await page.locator('[data-color-scheme-choice=slate]').click();await expect(page.locator('html')).toHaveAttribute('data-color-scheme','slate');
 await page.locator('[data-theme-tab=custom]').click();await page.locator('#applyCustomTheme').click();expect(await stored()).toEqual(chosen);
 await page.locator('#resetColorScheme').click();await expect(page.locator('html')).not.toHaveAttribute('data-color-scheme');
 expect(await page.evaluate(()=>window.getDebtPlan().state)).toEqual(before);expect(errors).toEqual([]);
});

test('an income save failure keeps the popup and edited amount available for retry',async({page})=>{
 await fixture(page);await menuGo(page,'settings');await page.locator('#bdHousehold [data-den-go="income-edit"]').click();
 await page.route('https://bearden.test/api/classic',route=>route.request().method()==='POST'?route.fulfill({status:500,json:{error:'Could not save income.'}}):route.fallback());
 await page.locator('#takeHome').fill('1900');await page.getByRole('button',{name:'Save income',exact:true}).click();
 await expect(page.locator('#incomeEditorStatus')).toContainText('Could not save');await expect(page.locator('#bdDetail-income')).toBeVisible();await expect(page.locator('#takeHome')).toHaveValue('1900');
 await expect(page.getByRole('button',{name:'Save income',exact:true})).toBeEnabled();
});

test('connected dots pulse gently and respect reduced motion',async({page})=>{
 await fixture(page);await menuGo(page,'settings');await page.emulateMedia({reducedMotion:'no-preference'});
 expect(await page.locator('#bdAccountBadge').evaluate(el=>getComputedStyle(el).animationName)).toBe('bd-connected-pulse');
 expect(await page.locator('[data-bd-status=classicBankStatus]').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 await page.emulateMedia({reducedMotion:'reduce'});expect(await page.locator('#bdAccountBadge').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});
