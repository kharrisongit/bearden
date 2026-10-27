import test from 'node:test';
import assert from 'node:assert/strict';
import {householdEnabled,sharedBill,spouseEvents,householdForecast} from '../public/household-model.mjs';
import {paycheckBillItems,billEvents,scenarioForecast} from '../public/income-model.mjs';
const h={enabled:true,personalAccountId:'plaid-own',billsAccountId:'plaid-shared',personalAmount:72500,spouseAmount:72500,spouseStartDate:'2026-11-06',spouseRepeat:'biweekly'};
const accounts=[{id:'plaid-own',balance:100000,currency:'USD',type:'depository'},{id:'plaid-shared',balance:20000,currency:'USD',type:'depository'},{id:'plaid-unrelated',balance:99999999,currency:'USD'}];
const bills=[{id:'car',name:'Car',date:'2026-11-10',amount:40000,repeat:'monthly',source:'manual',billKind:'car-payment'},{id:'power',name:'Electric',date:'2026-11-12',amount:20000,repeat:'monthly',source:'manual'},{id:'phone',name:'My phone',date:'2026-11-13',amount:5000,repeat:'monthly',source:'manual'}];
const planner={household:h,billFunding:{car:'shared',power:'shared'},manual:bills,paid:[]};
const plan={state:{startDate:'2026-11-06',takeHome:2000,cards:[]},schedule:[{paycheck:1,date:'2026-11-06',takeHomeThisCheck:2000,bonusAmount:0,budgetLineItemsThisCheck:[{amount:100}],extrasThisCheck:[],payments:[1125]}]};
test('Fixed Bills reserves one contribution, with personal bills separate and shared bills informational',()=>{
 const items=paycheckBillItems({legacy:{bills:[]},planner,linked:{}},'2026-11-06',1);
 assert.deepEqual(items.map(b=>b.name),['Fixed Bills','My phone']);assert.equal(items.reduce((n,b)=>n+b.amount,0),77500);
 assert.deepEqual(items[0].sharedBills.map(b=>b.id),['car','power']);assert.equal(items[0].spouseContributions[0].amount,72500);
 assert.equal(billEvents({},planner,{},'2026-11-06','2026-11-19').filter(b=>b.shared).reduce((n,b)=>n+b.amount,0),60000);
});
test('personal/shared/combined balances conserve money; own transfer is not double-counted',()=>{
 const events=billEvents({},planner,{},'2026-11-06','2026-11-19');
 const run=scope=>scenarioForecast(accounts,plan,events,'2026-11-06',{length:13,household:h,scope});
 const personal=run('personal'),shared=run('shared'),combined=run('combined');
 assert.equal(personal.endBalance,100000);assert.equal(shared.endBalance,105000);assert.equal(combined.endBalance,205000);
 assert.equal(combined.endBalance,personal.endBalance+shared.endBalance);assert.equal(combined.income,272500);assert.equal(combined.outgoing,187500);
 assert.equal(shared.income,145000);assert.equal(shared.outgoing,60000);assert.equal(personal.rows.filter(r=>r.name==='Spouse contribution').length,0);
 assert.equal(combined.rows.find(r=>r.type==='transfer').delta,0);
});
test('different spouse paydays/frequencies are independent of personal checks',()=>{
 assert.deepEqual(spouseEvents({...h,spouseStartDate:'2026-11-13'},'2026-11-01','2026-11-30').map(e=>e.date),['2026-11-13','2026-11-27']);
 assert.equal(spouseEvents({...h,spouseRepeat:'weekly'},'2026-11-01','2026-11-30').length,4);
 assert.deepEqual(spouseEvents({...h,spouseStartDate:'2026-01-31',spouseRepeat:'monthly'},'2027-02-01','2027-02-28').map(e=>e.date),['2027-02-28']);
 assert.equal(spouseEvents({...h,spouseAmount:0},'2026-11-01','2026-11-30').length,0);
});
test('shared funding overrides the old covered flag, while explicit personal choice overrides linked bank inference',()=>{
 assert.equal(sharedBill(bills[0],{...planner,covered:{car:true}}),true);
 assert.equal(billEvents({}, {...planner,covered:{car:true}}, {},'2026-11-06','2026-11-19')[0].covered,false);
 const linked={...planner,billFunding:{},transactionLinks:{'bill:car':{accountId:'shared'}}};assert.equal(sharedBill(bills[0],linked),true);
 assert.equal(sharedBill(bills[0],{...linked,billFunding:{car:'personal'}}),false);
 assert.equal(sharedBill({...bills[0],source:'tracker-debt'},planner),false);
 assert.equal(householdEnabled({...h,personalAccountId:'plaid-shared'}),false);
 assert.equal(sharedBill(bills[0],{...planner,household:{...h,enabled:false}}),false);
});
test('checked paychecks do not add another transfer and received contributions can be undone',()=>{
 const checked={...plan,state:{...plan.state,checkedPaychecks:{1:true}}};
 const f=householdForecast(accounts,checked,[],[],'2026-11-06',{household:h,scope:'shared',length:13});assert.equal(f.income,72500);
 const received={...h,received:{'spouse:2026-11-06':true}};
 assert.equal(householdForecast(accounts,checked,[],[],'2026-11-06',{household:received,scope:'shared',length:13}).income,0);
 assert.equal(householdForecast(accounts,checked,[],[],'2026-11-06',{household:{...received,received:{}},scope:'shared',length:13}).income,72500);
});
test('only a posted pair in the selected accounts confirms your transfer; equal unrelated credits do not confirm spouse income',()=>{
 const credit={transaction_id:'in',account_id:'shared',amount:-725,currency:'USD',date:'2026-11-06',category:'TRANSFER_IN',pending:false},debit={...credit,transaction_id:'out',account_id:'own',amount:725,category:'TRANSFER_OUT'};
 const run=transactions=>householdForecast(accounts,plan,[],[],'2026-11-06',{household:h,scope:'shared',length:13,transactions});
 assert.equal(run([credit]).income,145000);assert.equal(run([credit,debit]).income,72500);assert.equal(run([credit,{...debit,pending:true}]).income,145000);
 assert.equal(run([credit,{...debit,account_id:'unrelated'}]).income,145000);
});
test('a missing selected account produces an unknown balance instead of using unrelated money',()=>{
 assert.equal(householdForecast(accounts.slice(0,1),plan,[],[],'2026-11-06',{household:h,scope:'shared'}).opening,null);
});

test('one-time extra deposits conserve own transfers, retain overdue plans, and stop when received',()=>{
 const household={...h,personalAmount:0,spouseAmount:0,additionalDeposits:[{id:'extra',date:'2026-11-05',amount:3000,source:'personal'}]};
 const run=scope=>householdForecast(accounts,plan,[],[],'2026-11-06',{household,scope});
 assert.equal(run('shared').endBalance,23000);assert.equal(run('personal').endBalance,97000);assert.equal(run('combined').endBalance,120000);
 assert.equal(run('shared').rows.find(r=>r.type==='extra-deposit').overdue,true);
 household.additionalDeposits[0].received=true;assert.equal(run('shared').endBalance,20000);
 household.additionalDeposits[0].received=false;household.additionalDeposits[0].source='other';
 assert.equal(run('personal').endBalance,100000);assert.equal(run('combined').endBalance,123000);
});
test('shared bill choices exclude old budget categories and the Fixed Bills contribution while preserving actual Accounts bills',async()=>{
 const {householdBillChoices}=await import('../public/household-model.mjs');
 const oldBudget=['Fixed bills','Medications','Food','Gas','Personal spending'].map((name,i)=>({id:'budget-'+i,name,source:i%2?'budget':'baby-bear-budget',amount:10000}));
 const accounts=[{id:'spectrum',name:'Spectrum Internet/Phone',source:'manual'},{id:'car',name:'Richard’s Car',source:'bank-tracked',billKind:'car-payment'},{id:'rent',name:'Rent',source:'manual'},{id:'electric',name:'Electric',source:'gmail'}];
 const inputs=[...oldBudget,...accounts,{id:'old-fixed',name:'Fixed Bills'},{id:'household-contribution',name:'Fixed Bills',transfer:true},{id:'card',name:'Visa',source:'plaid-credit'},accounts[0]],snapshot=structuredClone(inputs);
 assert.deepEqual(householdBillChoices(inputs).map(b=>b.id),accounts.map(b=>b.id));assert.deepEqual(inputs,snapshot);
 for(const b of oldBudget)assert.equal(sharedBill(b,{household:h,billFunding:{[b.id]:'shared'}}),false);
});

test('paycheck balance uses only the bills account and carries earlier bills and contributions into future periods',async()=>{
 const {paycheckBillsBalance}=await import('../public/income-model.mjs');
 const data={legacy:{bills:[]},planner,linked:{},accounts,plan,today:'2026-11-06'};
 const first=paycheckBillsBalance(data,'2026-11-06');
 assert.equal(first.currentBalance,20000);assert.equal(first.projectedBalance,105000);assert.equal(first.end,'2026-11-19');
 const next=paycheckBillsBalance(data,'2026-11-20');
 assert.equal(next.currentBalance,20000);assert.equal(next.projectedBalance,250000);assert.equal(next.end,'2026-12-03');
 const updated=paycheckBillsBalance({...data,accounts:accounts.map(a=>a.id===h.billsAccountId?{...a,balance:30000}:a)},'2026-11-06');
 assert.equal(updated.projectedBalance,115000);
});

test('paycheck balance skips paid bills and received transfers, preserves shortfalls, and leaves missing or past balances unknown',async()=>{
 const {paycheckBillsBalance}=await import('../public/income-model.mjs');
 const data={legacy:{bills:[]},planner:{...planner,paid:['power:2026-11-12'],household:{...h,received:{'spouse:2026-11-06':true}}},linked:{},accounts,plan:{...plan,state:{...plan.state,checkedPaychecks:{1:true}}},today:'2026-11-06'};
 const result=paycheckBillsBalance(data,'2026-11-06');
 assert.equal(result.currentBalance,20000);assert.equal(result.projectedBalance,-20000);
 const absent=paycheckBillsBalance({...data,accounts:accounts.filter(a=>a.id!==h.billsAccountId)},'2026-11-06');
 assert.equal(absent.currentBalance,null);assert.equal(absent.projectedBalance,null);
 const unavailable=paycheckBillsBalance({...data,accounts:accounts.map(a=>({...a,balanceUnavailable:true}))},'2026-11-06');
 assert.equal(unavailable.currentBalance,null);assert.equal(unavailable.projectedBalance,null);
 const past=paycheckBillsBalance(data,'2026-10-09');assert.equal(past.historical,true);assert.equal(past.projectedBalance,null);
});
