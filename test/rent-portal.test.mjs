import test from 'node:test';import assert from 'node:assert/strict';
import {rentPortalUrl,parseRentPage} from '../rent-portal.mjs';
import {createSunBrowser,publicSun,syncSun} from '../sun-rent.mjs';
import {fakeSunBrowser} from './helpers/sun-browser.mjs';

test('rent URLs accept bare public hostnames but never credentials, local hosts or a missing source',()=>{
 assert.equal(rentPortalUrl('app.sunwebportal.com'),'https://app.sunwebportal.com/');
 assert.equal(rentPortalUrl('https://resident.example.com/login?property=12'),'https://resident.example.com/login?property=12');
 for(const value of ['',undefined,'http://example.com','https://user:password@example.com','https://127.0.0.1','https://[::1]','https://test.local','https://localhost','https://example.com:8080','https://example.com/?access_token=secret'])assert.throws(()=>rentPortalUrl(value));
 assert.equal(publicSun({enabled:true}).portalUrl,'');
 assert.equal(publicSun({enabled:true,pending:{portalUrl:'https://resident.example.com',expires:Date.now()+1000}}).portalUrl,'');
});

test('generic rent reading requires one labelled USD balance and ignores minimums and ledger entries',()=>{
 assert.equal(parseRentPage('Current balance\n$1,234.56\nMinimum payment\n$100.00').currentBalance,123456);
 assert.equal(parseRentPage('Total amount due: USD 0.00').currentBalance,0);
 assert.equal(parseRentPage('Balance due\n$-20.00').currentBalance,-2000);
 for(const text of ['Minimum payment: $300.00','Transactions\nRent $123.00','Current balance $100.00\nCurrent balance $200.00','Current balance CAD $1,234.00'])assert.throws(()=>parseRentPage(text));
});

test('custom portals use isolated storage, guarded hosts, and their saved balance page for later checks',async()=>{
 const f=fakeSunBrowser(),portal='https://resident.example.com/login';
 f.state.page={url:'https://resident.example.com/balance',ready:'complete',text:'Current balance\n$1,450.00',password:false};
 f.state.storage={local:{auth:'private-rent-token'},session:{property:'private-property'}};
 f.state.cookies=[{name:'auth',value:'private-cookie',domain:'.example.com',path:'/',secure:true,httpOnly:true},{name:'other',value:'unrelated',domain:'.google.com',path:'/'}];
 const browser=createSunBrowser(f.binding),started=await browser.start(portal);assert.equal(f.state.targets[0],portal);assert.equal(started.pending.portalUrl,portal);assert.equal(f.state.starts[0].recording,false);
 assert.ok(f.state.starts[0].guardrails.allowedDomains.includes('resident.example.com'));assert.ok(!f.state.starts[0].guardrails.allowedDomains.includes('app.sunwebportal.com'));
 const result=await browser.finish(started.pending);assert.equal(result.snapshot.currentBalance,145000);assert.equal(result.session.cookies.length,1);assert.equal(result.session.adapter,'generic');
 assert.doesNotMatch(JSON.stringify(publicSun({connected:true,portalUrl:portal,snapshot:result.snapshot,session:result.session})),/private-|unrelated/);
 const checked=await browser.check(result.session);assert.equal(checked.snapshot.currentBalance,145000);assert.ok(f.state.calls.some(c=>c.method==='Page.navigate'&&c.params.url===f.state.page.url));
 const restore=f.state.calls.find(c=>c.method==='Page.addScriptToEvaluateOnNewDocument');assert.match(restore.params.source,/location.origin===\"https:\/\/resident.example.com\"/);assert.equal(f.state.closed.length,1);
 f.state.page.url='https://other.example.net/balance';await assert.rejects(()=>browser.finish(started.pending),e=>e.code==='login');
 await syncSun({connected:true,enabled:false},result.session,{check:()=>assert.fail()},()=>assert.fail(),{force:true});
});
