import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Exercise the real application using a disposable local-only profile.
async function openFixture(page, theme) {
  await page.route('http://bearden.test/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/config') return route.fulfill({ json: { authenticated: false } });
    if (path.startsWith('/api/')) return route.fulfill({ status: 404, json: {} });
    const name = path === '/' ? 'index.html' : path.slice(1);
    const contentType = name.endsWith('.css') ? 'text/css' : /\.(mjs|js)$/.test(name) ? 'text/javascript' : 'text/html';
    try { await route.fulfill({ body: readFileSync(new URL('../public/' + name, import.meta.url)), contentType }); }
    catch { await route.fulfill({ status: 404, body: '' }); }
  });
  await page.addInitScript(theme => {
    if (!localStorage.getItem('bearden:classic:app-state')) {
      localStorage.setItem('bearden:classic:app-state', JSON.stringify({
        cards: [], budgetItems: [], budgetSetupVersion: 2, startDate: '2026-11-06',
        hourlyRate: '25', hoursPerCheck: '80', takeHome: '1500',
        taxSettings: { state: 'MI', filing: 'joint', retirement: '125' },
        savingsGoals: [1, 2].map(id => ({ id, name: 'Goal ' + id, goal: 1000, start: 0, contribution: 10, withdrawalHistory: [] })),
        savingsGoalIdCounter: 2,
      }));
      localStorage.setItem('bearden:classic:onboarding', JSON.stringify({ completed: true }));
    }
    localStorage.setItem('bearden:classic:theme', theme);
  }, theme);
  await page.goto('http://bearden.test/');
  await page.waitForFunction(() => window.classicLoaded);
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
}

for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) {
  test(`${width}px ${theme}: 401(k) saves, estimates once, and retains manual take-home`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await openFixture(page, theme);
    await expect(page.locator('#debtIncomeCard .hero-title')).toHaveText('Income Tracker');
    await expect(page.locator('#tab-debt .tracker-header')).toHaveCount(4);
    const inspectHeaders = () => [...document.querySelectorAll('.tracker-header')].filter(el => el.checkVisibility()).every(el => {
      const box = el.getBoundingClientRect();
      return getComputedStyle(el).borderTopStyle === 'solid' && [...el.querySelectorAll('.hero-title,button')].every(child => {
        const r = child.getBoundingClientRect();
        return !child.checkVisibility() || (r.left >= box.left && r.right <= box.right + 1 && r.bottom <= box.bottom + 1);
      });
    });
    expect(await page.evaluate(inspectHeaders)).toBe(true);
    await page.locator('#nav-income').click();
    await page.locator('#incomeToggleBtn').click();
    await expect(page.locator('#tax-retirement')).toBeVisible();
    await expect(page.locator('#tax-retirement')).toHaveValue('125');
    await expect(page.locator('#tax-retirementType')).toHaveValue('traditional');
    await page.locator('#tax-retirement').fill('200');
    await expect(page.locator('#incomeEstimate')).toContainText('$1,514.35');
    await page.locator('#tax-retirementType').selectOption('roth');
    await expect(page.locator('#incomeEstimate')).toContainText('$1,485.85');
    await expect(page.locator('#takeHome')).toHaveValue('1500');
    await page.locator('#useIncomeEstimate').click();
    await expect(page.locator('#takeHome')).toHaveValue('1485.85');
    await page.evaluate(() => window.flushBearDenState());
    expect(await page.evaluate(() => window.getDebtPlan().schedule[0].takeHomeThisCheck)).toBe(1485.85);
    expect(await page.evaluate(inspectHeaders)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await page.waitForFunction(() => window.classicLoaded);
    await page.locator('#nav-income').click();
    await page.locator('#incomeToggleBtn').click();
    await expect(page.locator('#tax-retirement')).toHaveValue('200');
    await expect(page.locator('#tax-retirementType')).toHaveValue('roth');
    await expect(page.locator('#takeHome')).toHaveValue('1485.85');
    await page.locator('#takeHome').fill('1700');
    await page.getByRole('button', { name: 'Save income', exact: true }).click();
    await expect(page.locator('#incomeDropdown')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => window.getDebtPlan().state.takeHome)).toBe('1700');
    expect(errors).toEqual([]);
  });
}
