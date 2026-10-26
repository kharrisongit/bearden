import test from 'node:test';import assert from 'node:assert/strict';
import {createSunBrowser,parseSunBalance,publicSun,syncSun,sunMessage,SunError} from '../sun-rent.mjs';
import {fakeSunBrowser} from './helpers/sun-browser.mjs';
test('Sun keeps amount due, current balance, and due date distinct',()=>{
 assert.deepEqual(parseSunBalance({totalDue:1050.12,balance:1200.05,dueDate:'2026-11-01T00:00:00',currencyCode:'USD'},null,1),{amountDue:105012,currentBalance:120005,dueDate:'2026-11-01',currency:'USD',checkedAt:1});
 assert.equal(parseSunBalance({totalDue:0,balance:-20,dueDate:null},'USD').currentBalance,-2000);
 for(const data of [{},{totalDue:null,balance:10},{totalDue:'10',balance:10},{totalDue:10,balance:20,dueDate:'2026-02-30'},{totalDue:10,balance:20,dueDate:'2026-11-01',currencyCode:'CAD'}])assert.throws(()=>parseSunBalance(data,'USD'));
});
test('public rent projection never includes sessions, property IDs or live URLs',()=>{
 const publicData=publicSun({connected:true,pending:{expires:999,sessionId:'secret-browser',url:'secret-live'},session:'secret-auth',agreement:'secret-property',snapshot:{amountDue:1,currentBalance:2,currency:'USD',checkedAt:1,secret:'secret-extra'}},2);
 assert.equal(publicData.pendingUntil,999);assert.doesNotMatch(JSON.stringify(publicData),/secret/);assert.equal(publicSun({pending:{expires:1}},2).pendingUntil,null);
 assert.doesNotMatch(sunMessage(Error('sensitive-token')),/sensitive/);
});
test('private sign-in has short lifetime, no recording, guarded hosts and no credentials in URL',async()=>{
 const f=fakeSunBrowser(),browser=createSunBrowser(f.binding),started=await browser.start();assert.equal(f.state.starts[0].recording,false);assert.equal(f.state.starts[0].keepAlive,300000);assert.ok(f.state.starts[0].guardrails.allowedDomains.includes('*.app.sunwebportal.com'));assert.ok(started.pending.expires-Date.now()<=300000);
 f.state.loggedIn=false;await assert.rejects(()=>browser.finish(started.pending),e=>e.code==='login');f.state.loggedIn=true;
 const result=await browser.finish(started.pending);assert.equal(result.snapshot.amountDue,102545);assert.equal(result.session.agreement,'property-a');assert.equal(result.session.cookies.length,1);assert.doesNotMatch(JSON.stringify(result),/unrelated-secret/);
 assert.equal(f.state.calls.filter(c=>c.method==='Page.navigate').length,1);assert.ok(f.state.calls.filter(c=>c.method==='Page.navigate').every(c=>c.params.url==='https://app.sunwebportal.com/portal/payments'));
 assert.ok(!f.state.calls.some(c=>/Input\.|click|submit/i.test(c.method)));await assert.rejects(()=>browser.finish({expires:1}),e=>e.code==='expired');
});
test('automatic check restores only the Sun session, rejects another property and closes browser',async()=>{
 const f=fakeSunBrowser(),browser=createSunBrowser(f.binding),saved={session:f.state.session,cookies:[],agreement:'different'};
 await assert.rejects(()=>browser.check(saved),e=>e.code==='property');assert.equal(f.state.closed.length,1);
 saved.agreement='property-a';const result=await browser.check(saved);assert.equal(result.snapshot.currentBalance,104045);assert.equal(f.state.closed.length,2);
 const script=f.state.calls.find(c=>c.method==='Page.addScriptToEvaluateOnNewDocument').params.source;assert.match(script,/location.origin===\"https:\/\/app.sunwebportal.com\"/);assert.doesNotMatch(script,/localStorage/);
});
test('daily checks preserve last data on errors, pause for re-login, and never change rent bills',async()=>{
 const old={amountDue:100,currentBalance:200},c={connected:true,snapshot:old},now=200000000;
 await syncSun(c,{}, {check:async()=>{throw new SunError('login');}},()=>assert.fail(),{now});assert.equal(c.snapshot,old);assert.equal(c.needsLogin,true);
 await syncSun(c,{}, {check:()=>assert.fail()},()=>assert.fail(),{now:now+86400000});
 c.needsLogin=false;c.lastAttempt=0;let saved=false;
 await syncSun(c,{}, {check:async()=>({session:{secret:true},snapshot:{amountDue:0,currentBalance:0}})},()=>{saved=true;},{now:now+86400000});assert.equal(saved,true);assert.equal(c.snapshot.amountDue,0);assert.equal(c.nextSync,now+2*86400000);
 await syncSun(c,{}, {check:()=>assert.fail()},()=>assert.fail(),{force:true,now:now+86400001});
});
