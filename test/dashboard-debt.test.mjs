import test from 'node:test';
import assert from 'node:assert/strict';
import {accountDebtBalances,debtAccountSummary,trackerDebtStatus} from '../public/income-model.mjs';

test('current issuer, SimpleFIN and statement balances reach the tracker without altering payment history',()=>{
 const cards=[{id:1,balance:1000},{id:2,balance:800},{id:3,balance:500}],planner={debtAccountLinks:{2:'simplefin-b'},creditCards:{a:{trackerCardId:'1'}}};
 const accounts=[{id:'simplefin-b',type:'credit',currency:'USD',balance:60000}],issuer=[{id:'a',accountId:'a',currency:'USD',balance:70000}];
 const synced=accountDebtBalances(planner,accounts,issuer,cards,'2026-10-26',{3:{balance:40000}});
 const plan={state:{cards,checkedPaychecks:{1:true}},syncedDebtBalances:synced,schedule:[{paycheck:1,payments:[100,100,100],interestByAccount:[0,0,0]}]};
 assert.deepEqual(cards.map(c=>trackerDebtStatus(plan,c.id).balance),[70000,60000,40000]);
 assert.equal(trackerDebtStatus(plan,1).paid,10000);
 assert.deepEqual(cards.map(c=>c.balance),[1000,800,500]);
 issuer[0].balance=90000;
 assert.equal(accountDebtBalances(planner,accounts,issuer,cards,'2026-10-26')[1].balance,90000);
 issuer[0].balance=0;
 assert.equal(accountDebtBalances(planner,accounts,issuer,cards,'2026-10-26')[1].balance,0);
 planner.hiddenConnectedAccounts={'plaid-a':true};
 assert.equal(accountDebtBalances(planner,accounts,issuer,cards,'2026-10-26')[1],undefined);
});

test('Dashboard summary uses the same card balances, separates currencies and excludes unknown balances',()=>{
 const summary=debtAccountSummary([{name:'Connected',amount:70000,startingBalance:100000},{name:'Manual',amount:50000,startingBalance:80000},{name:'Unknown',amount:null},{name:'Paid off',amount:0},{name:'Euro',amount:12000,currency:'EUR'}]);
 assert.deepEqual(summary.totals,[{currency:'USD',amount:120000},{currency:'EUR',amount:12000}]);
 assert.equal(summary.missing,1);
 assert.equal(summary.accounts.length,4);
 assert.equal(summary.starting,192000);
 assert.deepEqual(debtAccountSummary([]).totals,[]);
});
