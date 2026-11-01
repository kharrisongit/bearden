import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {APP_RELEASE} from '../public/app-release.mjs';

async function openReporter(page){await menuGo(page,'settings');await page.locator('[data-bug-report-open]').click();await expect(page.locator('#bugReportDialog')).toBeVisible();}

test('reports keep failed drafts, retry idempotently, and exclude financial state',async({page})=>{
  await fixture(page);
  // Hold the deferred account script so the module is evaluated while the
  // document is interactive, before DOMContentLoaded and Wallet composition.
  await page.route('**/connections.js*',async route=>{await new Promise(resolve=>setTimeout(resolve,150));await route.fallback();});
  await page.reload();await page.evaluate(()=>window.classicReady);
  await expect(page.locator('[data-bug-report-open]')).toHaveCount(1);await expect(page.locator('#classicBugSupport')).toHaveCount(0);
  let reports=[],fail=true;const sent=[];
  await page.route('**/api/bug-reports',async route=>{
    const req=route.request();if(req.method()==='GET')return route.fulfill({json:{reports}});
    const data=req.postDataJSON();sent.push(data);expect(req.headers()['x-bearden-account']).toBe('test');
    if(fail)return route.fulfill({status:503,json:{error:'Please try again.'}});
    const report={...data,id:'bug-example',createdAt:'2026-11-01T12:00:00Z',status:'new',response:'',revision:1};reports=[report];return route.fulfill({json:{report}});
  });
  await openReporter(page);
  await expect(page.locator('#bugReportSignIn')).toBeHidden();await expect(page.locator('#sendBugReport')).toBeEnabled();
  await page.locator('#bugReportForm [name=title]').fill('<img src=x onerror=alert(1)> Button problem');
  await page.locator('#bugReportForm [name=details]').fill('The button does not respond after opening Bills.');
  await page.locator('#sendBugReport').click();await expect(page.locator('#bugReportStatus')).toContainText('Your draft is still here');
  await expect(page.locator('#bugReportForm [name=details]')).toHaveValue('The button does not respond after opening Bills.');
  fail=false;await page.locator('#sendBugReport').click();await expect(page.locator('#bugReportStatus')).toContainText('Report bug-example received');
  expect(sent).toHaveLength(2);expect(sent[1].submissionId).toBe(sent[0].submissionId);
  expect(Object.keys(sent[1]).sort()).toEqual(['appVersion','area','details','diagnostics','expected','steps','submissionId','title']);
  expect(Object.keys(sent[1].diagnostics).sort()).toEqual(['browser','viewport']);expect(sent[1].appVersion).toBe(APP_RELEASE.id);
  await expect(page.locator('#bugReportList')).toContainText('<img src=x onerror=alert(1)> Button problem');await expect(page.locator('#bugReportList img')).toHaveCount(0);
  await expect(page.locator('#bugReportForm [name=title]')).toHaveValue('');
});

test('signed-out users cannot submit reports',async({page})=>{
  await fixture(page,{authenticated:false});let posts=0;
  await page.route('**/api/bug-reports',async route=>{if(route.request().method()==='POST')posts++;return route.fulfill({json:{reports:[]}});});
  await openReporter(page);await expect(page.locator('#bugReportSignIn')).toBeVisible();await expect(page.locator('#sendBugReport')).toBeDisabled();expect(posts).toBe(0);
});

test('release notices wait for editors and acknowledge only the release actually shown',async({page})=>{
  await fixture(page);let release={...APP_RELEASE,id:'release-A',title:'First fix',notes:['The button responds correctly.']};const acknowledgements=[];
  await page.route('**/api/bug-reports',route=>route.fulfill({json:{reports:[]}}));
  await page.route('**/api/app-release',route=>route.fulfill({json:{release,acknowledged:acknowledgements.includes(release.id),automationEnabled:false}}));
  await page.route('**/api/app-release/ack',route=>{acknowledgements.push(route.request().postDataJSON().releaseId);return route.fulfill({json:{ok:true}});});
  await openReporter(page);await page.locator('#bugReportForm [name=details]').fill('My unfinished draft');
  const first=page.waitForResponse('**/api/app-release');await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await first;
  await expect(page.locator('#bugReleaseDialog')).not.toBeVisible();
  await page.getByRole('button',{name:'Close report a bug',exact:true}).click();await expect(page.locator('#bugReleaseDialog')).toBeVisible();await expect(page.locator('#bugReleaseTitle')).toHaveText('First fix');
  const next=page.waitForResponse('**/api/app-release');release={...release,id:'release-B',title:'Second fix'};await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await next;
  await expect(page.locator('#bugReleaseTitle')).toHaveText('First fix');
  await page.locator('#bugReleaseDismiss').click();await expect.poll(()=>acknowledgements).toContain('release-A');expect(acknowledgements).not.toContain('release-B');
  await expect(page.locator('#bugReleaseDialog')).toBeVisible();await expect(page.locator('#bugReleaseTitle')).toHaveText('Second fix');
  await page.locator('#bugReleaseDismiss').click();await expect.poll(()=>acknowledgements).toContain('release-B');
  await page.locator('[data-bug-report-open]').click();await expect(page.locator('#bugReportForm [name=details]')).toHaveValue('My unfinished draft');
});
