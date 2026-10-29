import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
test('deposits are visible and can identify a spouse contribution with overlapping schedules',async({page})=>{
 const credit={transaction_id:'deposit',account_id:'lunchflow-bills',amount:-755,currency:'USD',date:'2026-10-28',name:'PAYROLL RICHARD',category:'',pending:false};
 await fixture(page,{transactions:[credit]});
 await menuGo(page,'income');await page.locator('#incomeTransactionsToggleBtn').click();
 await expect(page.locator('#bankTransactions')).toContainText('+$755.00');
 await page.locator('#transactionFilter').selectOption('deposit');
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('[data-match-contribution="deposit"][data-person="spouse"]').click();
 await menuGo(page,'overview');
 await expect(page.locator('.den-contribution')).toContainText('$755.00');
 await page.reload();await page.evaluate(()=>window.classicReady);
 await expect(page.locator('.den-contribution')).toContainText('$755.00');
});
