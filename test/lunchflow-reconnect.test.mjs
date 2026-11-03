import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {connectLunchflow,syncLunchflow,configureLunchflowAccount} from '../lunchflow.mjs';
import {remapConnectedAccountReferences} from '../public/connection-model.mjs';
const date=new Date().toISOString().slice(0,10),earlier=new Date(Date.now()-86400000).toISOString().slice(0,10);
function fixture(){
 let listed=[{id:'old',name:'Checking',institution_name:'Example Bank',currency:'USD'}],failed=false,balance=1200,history=[{id:'tx-a',amount:-80,date},{id:'tx-b',amount:-40,date:earlier}],accounts=[];
 const c={transactions:[]};
 const fetcher=async url=>{
  if(url.endsWith('/accounts'))return failed?Response.json({error:'Unavailable'},{status:503}):Response.json({accounts:listed,total:listed.length});
  if(url.endsWith('/balance'))return Response.json({balance:{amount:balance,currency:'USD'}});
  return Response.json({transactions:history.map(t=>({...t,merchant:'Example merchant',currency:'USD'})),total:history.length});
 };
 const sync=()=>syncLunchflow(c,()=>accounts,a=>{accounts=a;},fetcher);
 return {c,sync,async connect(){c.lunchflow=await connectLunchflow('example-key',fetcher);return sync();},get accounts(){return accounts;},set listed(v){listed=v;},set failed(v){failed=v;},set balance(v){balance=v;},set history(v){history=v;}};
}
test('a reconnected provider ID restores configuration and history, remaps prior duplicate links, and stays idempotent',async()=>{
 const f=fixture();await f.connect();const old=f.accounts[0].id;
 configureLunchflowAccount(f.accounts,{id:old,kind:'checking'});f.accounts[0].include=true;
 const transactionIds=f.c.transactions.map(t=>t.transaction_id);
 f.listed=[{id:'new',name:'Renamed checking',institutionName:'Example Bank',currency:'USD'}];await f.connect();
 assert.equal(f.accounts.length,1);assert.equal(f.accounts[0].id,old);assert.equal(f.accounts[0].providerId,'new');assert.equal(f.accounts[0].type,'depository');assert.equal(f.accounts[0].include,true);
 assert.deepEqual(f.c.transactions.map(t=>t.transaction_id),transactionIds);assert.ok(f.c.transactions.every(t=>t.account_id===old));
 const alias=f.accounts[0].identityAliases[0];
 const planner={household:{billsAccountId:alias},accountNames:{[old]:'My bills',[alias]:'New name'},transactionLinks:{'bill:rent':{accountId:alias}}};
 const mapped=remapConnectedAccountReferences(planner,f.accounts);assert.equal(mapped.household.billsAccountId,old);assert.equal(mapped.accountNames[old],'My bills');assert.equal(mapped.transactionLinks['bill:rent'].accountId,old);
 await f.connect();assert.equal(f.accounts.length,1);assert.equal(f.c.transactions.length,2);assert.equal(f.accounts[0].id,old);
});
test('complete discovery retires removed accounts and restores a returning ID without losing settings or history',async()=>{
 const f=fixture();await f.connect();const old=f.accounts[0].id;configureLunchflowAccount(f.accounts,{id:old,kind:'savings'});
 f.listed=[];await f.connect();assert.equal(f.accounts.length,0);assert.equal(f.c.lunchflowArchivedAccounts.length,1);assert.equal(f.c.transactions.length,2);
 f.listed=[{id:'old',name:'Savings renamed',institution_name:'Example Bank',currency:'USD'}];await f.connect();assert.equal(f.accounts.length,1);assert.equal(f.accounts[0].subtype,'savings');assert.equal(f.c.lunchflowArchivedAccounts.length,0);
});
test('discovery failures keep current accounts and generic names or balances never establish reconnect identity',async()=>{
 const f=fixture();await f.connect();const old=f.accounts[0].id;f.failed=true;f.c.lunchflow.lastAttempt=0;await f.sync();assert.equal(f.accounts[0].id,old);
 f.failed=false;f.listed=[{id:'new',name:'Checking',institution_name:'Example Bank',currency:'USD'}];f.history=[];await f.connect();assert.notEqual(f.accounts[0].id,old);assert.equal(f.accounts.length,1);assert.equal(f.c.lunchflowArchivedAccounts[0].id,old);
});
test('a legitimate zero checking balance remains usable to confirm a posted payment',async()=>{
 const f=fixture();await f.connect();configureLunchflowAccount(f.accounts,{id:f.accounts[0].id,kind:'checking'});f.balance=0;await f.connect();assert.equal(f.accounts[0].balance,0);assert.equal(f.accounts[0].balanceUnavailable,false);
});

test('duplicates already imported by an older build consolidate without duplicating payments or losing explicit assignments',async()=>{
 const f=fixture();await f.connect();const old=f.accounts[0].id;
 configureLunchflowAccount(f.accounts,{id:old,kind:'checking'});
 const alias='lunchflow-'+createHash('sha256').update('new').digest('hex').slice(0,32);
 f.accounts.push({...f.accounts[0],id:alias,providerId:'new',type:'unknown'});
 const copied=f.c.transactions.map((t,i)=>({...t,account_id:alias,transaction_id:'copy-'+i}));f.c.transactions.push(...copied);
 f.listed=[{id:'new',name:'Checking',institution_name:'Example Bank',currency:'USD'}];await f.connect();
 assert.equal(f.accounts.length,1);assert.equal(f.accounts[0].id,old);assert.equal(f.c.transactions.length,2);
 const planner={transactionLinks:{'bill:rent':{accountId:alias,paymentIds:[copied[0].transaction_id]}}};
 const next=remapConnectedAccountReferences(planner,f.accounts);assert.equal(next.transactionLinks['bill:rent'].accountId,old);assert.equal(next.transactionLinks['bill:rent'].paymentIds[0],f.c.transactions[0].transaction_id);
});
