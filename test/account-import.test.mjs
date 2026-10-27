import test from 'node:test';
import assert from 'node:assert/strict';
import {bankAccounts,mergePlaidAccounts} from '../providers.mjs';
import {mergeSimplefinAccounts,mergeSimplefinTransactions,syncSimplefin,configureSimplefinAccount} from '../simplefin.mjs';

const bank={id:'bank',token:'private'};
const account=(id,current,type='depository')=>({account_id:id,name:id,type,subtype:'checking',balances:{current,available:type==='depository'?current:9999,iso_currency_code:'USD'}});
test('Plaid discovers accounts omitted from live balances and uses cached principal when live principal is null',async()=>{
 const item={...bank},data=await bankAccounts(async path=>({accounts:path==='/accounts/get'?[account('checking',100),account('loan',1200,'loan'),account('savings',50)]:[account('checking',110),account('loan',null,'loan')]}),item,true);
 const rows=mergePlaidAccounts([],data,item);
 assert.equal(rows.length,3);assert.equal(rows.find(a=>a.id==='plaid-checking').balance,11000);
 assert.equal(rows.find(a=>a.id==='plaid-loan').balance,120000);assert.equal(rows.find(a=>a.id==='plaid-loan').balanceSource,'cached');assert.match(item.balanceWarning,/2 account/);
});
test('Plaid keeps missing accounts and links, and restores them when the provider returns them',()=>{
 const item={...bank},old=mergePlaidAccounts([],{accounts:[account('checking',100),account('loan',1200,'loan')]},item);
 const next=mergePlaidAccounts(old,{accounts:[account('checking',120)]},item);
 assert.equal(next.length,2);assert.equal(next[1].id,old[1].id);assert.equal(next[1].balance,120000);assert.equal(next[1].accountMissing,true);assert.equal(next[1].balanceUpdated,old[1].balanceUpdated);
 const recovered=mergePlaidAccounts(next,{accounts:[account('loan',1100,'loan'),account('checking',120)]},item);
 assert.equal(recovered[0].accountMissing,false);assert.equal(recovered[0].balanceUnavailable,false);assert.equal(recovered[0].balance,110000);
});
test('Plaid prefers live current cash when live available is missing; investment balance is total assets',async()=>{
 const data=await bankAccounts(async path=>({accounts:path==='/accounts/get'?[account('checking',100)]:[{...account('checking',120),balances:{current:120,iso_currency_code:'USD'}},account('investment',500,'investment')]}),{...bank},true);
 const rows=mergePlaidAccounts([],data,{...bank});assert.equal(rows[0].balance,12000);assert.equal(rows[1].balance,50000);
});
test('Plaid live inventory survives a failed discovery call and unknown debt cannot become available credit',async()=>{
 const item={...bank},data=await bankAccounts(async path=>{if(path==='/accounts/get')throw Error('Unavailable');return {accounts:[account('loan',null,'loan')]};},item,true);
 const rows=mergePlaidAccounts([],data,item);assert.equal(rows.length,1);assert.equal(rows[0].balanceUnavailable,true);assert.match(item.balanceWarning,/discovery/);
});

const stamp=Math.floor(Date.now()/1000)-60;
const sf=(id,conn='healthy')=>({id,conn_id:conn,name:id,currency:'USD',balance:'123.45','balance-date':stamp,transactions:[{id:'tx',posted:stamp,amount:'-12.00',description:'Purchase'}]});
test('SimpleFIN structured errors affect only their connection/account and legacy duplicate messages do not poison healthy accounts',()=>{
 const data={accounts:[sf('one'),sf('one','broken'),sf('other')],errlist:[{code:'con.auth',conn_id:'broken'}],errors:['Authentication required']};
 const rows=mergeSimplefinAccounts([],data);assert.deepEqual(rows.map(a=>a.providerUnavailable),[false,true,false]);
 assert.equal(mergeSimplefinTransactions([],data).length,2);
 const scoped={...data,errlist:[{code:'act.failed',conn_id:'broken',account_id:'one'}]};assert.deepEqual(mergeSimplefinAccounts([],scoped).map(a=>a.providerUnavailable),[false,true,false]);
});
test('SimpleFIN transaction completeness errors do not suppress balances, and absent IDs never match one another',()=>{
 const a=sf('one');delete a.conn_id;
 assert.equal(mergeSimplefinAccounts([],{accounts:[a],errlist:[{code:'con.auth'}]})[0].providerUnavailable,false);
 const data={accounts:[sf('one')],errlist:[{code:'act.missingdata',account_id:'one'}]};assert.equal(mergeSimplefinAccounts([],data)[0].balance,12345);assert.deepEqual(mergeSimplefinTransactions([],data),[]);
 assert.equal(mergeSimplefinAccounts([],{accounts:[sf('one')],errlist:[{code:'gen.auth'}]})[0].providerUnavailable,true);
});
test('SimpleFIN legacy warnings preserve usable amounts and merge transactions without deleting saved history',()=>{
 const a=sf('one'),data={accounts:[a],errors:['Another bank needs login']},old=mergeSimplefinTransactions([],{accounts:[{...a,transactions:[{...a.transactions[0],id:'old'}]}]});
 assert.equal(mergeSimplefinAccounts([],data)[0].balance,12345);assert.equal(mergeSimplefinTransactions(old,data).length,2);
});
test('SimpleFIN cash selections and confirmed debt interpretation survive repeated syncs',()=>{
 const data={accounts:[sf('cash'),sf('card')]},rows=mergeSimplefinAccounts([],data);
 configureSimplefinAccount(rows,{id:rows[0].id,kind:'checking'});rows[0].include=true;
 configureSimplefinAccount(rows,{id:rows[1].id,kind:'credit',debtSign:'positive'});
 const next=mergeSimplefinAccounts(rows,data);assert.equal(next[0].include,true);assert.equal(next[1].debtSign,'positive');assert.equal(next[1].include,false);
});
test('SimpleFIN loads unfiltered balances even if history fails and accounts for both requests',async()=>{
 let accounts=[];const c={simplefin:{accessUrl:'https://user:pass@bridge.simplefin.org/simplefin'},transactions:[]},calls=[];
 await syncSimplefin(c,()=>accounts,a=>{accounts=a;},async url=>{calls.push(new URL(url));if(new URL(url).searchParams.get('balances-only')==='1')return Response.json({accounts:[sf('one')]});throw Error('History unavailable');});
 assert.equal(accounts[0].balance,12345);assert.equal(c.simplefin.attempts.length,2);assert.match(c.simplefin.status,/Transaction history could not refresh/);
 assert.equal(calls[0].searchParams.has('start-date'),false);assert.equal(calls[0].searchParams.has('account'),false);assert.equal(Number(calls[1].searchParams.get('end-date'))-Number(calls[1].searchParams.get('start-date')),90*86400);
});
test('SimpleFIN history can recover a failed lightweight balance request',async()=>{
 let accounts=[];const c={simplefin:{accessUrl:'https://user:pass@bridge.simplefin.org/simplefin'},transactions:[]};
 await syncSimplefin(c,()=>accounts,a=>{accounts=a;},async url=>new URL(url).searchParams.has('balances-only')?new Response('',{status:503}):Response.json({accounts:[sf('one')]}));
 assert.equal(accounts[0].balance,12345);assert.equal(c.transactions.length,1);assert.equal(c.transactions[0].amount,12);
});
test('SimpleFIN never exceeds its request budget even when only one request remains',async()=>{
 let accounts=[],calls=0;const c={simplefin:{accessUrl:'https://user:pass@bridge.simplefin.org/simplefin',attempts:Array(19).fill(Date.now()-600000)}};
 await syncSimplefin(c,()=>accounts,a=>{accounts=a;},async()=>{calls++;return Response.json({accounts:[sf('one')]});});
 assert.equal(calls,1);assert.equal(c.simplefin.attempts.length,20);assert.equal(accounts.length,1);
});
