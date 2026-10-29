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

test('opening Transactions clears a previous outgoing/account filter and shows deposits from every account',async({page})=>{
 const deposit={transaction_id:'payroll',account_id:'lunchflow-bills',amount:-750,currency:'USD',date:'2026-10-28',name:'Payroll deposit',pending:false};
 const purchase={...deposit,transaction_id:'shop',account_id:'personal',amount:35,name:'Groceries'};
 const pending={...deposit,transaction_id:'pending-pay',amount:-25,name:'Pending transfer',pending:true};
 await fixture(page,{transactions:[deposit,purchase,pending]});
 await menuGo(page,'income');await page.locator('#incomeTransactionsToggleBtn').click();
 const rows=page.locator('#bankTransactions .transaction-entry');
 await expect(rows).toHaveCount(3);
 await expect(page.locator('#bankTransactions .cash-incoming')).toHaveText(['+$750.00','+$25.00']);
 await expect(page.locator('#bankTransactions .cash-outgoing')).toHaveText('−$35.00');
 await page.locator('#transactionFilter').selectOption('outgoing');
 await page.locator('#transactionAccountFilter').selectOption('personal');
 await expect(rows).toHaveCount(1);
 await page.locator('#incomeTransactionsToggleBtn').click();
 await page.locator('#incomeTransactionsToggleBtn').click();
 await expect(page.locator('#transactionFilter')).toHaveValue('all');
 await expect(page.locator('#transactionAccountFilter')).toHaveValue('');
 await expect(rows).toHaveCount(3);
 await page.locator('#transactionFilter').selectOption('deposit');
 await expect(rows).toHaveCount(2);
 await expect(rows.filter({hasText:'Pending transfer'})).toContainText('Pending');
 await expect(rows.filter({hasText:'Pending transfer'}).locator('button')).toHaveCount(0);
});
