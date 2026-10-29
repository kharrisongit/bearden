import { test, expect } from './original-design.fixture.mjs';
import { readFileSync } from 'node:fs';

const publicUrl = new URL('../public/', import.meta.url);
const html = readFileSync(new URL('index.html', publicUrl), 'utf8');
// Use the shipped stylesheet order and the actual summary-card markup. This
// catches cascade/specificity regressions, not just the palette's color values.
const css = [...html.matchAll(/<link[^>]+href="([^"?]+\.css)(?:\?[^\"]*)?"/g)]
  .map(([, name]) => readFileSync(new URL(name, publicUrl), 'utf8')).join('\n');
const totals = [...html.matchAll(/<section class="income-card account-total-card"[\s\S]*?<\/section>/g)]
  .map(([markup], i) => markup.replace(/(<div id="(?:bills|debt)TotalAmount"[^>]*>)(<\/div>)/,
    (_, open, close) => `${open}<strong class="account-total-amount">${i ? '$1,234,567.89' : '$0.00'}</strong><p class="subtle">1 account has no balance available.</p>${close}`)).join('');

function contrastAudit() {
  const rgb = value => { const c = value.match(/[\d.]+/g).map(Number); return c.length === 3 ? [...c, 1] : c; };
  const over = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
  const luminance = c => c.slice(0, 3).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; })
    .reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
  return [...document.querySelectorAll('h3,strong,p,button,input')].filter(el => el.checkVisibility()).map(el => {
    const style = getComputedStyle(el), stack = [];
    for (let p = el; p; p = p.parentElement) stack.unshift(rgb(getComputedStyle(p).backgroundColor));
    const background = stack.reduce((b, a) => over(a, b), [255, 255, 255, 1]);
    const foreground = over(rgb(style.color), background), a = luminance(foreground), b = luminance(background);
    return { text: el.textContent || el.value, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
}

for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) for (const holiday of ['standard', 'halloween', 'christmas']) {
  test(`${width}px ${theme} ${holiday}: totals and controls remain readable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.setContent(`<!doctype html><html data-theme="${theme}" data-holiday="${holiday}"><head><style>${css}</style></head><body><main class="wrap">
      ${totals}
      <section class="income-card"><h3>Account controls</h3><p class="subtle">Next payment · Nov 3</p>
        <button class="bill-save">Save bill</button><button disabled>Refreshing…</button>
        <input value="$1,234.56" aria-label="Amount">
        <div class="forecast-debt-modes"><button aria-pressed="true">Full debt plan</button><button aria-pressed="false">Minimums only</button></div>
        <div class="account-view-tabs"><button aria-selected="true">Debt</button></div>
        <p class="forecast-warning">Your forecast falls below zero.</p>
      </section>
      <section class="income-card bank-card"><h3>Income</h3><strong class="income-total">$2,345.67</strong><p class="subtle">Available balance</p>
        <div class="income-controls-header"><div class="income-widget-actions"><button aria-expanded="true">Income</button><button>Budget</button></div></div>
      </section>
    </main></body></html>`);
    await expect(page.locator('.account-total-amount')).toHaveCount(2);
    for (const result of await page.evaluate(contrastAudit)) {
      expect(result.ratio, `${result.text}: foreground/background contrast`).toBeGreaterThanOrEqual(4.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Save bill', exact: true }).focus();
    expect(await page.getByRole('button', { name: 'Save bill', exact: true }).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  });
}
