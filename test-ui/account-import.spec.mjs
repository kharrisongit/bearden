import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

test('mobile Settings repairs the existing bank and finishes transaction batches with clear saved balance status',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const connections={items:[{id:'bank',name:'Family Bank',transactionsError:'ITEM_LOGIN_REQUIRED'}],transactions:[],creditCards:[],gmailAccounts:[],simplefin:{connected:true,status:'SimpleFIN loaded 1 account(s).'}};
 const accounts=[{id:'plaid-a',itemId:'bank',source:'plaid',type:'depository',subtype:'checking',name:'Checking',balance:12345,balanceUpdated:'2026-10-26T12:00:00Z',balanceUnavailable:true,accountMissing:true,currency:'USD',include:true},{id:'simplefin-a',itemId:'simplefin',source:'simplefin',name:'Savings',institution:'Family Bank',type:'depository',subtype:'savings',balance:10000,rawBalance:10000,currency:'USD',include:false}];
 let batches=0;
 await page.addInitScript(()=>{window.Plaid={create:options=>{window.testPlaid=options;return {open(){},destroy(){}};}};});
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,body=req.method()==='POST'?req.postDataJSON():null;requests.push({path,body});
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'member',plaidConfigured:true}});
  if(path==='/api/classic')return route.fulfill({json:{state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,takeHome:1000,savingsGoals:[]}),onboarding:JSON.stringify({completed:true})}},revision:0}});
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections,revision:0}});
  if(path==='/api/plaid/link')return route.fulfill({json:{link_token:'test-link'}});
  if(path==='/api/plaid/updated')return route.fulfill({json:{status:'Loading history',itemId:'bank',transactionsPending:true}});
  if(path==='/api/bank/refresh'){
   expect(body.continueTransactions).toBe(true);batches++;
   if(batches===2){connections.items[0]={id:'bank',name:'Family Bank',transactionsUpdated:new Date().toISOString()};connections.transactions=[{transaction_id:'t',account_id:'a',itemId:'bank',date:new Date().toISOString().slice(0,10),amount:10,currency:'USD',name:'Purchase'}];}
   return route.fulfill({json:{status:'Family Bank synced.',itemId:'bank',transactionsPending:batches<2}});
  }
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await page.locator('#nav-settings').click();await page.locator('#configurePlaid').click();
 await expect(page.locator('#plaidConnections')).toContainText('ITEM_LOGIN_REQUIRED');await expect(page.locator('#classicBank')).toHaveText('Add another bank');
 await page.locator('#plaidAccountSummary').click();await expect(page.locator('#classicBalances')).toContainText('Last known balance: $123.45');await expect(page.locator('#classicBalances')).toContainText('Account missing');
 await page.locator('[data-bank-update="bank"]').click();await expect.poll(()=>requests.find(r=>r.path==='/api/plaid/link')?.body).toEqual({kind:'bank',itemId:'bank'});
 await expect.poll(()=>page.evaluate(()=>typeof window.testPlaid?.onSuccess)).toBe('function');
 await page.evaluate(()=>window.testPlaid.onSuccess('unused',{institution:{name:'Family Bank'}}));
 expect(batches).toBe(2);expect(requests.some(r=>r.path==='/api/plaid/exchange')).toBe(false);
 await page.locator('#nav-settings').click();await expect(page.locator('#plaidConnections')).toContainText('1 saved transaction(s)');
 await page.locator('#configureSimplefin').click();await expect(page.getByRole('link',{name:'Manage SimpleFIN accounts'})).toHaveAttribute('href','https://bridge.simplefin.org/');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
