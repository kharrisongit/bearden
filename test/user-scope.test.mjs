import test from 'node:test';import assert from 'node:assert/strict';
import {googleIdentity,userScope} from '../user-scope.mjs';
test('verified Google subject defines a stable private profile while the original owner retains existing records',()=>{
 const owner='owner@example.com',a=googleIdentity({email:'one@example.com',email_verified:true,sub:'abc'},owner),b=googleIdentity({email:'renamed@example.com',email_verified:true,sub:'abc'},owner);
 assert.equal(a.scope,b.scope);assert.notEqual(a.scope,googleIdentity({email:'one@example.com',email_verified:true,sub:'other'},owner).scope);assert.equal(googleIdentity({email:owner.toUpperCase(),email_verified:true,sub:'owner'},owner).scope,'');
 assert.throws(()=>googleIdentity({email:owner,email_verified:false},owner),/verify/);assert.throws(()=>googleIdentity({email:'other@example.com',email_verified:true},owner),/identifier/);
 const scopes=userScope(owner);assert.equal(scopes.key('plan'),'plan');scopes.run(a,()=>assert.equal(scopes.key('plan'),'user:'+a.scope+':plan'));
});
