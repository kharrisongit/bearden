import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';
import {billSharingAction} from '../bill-sharing.mjs';
const water={id:'water',name:'Water',amount:6400,date:'2026-11-15',repeat:'monthly',billKind:'utility',source:'manual'};
async function profile(browser,db,id,manual=[]){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
 let authenticated=true;
 const tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1000',savingsGoals:[]}),'income-planner':JSON.stringify({manual,billFunding:{water:'shared'}}),onboarding:JSON.stringify({completed:true})}},revision:0};
 const services={accountId:id,read:async key=>db.get(id+':'+key)||null,write:async(key,value)=>db.set(id+':'+key,structuredClone(value)),rawRead:async key=>db.get(key)||null,rawWrite:async(key,value)=>db.set(key,structuredClone(value)),rawDelete:async key=>db.delete(key)};
 await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated,accountId:id,email:id+'@example.com'}});
  if(path==='/api/classic'){if(req.method()!=='GET'){tracker.state=req.postDataJSON().state;tracker.revision++;}return route.fulfill({json:tracker});}
  if(path==='/api/state')return route.fulfill({json:{state:blank(),connections:{items:[],transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]},revision:0}});
  if(path.startsWith('/api/bills/share/')){try{return route.fulfill({json:await billSharingAction(path.split('/').at(-1),req.postDataJSON(),services)});}catch(e){return route.fulfill({status:400,json:{error:e.message}});}}
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 return {page,context,tracker,login:value=>authenticated=value};
}
test('a sender shares a short code and the recipient opens a link, previews and imports once',async({browser})=>{
 const db=new Map(),sender=await profile(browser,db,'sender',[water]),receiver=await profile(browser,db,'receiver'),errors=[];
 for(const p of [sender.page,receiver.page])p.on('pageerror',e=>errors.push(e.message));
 const page=sender.page;await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await page.locator('#nav-accounts').click();await page.locator('#accounts-nav-bills').click();await page.locator('#accounts-bills [data-open-bill-sharing]').click();
 await page.locator('#createBillShare').click();await expect(page.locator('#billShareCode')).toHaveValue(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
 const code=await page.locator('#billShareCode').inputValue();await page.locator('#createBillShare').click();await expect(page.locator('#billShareCode')).toHaveValue(code);
 const recipient=receiver.page;await recipient.goto('https://bearden.test/#bills='+code.toLowerCase());
 await expect(recipient.locator('#billSharePreview')).toBeVisible();await expect(recipient.locator('#billShareImportChoices')).toContainText('Water');await expect(recipient.locator('#billShareImportCode')).toHaveValue(code);
 await recipient.locator('#importSharedBills').click();await expect(recipient.locator('#billShareDialog')).toBeHidden();await expect(recipient.locator('#householdEditor')).toBeHidden();await expect(recipient.locator('#billAgenda')).toContainText('Water');
 expect(JSON.parse(receiver.tracker.state.values['income-planner']).manual).toHaveLength(1);
 await recipient.goto('https://bearden.test/#bills='+code);await expect(recipient.locator('#billShareImportStatus')).toHaveText('These bills are already in your account.');await expect(recipient.locator('#importSharedBills')).toBeDisabled();
 expect(errors).toEqual([]);await sender.context.close();await receiver.context.close();
});
test('share links survive the sign-in handoff and pasted lowercase codes work',async({browser})=>{
 const db=new Map(),recipient=await profile(browser,db,'receiver');
 const raw={accountId:'sender',read:async k=>db.get('sender:'+k),write:async(k,v)=>db.set('sender:'+k,v),rawRead:async k=>db.get(k),rawWrite:async(k,v)=>db.set(k,v),rawDelete:async k=>db.delete(k)};
 const share=await billSharingAction('create',{bills:[water]},raw),page=recipient.page;
 recipient.login(false);await page.goto('https://bearden.test/#bills='+share.code);await expect(page.locator('#connectionMessage')).toHaveText('Sign in to add the shared bills.');
 expect(await page.evaluate(()=>sessionStorage.getItem('bearden-pending-bill-share'))).toBe(share.code);
 recipient.login(true);await page.reload();await expect(page.locator('#billSharePreview')).toBeVisible();
 await page.locator('#billShareImportCode').fill(share.code.toLowerCase().replace('-',' '));await page.locator('#previewBillShare').click();await expect(page.locator('#billShareImportChoices')).toContainText('Water');await expect(page.locator('#billShareImportCode')).toHaveValue(share.code);
 expect(await page.locator('#billShareDialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:'test-results/bill-sharing-mobile.png'});await recipient.context.close();
});
