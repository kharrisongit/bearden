import test from 'node:test';
import assert from 'node:assert/strict';
import {householdForecast} from '../public/household-model.mjs';
import {paycheckBillsBalance,paycheckBillItems,scenarioForecast} from '../public/income-model.mjs';

const today='2026-10-29';
const household={enabled:true,personalAccountId:'plaid-own',billsAccountId:'plaid-bills',personalAmount:75500,spouseAmount:75000,spouseStartDate:'2026-10-02',spouseRepeat:'biweekly'};
const plan={state:{startDate:'2026-10-09',takeHome:2000,cards:[]}};
const accounts=[{id:'plaid-own',balance:100000,currency:'USD',type:'depository'},{id:'plaid-bills',balance:125680,currency:'USD',type:'depository'}];
const credit=(overrides={})=>({transaction_id:'spouse-deposit',account_id:'bills',amount:-750,currency:'USD',date:today,name:'ACH payroll deposit',category:'INCOME_WAGES',pending:false,...overrides});
const run=(transactions,options={})=>householdForecast(accounts,plan,[],[],today,{household,scope:'shared',length:30,transactions,...options});
const receipt=(forecast,id='spouse:2026-10-30')=>forecast.rows.find(r=>r.id===id);

test('spouse deposit a day early settles tomorrow, keeps the biweekly anchor and does not add money twice',()=>{
 const before=run([]),after=run([credit()]);
 assert.equal(after.income,before.income-75000);
 assert.equal(after.endBalance,before.endBalance-75000);
 assert.equal(after.opening,125680);
 assert.equal(receipt(after).delta,0);assert.equal(receipt(after).received,true);
 assert.equal(receipt(after).receivedDate,today);
 assert.equal(receipt(after,'spouse:2026-11-13').delta,75000);
 assert.equal(after.rows.find(r=>!r.received&&r.incoming>0).date,'2026-11-06');
});

test('either person can arrive one, two or three days early without a personal debit for a direct deposit',()=>{
 for(const [date,asOf]of [['2026-11-05','2026-11-05'],['2026-11-04','2026-11-04'],['2026-11-03','2026-11-03']]){
  const transactions=[credit({amount:-755,date})];
  const options={household,scope:'shared',length:20,transactions};
  const shared=householdForecast(accounts,plan,[],[],asOf,options);
  assert.equal(receipt(shared,'own-transfer:2026-11-06').receivedDate,date);
  assert.equal(receipt(shared,'own-transfer:2026-11-20').delta,75500);
  const personal=scenarioForecast(accounts,plan,[],asOf,{...options,scope:'personal',personalSpending:true});
  assert.equal(personal.rows.find(r=>r.id==='paycheck-3').delta,200000);
  assert.equal(personal.rows.find(r=>r.id==='own-transfer:2026-11-06').delta,0);
 }
});

test('same-day posted contributions are recognized too',()=>{
 const f=householdForecast(accounts,plan,[],[],'2026-10-30',{household,scope:'shared',length:0,transactions:[credit({date:'2026-10-30'})]});
 assert.equal(f.income,0);assert.equal(f.endBalance,125680);
});

test('own transfer pair can post on different early days and wins over an equal spouse contribution',()=>{
 const h={...household,spouseAmount:75500,spouseStartDate:'2026-11-06'};
 const c=credit({amount:-755,date:'2026-11-04',category:'TRANSFER_IN',name:'Account transfer'});
 const d={...c,transaction_id:'personal-debit',account_id:'own',amount:755,date:'2026-11-05',category:'TRANSFER_OUT'};
 const spouse=credit({transaction_id:'another-deposit',amount:-755,date:'2026-11-05'});
 for(const scope of ['personal','shared','combined']){
  const f=householdForecast(accounts,plan,[],[],'2026-11-05',{household:h,scope,length:1,transactions:[spouse,c,d,c,d]});
  assert.equal(f.income,0);assert.equal(f.outgoing,0);
  assert.equal(receipt(f,'own-transfer:2026-11-06').debitTransactionId,'personal-debit');
  if(scope!=='personal')assert.equal(receipt(f,'spouse:2026-11-06').transactionId,'another-deposit');
 }
});

test('ambiguous same-amount, same-payday deposits cannot mark both people received',()=>{
 const h={...household,spouseAmount:75500,spouseStartDate:'2026-11-06'};
 const c=credit({amount:-755,date:'2026-11-04'});
 const f=householdForecast(accounts,plan,[],[],'2026-11-04',{household:h,scope:'shared',length:2,transactions:[c,c]});
 assert.equal(f.income,151000);assert.equal(f.rows.filter(r=>r.received).length,0);
});

test('pending, refunds, wrong accounts, currencies, amounts, future dates and old deposits stay unmatched',()=>{
 const excluded=[{pending:true},{name:'Payroll reversal'},{name:'Payment refund'},{name:'Cash back reward'},{category:'INCOME_INTEREST_EARNED'},{account_id:'other'},{currency:'CAD'},{amount:750},{amount:-749.99},{amount:-1500},{amount:Infinity},{transaction_id:''},{date:'2026-10-30'},{date:'2026-10-26'},{date:'invalid'},{category:'GENERAL_MERCHANDISE',name:'Store purchase'}];
 for(const change of excluded){const f=run([credit(change)]);assert.equal(f.income,run([]).income,JSON.stringify(change));assert.equal(receipt(f).received,undefined);}
});

test('a bank correction or deletion undoes detection, pending replacement counts once and inputs are untouched',()=>{
 const c=credit(),transactions=[c,c,{...c,transaction_id:'pending',pending:true}],snapshot=structuredClone({transactions,household,plan,accounts});
 const first=run(transactions);assert.equal(first.income,run([]).income-75000);
 assert.deepEqual(run(transactions),first);
 assert.equal(receipt(run([{...c,amount:-740}])).received,undefined);
 assert.equal(receipt(run([])).received,undefined);
 assert.deepEqual({transactions,household,plan,accounts},snapshot);
});

test('Lunch Flow and SimpleFIN uncategorized deposits use the same account and amount rules',()=>{
 for(const source of ['lunchflow','simplefin']){
  const h={...household,personalAccountId:source+'-own',billsAccountId:source+'-bills'};
  const f=run([credit({source,account_id:source+'-bills',name:'DIRECT DEP',category:''})],{household:h});
  assert.equal(receipt(f).received,true);
 }
});

test('a prior or checked own payday reserves its transaction even when only the spouse is visible',()=>{
 const h={...household,personalAmount:75000};
 const p={state:{startDate:'2026-10-28',checkedPaychecks:{1:true}}};
 const c=credit({date:'2026-10-28',category:'TRANSFER_IN'}),d={...c,transaction_id:'debit',account_id:'own',amount:750,category:'TRANSFER_OUT'};
 const f=householdForecast(accounts,p,[],[],today,{household:h,scope:'shared',length:1,transactions:[c,d]});
 assert.equal(f.income,75000);assert.equal(receipt(f).received,undefined);
});

test('a nearby past occurrence remains a candidate at the lookback boundary',()=>{
 const h={...household,personalAmount:75000,spouseStartDate:today};
 const p={state:{startDate:'2026-10-25'}};
 const f=householdForecast(accounts,p,[],[],today,{household:h,scope:'shared',length:1,transactions:[credit({date:'2026-10-26'})]});
 assert.equal(f.income,75000);assert.equal(receipt(f,'spouse:'+today).received,undefined);
});

test('weekly and monthly spouses, including a month boundary, retain their original future dates',()=>{
 for(const [h,date,next]of [[{...household,spouseStartDate:'2026-10-30',spouseRepeat:'weekly'},'2026-10-30','2026-11-06'],[{...household,spouseStartDate:'2026-09-01',spouseRepeat:'monthly'},'2026-11-01','2026-12-01']]){
  const f=run([credit()],{household:h,length:34});
  assert.equal(receipt(f,'spouse:'+date).received,true);
  assert.equal(receipt(f,'spouse:'+next).received,undefined);
 }
});

test('manually confirmed and extra deposits cannot be consumed again as another contribution',()=>{
 const h={...household,spouseRepeat:'weekly',received:{'spouse:2026-10-30':true}};
 const f=run([credit()],{household:h});
 assert.equal(receipt(f).delta,0);assert.equal(receipt(f,'spouse:2026-11-06').delta,75000);
 const extra={...household,additionalDeposits:[{id:'topup',date:today,amount:75000,source:'other',received:true}]};
 assert.equal(receipt(run([credit()],{household:extra})).received,undefined);
});

test('paycheck shared balance and personal/shared/combined forecasts all use the same receipt',()=>{
 const transactions=[credit()],options={household,transactions,length:15,personalSpending:true};
 const forecasts=Object.fromEntries(['personal','shared','combined'].map(scope=>[scope,scenarioForecast(accounts,plan,[],today,{...options,scope})]));
 assert.equal(forecasts.combined.endBalance,forecasts.personal.endBalance+forecasts.shared.endBalance);
 const data={legacy:{bills:[]},planner:{household},linked:{},accounts,plan,today,transactions};
 const check=paycheckBillsBalance(data,'2026-10-23');
 assert.equal(check.projectedBalance,125680);
 assert.equal(check.projectedBalance,paycheckBillsBalance({...data,transactions:[]},'2026-10-23').projectedBalance-75000);
 const items=paycheckBillItems(data,'2026-10-23',2);
 assert.equal(items[0].amount,75500);
 assert.equal(items[0].spouseContributions[0].received,true);
 assert.equal(items[0].spouseContributions[0].receivedDate,today);
});

test('confirmed deposit source resolves equal amounts and overlapping dates on future syncs',()=>{
 const h={...household,personalAmount:75000,contributionLinks:{spouse:{accountId:'plaid-bills',merchant:'ach payroll deposit'}}};
 const p={state:{startDate:'2026-10-30'}};
 const f=householdForecast(accounts,p,[],[],today,{household:h,scope:'shared',length:1,transactions:[credit()]});
 assert.equal(receipt(f).received,true);assert.equal(receipt(f,'own-transfer:2026-10-30').received,undefined);assert.equal(f.income,75000);
});
