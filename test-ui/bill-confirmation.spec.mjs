import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';
import {blank} from '../public/engine.mjs';
import {emailLink} from '../public/email-model.mjs';
import {paymentLink} from '../public/transaction-links.mjs';

for(const linked of [false,true])test(`posted rent and insurance leave awaiting confirmation with ${linked?'manual':'inferred'} transaction links and numeric portal timestamps`,async({page})=>{
 const f=await fixture(page);
 await page.goto('about:blank');
 let tracker=structuredClone(f.tracker);
 await page.route('https://bearden.test/api/classic',route=>{
  if(route.request().method()==='POST'){tracker={state:route.request().postDataJSON().state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});}
  return route.fulfill({json:tracker});
 });
 await page.clock.setFixedTime(new Date('2026-11-03T18:00:00Z'));
 const planner=JSON.parse(tracker.state.values['income-planner']);
 planner.paid=[];planner.manual=[planner.manual.find(b=>b.id==='rent'),{id:'insurance',name:'Renters insurance',billKind:'insurance',date:'2026-10-01',repeat:'monthly',source:'manual',amount:1800}];
 planner.sunRent={billId:'rent',amountField:'currentBalance',baseAmount:80000,readings:[]};
 const messages=planner.manual.map(b=>({id:b.id,mailboxId:'mail',sender:b.id+'@example.com',subject:b.name+' payment receipt',paymentStatus:'pending',paymentStage:'submitted',paymentAmount:b.amount,receivedAt:'2026-10-31T14:00:00Z'}));
 planner.emailLinks=Object.fromEntries(messages.map(m=>['bill:'+m.id,emailLink(m)]));
 tracker.state.values['income-planner']=JSON.stringify(planner);
 let posted=false;
 const accounts=f.accounts.map(a=>({...a,balanceUpdated:'2026-11-03T17:00:00Z'}));
 const transactions=planner.manual.map(b=>({transaction_id:b.id,account_id:'lunchflow-bills',source:'lunchflow',itemId:'lunchflow',name:b.id==='rent'?'SUN COMMUNITIES':'ASSURANT INSURANCE',amount:b.amount/100,date:'2026-11-02',currency:'USD',pending:false}));
 if(linked){planner.transactionLinks=Object.fromEntries(transactions.map(t=>['bill:'+t.transaction_id,paymentLink(t)]));tracker.state.values['income-planner']=JSON.stringify(planner);}
 await page.route('https://bearden.test/api/state',route=>route.fulfill({json:{state:{...blank(),accounts},connections:{items:[],transactions:posted?transactions:[],gmailMessages:messages,creditCards:[],recurringBills:[],sun:{connected:true,enabled:true,snapshot:{currency:'USD',currentBalance:posted?0:80000,checkedAt:Date.parse('2026-11-03T17:30:00Z')}}},revision:1}}));
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);await menuGo(page,'bills');
 await expect(page.locator('#billAgenda > [data-account-id=rent]')).toContainText('Awaiting confirmation');
 await expect(page.locator('#billAgenda > [data-account-id=insurance]')).toContainText('Awaiting confirmation');
 posted=true;await page.evaluate(()=>window.BearDen.refreshPaymentEvidence());
 await expect(page.locator('#billAgenda > [data-account-id=rent]')).toHaveCount(0);
 await expect(page.locator('#billAgenda > [data-account-id=insurance]')).toHaveCount(0);
 await expect(page.locator('#paidBillsList [data-account-id=rent]')).toContainText('Confirmed');
 await expect(page.locator('#paidBillsList [data-account-id=insurance]')).toContainText('Confirmed');
 await expect(page.locator('#billTrackerUpcoming')).not.toContainText('Awaiting confirmation');
 await page.reload();await page.evaluate(()=>window.classicReady);await menuGo(page,'bills');
 await expect(page.locator('#paidBillsList [data-account-id=rent]')).toContainText('Confirmed');
 await expect(page.locator('#billTrackerUpcoming')).not.toContainText('Awaiting confirmation');
});
