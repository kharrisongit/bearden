import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

const credit={transaction_id:'early-spouse',account_id:'lunchflow-bills',amount:-750,currency:'USD',date:'2026-10-29',name:'ACH direct deposit',category:'',source:'lunchflow',pending:false};
const sync=(page,transactions)=>page.evaluate(transactions=>{
 window.BearDen.plan.connections.transactions=transactions;
 window.dispatchEvent(new CustomEvent('bearden-connections'));
},transactions);

test('early spouse deposit updates the dashboard, forecast, paycheck details and refreshes idempotently',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await fixture(page,{ownStart:'2026-10-23',spouseAmount:75000,now:'2026-10-29T12:00:00Z'});
 await expect(page.locator('.den-contribution')).toContainText('$750.00');
 await expect(page.locator('.den-contribution')).toContainText('Oct 30');
 const shared=page.locator('#billsForecast'),row=shared.locator('[data-forecast-date="2026-10-30"]').filter({hasText:'Spouse contribution'});
 await menuGo(page,'bills');await page.locator('#accounts-nav-calendar').click();
 await expect(shared.locator('.forecast-incoming strong')).toHaveText('$3,760.00');
 await sync(page,[{...credit,pending:true}]);
 await expect(row.locator(':scope > strong')).toHaveText('+$750.00');
 await sync(page,[credit]);
 await expect(row).toContainText('received Oct 29');
 await expect(row).toContainText('already in bank balance');
 await expect(row.locator(':scope > strong')).toHaveText('$0.00');
 await expect(shared.locator('.forecast-incoming strong')).toHaveText('$3,010.00');
 const ending=await shared.locator('.forecast-main').textContent();
 await sync(page,[credit,credit]);
 await expect(shared.locator('.forecast-main')).toHaveText(ending);
 await expect(shared.locator('.forecast-ledger-row').filter({hasText:'received Oct 29'})).toHaveCount(1);
 await page.locator('#billsForecastCard').screenshot({path:'test-results/early-spouse-forecast.png'});
 await menuGo(page,'overview');
 await expect(page.locator('.den-contribution')).toContainText('Nov 6');
 await expect(page.locator('.den-contribution')).toContainText('$755.00');
 const details=page.locator('.paycheck-shared-details[data-paycheck-date="2026-10-23"]');
 await expect(details).toContainText('Received Oct 29');
 await sync(page,[]);
 await expect(page.locator('.den-contribution')).toContainText('Oct 30');
 await expect(page.locator('.den-contribution')).toContainText('$750.00');
 expect(errors).toEqual([]);
});

test('own deposit two days early is recognized after reload and leaves the next recurrence intact',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const own={...credit,transaction_id:'early-own',amount:-755,date:'2026-10-28'};
 await fixture(page,{spouseStart:'2026-11-06',spouseAmount:75000,transactions:[own]});
 await expect(page.locator('.den-contribution')).toContainText('Nov 6');
 await expect(page.locator('.den-contribution')).toContainText('$750.00');
 await menuGo(page,'bills');await page.locator('#accounts-nav-calendar').click();
 const shared=page.locator('#billsForecast');
 await expect(shared.locator('[data-forecast-date="2026-10-30"]').filter({hasText:'Fixed Bills transfer'})).toContainText('received Oct 28');
 await expect(shared.locator('[data-forecast-date="2026-11-13"]').filter({hasText:'Fixed Bills transfer'}).locator(':scope > strong')).toHaveText('+$755.00');
 const ending=await shared.locator('.forecast-main').textContent();
 await page.reload();await page.evaluate(()=>window.classicReady);
 await expect(page.locator('#configureHousehold')).toBeEnabled();
 await menuGo(page,'bills');await page.locator('#accounts-nav-calendar').click();
 await expect(shared.locator('.forecast-main')).toHaveText(ending);
 await menuGo(page,'income');
 await expect(page.locator('#incomeForecast [data-forecast-date="2026-10-30"]').filter({hasText:'Fixed Bills transfer'})).toContainText('received Oct 28');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
