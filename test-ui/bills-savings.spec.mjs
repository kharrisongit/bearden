import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runtime} from '../cloudflare/worker.mjs';
import {blank} from '../public/engine.mjs';

async function fixture(page,{unavailable=false,blockSavings=false,holdSavings=false,shortfall=false,opening=500000,personalAmount=75000,spouseAmount=75000,billAmount=200000,extraBills=[],personalStart='2026-11-06',spouseStart=personalStart}={}){
 let releaseSavings;const savingsWait=holdSavings?new Promise(resolve=>releaseSavings=resolve):null;
 await page.clock.setFixedTime(new Date('2026-10-27T16:00:00Z'));
 const accounts=[{id:'lunchflow-personal',name:'Personal checking',balance:120025},{id:'lunchflow-bills',name:'Bills checking',balance:shortfall?199000:opening,balanceUnavailable:unavailable}].map(a=>({...a,source:'lunchflow',type:'depository',subtype:'checking',currency:'USD',include:true,balanceUpdated:'2026-10-27T15:00:00Z'}));
 const planner={accountVisibility:{'lunchflow-personal':true,'lunchflow-bills':true},manual:[{id:'rent',name:'Rent',date:'2026-11-01',amount:billAmount,repeat:'monthly',source:'manual',billKind:'rent'},...extraBills],billFunding:{rent:'shared',...Object.fromEntries(extraBills.map(b=>[b.id,'shared']))},household:{enabled:true,personalAccountId:accounts[0].id,billsAccountId:accounts[1].id,personalAmount,spouseAmount,spouseStartDate:spouseStart,spouseRepeat:'biweekly'}};
 let failSave=false;let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,startDate:personalStart,takeHome:'2000',savingsGoals:[]}),onboarding:JSON.stringify({completed:true}),'income-planner':JSON.stringify(planner)}},revision:0};
 // Browser requests go through the production allowlist, not straight to disk.
 const app=runtime({APP_URL:'https://bearden.test',ASSETS:{fetch:async req=>{
  const path=new URL(req.url).pathname,name=path==='/'?'index.html':path.slice(1);
  try{return new Response(readFileSync(new URL('../public/'+name,import.meta.url)),{headers:{'Content-Type':name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'}});}catch{return new Response('',{status:404});}
 }}});
 await page.route('https://bearden.test/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(holdSavings&&path==='/bills-savings.mjs')await savingsWait;
  if(blockSavings&&path==='/bills-savings.mjs')return route.fulfill({status:404,json:{error:'Missing calculator'}});
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'fixture',bankProvider:'lunchflow'}});
  if(path==='/api/banks/retire')return route.fulfill({json:{ok:true}});
  if(path==='/api/classic'){
   if(request.method()==='POST'&&failSave)return route.fulfill({status:500,json:{error:'Save failed. Try again.'}});
   if(request.method()==='POST')tracker={state:request.postDataJSON().state,revision:tracker.revision+1};
   return route.fulfill({json:request.method()==='GET'?tracker:{revision:tracker.revision}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections:{items:[],transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const response=await app.handle(new Request(request.url()));
  return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
 await expect(page.locator('#configureHousehold')).toBeEnabled();
 return {releaseSavings,failSave:value=>failSave=value,get planner(){return JSON.parse(tracker.state.values['income-planner']);}};
}

for(const [width,theme]of [[390,'light'],[320,'dark']])test(`${width}px ${theme}: accounts load and Savings Finder protects a year beyond both second three-paycheck months`,async({page})=>{
 await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const data=await fixture(page);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(page.locator('#debtIncomeSummary .income-total')).toHaveText('$1,200.25');await expect(page.locator('#billTrackerBalance')).toHaveText('$5,000.00');
 await page.locator('#nav-accounts').click();await expect(page.locator('#billsForecast')).toContainText('Rent');
 const before=structuredClone(data.planner.household);
 await expect(page.locator('#openBillsReclaim,#billsReclaimPanel')).toHaveCount(0);
 await page.locator('#openBillsSavings').click();await page.locator('#calculateBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toContainText('Potential savings now');await expect(page.locator('#billsSavingsStatus')).toContainText('Jul 30, 2028');
 await page.locator('#clearBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toBeHidden();
 await page.locator('#closeBillsSavings').click();await expect(page.locator('#billsSavingsPanel')).toBeHidden();await page.locator('#openBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toBeHidden();
 expect(data.planner.household).toEqual(before);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#billsForecastCard [data-forecast-days="365"]').click();await expect(page.locator('#billsForecastRangeStatus')).toContainText('Oct 27, 2027');
 const ledger=page.locator('#billsForecast .forecast-ledger-scroll');expect(await ledger.evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=465)).toBe(true);await ledger.evaluate(el=>el.scrollTop=200);expect(await ledger.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});

test('a missing balance blocks savings without preventing account loading',async({page})=>{
 await fixture(page,{unavailable:true});await expect(page.locator('#billTrackerBalance')).toHaveText('Unavailable');
 await page.locator('#nav-accounts').click();await page.locator('#openBillsSavings').click();await page.locator('#calculateBillsSavings').click();
 await expect(page.locator('#billsSavingsStatus')).toContainText('Refresh Lunch Flow');await expect(page.locator('#billsSavingsResult')).toBeHidden();
});


test('an unavailable optional calculator cannot prevent bank balances and accounts from loading',async({page})=>{
 await fixture(page,{blockSavings:true});
 await expect(page.locator('#debtIncomeSummary .income-total')).toHaveText('$1,200.25');
 await expect(page.locator('#billTrackerBalance')).toHaveText('$5,000.00');
 await page.locator('#nav-accounts').click();await expect(page.locator('#billsForecast')).toContainText('Rent');
 await page.locator('#openBillsSavings').click();await page.locator('#calculateBillsSavings').click();
 await expect(page.locator('#billsSavingsStatus')).toContainText('Could not calculate savings');
 await page.locator('#accounts-nav-bills').click();await expect(page.locator('#billAgenda')).toContainText('Rent');
});


test('closing while the calculator loads cancels the pending result',async({page})=>{
 const data=await fixture(page,{holdSavings:true});await page.locator('#nav-accounts').click();await page.locator('#openBillsSavings').click();
 const requested=page.waitForRequest(/bills-savings.mjs/);await page.locator('#calculateBillsSavings').click();await requested;
 await page.locator('#closeBillsSavings').click();data.releaseSavings();
 await page.evaluate(()=>import('/bills-savings.mjs?v=reclaim-funding1'));
 await page.locator('#openBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toBeHidden();await expect(page.locator('#billsSavingsStatus')).toHaveText('');
 await page.locator('#calculateBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toContainText('Potential savings now');
});


test('shortfalls become saved one-time deposits, preserve later savings, and can be removed or marked received',async({page})=>{
 const data=await fixture(page,{shortfall:true});await page.locator('#nav-accounts').click();await page.locator('#openBillsSavings').click();await page.locator('#calculateBillsSavings').click();
 await expect(page.locator('#billsSavingsResult')).toContainText('Funding gaps first');await expect(page.locator('#billsSavingsResult')).toContainText('$110.00');await expect(page.locator('#billsSavingsResult')).toContainText('Total to savings');
 expect(data.planner.household.additionalDeposits).toBeUndefined();
 await page.locator('[data-plan-extra="savings"]').click();await expect(page.locator('#plannedExtraDeposits')).toContainText('1 planned');
 expect(data.planner.household.additionalDeposits).toHaveLength(1);expect(data.planner.household.additionalDeposits[0]).toMatchObject({amount:11000,date:'2026-10-31',source:'personal',received:false});
 await expect(page.locator('#billsForecast')).toContainText('One-time extra deposit');
 await page.locator('#calculateBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toContainText('No further deposits');await expect(page.locator('[data-plan-extra="savings"]')).toHaveCount(0);
 await page.reload();await expect(page.locator('#configureHousehold')).toBeEnabled();await page.locator('#nav-accounts').click();await expect(page.locator('#plannedExtraDeposits')).toContainText('1 planned');
 page.once('dialog',d=>d.accept());await page.locator('[data-extra-received]').click();await expect(page.locator('#plannedExtraDeposits')).toContainText('Received');expect(data.planner.household.additionalDeposits[0].received).toBe(true);
 await page.locator('[data-extra-received]').click();await expect(page.locator('#plannedExtraDeposits')).toContainText('1 planned');
 page.once('dialog',d=>d.accept());await page.locator('[data-extra-remove]').click();await expect(page.locator('#plannedExtraDeposits')).toBeEmpty();expect(data.planner.household.additionalDeposits).toHaveLength(0);
});

test('desktop expands the calendar and both live forecasts and restores them without duplicate controls',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await fixture(page);await page.locator('#nav-accounts').click();
 await page.locator('[data-expand-card="billCalendarCard"]').click();await expect(page.locator('#expandedAccountView #billCalendarCard')).toBeVisible();
 expect(await page.locator('#expandedAccountView').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(1000);
 await page.mouse.click(3,3);await expect(page.locator('#expandedAccountView')).toBeVisible();await page.locator('#monthNext').click();await expect(page.locator('#calendarMonth')).toHaveText('November 2026');
 await page.locator('#closeExpandedAccountView').click();await expect(page.locator('#accounts-calendar > #billCalendarCard')).toBeVisible();await expect(page.locator('#calendarMonth')).toHaveText('November 2026');
 await page.locator('[data-expand-card="billsForecastCard"]').click();await page.locator('#billsForecastCard [data-forecast-days="365"]').click();await expect(page.locator('#expandedAccountView #billsForecastCard')).toBeVisible();
 await expect(page.locator('#billsForecastCard [data-forecast-days="365"]')).toHaveAttribute('aria-pressed','true');await page.locator('#closeExpandedAccountView').click();await expect(page.locator('#accounts-calendar > #billsForecastCard')).toBeVisible();
 await page.locator('#nav-income').click();await page.locator('[data-expand-card="personalForecastCard"]').click();await expect(page.locator('#expandedAccountView #personalForecastCard')).toBeVisible();await page.locator('#closeExpandedAccountView').click();
 await expect(page.locator('#expandedAccountView')).toBeHidden();await expect(page.locator('#tab-income #personalForecastCard')).toBeVisible();
 for(const id of ['billCalendarCard','billsForecastCard','personalForecastCard'])await expect(page.locator('#'+id)).toHaveCount(1);
});

test('a missing saved payday requires completing settings before calculating savings',async({page})=>{
 await fixture(page,{spouseStart:''});await page.locator('#nav-accounts').click();await page.locator('#openBillsSavings').click();await page.locator('#calculateBillsSavings').click();
 await expect(page.locator('#billsSavingsStatus')).toContainText('Set both payday dates');await expect(page.locator('#billsSavingsResult')).toBeHidden();await expect(page.locator('#billsSavingsForm input[type=date]')).toHaveCount(0);
});
