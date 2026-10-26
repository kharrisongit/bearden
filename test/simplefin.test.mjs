import test from 'node:test';
import assert from 'node:assert/strict';
import {claimSimplefin,fetchSimplefin,mergeSimplefinAccounts,configureSimplefinAccount,publicSimplefin,syncSimplefin} from '../simplefin.mjs';
import {syncedDebtBalances} from '../public/income-model.mjs';

const access='https://private-user:private-password@beta-bridge.simplefin.org/simplefin';
const setup=Buffer.from('https://beta-bridge.simplefin.org/simplefin/claim/example').toString('base64');
const payload=(balance='-218.45')=>({connections:[{conn_id:'bank',name:'Indigo'}],accounts:[{id:'card',conn_id:'bank',name:'Indigo Mastercard',currency:'USD',balance,'balance-date':Math.floor(Date.now()/1000)}]});
test('claim and read use only approved HTTPS hosts, redact URL credentials, and refuse redirects',async()=>{
 const calls=[];const f=async(url,opts)=>{calls.push({url,opts});return new Response(url.includes('/claim/')?access:JSON.stringify(payload()));};
 assert.equal(await claimSimplefin(setup,f),access);assert.equal(calls[0].opts.method,'POST');
 await fetchSimplefin(access,f);assert.ok(!calls[1].url.includes('private-'));assert.equal(calls[1].opts.redirect,'manual');assert.equal(calls[1].opts.headers.Authorization,'Basic '+Buffer.from('private-user:private-password').toString('base64'));
 assert.match(calls[1].url,/balances-only=1/);
 for(const url of ['http://beta-bridge.simplefin.org/simplefin/claim/a','https://evil.example/simplefin/claim/a','https://beta-bridge.simplefin.org.evil.example/simplefin/claim/a','https://127.0.0.1/simplefin/claim/a','https://beta-bridge.simplefin.org:8443/simplefin/claim/a','https://user:pass@beta-bridge.simplefin.org/simplefin/claim/a'])await assert.rejects(()=>claimSimplefin(Buffer.from(url).toString('base64'),f));
 assert.equal(calls.length,2);
 await assert.rejects(()=>claimSimplefin(setup,async()=>new Response('',{status:302,headers:{Location:'https://evil.example'}})),/302/);
 await assert.rejects(()=>claimSimplefin(setup,async()=>new Response('https://private-user:private-password@evil.example/simplefin')),e=>!e.message.includes('private-'));
});
test('errors cannot expose provider response bodies or access credentials',async()=>{
 for(const status of [402,403,429,500])await assert.rejects(()=>fetchSimplefin(access,async()=>new Response(access,{status})),e=>!e.message.includes('private-'));
 await assert.rejects(()=>fetchSimplefin(access,async()=>{throw Error(access);}),e=>!e.message.includes('private-'));
 assert.deepEqual(publicSimplefin({simplefin:{accessUrl:access,token:setup,status:'OK'}}),{connected:true,status:'OK',updated:null,lastAttempt:null,nextSync:null});
});
test('debt types and amount-owed interpretation are explicit; imported balances cannot become cash',()=>{
 const accounts=mergeSimplefinAccounts([{id:'manual',balance:100,source:'manual'}],payload()),a=accounts[1];
 assert.equal(a.type,'unknown');assert.equal(a.include,false);assert.equal(a.rawBalance,-21845);
 assert.throws(()=>configureSimplefinAccount(accounts,{id:a.id,kind:'credit'}),/Choose how/);
 configureSimplefinAccount(accounts,{id:a.id,kind:'credit',debtSign:'negative'});assert.equal(a.balance,21845);assert.equal(a.include,false);
 assert.deepEqual(syncedDebtBalances({debtAccountLinks:{debt:a.id}},accounts,'2026-10-26'),{debt:{balance:21845,date:'2026-10-26'}});
 const paid=mergeSimplefinAccounts(accounts,payload('10'))[1];assert.equal(paid.balance,0);assert.equal(paid.rawBalance,1000);
 assert.deepEqual(syncedDebtBalances({debtAccountLinks:{debt:a.id}},[paid],'2026-10-26'),{});
 const positive=mergeSimplefinAccounts([],payload('218.45'));configureSimplefinAccount(positive,{id:positive[0].id,kind:'credit',debtSign:'positive'});assert.equal(positive[0].balance,21845);
});
test('missing, malformed, partial, and absent accounts preserve earlier debt amounts and links',()=>{
 const accounts=mergeSimplefinAccounts([],payload());configureSimplefinAccount(accounts,{id:accounts[0].id,kind:'credit',debtSign:'negative'});
 for(const raw of [null,'','oops','NaN','1e10']){const a=mergeSimplefinAccounts(accounts,payload(raw))[0];assert.equal(a.balance,21845);assert.equal(a.balanceUnavailable,true);}
 const missing=mergeSimplefinAccounts(accounts,{accounts:[]});assert.equal(missing[0].id,accounts[0].id);assert.equal(missing[0].balanceUnavailable,true);
 const partial=mergeSimplefinAccounts(accounts,{...payload('0'),errlist:[{code:'con.auth',conn_id:'bank',msg:access}]});assert.equal(partial[0].balance,21845);assert.equal(partial[0].balanceUnavailable,true);assert.ok(!JSON.stringify(partial).includes('private-'));
 const duplicate=payload();duplicate.accounts.push(duplicate.accounts[0]);assert.throws(()=>mergeSimplefinAccounts(accounts,duplicate),/duplicate/);
 const two=payload();two.accounts.push({...two.accounts[0],conn_id:'spouse'});assert.notEqual(mergeSimplefinAccounts([],two)[0].id,mergeSimplefinAccounts([],two)[1].id);
});
test('daily syncing is rate limited, retains access after failure, and only sends balances requests',async()=>{
 let accounts=[],calls=0;const c={simplefin:{accessUrl:access}},f=async()=>{calls++;return Response.json(payload());};
 await syncSimplefin(c,()=>accounts,v=>{accounts=v;},f);assert.equal(calls,1);assert.equal(accounts.length,1);assert.ok(c.simplefin.nextSync>Date.now()+23*3600000);
 await syncSimplefin(c,()=>accounts,v=>{accounts=v;},f);assert.equal(calls,1);
 c.simplefin.lastAttempt=Date.now()-300001;await syncSimplefin(c,()=>accounts,v=>{accounts=v;},async()=>new Response(access,{status:503}));assert.equal(accounts.length,1);assert.equal(c.simplefin.accessUrl,access);assert.ok(!c.simplefin.status.includes('private-'));
 c.simplefin.lastAttempt=0;c.simplefin.attempts=Array(20).fill(Date.now()-600000);await syncSimplefin(c,()=>accounts,v=>{accounts=v;},f);assert.equal(calls,1);assert.match(c.simplefin.status,/limit/);
});
