import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export function googleIdentity(user,owner){
 if(!user.email_verified||typeof user.email!=='string'||!user.email.includes('@'))throw Error('Google must verify your email before signing in.');
 const email=user.email.toLowerCase();
 if(email===owner?.toLowerCase())return {scope:'',accountId:'owner',email,sessionVersion:2};
 if(typeof user.sub!=='string'||!user.sub)throw Error('Google did not provide a stable account identifier. Try signing in again.');
 const scope=hash('google:'+user.sub);return {scope,accountId:scope,email,sessionVersion:2};
}
export function microsoftIdentity(user){
 if(typeof user.id!=='string'||!user.id||typeof user.email!=='string'||!user.email.includes('@'))throw Error('Microsoft account identity is missing.');
 const scope=hash('microsoft:'+user.id);return {scope,accountId:scope,email:user.email.toLowerCase(),sessionVersion:2};
}
export function userScope(owner){
 const context=new AsyncLocalStorage(),legacy={scope:'',accountId:'owner',email:owner||'',sessionVersion:1};
 const current=()=>context.getStore()||legacy;
 return {legacy,current,run:(identity,fn)=>context.run(identity||legacy,fn),key:id=>current().scope?'user:'+current().scope+':'+id:id,lock:()=>current().scope?'sync:'+current().scope:'sync'};
}
export function sessionMismatch(identity,header,method){return header?header!==identity.accountId:method==='POST'&&identity.sessionVersion>=2;}
