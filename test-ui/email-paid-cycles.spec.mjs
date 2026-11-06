import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {blank} from '../public/engine.mjs';
import {parseAccountEmail} from '../email-parser.mjs';
import {emailLink} from '../public/email-model.mjs';
import {paymentLink,transactionKey} from '../public/income-model.mjs';

async function setup(page,{pending=false,reconcile=false}={}){
 const f=await fixture(page,{now:'2026-10-31T18:00:00Z'});
 // Finish the initial app's autosave before seeding the mocked server.
 await page.evaluate(()=>window.flushBearDenState());await page.goto('about:blank');
 const planner=JSON.parse(f.tracker.state.values['income-planner']);
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
 await page.goto('https://bearden.test/');await expect(page.locator('#configureHousehold')).toBeEnabled();
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
  const card=page.locator('#debtAccounts '+selector);await expect(card).toBeVisible();expect((await card.innerText()).match(/awaiting confirmation/gi)).toHaveLength(1);await expect(card).not.toHaveClass(/is-paid-off/);await expect(card.locator('.den-date-stamp')).not.toHaveClass(/is-paid/);
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
 await refresh();await expect(rent).toContainText('Bank posted · Waiting for funding account balance');
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
 await expect(page.locator('#debtAccounts [data-account-id="credit-visa"] .debt-payment-notice')).toHaveCount(0);
});

for(const stage of ['submitted','scheduled'])test(`Capital One shows a ${stage} payment from a linked email on the collapsed debt card`,async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const {f,planner,apiState}=await setup(page);
 await page.evaluate(()=>window.flushBearDenState());await page.goto('about:blank');
 const submitted=stage==='submitted',subject=submitted?'Thanks for making a payment':'Your payment is scheduled';
 const dateLine=submitted?'Payment date: October 31, 2026.':'Scheduled for: November 2, 2026.';
 const notice=(id,last4,amount)=>parseAccountEmail({id,mailboxId:'m',from:'Capital One <payments@notification.capitalone.com>',subject,text:`Card ending in ${last4}. Payment amount: $${amount}. ${dateLine} Confirmation number ${id}.`,receivedAt:'2026-10-31T14:00:00Z'});
 const pending=notice('test123','4242','63.27'),other=notice('test456','3131','21.19');
 const statement=parseAccountEmail({id:'statement',mailboxId:'m',from:'Capital One <statements@capitalone.com>',subject:'Your statement is ready',text:'Card ending in 4242.',receivedAt:'2026-10-27T10:00:00Z'});
 planner.emailLinks['debt:1']=emailLink(submitted?statement:pending);
 if(submitted){
  const app=JSON.parse(f.tracker.state.values['app-state']);delete app.cards[0].dueDate;
  f.tracker.state.values['app-state']=JSON.stringify(app);
 }
 const posted={transaction_id:'posted-mobile',itemId:'lunchflow',account_id:'lunchflow-bills',name:'Capital One Mobile Payment',date:'2026-10-31',amount:63.27,currency:'USD',pending:false};
 planner.transactionLinks={'debt:1':paymentLink(posted)};
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 apiState.connections.gmailMessages=[statement,pending,other];
 await page.goto('https://bearden.test/');await expect(page.locator('#configureHousehold')).toBeEnabled();await menuGo(page,'debts');
 const card=page.locator('#debtAccounts [data-tracker-account="1"]');
 await card.locator('[data-show-debt-details]').click();
 await expect(page.locator('#debtProgressDialog')).toContainText('$63.27');
 await page.locator('#closeDebtProgress').click();await expect(page.locator('#debtProgressDialog')).toBeHidden();
 const noticeRow=card.locator('.debt-payment-notice');
 await expect(noticeRow).toBeVisible();await expect(noticeRow).toContainText('$63.27');await expect(noticeRow).toContainText(submitted?/awaiting confirmation/i:/scheduled/i);
 expect(await card.innerText()).not.toContain('$21.19');await expect(card).not.toContainText('Paid · Confirmed');
 await expect(card.locator('.den-date-stamp.is-paid')).toHaveCount(0);
 await expect(card.locator('.bd-account-amount')).toContainText('$3,420');
 if(submitted){
  const older={...pending,id:'older-receipt',reference:'older-ref',receivedAt:'2026-10-28T10:00:00Z',paymentDate:'2026-10-28',paymentAmount:1900};
  apiState.connections.gmailMessages.push(older);apiState.connections.transactions=[posted];
  apiState.state.accounts.find(a=>a.id==='lunchflow-bills').balanceUpdated='2026-10-31T16:00:00Z';
  await page.evaluate(()=>window.BearDen.refreshPaymentEvidence());
  await expect(noticeRow).toContainText('Payment confirmed');await expect(noticeRow).toContainText('$63.27');
  await expect(card).not.toContainText('awaiting confirmation',{ignoreCase:true});
 }
 apiState.connections.gmailMessages.unshift({...pending,id:'later-return',subject:'Payment returned',receivedAt:'2026-10-31T15:00:00Z',paymentStatus:'failed',paymentStage:'failed'});
 await page.reload();await expect(page.locator('#configureHousehold')).toBeEnabled();await menuGo(page,'debts');
 await expect(card).toBeVisible();await expect(noticeRow).toHaveCount(0);
});

for(const emailOn of ['tracker','issuer'])test(`a mapped card confirms the ${emailOn} receipt from a bank link saved on its other record`,async({page})=>{
 const {f,planner,apiState}=await setup(page,{reconcile:true});
 await page.evaluate(()=>window.flushBearDenState());await page.goto('about:blank');
 const receipt=apiState.connections.gmailMessages.at(-1),tracker='debt:1',issuer='credit:credit-visa';
 const mailTarget=emailOn==='tracker'?tracker:issuer,bankTarget=emailOn==='tracker'?issuer:tracker;
 planner.emailLinks={[mailTarget]:emailLink(receipt)};
 if(emailOn==='tracker')planner.creditCards['credit-visa'].trackerCardId='1';
 else planner.debtAccountLinks={1:'plaid-visa'};
 const tx={transaction_id:'opaque-posting',account_id:'lunchflow-bills',itemId:'lunchflow',name:'ACH X193',date:'2026-10-31',amount:50,currency:'USD',pending:false};
 planner.transactionLinks={[bankTarget]:paymentLink(tx)};
 apiState.connections.transactions=[tx];apiState.connections.gmailMessages=[receipt];
 const card=apiState.connections.creditCards[0];card.payments=[{id:'payment',date:tx.date,amount:5000}];
 for(const a of apiState.state.accounts)a.balanceUpdated='2026-10-31T17:00:00Z';
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 await page.goto('https://bearden.test/');await expect(page.locator('#configureHousehold')).toBeEnabled();await menuGo(page,'debts');
 const visibleCard=page.locator('#debtAccounts '+(emailOn==='tracker'?'[data-account-id="credit-visa"]':'[data-tracker-account="1"]'));
 await expect(visibleCard).toContainText('Paid · Confirmed');
 await expect(visibleCard).not.toContainText(/awaiting confirmation/i);
 await visibleCard.locator('[data-show-debt-details]').click();
 await expect(page.locator('#debtProgressDialog')).toContainText('ACH X193');
});

test('a Capital One receipt confirms after a changed checking debit and Lunch Flow card credit arrive on refresh',async({page})=>{
 const {f,planner,apiState}=await setup(page);
 await page.evaluate(()=>window.flushBearDenState());await page.goto('about:blank');
 const receipt=parseAccountEmail({id:'test-cap-receipt',mailboxId:'m',from:'Capital One <payments@notification.capitalone.com>',subject:'Thanks for making a payment',text:'Card ending in 4242. Payment amount: $38.25. Payment date: October 31, 2026.',receivedAt:'2026-10-31T12:00:00Z'});
 const debit={transaction_id:'checking-posted',itemId:'bank',account_id:'personal',currency:'USD',amount:38.25,date:'2026-10-31',name:'ACH CAP ONE MOBILE PYMT'};
 const link=paymentLink({...debit,name:'CAPITAL ONE ONLINE PAYMENT'});
 const issuer={id:'lunchflow-card',name:'Capital One',type:'credit',currency:'USD',source:'lunchflow',balance:342000,balanceUpdated:'2026-10-31T09:00:00Z'};
 planner.transactionLinks={'debt:1':link};planner.emailLinks={'debt:1':emailLink(receipt)};
 planner.debtAccountLinks={1:issuer.id};
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 apiState.state.accounts.push(issuer);apiState.connections.gmailMessages=[receipt];
 await page.goto('https://bearden.test/');await expect(page.locator('#configureHousehold')).toBeEnabled();await menuGo(page,'debts');
 const card=page.locator('#debtAccounts [data-tracker-account="1"]');
 await expect(card).toContainText('Awaiting confirmation');
 expect((await card.innerText()).match(/awaiting confirmation/gi)).toHaveLength(1);
 const funding=apiState.state.accounts.find(a=>a.id==='plaid-personal');
 funding.balance-=3825;funding.balanceUpdated='2026-10-31T16:00:00Z';
 apiState.connections.transactions=[debit];
 await page.evaluate(()=>window.BearDen.refreshPaymentEvidence());
 await expect(card).toContainText('Bank posted · Waiting for receiving account balance');
 // New spending offset the payment. A refreshed balance and the issuer's actual
 // posted payment still corroborate settlement on this exact credit account.
 issuer.balanceUpdated='2026-10-31T17:00:00Z';
 apiState.connections.transactions.push({...debit,transaction_id:'issuer-posted',itemId:'lunchflow',account_id:issuer.id,source:'lunchflow',amount:-38.25,name:'Payment Received'});
 await page.evaluate(()=>window.BearDen.refreshPaymentEvidence());
 await expect(card).toContainText(/paid · confirmed|payment confirmed/i);
 await expect(card).not.toContainText(/awaiting/i);
 await card.locator('[data-show-debt-details]').click();
 await expect(page.locator('#debtProgressDialog')).toContainText(debit.name);
 expect(JSON.parse(f.tracker.state.values['income-planner']).transactionLinks['debt:1']).toEqual(link);
});
