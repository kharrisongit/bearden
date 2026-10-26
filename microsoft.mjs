// Personal Microsoft accounts: Outlook.com, Hotmail and Live. Identity comes
// from authenticated Graph /me, never from an unverified ID-token payload.
import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {messageText} from './providers.mjs';
export const microsoftAuthority='https://login.microsoftonline.com/consumers/oauth2/v2.0';
const graph='https://graph.microsoft.com/v1.0';
export const microsoftScopes=mail=>'openid profile email https://graph.microsoft.com/User.Read'+(mail?' offline_access https://graph.microsoft.com/Mail.Read':'');
export function microsoftAuthorization({clientId,origin,state,verifier,mail=false}){
 return microsoftAuthority+'/authorize?'+new URLSearchParams({client_id:clientId,redirect_uri:origin+'/auth/microsoft/callback',response_type:'code',response_mode:'query',scope:microsoftScopes(mail),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:mail?'consent':'select_account'});
}
export function exchangeMicrosoftToken(request,clientId,clientSecret,params){
 return request(microsoftAuthority+'/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,...params})});
}
export async function microsoftUser(request,token){
 if(!token.access_token)throw Error('Microsoft did not return an access token. Try again.');
 const profile=await request(graph+'/me?$select=id,mail,userPrincipalName',{headers:{Authorization:'Bearer '+token.access_token}});
 const email=profile.mail||profile.userPrincipalName;
 if(typeof profile.id!=='string'||!profile.id||typeof email!=='string'||!email.includes('@'))throw Error('Microsoft did not return an account identity. Try again.');
 return {id:profile.id,email:email.toLowerCase()};
}
export function requireMicrosoftMail(token){
 const scopes=(token.scope||'').toLowerCase().split(' ');
 if(!token.refresh_token||!scopes.some(s=>s==='mail.read'||s==='https://graph.microsoft.com/mail.read'))throw Error('Read-only inbox access was not granted. Reconnect Hotmail / Outlook and allow access.');
}
export const microsoftMailHeaders=token=>({Authorization:'Bearer '+token.access_token,Prefer:'outlook.body-content-type="text", IdType="ImmutableId"'});
export function microsoftMessagesUrl(query,limit,page){
 if(page&&query===null){const url=new URL(page);if(url.origin!=='https://graph.microsoft.com'||url.pathname!=='/v1.0/me/messages'||url.username||url.password)throw Error('Invalid Microsoft mail page. Reconnect the inbox.');return url.href;}
 const search=String(query||'').replace(/[^\p{L}\p{N}\s@.-]/gu,' ').trim().slice(0,100);
 const since=new Date(Date.now()-180*86400000).toISOString().slice(0,10);
 const words=search?search.split(/\s+/).map(w=>'"'+w+'"').join(' AND '):'(bill OR invoice OR statement OR payment OR autopay)';
 return graph+'/me/messages?'+new URLSearchParams({'$search':'"received>='+since+' AND '+words.replaceAll('"','\\"')+'"','$select':'id','$top':String(query===null?10:limit)});
}
export async function readMicrosoftEmail(request,headers,account,sourceId){
 if(!/^[A-Za-z0-9_+=\/-]{1,2048}$/.test(sourceId))throw Error('Invalid email identifier.');
 const msg=await request(graph+'/me/messages/'+encodeURIComponent(sourceId)+'?'+new URLSearchParams({'$select':'id,from,subject,body,receivedDateTime,isDraft'}),{headers});
 const sender=msg.from?.emailAddress||{},date=Date.parse(msg.receivedDateTime),skip=msg.isDraft||sender.address?.toLowerCase()===account.email?.toLowerCase();
 const text=messageText({mimeType:msg.body?.contentType?.toLowerCase()==='html'?'text/html':'text/plain',body:{data:Buffer.from(String(msg.body?.content||'').slice(0,100000)).toString('base64url')}}).slice(0,32000);
 // Graph honors the text preference. If HTML is returned, the existing parser
 // strips markup; raw bodies are never exposed to the browser or stored.
 return {id:account.id+':'+sourceId,mailboxId:account.id,from:(sender.name||'')+' <'+(sender.address||'')+'>',subject:skip?'':msg.subject||'',text:skip?'':text,receivedAt:new Date(Number.isFinite(date)?date:Date.now()).toISOString()};
}
