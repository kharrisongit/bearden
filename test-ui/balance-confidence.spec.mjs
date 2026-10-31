import {test,expect} from '@playwright/test';
import {fixture} from './wallet.fixture.mjs';

test('wallet summaries show each account freshness and recovery state independently',async({page})=>{
 await page.setViewportSize({width:390,height:844});await fixture(page);
 await page.evaluate(()=>{
  const accounts=window.BearDen.plan.state.accounts;
  Object.assign(accounts.find(a=>a.id==='plaid-personal'),{balanceUpdated:'2026-10-28T11:00:00Z'});
  Object.assign(accounts.find(a=>a.id==='lunchflow-bills'),{balanceUpdated:'2026-10-24T11:00:00Z',balanceRetrieved:'2026-10-28T11:59:00Z',balanceDateUnknown:true,balanceStale:true});
  window.BearDen.plan.connections.bankUpdated='2026-10-28T11:59:00Z';
  window.dispatchEvent(new Event('bearden-connections'));
 });
 await expect(page.locator('#incomeSummary')).toContainText('Plaid · Updated');
 await expect(page.locator('#incomeSummary')).toContainText('Lunch Flow · Last known balance · Retrieved');
 await expect(page.locator('#billTrackerAccountName')).toContainText('Last known balance');
 await expect(page.locator('#billTrackerAccountName')).toContainText('Bank balance time not supplied');
 await expect(page.locator('#debtBankUpdated')).toHaveText('');
 await page.evaluate(()=>{
  Object.assign(window.BearDen.plan.state.accounts.find(a=>a.id==='lunchflow-bills'),{providerUnavailable:true,balanceUnavailable:true});
  window.dispatchEvent(new Event('bearden-connections'));
 });
 await expect(page.locator('#billTrackerBalance')).toHaveText('Unavailable');
 await expect(page.locator('#billTrackerAccountName')).toContainText('Balance unavailable');
 await expect(page.locator('#incomeSummary .income-account-balance')).toContainText('Unavailable');
});

test('scrubbing the wallet bills forecast before a future shortfall preserves its warning',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await fixture(page,{ownStart:'2027-01-01',spouseStart:'2027-01-01'});
 await page.evaluate(()=>{
  Object.assign(window.BearDen.plan.state.accounts.find(a=>a.id==='lunchflow-bills'),{balance:50000,balanceUpdated:'2026-10-28T11:00:00Z'});
  window.dispatchEvent(new Event('bearden-connections'));
  window.selectBearTab('bills');
 });
 await page.locator('[data-account-view="calendar"]').click();
 await expect(page.locator('#billsForecast [data-full-range-risk]')).toBeVisible();
 const warning=await page.locator('#billsForecast [data-full-range-risk]').innerText();
 await page.locator('#billsForecastScrub').fill('0');
 await expect(page.locator('#billsForecast [data-full-range-risk]')).toHaveText(warning,{useInnerText:true});
 await expect(page.locator('#billsForecast .forecast-selection-note')).toContainText('Totals and lowest balance through');
 await expect(page.locator('#billsForecast .forecast-ledger-row[data-forecast-date="2026-11-01"]')).toHaveCount(0);
 await page.locator('#billsForecastScrub').fill('30');
 await expect(page.locator('#billsForecast .forecast-lowest small')).toHaveText('Lowest balance');
 await expect(page.locator('#billsForecast .forecast-ledger-row[data-forecast-date="2026-11-01"]')).not.toHaveCount(0);
});
