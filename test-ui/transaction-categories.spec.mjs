import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

async function fixture(page){
 await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 const accounts=['personal','bills'].map(id=>({id:'plaid-'+id,itemId:'bank',name:id+' checking',source:'plaid',type:'depository',subtype:'checking',balance:100000,currency:'USD'}));
 const transaction=(id,name,amount,account_id='personal')=>({transaction_id:id,itemId:'bank',account_id,name,amount,date:'2026-10-25',currency:'USD',pending:false});
 const transactions=[transaction('shop-1','Corner Shop #12',20),transaction('shop-2','Corner Shop #19',30),transaction('coffee','Starbucks',5),transaction('bill','Consumers Energy',100,'bills'),transaction('transfer','Transfer to savings',200)];
 const connections={items:[{id:'bank',name:'Bank'}],transactions,creditCards:[],recurringBills:[],gmailMessages:[]};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1000',savingsGoals:[{id:1,name:'Emergency',goal:1000,start:100,contribution:50}],savingsGoalIdCounter:1}),'income-planner':JSON.stringify({household:{personalAccountId:'plaid-personal',billsAccountId:'plaid-bills'}}),onboarding:JSON.stringify({completed:true})}},revision:0},failSave=false;
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'test'}});
  if(path==='/api/classic'){
   if(req.method()==='GET')return route.fulfill({json:tracker});
   if(failSave)return route.fulfill({status:500,json:{error:'Could not save category'}});
   tracker={state:req.postDataJSON().state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections,revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);
  try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
 await expect(page.locator('#configureHousehold')).toBeEnabled();
 return {transactions,transaction,failSave:()=>failSave=true,get planner(){return JSON.parse(tracker.state.values['income-planner']);}};
}
async function showTransactions(page){await page.locator('#nav-income').click();await page.locator('#incomeTransactionsToggleBtn').click();}
const edit=(page,id)=>page.locator('#bankTransactions [data-edit-transaction-category="'+id+'"]');
async function choose(page,id,category,remember=true){
 await edit(page,id).click();await page.locator('#transactionCategoryChoice').selectOption(category);
 await page.locator('#transactionCategoryRemember').setChecked(remember);
 await page.locator('#transactionCategoryForm [type="submit"]').click();await expect(page.locator('#transactionCategoryEditor')).toBeHidden();
}

test('mobile: automatic categories, merchant learning, single-purchase exceptions, reload and reset',async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));const f=await fixture(page);
 await showTransactions(page);await expect(edit(page,'coffee')).toHaveText('Dining');await expect(edit(page,'bill')).toHaveText('Electric');await expect(edit(page,'transfer')).toHaveText('Transfers');
 await edit(page,'shop-1').click();await expect(page.locator('#transactionCategoryRemember')).toBeChecked();
 await page.locator('#transactionCategoryChoice').selectOption('groceries');await page.locator('#transactionCategoryForm [type="submit"]').click();
 await expect(edit(page,'shop-1')).toHaveText('Groceries');await expect(edit(page,'shop-2')).toHaveText('Groceries');
 await expect(page.locator('#personalSpending')).toContainText('Groceries');expect(f.planner.transactionCategories.merchants['corner shop']).toBe('groceries');
 await choose(page,'shop-1','personal',false);await expect(edit(page,'shop-1')).toHaveText('Health & personal');await expect(edit(page,'shop-2')).toHaveText('Groceries');
 f.transactions.push(f.transaction('shop-3','Corner Shop #99',15));await page.reload();await page.evaluate(()=>window.classicReady);await showTransactions(page);
 await expect(edit(page,'shop-1')).toHaveText('Health & personal');await expect(edit(page,'shop-2')).toHaveText('Groceries');await expect(edit(page,'shop-3')).toHaveText('Groceries');
 await page.locator('#transactionSort').selectOption('category');
 expect(await page.locator('#bankTransactions .transaction-category-edit').allTextContents()).toEqual(['Dining','Electric','Groceries','Groceries','Health & personal','Transfers']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/categories-mobile.png'});
 await choose(page,'shop-2','auto');await expect(edit(page,'shop-2')).toHaveText('Other spending');await expect(edit(page,'shop-3')).toHaveText('Other spending');await expect(edit(page,'shop-1')).toHaveText('Health & personal');
 expect(errors).toEqual([]);
});

test('bills chart transactions can be recategorized directly and failed saves keep the previous category',async({page})=>{
 await page.setViewportSize({width:320,height:844});const f=await fixture(page);await page.locator('#nav-income').click();
 // Reveal the existing bills spending panel without adding a second editing surface.
 await page.evaluate(()=>{for(let el=document.querySelector('#billsSpendingTransactions');el;el=el.parentElement){el.hidden=false;if(el.tagName==='DETAILS')el.open=true;}});
 const button=page.locator('#billsSpendingTransactions [data-edit-transaction-category="bill"]');await button.click();
 await page.locator('#transactionCategoryChoice').selectOption('utilities');await page.locator('#transactionCategoryForm [type="submit"]').click();await expect(page.locator('#transactionCategoryEditor')).toBeHidden();
 await expect(page.locator('#billsSpendingCategories')).toContainText('Utilities');await expect(button).toHaveText('Utilities');
 await button.click();expect(await page.locator('#transactionCategoryEditor').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 f.failSave();await page.locator('#transactionCategoryChoice').selectOption('shopping');await page.locator('#transactionCategoryForm [type="submit"]').click();
 await expect(page.locator('#transactionCategoryError')).not.toBeEmpty();await expect(page.locator('#transactionCategoryEditor')).toBeVisible();
 await expect(button).toHaveText('Utilities');expect(f.planner.transactionCategories.merchants['consumers energy']).toBe('utilities');
});
