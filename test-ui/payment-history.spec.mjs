import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {paymentLink} from '../public/transaction-links.mjs';
import {transactionKey} from '../public/bank-activity.mjs';
import {blank} from '../public/engine.mjs';

const payment=(id,name,amount,date='2026-09-20',extra={})=>({transaction_id:id,name,amount,date,itemId:'bank',account_id:'personal',currency:'USD',pending:false,...extra});
async function setup(page,{legacy=false,connected=false,empty=false}={}){
 const electric=payment('electric-new','Electric payment',90,'2026-10-20');
 const debt=payment('debt-new','Capital One payment',75,'2026-10-20');
 const transactions=empty?[]:[electric,payment('electric-old','Electric payment',110,'2025-09-20'),electric,
  payment('electric-pending','Electric payment',500,'2026-10-25',{pending:true}),
  payment('electric-other','Electric payment',600,'2026-10-20',{account_id:'someone-else'}),
  payment('electric-refund','Electric payment',-90),payment('electric-future','Electric payment',90,'2026-11-20'),
  debt,payment('debt-old','Capital One payment',25,'2025-07-15'),payment('other-debt','Capital One payment',500,'2026-10-20',{account_id:'someone-else'})];
 const f=await fixture(page,{transactions});
 const planner=JSON.parse(f.tracker.state.values['income-planner']);
 planner.transactionLinks={'debt:1':paymentLink(debt)};
 if(legacy){planner.manual=planner.manual.filter(b=>b.id!=='electric');planner.bankRules={[transactionKey(electric)]:{id:'electric',name:'Electric',choice:'bill',amount:12500,lastPayment:'2026-09-20',repeat:'monthly',billKind:'electric'}};}
 else planner.transactionLinks['bill:electric']=paymentLink(electric);
 if(connected){
  planner.creditCards={'credit-visa':{tracking:true,trackerCardId:'1'}};
  await page.route('https://bearden.test/api/state',route=>route.fulfill({json:{state:{...blank(),accounts:[...f.accounts,{id:'plaid-visa',name:'Capital One card',type:'credit',source:'plaid',balance:342000,currency:'USD'}]},connections:{items:[],transactions,creditCards:[{id:'credit-visa',accountId:'visa',itemId:'bank',name:'Capital One connected',institution:'Bank',currency:'USD',balance:342000,minimum:3500,dueDate:'2026-11-04',payments:[{id:'received',date:'2026-10-20',amount:7500,name:'Payment received'}]}],gmailMessages:[],recurringBills:[]},revision:0}}));
 }
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 await page.reload();await page.evaluate(()=>window.classicReady);
 return {transactions,f};
}

for(const width of [320,440])test(`${width}px bill Details shows all matched history, total and account without duplicates`,async({page})=>{
 await page.setViewportSize({width,height:740});await setup(page);await menuGo(page,'bills');
 await page.locator('[data-account-id=electric] .bd-bill-details').click();
 const history=page.locator('dialog[open] .linked-bank-history');
 await expect(history.getByRole('heading',{name:'Bank payment history'})).toBeVisible();
 await expect(history.locator('.bank-history-summary')).toHaveText('2 posted payments$200.00');
 await expect(history.locator('li')).toHaveCount(2);
 await expect(history.locator('time')).toHaveText(['Oct 20, 2026','Sep 20, 2025']);
 await expect(history.locator('li small').first()).toHaveText('Personal checking');
 expect(await page.locator('dialog[open] .bd-popup-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('legacy bank-tracked bill Details also includes history older than the activity window',async({page})=>{
 await setup(page,{legacy:true});await menuGo(page,'bills');
 // The older tracking format may show the last paid occurrence under Paid bills.
 if(await page.locator('#paidBillsList').count())await page.locator('#paidBillsList').evaluate(el=>el.open=true);
 await page.locator('[data-account-id=electric] .bd-bill-details').first().click();
 await expect(page.locator('dialog[open] .bank-history-list li')).toHaveCount(2);
 await expect(page.locator('dialog[open] .bank-history-list')).toContainText('Sep 20, 2025');
});

for(const connected of [false,true])test(`${connected?'connected':'manual'} debt details shows bank history immediately and keeps card/checkoff records separate`,async({page})=>{
 await page.setViewportSize({width:440,height:740});await setup(page,{connected});await menuGo(page,'debts');
 await page.locator('#debtAccounts [data-show-debt-details]').first().click();
 const dialog=page.locator('#debtProgressDialog'),history=dialog.locator('.linked-bank-history');
 await expect(history.getByRole('heading',{name:'Bank payment history'})).toBeVisible();
 await expect(history.locator('.bank-history-summary')).toHaveText('2 posted payments$100.00');
 await expect(history.locator('li')).toHaveCount(2);await expect(history.locator('time')).toHaveText(['Oct 20, 2026','Jul 15, 2025']);
 expect(await history.evaluate(el=>!el.closest('details:not([open])'))).toBe(true);
 expect(await dialog.locator('.bd-popup-body').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 if(connected){await dialog.locator('summary').filter({hasText:'Card payment records'}).click();await expect(dialog.locator('.credit-payment-list')).toContainText('Payment received');}
 await page.screenshot({path:connected?'/tmp/bearden-connected-payment-history.png':'/tmp/bearden-debt-payment-history.png'});
});

test('details explains an empty bank history instead of showing planned payments as bank payments',async({page})=>{
 await setup(page,{empty:true});await menuGo(page,'bills');await page.locator('[data-account-id=electric] .bd-bill-details').click();
 await expect(page.locator('dialog[open] .linked-bank-history')).toContainText('No matched bank payments yet');
 await expect(page.locator('dialog[open] .bank-history-list')).toHaveCount(0);
});
