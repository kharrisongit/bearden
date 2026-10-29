import {test,expect} from './original-design.fixture.mjs';
import {readFileSync} from 'node:fs';
import {blank} from '../public/engine.mjs';

test('the paycheck reset clears the simulation and stays cleared after reload',async({page})=>{
 const state={cards:[{id:1,name:'Card',balance:1000,apr:20,min:20}],cardIdCounter:1,budgetItems:[{id:1,label:'Food',amount:100}],budgetItemIdCounter:1,budgetSetupVersion:2,takeHome:'1500',startDate:'2026-10-26',savingsGoals:[{id:1,name:'Goal',goal:5000,start:50,contribution:25}],savingsGoalIdCounter:1,payoffMethod:'minimum',payoffControlsEnabled:true,paycheckSlices:{1:{1:true},100:{1:true}},paycheckSquashes:{2:{1:true},101:{1:true}},checkedPaychecks:{1:true},debtPaymentHistory:{1:{1:500}},debtInterestHistory:{1:{1:10}},paycheckOverrides:{2:2000},accountPaymentOverrides:{1:{3:75}},savingsContributionOverrides:{1:{2:100}},budgetItemOverrides:{1:{2:50}},appliedBonuses:{3:500},extraExpenses:{3:[{id:7,label:'Repair',amount:25}]},extraExpenseIdCounter:7};
 let tracker={state:{version:1,values:{'app-state':JSON.stringify(state),onboarding:JSON.stringify({completed:true})}},revision:0};
 await page.route('https://bearden.test/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/config')return route.fulfill({json:{authenticated:true,accountId:'member'}});
  if(path==='/api/banks/retire')return route.fulfill({json:{}});
  if(path==='/api/classic'){
   if(req.method()==='POST'){tracker={state:req.postDataJSON().state,revision:tracker.revision+1};return route.fulfill({json:{revision:tracker.revision}});}
   return route.fulfill({json:tracker});
  }
  if(path==='/api/state')return route.fulfill({json:{state:blank(),connections:{},revision:0}});
  if(path.startsWith('/api/'))return route.fulfill({status:404,json:{}});
  const name=path==='/'?'index.html':path.slice(1);
  try{return route.fulfill({body:readFileSync(new URL('../public/'+name,import.meta.url)),contentType:name.endsWith('.css')?'text/css':/\.(js|mjs)$/.test(name)?'text/javascript':'text/html'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('https://bearden.test/');await page.evaluate(()=>window.classicReady);
 const before=await page.evaluate(()=>gatherAppState());
 expect(before.paycheckSlices).toEqual(state.paycheckSlices);expect(before.paycheckSquashes).toEqual(state.paycheckSquashes);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Reset paycheck simulation',exact:true}).click();
 const cleared=['checkedPaychecks','paycheckSlices','paycheckSquashes','paycheckOverrides','accountPaymentOverrides','savingsContributionOverrides','budgetItemOverrides','appliedBonuses','extraExpenses','debtPaymentHistory','debtInterestHistory'];
 await expect.poll(()=>JSON.parse(tracker.state.values['app-state']).paycheckSlices).toEqual({});
 await page.evaluate(()=>window.flushBearDenState());
 await page.reload();await page.evaluate(()=>window.classicReady);
 const after=await page.evaluate(()=>gatherAppState());
 for(const key of cleared)expect(after[key],key).toEqual({});
 for(const key of ['cards','budgetItems','savingsGoals','takeHome','startDate','payoffMethod','payoffControlsEnabled'])expect(after[key],key).toEqual(before[key]);
 await expect(page.getByRole('button',{name:/Undo Slice|Undo Squash/})).toHaveCount(0);
 expect(await page.evaluate(()=>lastSchedule.every(row=>!row.sliceMode))).toBe(true);
});
