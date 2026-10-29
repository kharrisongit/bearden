import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

test('month arrows update the summary, unpaid and paid lists, and Bills calendar together',async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=await fixture(page);
 const planner=JSON.parse(f.tracker.state.values['income-planner']);
 planner.manual.push({id:'insurance',name:'Renters Insurance',date:'2026-11-03',amount:2019,repeat:'monthly',source:'manual',billKind:'insurance'});
 planner.paid.push('insurance:2026-10-03','electric:2026-11-29');
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 await page.reload();await expect(page.locator('#billTrackerMonth')).toHaveText('October bills');await menuGo(page,'bills');
 const summary=page.locator('#denBillsSummary'),agenda=page.locator('#billAgenda');
 await expect(summary.locator('#denBillsMonth')).toHaveText('October bills');
 await expect(summary.locator('#denBillsPaidCount')).toHaveText('2 of 5 paid');
 await expect(agenda.locator('[data-bill-paid]')).toHaveCount(3);
 expect(await agenda.locator('[data-bill-paid]').evaluateAll(nodes=>nodes.every(n=>n.dataset.billPaid.includes(':2026-10-')))).toBe(true);
 await page.locator('#paidBillsList summary').click();await expect(agenda).not.toContainText('Nov');await expect(agenda).toContainText('Renters Insurance');
 await summary.getByRole('button',{name:'Next bill month',exact:true}).click();
 await expect(summary.locator('#denBillsMonth')).toHaveText('November bills');await expect(summary.locator('#denBillsPaidCount')).toHaveText('1 of 5 paid');
 expect(await agenda.locator('[data-bill-paid]').evaluateAll(nodes=>nodes.every(n=>n.dataset.billPaid.includes(':2026-11-')))).toBe(true);
 await expect(agenda).not.toContainText('Oct');await expect(agenda.locator('[data-account-id=insurance]')).toBeVisible();
 await agenda.locator('[data-bill-paid="insurance:2026-11-03"]').click();await expect(summary.locator('#denBillsPaidCount')).toHaveText('2 of 5 paid');
 await expect(agenda.locator('[data-bill-paid="insurance:2026-12-03"]')).toHaveCount(0);
 await agenda.locator('[data-bill-unpaid="insurance:2026-11-03"]').click();await expect(summary.locator('#denBillsPaidCount')).toHaveText('1 of 5 paid');
 await page.locator('#accounts-nav-calendar').click();await expect(page.locator('#tab-bills [data-calendar-part=month]')).toHaveText('November 2026');
 await page.locator('#tab-bills [data-calendar-move="1"]').click();await expect(summary.locator('#denBillsMonth')).toHaveText('December bills');
 await summary.getByRole('button',{name:'Next bill month',exact:true}).click();await expect(summary.locator('#denBillsYear')).toHaveText('2027');await expect(summary.locator('#denBillsMonth')).toHaveText('January bills');
 await summary.getByRole('button',{name:'Previous bill month',exact:true}).click();await expect(summary.locator('#denBillsMonth')).toHaveText('December bills');
 await expect(page.locator('#billTrackerMonth')).toHaveText('October bills');
});

for(const [width,theme] of [[320,'light'],[390,'light'],[390,'dark']])test(`upper summaries are enclosed cards at ${width}px in ${theme} mode`,async({page})=>{
 await page.setViewportSize({width,height:844});await fixture(page);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 for(const [tab,selector] of [['bills','#denBillsSummary'],['income','#tab-income .bank-card'],['debts','#denDebtSummary']]){
  await menuGo(page,tab);const card=page.locator(selector);
  expect(await card.evaluate(el=>{
   const s=getComputedStyle(el),rect=el.getBoundingClientRect();
   return ['Top','Right','Bottom','Left'].every(side=>parseFloat(s['border'+side+'Width'])>=1)&&parseFloat(s.borderTopLeftRadius)>=16&&s.boxShadow!=='none'&&rect.left>=0&&rect.right<=innerWidth&&el.scrollWidth<=el.clientWidth+1;
  })).toBe(true);
  if(tab==='bills'){
   for(const name of ['Previous bill month','Next bill month']){const b=card.getByRole('button',{name,exact:true});const rect=await b.boundingBox();expect(rect.width).toBeGreaterThanOrEqual(44);expect(rect.height).toBeGreaterThanOrEqual(44);}
  }
  if(width===390)await page.screenshot({path:`test-results/summary-${tab}-${theme}.png`});
 }
});

test('a fully paid October shows no November bills until the month changes',async({page})=>{
 const f=await fixture(page),planner=JSON.parse(f.tracker.state.values['income-planner']);
 planner.paid=planner.manual.filter(b=>b.billKind!=='credit-card').map(b=>b.id+':'+b.date);
 planner.manual.push({id:'insurance',name:'Renters Insurance',date:'2026-11-03',amount:2019,repeat:'monthly',source:'manual',billKind:'insurance'});
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 await page.reload();await expect(page.locator('#billTrackerPaidCount')).toHaveText('4 of 4 paid');await menuGo(page,'bills');
 await expect(page.locator('#denBillsPaidCount')).toHaveText('4 of 4 paid');await expect(page.locator('#denBillsRemaining')).toHaveText('$0');
 await expect(page.locator('#billAgenda')).toContainText('All bills paid for this month.');await expect(page.locator('#billAgenda [data-bill-paid]')).toHaveCount(0);
 await expect(page.locator('#billAgenda')).not.toContainText('Nov');await expect(page.locator('#billAgenda')).not.toContainText('Renters Insurance');
 await page.getByRole('button',{name:'Next bill month',exact:true}).click();await expect(page.locator('#denBillsPaidCount')).toHaveText('0 of 5 paid');
 await expect(page.locator('#billAgenda [data-account-id=insurance]')).toBeVisible();
});
