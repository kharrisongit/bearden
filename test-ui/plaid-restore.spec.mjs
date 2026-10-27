import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

async function fixture(page,{resumeAccount=null}={}){
 await page.setViewportSize({width:390,height:844});
 const requests=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const connections={items:[],transactions:[],creditCards:[],lunchflow:{connected:true,status:'Connected'}};
 const accounts=[{id:'lunchflow-checking',source:'lunchflow',name:'Checking',type:'depository',subtype:'checking',currency:'USD',balance:12300,include:false}];
 await page.addInitScript(resumeAccount=>{
  window.Plaid={create:options=>{window.testPlaid=options;return {open(){},destroy(){}};}};
  if(resumeAccount){sessionStorage.setItem('bearden-link-token','oauth-link');sessionStorage.setItem('bearden-link-context','{}');sessionStorage.setItem('bearden-link-account',resumeAccount);}
 },resumeAccount);
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,body=req.method()==='POST'?req.postDataJSON():null;requests.push({path,body,account:req.headers()['x-bearden-account']});
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'member',plaidConfigured:true}});
  if(path==='/api/classic')return route.fulfill({json:{state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,takeHome:1000,savingsGoals:[]}),onboarding:JSON.stringify({completed:true})}},revision:0}});
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections,revision:0}});
  if(path==='/api/plaid/link')return route.fulfill({json:{link_token:'new-link'}});
  if(path==='/api/plaid/exchange'){
   connections.items.push({id:'new-bank',name:body.name});accounts.push({id:'plaid-checking',source:'plaid',itemId:'new-bank',name:'Checking',type:'depository',subtype:'checking',currency:'USD',balance:12300,include:false});
   return route.fulfill({json:{status:'Bank connected.',itemId:'new-bank',transactionsPending:true}});
  }
  if(path==='/api/bank/refresh')return route.fulfill({json:{status:'History loaded.',itemId:'new-bank',transactionsPending:false}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/'+(resumeAccount?'?oauth_state_id=return':''));await page.evaluate(()=>window.classicReady);
 return {requests,errors,connections};
}

for(const resume of [false,true])test(`mobile Plaid ${resume?'OAuth return':'new connection'} keeps Lunch Flow and saves only to the signed-in profile`,async({page})=>{
 const f=await fixture(page,{resumeAccount:resume?'member':null});
 if(!resume){
  await page.locator('#nav-settings').click();await page.locator('#configurePlaid').click();await page.locator('#classicBank').click();
  await expect.poll(()=>page.evaluate(()=>typeof window.testPlaid?.onExit)).toBe('function');await page.evaluate(()=>window.testPlaid.onExit(null));expect(f.requests.some(r=>r.path==='/api/plaid/exchange')).toBe(false);
  await page.locator('#classicBank').click();
 }
 await expect.poll(()=>page.evaluate(()=>typeof window.testPlaid?.onSuccess)).toBe('function');
 if(resume){expect(await page.evaluate(()=>window.testPlaid.receivedRedirectUri)).toContain('oauth_state_id=return');expect(f.requests.some(r=>r.path==='/api/plaid/link')).toBe(false);}
 await page.evaluate(()=>window.testPlaid.onSuccess('public-test',{institution:{name:'Example Bank'}}));
 const exchanged=f.requests.find(r=>r.path==='/api/plaid/exchange');expect(exchanged.account).toBe('member');expect(exchanged.body).toEqual({public_token:'public-test',name:'Example Bank'});
 expect(f.requests.find(r=>r.path==='/api/bank/refresh').body).toEqual({itemId:'new-bank',continueTransactions:true});
 expect(f.connections.lunchflow.connected).toBe(true);expect(f.requests.some(r=>r.path==='/api/banks/retire')).toBe(false);
 expect(await page.evaluate(()=>sessionStorage.getItem('bearden-link-token'))).toBeNull();expect(new URL(page.url()).search).toBe('');
 await page.locator('#nav-settings').click();await expect(page.locator('#classicBankStatus')).toHaveText('Connected');await expect(page.locator('#lunchflowStatus')).toHaveText('Connected');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(f.errors).toEqual([]);
 if(!resume)await page.screenshot({path:'/tmp/bearden-plaid-settings-mobile.png',fullPage:true});
});

test('Plaid OAuth return refuses to connect under a different BearDen profile',async({page})=>{
 const f=await fixture(page,{resumeAccount:'another-member'});await page.locator('#nav-settings').click();
 await expect(page.locator('#connectionMessage')).toContainText('Your BearDen account changed');expect(f.requests.some(r=>r.path.startsWith('/api/plaid/'))).toBe(false);expect(await page.evaluate(()=>window.testPlaid)).toBeUndefined();expect(await page.evaluate(()=>sessionStorage.getItem('bearden-link-token'))).toBeNull();expect(f.errors).toEqual([]);
});
