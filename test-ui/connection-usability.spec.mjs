import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {blank} from '../public/engine.mjs';

for(const width of [320,390])test(`${width}px: guided bank controls survive wallet moves and restore`,async({page})=>{
 await page.setViewportSize({width,height:844});const f=await fixture(page);
 f.tracker.state.values.onboarding=JSON.stringify({started:true,step:2,completed:false});await page.reload();
 await expect(page.locator('#setupTitle')).toHaveText('Connect your banks');
 await expect(page.locator('#setupContent #configurePlaid')).toBeVisible();
 await expect(page.locator('#setupContent #configureLunchflow')).toBeVisible();
 await page.locator('#configureLunchflow').click();await expect(page.locator('#setupContent #lunchflowSetup')).toBeVisible();
 await page.locator('#setupBack').click();await expect(page.locator('#setupContent #classicOutlook')).toBeVisible();
 await page.locator('#setupNext').click();await expect(page.locator('#setupContent #configurePlaid')).toBeVisible();
 await page.locator('#setupLater').click();await expect(page.locator('#setupWizard')).toBeHidden();
 expect(await page.locator('#bdDetail-plaid #plaidSection').count()).toBe(1);
 expect(await page.locator('#bdDetail-lunchflow #lunchflowSection').count()).toBe(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('guest setup explains sign-in and permits skipping connections',async({page})=>{
 await fixture(page,{authenticated:false});
 await page.evaluate(()=>localStorage.setItem('bearden:classic:onboarding',JSON.stringify({started:true,step:2,completed:false})));await page.reload();
 await expect(page.locator('#setupContent')).toContainText('Sign in to connect bank accounts');
 await expect(page.locator('#setupNext')).toHaveText('Skip for now');
 await page.locator('#setupSignIn').click();await expect(page.locator('#setupTitle')).toHaveText('Welcome to BearDen');
 await page.locator('#setupNext').click();await expect(page.locator('#setupContent')).toContainText('Sign in to connect bill inboxes');
 await page.locator('#setupNext').click();await page.locator('#setupNext').click();await expect(page.locator('#setupTitle')).toHaveText('Set up your paycheck');
});

async function bankFixture(page){
 const f=await fixture(page);let fail=false;
 await page.route('https://bearden.test/api/state',route=>route.fulfill({json:{state:{...blank(),accounts:f.accounts},connections:{items:[{id:'test-bank',name:'Test bank'}],transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]}}}));
 await page.route('https://bearden.test/api/bank/refresh',route=>route.fulfill(fail?{status:500,json:{error:'Bank connection failed. Reconnect to continue.'}}:{json:{status:'Updated '+Array.from({length:50},(_,i)=>'account '+i).join(', ')}}));
 return {set fail(value){fail=value;}};
}
test('income refresh uses concise dismissible toast, not large inline output',async({page})=>{
 await page.setViewportSize({width:390,height:844});await bankFixture(page);await menuGo(page,'income');
 await page.locator('#tab-income [data-refresh-bank]').click();
 await expect(page.locator('#bearToast .bear-toast-message')).toHaveText('Connections refreshed.');
 await expect(page.locator('#connectionMessage')).toBeEmpty();
 expect(await page.locator('.bank-refresh-status').allTextContents()).toEqual(expect.arrayContaining(['']));
 const r=await page.locator('#bearToast').boundingBox();expect(r.width).toBeLessThan(390);expect(r.x).toBeGreaterThanOrEqual(0);
 await page.getByRole('button',{name:'Dismiss notification'}).click();await expect(page.locator('#bearToast')).toBeHidden();
});
test('settings refresh failure stays visible with a recovery action',async({page})=>{
 const f=await bankFixture(page);f.fail=true;await menuGo(page,'settings');await page.locator('#bdSyncAll').click();
 await expect(page.locator('#bearToast .bear-toast-message')).toContainText('need attention');
 await expect(page.locator('#bearToast .bear-toast-action')).toHaveText('Settings');
 await expect(page.locator('#connectionMessage')).toBeEmpty();
 await expect(page.locator('#connectionAttention')).toContainText('Plaid · Test bank');
 await expect(page.locator('#connectionAttention')).toContainText('Bank connection failed. Reconnect to continue.');
 await expect(page.locator('[data-bd-status="classicBankStatus"]')).toHaveText('Needs attention');
 await page.locator('#connectionAttention [data-bd-detail="plaid"]').click();
 await expect(page.locator('#bdDetail-plaid')).toBeVisible();
 await page.getByRole('button',{name:'Close Plaid',exact:true}).click();
 await page.waitForTimeout(3200);await expect(page.locator('#bearToast')).toBeVisible();
 await page.getByRole('button',{name:'Dismiss notification'}).click();await expect(page.locator('#bearToast')).toBeHidden();
 f.fail=false;await page.locator('#bdSyncAll').click();
 await expect(page.locator('#connectionAttention')).toBeHidden();
 await expect(page.locator('[data-bd-status="classicBankStatus"]')).toHaveText('Connected');
});

test('guided setup reopens above preferences instead of behind its native modal',async({page})=>{
 await fixture(page);await menuGo(page,'settings');
 await page.locator('[data-bd-detail="preferences"]').click();
 await expect(page.locator('#bdDetail-preferences')).toBeVisible();
 await page.locator('#openGuidedSetup').click();
 await expect(page.locator('#bdDetail-preferences')).toBeHidden();
 await expect(page.locator('#setupTitle')).toHaveText('Welcome to BearDen');
 await page.locator('#setupLater').click();await expect(page.locator('#setupWizard')).toBeHidden();
});

test('hiding a Plaid account removes its activity and keeps the Lunch Flow copy and checking accounts available',async({page})=>{
 const f=await fixture(page);await page.goto('about:blank');
 const account=(id,name,type,source,balance)=>({id,name,type,source,balance,currency:'USD',itemId:source==='plaid'?'bank':'lunchflow',subtype:type==='depository'?'checking':type,balanceUpdated:'2026-10-28T12:00:00Z'});
 const accounts=[account('plaid-personal','Personal checking','depository','plaid',10000),account('plaid-bills','Bills checking','depository','plaid',20000),
  account('plaid-card','Card via Plaid','credit','plaid',30000),account('plaid-loan','Loan via Plaid','loan','plaid',0),account('lunchflow-card','Card via Lunch Flow','credit','lunchflow',45600)];
 const transactions=[['bank','personal','Checking purchase'],['bank','card','Plaid card purchase'],['lunchflow','lunchflow-card','Lunch Flow card purchase']].map(([itemId,account_id,name])=>({itemId,account_id,transaction_id:name,name,amount:12,currency:'USD',date:'2026-10-27'}));
 const connections={items:[{id:'bank',name:'Test bank',liabilitiesError:'PRODUCT_NOT_READY'}],creditCards:[{id:'issuer',accountId:'card',itemId:'bank',name:'Plaid issuer card',currency:'USD',balance:30000}],lunchflow:{connected:true,status:'Connected'},transactions};
 const values=f.tracker.state.values,planner=JSON.parse(values['income-planner']),state=JSON.parse(values['app-state']);
 state.cards=[{id:1,name:'Tracked card',debtKind:'credit-card',balance:200,apr:0,min:60,monthlyMinimum:130}];values['app-state']=JSON.stringify(state);
 planner.household.billsAccountId='plaid-bills';planner.accountVisibility['plaid-bills']=true;
 planner.hiddenConnectedAccounts={'plaid-loan':true};planner.debtAccountLinks={1:'plaid-card'};planner.debtBackupLinks={1:'lunchflow-card'};
 values['income-planner']=JSON.stringify(planner);
 await page.route('https://bearden.test/api/state',r=>r.fulfill({json:{state:{...blank(),accounts},connections,revision:0}}));
 await page.goto('https://bearden.test/');await expect(page.locator('#accountChoices')).toContainText('Card via Plaid');
 await expect(page.locator('#plaidAccountSummary')).toHaveText('Plaid accounts (3 shown)');
 await menuGo(page,'settings');await page.locator('#bdSettingsHub [data-bd-detail="plaid"]').click();
 await page.locator('#plaidAccountSummary').click();await page.locator('[data-hide-connected-account="plaid-card"]').click();
 const checkHidden=async()=>{
  await expect(page.locator('#plaidAccountSummary')).toHaveText('Plaid accounts (2 shown)');
  await expect(page.locator('#connectionAttention')).toBeHidden();
  await expect(page.locator('#accountChoices')).not.toContainText('Card via Plaid');
  await expect(page.locator('#accountChoices')).not.toContainText('Loan via Plaid');
  await expect(page.locator('#accountChoices')).toContainText('Card via Lunch Flow');
  await expect(page.locator('#incomeSummary')).toContainText('Personal checking');
  await expect(page.locator('#incomeSummary')).toContainText('Bills checking');
  await expect(page.locator('#transactionAccountFilter option[value="card"]')).toHaveCount(0);
  await expect(page.locator('#transactionAccountFilter option[value="lunchflow-card"]')).toHaveCount(1);
  await expect(page.locator('#debtAccounts')).not.toContainText('Plaid issuer card');
  await expect(page.locator('#debtAccounts')).toContainText('Connected Via Lunch Flow');
  await expect(page.locator('#debtAccounts')).toContainText('$456');
 };
 await checkHidden();await page.reload();await checkHidden();
 await menuGo(page,'settings');await page.locator('#bdSettingsHub [data-bd-detail="plaid"]').click();
 await page.locator('#plaidAccountSummary').click();await page.locator('#classicBalances .hidden-connection-accounts summary').click();
 await page.locator('[data-show-connected-account="plaid-card"]').click();
 await expect(page.locator('#plaidAccountSummary')).toHaveText('Plaid accounts (3 shown)');
 await expect(page.locator('#transactionAccountFilter option[value="card"]')).toHaveCount(1);
});
