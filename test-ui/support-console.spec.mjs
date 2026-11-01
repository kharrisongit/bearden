import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('private support link removes its credential and safely updates a report revision', async ({ page }) => {
  const token = 'reporting-only-test-token';
  const requests = [], saves = [];
  let report = {
    id: 'report-test-1', revision: 3, status: 'new',
    title: '<img src=x onerror="window.reportMarkupExecuted=true">',
    details: '<script>window.reportMarkupExecuted=true</script>',
    expected: 'Show the correct screen', steps: 'Open Settings',
    createdAt: '2026-11-01T12:00:00.000Z', area: 'settings',
    appVersion: 'test-version', diagnostics: { browser: '<svg onload=alert(1)>', viewport: '390 × 844' },
    response: '', fixedInRelease: null
  };
  page.on('request', request => requests.push({ path: new URL(request.url()).pathname, headers: request.headers() }));
  await page.route('https://bearden.test/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/support/reports') return route.fulfill({ json: {
      reports: [report], nextCursor: null,
      release: { id: 'test-release', title: 'Test update', notes: [], fixedReportIds: [] }
    } });
    if (path === '/api/support/reports/status') {
      const body = request.postDataJSON(); saves.push(body);
      if (body.revision !== report.revision) return route.fulfill({ status: 409, json: { error: 'Report changed. Refresh before saving.' } });
      report = { ...report, status: body.status, response: body.response, revision: report.revision + 1 };
      return route.fulfill({ json: { report } });
    }
    if (path.startsWith('/api/')) return route.fulfill({ status: 404, json: { error: 'Unexpected API request' } });
    const filename = path.slice(1);
    try {
      return route.fulfill({ body: readFileSync(new URL('../public/' + filename, import.meta.url)),
        contentType: filename.endsWith('.css') ? 'text/css' : /\.(js|mjs)$/.test(filename) ? 'text/javascript' : 'text/html' });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });

  await page.goto('https://bearden.test/support.html#token=' + token);
  await expect(page.locator('#connectionStatus')).toHaveText('Connected with reporting-only access.');
  await expect(page).toHaveURL('https://bearden.test/support.html');
  const article = page.locator('[data-report-id="report-test-1"]');
  await expect(article.getByRole('heading', { level: 2 })).toHaveText(report.title);
  await expect(article.locator('img, script, svg')).toHaveCount(0);
  await expect(article.getByText(report.details, { exact: true })).toBeVisible();
  await expect(article.locator('option[value="fixed"]')).toHaveJSProperty('disabled', true);
  expect(await page.evaluate(() => ({ executed: !!window.reportMarkupExecuted, local: localStorage.length, session: sessionStorage.length })))
    .toEqual({ executed: false, local: 0, session: 0 });

  await page.getByLabel('Progress for report-test-1').selectOption('investigating');
  await page.getByLabel('Response for report-test-1').fill('I can reproduce this and am checking the fix.');
  await article.getByRole('button', { name: 'Save progress' }).click();
  await expect(article.locator('.save-message')).toHaveText('Saved.');
  await expect(article.locator('.report-meta')).toContainText('Revision 4');
  await expect(article.locator('.badge')).toHaveText('Investigating');
  expect(saves).toEqual([{ id: 'report-test-1', revision: 3, status: 'investigating', response: 'I can reproduce this and am checking the fix.' }]);
  const authorized = requests.filter(request => request.headers.authorization);
  expect(authorized.map(request => request.path)).toEqual(['/api/support/reports', '/api/support/reports/status']);
  expect(authorized.every(request => request.headers.authorization === 'Bearer ' + token)).toBe(true);
  expect(requests.some(request => request.path === '/api/config' || request.path === '/api/state' || request.path === '/api/classic')).toBe(false);
});


test('support filters request types and shows feature completion and closed states honestly', async ({page}) => {
  const reports=[
    {id:'legacy',title:'Legacy bug',status:'new',revision:1,createdAt:'2026-11-01T12:00:00Z'},
    {id:'feature',type:'feature',title:'A helpful filter',details:'Filter the calendar.',status:'fixed',fixedInRelease:'test-release',revision:2,createdAt:'2026-11-01T12:00:00Z'},
    {id:'test',type:'feature',title:'Visibility test',status:'closed',response:'Only a test; no implementation requested.',revision:2,createdAt:'2026-11-01T12:00:00Z'}
  ];
  await page.route('https://bearden.test/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/support/reports')return route.fulfill({json:{reports,nextCursor:null,release:{id:'test-release',fixedReportIds:['feature']}}});
    if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
    const filename=path.slice(1);return route.fulfill({body:readFileSync(new URL('../public/'+filename,import.meta.url)),contentType:filename.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(filename)?'text/javascript':'text/html'});
  });
  await page.goto('https://bearden.test/support.html#token=synthetic-test');
  await expect(page.locator('.report')).toHaveCount(1);
  await expect(page.locator('.report h2')).toHaveText('Legacy bug');
  await page.locator('#statusFilter').selectOption('all');
  await page.locator('#typeFilter').selectOption('feature');
  await expect(page.locator('.report')).toHaveCount(2);
  await expect(page.locator('[data-report-id=feature] .badge')).toHaveText('Implemented');
  await expect(page.locator('[data-report-id=test] .badge')).toHaveText('Closed');
  await expect(page.locator('[data-report-id=feature] option[value=fixed]')).toHaveText('Implemented');
  await page.locator('#statusFilter').selectOption('closed');
  await expect(page.locator('.report')).toHaveCount(1);
  await expect(page.locator('.report h2')).toHaveText('Visibility test');
});
