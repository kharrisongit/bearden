import test from 'node:test';
import assert from 'node:assert/strict';
import {removeBillFromPlanner,removeDebtsFromPlanner,removeDebtsFromState} from '../public/account-removal.mjs';
import {billEvents} from '../public/income-model.mjs';

test('deleting a bill removes its schedule and links while retaining unrelated bills and settings',()=>{
 const bill={id:'rent',name:'Rent',amount:10000,date:'2026-11-01',repeat:'monthly',billKind:'rent',source:'manual'};
 const planner={manual:[bill,{...bill,id:'other'}],bankRules:{rent:{id:'rent'},other:{id:'other'}},estimates:{rent:{amount:10000}},covered:{rent:true,other:true},billFunding:{rent:'shared',other:'personal'},loanLinks:{rent:'a'},carLoanDetails:{rent:{}},sunRent:{billId:'rent'},electricBillId:'rent',transactionLinks:{'bill:rent':{merchant:'a'},'bill:other':{merchant:'b'}},emailLinks:{'bill:rent':{sender:'a'}},paid:['rent:2026-10-01','other:2026-10-01'],billShareImports:{share:{0:'rent',1:'other'}},household:{personalAmount:50000}};
 const before=structuredClone(planner),next=removeBillFromPlanner(planner,'rent');
 assert.deepEqual(planner,before);assert.deepEqual(next.manual.map(b=>b.id),['other']);assert.equal(next.bankRules.rent,undefined);assert.equal(next.transactionLinks['bill:rent'],undefined);assert.ok(next.transactionLinks['bill:other']);assert.deepEqual(next.paid,['other:2026-10-01']);assert.equal(next.sunRent,undefined);assert.equal(next.electricBillId,undefined);assert.equal(next.billShareImports.share[0],undefined);assert.deepEqual(next.household,before.household);
 assert.equal(billEvents({bills:[bill]},next,{},'2026-11-01','2026-12-31').some(b=>b.id==='rent'),false);
});

test('deleting a debt clears its preferences and hides associated synced cards without disconnecting other accounts',()=>{
 const planner={debtAccountLinks:{1:'plaid-a',2:'plaid-b'},debtBackupLinks:{1:'simplefin-a'},debtAutoDetails:{1:true},debtFutureMinimums:{1:5000,2:10000},creditCards:{'credit-a':{trackerCardId:'1',tracking:true},'credit-b':{trackerCardId:'2',tracking:true}},transactionLinks:{'debt:1':{},'credit:credit-a':{},'debt:2':{}},emailLinks:{'credit:credit-a':{sender:'bank'}},hiddenConnectedAccounts:{old:true},manual:[{id:'utility'}]};
 const next=removeDebtsFromPlanner(planner,[1],[{id:'credit-a',accountId:'a'},{id:'credit-b',accountId:'b'}]);
 assert.deepEqual(next.debtAccountLinks,{2:'plaid-b'});assert.equal(next.debtBackupLinks[1],undefined);assert.deepEqual(next.debtFutureMinimums,{2:10000});assert.equal(next.creditCards['credit-a'].tracking,false);assert.equal(next.creditCards['credit-a'].trackerCardId,'');assert.equal(next.creditCards['credit-b'].tracking,true);assert.deepEqual(next.hiddenConnectedAccounts,{old:true,'plaid-a':true,'simplefin-a':true});assert.ok(next.transactionLinks['debt:2']);assert.equal(next.transactionLinks['credit:credit-a'],undefined);assert.deepEqual(next.manual,planner.manual);assert.equal(planner.creditCards['credit-a'].tracking,true);
});

test('a connected-only debt can be removed without deleting unrelated tracker debts',()=>{
 const next=removeDebtsFromPlanner({creditCards:{a:{tracking:true}}},[],[{id:'a',accountId:'a'}],['a']);
 assert.equal(next.creditCards.a.tracking,false);assert.equal(next.hiddenConnectedAccounts['plaid-a'],true);
});

test('debt deletion removes only that debt from overrides and checked history, preserving paycheck selections and real expenses',()=>{
 const state={cards:[{id:1},{id:2}],cardIdCounter:2,accountPaymentOverrides:{1:{1:10},2:{1:20}},paycheckSlices:{1:{1:true,2:true}},paycheckSquashes:{2:{1:true}},debtPaymentHistory:{1:{1:10,2:20}},debtInterestHistory:{1:{1:1,2:2}},extraExpenses:{1:[{id:'auto',autoFromCardId:1},{id:'other',autoFromCardId:2},{id:'real',amount:35}]},checkedPaychecks:{1:true},budgetItems:[{id:'food'}]};
 const next=removeDebtsFromState(state,['1']);
 assert.deepEqual(next.cards,[{id:2}]);assert.equal(next.cardIdCounter,2);assert.deepEqual(next.accountPaymentOverrides,{2:{1:20}});assert.deepEqual(next.debtPaymentHistory,{1:{2:20}});assert.deepEqual(next.debtInterestHistory,{1:{2:2}});assert.deepEqual(next.paycheckSquashes,{});assert.deepEqual(next.paycheckSlices,{1:{2:true}});assert.deepEqual(next.extraExpenses[1].map(e=>e.id),['other','real']);assert.deepEqual(next.checkedPaychecks,state.checkedPaychecks);assert.deepEqual(next.budgetItems,state.budgetItems);assert.equal(state.cards.length,2);
});

test('deleting a connected debt also removes the older bill it explicitly replaced',()=>{
 const planner={manual:[{id:'old-card',name:'Card payment'}],creditCards:{credit:{tracking:true,replaces:'old-card'}}};
 const next=removeDebtsFromPlanner(planner,[],[{id:'credit',accountId:'a'}],['credit']);
 assert.deepEqual(next.manual,[]);assert.equal(next.deletedBills['old-card'],true);assert.equal(next.creditCards.credit.tracking,false);
});
