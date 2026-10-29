import {test,expect} from './original-design.fixture.mjs';import {readFileSync} from 'node:fs';import {blank} from '../public/engine.mjs';import {parseAccountEmail} from '../email-parser.mjs';
async function fixture(page,{messages=[],debtKind='credit-card',accounts=[],incomePlanner={},connectionOverrides={},debtOverrides={},goalContribution=0,stateOverrides={}}={}){
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[{id:1,name:'Visa',debtKind,balance:10000,apr:0,min:46.15,monthlyMinimum:100,dueDate:'2026-11-30',...debtOverrides}],cardIdCounter:1,budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1000',payoffMethod:'minimum',savingsGoals:[{id:1,name:'Emergency',goal:1000,start:100,contribution:goalContribution}],savingsGoalIdCounter:1,...stateOverrides}),'income-planner':JSON.stringify(incomePlanner),onboarding:JSON.stringify({completed:true})}},revision:0};
 let releaseSync,startedSync;const started=new Promise(r=>startedSync=r),gate=new Promise(r=>releaseSync=r);let bankRefreshes=0;
 const emailCalls=[];const connections={items:[{id:'bank',name:'Bank'}],lunchflow:{connected:true,status:'Connected'},emailConnected:true,mailAccounts:[{id:'mail',email:'person@hotmail.com',provider:'microsoft'}],sun:{enabled:true,connected:true,status:'Connected'},transactions:[],candidates:[],creditCards:[],gmailMessages:messages,recurringBills:[],...connectionOverrides};
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,email:'person@hotmail.com',accountId:'test',microsoftConfigured:true}});
  if(path==='/api/classic'){if(req.method()==='GET')return route.fulfill({json:tracker});const b=req.postDataJSON();tracker={state:b.state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});}
  if(path==='/api/gmail/message'){const requested=req.postDataJSON(),message=connections.gmailMessages.find(m=>m.id===requested.id&&m.mailboxId===requested.mailboxId);return route.fulfill({json:{message:parseAccountEmail({id:message.id,mailboxId:message.mailboxId,from:message.sender,subject:message.subject,text:message.fullText,receivedAt:message.receivedAt})}});}
  if(path==='/api/gmail/search'){emailCalls.push(req.postDataJSON());return route.fulfill({json:connections});}
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts},connections,revision:0}});
  if(path==='/api/bank/refresh'){if(++bankRefreshes===1){startedSync();await gate;}return route.fulfill({json:{status:'Bank refreshed.'}});}
  if(['/api/lunchflow/refresh','/api/sync','/api/rent/refresh'].includes(path))return route.fulfill({json:{status:'Updated.'}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
 return {started,releaseSync,connections,emailCalls,get tracker(){return tracker;}};
}

test('paycheck creditor opens the right quick view, preserves the tab, and offers a grouped editor',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:390,height:844});await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
 await fixture(page,{debtOverrides:{balance:500,apr:12,monthlyMinimum:100,dueDate:'2026-11-07'},stateOverrides:{debtPaymentSettings:{mode:'due-date',leadDays:3}}});
 const trigger=page.locator('#paycheck-card-1 [data-paycheck-creditor="1"]');await trigger.click();
 const dialog=page.locator('#debtProgressDialog');await expect(dialog).toBeVisible();await expect(page.locator('#debtProgressTitle')).toHaveText('Visa');
 await expect(dialog.getByRole('heading',{name:'Paycheck · Nov 6, 2026'})).toBeVisible();await expect(dialog.getByRole('heading',{name:'Account overview'})).toBeVisible();
 await expect(dialog).toContainText('Est. payoff date');await expect(dialog).toContainText('Est. interest paid');await expect(dialog).toContainText('12.00%');
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('creditor-quick-view.png')});
 await page.locator('#closeDebtProgress').click();await expect(page.locator('#nav-debt')).toHaveAttribute('aria-selected','true');await expect(trigger).toBeFocused();
 await page.locator('#nav-debts').click();
 const card=page.locator('[data-tracker-account="1"]');await expect(card.locator('.debt-card-estimates')).toContainText('2027');await page.screenshot({path:testInfo.outputPath('debt-card.png')});
 await card.locator('[data-show-debt-details]').click();await expect(dialog.getByRole('heading',{name:/Paycheck/})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Edit account',exact:true}).click();await expect(dialog).toBeHidden();
 await expect(page.locator('#debtEditor')).toBeVisible();await expect(page.locator('#debtEditor').getByRole('heading',{name:'Balance & payment terms'})).toBeVisible();
 await expect(page.locator('#debtEditor').getByRole('heading',{name:'Bank connections'})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('debt-editor.png')});await page.locator('#debtEditorForm [name="minimum"]').fill('120');await page.locator('#debtEditorForm [type="submit"]').click();await expect(page.locator('#debtEditor')).toBeHidden();expect(errors).toEqual([]);
});

test('linked issuer creditors use the same quick view and edit the connected account',async({page})=>{
 await page.setViewportSize({width:320,height:740});await page.addInitScript(()=>localStorage.setItem('bearden:classic:theme','dark'));
 await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
 await fixture(page,{debtOverrides:{balance:500,apr:12},connectionOverrides:{creditCards:[{id:'credit-a',accountId:'a',itemId:'bank',name:'Visa connected',institution:'Bank',currency:'USD',balance:50000,minimum:10000,dueDate:'2026-11-30',updated:'2026-11-06T10:00:00Z',aprs:[{type:'purchase_apr',rate:12}]}]},incomePlanner:{creditCards:{'credit-a':{tracking:true,trackerCardId:'1'}}}});
 await page.locator('#paycheck-card-1 [data-paycheck-creditor="1"]').click();await expect(page.locator('#debtProgressTitle')).toHaveText('Visa connected');expect(await page.locator('#debtProgressDialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(page.locator('#debtProgressDialog')).toContainText('12.00%');await page.locator('#debtProgressDialog').getByRole('button',{name:'Edit account',exact:true}).click();await expect(page.locator('#debtProgressDialog')).toBeHidden();await expect(page.locator('#creditEditor')).toBeVisible();
});

test('buffer payments stay quiet, overdue payments warn, and checked payments clear the warning',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));
 await fixture(page,{debtOverrides:{balance:500,dueDate:'2026-11-07'},stateOverrides:{debtPaymentSettings:{mode:'due-date',leadDays:3}}});
 const card=page.locator('#paycheck-card-1');await expect(card).not.toContainText('buffer');await expect(card).not.toContainText('payment is late');
 await page.clock.setFixedTime(new Date('2026-11-08T12:00:00Z'));await page.evaluate(()=>window.calculate());await expect(card).toContainText('Visa: payment is late');
 await page.locator('#chk-1').check();await expect(card).not.toContainText('payment is late');
});
