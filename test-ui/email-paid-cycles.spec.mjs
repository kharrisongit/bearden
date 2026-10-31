import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {blank} from '../public/engine.mjs';
import {parseAccountEmail} from '../email-parser.mjs';
import {emailLink} from '../public/email-model.mjs';

async function setup(page,{pending=false}={}){
 const f=await fixture(page,{now:'2026-10-31T18:00:00Z'}),planner=JSON.parse(f.tracker.state.values['income-planner']);
 planner.manual=planner.manual.map(b=>({...b,date:'2026-11-01'}));planner.paid=[];planner.showCarPaymentsInDebt=true;
 planner.creditCards={'credit-visa':{tracking:true}};
 const app=JSON.parse(f.tracker.state.values['app-state']);
 app.cards=[{id:1,name:'Capital One',balance:3420,apr:25,minPayment:35,monthlyMinimum:35,dueDate:'2026-11-04',debtKind:'credit-card'},{id:2,name:'Cash loan',balance:2000,apr:10,minPayment:100,monthlyMinimum:100,dueDate:'2026-11-04',debtKind:'loan'}];
 f.tracker.state.values['app-state']=JSON.stringify(app);
 const targets=[...planner.manual.map(b=>['bill:'+b.id,b.amount]),['debt:1',3500],['debt:2',10000],['credit:credit-visa',5000]];
 const messages=targets.map(([target,amount],i)=>parseAccountEmail({id:'m:'+i,mailboxId:'m',from:'receipts'+i+'@example.com',subject:pending?'Payment scheduled':'Payment received',text:'Payment amount: $'+(amount/100).toFixed(2)+'. Payment date: October 31, 2026. Confirmation number REF00'+i,receivedAt:'2026-10-31T12:00:00Z'}));
 planner.emailLinks=Object.fromEntries(targets.map(([target],i)=>[target,emailLink(messages[i])]));
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 await page.route('https://bearden.test/api/state',route=>route.fulfill({json:{state:{...blank(),accounts:[...f.accounts,{id:'plaid-visa',name:'Connected Visa',type:'credit',source:'plaid',balance:100000,currency:'USD'}]},connections:{items:[],transactions:[],creditCards:[{id:'credit-visa',accountId:'visa',itemId:'bank',name:'Connected Visa',institution:'Bank',currency:'USD',balance:100000,minimum:5000,dueDate:'2026-11-01',payments:[]}],emailConnected:true,gmailMessages:messages,recurringBills:[]},revision:0}}));
 await page.reload();await expect(page.locator('#configureHousehold')).toBeEnabled();
 return {f,planner};
}

test('all bill and debt card types show email-confirmed cycle payments without paying off balances',async({page})=>{
 await page.setViewportSize({width:390,height:844});const {f}=await setup(page);
 await menuGo(page,'bills');await page.getByRole('button',{name:'Next bill month',exact:true}).click();
 await expect(page.locator('#denBillsPaidCount')).toHaveText('4 of 4 paid');
 await page.locator('#paidBillsList').evaluate(el=>el.open=true);
 for(const id of ['rent','electric','internet','car'])await expect(page.locator('#paidBillsList [data-account-id="'+id+'"]')).toContainText('Email receipt');
 await page.locator('[data-account-id=rent] .bd-bill-details').click();
 await expect(page.locator('dialog[open]')).toContainText('Reserved in your forecast until the bank payment appears');
 await page.locator('dialog[open] button[aria-label="Close bill details"]').click();
 await page.getByRole('button',{name:'Next bill month',exact:true}).click();await expect(page.locator('#denBillsPaidCount')).toHaveText('0 of 4 paid');
 await menuGo(page,'debts');
 for(const selector of ['[data-tracker-account="1"]','[data-tracker-account="2"]','[data-account-id="credit-visa"]','[data-car-payment="car"]','.payment-only-debt']){
  const card=page.locator('#debtAccounts '+selector);await expect(card).toContainText('Payment paid · Email');await expect(card).not.toHaveClass(/is-paid-off/);
 }
 await expect(page.locator('[data-tracker-account="1"] .bd-account-amount')).toContainText('$3,420');
 expect(JSON.parse(f.tracker.state.values['income-planner']).paid).toEqual([]);
 expect(await page.evaluate(()=>Object.values(window.getDebtPlan().state.checkedPaychecks||{}).some(Boolean))).toBe(false);
});
test('scheduled notices stay unpaid on bill and debt cards',async({page})=>{
 await setup(page,{pending:true});await menuGo(page,'bills');await page.getByRole('button',{name:'Next bill month',exact:true}).click();
 await expect(page.locator('#denBillsPaidCount')).toHaveText('0 of 4 paid');
 await menuGo(page,'debts');await expect(page.locator('#debtAccounts')).not.toContainText('Payment paid · Email');
});
