import test from 'node:test';
import assert from 'node:assert/strict';
import {creditCapacity,normalizeCreditCards} from '../public/credit-model.mjs';
import {plaidAccountEntry} from '../providers.mjs';

test('credit limits and available credit survive both Plaid import paths',()=>{
 const raw={account_id:'card',name:'Test card',type:'credit',balances:{current:200,limit:1000,available:750,iso_currency_code:'USD'}};
 const account=plaidAccountEntry(raw,{id:'bank'}),[card]=normalizeCreditCards({accounts:[raw]},{id:'bank',name:'Bank'});
 assert.equal(account.creditLimit,100000);assert.equal(card.available,75000);
 assert.deepEqual(creditCapacity({card,account,enteredLimit:90000,balance:20000}),{limit:100000,providerLimit:100000,available:75000});
 // Planned payoff must not release credit before the bank does.
 assert.equal(creditCapacity({card,account,balance:0}).available,75000);
});
test('manual limits cover missing provider details without treating missing values as zero',()=>{
 assert.deepEqual(creditCapacity({enteredLimit:50000,balance:12345}),{limit:50000,providerLimit:null,available:37655});
 assert.equal(creditCapacity({balance:12345}).available,null);
 assert.equal(creditCapacity({enteredLimit:50000}).available,null);
 assert.equal(creditCapacity({enteredLimit:50000,balance:60000}).available,0);
 assert.equal(creditCapacity({card:{limit:0,available:0},enteredLimit:50000,balance:0}).available,0);
 assert.equal(creditCapacity({card:{available:-100},enteredLimit:50000,balance:0}).available,0);
});
test('SimpleFIN available credit is used only for a known current credit account',()=>{
 const account={type:'credit',source:'simplefin',rawAvailable:8500};
 assert.equal(creditCapacity({account,enteredLimit:50000,balance:40000}).available,8500);
 assert.equal(creditCapacity({account:{...account,rawAvailable:null},enteredLimit:50000,balance:40000}).available,10000);
 assert.equal(creditCapacity({account:{...account,balanceUnavailable:true},enteredLimit:50000,balance:40000}).available,10000);
 assert.equal(creditCapacity({account:{...account,type:'loan'}}).available,null);
});
