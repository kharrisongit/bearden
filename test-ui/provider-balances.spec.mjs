import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

const observedAt='2026-10-27T12:00:00Z',checkedAt='2026-10-28T12:00:00Z';
async function fixture(page,{account={},item={},extraAccounts=[],lunchflow={connected:false},onRefresh}={}){
 const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const loan={id:'plaid-auto',itemId:'bank',source:'plaid',name:'Auto',type:'loan',subtype:'auto',currency:'USD',balance:0,zeroUnconfirmed:true,balanceUnavailable:true,reportedCurrent:0,reportedLiveCurrent:0,reportedCachedCurrent:0,...account};
 const bank={id:'bank',name:'ELGA',liabilities:false,...item},accounts=[loan,...extraAccounts],connections={items:[bank],transactions:[],creditCards:[],lunchflow};
 await page.addInitScript(()=>{window.Plaid={create:options=>{window.testPlaid=options;return {open(){},destroy(){}};}};});
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,body=req.method()==='POST'?req.postDataJSON():null;requests.push({path,body});
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'member',plaidConfigured:true}});
  if(path==='/api/classic')return route.fulfill({json:{state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,takeHome:1000,savingsGoals:[]}),onboarding:JSON.stringify({completed:true})}},revision:0}});
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections,revision:0}});
  if(path==='/api/plaid/diagnose'){bank.diagnostics={itemId:'bank',institutionId:'ins_elga',requestId:'check-id',loanDetailsSupported:true,consentedProducts:['transactions'],errorCode:null};return route.fulfill({json:{diagnostic:bank.diagnostics}});}
  if(path==='/api/plaid/link')return route.fulfill({json:{link_token:'existing-loan-update'}});
  if(path==='/api/plaid/updated'){
   expect(body).toEqual({itemId:'bank',kind:'loan'});
   Object.assign(bank,{liabilities:true,liabilitiesAttempt:Date.parse(checkedAt),liabilitiesUpdated:checkedAt,liabilitiesRequestId:'loan-success'});
   Object.assign(loan,{balance:712345,liabilityPrincipal:712345,liabilityAccountCurrent:0,liabilityUpdated:checkedAt,liabilityCheckedAt:checkedAt,liabilityStatus:'principal-reported',liabilityRequestId:'loan-success',balanceUpdated:checkedAt,balanceUnavailable:false,zeroUnconfirmed:false,balanceSource:'liabilities'});
   return route.fulfill({json:{itemId:'bank',status:'Loan details synced.'}});
  }
  if(path==='/api/cards/refresh'){expect(body).toEqual({itemId:'bank'});onRefresh?.(loan,bank);return route.fulfill({json:{itemId:'bank',status:bank.liabilitiesStatus||'Loan details refreshed.'}});}
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await page.locator('#nav-settings').click();
 return {requests,errors,loan,bank};
}
async function openLoanDetails(page){
 await page.locator('#plaidAccountSummary').click();const card=page.locator('[data-plaid-loan-account="plaid-auto"]');
 await card.locator('details.provider-diagnostics > summary').click();return card;
}
const dateLabel=(page,date)=>page.evaluate(value=>new Date(value).toLocaleString(),date);

test('mobile balance diagnostics show provider evidence and enable loans on the existing Plaid connection',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const extraAccounts=['missing','undated'].map(id=>({id:'lunchflow-'+id,itemId:'lunchflow',source:'lunchflow',name:id==='missing'?'Card One':'Card Two',institution:'Issuer',type:'credit',currency:'USD',debtSign:'positive',balance:0,rawBalance:id==='missing'?null:32500,providerUnavailable:true,balanceUnavailable:true,balanceObservation:{amount:id==='missing'?null:32500,amountStatus:id==='missing'?'missing':'reported',retrievedAt:observedAt,date:null,dateStatus:'missing',errors:[{code:'act.failed',reason:'Lunch Flow could not refresh this account.'}]}}));
 const {requests,errors}=await fixture(page,{extraAccounts,lunchflow:{connected:true,status:'Two balances need attention.'}});
 await page.locator('#configurePlaid').click();await page.getByRole('button',{name:'Check balance connection',exact:true}).click();await expect(page.locator('#plaidConnections')).toContainText('Available; use Enable / repair loan details');
 await page.locator('#plaidAccountSummary').click();const card=page.locator('[data-plaid-loan-account="plaid-auto"]');
 await expect(card.locator('[data-loan-details-status]')).toContainText('Loan details are not enabled for this connection.');
 await expect(card.getByRole('button',{name:'Enable / repair loan details',exact:true})).toBeVisible();
 await page.locator('#plaidConnections').getByRole('button',{name:'Enable / repair loan details',exact:true}).click();await expect.poll(()=>page.evaluate(()=>typeof window.testPlaid?.onSuccess)).toBe('function');expect(requests.find(r=>r.path==='/api/plaid/link').body).toEqual({kind:'loan',itemId:'bank'});await page.evaluate(()=>window.testPlaid.onSuccess('unused',{}));
 await expect(page.locator('#tab-settings')).toBeVisible();await card.locator('details.provider-diagnostics > summary').click();await expect(card.locator('details p')).toBeVisible();await expect(card.locator('details')).toContainText('Live current balance: $0.00');await expect(card.locator('details')).toContainText('Loan principal from Plaid Liabilities: $7,123.45');await expect(card.locator('[data-loan-details-status]')).toContainText('Plaid supplied a loan principal balance.');await expect(card.locator('details')).toContainText('Loan principal observed: '+await dateLabel(page,checkedAt));
 await page.locator('#configureLunchflow').click();await page.locator('#lunchflowAccountSummary').click();const missing=page.locator('[data-lunchflow-account="lunchflow-missing"]'),undated=page.locator('[data-lunchflow-account="lunchflow-undated"]');await missing.locator('summary').click();await undated.locator('summary').click();await expect(missing.locator('details')).toContainText('Amount supplied by Lunch Flow: Not supplied');await expect(undated.locator('details')).toContainText('Amount supplied by Lunch Flow: $325.00');await expect(undated.locator('details')).toContainText('Bank balance date: not provided.');await expect(undated.locator('details p').first()).toBeVisible();
 expect(requests.some(r=>r.path==='/api/plaid/exchange')).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
 await page.screenshot({path:'/tmp/provider-diagnostics-mobile.png',fullPage:true});
});

test('an enabled loan without a request offers refresh and shows an omitted account after the successful request',async({page})=>{
 const {requests,errors}=await fixture(page,{item:{liabilities:true},onRefresh:(loan,bank)=>{
  Object.assign(bank,{liabilitiesAttempt:Date.parse(checkedAt),liabilitiesUpdated:checkedAt,liabilitiesRequestId:'missing-account'});
  Object.assign(loan,{liabilityCheckedAt:checkedAt,liabilityStatus:'account-not-returned',liabilityRequestId:'missing-account'});
 }});
 const card=await openLoanDetails(page);await expect(card.locator('[data-loan-details-status]')).toContainText('Loan details have not been requested yet.');
 await card.getByRole('button',{name:'Refresh loan details',exact:true}).click();
 await expect(card.locator('[data-loan-details-status]')).toContainText('Plaid’s latest loan-details response did not include this account.');
 await card.locator('details.provider-diagnostics > summary').click();
 await expect(card.locator('details')).toContainText('Latest successful loan-details request: '+await dateLabel(page,checkedAt));
 await expect(card).not.toContainText('Not yet checked');await expect(card).not.toContainText('have not been requested');
 expect(requests.filter(r=>r.path==='/api/cards/refresh').map(r=>r.body)).toEqual([{itemId:'bank'}]);expect(requests.some(r=>r.path==='/api/plaid/link')).toBe(false);expect(errors).toEqual([]);
});

for(const [code,message,action] of [
 ['PRODUCT_NOT_READY','Latest loan-details request failed: PRODUCT_NOT_READY.','Refresh loan details'],
 ['ADDITIONAL_CONSENT_REQUIRED','Plaid requires additional consent for loan details.','Enable / repair loan details'],
])test('a failed loan-details request displays '+code+' with its attempt and recovery action',async({page})=>{
 const {errors}=await fixture(page,{item:{liabilities:true,liabilitiesAttempt:Date.parse(checkedAt),liabilitiesError:code}});
 const card=await openLoanDetails(page);await expect(card.locator('[data-loan-details-status]')).toContainText(message);await expect(card.getByRole('button',{name:action,exact:true})).toBeVisible();
 await expect(card.locator('details')).toContainText('Latest loan-details attempt: '+await dateLabel(page,checkedAt));await expect(card).not.toContainText('Not yet checked');await expect(card).not.toContainText('have not been requested');
 if(code==='PRODUCT_NOT_READY'){
  await expect(card).not.toContainText('requires additional consent');await page.locator('#configurePlaid').click();await page.getByRole('button',{name:'Check balance connection',exact:true}).click();
  const diagnostics=page.locator('#plaidConnections .provider-diagnostics');await expect(diagnostics).toContainText('PRODUCT_NOT_READY');await expect(diagnostics).not.toContainText('No connection error reported');
 }expect(errors).toEqual([]);
});

test('a legacy successful request without per-account metadata does not claim loan details were never requested',async({page})=>{
 const {errors}=await fixture(page,{item:{liabilities:true,liabilitiesAttempt:Date.parse(checkedAt),liabilitiesUpdated:checkedAt}});
 const card=await openLoanDetails(page);await expect(card.locator('[data-loan-details-status]')).toHaveText('No saved loan-detail result for this account.');await expect(card.getByRole('button',{name:'Refresh loan details',exact:true})).toBeVisible();
 await expect(card.locator('details')).toContainText('Latest successful loan-details request: '+await dateLabel(page,checkedAt));await expect(card).not.toContainText('have not been requested');await expect(card).not.toContainText('Not yet checked');expect(errors).toEqual([]);
});

for(const [status,message] of [
 ['account-not-returned','Plaid’s latest loan-details response did not include this account.'],
 ['details-not-returned','Plaid returned this account without loan-detail information.'],
 ['principal-unavailable','Plaid returned loan details without a usable principal balance.'],
])test('a successful request distinguishes '+status+' from a loan that was never checked',async({page})=>{
 const {errors}=await fixture(page,{item:{liabilities:true,liabilitiesAttempt:Date.parse(checkedAt),liabilitiesUpdated:checkedAt},account:{liabilityCheckedAt:checkedAt,liabilityStatus:status,liabilityPrincipal:null}});
 const card=await openLoanDetails(page);await expect(card.locator('[data-loan-details-status]')).toContainText(message);await expect(card.getByRole('button',{name:'Refresh loan details',exact:true})).toBeVisible();
 await expect(card.locator('details')).toContainText('Latest successful loan-details request: '+await dateLabel(page,checkedAt));await expect(card.locator('details')).toContainText('Loan principal from Plaid Liabilities: No principal observation saved');await expect(card).not.toContainText('Not yet checked');await expect(card).not.toContainText('have not been requested');expect(errors).toEqual([]);
});

for(const principal of [0,712345])test('a reported principal of '+principal+' retains the date of that observation',async({page})=>{
 const {errors}=await fixture(page,{item:{liabilities:true,liabilitiesAttempt:Date.parse(checkedAt),liabilitiesUpdated:checkedAt},account:{liabilityCheckedAt:checkedAt,liabilityStatus:'principal-reported',liabilityPrincipal:principal,liabilityUpdated:checkedAt,...(principal>0?{balance:principal,balanceUnavailable:false,zeroUnconfirmed:false,balanceSource:'liabilities',balanceUpdated:checkedAt}:{})}});
 const card=await openLoanDetails(page);await expect(card.locator('[data-loan-details-status]')).toContainText(principal===0?'Plaid supplied a $0 loan principal. This does not confirm payoff.':'Plaid supplied a loan principal balance.');await expect(card.locator('details')).toContainText('Loan principal from Plaid Liabilities: '+(principal===0?'$0.00':'$7,123.45'));await expect(card.locator('details')).toContainText('Loan principal observed: '+await dateLabel(page,checkedAt));
 if(principal===0){await expect(card).toContainText('Loan balance needs verification');await expect(card).not.toContainText('confirmed paid off');}expect(errors).toEqual([]);
});

test('a failed refresh keeps the prior positive principal and its original observation date',async({page})=>{
 const {errors}=await fixture(page,{item:{liabilities:true,liabilitiesAttempt:Date.parse(checkedAt),liabilitiesUpdated:observedAt,liabilitiesError:'INSTITUTION_DOWN'},account:{balance:712345,balanceUpdated:observedAt,balanceSource:'liabilities',liabilityPrincipal:712345,liabilityUpdated:observedAt,liabilityCheckedAt:observedAt,liabilityStatus:'principal-reported'}});
 const card=await openLoanDetails(page);await expect(card.locator('[data-loan-details-status]')).toContainText('Latest loan-details request failed: INSTITUTION_DOWN.');await expect(card).toContainText('Last known balance: $7,123.45');await expect(card.locator('details')).toContainText('Loan principal from Plaid Liabilities: $7,123.45');
 await expect(card.locator('details')).toContainText('Loan principal observed: '+await dateLabel(page,observedAt));await expect(card.locator('details')).toContainText('Latest loan-details attempt: '+await dateLabel(page,checkedAt));await expect(card.locator('details')).not.toContainText('Loan principal observed: '+await dateLabel(page,checkedAt));await expect(card).not.toContainText('Not yet checked');expect(errors).toEqual([]);
});

test('an internal zero placeholder is not described as a zero reported by Plaid',async({page})=>{
 const {errors}=await fixture(page,{account:{reportedCurrent:null,reportedLiveCurrent:null,reportedCachedCurrent:null,reportedAvailable:null}});
 const card=await openLoanDetails(page);await expect(card.locator('details')).toContainText('General account balance reported by Plaid: Not supplied');await expect(card.locator('details')).toContainText('Loan principal from Plaid Liabilities: No principal observation saved');await expect(card).not.toContainText('Plaid reports zero');await expect(card).not.toContainText('response reported $0');await expect(card).not.toContainText('$0.00');expect(errors).toEqual([]);
});
