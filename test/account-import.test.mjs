import test from 'node:test';
import assert from 'node:assert/strict';
import {remapConnectedAccountReferences,resolveDebtDetails} from '../public/connection-model.mjs';
import {bankAccounts,mergePlaidAccounts} from '../providers.mjs';
import {mergeSimplefinAccounts,mergeSimplefinTransactions,syncSimplefin,configureSimplefinAccount,simplefinAccountId} from '../simplefin.mjs';

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
 assert.equal(mergeSimplefinTransactions([],data).length,3);
 const scoped={...data,errlist:[{code:'act.failed',conn_id:'broken',account_id:'one'}]};assert.deepEqual(mergeSimplefinAccounts([],scoped).map(a=>a.providerUnavailable),[false,true,false]);
});
test('SimpleFIN transaction completeness errors do not suppress balances, and absent IDs never match one another',()=>{
 const a=sf('one');delete a.conn_id;
 assert.equal(mergeSimplefinAccounts([],{accounts:[a],errlist:[{code:'con.auth'}]})[0].providerUnavailable,false);
 const data={accounts:[sf('one')],errlist:[{code:'act.missingdata',account_id:'one'}]};assert.equal(mergeSimplefinAccounts([],data)[0].balance,12345);assert.equal(mergeSimplefinTransactions([],data).length,1);
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

test('partial SimpleFIN history imports valid rows without deleting omitted saved transactions',()=>{
 const original=sf('one'),saved=mergeSimplefinTransactions([],{accounts:[{...original,transactions:[{...original.transactions[0],id:'old'}]}]});
 for(const code of ['act.missingdata','act.failed','con.auth','gen.auth']){
  const next=mergeSimplefinTransactions(saved,{accounts:[original],errlist:[{code,account_id:'one',conn_id:'healthy'}]});
  assert.equal(next.length,2);assert.ok(next.some(t=>t.transaction_id===saved[0].transaction_id));
 }
});
test('SimpleFIN preserves account identity, custom references, and transactions across v1/v2 and renamed labels',()=>{
 const legacy={...sf('one'),conn_id:undefined,org:{id:'org',name:'Bank', 'sfin-url':'https://bank.example'}},first=mergeSimplefinAccounts([],{accounts:[legacy]});
 const id=first[0].id;configureSimplefinAccount(first,{id,kind:'checking'});first[0].include=true;
 const v2={...sf('one'),name:'Renamed upstream'},data={accounts:[v2],connections:[{conn_id:'healthy',org_id:'org',sfin_url:'https://bank.example',name:'Renamed connection'}]};
 const duplicate=mergeSimplefinAccounts([],data)[0],rows=mergeSimplefinAccounts([duplicate,...first],data);
 assert.equal(rows.length,1);assert.equal(rows[0].id,id);assert.equal(rows[0].include,true);assert.equal(rows[0].type,'depository');assert.ok(rows[0].identityAliases.includes(duplicate.id));
 const oldPlanner={accountNames:{[id]:'Richard’s checking'},household:{personalAccountId:duplicate.id},debtAccountLinks:{debt:duplicate.id},transactionLinks:{bill:{accountId:duplicate.id}}};
 const planner=remapConnectedAccountReferences(oldPlanner,rows);assert.equal(planner.accountNames[id],'Richard’s checking');assert.equal(planner.household.personalAccountId,id);assert.equal(planner.debtAccountLinks.debt,id);assert.equal(planner.transactionLinks.bill.accountId,id);
 let transactions=mergeSimplefinTransactions([],{accounts:[legacy]});const transactionId=transactions[0].transaction_id;
 transactions=mergeSimplefinTransactions(transactions,data,Date.now(),rows);assert.equal(transactions.length,1);assert.equal(transactions[0].transaction_id,transactionId);assert.equal(transactions[0].account_id,id);
 assert.equal(mergeSimplefinAccounts(rows,{...data,accounts:[{...v2,name:'Another rename'}]}).length,1);
});
test('SimpleFIN never merges same-named accounts from different bank logins',()=>{
 const data={accounts:[sf('one','his'),sf('one','hers')],connections:[{conn_id:'his',org_id:'bank'},{conn_id:'hers',org_id:'bank'}]},rows=mergeSimplefinAccounts([],data);
 assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);
 const again=mergeSimplefinAccounts(rows,{...data,accounts:[{...sf('one','his'),name:'Joint'}]});assert.equal(again.length,2);assert.equal(again.find(a=>a.id===rows[1].id).accountMissing,true);
});
test('history response can recover missing balances and accounts even after a successful partial balance request',async()=>{
 let accounts=[];const c={simplefin:{accessUrl:'https://user:pass@bridge.simplefin.org/simplefin'},transactions:[]};
 await syncSimplefin(c,()=>accounts,a=>{accounts=a;},async url=>Response.json(new URL(url).searchParams.has('balances-only')?{accounts:[{...sf('one'),balance:null},sf('balance-only')]}:{accounts:[sf('one'),sf('history-only')]}));
 assert.equal(accounts.length,3);assert.ok(accounts.every(a=>!a.providerUnavailable));assert.equal(c.transactions.length,2);
});
test('SimpleFIN reports affected names and safe reasons without exposing provider error messages',async()=>{
 let accounts=[];const secret='https://user:pass@bridge.simplefin.org/simplefin',c={simplefin:{accessUrl:secret},transactions:[]};
 await syncSimplefin(c,()=>accounts,a=>{accounts=a;},async()=>Response.json({accounts:[{...sf('one'),name:'Richard checking'}],errlist:[{code:'con.auth',conn_id:'healthy',msg:secret}],connections:[{conn_id:'healthy',name:'Family Bank'}]}));
 assert.match(c.simplefin.status,/Richard checking/);assert.match(c.simplefin.status,/Sign in to this institution again/);assert.ok(!JSON.stringify(accounts).includes(secret));assert.ok(!c.simplefin.status.includes(secret));
});
test('an unconfirmed Plaid loan zero retains known principal and cannot confirm payoff',()=>{
 const item={...bank},old=mergePlaidAccounts([],{accounts:[account('car',7123,'loan')]},item),zero=mergePlaidAccounts(old,{accounts:[account('car',0,'loan')]},item)[0];
 assert.equal(zero.balance,712300);assert.equal(zero.reportedCurrent,0);assert.equal(zero.zeroUnconfirmed,true);assert.equal(zero.balanceUnavailable,true);
 const first=mergePlaidAccounts([],{accounts:[account('car',0,'loan')]},item)[0];assert.equal(first.balanceUpdated,null);assert.equal(first.balanceUnavailable,true);
 const details=resolveDebtDetails({card:{balance:7123,apr:0,monthlyMinimum:250},primary:first});assert.equal(details.balance.value,712300);assert.equal(details.balance.source,'Entered manually');
 const recovered=mergePlaidAccounts([zero],{accounts:[account('car',7000,'loan')]},item)[0];assert.equal(recovered.zeroUnconfirmed,false);assert.equal(recovered.balanceUnavailable,false);assert.equal(recovered.balance,700000);
 assert.equal(mergePlaidAccounts([],{accounts:[account('checking',0)]},item)[0].balanceUnavailable,false);
});
test('Plaid loan zero/live conflict retains positive cached principal and flags verification',async()=>{
 const item={...bank},data=await bankAccounts(async path=>({accounts:[account('car',path==='/accounts/balance/get'?0:7123,'loan')]}),item,true),row=mergePlaidAccounts([],data,item)[0];
 assert.equal(row.balance,712300);assert.equal(row.reportedLiveCurrent,0);assert.equal(row.balanceUnavailable,true);assert.equal(row.balanceSource,'cached');assert.match(row.balanceWarning,/live loan balance was \$0/);
});

test('legacy SimpleFIN responses cannot collapse or remap two known logins that share organization IDs',()=>{
 const row=sf('one'),his=mergeSimplefinAccounts([],{accounts:[{...row,conn_id:'his'}],connections:[{conn_id:'his',org_id:'org'}]}),hers=mergeSimplefinAccounts([],{accounts:[{...row,conn_id:'hers'}],connections:[{conn_id:'hers',org_id:'org'}]});
 const v1={...row,conn_id:undefined,org:{id:'org'}},legacyId=simplefinAccountId(v1),rows=mergeSimplefinAccounts([...his,...hers],{accounts:[v1]});
 assert.equal(rows.length,3);assert.equal(rows.filter(a=>a.accountMissing).length,2);
 const planner={accountNames:{[legacyId]:'Original'},household:{personalAccountId:legacyId}};
 assert.deepEqual(remapConnectedAccountReferences(planner,rows),planner);
 assert.deepEqual(remapConnectedAccountReferences(planner,[...his,...hers]),planner);
});

test('repairing a duplicate during partial history cannot double-count a proven identical transaction',()=>{
 const legacy={...sf('one'),conn_id:undefined,org:{id:'org'}},v2=sf('one'),data={accounts:[v2],connections:[{conn_id:'healthy',org_id:'org'}],errlist:[{code:'act.missingdata',account_id:'one'}]};
 const saved=[...mergeSimplefinTransactions([],{accounts:[legacy]}),...mergeSimplefinTransactions([],{accounts:[v2]})];assert.equal(saved.length,2);
 const accounts=mergeSimplefinAccounts(mergeSimplefinAccounts([],{accounts:[legacy]}),data),next=mergeSimplefinTransactions(saved,data,Date.now(),accounts);
 assert.equal(next.length,1);assert.equal(next[0].transaction_id,saved[0].transaction_id);assert.equal(next[0].account_id,accounts[0].id);
});
