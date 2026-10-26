import {test,expect} from '@playwright/test';import {readFileSync} from 'node:fs';import {blank} from '../public/engine.mjs';
async function fixture(page){
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[{id:1,name:'Visa',balance:10000,apr:0,min:46.15,monthlyMinimum:100,dueDate:'2026-11-30'}],cardIdCounter:1,budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1000',payoffMethod:'minimum',savingsGoals:[{id:1,name:'Emergency',goal:1000,start:100,contribution:0}],savingsGoalIdCounter:1}),onboarding:JSON.stringify({completed:true})}},revision:0};
 let releaseSync,startedSync;const started=new Promise(r=>startedSync=r),gate=new Promise(r=>releaseSync=r);let bankRefreshes=0;
 const connections={items:[{id:'bank',name:'Bank'}],simplefin:{connected:true,status:'Connected'},emailConnected:true,mailAccounts:[{id:'mail',email:'person@hotmail.com',provider:'microsoft'}],sun:{enabled:true,connected:true,status:'Connected'},transactions:[],candidates:[],creditCards:[],gmailMessages:[],recurringBills:[]};
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,email:'person@hotmail.com',accountId:'test',microsoftConfigured:true}});
  if(path==='/api/classic'){if(req.method()==='GET')return route.fulfill({json:tracker});const b=req.postDataJSON();tracker={state:b.state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});}
  if(path==='/api/state')return route.fulfill({json:{state:blank(),connections,revision:0}});
  if(path==='/api/bank/refresh'){if(++bankRefreshes===1){startedSync();await gate;}return route.fulfill({json:{status:'Bank refreshed.'}});}
  if(['/api/simplefin/refresh','/api/sync','/api/rent/refresh'].includes(path))return route.fulfill({json:{status:'Updated.'}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
 return {started,releaseSync,get tracker(){return tracker;}};
}
test('timing settings persist, debt due dates edit, and an extra payment can be added to an empty check',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const f=await fixture(page);
 await page.locator('#nav-settings').click();await page.locator('#debtPaymentTiming').selectOption('due-date');await expect(page.locator('#featureSettingsStatus')).toHaveText('Debt payment timing saved.');
 await page.locator('#nav-debt').click();await expect(page.locator('#paycheck-card-1')).toContainText('No debt payment scheduled');await page.locator('[data-add-debt-payment="1"]').click();
 await page.locator('#addDebtPaymentForm input[name="amount"]').fill('1100');await page.getByRole('button',{name:'Add to this paycheck',exact:true}).click();await expect(page.locator('#addDebtPaymentError')).toContainText('Not enough money');
 await page.locator('#addDebtPaymentForm input[name="amount"]').fill('75');await page.getByRole('button',{name:'Add to this paycheck',exact:true}).click();await expect(page.locator('#addDebtPaymentDialog')).not.toBeVisible();
 expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(75);
 await page.reload();await page.evaluate(()=>window.classicReady);expect(await page.evaluate(()=>window.getDebtPlan().state.debtPaymentSettings.mode)).toBe('due-date');expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(75);
 await page.locator('#nav-accounts').click();await page.locator('#accounts-nav-debt').click();await page.locator('[data-edit-debt="1"]').first().click();await expect(page.locator('#debtEditorForm input[name="dueDate"]')).toHaveValue('2026-11-30');await page.locator('#debtEditorForm input[name="dueDate"]').fill('2026-11-15');await page.getByRole('button',{name:'Save debt',exact:true}).click();await expect(page.locator('#debtEditor')).not.toBeVisible();
 expect(JSON.parse(f.tracker.state.values['app-state']).cards[0].dueDate).toBe('2026-11-15');expect(errors).toEqual([]);
});
test('connection badges sit beside headings, saving footer is absent, and dismissed sync stays dismissed',async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=await fixture(page);await page.locator('#nav-settings').click();
 for(const id of ['classicBankStatus','simplefinStatus','classicEmailStatus','rentStatus']){
  const badge=page.locator('#'+id);await expect(badge).toHaveText('Connected');expect(await badge.evaluate(el=>{const b=el.getBoundingClientRect(),h=el.previousElementSibling.getBoundingClientRect();return b.left>=h.right&&Math.abs(b.top+b.height/2-h.top-h.height/2)<2;})).toBe(true);
 }
 await expect(page.locator('#storageStatus')).toHaveCount(0);await page.locator('#classicSync').click();await f.started;await expect(page.locator('#connectionMessage')).toContainText('Refreshing');await page.locator('#dismissConnectionMessage').click();await expect(page.locator('#connectionMessage')).toBeEmpty();f.releaseSync();await expect(page.locator('#classicSync')).toBeEnabled();await expect(page.locator('#connectionMessage')).toBeEmpty();await expect(page.locator('#dismissConnectionMessage')).toBeHidden();
 await page.locator('#classicSync').click();await expect(page.locator('#connectionMessage')).toContainText('Bank refreshed');await page.locator('#dismissConnectionMessage').click();await expect(page.locator('#connectionMessage')).toBeEmpty();
 await page.locator('#nav-debt').click();await expect(page.getByRole('button',{name:'Withdraw from savings',exact:true}).locator('svg.savings-withdraw-icon')).toHaveCount(1);await page.getByRole('button',{name:'Withdraw from savings',exact:true}).click();await expect(page.locator('#savingsWithdrawPanel-1')).toHaveClass(/open/);
});
