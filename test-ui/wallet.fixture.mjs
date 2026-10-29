import {expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

export async function fixture(page,{goals=true,empty=false,unavailable=false,authenticated=true,transactions=[],ownStart='2026-10-30',spouseStart='2026-10-30',spouseAmount=75500,now='2026-10-28T12:00:00Z'}={}){
 await page.clock.setFixedTime(new Date(now));
 const accounts=empty?[]:[{id:'plaid-personal',name:'Personal checking',type:'depository',subtype:'checking',source:'plaid',balance:128462,currency:'USD'},{id:'lunchflow-bills',name:'Household bills checking',type:'depository',subtype:'checking',source:'lunchflow',balance:214000,currency:'USD',balanceUnavailable:unavailable}];
 const manual=empty?[]:[{id:'rent',name:'Rent',date:'2026-10-01',amount:80000,billKind:'rent'},{id:'car',name:'Car payment',date:'2026-10-28',amount:30000,billKind:'car-payment'},{id:'electric',name:'Electric',date:'2026-10-29',amount:12500,billKind:'electric'},{id:'internet',name:'Internet',date:'2026-10-20',amount:6000,billKind:'phone-internet'},{id:'credit',name:'Card minimum',date:'2026-10-30',amount:5000,billKind:'credit-card'}].map(b=>({...b,repeat:'monthly',source:'manual'}));
 const planner={accountVisibility:{'plaid-personal':true,'lunchflow-bills':true},billFunding:{rent:'shared',car:'shared',electric:'shared',internet:'shared'},manual,paid:['rent:2026-10-01'],household:empty?{}:{enabled:true,personalAmount:75500,spouseAmount,spouseStartDate:spouseStart,spouseRepeat:'biweekly',personalAccountId:'plaid-personal',billsAccountId:'lunchflow-bills'}};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[{id:1,name:'Capital One',balance:3420,apr:25,minPayment:35,dueDate:'2026-11-04'}],budgetItems:[{id:1,label:'Groceries',amount:100},{id:2,label:'Fuel',amount:100}],budgetSetupVersion:2,startDate:ownStart,takeHome:'1845',savingsGoals:goals?[{id:1,name:'Emergency fund',goal:2000,start:850,contribution:75}]:[],savingsGoalIdCounter:goals?1:0}),'income-planner':JSON.stringify(planner),onboarding:JSON.stringify({completed:true})}},revision:0};
 let failSavings=false;
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated,accountId:authenticated?'test':undefined,email:authenticated?'you@example.com':undefined,googleConfigured:true,microsoftConfigured:true}});
  if(path==='/api/classic'){
   if(req.method()==='GET')return route.fulfill({json:tracker});
   if(failSavings&&JSON.parse(req.postDataJSON().state.values['app-state']).showSavingsTracker===false)return route.fulfill({status:500,json:{error:'Could not save preference.'}});
   tracker={state:req.postDataJSON().state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections:{items:[],transactions,creditCards:[],gmailMessages:[],recurringBills:[]},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 if(!authenticated)await page.addInitScript(values=>{for(const [key,value] of Object.entries(values))if(localStorage.getItem('bearden:classic:'+key)===null)localStorage.setItem('bearden:classic:'+key,value);},tracker.state.values);
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await expect(page.locator('#configureHousehold')).toBeEnabled();await expect(page.locator('#billTrackerMonth')).toHaveText('October bills');
 return {accounts,set failSavings(value){failSavings=value;},get tracker(){return tracker;}};
}


export async function menuGo(page, target) {
 await page.locator('#denOpen').click();
 const destination=target==='tools'?'settings':target;
 await page.locator('#denMenu [data-den-go="'+destination+'"]').first().click();
 await expect(page.locator('#denMenu')).not.toBeVisible();
 if(target==='tools')await page.locator('#bdToolsButton').click();
}
