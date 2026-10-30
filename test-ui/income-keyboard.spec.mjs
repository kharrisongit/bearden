import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

async function openIncome(page,values={}){
 const f=await fixture(page);
 const state=JSON.parse(f.tracker.state.values['app-state']);
 Object.assign(state,{hourlyRate:'25',hoursPerCheck:'',takeHome:'0',taxSettings:{state:'MI',filing:'joint',retirement:'125'}},values);
 f.tracker.state.values['app-state']=JSON.stringify(state);
 await page.reload();await page.evaluate(()=>window.classicReady);
 await menuGo(page,'settings');await page.locator('[data-den-go="income-edit"]').click();
 return f;
}

test('blank saved hours and zero take-home recover; pay and withholding update while typing and persist',async({page})=>{
 await page.setViewportSize({width:440,height:956});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await openIncome(page);
 await expect(page.locator('#hoursPerCheck')).toHaveValue('80');
 await expect(page.locator('#takeHome')).toHaveValue('1578.66');
 await page.locator('#takeHome').fill('0');await page.locator('#takeHome').blur();
 await expect(page.locator('#takeHome')).toHaveValue('1578.66');
 await page.locator('#hourlyRate').fill('');
 await expect(page.locator('#incomeEstimate')).not.toContainText('deductions cannot exceed');
 await page.locator('#hourlyRate').pressSequentially('28.85');
 const expected=await page.evaluate(()=>window.BearDenTaxes.estimatePay(28.85*80,window.BearDenTaxes.read()).net.toFixed(2));
 await expect(page.locator('#takeHome')).toHaveValue(expected);
 await expect(page.locator('#hourlyRate')).toBeFocused();
 await page.locator('#tax-retirement').fill('200');
 await expect(page.locator('#takeHome')).not.toHaveValue(expected);
 const saved=await page.locator('#takeHome').inputValue();
 await page.getByRole('button',{name:'Save income',exact:true}).click();
 await expect(page.locator('#bdDetail-income')).toBeHidden();
 await page.reload();await page.evaluate(()=>window.classicReady);
 expect(await page.evaluate(()=>window.getDebtPlan().state.takeHome)).toBe(saved);
 expect(errors).toEqual([]);
});

test('a real deduction error stays actionable and fixes itself after correcting the input',async({page})=>{
 await openIncome(page,{hoursPerCheck:'8',taxSettings:{state:'MI',filing:'joint',retirement:'300'}});
 await expect(page.locator('#incomeEstimate')).toContainText('deductions ($300.00) exceed gross pay ($200.00)');
 await page.getByRole('button',{name:'Save income',exact:true}).click();
 await expect(page.locator('#incomeEditorStatus')).toContainText('deductions cannot exceed gross pay');
 await expect(page.locator('#bdDetail-income')).toBeVisible();
 await page.locator('#hoursPerCheck').fill('80');
 await expect(page.locator('#incomeEstimate')).toContainText('Estimated take-home');
 expect(Number(await page.locator('#takeHome').inputValue())).toBeGreaterThan(0);
 await expect(page.locator('#incomeEditorStatus')).toBeEmpty();
 // Clearing hours shows the missing input, not an unrelated deduction failure.
 await page.locator('#hoursPerCheck').fill('');
 await expect(page.locator('#incomeEstimate')).toContainText('Enter your hours per paycheck');
 await page.locator('#hoursPerCheck').fill('40');
 expect(Number(await page.locator('#takeHome').inputValue())).toBeGreaterThan(0);
 await expect(page.locator('#hoursPerCheck')).toHaveValue('40');
});

test('iPhone visual viewport keeps focused fields above the keyboard with no floating total or horizontal pan',async({page})=>{
 await page.setViewportSize({width:440,height:956});
 await page.addInitScript(()=>{
  const viewport=new EventTarget();
  Object.assign(viewport,{height:956,width:440,offsetTop:0,offsetLeft:0,scale:1});
  Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
 });
 await openIncome(page);
 await page.locator('#hourlyRate').focus();
 await page.evaluate(()=>{
  Object.assign(visualViewport,{height:420,offsetTop:100});
  visualViewport.dispatchEvent(new Event('resize'));
 });
 const dialog=page.locator('#bdDetail-income');
 await expect(dialog).toHaveAttribute('data-keyboard-viewport','');
 await expect.poll(()=>dialog.evaluate(el=>{
  const r=el.getBoundingClientRect(),input=document.querySelector('#hourlyRate').getBoundingClientRect(),body=el.querySelector('.bd-popup-body').getBoundingClientRect();
  return r.top>=100&&r.bottom<=520&&input.top>=body.top&&input.bottom<=body.bottom;
 })).toBe(true);
 expect(await page.locator('.income-editor-result').evaluate(el=>getComputedStyle(el).position)).toBe('static');
 await page.locator('#hourlyRate').fill('30');
 await expect(page.locator('#takeHome')).not.toHaveValue('1578.66');
 await page.locator('#tax-retirement').focus();
 await expect.poll(()=>page.locator('#tax-retirement').evaluate(el=>{
  const r=el.getBoundingClientRect(),body=el.closest('.bd-popup-body').getBoundingClientRect();return r.top>=body.top&&r.bottom<=body.bottom;
 })).toBe(true);
 const body=dialog.locator('.bd-popup-body');
 await body.evaluate(el=>el.scrollTop=el.scrollHeight);
 await expect(page.getByRole('button',{name:'Save income',exact:true})).toBeInViewport();
 expect(await body.evaluate(el=>{el.scrollLeft=100;return el.scrollLeft;})).toBe(0);
 await page.screenshot({path:'/tmp/bearden-income-keyboard-fixed.png'});
 await page.evaluate(()=>{Object.assign(visualViewport,{height:956,offsetTop:0});visualViewport.dispatchEvent(new Event('resize'));});
 await expect(dialog).not.toHaveAttribute('data-keyboard-viewport');
});

test('all popup shells and scrolling bodies allow vertical gestures only',async({page})=>{
 await page.setViewportSize({width:440,height:700});await fixture(page);
 const ids=await page.locator('dialog[id]').evaluateAll(els=>els.map(el=>el.id));
 expect(ids.length).toBeGreaterThan(20);
 for(const id of ids){
  const dialog=page.locator('#'+id);await dialog.evaluate(el=>el.showModal());
  expect(await dialog.evaluate(el=>{
   const style=getComputedStyle(el);return style.overflowX==='hidden'&&style.touchAction==='pan-y';
  }),id).toBe(true);
  const body=dialog.locator('.bd-popup-body');
  if(await body.count())expect(await body.evaluate(el=>{
   const style=getComputedStyle(el);el.scrollLeft=100;return style.overflowY==='auto'&&style.overflowX==='hidden'&&style.touchAction==='pan-y'&&el.scrollLeft===0;
  }),id).toBe(true);
  await dialog.evaluate(el=>el.close());
 }
});
