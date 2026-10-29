import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

async function fixture(page,{goals=true,empty=false,unavailable=false}={}){
 await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'));
 const accounts=empty?[]:[{id:'plaid-personal',name:'Personal checking',type:'depository',subtype:'checking',source:'plaid',balance:128462,currency:'USD'},{id:'lunchflow-bills',name:'Household bills checking',type:'depository',subtype:'checking',source:'lunchflow',balance:214000,currency:'USD',balanceUnavailable:unavailable}];
 const manual=empty?[]:[{id:'rent',name:'Rent',date:'2026-10-01',amount:80000,billKind:'rent'},{id:'car',name:'Car payment',date:'2026-10-28',amount:30000,billKind:'car-payment'},{id:'electric',name:'Electric',date:'2026-10-29',amount:12500,billKind:'electric'},{id:'internet',name:'Internet',date:'2026-10-20',amount:6000,billKind:'phone-internet'},{id:'credit',name:'Card minimum',date:'2026-10-30',amount:5000,billKind:'credit-card'}].map(b=>({...b,repeat:'monthly',source:'manual'}));
 const planner={accountVisibility:{'plaid-personal':true,'lunchflow-bills':true},billFunding:{rent:'shared',car:'shared',electric:'shared',internet:'shared'},manual,paid:['rent:2026-10-01'],household:empty?{}:{enabled:true,personalAmount:75500,spouseAmount:75500,spouseStartDate:'2026-10-30',spouseRepeat:'biweekly',personalAccountId:'plaid-personal',billsAccountId:'lunchflow-bills'}};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[{id:1,name:'Capital One',balance:3420,apr:25,minPayment:35,dueDate:'2026-11-04'}],budgetItems:[{id:1,label:'Groceries',amount:100},{id:2,label:'Fuel',amount:100}],budgetSetupVersion:2,startDate:'2026-10-30',takeHome:'1845',savingsGoals:goals?[{id:1,name:'Emergency fund',goal:2000,start:850,contribution:75}]:[],savingsGoalIdCounter:goals?1:0}),'income-planner':JSON.stringify(planner),onboarding:JSON.stringify({completed:true})}},revision:0};
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


async function menuGo(page, target) {
 await page.locator('#denOpen').click();
 if(['tools','settings','connections'].includes(target))await page.locator('#denMenu [data-den-go="den"]').click();
 await page.locator('#denMenu [data-den-go="'+target+'"]').first().click();
 await expect(page.locator('#denMenu')).not.toBeVisible();
}
for(const width of [320,390,1280])for(const theme of ['light','dark'])test(`Den ${width}px ${theme}: rich cards, menu and all destinations`,async({page})=>{
 await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page);
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await expect(page.locator('html')).toHaveAttribute('data-layout','den');
 await expect(page.locator('.bottom-tabs')).toBeHidden();await expect(page.locator('#denDock')).toBeVisible();
 await expect(page.locator('#debtIncomeSummary .income-total')).toHaveText('$1,284.62');
 await expect(page.locator('.den-payday-total')).toContainText('$1,845.00');
 await expect(page.locator('.den-remainder strong')).toHaveText(await page.evaluate(()=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(window.getDebtPlan().schedule[0].cashAfterDebt)));
 await expect(page.locator('.den-brand button[aria-label="Settings"]')).toBeVisible();
 await expect(page.locator('.den-contribution')).toContainText('$1,510.00');
 await expect(page.locator('#savingsHero-1 .den-savings-detail')).toContainText('$1,150.00 to go');
 await expect(page.locator('#savingsHero-1 progress')).toHaveAttribute('value','42.5');
 await expect(page.locator('#debtHeroBox .den-debt-next')).toContainText('Next planned debt payments');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/den-overview-${width}-${theme}.png`,fullPage:true});
 if(width===390&&theme==='light')for(const id of ['debtIncomeCard','billTracker','savingsHero-1','debtHeroBox'])await page.locator('#'+id).screenshot({path:'test-results/wallet-tracker-'+id+'.png'});
 await page.locator('#denOpen').click();await expect(page.locator('#denMenu')).toBeVisible();
 await expect(page.locator('#denOpen')).toHaveAttribute('aria-expanded','true');
 const boxes=await page.locator('.den-wallet-card').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
 for(const box of boxes){expect(box.x).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width);expect(box.bottom).toBeGreaterThan(box.y);}
 await page.screenshot({path:`test-results/den-menu-${width}-${theme}.png`});
 await page.keyboard.press('Escape');await expect(page.locator('#denMenu')).toBeHidden();await expect(page.locator('#denOpen')).toBeFocused();
 for(const destination of ['income','bills','debts','tools','settings']){
  await menuGo(page,destination);await expect(page.locator('#tab-'+destination)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width===390&&theme==='light')await page.screenshot({path:`test-results/wallet-page-${destination}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 }
 await menuGo(page,'savings');await expect(page.locator('#savingsHeroContainer')).toBeFocused();
 await page.locator('#savingsHero-1 .den-savings-detail button').first().click();await expect(page.locator('#savingsGoalEdit-1')).toBeVisible();
 await page.locator('#debtHeroBox [data-den-go="plan"]').click();await expect(page.locator('#schedulePlanSection')).toBeFocused();
 await menuGo(page,'overview');await expect(page.locator('.den-intro')).toBeFocused();
 await page.locator('#billTracker .den-bill-actions [data-den-go="forecast"]').click();await expect(page.locator('#billsForecastCard')).toBeVisible();await expect(page.locator('#billsForecastCard')).toBeFocused();
 expect(errors).toEqual([]);
});

test('switching to Original persists across reload and leaves financial data intact',async({page})=>{
 const f=await fixture(page);const before=await page.evaluate(()=>window.getDebtPlan().state);
 await menuGo(page,'settings');await page.locator('#denDesignChoice').selectOption('classic');
 await expect(page.locator('.bottom-tabs')).toBeVisible();await expect(page.locator('#denDock')).toBeHidden();
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('html')).toHaveAttribute('data-layout','classic');
 await page.locator('#nav-settings').click();await page.locator('#denDesignChoice').selectOption('den');
 await expect(page.locator('#denDock')).toBeVisible();await page.reload();await page.evaluate(()=>window.classicReady);
 await expect(page.locator('html')).toHaveAttribute('data-layout','den');
 const after=await page.evaluate(()=>window.getDebtPlan().state);
 for(const key of ['cards','savingsGoals','budgetItems','takeHome','checkedPaychecks'])expect(after[key]).toEqual(before[key]);
 expect(f.tracker.state.values['income-planner']).toBeTruthy();
});

test('hidden savings shortcut opens its visibility control and empty states remain usable',async({page})=>{
 await fixture(page,{empty:true,goals:false});await expect(page.locator('#billTrackerBalance')).toHaveText('—');
 await menuGo(page,'settings');await page.locator('#savingsTrackerToggle').uncheck();await expect(page.locator('#savingsHeroContainer')).toBeHidden();
 await menuGo(page,'savings');await expect(page.locator('#tab-settings')).toBeVisible();await expect(page.locator('#savingsTrackerToggle')).toBeFocused();
});

test('Wallet keyboard focus stays inside the menu, Escape closes, and short screens scroll',async({page})=>{
 await page.setViewportSize({width:390,height:480});await fixture(page);
 await page.locator('#denOpen').click();
 for(let i=0;i<12;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.querySelector('#denMenu').contains(document.activeElement))).toBe(true);}
 await page.locator('#denClose').click();await expect(page.locator('#denMenu')).toBeHidden();
 await page.setViewportSize({width:1280,height:844});await page.locator('#denOpen').click();
 await page.keyboard.press('Escape');await expect(page.locator('#denMenu')).toBeHidden();
});


test('new header cards use live totals and retain the bill, debt, and income editors',async({page})=>{
 await fixture(page);
 const before=await page.evaluate(()=>window.getDebtPlan().state);
 await menuGo(page,'income');
 await expect(page.locator('#incomeSummary .income-total')).toHaveText('$1,284.62');
 await expect(page.locator('#tab-income .den-income-payday')).toContainText('$1,845.00');
 await page.locator('#incomeToggleBtn').click();await expect(page.locator('#incomeDropdown')).toBeVisible();
 await page.locator('#incomeBudgetToggleBtn').click();await expect(page.locator('#budgetDropdown')).toBeVisible();
 await menuGo(page,'bills');
 await expect(page.locator('#denBillsSummary [data-den-copy="billTrackerPaidCount"]')).toHaveText(await page.locator('#billTrackerPaidCount').textContent());
 await expect(page.locator('#billAgenda .den-date-stamp').first()).toBeVisible();
 await expect(page.locator('#billAgenda .den-bill-meta').first()).toContainText('Shared bills account');
 await page.locator('#denBillsSummary [data-forecast-accounts]').click();await expect(page.locator('#householdEditor')).toBeVisible();await page.locator('#closeHouseholdEditor').click();
 const bill=page.locator('#billAgenda [data-account-id="electric"]');
 await bill.locator('[data-edit-bill]').click();await expect(page.locator('#billEditor')).toBeVisible();await page.locator('#closeBillEditor').click();
 await bill.locator('[data-bill-paid]').click();await expect(page.locator('#paidBillsList')).toBeVisible();
 await page.locator('#paidBillsList summary').click();await page.locator('[aria-label="Undo paid for Electric on 2026-10-29"]').click();
 await expect(page.locator('#denBillsSummary [data-den-copy="billTrackerPaidCount"]')).toHaveText(await page.locator('#billTrackerPaidCount').textContent());
 await menuGo(page,'debts');
 await expect(page.locator('#denDebtTotal')).toHaveText('$3,420.00');
 await page.locator('#denPayoffMethod').selectOption('snowball');await expect(page.locator('#pmBtnSnowball')).toHaveClass(/active/);
 await page.locator('#debtAccounts [data-show-debt-details]').first().click();await expect(page.locator('#debtProgressDialog')).toBeVisible();await page.locator('#closeDebtProgress').click();
 await page.locator('#debtAccounts [data-edit-debt]').first().click();await expect(page.locator('#debtEditor')).toBeVisible();await page.locator('#closeDebtEditor').click();
 const after=await page.evaluate(()=>window.getDebtPlan().state);
 for(const key of ['cards','savingsGoals','budgetItems','takeHome','checkedPaychecks'])expect(after[key]).toEqual(before[key]);
});

test('full paycheck cards follow all trackers and keep amount edits, details, and completion',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);
 const schedule=page.locator('#schedulePlanSection'),card=page.locator('#paycheck-card-1');
 expect(await schedule.evaluate(el=>!!(document.querySelector('#debtHeroBox').compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await expect(card.locator('.paycheck-debt-amounts')).toBeVisible();
 await card.locator('.paycheck-shared-details summary').click();await expect(card.locator('.paycheck-shared-balances')).toBeVisible();
 const amount=card.locator('.paycheck-income input');await amount.fill('1900');await amount.blur();
 await expect(card.locator('.paycheck-income input')).toHaveValue('1900.00');
 await card.locator('[data-paycheck-creditor]').first().click();await expect(page.locator('#debtProgressDialog')).toBeVisible();await page.locator('#closeDebtProgress').click();
 await card.screenshot({path:'test-results/wallet-paycheck.png'});
 await card.locator('input[type=checkbox]').check();
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().state.checkedPaychecks[1])).toBe(true);
 await page.reload();await page.evaluate(()=>window.classicReady);
 expect(await page.evaluate(()=>window.getDebtPlan().state.checkedPaychecks[1])).toBe(true);
 expect(await page.evaluate(()=>window.getDebtPlan().state.paycheckOverrides[1])).toBe(1900);
});

test('existing color and holiday choices work with Wallet and preserve the financial plan',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);
 const before=await page.evaluate(()=>window.getDebtPlan().state);
 await menuGo(page,'settings');
 await page.locator('#holidayToggleBtn').click();await page.locator('#openColorPicker').click();
 await page.locator('[data-color-scheme-choice="sunrise"]').click();
 await page.locator('#closeColorPicker').click();await menuGo(page,'overview');
 await expect(page.locator('html')).toHaveAttribute('data-color-scheme','sunrise');
 await page.screenshot({path:'test-results/wallet-bright-theme.png'});
 await page.locator('#denTheme').click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.screenshot({path:'test-results/wallet-bright-dark-theme.png'});
 await page.evaluate(()=>window.setHolidayTheme('christmas'));
 await expect(page.locator('html')).toHaveAttribute('data-holiday','christmas');
 for(const destination of ['income','bills','debts','settings']){
  await menuGo(page,destination);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 expect(await page.evaluate(()=>window.getDebtPlan().state)).toEqual(before);
});
