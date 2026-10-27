import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runtime} from '../cloudflare/worker.mjs';
import {blank} from '../public/engine.mjs';

async function fixture(page,{unavailable=false,blockSavings=false,holdSavings=false}={}){
 let releaseSavings;const savingsWait=holdSavings?new Promise(resolve=>releaseSavings=resolve):null;
 await page.clock.setFixedTime(new Date('2026-10-27T16:00:00Z'));
 const accounts=[{id:'lunchflow-personal',name:'Personal checking',balance:120025},{id:'lunchflow-bills',name:'Bills checking',balance:500000,balanceUnavailable:unavailable}].map(a=>({...a,source:'lunchflow',type:'depository',subtype:'checking',currency:'USD',include:true,balanceUpdated:'2026-10-27T15:00:00Z'}));
 const planner={accountVisibility:{'lunchflow-personal':true,'lunchflow-bills':true},manual:[{id:'rent',name:'Rent',date:'2026-11-01',amount:200000,repeat:'monthly',source:'manual',billKind:'rent'}],billFunding:{rent:'shared'},household:{enabled:true,personalAccountId:accounts[0].id,billsAccountId:accounts[1].id,personalAmount:75000,spouseAmount:75000,spouseStartDate:'2026-11-06',spouseRepeat:'biweekly'}};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'2000',savingsGoals:[]}),onboarding:JSON.stringify({completed:true}),'income-planner':JSON.stringify(planner)}},revision:0};
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
 return {releaseSavings,get planner(){return JSON.parse(tracker.state.values['income-planner']);}};
}

for(const [width,theme]of [[390,'light'],[320,'dark']])test(`${width}px ${theme}: accounts load and the reclaim button checks a full year`,async({page})=>{
 await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const data=await fixture(page);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(page.locator('#debtIncomeSummary .income-total')).toHaveText('$1,200.25');
 await expect(page.locator('#billTrackerBalance')).toHaveText('$5,000.00');
 await page.locator('#nav-accounts').click();await expect(page.locator('#billsForecast')).toContainText('Rent');
 await expect(page.locator('#billsForecastCard [data-forecast-days="30"]')).toHaveAttribute('aria-pressed','true');
 const before=structuredClone(data.planner.household);
 await expect(page.locator('#billsSavingsPanel')).toBeHidden();await page.locator('#openBillsSavings').click();
 await page.locator('#checkBillsReclaim').click();
 await expect(page.locator('#billsSavingsResult')).toContainText('Yes — $1,500 each fits');
 await expect(page.locator('#billsSavingsStatus')).toContainText('Oct 27, 2027');
 await expect(page.locator('#billsSavingsResult li')).toHaveCount(2);
 await expect(page.locator('#billsSavingsResult li').first()).toContainText('You: $750.00 · Spouse: $750.00');
 expect(data.planner.household).toEqual(before);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#clearBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toBeHidden();await expect(page.locator('#billsSavingsStatus')).toHaveText('Results cleared.');
 await page.locator('#checkBillsReclaim').click();await page.locator('#closeBillsSavings').click();await expect(page.locator('#billsSavingsPanel')).toBeHidden();await page.locator('#openBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toBeHidden();
 await page.locator('#billsSavingsBuffer').fill('200');await expect(page.locator('#billsSavingsResult')).toBeHidden();
 await page.locator('#calculateBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toContainText('Potential savings now');
 await page.locator('#billsForecastCard [data-forecast-days="365"]').click();await expect(page.locator('#billsForecastRangeStatus')).toContainText('Oct 27, 2027');
 await expect(page.locator('#billsSavingsResult')).toBeHidden();
 const ledger=page.locator('#billsForecast .forecast-ledger-scroll');expect(await ledger.evaluate(el=>el.scrollHeight>el.clientHeight&&el.clientHeight<=465)).toBe(true);await ledger.evaluate(el=>el.scrollTop=200);expect(await ledger.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});

test('a missing balance blocks the reclaim check without preventing account loading',async({page})=>{
 await fixture(page,{unavailable:true});await expect(page.locator('#billTrackerBalance')).toHaveText('Unavailable');
 await page.locator('#nav-accounts').click();await page.locator('#openBillsSavings').click();await page.locator('#checkBillsReclaim').click();
 await expect(page.locator('#billsSavingsStatus')).toContainText('Refresh Lunch Flow');await expect(page.locator('#billsSavingsResult')).toBeHidden();
});


test('an unavailable optional calculator cannot prevent bank balances and accounts from loading',async({page})=>{
 await fixture(page,{blockSavings:true});
 await expect(page.locator('#debtIncomeSummary .income-total')).toHaveText('$1,200.25');
 await expect(page.locator('#billTrackerBalance')).toHaveText('$5,000.00');
 await page.locator('#nav-accounts').click();await expect(page.locator('#billsForecast')).toContainText('Rent');
 await page.locator('#openBillsSavings').click();await page.locator('#checkBillsReclaim').click();
 await expect(page.locator('#billsSavingsStatus')).toContainText('Could not calculate savings');
 await page.locator('#accounts-nav-bills').click();await expect(page.locator('#billAgenda')).toContainText('Rent');
});


test('closing while the calculator loads cancels the pending result',async({page})=>{
 const data=await fixture(page,{holdSavings:true});await page.locator('#nav-accounts').click();await page.locator('#openBillsSavings').click();
 const requested=page.waitForRequest(/bills-savings.mjs/);await page.locator('#checkBillsReclaim').click();await requested;
 await page.locator('#closeBillsSavings').click();data.releaseSavings();
 await page.evaluate(()=>import('/bills-savings.mjs?v=bills-reclaim1'));
 await page.locator('#openBillsSavings').click();await expect(page.locator('#billsSavingsResult')).toBeHidden();await expect(page.locator('#billsSavingsStatus')).toHaveText('');
 await page.locator('#checkBillsReclaim').click();await expect(page.locator('#billsSavingsResult')).toContainText('Yes — $1,500 each fits');
});
