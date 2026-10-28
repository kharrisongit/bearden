import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

async function fixture(page){
 await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 const manual=[
  {id:'water',name:'Water',amount:6000,date:'2026-10-28',billKind:'utility'},
  {id:'internet',name:'Paid Internet',amount:10000,date:'2026-10-10',billKind:'phone-internet'},
  {id:'car',name:'Car payment',amount:20000,date:'2026-10-29',billKind:'car-payment'},
  {id:'loan',name:'Loan payment',amount:5000,date:'2026-10-30',billKind:'loan'},
  {id:'card',name:'Paid card',amount:2500,date:'2026-10-15',billKind:'credit-card'},
 ].map(b=>({...b,repeat:'monthly',source:'manual'}));
 const planner={manual,paid:['internet:2026-10-10','card:2026-10-15']};
 let tracker={state:{version:1,values:{
  'app-state':JSON.stringify({cards:[{id:1,name:'Small Visa',debtKind:'credit-card',balance:20,apr:0,min:20,monthlyMinimum:43.33}],cardIdCounter:1,budgetItems:[],budgetSetupVersion:2,startDate:'2026-10-30',takeHome:'1000',payoffMethod:'minimum',savingsGoals:[]}),
  'income-planner':JSON.stringify(planner),onboarding:JSON.stringify({completed:true}),
 }},revision:0};
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'calendar-test'}});
  if(path==='/api/classic'){
   if(req.method()==='GET')return route.fulfill({json:tracker});
   tracker={state:req.postDataJSON().state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:blank(),connections:{items:[],transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);
  try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}
  catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await expect(page.locator('#configureHousehold')).toBeEnabled();
}

async function openCalendar(page,scope){
 await page.locator(scope==='bills'?'#nav-bills':'#nav-debts').click();
 await page.locator(scope==='bills'?'#accounts-nav-calendar':'#debts-nav-calendar').click();
 const card=page.locator('[data-payment-calendar="'+scope+'"]');await expect(card).toBeVisible();return card;
}
const part=(card,name)=>card.locator('[data-calendar-part="'+name+'"]');

for(const [scope,width,theme]of [['bills',320,'dark'],['debts',390,'light']])test(`${scope} calendar at ${width}px filters paid and unpaid debt, payoffs, markers, and totals together`,async({page})=>{
 await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',error=>errors.push(error.message));await fixture(page);
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 const card=await openCalendar(page,scope),grid=part(card,'grid'),agenda=part(card,'agenda'),summary=part(card,'summary');
 await expect(part(card,'month')).toHaveText('October 2026');await expect(card.locator('[data-calendar-scope="all"]')).toHaveAttribute('aria-pressed','true');
 await expect(grid.locator('[data-calendar-day="2026-10-30"] .debt-dot')).toHaveCount(1);
 await expect(grid.locator('[data-calendar-day="2026-10-30"] .payoff-star')).toHaveCount(1);
 await expect(grid.locator('[data-calendar-day="2026-10-15"] .debt-dot')).toHaveCount(1);
 await expect(summary).toContainText('$330.00');await expect(summary).toContainText('2 of 6 paid');
 const combinedSummary=await summary.textContent(),before=await page.evaluate(()=>window.getDebtPlan().state);
 await part(card,'agenda-toggle').click();await expect(agenda).toBeVisible();
 await expect(agenda.locator('button').filter({hasText:'Paid card'})).toContainText('Paid');
 await expect(agenda.locator('button').filter({hasText:'Small Visa'})).toHaveCount(1);
 await card.locator('[data-calendar-scope="bills"]').click();
 await expect(card.locator('[data-calendar-scope="bills"]')).toHaveAttribute('aria-pressed','true');
 await expect(card.locator('[data-calendar-scope="all"]')).toHaveAttribute('aria-pressed','false');
 await expect(grid.locator('.debt-dot')).toHaveCount(0);await expect(grid.locator('.payoff-star')).toHaveCount(0);
 await expect(grid.locator('[data-calendar-day="2026-10-30"]')).not.toHaveAttribute('aria-label',/debt|payoff/i);
 await expect(grid.locator('[data-calendar-day="2026-10-30"] .pay-dot')).toHaveCount(1);
 await expect(grid.locator('[data-calendar-day="2026-10-29"] .bill-dot')).toHaveCount(1);
 await expect(card.locator('[data-calendar-debt]:visible')).toHaveCount(0);
 await expect(agenda.locator('button').filter({hasText:/Paid card|Loan payment|Small Visa/})).toHaveCount(0);
 await expect(agenda.locator('button').filter({hasText:'Paid Internet'})).toContainText('Paid');
 await expect(agenda.locator('button').filter({hasText:'Car payment'})).toHaveCount(1);
 await expect(agenda).toContainText('My Payday');await expect(summary).toContainText('$260.00');await expect(summary).toContainText('1 of 3 paid');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await card.locator('[data-calendar-scope="all"]').click();await expect(summary).toHaveText(combinedSummary);
 expect(await page.evaluate(()=>window.getDebtPlan().state)).toEqual(before);expect(errors).toEqual([]);
});

test('Bills and Debt retain independent months, selected days, and filters with accessible Debt subtabs',async({page})=>{
 await fixture(page);const bills=await openCalendar(page,'bills');
 await bills.locator('[data-calendar-scope="bills"]').click();await bills.locator('[data-calendar-move="1"]').click();
 await expect(part(bills,'month')).toHaveText('November 2026');await bills.locator('[data-calendar-day="2026-11-28"]').click();
 const debts=await openCalendar(page,'debts');await expect(part(debts,'month')).toHaveText('October 2026');
 await expect(debts.locator('[data-calendar-scope="all"]')).toHaveAttribute('aria-pressed','true');await debts.locator('[data-calendar-day="2026-10-30"]').click();
 await page.locator('#nav-bills').click();await expect(bills).toBeVisible();await expect(part(bills,'month')).toHaveText('November 2026');
 await expect(bills.locator('[data-calendar-day="2026-11-28"]')).toHaveAttribute('aria-pressed','true');await expect(bills.locator('[data-calendar-scope="bills"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('#nav-debts').click();await expect(debts).toBeVisible();await expect(part(debts,'month')).toHaveText('October 2026');
 await expect(debts.locator('[data-calendar-day="2026-10-30"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('#debts-nav-calendar').focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('#debts-nav-debt')).toBeFocused();await expect(page.locator('#accounts-debt')).toBeVisible();await expect(page.locator('#debts-calendar')).toBeHidden();
 await page.keyboard.press('ArrowRight');await expect(page.locator('#debts-nav-calendar')).toBeFocused();await expect(debts).toBeVisible();
 await page.keyboard.press('Home');await expect(page.locator('#debts-nav-debt')).toBeFocused();await page.keyboard.press('End');await expect(page.locator('#debts-nav-calendar')).toBeFocused();
});

test('expanded calendars keep their controls and route bill and debt payments to the matching list',async({page})=>{
 await page.setViewportSize({width:1280,height:900});const errors=[];page.on('pageerror',error=>errors.push(error.message));await fixture(page);
 const debts=await openCalendar(page,'debts');await debts.locator('[data-expand-card="debtCalendarCard"]').click();
 await expect(page.locator('#expandedAccountView #debtCalendarCard')).toBeVisible();
 await debts.locator('[data-calendar-move="1"]').click();await expect(part(debts,'month')).toHaveText('November 2026');
 await debts.locator('[data-calendar-scope="bills"]').click();await expect(part(debts,'grid').locator('.debt-dot')).toHaveCount(0);
 await debts.locator('[data-calendar-move="-1"]').click();await debts.locator('[data-calendar-scope="all"]').click();
 await debts.locator('[data-calendar-day="2026-10-30"]').click();await part(debts,'agenda').locator('button').filter({hasText:'Loan payment'}).click();
 await expect(page.locator('#expandedAccountView')).toBeHidden();await expect(page.locator('#accounts-debt')).toBeVisible();await expect(page.locator('#debts-nav-debt')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#debts-calendar > #debtCalendarCard')).toHaveCount(1);
 const bills=await openCalendar(page,'bills');await bills.locator('[data-expand-card="billCalendarCard"]').click();
 await bills.locator('[data-calendar-day="2026-10-28"]').click();await part(bills,'agenda').locator('button').filter({hasText:'Water'}).click();
 await expect(page.locator('#expandedAccountView')).toBeHidden();await expect(page.locator('#accounts-bills')).toBeVisible();await expect(page.locator('#nav-bills')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#accounts-calendar > #billCalendarCard')).toHaveCount(1);
 for(const id of ['billCalendarCard','debtCalendarCard','billCalendar','debtCalendar'])await expect(page.locator('#'+id)).toHaveCount(1);
 expect(errors).toEqual([]);
});
