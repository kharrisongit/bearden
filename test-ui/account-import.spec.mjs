import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

test('mobile Settings repairs the existing bank and finishes transaction batches with clear saved balance status',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const connections={items:[{id:'bank',name:'Family Bank',transactionsError:'ITEM_LOGIN_REQUIRED'}],transactions:[],creditCards:[],gmailAccounts:[],lunchflow:{connected:true,status:'Lunch Flow loaded 1 account(s).'}};
 const accounts=[{id:'plaid-a',itemId:'bank',source:'plaid',type:'depository',subtype:'checking',name:'Checking',balance:12345,balanceUpdated:'2026-10-26T12:00:00Z',balanceUnavailable:true,accountMissing:true,currency:'USD',include:true},{id:'lunchflow-a',itemId:'lunchflow',source:'lunchflow',name:'Savings',institution:'Family Bank',type:'depository',subtype:'savings',balance:10000,rawBalance:10000,currency:'USD',include:false}];
 accounts.push({id:'plaid-car',itemId:'bank',source:'plaid',type:'loan',subtype:'auto',name:'Car loan',balance:0,reportedCurrent:0,zeroUnconfirmed:true,balanceUnavailable:true,balanceUpdated:null,currency:'USD',include:false});
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
 await page.locator('#plaidAccountSummary').click();await expect(page.locator('#classicBalances')).toContainText('Last known balance: $123.45');await expect(page.locator('#classicBalances')).toContainText('Account missing');await expect(page.locator('#classicBalances')).toContainText('Loan balance needs verification');
 await page.locator('[data-bank-update="bank"]').click();await expect.poll(()=>requests.find(r=>r.path==='/api/plaid/link')?.body).toEqual({kind:'bank',itemId:'bank'});
 await expect.poll(()=>page.evaluate(()=>typeof window.testPlaid?.onSuccess)).toBe('function');
 await page.evaluate(()=>window.testPlaid.onSuccess('unused',{institution:{name:'Family Bank'}}));
 expect(batches).toBe(2);expect(requests.some(r=>r.path==='/api/plaid/exchange')).toBe(false);
 await page.locator('#nav-settings').click();await expect(page.locator('#plaidConnections')).toContainText('1 saved transaction(s)');
 await page.locator('#configureLunchflow').click();await expect(page.locator('#lunchflowRefresh')).toBeVisible();await expect(page.locator('#configureSimplefin')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});

test('renaming a Lunch Flow account survives resync; saves and refreshes do not overlap',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const old='lunchflow-old',duplicate=old;
 let accounts=[{id:old,source:'lunchflow',name:'Provider checking',institution:'Bank',type:'depository',subtype:'checking',currency:'USD',balance:12300,rawBalance:12300,include:false}];
 const connections={items:[],transactions:[],creditCards:[],lunchflow:{connected:true,status:'Connected'},sun:{connected:true,enabled:true,status:'Connected'}};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,takeHome:1000,savingsGoals:[]}),onboarding:JSON.stringify({completed:true}),'income-planner':JSON.stringify({accountNames:{[duplicate]:'Old duplicate label'},household:{personalAccountId:duplicate}})}},revision:0},active=0,maxActive=0,refreshes=0,rentCalls=0;
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,post=req.method()==='POST';
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'husband',rentConfigured:true}});
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections,revision:0}});
  if(post){active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,30));}
  try{
   if(path==='/api/classic'){
    if(post){tracker={state:req.postDataJSON().state,revision:tracker.revision+1};return await route.fulfill({json:{revision:tracker.revision}});}
    return await route.fulfill({json:tracker});
   }
   if(path==='/api/lunchflow/refresh'){
    refreshes++;accounts=[{...accounts[0],name:'New upstream name',identityAliases:[duplicate]}];
    return await route.fulfill({json:{status:'Lunch Flow loaded 1 account(s).'}});
   }
   if(path==='/api/rent/refresh'){
    rentCalls++;return await route.fulfill(rentCalls===1?{status:409,json:{error:'A sync or save is already running. Try again in a moment.',code:'SYNC_BUSY'}}:{json:{status:'Rent checked.'}});
   }
   if(path.startsWith('/api/'))return await route.fulfill({status:404,json:{}});
   const name=path==='/'?'index.html':path.slice(1);try{return await route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return await route.fulfill({status:404,body:''});}
  }finally{if(post)active--;}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await expect(page.locator('#configureHousehold')).toBeEnabled();
 await page.locator('#nav-settings').click();await page.locator('#configureLunchflow').click();await page.locator('#lunchflowAccountSummary').click();
 await page.locator('[data-rename-connected-account="'+old+'"]').click();await page.locator('#connectedAccountName').fill('Richard’s checking');await page.locator('#connectedAccountNameForm [type=submit]').click();await expect(page.locator('#connectedAccountNameEditor')).toBeHidden();
 await page.locator('#classicSync').click();
 // Simulate an autosave while the provider request is in progress.
 await page.evaluate(()=>window.BearDen.storage.set('notes','[]'));
 await expect(page.locator('#connectionMessage')).toContainText('Rent checked.');
 await expect(page.locator('[data-lunchflow-account]')).toHaveCount(1);await expect(page.locator('#lunchflowAccounts')).toContainText('Richard’s checking');
 const planner=JSON.parse(tracker.state.values['income-planner']);expect(planner.accountNames[old]).toBe('Richard’s checking');expect(planner.household.personalAccountId).toBe(old);expect(maxActive).toBe(1);expect(refreshes).toBe(1);expect(rentCalls).toBe(2);
 await page.reload();await page.evaluate(()=>window.classicReady);await page.locator('#nav-settings').click();await page.locator('#configureLunchflow').click();await page.locator('#lunchflowAccountSummary').click();await expect(page.locator('#lunchflowAccounts')).toContainText('Richard’s checking');await expect(page.locator('[data-lunchflow-account]')).toHaveCount(1);expect(errors).toEqual([]);
});
