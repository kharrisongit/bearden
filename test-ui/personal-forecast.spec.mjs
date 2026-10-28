import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runtime} from '../cloudflare/worker.mjs';
import {blank} from '../public/engine.mjs';

async function fixture(page,{personalAmount=75500,cards=[{id:1,name:'Visa',balance:10000,apr:0,min:50,monthlyMinimum:108.33}]}={}){
 await page.setViewportSize({width:390,height:844});
 await page.clock.setFixedTime(new Date('2026-10-28T16:00:00Z'));
 const accounts=[{id:'lunchflow-personal',name:'Personal checking',balance:5872},{id:'lunchflow-bills',name:'Bills checking',balance:200000},{id:'lunchflow-other',name:'Other checking',balance:9999999}].map(a=>({...a,source:'lunchflow',type:'depository',subtype:'checking',currency:'USD',include:true,balanceUpdated:'2026-10-28T15:00:00Z'}));
 const planner={accountVisibility:Object.fromEntries(accounts.map(a=>[a.id,true])),manual:[{id:'rent',name:'Rent',date:'2026-11-10',amount:120000,repeat:'monthly',source:'manual',billKind:'rent'}],billFunding:{rent:'shared'},household:{enabled:true,personalAccountId:accounts[0].id,billsAccountId:accounts[1].id,personalAmount,spouseAmount:50000,spouseStartDate:'2026-11-06',spouseRepeat:'biweekly'}};
 // Use the real payoff engine and its label-based budget rows. No schedule is mocked.
 const state={cards,cardIdCounter:1,budgetItems:[{id:1,label:'Car Fuel',amount:100},{id:2,label:'Groceries',amount:100},{id:3,label:'Personal spending',amount:25}],budgetItemIdCounter:3,budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1840.23',payoffMethod:'snowball',savingsGoals:[]};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify(state),onboarding:JSON.stringify({completed:true}),'income-planner':JSON.stringify(planner)}},revision:0};
 const app=runtime({APP_URL:'https://bearden.test',ASSETS:{fetch:async req=>{
  const path=new URL(req.url).pathname,name=path==='/'?'index.html':path.slice(1);
  try{return new Response(readFileSync(new URL('../public/'+name,import.meta.url)),{headers:{'Content-Type':name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'}});}catch{return new Response('',{status:404});}
 }}});
 await page.route('https://bearden.test/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'personal-forecast-fixture',bankProvider:'lunchflow'}});
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
 await page.locator('#nav-income').click();
}

test('personal forecast retains spending money after Fixed Bills and respects debt comparison modes',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page);
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(860.23);
 const forecast=page.locator('#incomeForecast'),rows=forecast.locator('.forecast-ledger-row');
 await expect(forecast.locator('.forecast-main')).toHaveText('$508.72');
 await expect(forecast.locator('.forecast-incoming strong')).toHaveText('$3,680.46');
 await expect(forecast.locator('.forecast-outgoing strong')).toHaveText('$3,230.46');
 await expect(forecast.locator('.forecast-lowest strong')).toHaveText('$58.72');
 await expect(forecast.locator('.forecast-warning')).toHaveCount(0);
 await expect(rows).toHaveCount(2);
 await expect(rows.locator(':scope > strong')).toHaveText(['+$225.00','+$225.00']);
 await expect(rows.first()).toContainText('Fixed Bills');
 await expect(forecast).not.toContainText('Fixed Bills transfer');
 await expect(forecast).not.toContainText('Rent');
 await expect(page.locator('#forecastPoint')).toContainText('$508.72');

 // Scrubbing includes the complete payday once, and totals reconcile with the chart.
 await page.locator('#forecastScrub').fill('9');
 await expect(rows).toHaveCount(1);
 await expect(forecast.locator('.forecast-main')).toHaveText('$283.72');
 await expect(forecast.locator('.forecast-incoming strong')).toHaveText('$1,840.23');
 await expect(forecast.locator('.forecast-outgoing strong')).toHaveText('$1,615.23');
 await expect(forecast.locator('.forecast-lowest strong')).toHaveText('$58.72');
 await expect(page.locator('#forecastPoint')).toContainText('$283.72');
 await page.locator('#forecastScrub').fill('30');

 for(const [mode,payday,ending,outgoing]of [['minimum','+$1,035.23','$2,129.18','$1,610.00'],['none','+$1,085.23','$2,229.18','$1,510.00'],['full','+$225.00','$508.72','$3,230.46']]){
  await page.locator('[data-forecast-debt-mode="'+mode+'"]').click();
  await expect(rows.locator(':scope > strong')).toHaveText([payday,payday]);
  await expect(forecast.locator('.forecast-main')).toHaveText(ending);
  await expect(forecast.locator('.forecast-outgoing strong')).toHaveText(outgoing);
  await expect(forecast.locator('.forecast-warning')).toHaveCount(0);
 }
 expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(860.23);

 // Own contributions remain deposits in the separate bills forecast.
 await page.locator('#nav-bills').click();await page.locator('#accounts-nav-calendar').click();
 const shared=page.locator('#billsForecast');
 await expect(shared.locator('.forecast-incoming strong')).toHaveText('$2,510.00');
 await expect(shared.locator('.forecast-outgoing strong')).toHaveText('$1,200.00');
 await expect(shared.locator('.forecast-main')).toHaveText('$3,310.00');
 await expect(shared.locator('.forecast-ledger-row').filter({hasText:'Fixed Bills transfer'}).locator(':scope > strong')).toHaveText(['+$755.00','+$755.00']);
 expect(errors).toEqual([]);
});

test('personal forecast still reports a real shortfall when Fixed Bills exceed the paycheck',async({page})=>{
 await fixture(page,{personalAmount:200000,cards:[]});
 const forecast=page.locator('#incomeForecast');
 await expect(forecast.locator('.forecast-warning')).toContainText('First projected negative balance: Nov 6');
 await expect(forecast.locator('.forecast-warning')).toContainText('-$101.05');
 await expect(forecast.locator('.forecast-main')).toHaveText('-$260.82');
 await expect(forecast.locator('.forecast-lowest strong')).toHaveText('-$260.82');
 await expect(forecast.locator('.forecast-ledger-row > strong')).toHaveText(['−$159.77','−$159.77']);
});
