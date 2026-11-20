import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {matchPaychecks,paycheckOccurrence,nextPaycheckNumber} from '../public/paycheck-matching.mjs';
import {paydayEvents,scenarioForecast,nextPayday} from '../public/income-model.mjs';
import {applyTransactions} from '../providers.mjs';

const state={startDate:'2026-11-06',takeHome:1800};
const deposit={transaction_id:'pay',account_id:'checking',date:'2026-11-04',name:'Employer payroll',amount:-1923.47,currency:'USD',pending:false};
const match=(transactions,extra={})=>matchPaychecks({state,transactions,accountId:'plaid-checking',today:'2026-11-04',...extra});
test('posted early payroll uses exact net and keeps the biweekly anchor',()=>{
 const result=match([deposit,deposit]);
 assert.equal(result[1].amount,192347);assert.equal(result[1].receivedDate,'2026-11-04');assert.equal(result[1].scheduledDate,'2026-11-06');
 assert.deepEqual(paycheckOccurrence(state.startDate,'2026-11-18'),{paycheck:2,scheduledDate:'2026-11-20'});
 assert.deepEqual(match([]),{});
});
test('ignores pending, wrong accounts, ambiguous, non-payroll, refunds, future and completed payments',()=>{
 for(const change of [{pending:true},{account_id:'bills'},{currency:'CAD'},{name:'Transfer from savings'},{name:'Payroll reversal'},{date:'2026-11-05'},{amount:1923.47},{date:'2026-10-31'}])assert.deepEqual(match([{...deposit,...change}]),{});
 assert.deepEqual(match([deposit,{...deposit,transaction_id:'other'}]),{});
 assert.deepEqual(match([deposit],{state:{...state,checkedPaychecks:{1:true}}}),{});
});
test('confirmed employer tolerates variable pay and explicit deposit resolves ambiguity',()=>{
 const t={...deposit,name:'Employer ACH',amount:-2150.09},link={accountId:'plaid-checking',merchant:'employer ach',assignments:{'2026-11-06':'pay'}};
 assert.equal(match([t,{...t,transaction_id:'other'}],{link})[1].amount,215009);
 assert.equal(match([{...t,date:'2026-11-18',transaction_id:'next',amount:-1874.31}],{link,today:'2026-11-18'})[2].amount,187431);
 assert.deepEqual(match([deposit],{link}),{});
 assert.deepEqual(match([{...t,account_id:'bills'}],{link}),{});
});
test('received pay is not added to synced balances again, while planned outflows remain',()=>{
 const receipt=match([deposit])[1];
 const plan={state,schedule:[{paycheck:1,date:'2026-11-06',takeHomeThisCheck:1923.47,bonusAmount:0,paycheckReceipt:receipt,budgetLineItemsThisCheck:[{label:'Fixed Bills',amount:750}],payments:[],savingsByGoal:[]}]};
 const upcoming=paydayEvents(plan,'2026-11-04','2026-11-30',{excludeReceived:true});assert.equal(upcoming[0].date,'2026-11-20');assert.equal(upcoming[0].amount,180000);
 const forecast=scenarioForecast([{id:'plaid-checking',include:true,balance:200000,currency:'USD'}],plan,[],'2026-11-04',{length:7});
 assert.equal(forecast.income,0);assert.equal(forecast.outgoing,75000);assert.equal(forecast.endBalance,125000);assert.equal(forecast.rows[0].receivedDate,'2026-11-04');
});

test('next payday follows the calendar without requiring historical checkoffs',()=>{
 const old={startDate:'2026-09-25',takeHome:1800,checkedPaychecks:{}};
 const before=structuredClone(old);
 assert.equal(nextPaycheckNumber(old,'2026-11-06'),4);
 assert.equal(nextPayday({state:old,schedule:[]},'2026-11-06').date,'2026-11-06');
 assert.equal(nextPayday({state:old,schedule:[]},'2026-11-07').date,'2026-11-20');
 assert.equal(nextPayday({state:old,schedule:[]},'2026-11-20').date,'2026-11-20');
 assert.equal(nextPaycheckNumber({...old,checkedPaychecks:{4:true}},'2026-11-06'),5);
 assert.equal(nextPaycheckNumber(old,'2026-09-23'),1);
 assert.equal(nextPaycheckNumber({startDate:'invalid'},'2026-11-06'),null);
 assert.deepEqual(old,before);
});

test('early receipt advances next payday through its original due day without changing plans',()=>{
 const old={...state,startDate:'2026-10-09',checkedPaychecks:{}};
 const receipt=match([deposit],{state:old})[3];
 const plan={state:old,schedule:[{paycheck:3,date:'2026-11-06',paycheckReceipt:receipt,takeHomeThisCheck:1923.47,bonusAmount:0}]};
 const before=structuredClone(plan);
 for(const today of ['2026-11-04','2026-11-06','2026-11-07']){
  assert.equal(nextPayday(plan,today).id,'paycheck-4');
  assert.equal(nextPayday(plan,today).date,'2026-11-20');
 }
 assert.equal(nextPaycheckNumber(old,'2026-11-04',{3:receipt}),4);
 assert.deepEqual(plan,before);
 const calendar=paydayEvents(plan,'2026-11-04','2026-11-20');
 assert.equal(calendar[0].received,true);assert.equal(calendar[0].date,'2026-11-06');
});

test('original Plaid description retains explicit payroll evidence when merchant name is cleaned',()=>{
 const [t]=applyTransactions([],[{added:[{...deposit,name:'EXAMPLE COMPANY PAYROLL',merchant_name:'Example Company',iso_currency_code:'USD'}],modified:[],removed:[]}],'bank');
 assert.equal(t.name,'Example Company');assert.equal(t.originalName,'EXAMPLE COMPANY PAYROLL');
 assert.equal(match([t])[1].amount,192347);
 assert.deepEqual(match([{...t,originalName:'EXAMPLE COMPANY PAYROLL REVERSAL'}]),{});
 const [d]=applyTransactions([],[{added:[{...deposit,name:'Example Company',original_description:'EXAMPLE COMPANY PAYROLL',iso_currency_code:'USD'}],modified:[],removed:[]}],'bank');
 assert.equal(d.originalDescription,'EXAMPLE COMPANY PAYROLL');assert.equal(match([d])[1].amount,192347);
});

test('same specific employer remains recognized when a later deposit omits payroll metadata',()=>{
 const earlier={...deposit,name:'Example Company',category:'INCOME_WAGES'};
 const current={...earlier,transaction_id:'new-pay',date:'2026-11-18',amount:-2054.32,category:''};
 const result=match([earlier,current],{today:'2026-11-20'});
 assert.equal(result[2].amount,205432);assert.equal(result[2].receivedDate,'2026-11-18');
 assert.deepEqual(match([current,{...earlier,account_id:'spouse'}],{today:'2026-11-20'}),{});
 assert.equal(match([earlier,current,{...current,transaction_id:'other'}],{today:'2026-11-20'})[2],undefined);
 assert.equal(match([earlier,{...current,name:'Another employer'}],{today:'2026-11-20'})[2],undefined);
 assert.equal(match([earlier,{...current,category:'INCOME_INTEREST_EARNED'}],{today:'2026-11-20'})[2],undefined);
 for(const name of ['Deposit','ACH CREDIT','Direct Deposit','Online Transfer','123456','ACH CREDIT 123456','TRANSFER FROM SAVINGS 9876']){
  const learned={...earlier,name};
  assert.equal(match([learned,{...current,name}],{today:'2026-11-20'})[2],undefined,name);
 }
});

test('a link for another account cannot block confident payroll or resolve deposit ambiguity',()=>{
 const link={accountId:'plaid-spouse',merchant:'another employer',assignments:{'2026-11-06':'pay'}};
 assert.equal(match([deposit],{link})[1].amount,192347);
 assert.deepEqual(match([deposit,{...deposit,transaction_id:'other'}],{link}),{});
});

test('bank description aliases preserve payroll evidence, confirmed sources, and reversal exclusions',()=>{
 for(const key of ['originalName','original_description','originalDescription','description','merchant_name']){
  const t={...deposit,name:'Example Company',[key]:'Example Company PAY CHECK'};
  assert.equal(match([t])[1].amount,192347,key);
  assert.deepEqual(match([{...t,[key]:'Example Company PAYROLL REVERSAL'}]),{},key);
  const link={accountId:'plaid-checking',merchant:'example company ach'};
  assert.equal(match([{...t,[key]:'Example Company ACH'}],{link})[1].amount,192347,key);
 }
});

test('an ACH or direct deposit near the expected amount still needs payroll or confirmed employer evidence',()=>{
 for(const name of ['ACH CREDIT','ACH DEPOSIT','DIRECT DEP','DIRECT DEPOSIT','Electronic Deposit','Deposit Pay','Transfer from savings']){
  for(const amount of [-1800,-1700,-1900])assert.deepEqual(match([{...deposit,name,amount}]),{},name);
 }
 assert.deepEqual(match([{...deposit,currency:undefined}]),{});
});

test('milestone paycheck counters advance with the calendar and receipts even when earlier plans are unchecked',()=>{
 const source=readFileSync(new URL('../public/classic.js',import.meta.url),'utf8');
 const counter=source.slice(source.indexOf('function paychecksCounterText('),source.indexOf('\nfunction toggleAddBox('));
 const old={startDate:'2026-09-25',checkedPaychecks:{}},receipts={};
 const context=vm.createContext({upcomingBudgetPaycheck:()=>nextPaycheckNumber(old,'2026-11-06',receipts)});
 vm.runInContext(counter,context);
 assert.equal(context.paychecksCounterText(5),'2 paychecks to go');
 assert.equal(context.paychecksCounterText(4),'1 paycheck to go');
 receipts[4]={receivedDate:'2026-11-04'};
 assert.equal(context.paychecksCounterText(5),'1 paycheck to go');
 assert.equal(context.paychecksCounterText(4),'This paycheck 💰');
 assert.equal(context.paychecksCounterText(null),'');
 assert.deepEqual(old.checkedPaychecks,{});
});
