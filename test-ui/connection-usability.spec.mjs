import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {blank} from '../public/engine.mjs';

for(const width of [320,390])test(`${width}px: guided bank controls survive wallet moves and restore`,async({page})=>{
 await page.setViewportSize({width,height:844});const f=await fixture(page);
 f.tracker.state.values.onboarding=JSON.stringify({started:true,step:2,completed:false});await page.reload();
 await expect(page.locator('#setupTitle')).toHaveText('Connect your banks');
 await expect(page.locator('#setupContent #configurePlaid')).toBeVisible();
 await expect(page.locator('#setupContent #configureLunchflow')).toBeVisible();
 await page.locator('#configureLunchflow').click();await expect(page.locator('#setupContent #lunchflowSetup')).toBeVisible();
 await page.locator('#setupBack').click();await expect(page.locator('#setupContent #classicOutlook')).toBeVisible();
 await page.locator('#setupNext').click();await expect(page.locator('#setupContent #configurePlaid')).toBeVisible();
 await page.locator('#setupLater').click();await expect(page.locator('#setupWizard')).toBeHidden();
 expect(await page.locator('#bdDetail-plaid #plaidSection').count()).toBe(1);
 expect(await page.locator('#bdDetail-lunchflow #lunchflowSection').count()).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('guest setup explains sign-in and permits skipping connections',async({page})=>{
 await fixture(page,{authenticated:false});
 await page.evaluate(()=>localStorage.setItem('bearden:classic:onboarding',JSON.stringify({started:true,step:2,completed:false})));await page.reload();
 await expect(page.locator('#setupContent')).toContainText('Sign in to connect bank accounts');
 await expect(page.locator('#setupNext')).toHaveText('Skip for now');
 await page.locator('#setupSignIn').click();await expect(page.locator('#setupTitle')).toHaveText('Welcome to BearDen');
 await page.locator('#setupNext').click();await expect(page.locator('#setupContent')).toContainText('Sign in to connect bill inboxes');
 await page.locator('#setupNext').click();await page.locator('#setupNext').click();await expect(page.locator('#setupTitle')).toHaveText('Set up your paycheck');
});

async function bankFixture(page){
 const f=await fixture(page);let fail=false;
 await page.route('https://bearden.test/api/state',route=>route.fulfill({json:{state:{...blank(),accounts:f.accounts},connections:{items:[{id:'test-bank',name:'Test bank'}],transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]}}}));
 await page.route('https://bearden.test/api/bank/refresh',route=>route.fulfill(fail?{status:500,json:{error:'Bank connection failed. Reconnect to continue.'}}:{json:{status:'Updated '+Array.from({length:50},(_,i)=>'account '+i).join(', ')}}));
 return {set fail(value){fail=value;}};
}
test('income refresh uses concise dismissible toast, not large inline output',async({page})=>{
 await page.setViewportSize({width:390,height:844});await bankFixture(page);await menuGo(page,'income');
 await page.locator('#tab-income [data-refresh-bank]').click();
 await expect(page.locator('#bearToast .bear-toast-message')).toHaveText('Connections refreshed.');
 await expect(page.locator('#connectionMessage')).toBeEmpty();
 expect(await page.locator('.bank-refresh-status').allTextContents()).toEqual(expect.arrayContaining(['']));
 const r=await page.locator('#bearToast').boundingBox();expect(r.width).toBeLessThan(390);expect(r.x).toBeGreaterThanOrEqual(0);
 await page.getByRole('button',{name:'Dismiss notification'}).click();await expect(page.locator('#bearToast')).toBeHidden();
});
test('settings refresh failure stays visible with a recovery action',async({page})=>{
 const f=await bankFixture(page);f.fail=true;await menuGo(page,'settings');await page.locator('#bdSyncAll').click();
 await expect(page.locator('#bearToast .bear-toast-message')).toContainText('need attention');
 await expect(page.locator('#bearToast .bear-toast-action')).toHaveText('Settings');
 await expect(page.locator('#connectionMessage')).toBeEmpty();
 await page.waitForTimeout(3200);await expect(page.locator('#bearToast')).toBeVisible();
 await page.getByRole('button',{name:'Dismiss notification'}).click();await expect(page.locator('#bearToast')).toBeHidden();
});

test('guided setup reopens above preferences instead of behind its native modal',async({page})=>{
 await fixture(page);await menuGo(page,'settings');
 await page.locator('[data-bd-detail="preferences"]').click();
 await expect(page.locator('#bdDetail-preferences')).toBeVisible();
 await page.locator('#openGuidedSetup').click();
 await expect(page.locator('#bdDetail-preferences')).toBeHidden();
 await expect(page.locator('#setupTitle')).toHaveText('Welcome to BearDen');
 await page.locator('#setupLater').click();await expect(page.locator('#setupWizard')).toBeHidden();
});
