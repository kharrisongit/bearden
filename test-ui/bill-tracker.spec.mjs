import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

async function fixture(page,{goals=true,empty=false,unavailable=false}={}){
 await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 const accounts=empty?[]:[{id:'plaid-personal',name:'Personal checking',type:'depository',subtype:'checking',source:'plaid',balance:999911,currency:'USD'},{id:'lunchflow-bills',name:'Household bills checking',type:'depository',subtype:'checking',source:'lunchflow',balance:75025,currency:'USD',balanceUnavailable:unavailable}];
 const manual=empty?[]:[{id:'rent',name:'Rent',date:'2026-10-01',amount:80000,billKind:'rent'},{id:'car',name:'Car payment',date:'2026-10-28',amount:30000,billKind:'car-payment'},{id:'electric',name:'Electric',date:'2026-10-29',amount:12500,billKind:'electric'},{id:'internet',name:'Internet',date:'2026-10-20',amount:6000,billKind:'phone-internet'},{id:'credit',name:'Card minimum',date:'2026-10-30',amount:5000,billKind:'credit-card'}].map(b=>({...b,repeat:'monthly',source:'manual'}));
 const planner={manual,paid:['rent:2026-10-01'],household:empty?{}:{enabled:false,personalAccountId:'plaid-personal',billsAccountId:'lunchflow-bills'}};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1800',savingsGoals:goals?[{id:1,name:'Emergency',goal:1000,start:100,contribution:50}]:[],savingsGoalIdCounter:goals?1:0}),'income-planner':JSON.stringify(planner),onboarding:JSON.stringify({completed:true})}},revision:0};
 let failSavings=false;
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'test'}});
  if(path==='/api/classic'){
   if(req.method()==='GET')return route.fulfill({json:tracker});
   if(failSavings&&JSON.parse(req.postDataJSON().state.values['app-state']).showSavingsTracker===false)return route.fulfill({status:500,json:{error:'Could not save preference.'}});
   tracker={state:req.postDataJSON().state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections:{items:[],transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await expect(page.locator('#configureHousehold')).toBeEnabled();await expect(page.locator('#billTrackerMonth')).toHaveText('October bills');
 return {accounts,set failSavings(value){failSavings=value;},get tracker(){return tracker;}};
}

for(const [width,theme]of [[390,'light'],[320,'dark']])test(`Bill Tracker at ${width}px ${theme} shows current-month bills and navigates to Bills`,async({page})=>{
 await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(page.locator('#billTrackerBalance')).toHaveText('$750.25');await expect(page.locator('#billTrackerAccountName')).toHaveText('Household bills checking');
 await expect(page.locator('#billTrackerPaidCount')).toHaveText('1 of 4 paid');await expect(page.locator('#billTrackerTotal')).toHaveText('$1,285.00');await expect(page.locator('#billTrackerRemaining')).toHaveText('$485.00');
 await expect(page.locator('#billTrackerUpcoming li')).toHaveCount(3);await expect(page.locator('#billTrackerUpcoming li').first()).toContainText('Internet');await expect(page.locator('#billTrackerUpcoming li').first()).toContainText('Overdue');
 expect(await page.locator('#debtIncomeCard').evaluate(el=>el.parentElement.nextElementSibling.querySelector('#billTracker')!==null)).toBe(true);
 await page.locator('#billTracker').scrollIntoViewIfNeeded();expect(await page.locator('#billTracker').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:`test-results/bill-tracker-${width}-${theme}.png`});
 await page.locator('[data-open-dashboard-bills]').click();await expect(page.locator('#nav-bills')).toHaveAttribute('aria-selected','true');await expect(page.locator('#accounts-nav-bills')).toHaveAttribute('aria-selected','true');
 await page.locator('#accounts-nav-calendar').click();await page.locator('#monthNext').click();await expect(page.locator('#calendarMonth')).toHaveText('November 2026');
 await page.locator('#nav-debt').click();await expect(page.locator('#billTrackerMonth')).toHaveText('October bills');await expect(page.locator('#billTrackerPaidCount')).toHaveText('1 of 4 paid');
 await page.locator('[data-open-dashboard-bills]').click();await page.locator('[data-bill-paid="car:2026-10-28"]').click();await page.locator('#nav-debt').click();
 await expect(page.locator('#billTrackerPaidCount')).toHaveText('2 of 4 paid');await expect(page.locator('#billTrackerRemaining')).toHaveText('$185.00');await expect(page.locator('#billTrackerTotal')).toHaveText('$1,285.00');
 expect(errors).toEqual([]);
});

test('hiding savings persists without changing goals or paycheck contributions, and a failed save restores visibility',async({page})=>{
 const f=await fixture(page);const before=await page.evaluate(()=>window.getDebtPlan());
 await page.locator('#nav-settings').click();await expect(page.locator('#savingsTrackerToggle')).toBeChecked();
 f.failSavings=true;await page.locator('#savingsTrackerToggle').uncheck();await expect(page.locator('#featureSettingsStatus')).toContainText('Could not save');await expect(page.locator('#savingsTrackerToggle')).toBeChecked();
 f.failSavings=false;await page.locator('#savingsTrackerToggle').uncheck();await expect(page.locator('#featureSettingsStatus')).toHaveText('Savings Tracker preference saved.');
 await page.locator('#nav-debt').click();await expect(page.locator('#savingsHeroContainer')).toBeHidden();await expect(page.locator('#billTracker')).toBeVisible();
 const after=await page.evaluate(()=>window.getDebtPlan());expect(after.state.savingsGoals).toEqual(before.state.savingsGoals);expect(after.schedule[0].savingsByGoal).toEqual(before.schedule[0].savingsByGoal);expect(JSON.parse(f.tracker.state.values['app-state']).showSavingsTracker).toBe(false);
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('#savingsHeroContainer')).toBeHidden();
 await page.locator('#nav-settings').click();await expect(page.locator('#savingsTrackerToggle')).not.toBeChecked();await page.locator('#savingsTrackerToggle').check();await expect(page.locator('#featureSettingsStatus')).toHaveText('Savings Tracker preference saved.');
 await page.locator('#nav-debt').click();await expect(page.locator('#savingsHero-1')).toBeVisible();await expect(page.locator('#savingsHero-1 [title="Add another goal"]')).toBeVisible();
});

test('empty bills stay useful and the savings start button follows the same preference',async({page})=>{
 await fixture(page,{goals:false,empty:true});await expect(page.locator('#billTrackerBalance')).toHaveText('—');await expect(page.locator('#billTrackerPaidCount')).toHaveText('0 of 0 paid');await expect(page.locator('#billTrackerTotal')).toHaveText('$0.00');await expect(page.locator('#billTrackerEmpty')).toContainText('Add bills');
 await expect(page.locator('.start-savings-btn')).toBeVisible();await page.locator('#billTrackerChooseAccount').click();await expect(page.locator('#householdEditor')).toBeVisible();await page.locator('#closeHouseholdEditor').click();
 await page.locator('#nav-settings').click();await page.locator('#savingsTrackerToggle').uncheck();await expect(page.locator('#featureSettingsStatus')).toHaveText('Savings Tracker preference saved.');await page.locator('#nav-debt').click();await expect(page.locator('.start-savings-btn')).toBeHidden();
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('.start-savings-btn')).toBeHidden();
});

test('an unavailable bills-account balance is not replaced with zero or the personal account',async({page})=>{
 const f=await fixture(page,{unavailable:true});await expect(page.locator('#billTrackerBalance')).toHaveText('Unavailable');f.accounts[1].balanceUnavailable=false;f.accounts[1].balance=0;
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('#billTrackerBalance')).toHaveText('$0.00');
});
