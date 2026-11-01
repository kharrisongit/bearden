import {test,expect} from './original-design.fixture.mjs';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

test('reviewed terms survive reload without changing saved or synced balances or checked history',async({page},testInfo)=>{
 await page.clock.setFixedTime(new Date('2026-11-01T12:00:00Z'));
 await page.setViewportSize({width:390,height:844});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const account={id:'lunchflow-example',name:'Example card',source:'lunchflow',type:'credit',currency:'USD',balance:75000,balanceUpdated:'2026-11-01T10:00:00Z'};
 const initial={cards:[{id:17,name:'Example card',debtKind:'credit-card',balance:1000,apr:22,monthlyMinimum:40,min:18.46,dueDate:'2026-11-20',payoffHistory:[{date:'2026-05-01T12:00:00Z',interestPaid:12.34}],lifetimeInterestPaid:12.34,cycleStartPaycheck:0}],cardIdCounter:17,budgetItems:[],budgetSetupVersion:2,startDate:'2026-10-23',takeHome:'500',payoffMethod:'minimum',savingsGoals:[],debtPaymentSettings:{mode:'every-paycheck'},checkedPaychecks:{1:true},debtPaymentHistory:{1:{17:20}},debtInterestHistory:{1:{17:3.14}},debtFeeHistory:{1:{17:0}}};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify(initial),'income-planner':JSON.stringify({debtAccountLinks:{17:account.id}}),onboarding:JSON.stringify({completed:true})}},revision:0};
 await page.route('https://bearden.test/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'synthetic',email:'example@example.test'}});
  if(path==='/api/classic'){
   if(request.method()==='GET')return route.fulfill({json:tracker});
   tracker={state:request.postDataJSON().state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});
  }
  if(path==='/api/state')return route.fulfill({json:{state:{...blank(),accounts:[account]},connections:{items:[],lunchflow:{connected:true},transactions:[],creditCards:[],gmailMessages:[],recurringBills:[]},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);
  try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
 await expect(page.locator('#configureHousehold')).toBeEnabled();
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtBalances[17]?.balance)).toBe(75000);
 const before=await page.evaluate(()=>window.getDebtPlan());
 await page.locator('#nav-debts').click();
 await page.locator('[data-tracker-account="17"] [data-show-debt-details]').click();
 await page.locator('#debtProgressDialog').getByRole('button',{name:'Review terms',exact:true}).click();
 const dialog=page.locator('#debtTermsDialog'),form=page.locator('#debtTermsForm');
 await expect(dialog).toBeVisible();await expect(dialog.locator('[name="balance"]')).toHaveCount(0);
 await form.locator('[name="apr"]').fill('28');await form.locator('[name="monthlyMinimum"]').fill('100.01');
 await form.locator('[name="asOf"]').fill('2026-10-15');await form.locator('[name="statementDueDate"]').fill('2026-11-20');await form.locator('[name="sourceLabel"]').fill('Synthetic statement');
 await form.locator('[name="profileId"]').selectOption('credit-one');await form.locator('[name="minimumProfileId"]').selectOption('credit-one');
 await form.locator('[name="closingDay"]').fill('15');await form.locator('[name="grace"]').selectOption('lost');
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('debt-terms.png')});
 await form.getByRole('button',{name:'Save terms',exact:true}).click();
 await expect(dialog).toBeHidden();
 const saved=JSON.parse(tracker.state.values['app-state']);
 expect(saved.cards[0].apr).toBeCloseTo(28,10);expect(saved.cards[0].monthlyMinimum).toBe(100.01);
 expect(saved.cards[0].interestRules.profileId).toBe('credit-one');expect(saved.cards[0].interestRules.closingDay).toBe(15);
 expect(saved.cards[0].termsSource.statementDueDate).toBe('2026-11-20');expect(saved.cards[0].minimumRules.profileId).toBe('credit-one');
 await page.reload();await page.evaluate(()=>window.classicReady);await expect(page.locator('#configureHousehold')).toBeEnabled();
 await expect.poll(()=>page.evaluate(()=>window.getDebtPlan().syncedDebtBalances[17]?.balance)).toBe(75000);
 const after=await page.evaluate(()=>window.getDebtPlan());
 for(const key of ['balance','id','name','dueDate','payoffHistory','lifetimeInterestPaid','cycleStartPaycheck'])expect(after.state.cards[0][key]).toEqual(before.state.cards[0][key]);
 for(const key of ['checkedPaychecks','debtPaymentHistory','debtInterestHistory','debtFeeHistory'])expect(after.state[key]).toEqual(before.state[key]);
 expect(after.syncedDebtBalances).toEqual(before.syncedDebtBalances);expect(account.balance).toBe(75000);
 expect(after.state.cards[0].interestRules).toEqual(saved.cards[0].interestRules);expect(after.state.cards[0].termsSource).toEqual(saved.cards[0].termsSource);
 const cycle=after.schedule.filter(row=>row.debtTiming[0].dueDate==='2026-11-20');
 expect(cycle.map(row=>row.date)).toEqual(['2026-10-23','2026-11-06','2026-11-20']);
 expect(cycle.map(row=>Math.round(row.payments[0]*100))).toEqual([2000,4000,4001]);
 expect(cycle.reduce((sum,row)=>sum+Math.round(row.payments[0]*100),0)).toBe(10001);
 expect(errors).toEqual([]);
});
