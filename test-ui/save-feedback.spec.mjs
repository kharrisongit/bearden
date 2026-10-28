import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runtime} from '../cloudflare/worker.mjs';
import {blank} from '../public/engine.mjs';

async function fixture(page){
 const accounts=Array.from({length:8},(_,i)=>({id:'lunchflow-'+i,name:'Checking '+i,institution:'Test bank',source:'lunchflow',type:'depository',subtype:'checking',balance:120000,rawBalance:120000,currency:'USD',balanceUpdated:'2026-10-27T12:00:00Z'}));
 const planner={manual:[{id:'water',name:'Water',amount:6000,date:'2026-11-12',repeat:'monthly',billKind:'utility',source:'manual'}],accountVisibility:{'lunchflow-0':true}};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[],budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1000',savingsGoals:[]}),onboarding:JSON.stringify({completed:true}),'income-planner':JSON.stringify(planner)}},revision:0},fail=false;
 const app=runtime({APP_URL:'https://bearden.test',ASSETS:{fetch:async req=>{
  const path=new URL(req.url).pathname,name=path==='/'?'index.html':path.slice(1);
  try{return new Response(readFileSync(new URL('../public/'+name,import.meta.url)),{headers:{'Content-Type':name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'}});}catch{return new Response('',{status:404});}
 }}});
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'fixture',bankProvider:'lunchflow'}});
  if(path==='/api/banks/retire')return route.fulfill({json:{ok:true}});
  if(path==='/api/classic'){
   if(req.method()==='POST'){
    if(fail)return route.fulfill({status:500,json:{error:'Save failed. Please try again.'}});
    tracker={state:req.postDataJSON().state,revision:tracker.revision+1};
   }
   return route.fulfill({json:req.method()==='GET'?tracker:{revision:tracker.revision}});
  }
  if(path==='/api/lunchflow/account'){
   if(fail)return route.fulfill({status:500,json:{error:'Account type could not be saved.'}});
   const d=req.postDataJSON(),account=accounts.find(a=>a.id===d.id);account.subtype=d.kind;
   return route.fulfill({json:{ok:true}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections:{lunchflow:{status:'Connected'},items:[],transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const response=await app.handle(new Request(req.url()));return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await expect(page.locator('#configureHousehold')).toBeEnabled();
 return {failSave:value=>fail=value,get planner(){return JSON.parse(tracker.state.values['income-planner']);}};
}
async function openAccounts(page){await page.locator('#nav-settings').click();await page.locator('#configureLunchflow').click();await page.locator('#lunchflowAccountSummary').click();}

for(const [width,theme]of [[390,'light'],[1440,'dark']])test(`${width}px: a saved Lunch Flow type confirms at the viewport top and fades`,async({page})=>{
 await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));await fixture(page);
 await expect(page.locator('#bearToast')).toHaveCount(0);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await openAccounts(page);const account=page.locator('[data-lunchflow-account]').last();await account.locator('[name=kind]').selectOption('savings');await account.locator('[type=submit]').click();
 const toast=page.locator('#bearToast');await expect(toast).toHaveText('Account type saved');await expect(toast).toBeVisible();
 expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(500);const bounds=await toast.boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(6);expect(bounds.y).toBeLessThan(30);expect(bounds.width).toBeLessThan(width-20);
 await page.evaluate(()=>scrollBy(0,-300));expect((await toast.boundingBox()).y).toBeLessThan(30);
 await expect(account.locator('[name=kind]')).toHaveValue('savings');
 const badge=await page.locator('#lunchflowStatus').evaluate(el=>({height:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el).fontSize),bg:getComputedStyle(el).backgroundColor}));
 expect(badge.height).toBeLessThan(26);expect(badge.font).toBeLessThan(11);expect(badge.bg).toBe(theme==='light'?'rgb(227, 245, 232)':'rgb(208, 235, 216)');
 await page.screenshot({path:`test-results/save-toast-${width}.png`});await expect(toast).toBeHidden({timeout:4500});expect(errors).toEqual([]);
});

test('failed saves show the error without a success toast; bill saves confirm after persistence',async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=await fixture(page);await openAccounts(page);f.failSave(true);
 const account=page.locator('[data-lunchflow-account]').last();await account.locator('[type=submit]').click();await expect(account.locator('[data-lunchflow-account-status]')).toContainText(/could not be saved|Save failed/);await expect(page.locator('#bearToast')).toHaveCount(0);
 await page.locator('#nav-bills').click();await page.locator('#accounts-nav-bills').click();await page.locator('[data-edit-bill="water"]').first().click();
 await page.locator('#billEditorForm [name=name]').fill('Water updated');await page.locator('#billEditorForm [type=submit]').click();await expect(page.locator('#billEditorError')).toContainText('Save failed');await expect(page.locator('#bearToast')).toHaveCount(0);
 f.failSave(false);await page.locator('#billEditorForm [type=submit]').click();await expect(page.locator('#billEditor')).toBeHidden();await expect(page.locator('#bearToast')).toHaveText('Bill saved');expect(f.planner.manual[0].name).toBe('Water updated');
});

test('confirmation stays above dialogs without changing focus and repeated saves reuse one toast',async({page})=>{
 await page.setViewportSize({width:1280,height:900});await fixture(page);await page.locator('#nav-bills').click();await page.locator('#accounts-nav-bills').click();await page.locator('[data-edit-bill="water"]').first().click();
 const name=page.locator('#billEditorForm [name=name]');await name.focus();await page.evaluate(()=>window.showBearToast('Saved'));
 const toast=page.locator('#bearToast');await expect(toast).toBeVisible();await expect(name).toBeFocused();expect(await toast.evaluate(el=>el.matches(':popover-open')&&el.parentElement.id==='billEditor')).toBe(true);expect((await toast.boundingBox()).y).toBeLessThan(30);
 await page.evaluate(()=>window.showBearToast('Changes saved'));await expect(toast).toHaveCount(1);await expect(toast).toHaveText('Changes saved');await page.locator('#closeBillEditor').click();await expect(toast).toBeVisible();expect(await toast.evaluate(el=>el.parentElement===document.body&&el.matches(':popover-open'))).toBe(true);
 await expect(toast).toBeHidden({timeout:4500});
});
