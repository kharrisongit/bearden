import {test,expect} from '@playwright/test';
import {fixture,menuGo} from './wallet.fixture.mjs';

async function loanFixture(page,details,{connected=true}={}){
 const f=await fixture(page),planner=JSON.parse(f.tracker.state.values['income-planner']);
 if(details!==undefined)planner.carLoanDetails={car:details};
 if(connected){
  f.accounts.push({id:'lunchflow-auto',name:'Example auto loan',type:'loan',source:'lunchflow',balance:825000,currency:'USD',apr:11});
  planner.loanLinks={car:'lunchflow-auto'};
  planner.accountVisibility['lunchflow-auto']=true;
 }
 f.tracker.state.values['income-planner']=JSON.stringify(planner);
 await page.reload();await page.evaluate(()=>window.classicReady);
 await expect(page.locator('#configureHousehold')).toBeEnabled();
 await menuGo(page,'bills');
 return f;
}

for(const [label,balances] of [
 ['saved starting balance',{balance:900000,startingBalance:1200000}],
 ['absent starting balance',{balance:900000}],
 ['null starting balance',{balance:900000,startingBalance:null}],
 ['absent saved balances',{}],
])test(`car APR-only save preserves ${label} despite a different connected balance`,async({page})=>{
 const original={...balances,apr:11,interestRules:{profileId:'daily-simple',dayBasis:365},termsSource:{label:'Loan agreement'}};
 const f=await loanFixture(page,original),before=structuredClone(f.accounts);
 await page.locator('[data-edit-bill=car]').click();
 const form=page.locator('#billEditorForm'),balance=form.locator('[name=carLoanBalance]');
 await expect(balance).toHaveValue('8250');await expect(balance).toHaveAttribute('readonly','');
 await form.locator('[name=carLoanApr]').fill('9.75');
 await form.locator('[type=submit]').click();await expect(page.locator('#billEditor')).toBeHidden();
 expect(JSON.parse(f.tracker.state.values['income-planner']).carLoanDetails.car).toEqual({...original,apr:9.75});
 expect(f.accounts).toEqual(before);
 await page.reload();await page.evaluate(()=>window.classicReady);
 await expect(page.locator('#configureHousehold')).toBeEnabled();
 expect(JSON.parse(f.tracker.state.values['income-planner']).carLoanDetails.car).toEqual({...original,apr:9.75});
});

test('a manual car balance can be initialized and deliberately updated without replacing its starting balance',async({page})=>{
 const f=await loanFixture(page,undefined,{connected:false});
 await page.locator('[data-edit-bill=car]').click();
 const form=page.locator('#billEditorForm');
 await form.locator('[name=carLoanBalance]').fill('9000');await form.locator('[name=carLoanApr]').fill('9.75');
 await form.locator('[type=submit]').click();await expect(page.locator('#billEditor')).toBeHidden();
 expect(JSON.parse(f.tracker.state.values['income-planner']).carLoanDetails.car).toEqual({balance:900000,startingBalance:900000,apr:9.75});
 await page.locator('[data-edit-bill=car]').click();
 await form.locator('[name=carLoanBalance]').fill('8750');
 await form.locator('[type=submit]').click();await expect(page.locator('#billEditor')).toBeHidden();
 expect(JSON.parse(f.tracker.state.values['income-planner']).carLoanDetails.car).toEqual({balance:875000,startingBalance:900000,apr:9.75});
});

test('setting up a car loan on another bill initializes its linked balance',async({page})=>{
 const f=await loanFixture(page,undefined);
 await page.locator('[data-edit-bill=electric]').click();
 const form=page.locator('#billEditorForm');
 await form.locator('[name=billKind]').selectOption('car-payment');
 await form.locator('[name=loanAccount]').selectOption('lunchflow-auto');
 await expect(form.locator('[name=carLoanBalance]')).toHaveValue('8250');
 await form.locator('[type=submit]').click();await expect(page.locator('#billEditor')).toBeHidden();
 expect(JSON.parse(f.tracker.state.values['income-planner']).carLoanDetails.electric).toEqual({balance:825000,startingBalance:825000,apr:11});
});
