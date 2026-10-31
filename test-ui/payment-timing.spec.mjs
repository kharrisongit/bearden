import {test,expect} from './original-design.fixture.mjs';import {readFileSync} from 'node:fs';import {blank} from '../public/engine.mjs';import {parseAccountEmail} from '../email-parser.mjs';
async function fixture(page,{messages=[],debtKind='credit-card',accounts=[],incomePlanner={},connectionOverrides={},debtOverrides={},goalContribution=0}={}){
 let tracker={state:{version:1,values:{'app-state':JSON.stringify({cards:[{id:1,name:'Visa',debtKind,balance:10000,apr:0,min:46.15,monthlyMinimum:100,dueDate:'2026-11-30',...debtOverrides}],cardIdCounter:1,budgetItems:[],budgetSetupVersion:2,startDate:'2026-11-06',takeHome:'1000',payoffMethod:'minimum',savingsGoals:[{id:1,name:'Emergency',goal:1000,start:100,contribution:goalContribution}],savingsGoalIdCounter:1}),'income-planner':JSON.stringify(incomePlanner),onboarding:JSON.stringify({completed:true})}},revision:0};
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
test('optional car payments update debt totals and payoff, persist, and reserve each payment only once',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:390,height:844});await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 const car={id:'car',name:'Buick payment',billKind:'car-payment',amount:10000,date:'2026-11-12',repeat:'monthly',source:'manual'};
 const f=await fixture(page,{goalContribution:50,debtOverrides:{balance:100,min:46.15,monthlyMinimum:100},accounts:[{id:'lunchflow-car',name:'Auto loan',type:'loan',source:'lunchflow',balance:25000,currency:'USD'}],incomePlanner:{manual:[car],loanLinks:{car:'lunchflow-car'},carLoanDetails:{car:{apr:0}}}});
 await expect(page.locator('#carPaymentsInDebtToggle')).toBeEnabled();await expect(page.locator('#heroTotal')).toHaveText('$100.00');
 const before=await page.evaluate(()=>window.getDebtPlan().schedule[0]);
 await page.locator('#nav-settings').click();await expect(page.locator('#carPaymentsInDebtToggle')).not.toBeChecked();await page.locator('#carPaymentsInDebtToggle').check();
 await expect(page.locator('#featureSettingsStatus')).toHaveText('Car payment preference saved.');await expect(page.locator('#heroTotal')).toHaveText('$350.00');await expect(page.locator('#heroDate')).toContainText('Jan 12, 2027');
 const after=await page.evaluate(()=>window.getDebtPlan().schedule[0]);expect(after.accountBillsThisCheck).toEqual(before.accountBillsThisCheck);expect(after.accountBillsThisCheck.filter(b=>b.id==='car')).toHaveLength(1);expect(after.accountBillsThisCheck.reduce((sum,b)=>sum+b.amount,0)).toBe(10000);expect(after.cashAfterDebt).toBe(before.cashAfterDebt);expect(after.carDebt.balance).toBe(15000);expect(after.carDebt.reduction).toBe(10000);expect(after.payments).toEqual(before.payments);
 expect(JSON.parse(f.tracker.state.values['income-planner']).showCarPaymentsInDebt).toBe(true);
 await page.locator('#nav-debts').click();await expect(page.locator('[data-car-payment="car"]')).toContainText('$250.00');
 await page.locator('[data-car-payment="car"] [data-edit-bill]').click();await expect(page.locator('[name="carLoanBalance"]')).toHaveValue('250');await expect(page.locator('[name="carLoanBalance"]')).toHaveAttribute('readonly','');await expect(page.locator('[name="carLoanApr"]')).toHaveValue('0');
 await page.screenshot({path:'test-results/car-loan-editor.png'});await page.locator('[name="carLoanApr"]').fill('6');await page.locator('#billEditorForm [type="submit"]').click();await expect(page.locator('#billEditor')).toBeHidden();
 await expect(page.locator('#heroInterest')).not.toHaveText('$0.00');
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('#heroTotal')).toHaveText('$350.00');await expect(page.locator('#carPaymentsInDebtToggle')).toBeChecked();
 await page.locator('#nav-settings').click();await page.locator('#carPaymentsInDebtToggle').uncheck();await expect(page.locator('#heroTotal')).toHaveText('$100.00');await expect(page.locator('#heroInterest')).toHaveText('$0.00');
 expect(JSON.parse(f.tracker.state.values['income-planner']).manual[0].amount).toBe(10000);expect(errors).toEqual([]);
});
test('a manual car loan can supply missing balance and APR from its existing bill editor',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 await fixture(page,{goalContribution:50,debtOverrides:{balance:100,monthlyMinimum:100},incomePlanner:{showCarPaymentsInDebt:true,manual:[{id:'car',name:'Car payment',billKind:'car-payment',amount:10000,date:'2026-11-12',repeat:'monthly',source:'manual'}]}});
 await expect(page.locator('#heroDate')).toHaveText('Car loan details needed');await expect(page.locator('#heroInterest')).toHaveText('Unavailable');
 await page.locator('#nav-debts').click();await page.locator('[data-car-payment="car"]').getByRole('button',{name:'Add loan details'}).click();
 await page.locator('[name="carLoanBalance"]').fill('250');await page.locator('[name="carLoanApr"]').fill('0');await page.locator('#billEditorForm [type="submit"]').click();
 await expect(page.locator('#heroDate')).toContainText('Jan 12, 2027');await expect(page.locator('#heroTotal')).toHaveText('$350.00');await expect(page.locator('#debtForecastNote')).toBeHidden();
});
test('Burn reserves bills and savings, persists its selection, and preserves checked payments across method changes',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:390,height:844});await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 const f=await fixture(page,{goalContribution:50,debtOverrides:{balance:2000,apr:0,min:100,monthlyMinimum:216.67},incomePlanner:{manual:[{id:'water',name:'Water',billKind:'water',amount:20000,date:'2026-11-12',repeat:'monthly',source:'manual'}]}});
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().schedule[0]?.accountBillsThisCheck.reduce((sum,b)=>sum+b.amount,0))).toBe(20000);
 const burn=page.getByRole('button',{name:'Burn',exact:true});await burn.click();
 await expect(burn).toHaveAttribute('aria-pressed','true');await expect(page.locator('#pmBtnMinimum')).toHaveAttribute('aria-pressed','false');
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(425);
 expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].cashAfterDebt)).toBe(325);
 await expect(page.locator('#debtForecastNote')).toBeHidden();await expect(page.locator('#paycheck-card-1 input[aria-label="Payment for Visa"]')).toHaveValue('425.00');
 await page.locator('#debtHeroBox').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/burn-mobile-light.png'});
 await page.setViewportSize({width:320,height:700});await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
 expect(await page.locator('#debtHeroBox').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 const box=await burn.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);
 await page.screenshot({path:'test-results/burn-mobile-dark.png'});
 await page.locator('#chk-1').check();await page.locator('#pmBtnSnowball').click();
 expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(425);
 await burn.click();await expect.poll(()=>JSON.parse(f.tracker.state.values['app-state']).payoffMethod).toBe('burn');
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(burn).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#chk-1')).toBeChecked();expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(425);
 expect(errors).toEqual([]);
});
test('Minimums explains an unfinished forecast and restores valid totals when the method changes',async({page})=>{
 test.setTimeout(90000); // The capped fixture renders the full 780-paycheck schedule.
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:390,height:844});
 await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 await fixture(page,{debtOverrides:{balance:4125.31,apr:18,min:0,monthlyMinimum:0}});
 await expect(page.locator('#heroDate')).toHaveText('No payoff within 30 years');
 await expect(page.locator('#heroInterest')).toHaveText('Unavailable');
 await expect(page.locator('#debtForecastNote')).toContainText('No payments scheduled over the next 26 paychecks for: Visa.');
 await expect(page.locator('#heroDayCounter')).toBeHidden();await expect(page.locator('#heroPaycheckCounter')).toBeHidden();
 expect(await page.locator('#debtHeroBox').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.locator('#pmBtnAvalanche').click();
 await expect(page.locator('#heroInterest')).toHaveText(/^\$[\d,.]+$/);
 await expect(page.locator('#debtForecastNote')).toBeHidden();await expect(page.locator('#heroDayCounter')).toBeVisible();await expect(page.locator('#heroPaycheckCounter')).toBeVisible();
 await page.locator('#pmBtnMinimum').click();await expect(page.locator('#heroInterest')).toHaveText('Unavailable');
 expect(errors).toEqual([]);
});
test('a paid Credit One cycle keeps $0 due while its future estimate can be edited and survives reload',async({page})=>{
 test.setTimeout(90000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:390,height:844});
 await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 const issuer={id:'credit-a',accountId:'a',itemId:'bank',name:'Credit One Visa',currency:'USD',balance:14203,minimum:0,dueDate:null,updated:'2026-10-26T10:00:00Z',aprs:[{type:'purchase_apr',rate:29}]};
 const f=await fixture(page,{goalContribution:50,debtOverrides:{name:'Credit One',balance:142.03,apr:29,min:16.15,monthlyMinimum:35,dueDate:''},connectionOverrides:{creditCards:[issuer]},incomePlanner:{creditCards:{'credit-a':{tracking:true,trackerCardId:'1',fallbackDate:'2026-11-23',fallbackAmount:3500}}}});
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtTerms[1]?.forecastMonthlyMinimum)).toBe(35);
 await expect(page.locator('#heroDate')).not.toContainText('30 years');await expect(page.locator('#debtForecastNote')).toBeHidden();
 await page.locator('#nav-debts').click();
 const edit=page.locator('[data-edit-credit="credit-a"]');await edit.click();
 const amount=page.locator('#creditEditorForm [name="amount"]');await expect(amount).toBeEnabled();await expect(amount).toHaveValue('35');
 await expect(page.locator('#creditCycleNote')).toContainText('current cycle');await expect(page.locator('#creditEditorForm [name="date"]')).toHaveValue('2026-11-23');
 await amount.fill('40');await page.locator('#creditEditorForm [type="submit"]').click();await expect(page.locator('#creditEditor')).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtTerms[1]?.forecastMonthlyMinimum)).toBe(40);
 expect(await page.evaluate(()=>window.getDebtPlan().syncedDebtTerms[1].monthlyMinimum)).toBe(0);
 expect(JSON.parse(f.tracker.state.values['income-planner']).debtFutureMinimums[1]).toBe(4000);
 await expect(edit.locator('xpath=ancestor::article').locator('.minimum-due')).toContainText('$0.00');
 await page.reload();await page.evaluate(()=>window.classicReady);await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtTerms[1]?.forecastMonthlyMinimum)).toBe(40);
 // A later statement replaces the estimate, with no manual adjustment needed.
 issuer.minimum=4500;issuer.dueDate='2026-11-23';await page.reload();await page.evaluate(()=>window.classicReady);
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtTerms[1]?.monthlyMinimum)).toBe(45);expect(errors).toEqual([]);
});
test('an unknown future minimum uses a clear prompt and the debt editor can supply it without changing current due',async({page})=>{
 test.setTimeout(90000);await page.clock.setFixedTime(new Date('2026-10-26T12:00:00Z'));
 await fixture(page,{goalContribution:50,debtOverrides:{name:'Credit One',balance:142.03,apr:29,min:0,monthlyMinimum:0},accounts:[{id:'plaid-a',itemId:'bank',source:'plaid',type:'credit',currency:'USD',balance:14203,balanceUpdated:'2026-10-26T10:00:00Z'}],connectionOverrides:{creditCards:[{id:'credit-a',accountId:'a',itemId:'bank',currency:'USD',name:'Credit One Visa',balance:14203,minimum:0,dueDate:'2026-11-23',updated:'2026-10-26T10:00:00Z'}]},incomePlanner:{debtAccountLinks:{1:'plaid-a'}}});
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtTerms[1]?.currentCycleMinimum),{timeout:30000}).toBe(true);
 await expect(page.locator('#heroDate')).toHaveText('Future minimum needed');await expect(page.locator('#debtForecastNote')).toContainText('Add a future monthly payment estimate');
 await page.locator('#nav-debts').click();await page.locator('[data-edit-debt="1"]').first().click();
 const future=page.locator('#debtEditorForm [name="futureMinimum"]');await expect(future).toBeVisible();await expect(future).toBeEditable();await future.fill('35');
 await page.locator('#debtEditorForm [type="submit"]').click();await expect(page.locator('#debtEditor')).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtTerms[1]?.forecastMonthlyMinimum)).toBe(35);
 expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(0);
 await page.locator('#nav-debt').click();await expect(page.locator('#heroDate')).not.toContainText('needed');await expect(page.locator('#heroDate')).not.toContainText('30 years');
});
test('timing settings persist, debt due dates edit, and an extra payment can be added to an empty check',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const f=await fixture(page);
 await page.locator('#nav-settings').click();await page.locator('#debtPaymentTiming').selectOption('due-date');await expect(page.locator('#featureSettingsStatus')).toHaveText('Debt payment timing saved.');
 await page.locator('#nav-debt').click();await expect(page.locator('#paycheck-card-1')).toContainText('No debt payment scheduled');await page.locator('[data-add-debt-payment="1"]').click();
 await page.locator('#addDebtPaymentForm input[name="amount"]').fill('1100');await page.getByRole('button',{name:'Add to this paycheck',exact:true}).click();await expect(page.locator('#addDebtPaymentError')).toContainText('Not enough money');
 await page.locator('#addDebtPaymentForm input[name="amount"]').fill('75');await page.getByRole('button',{name:'Add to this paycheck',exact:true}).click();await expect(page.locator('#addDebtPaymentDialog')).not.toBeVisible();
 expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(75);
 await page.reload();await page.evaluate(()=>window.classicReady);expect(await page.evaluate(()=>window.getDebtPlan().state.debtPaymentSettings.mode)).toBe('due-date');expect(await page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(75);
 await page.locator('#nav-debts').click();await page.locator('[data-edit-debt="1"]').first().click();await expect(page.locator('#debtEditorForm input[name="dueDate"]')).toHaveValue('2026-11-30');await page.locator('#debtEditorForm input[name="dueDate"]').fill('2026-11-15');await page.getByRole('button',{name:'Save debt',exact:true}).click();await expect(page.locator('#debtEditor')).not.toBeVisible();
 expect(JSON.parse(f.tracker.state.values['app-state']).cards[0].dueDate).toBe('2026-11-15');expect(errors).toEqual([]);
});
test('connection badges sit beside headings, saving footer is absent, and dismissed sync stays dismissed',async({page})=>{
 await page.setViewportSize({width:390,height:844});const f=await fixture(page);await page.locator('#nav-settings').click();
 for(const id of ['classicBankStatus','lunchflowStatus','classicEmailStatus','rentStatus']){
  const badge=page.locator('#'+id);await expect(badge).toHaveText('Connected');expect(await badge.evaluate(el=>{const b=el.getBoundingClientRect(),h=el.previousElementSibling.getBoundingClientRect();return b.left>=h.right&&Math.abs(b.top+b.height/2-h.top-h.height/2)<2;})).toBe(true);
 }
 await expect(page.locator('#storageStatus')).toHaveCount(0);await page.locator('#classicSync').click();await f.started;await expect(page.locator('#bearToast .bear-toast-message')).toContainText('Refreshing');await page.getByRole('button',{name:'Dismiss notification'}).click();await expect(page.locator('#bearToast')).toBeHidden();await expect(page.locator('#connectionMessage')).toBeEmpty();f.releaseSync();await expect(page.locator('#classicSync')).toBeEnabled();await expect(page.locator('#connectionMessage')).toBeEmpty();await expect(page.locator('#dismissConnectionMessage')).toBeHidden();await expect(page.locator('#bearToast')).toBeHidden();
 await page.locator('#classicSync').click();await expect(page.locator('#bearToast .bear-toast-message')).toHaveText('Connections refreshed.');await page.getByRole('button',{name:'Dismiss notification'}).click();await expect(page.locator('#bearToast')).toBeHidden();await expect(page.locator('#connectionMessage')).toBeEmpty();
 await page.locator('#nav-debt').click();await expect(page.getByRole('button',{name:'Withdraw from savings',exact:true}).locator('svg.savings-withdraw-icon')).toHaveCount(1);await page.getByRole('button',{name:'Withdraw from savings',exact:true}).click();await expect(page.locator('#savingsWithdrawPanel-1')).toHaveClass(/open/);
});

for(const debtKind of ['credit-card','loan'])test(debtKind+': linking an email fills and saves its due date, including after search cache rotation',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const message={id:'mail:statement',mailboxId:'mail',sender:'billing@example.com',senderName:'Visa',subject:'Visa statement ready',receivedAt:'2026-10-25T12:00:00Z',dueDate:null,fullText:'Your statement is ready. Payment due date: November 15, 2026. Account ending in 1234.'};
 const f=await fixture(page,{messages:[message],debtKind});
 const open=async()=>{await page.locator('#nav-debts').click();await page.locator('[data-edit-debt="1"]').first().click();};await open();
 await page.locator('#debtEditorForm summary').filter({hasText:'Email & payment matching'}).click();await page.locator('[data-pick-email="debt"]').click();await page.locator('[data-link-email="mail:statement"]').click();await expect(page.locator('#emailLinkPicker')).not.toBeVisible();await expect(page.locator('#debtEditorForm input[name="dueDate"]')).toHaveValue('2026-11-15');await expect(page.locator('#debtEditorError')).toContainText('due date filled in');
 await page.getByRole('button',{name:'Save debt',exact:true}).click();await expect(page.locator('#debtEditor')).not.toBeVisible();expect(JSON.parse(f.tracker.state.values['app-state']).cards[0].dueDate).toBe('2026-11-15');
 f.connections.gmailMessages=[];await page.reload();await page.evaluate(()=>window.classicReady);await open();await expect(page.locator('#debtEditorForm input[name="dueDate"]')).toHaveValue('2026-11-15');await expect(page.locator('#debtEmailLink')).toContainText('Latest email');
 // An already linked account reflects the next statement without relinking.
 await page.locator('#closeDebtEditor').click();f.connections.gmailMessages=[{...message,id:'mail:next',receivedAt:'2026-10-26T00:00:00Z',accountLast4:'1234',dueDate:'2026-11-20'}];await page.reload();await page.evaluate(()=>window.classicReady);await open();await expect(page.locator('#debtEditorForm input[name="dueDate"]')).toHaveValue('2026-11-20');expect(errors).toEqual([]);
});
test('linking a payment receipt keeps the debt due date intact',async({page})=>{
 await fixture(page,{messages:[{id:'mail:receipt',mailboxId:'mail',sender:'billing@example.com',senderName:'Visa',subject:'Visa payment received',receivedAt:'2026-10-25T12:00:00Z',dueDate:null,fullText:'Payment received on November 1, 2026. Due date: November 20, 2026. Payment amount: $50.00.'}]});
 await page.locator('#nav-debts').click();await page.locator('[data-edit-debt="1"]').first().click();await page.locator('#debtEditorForm summary').filter({hasText:'Email & payment matching'}).click();await page.locator('[data-pick-email="debt"]').click();await page.locator('[data-link-email="mail:receipt"]').click();await expect(page.locator('#emailLinkPicker')).not.toBeVisible();await expect(page.locator('#debtEditorForm input[name="dueDate"]')).toHaveValue('2026-11-30');await expect(page.locator('#debtEditorError')).toContainText('payment notice');
});

test('same-debt backup supplies current balance and email terms update future paychecks with a manual override',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const receivedAt=new Date(Date.now()-3600000).toISOString();
 const statement={id:'mail:s',mailboxId:'mail',sender:'bank@example.com',receivedAt,balance:88000,minimum:12500,apr:26,dueDate:'2026-11-15'};
 const accounts=[{id:'plaid-a',itemId:'bank',name:'Visa primary',source:'plaid',type:'credit',currency:'USD',balance:0,balanceUnavailable:true,balanceUpdated:receivedAt},{id:'lunchflow-b',itemId:'lunchflow',name:'Visa backup',source:'lunchflow',type:'credit',currency:'USD',balance:85000,balanceUpdated:receivedAt,include:false}];
 const f=await fixture(page,{accounts,messages:[statement],incomePlanner:{debtAccountLinks:{1:'plaid-a'},emailLinks:{'debt:1':{mailboxId:'mail',sender:'bank@example.com',selectedMessage:statement}}}});
 await page.locator('#nav-debts').click();await page.locator('[data-edit-debt="1"]').first().click();
 await page.locator('[name="backupDebtAccount"]').selectOption('lunchflow-b');await expect(page.locator('#debtSources')).toContainText('Lunch Flow backup');
 await expect(page.locator('#debtEditorForm [name="minimum"]')).toHaveValue('125.00');await expect(page.locator('#debtEditorForm [name="apr"]')).toHaveValue('26');await expect(page.locator('#debtEditorForm [name="balance"]')).toHaveValue('10000');
 await page.getByRole('button',{name:'Save debt',exact:true}).click();await expect(page.locator('#debtEditor')).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtBalances[1]?.balance)).toBe(85000);
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(57.69);
 expect(JSON.parse(f.tracker.state.values['income-planner']).debtBackupLinks[1]).toBe('lunchflow-b');
 await page.reload();await page.evaluate(()=>window.classicReady);await page.locator('#nav-debts').click();await page.locator('[data-edit-debt="1"]').first().click();await expect(page.locator('[name="backupDebtAccount"]')).toHaveValue('lunchflow-b');
 await page.locator('[name="autoDebtDetails"]').uncheck();await page.locator('#debtEditorForm [name="minimum"]').fill('90');await page.getByRole('button',{name:'Save debt',exact:true}).click();await expect(page.locator('#debtEditor')).not.toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().schedule[0].payments[0])).toBe(41.54);expect(errors).toEqual([]);
});
test('Sync connections checks every connected inbox in separate requests',async({page})=>{
 const f=await fixture(page,{connectionOverrides:{mailAccounts:[{id:'first',email:'first@hotmail.com',provider:'microsoft'},{id:'second',email:'second@gmail.com',provider:'google'}]}});
 await page.locator('#nav-settings').click();await page.locator('#classicSync').click();await f.started;f.releaseSync();await expect(page.locator('#classicSync')).toBeEnabled();expect(f.emailCalls.map(c=>c.mailboxId)).toEqual(['first','second']);
});

