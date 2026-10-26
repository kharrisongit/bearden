import {randomBytes,createHash} from 'node:crypto';
import {cleanSharedBills,normalizeBillShareCode} from './public/bill-sharing.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
export const billShareLifetime=7*86400000;
export const billShareKey=code=>'bill-share:'+hash(normalizeBillShareCode(code));
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Signed-in recipients use an eight-character code; failed lookups are limited
// per profile. Management remains restricted to the share's owner.
export async function billSharingAction(action,input,{read,write,rawRead,rawWrite,rawDelete,accountId,now=Date.now()}){
 async function ownShare(){const active=await read('active-bill-share',null);if(!active)return null;const share=await rawRead(active.key,null);return share?.ownerId===accountId&&share.expires>now?{...active,share}:null;}
 function publicShare(share){return {id:share.id,bills:cleanSharedBills(share.bills),expires:share.expires};}
 async function unusedCode(){
  for(let i=0;i<8;i++){const letters=[...randomBytes(8)].map(n=>alphabet[n%32]).join(''),code=letters.slice(0,4)+'-'+letters.slice(4),key=billShareKey(code);if(!await rawRead(key,null))return {code,key};}
  throw Error('Could not create a code. Try again.');
 }
 async function shortShare(active){
  if(!active.code.startsWith('BD1-'))return active;
  const {code,key}=await unusedCode(),share={...active.share,keys:[...new Set([...(active.share.keys||[]),active.key,key])]};
  await rawWrite(key,share);try{await write('active-bill-share',{code,key});}catch(error){await rawDelete(key);throw error;}
  // Keep an already-sent legacy code working until expiry or explicit revocation.
  await rawWrite(active.key,share);return {code,key,share};
 }
 async function removeShare(active){
  if(!active?.key)return;
  const share=await rawRead(active.key,null);if(share?.ownerId!==accountId)return;
  for(const key of share.keys||[active.key]){const entry=await rawRead(key,null);if(entry?.ownerId===accountId)await rawDelete(key);}
 }
 if(action==='status'){let active=await ownShare();if(active)active=await shortShare(active);return active?{code:active.code,...publicShare(active.share)}:{code:null};}
 if(action==='create'){
  const bills=cleanSharedBills(input.bills),active=await ownShare();
  if(active&&JSON.stringify(active.share.bills)===JSON.stringify(bills)){const same=await shortShare(active);return {code:same.code,...publicShare(same.share)};}
  const {code,key}=await unusedCode(),old=await read('active-bill-share',null),share={id:key.slice('bill-share:'.length),ownerId:accountId,bills,expires:now+billShareLifetime};
  await rawWrite(key,share);try{await write('active-bill-share',{code,key});}catch(error){await rawDelete(key);throw error;}
  await removeShare(old);return {code,...publicShare(share)};
 }
 if(action==='preview'){
  let attempts=await read('bill-share-attempts',null);if(!attempts||now-attempts.start>=600000)attempts={start:now,count:0};
  if(attempts.count>=20)throw Error('Too many incorrect codes. Try again in 10 minutes.');
  try{
   const share=await rawRead(billShareKey(input.code),null);if(!share||share.expires<=now)throw Error('Code not found or expired. Ask the sender to share a new link.');
   return publicShare(share);
  }catch(error){await write('bill-share-attempts',{...attempts,count:attempts.count+1});throw error;}
 }
 if(action==='revoke'){await removeShare(await read('active-bill-share',null));await write('active-bill-share',null);return {ok:true};}
 throw Error('Unknown bill sharing action.');
}
