import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlaidLoanBalances,normalizePlaidLoans,diagnosePlaid} from '../plaid-loans.mjs';
import {mergePlaidAccounts} from '../providers.mjs';
import {creditLinkOptions,syncCredit,publicItem} from '../credit.mjs';
import {blank,validate} from '../public/engine.mjs';
import {mergeSimplefinAccounts,configureSimplefinAccount,syncSimplefin} from '../simplefin.mjs';
const item={id:'bank',token:'secret',name:'ELGA',liabilities:true};
const account={account_id:'auto',type:'loan',subtype:'auto',name:'Auto',balances:{current:0,available:0,iso_currency_code:'USD'}};
const response={accounts:[account],liabilities:{loan:[{account_id:'auto',principal_balance:7123.45,origination_principal_amount:25000,next_payment_amount:250,account_number:'DO NOT RETURN'}]},request_id:'request-loans'};
test('Plaid imports loan principal without confusing original principal, payments, or another account',async()=>{
 const c={items:[{...item}],transactions:[]},i=c.items[0];await syncCredit(c,i,async()=>response,true);
 assert.equal(c.loanDetails[0].principal,712345);assert.ok(!JSON.stringify(c).includes('DO NOT RETURN'));assert.match(i.liabilitiesStatus,/1 loan/);
 const accounts=mergePlaidAccounts([],{accounts:[account]},i),rows=applyPlaidLoanBalances(accounts,c,i);
 assert.equal(rows[0].balance,712345);assert.equal(rows[0].balanceSource,'liabilities');assert.equal(rows[0].balanceUnavailable,false);assert.equal(rows[0].reportedCurrent,0);assert.equal(rows[0].liabilityPrincipal,712345);
 assert.deepEqual(applyPlaidLoanBalances(accounts,c,{...i,id:'another'}),accounts);
 const noPrincipal=normalizePlaidLoans({...response,liabilities:{loan:[{account_id:'auto',origination_principal_amount:25000,next_payment_amount:250}] }},i);
 assert.equal(noPrincipal[0].principal,null);assert.equal(applyPlaidLoanBalances(accounts,{loanDetails:noPrincipal},i)[0].balanceUnavailable,true);
});
test('loan details preserve usable live balances and do not promote stale, wrong-currency, errored, or zero principal',()=>{
 const loan=normalizePlaidLoans(response,item)[0],old=mergePlaidAccounts([],{accounts:[account]},item);
 for(const changed of [{...loan,stale:true},{...loan,currency:'EUR'},{...loan,updated:'2020-01-01T00:00:00Z'},{...loan,principal:0}])assert.equal(applyPlaidLoanBalances(old,{loanDetails:[changed]},item)[0].balanceUnavailable,true);
 assert.equal(applyPlaidLoanBalances(old,{loanDetails:[loan]},{...item,liabilitiesError:'ITEM_LOGIN_REQUIRED'})[0].balanceUnavailable,true);
 const live=mergePlaidAccounts([],{accounts:[{...account,balanceSource:'live',balances:{...account.balances,current:7000}}]},item);
 assert.equal(applyPlaidLoanBalances(live,{loanDetails:[loan]},item)[0].balance,700000);
});
test('a successful Liabilities request records an omitted loan without erasing its previous observation',async()=>{
 const c={items:[{...item}],transactions:[]},i=c.items[0],accounts=mergePlaidAccounts([],{accounts:[account]},i);
 await syncCredit(c,i,async()=>({accounts:[],liabilities:{},request_id:'request-empty'}),true);
 const first=applyPlaidLoanBalances(accounts,c,i)[0];
 assert.equal(first.liabilityCheckedAt,i.liabilitiesUpdated);assert.equal(first.liabilityStatus,'account-not-returned');assert.equal(first.liabilityUpdated,undefined);assert.equal(first.balanceUnavailable,true);
 const priorTime='2026-10-26T10:00:00.000Z',prior=normalizePlaidLoans(response,i,priorTime)[0];
 c.loanDetails=[prior];
 const saved={...accounts[0],liabilityPrincipal:prior.principal,liabilityAccountCurrent:prior.accountCurrent,liabilityUpdated:priorTime,liabilityRequestId:prior.requestId};
 await syncCredit(c,i,async()=>({accounts:[{...account,account_id:'another-loan'}],liabilities:{},request_id:'request-omitted'}),true);
 const next=applyPlaidLoanBalances([saved],c,i)[0];
 assert.equal(c.loanDetails.find(l=>l.id===saved.id).stale,true);assert.equal(next.liabilityStatus,'account-not-returned');assert.equal(next.liabilityCheckedAt,i.liabilitiesUpdated);
 assert.equal(next.liabilityPrincipal,712345);assert.equal(next.liabilityUpdated,priorTime);assert.equal(next.liabilityRequestId,prior.requestId);assert.equal(next.balance,saved.balance);
});
test('a returned loan without liability details records the successful check and account balance observation',async()=>{
 const c={items:[{...item}],transactions:[]},i=c.items[0];
 await syncCredit(c,i,async()=>({accounts:[account],liabilities:{},request_id:'request-no-details'}),true);
 const row=applyPlaidLoanBalances(mergePlaidAccounts([],{accounts:[account]},i),c,i)[0];
 assert.equal(row.liabilityStatus,'details-not-returned');assert.equal(row.liabilityCheckedAt,i.liabilitiesUpdated);assert.equal(row.liabilityUpdated,c.loanDetails[0].updated);
 assert.equal(row.liabilityPrincipal,null);assert.equal(row.liabilityAccountCurrent,0);assert.equal(row.balanceUnavailable,true);
});
test('missing principal and a reported zero principal have different diagnostics without confirming payoff',async()=>{
 for(const [details,status,principal]of [[{origination_principal_amount:25000,next_payment_amount:250},'principal-unavailable',null],[{principal_balance:0},'principal-reported',0]]){
  const c={items:[{...item}],transactions:[]},i=c.items[0];
  await syncCredit(c,i,async()=>({...response,liabilities:{loan:[{account_id:'auto',...details}]}}),true);
  const row=applyPlaidLoanBalances(mergePlaidAccounts([],{accounts:[account]},i),c,i)[0];
  assert.equal(row.liabilityStatus,status);assert.equal(row.liabilityPrincipal,principal);assert.equal(row.liabilityCheckedAt,i.liabilitiesUpdated);
  assert.equal(row.balanceUnavailable,true);assert.equal(row.zeroUnconfirmed,true);
 }
});
test('a failed Liabilities retry preserves the last successful check and saved observation',async()=>{
 const c={items:[{...item}],transactions:[]},i=c.items[0];
 await syncCredit(c,i,async()=>response,true);
 const saved=applyPlaidLoanBalances(mergePlaidAccounts([],{accounts:[account]},i),c,i)[0],successfulAt=i.liabilitiesUpdated;
 await syncCredit(c,i,async()=>{throw Object.assign(Error('ITEM_LOGIN_REQUIRED'),{code:'ITEM_LOGIN_REQUIRED',requestId:'request-failed'});},true);
 const next=applyPlaidLoanBalances([saved],c,i)[0];
 assert.equal(i.liabilitiesError,'ITEM_LOGIN_REQUIRED');assert.equal(i.liabilitiesUpdated,successfulAt);assert.equal(next.liabilityStatus,'principal-reported');assert.equal(next.liabilityCheckedAt,successfulAt);
 for(const key of ['liabilityPrincipal','liabilityAccountCurrent','liabilityUpdated','liabilityRequestId','balance','balanceUpdated'])assert.equal(next[key],saved[key]);
});
test('loan diagnostic metadata survives plan serialization, validation, and later account balance merges',async()=>{
 const c={items:[{...item}],transactions:[]},i=c.items[0];
 await syncCredit(c,i,async()=>({...response,liabilities:{loan:[{account_id:'auto',principal_balance:0}]}}),true);
 const state=blank();state.accounts=applyPlaidLoanBalances(mergePlaidAccounts([],{accounts:[account]},i),c,i);
 const restored=validate(JSON.parse(JSON.stringify(state))),next=mergePlaidAccounts(restored.accounts,{accounts:[account]},i)[0];
 for(const key of ['liabilityCheckedAt','liabilityStatus','liabilityPrincipal','liabilityAccountCurrent','liabilityUpdated','liabilityRequestId'])assert.equal(next[key],state.accounts[0][key]);
 assert.equal(next.liabilityStatus,'principal-reported');assert.equal(next.liabilityPrincipal,0);assert.equal(next.zeroUnconfirmed,true);
});
test('loan update consent uses the existing Plaid Item without credit-card-only filters',()=>{
 const options=creditLinkOptions({kind:'loan',itemId:item.id},item);
 assert.equal(options.access_token,item.token);assert.deepEqual(options.additional_consented_products,['liabilities','transactions']);assert.equal(options.account_filters,undefined);assert.equal(options.products,undefined);
});
test('new Plaid principal updates a previous liability balance when general balances cannot refresh',()=>{
 const now=Date.now(),loan=normalizePlaidLoans(response,item,new Date(now).toISOString())[0];
 const previous={...mergePlaidAccounts([],{accounts:[account]},item)[0],balance:750000,balanceSource:'liabilities',balanceUnavailable:false,balanceUpdated:new Date(now-3600000).toISOString()};
 assert.equal(applyPlaidLoanBalances([previous],{loanDetails:[loan]},item,now)[0].balance,712345);
 assert.equal(applyPlaidLoanBalances([previous],{loanDetails:[{...loan,updated:new Date(now-7200000).toISOString()}]},item,now)[0].balance,750000);
});
test('diagnostics expose safe product/status identifiers without tokens, institution credentials, or arbitrary response fields',async()=>{
 const i={...item};let path;
 const d=await diagnosePlaid(i,async(p,body)=>{path=p;assert.equal(body.access_token,'secret');return {item:{available_products:['liabilities'],billed_products:['transactions'],consented_products:['transactions'],institution_id:'ins_elga',access_token:'secret',error:{error_code:'ITEM_LOGIN_REQUIRED',display_message:'secret'}},status:{transactions:{last_successful_update:'2026-10-26T10:00:00Z'}},request_id:'diagnostic-1',secret:'secret'};});
 assert.equal(path,'/item/get');assert.equal(d.loanDetailsSupported,true);assert.equal(d.errorCode,'ITEM_LOGIN_REQUIRED');assert.equal(d.lastTransactionUpdate,'2026-10-26T10:00:00.000Z');assert.ok(!JSON.stringify(publicItem(i)).includes('secret'));
});
const sf=(balance='-218.45')=>({accounts:[{id:'card',conn_id:'issuer',name:'Card',currency:'USD',balance,'balance-date':Math.floor(Date.now()/1000)}]});
test('SimpleFIN valid dated balances remain usable and explicitly stale under scoped provider errors',()=>{
 const data=sf(),rows=mergeSimplefinAccounts([],data);configureSimplefinAccount(rows,{id:rows[0].id,kind:'credit',debtSign:'negative'});
 const updated=mergeSimplefinAccounts(rows,{...sf('-200'),errlist:[{code:'act.failed',conn_id:'issuer',account_id:'card',msg:'private message'}]})[0];
 assert.equal(updated.balance,20000);assert.equal(updated.balanceUnavailable,false);assert.equal(updated.balanceStale,true);assert.equal(updated.balanceObservation.amount,-20000);assert.equal(updated.balanceObservation.errors[0].code,'act.failed');assert.ok(!JSON.stringify(updated).includes('private message'));
 const recovered=mergeSimplefinAccounts([updated],sf('-200'),new Date().toISOString(),{recoverOnly:true})[0];assert.equal(recovered.balanceStale,false);
});
test('SimpleFIN distinguishes missing, malformed, undated, and unconfigured balances without turning them into zero',()=>{
 for(const balance of [null,'','bad']){const a=mergeSimplefinAccounts([],sf(balance))[0];assert.equal(a.balanceUnavailable,true);assert.equal(a.balanceObservation.amount,null);assert.equal(a.balanceObservation.amountStatus,balance==='bad'?'invalid':'missing');}
 const data=sf();delete data.accounts[0]['balance-date'];const a=mergeSimplefinAccounts([],data)[0];assert.equal(a.balanceObservation.amount,-21845);assert.equal(a.balanceObservation.dateStatus,'missing');assert.equal(a.balanceUnavailable,true);
 const rows=mergeSimplefinAccounts([],sf());configureSimplefinAccount(rows,{id:rows[0].id,kind:'credit',debtSign:'negative'});const zero=mergeSimplefinAccounts(rows,{...sf('0'),errlist:[{code:'con.auth',conn_id:'issuer'}]})[0];assert.equal(zero.balance,21845);assert.equal(zero.balanceUnavailable,true);
});
test('SimpleFIN tolerates ordinary numeric formats while keeping empty, boolean, and nonfinite values invalid',()=>{
 for(const balance of [' -218.45 ', -218.45,'+218.45'])assert.equal(Math.abs(mergeSimplefinAccounts([],sf(balance))[0].balanceObservation.amount),21845);
 for(const balance of [true,false,Infinity,NaN])assert.equal(mergeSimplefinAccounts([],sf(balance))[0].balanceObservation.amount,null);
 const data=sf();data.accounts[0]['balance-date']=String(data.accounts[0]['balance-date']);assert.equal(mergeSimplefinAccounts([],data)[0].providerUnavailable,false);
});
test('a successful history response clears a lightweight SimpleFIN error at the same balance date',async()=>{
 const c={simplefin:{accessUrl:'https://user:pass@bridge.simplefin.org/simplefin'}};let accounts=[];
 await syncSimplefin(c,()=>accounts,a=>{accounts=a;},async url=>Response.json({...sf(),...(new URL(url).searchParams.has('balances-only')?{errlist:[{code:'con.auth',conn_id:'issuer'}]}:{})}));
 assert.equal(accounts[0].balanceStale,false);assert.equal(accounts[0].providerUnavailable,false);
});
