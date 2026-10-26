import test from 'node:test';
import assert from 'node:assert/strict';
import {plaidAccountEntry,bankAccounts} from '../providers.mjs';
import {syncedDebtBalances,trackerDebtStatus} from '../public/income-model.mjs';
test('loan balance uses principal, distinguishes missing from zero, retains last known values',()=>{
 const loan={account_id:'loan',name:'ELGA Auto',type:'loan',balances:{current:1234.56,available:0,iso_currency_code:'USD'}};
 const item={id:'bank'};const entry=plaidAccountEntry(loan,item);assert.equal(entry.balance,123456);assert.equal(entry.include,false);
 for(const current of [null,undefined,NaN]){const missing=plaidAccountEntry({...loan,balances:{...loan.balances,current}},item,entry);assert.equal(missing.balance,123456);assert.equal(missing.balanceUnavailable,true);}
 const zero=plaidAccountEntry({...loan,balances:{...loan.balances,current:0}},item,entry);assert.equal(zero.balance,0);assert.equal(zero.balanceUnavailable,false);
});
test('manual refresh requests live balance and exposes cached fallback',async()=>{
 const calls=[],item={token:'private'};await bankAccounts(async path=>{calls.push(path);return {accounts:[]};},item,true);assert.deepEqual(calls,['/accounts/balance/get']);
 calls.length=0;await bankAccounts(async path=>{calls.push(path);if(path==='/accounts/balance/get')throw Object.assign(Error('Unavailable'),{code:'PRODUCT_NOT_READY'});return {accounts:[]};},item,true);assert.deepEqual(calls,['/accounts/balance/get','/accounts/get']);assert.match(item.balanceWarning,/cached/);
});
test('linked positive bank balances replace current debt status without subtracting historical checkoffs twice',()=>{
 const planner={debtAccountLinks:{1:'plaid-card',2:'plaid-loan',3:'plaid-missing'}},accounts=[{id:'plaid-card',type:'credit',currency:'USD',balance:170643},{id:'plaid-loan',type:'loan',currency:'USD',balance:0},{id:'plaid-missing',type:'loan',currency:'USD',balance:90000,balanceUnavailable:true}];
 const snapshots=syncedDebtBalances(planner,accounts,'2026-10-25');assert.deepEqual(snapshots,{'1':{balance:170643,date:'2026-10-25'}});
 const plan={syncedDebtBalances:snapshots,state:{cards:[{id:1,balance:2124},{id:2,balance:705}],checkedPaychecks:{1:true}},schedule:[{paycheck:1,payments:[100,50],interestByAccount:[0,0]}]};
 assert.equal(trackerDebtStatus(plan,1).balance,170643);assert.equal(trackerDebtStatus(plan,1).paid,10000);assert.equal(trackerDebtStatus(plan,2).balance,65500);
});
import {combineBankConnections} from '../providers.mjs';
test('duplicate consolidation remaps account and transaction links without doubling balances',()=>{
 const c={items:[{id:'old',name:'ELGA'},{id:'new',name:'ELGA'}],transactions:[{itemId:'old'},{itemId:'new'}],creditCards:[]};
 const p={revision:3,state:{accounts:['old','new'].map(id=>({id:'plaid-'+id+'a',itemId:id,name:'Checking',type:'depository',subtype:'checking',currency:'USD',balance:10000}))}};
 const planner={manual:[{id:'electric',amount:27500}],debtAccountLinks:{1:'plaid-newa'},household:{billsAccountId:'plaid-newa'},transactionLinks:{'bill:electric':{itemId:'new',accountId:'newa'}},bankRules:{'["new","newa","electric"]':{id:'electric'}}};
 const k={revision:5,state:{version:1,values:{'income-planner':JSON.stringify(planner),'app-state':'{"cards":[]}'}}};
 const result=combineBankConnections(c,p,k,'new','old'),saved=JSON.parse(result.classic.state.values['income-planner']);
 assert.equal(result.connections.items.length,1);assert.equal(result.plan.state.accounts.length,1);assert.equal(result.connections.transactions.length,1);assert.equal(result.connections.archivedDuplicates.length,1);assert.equal(saved.debtAccountLinks[1],'plaid-olda');assert.equal(saved.household.billsAccountId,'plaid-olda');assert.equal(saved.transactionLinks['bill:electric'].accountId,'olda');assert.ok(saved.bankRules['["old","olda","electric"]']);assert.deepEqual(saved.manual,planner.manual);assert.equal(result.classic.state.values['app-state'],k.state.values['app-state']);assert.equal(c.items.length,2);
 p.state.accounts[1].name='Different account';assert.throws(()=>combineBankConnections(c,p,k,'new','old'),/matched safely/);
});
