import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

async function fixture(page,{connected=false,legacy=false}={}){
 await page.setViewportSize({width:390,height:844});await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 const water={id:'water',name:'Water',amount:6000,date:'2026-11-12',repeat:'monthly',billKind:'utility',source:legacy?'legacy':'manual'};
 const cards=[{id:1,name:'Visa',debtKind:'credit-card',balance:250,apr:0,min:23.08,monthlyMinimum:50},{id:2,name:'Other loan',debtKind:'loan',balance:100,apr:0,min:23.08,monthlyMinimum:50}];
 const planner={manual:legacy?[]:[water],covered:{water:false},billFunding:{water:'personal'},transactionLinks:{'bill:water':{merchant:'water',accountId:'checking'},'debt:1':{merchant:'visa',accountId:'checking'}},creditCards:connected?{'credit-a':{trackerCardId:'1',tracking:true,fallbackAmount:5000,fallbackDate:'2026-11-12'}}:{}};
 const connections={items:[],transactions:[],creditCards:connected?[{id:'credit-a',accountId:'a',itemId:'bank',name:'Visa',currency:'USD',balance:25000,minimum:5000,dueDate:'2026-11-12',aprs:[],updated:'2026-10-26T12:00:00Z'}]:[],gmailMessages:[],recurringBills:[]};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards,cardIdCounter:2,budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1000',savingsGoals:[]}),onboarding:JSON.stringify({completed:true}),'income-planner':JSON.stringify(planner)}},revision:0},fail=false;const saves=[];
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/banks/retire')return route.fulfill({json:{ok:true}});
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'test'}});
  if(path==='/api/classic'){
   if(req.method()==='GET')return route.fulfill({json:tracker});
   if(fail)return route.fulfill({status:500,json:{error:'Save failed. Please try again.'}});
   tracker={state:req.postDataJSON().state,revision:tracker.revision+1};saves.push(structuredClone(tracker.state.values));return route.fulfill({json:{revision:tracker.revision}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),bills:legacy?[water]:[],accounts:[]},connections,revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await expect(page.locator('#configureHousehold')).toBeEnabled();
 return {failSave:value=>fail=value,saves,get tracker(){return tracker;}};
}
async function openDebt(page,connected=false){await page.locator('#nav-debts').click();await page.locator(connected?'[data-edit-credit="credit-a"]':'[data-edit-debt="1"]').first().click();}
async function confirmDelete(page,selector,accept=true){page.once('dialog',dialog=>accept?dialog.accept():dialog.dismiss());await page.locator(selector).click();}

test('manual debt deletion is at the bottom, can be cancelled, and removes only that debt after reload',async({page})=>{
 const f=await fixture(page);await openDebt(page);await expect(page.locator('#deleteDebtAccount')).toBeVisible();
 expect(await page.locator('#deleteDebtAccount').evaluate(el=>el.closest('dialog').lastElementChild.contains(el)&&!!(el.closest('dialog').querySelector('form').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await page.screenshot({path:'test-results/delete-debt-mobile.png'});
 await confirmDelete(page,'#deleteDebtAccount',false);expect(await page.evaluate(()=>window.getDebtPlan().state.cards.length)).toBe(2);
 await confirmDelete(page,'#deleteDebtAccount');await expect(page.locator('#debtEditor')).toBeHidden();await expect(page.locator('[data-tracker-account="1"]')).toHaveCount(0);await expect(page.locator('[data-tracker-account="2"]')).toHaveCount(1);
 expect(JSON.parse(f.tracker.state.values['app-state']).cards.map(c=>c.id)).toEqual([2]);expect(JSON.parse(f.tracker.state.values['income-planner']).transactionLinks['debt:1']).toBeUndefined();
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('#heroTotal')).toHaveText('$100.00');expect(await page.evaluate(()=>window.getDebtPlan().state.cards.map(c=>c.id))).toEqual([2]);
});

test('deleting a connected debt removes its matched tracker debt in the same save and stays removed on refresh',async({page})=>{
 const f=await fixture(page,{connected:true});await openDebt(page,true);await confirmDelete(page,'#deleteCreditAccount');await expect(page.locator('#creditEditor')).toBeHidden();
 await expect(page.locator('#heroTotal')).toHaveText('$100.00');expect(JSON.parse(f.tracker.state.values['income-planner']).hiddenConnectedAccounts['plaid-a']).toBe(true);
 for(const values of f.saves){const cards=JSON.parse(values['app-state']).cards,p=JSON.parse(values['income-planner']);if(!cards.some(c=>c.id===1))expect(p.creditCards['credit-a'].tracking).toBe(false);}
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('#heroTotal')).toHaveText('$100.00');await expect(page.locator('[data-edit-credit="credit-a"]')).toHaveCount(0);
});

for(const legacy of [false,true])test((legacy?'synced':'manual')+' bill deletion clears future payments and stays deleted after reload',async({page})=>{
 const f=await fixture(page,{legacy});await page.locator('#nav-bills').click();await page.locator('#accounts-nav-bills').click();await page.locator('[data-edit-bill="water"]').first().click();
 await expect(page.locator('#stopTrackingBill')).toHaveText('Delete bill');expect(await page.locator('#stopTrackingBill').evaluate(el=>el.closest('dialog').lastElementChild.contains(el)&&!!(el.closest('dialog').querySelector('form').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await confirmDelete(page,'#stopTrackingBill',false);await expect(page.locator('#billEditor')).toBeVisible();expect(JSON.parse(f.tracker.state.values['income-planner']).deletedBills?.water).toBeUndefined();
 await confirmDelete(page,'#stopTrackingBill');await expect(page.locator('#billEditor')).toBeHidden();await expect(page.locator('[data-edit-bill="water"]')).toHaveCount(0);
 expect(JSON.parse(f.tracker.state.values['income-planner']).transactionLinks['bill:water']).toBeUndefined();
 expect(await page.evaluate(()=>window.getDebtPlan().schedule.some(row=>row.accountBillsThisCheck.some(b=>b.id==='water')))).toBe(false);
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('#configureHousehold')).toBeEnabled();await expect(page.locator('[data-edit-bill="water"]')).toHaveCount(0);
});

test('failed deletion leaves the debt and links intact and can be retried',async({page})=>{
 const f=await fixture(page);await openDebt(page);f.failSave(true);await confirmDelete(page,'#deleteDebtAccount');await expect(page.locator('#debtEditorError')).toContainText('Save failed');await expect(page.locator('#debtEditor')).toBeVisible();
 expect(await page.evaluate(()=>window.getDebtPlan().state.cards.length)).toBe(2);expect(JSON.parse(f.tracker.state.values['income-planner']).transactionLinks['debt:1']).toBeDefined();
 f.failSave(false);await confirmDelete(page,'#deleteDebtAccount');await expect(page.locator('#debtEditor')).toBeHidden();expect(JSON.parse(f.tracker.state.values['app-state']).cards.map(c=>c.id)).toEqual([2]);
});


test('desktop popups keep unsaved edits after backdrop clicks and Escape until Close is clicked',async({page})=>{
 await fixture(page);await page.setViewportSize({width:1280,height:900});await openDebt(page);
 await page.locator('#debtEditorForm [name="name"]').fill('Unsaved name');
 await page.mouse.click(3,3);await expect(page.locator('#debtEditor')).toBeVisible();await expect(page.locator('#debtEditorForm [name="name"]')).toHaveValue('Unsaved name');
 await page.keyboard.press('Escape');await expect(page.locator('#debtEditor')).toBeVisible();await page.locator('#closeDebtEditor').click();await expect(page.locator('#debtEditor')).toBeHidden();
 await page.locator('#nav-bills').click();await page.locator('#accounts-nav-bills').click();await page.locator('[data-edit-bill="water"]').first().click();await page.mouse.click(3,3);await expect(page.locator('#billEditor')).toBeVisible();await page.locator('#closeBillEditor').click();await expect(page.locator('#billEditor')).toBeHidden();
 await page.evaluate(()=>document.querySelector('#accountPicker').showModal());await page.mouse.click(3,3);await expect(page.locator('#accountPicker')).toBeVisible();await page.locator('#closeAccountPicker').click();await expect(page.locator('#accountPicker')).toBeHidden();
});
