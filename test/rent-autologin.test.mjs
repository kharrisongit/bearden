import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {createSunBrowser,rentCredentials,rentAutoLoginSupported,rentLoginFillScript,rentLoginSubmitScript,syncSun,SunError} from '../sun-rent.mjs';
import {fakeSunBrowser} from './helpers/sun-browser.mjs';
const credentials={portalUrl:'https://app.sunwebportal.com',username:'resident@example.com',password:'test-password'};
test('rent credentials are bound to the supported HTTPS portal',()=>{
 assert.equal(rentAutoLoginSupported('app.sunwebportal.com'),true);
 for(const portalUrl of ['https://app.sunwebportal.com.evil.example','http://app.sunwebportal.com','https://other.example','https://user:pass@app.sunwebportal.com'])assert.throws(()=>rentCredentials({...credentials,portalUrl}));
 assert.throws(()=>rentCredentials({...credentials,password:''}));assert.throws(()=>rentCredentials({...credentials,username:'invalid'}));
 assert.equal(rentCredentials({...credentials,password:' spaces are preserved '}).password,' spaces are preserved ');
});
test('login scripts fill and submit only the exact login form, without changing password characters',()=>{
 let submitted=0;const form={checkValidity:()=>true,requestSubmit:()=>submitted++};
 class Input{constructor(type){this.type=type;this.form=form;this.maxLength=100;this.events=[];}set value(value){this.current=value;}get value(){return this.current;}dispatchEvent(e){this.events.push(e.type);}}
 const user=new Input('email'),password=new Input('password'),context=vm.createContext({location:{origin:credentials.portalUrl,pathname:'/auth/login'},HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},document:{querySelector:s=>s.endsWith('#username')?user:password}});
 const secret=' "quotes" \\ \n </script> ';
 assert.equal(vm.runInContext(rentLoginFillScript({...credentials,password:secret}),context),true);assert.equal(password.value,secret);assert.deepEqual(password.events,['input','change']);
 assert.equal(vm.runInContext(rentLoginSubmitScript,context),true);assert.equal(submitted,1);
 context.location.pathname='/portal/payments';assert.equal(vm.runInContext(rentLoginSubmitScript,context),false);assert.equal(submitted,1);
 context.location.pathname='/auth/login';context.location.origin='https://other.example';assert.equal(vm.runInContext(rentLoginFillScript(credentials),context),false);assert.equal(password.value,secret);
});
test('automatic login closes its unrecorded browser and keeps property checks',async()=>{
 const f=fakeSunBrowser();f.state.loggedIn=false;const browser=createSunBrowser(f.binding),result=await browser.login(credentials,'property-a');
 assert.equal(result.snapshot.currentBalance,104045);assert.equal(f.state.starts[0].recording,false);assert.equal(f.state.closed.length,1);
 assert.ok(f.state.calls.some(c=>c.params?.expression===rentLoginSubmitScript));assert.ok(!JSON.stringify(result).includes(credentials.password));
 await assert.rejects(()=>browser.login(credentials,'different'),e=>e.code==='property');assert.equal(f.state.closed.length,2);
 f.state.responseStatus=401;await assert.rejects(()=>browser.login(credentials),e=>e.code==='login');assert.equal(f.state.closed.length,3);
});
test('expired sessions sign in once; invalid credentials pause scheduled retries and preserve balances',async()=>{
 const now=Date.now(),old={currentBalance:10000},connection={connected:true,automaticLogin:true,portalUrl:credentials.portalUrl,snapshot:old};let logins=0,saved;
 const browser={check:async()=>{throw new SunError('login');},login:async(c,agreement)=>{logins++;assert.equal(c,credentials);assert.equal(agreement,'property-a');return {session:{session:'fresh',agreement},snapshot:{currentBalance:12000}};}};
 await syncSun(connection,{session:'expired',agreement:'property-a'},browser,s=>{saved=s;},{now,credentials});assert.equal(logins,1);assert.equal(saved.session,'fresh');assert.equal(connection.snapshot.currentBalance,12000);
 browser.login=async()=>{logins++;throw new SunError('credentials');};
 await syncSun(connection,saved,browser,()=>assert.fail(),{now:now+86400000,credentials});assert.equal(connection.needsLogin,true);assert.equal(connection.snapshot.currentBalance,12000);assert.equal(logins,2);
 await syncSun(connection,saved,browser,()=>assert.fail(),{now:now+2*86400000,credentials});assert.equal(logins,2);
 await syncSun(connection,saved,browser,()=>assert.fail(),{now:now+2*86400000,credentials,force:true});assert.equal(logins,3);
});
test('a working session is reused without a password login',async()=>{
 let logins=0;const connection={connected:true,automaticLogin:true,portalUrl:credentials.portalUrl};
 await syncSun(connection,{}, {check:async()=>({session:{},snapshot:{currentBalance:100}}),login:()=>{logins++;}},()=>{},{credentials});assert.equal(logins,0);
});
