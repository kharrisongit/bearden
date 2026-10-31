import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {blank} from '../public/engine.mjs';
import {parseAccountEmail} from '../email-parser.mjs';
import {emailLink} from '../public/email-model.mjs';
import {paymentLink,transactionKey} from '../public/income-model.mjs';

async function setup(page,{pending=false,reconcile=false}={}){
 const f=await fixture(page,{now:'2026-10-31T18:00:00Z'}),planner=JSON.parse(f.tracker.state.values['income-planner']);
 planner.manual=planner.manual.map(b=>({...b,date:'2026-11-01'}));planner.paid=[];planner.showCarPaymentsInDebt=true;
 planner.creditCards={'credit-visa':{tracking:true}};
 const app=JSON.parse(f.tracker.state.values['app-state']);
 app.cards=[{id:1,name:'Capital One',balance:3420,apr:25,minPayment:35,monthlyMinimum:35,dueDate:'2026-11-04',debtKind:'credit-card'},{id:2,name:'Cash loan',balance:2000,apr:10,minPayment:100,monthlyMinimum:100,dueDate:'2026-11-04',debtKind:'loan'}];
 f.tracker.state.values['app-state']=JSON.stringify(app);
 const targets=[...planner.manual.map(b=>['bill:'+b.id,b.amount]),['debt:1',3500],['debt:2',10000],['credit:credit-visa',5000]];
 const messages=targets.map(([target,amount],i)=>parseAccountEmail({id:'m:'+i,mailboxId:'m',from:'receipts'+i+'@example.com',subject:pending?'Payment scheduled':'Payment Receipt - Reference # TEST00'+i,text:'Payment amount: $'+(amount/100).toFixed(2)+'. Payment date: October 31, 2026. Confirmation number REF00'+i,receivedAt:'2026-10-31T12:00:00Z'}));
 planner.emailLinks=Object.fromEntries(targets.map(([target],i)=>[target,emailLink(messages[i])]));
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 const apiState={state:{...blank(),accounts:[...f.accounts,{id:'plaid-visa',name:'Connected Visa',type:'credit',source:'plaid',balance:100000,currency:'USD'}]},connections:{items:[],transactions:[],creditCards:[{id:'credit-visa',accountId:'visa',itemId:'bank',name:'Connected Visa',institution:'Bank',currency:'USD',balance:100000,minimum:5000,dueDate:'2026-11-01',payments:[]}],emailConnected:true,gmailMessages:messages,recurringBills:[]},revision:0};
 await page.route('https://bearden.test/api/state',route=>route.fulfill({json:apiState}));
 if(reconcile){
  const transaction={transaction_id:'rent-posted',itemId:'lunchflow',account_id:'lunchflow-bills',name:'Example Rent',date:'2026-10-31',amount:800,currency:'USD',pending:false};
  // The account uses an older bank-tracking rule, as in the reported Details view.
  planner.bankRules={[transactionKey(transaction)]:{choice:'bill',id:'rent'}};
  planner.sunRent={billId:'rent',amountField:'currentBalance',baseAmount:80000,readings:[]};
  planner.transactionLinks={'credit:credit-visa':paymentLink({...transaction,transaction_id:'card',name:'Visa Payment',amount:50})};
  apiState.connections.sun={connected:true,enabled:true,snapshot:{currentBalance:80000,currency:'USD',checkedAt:'2026-10-31T10:00:00Z'}};
  apiState.connections.creditCards[0].lastPositiveMinimum={amount:5000,updated:'2026-10-31T10:00:00Z'};
  apiState.state.accounts.find(a=>a.id==='plaid-visa').balanceUpdated='2026-10-31T10:00:00Z';
  apiState.state.accounts.find(a=>a.id==='lunchflow-bills').balanceUpdated='2026-10-31T10:00:00Z';
  f.tracker.state.values['income-planner']=JSON.stringify(planner);
 }
 await page.reload();await expect(page.locator('#configureHousehold')).toBeEnabled();
 return {f,planner,apiState};
}

test('all bill and debt card types keep submitted receipts in the unpaid list with an awaiting message',async({page})=>{
 await page.setViewportSize({width:390,height:844});const {f}=await setup(page);
 await menuGo(page,'bills');await page.getByRole('button',{name:'Next bill month',exact:true}).click();
 await expect(page.locator('#denBillsPaidCount')).toHaveText('0 of 4 paid');
 await expect(page.locator('#paidBillsList')).toHaveCount(0);
 for(const id of ['rent','electric','internet','car']){
  const card=page.locator('#billAgenda > [data-account-id="'+id+'"]');
  await expect(card.locator('.bill-payment-pending')).toBeVisible();
  await expect(card).toContainText('Paid · Awaiting confirmation');
  await expect(card.locator('.den-date-stamp')).not.toHaveClass(/is-paid/);
 }
 await page.locator('[data-account-id=rent] .bd-bill-details').click();
 await expect(page.locator('dialog[open]')).toContainText('Reserved in your forecast until the posted payment is reflected in your bank balance');
 await page.locator('dialog[open] button[aria-label="Close bill details"]').click();
 await page.getByRole('button',{name:'Next bill month',exact:true}).click();await expect(page.locator('#denBillsPaidCount')).toHaveText('0 of 4 paid');
 await menuGo(page,'debts');
 for(const selector of ['[data-tracker-account="1"]','[data-tracker-account="2"]','[data-account-id="credit-visa"]','[data-car-payment="car"]','.payment-only-debt']){
  const card=page.locator('#debtAccounts '+selector);await expect(card).toContainText('Paid · Awaiting confirmation');await expect(card).not.toHaveClass(/is-paid-off/);await expect(card.locator('.den-date-stamp')).not.toHaveClass(/is-paid/);
 }
 await expect(page.locator('[data-tracker-account="1"] .bd-account-amount')).toContainText('$3,420');
 expect(JSON.parse(f.tracker.state.values['income-planner']).paid).toEqual([]);
 expect(await page.evaluate(()=>Object.values(window.getDebtPlan().state.checkedPaychecks||{}).some(Boolean))).toBe(false);
});
test('scheduled notices stay unpaid on bill and debt cards',async({page})=>{
 await setup(page,{pending:true});await menuGo(page,'bills');await page.getByRole('button',{name:'Next bill month',exact:true}).click();
 await expect(page.locator('#denBillsPaidCount')).toHaveText('0 of 4 paid');
 await menuGo(page,'debts');await expect(page.locator('#debtAccounts')).not.toContainText('Paid · Awaiting confirmation');
});

test('receipt, bank posting, and balance updates advance rent and debt confirmation without duplicate payments',async({page})=>{
 const {apiState}=await setup(page,{reconcile:true});
 await menuGo(page,'bills');await page.getByRole('button',{name:'Next bill month',exact:true}).click();
 const rent=page.locator('#billAgenda [data-account-id="rent"]');
 await expect(rent).toContainText('Paid · Awaiting confirmation');
 const refresh=()=>page.evaluate(()=>window.BearDen.refreshPaymentEvidence());
 await page.clock.setFixedTime(new Date('2026-11-01T18:00:00Z'));
 await refresh();
 await expect(page.locator('#billTrackerPaidCount')).toHaveText('0 of 4 paid');
 await expect(page.locator('#billTrackerRemaining')).toHaveText('$1,285.00');
 await expect(page.locator('#paidBillsList')).toHaveCount(0);
 apiState.connections.transactions=[{transaction_id:'rent-posted',itemId:'lunchflow',account_id:'lunchflow-bills',name:'Example Rent',date:'2026-10-31',amount:800,currency:'USD',pending:false},{transaction_id:'card-posted',itemId:'lunchflow',account_id:'lunchflow-bills',name:'Visa Payment',date:'2026-10-31',amount:50,currency:'USD',pending:false}];
 await refresh();await expect(rent).toContainText('Bank posted · Awaiting balance update');
 await expect(rent).toContainText('Reserved in your forecast');
 const funding=apiState.state.accounts.find(a=>a.id==='lunchflow-bills');funding.balance-=85000;funding.balanceUpdated='2026-10-31T16:00:00Z';
 await refresh();await expect(rent).toContainText('waiting for the account balance to update');
 await expect(rent).not.toContainText('Reserved in your forecast');
 await expect(page.locator('#denBillsPaidCount')).toHaveText('0 of 4 paid');
 await expect(page.locator('#billTrackerPaidCount')).toHaveText('0 of 4 paid');
 await expect(page.locator('#billTrackerUpcoming')).toContainText('Paid · Awaiting confirmation');
 await expect(page.locator('#paidBillsList')).toHaveCount(0);
 apiState.connections.sun.snapshot={currentBalance:0,currency:'USD',checkedAt:'2026-10-31T17:00:00Z'};
 const card=apiState.connections.creditCards[0];card.minimum=0;card.balance=95000;card.updated='2026-10-31T17:00:00Z';card.payments=[{id:'issuer-paid',amount:5000,date:'2026-10-31'}];
 const credit=apiState.state.accounts.find(a=>a.id==='plaid-visa');credit.balance=95000;credit.balanceUpdated='2026-10-31T17:00:00Z';
 await refresh();await expect(rent).toContainText('Paid · Confirmed');
 await expect(page.locator('#denBillsPaidCount')).toHaveText('1 of 4 paid');
 await expect(page.locator('#billTrackerPaidCount')).toHaveText('1 of 4 paid');
 await expect(page.locator('#billTrackerRemaining')).toHaveText('$485.00');
 await expect(page.locator('#paidBillsList [data-account-id="rent"]')).toHaveCount(1);
 await menuGo(page,'debts');await expect(page.locator('#debtAccounts [data-account-id="credit-visa"]')).toContainText('Paid · Confirmed');
 await expect(page.locator('#debtAccounts [data-account-id="credit-visa"]')).not.toHaveClass(/is-paid-off/);
});
