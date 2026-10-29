import {test as base, expect} from '@playwright/test';
// Keep the original interface covered as an explicitly supported rollback.
// den-design.spec.mjs exercises the new default and switching both ways.
export const test = base.extend({
  originalDesign: [async ({page}, use) => {
    await page.addInitScript(() => localStorage.setItem('bearden:design', 'classic'));
    await use();
  }, {auto:true}],
});
export {expect};
