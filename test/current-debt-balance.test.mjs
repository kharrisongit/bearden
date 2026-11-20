import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDebtDetails,resolveDebtConnections,migrateDebtBalanceOverride,manualDebtBalance} from '../public/connection-model.mjs';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as payments from '../public/debt-payments.mjs';
import {accountDebtBalances,debtAccountSummary,trackerDebtStatus} from '../public/income-model.mjs';
import {simulateMonthlyPayoff} from '../public/monthly-payoff.mjs';

const now=Date.parse('2026-11-20T17:00:00Z');
const card={id:1,name:'Example debt',balance:1000,apr:0,monthlyMinimum:50,currentBalanceOverride:{balance:65000,date:'2026-11-20',updated:'2026-11-20T16:00:00Z'}};
const bank={id:'lunchflow-card',source:'lunchflow',type:'credit',currency:'USD',balance:80000,balanceUpdated:'2026-11-19T12:00:00Z'};
const planner={debtAccountLinks:{1:bank.id}};

test('a current balance correction takes priority over delayed, refreshed and email balances until explicitly cleared',()=>{
 const before=structuredClone(card);
 for(const balanceUpdated of ['2026-11-19T12:00:00Z','2026-11-20T16:30:00Z']){
  const resolved=resolveDebtDetails({card,primary:{...bank,balanceUpdated},statement:{balance:70000,receivedAt:'2026-11-20T16:45:00Z'},now});
  assert.equal(resolved.balance.value,65000);assert.equal(resolved.balance.source,'Manual balance');assert.equal(resolved.balance.date,'2026-11-20');
 }
 assert.equal(resolveDebtDetails({card:{...card,currentBalanceOverride:undefined},primary:bank,now}).balance.value,80000);
 assert.deepEqual(card,before);
});

test('manual current balances agree across the shared resolver, card totals and monthly plan without applying old checkoffs twice',()=>{
 const resolved=resolveDebtConnections(planner,[bank],[],[card],{},[],now)[1];
 const snapshots=accountDebtBalances(planner,[bank],[],[card],'2026-11-20');
 const plan={state:{cards:[card],checkedPaychecks:{1:true}},syncedDebtBalances:snapshots,schedule:[{paycheck:1,date:'2026-11-06',payments:[100],interestByAccount:[5],feesByAccount:[2]}]};
 const status=trackerDebtStatus(plan,1);
 assert.equal(status.balance,65000);assert.equal(status.paid,10000);assert.equal(resolved.balance.value,status.balance);
 assert.equal(debtAccountSummary([{name:card.name,amount:status.balance,startingBalance:100000}]).totals[0].amount,65000);
 const forecast=simulateMonthlyPayoff({cards:[{...card,balance:status.balance/100}],monthlyBudget:200,startDate:'2026-11-20'});
 assert.equal(forecast.totalBalance,650);assert.equal(forecast.totalPaid,650);
 assert.equal(card.balance,1000);
});

test('zero is a valid manual payoff correction and corrupt snapshots cannot erase a known balance',()=>{
 const zero={...card,currentBalanceOverride:{...card.currentBalanceOverride,balance:0}};
 const snapshots=accountDebtBalances(planner,[bank],[],[zero],'2026-11-20');
 assert.equal(resolveDebtDetails({card:zero,primary:bank,now}).balance.value,0);
 assert.equal(trackerDebtStatus({state:{cards:[zero]},syncedDebtBalances:snapshots},1).paidOff,true);
 for(const currentBalanceOverride of [{...card.currentBalanceOverride,balance:-1},{...card.currentBalanceOverride,balance:NaN},{...card.currentBalanceOverride,date:'2026-02-30'},{balance:0}]){
  assert.equal(resolveDebtDetails({card:{...card,currentBalanceOverride},primary:bank,now}).balance.value,80000);
 }
});


test('released numeric balance overrides migrate once without losing zero, starting balances or history',()=>{
 for(const amount of [65000,0]){
  const legacy={id:1,balance:1000,balanceOverride:amount,apr:0,monthlyMinimum:50,payoffHistory:[{date:'2026-09-01',interestPaid:12}],lifetimeInterestPaid:12};
  const before=structuredClone(legacy),migrated=migrateDebtBalanceOverride(legacy,now);
  assert.equal(migrated.currentBalanceOverride.balance,amount);assert.equal(migrated.balanceOverride,undefined);
  assert.equal(migrated.balance,1000);assert.deepEqual(migrated.payoffHistory,before.payoffHistory);assert.equal(migrated.lifetimeInterestPaid,12);
  assert.equal(migrated.currentBalanceOverride.updated,new Date(now).toISOString());
  assert.equal(migrateDebtBalanceOverride(migrated,now+86400000),migrated);
  assert.equal(resolveDebtDetails({card:legacy,primary:bank,now}).balance.value,amount);
  assert.equal(manualDebtBalance(legacy,now).manual,true);
  assert.deepEqual(legacy,before);
 }
 const canonical=migrateDebtBalanceOverride({...card,balanceOverride:12300},now);
 assert.deepEqual(canonical.currentBalanceOverride,card.currentBalanceOverride);
 assert.equal(canonical.balanceOverride,undefined);
 for(const balanceOverride of [null,undefined,-1,12.5,NaN])assert.equal(manualDebtBalance({balanceOverride},now),null);
});

test('switching to automatic clears both released and structured override formats',async()=>{
 const source=readFileSync(new URL('../public/classic.js',import.meta.url),'utf8');
 const saveAccount=source.slice(source.indexOf('window.saveDebtAccount=async function(data){'),source.indexOf('\nwindow.applyIncomePreset='));
 let stored;
 const original={...card,balanceOverride:70000,payoffHistory:[{date:'2026-09-01',interestPaid:12}]};
 const ctx=vm.createContext({cardsData:[structuredClone(original)],cardIdCounter:1,structuredClone,clearTimeout,saveDebounceTimer:null,saveRetryTimer:null,APP_STATE_KEY:'app-state',document:{getElementById:()=>null},calculate(){},setStorageStatus(){},storage:{async set(key,value){stored=JSON.parse(value);}},window:{classicReady:Promise.resolve(),BearDenDebtPayments:payments,captureDebtHistory(){}}});
 ctx.gatherAppState=()=>({cards:ctx.cardsData});
 vm.runInContext(saveAccount,ctx);
 await ctx.window.saveDebtAccount({id:1,name:'Example debt',balance:1000,apr:0,minimum:50,currentBalanceAction:'automatic'});
 assert.equal(stored.cards[0].currentBalanceOverride,undefined);assert.equal(stored.cards[0].balanceOverride,undefined);
 assert.equal(stored.cards[0].balance,1000);assert.deepEqual(stored.cards[0].payoffHistory,original.payoffHistory);
});
