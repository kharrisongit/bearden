import {randomBytes,createHash} from 'node:crypto';
import {cleanSharedBills} from './public/bill-sharing.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const billShareLifetime=7*86400000;
export function billShareKey(code){
 if(typeof code!=='string'||!/^BD1-[A-Za-z0-9_-]{32}$/.test(code.trim()))throw Error('Paste the complete BearDen share code.');
 return 'bill-share:'+hash(code.trim());
}
// Called under the current profile's existing write lock. The global lookup is
// reachable only using a random 192-bit code; owner metadata never leaves here.
export async function billSharingAction(action,input,{read,write,rawRead,rawWrite,rawDelete,accountId,now=Date.now()}){
 async function ownShare(){const active=await read('active-bill-share',null);if(!active)return null;const share=await rawRead(active.key,null);return share?.ownerId===accountId&&share.expires>now?{...active,share}:null;}
 function publicShare(share){return {id:share.id,bills:cleanSharedBills(share.bills),expires:share.expires};}
 if(action==='status'){const active=await ownShare();return active?{code:active.code,...publicShare(active.share)}:{code:null};}
 if(action==='create'){
  const bills=cleanSharedBills(input.bills),code='BD1-'+randomBytes(24).toString('base64url'),key=billShareKey(code),old=await read('active-bill-share',null),share={id:key.slice('bill-share:'.length),ownerId:accountId,bills,expires:now+billShareLifetime};
  await rawWrite(key,share);try{await write('active-bill-share',{code,key});}catch(error){await rawDelete(key);throw error;}
  if(old?.key){const prior=await rawRead(old.key,null);if(prior?.ownerId===accountId)await rawDelete(old.key);}
  return {code,...publicShare(share)};
 }
 if(action==='preview'){
  const share=await rawRead(billShareKey(input.code),null);if(!share||share.expires<=now)throw Error('This share code has expired or was revoked. Ask for a new code.');
  return publicShare(share);
 }
 if(action==='revoke'){
  const active=await read('active-bill-share',null);if(active?.key){const share=await rawRead(active.key,null);if(share?.ownerId===accountId)await rawDelete(active.key);}await write('active-bill-share',null);return {ok:true};
 }
 throw Error('Unknown bill sharing action.');
}
