import test from 'node:test';
import assert from 'node:assert/strict';
import {microsoftIdentity,googleIdentity} from '../user-scope.mjs';
import {microsoftAuthorization,microsoftMessagesUrl,requireMicrosoftMail,readMicrosoftEmail} from '../microsoft.mjs';
import {connectMailbox,connectMicrosoftMailbox,publicMail,forgetMailbox,scanMailbox,refreshSelectedEmail} from '../mailboxes.mjs';
const user={id:'ms-user',email:'person@hotmail.com'};
const email=(id='message=')=>({id,subject:'Your electric bill',from:{emailAddress:{name:'Consumers Energy',address:'billing@consumersenergy.com'}},receivedDateTime:'2026-10-25T12:00:00Z',body:{contentType:'html',content:'<p>Amount due: <b>$12.34</b></p><p>Due date: 11/01/2099</p>'}});

test('Microsoft identity is stable across email changes and never merges with owner or Google',()=>{
 const a=microsoftIdentity(user),b=microsoftIdentity({...user,email:'alias@outlook.com'});
 assert.equal(a.accountId,b.accountId);assert.notEqual(a.accountId,'owner');
 assert.notEqual(a.accountId,googleIdentity({sub:user.id,email:user.email,email_verified:true},'owner@example.com').accountId);
 assert.throws(()=>microsoftIdentity({email:user.email}),/missing/);
});
test('Microsoft login excludes mail permissions; mailbox consent is separate and read-only',()=>{
 const args={clientId:'client',origin:'https://bearden.example',state:'state',verifier:'verifier'};
 const login=new URL(microsoftAuthorization(args)),mail=new URL(microsoftAuthorization({...args,mail:true}));
 assert.match(login.pathname,/consumers/);assert.equal(login.searchParams.get('code_challenge_method'),'S256');
 assert.doesNotMatch(login.searchParams.get('scope'),/Mail\.|offline_access/);assert.match(mail.searchParams.get('scope'),/Mail.Read/);assert.match(mail.searchParams.get('scope'),/offline_access/);assert.doesNotMatch(mail.searchParams.get('scope'),/Write|Send/);
 assert.throws(()=>requireMicrosoftMail({refresh_token:'r',scope:'User.Read'}),/not granted/);
 assert.throws(()=>requireMicrosoftMail({scope:'Mail.Read'}),/not granted/);
 requireMicrosoftMail({refresh_token:'r',scope:'Mail.Read User.Read'});
});
test('Microsoft scans are bounded, rotate refresh tokens, parse HTML, and do not expose tokens or bodies',async()=>{
 const c={},a=connectMicrosoftMailbox(c,user,'old'),calls=[];
 connectMailbox(c,{email:'gmail@example.com',sub:'g'},'gmail-secret');
 const options={microsoftToken:async params=>{assert.equal(params.refresh_token,'old');return {access_token:'access-secret',refresh_token:'rotated-secret'};},request:async(url,opts)=>{calls.push(url);assert.equal(opts.headers.Authorization,'Bearer access-secret');assert.ok(!opts.method||opts.method==='GET');if(new URL(url).pathname.endsWith('/messages'))return {value:[{id:'one='},{id:'two='},{id:'three='},{id:'four='}], '@odata.nextLink':'https://graph.microsoft.com/v1.0/me/messages?$skiptoken=next'};return email();}};
 const bills=await scanMailbox(c,a,options);assert.equal(bills.length,3);assert.equal(bills[0].amount,1234);assert.equal(calls.length,4);assert.deepEqual(a.backlog,['four=']);assert.equal(a.refreshToken,'rotated-secret');assert.equal(c.gmailMessages[0].amount,1234);
 const pub=publicMail(c);assert.equal(pub.mailAccounts.length,2);assert.equal(pub.outlookAccounts[0].provider,'microsoft');assert.equal(pub.gmailAccounts.length,1);assert.equal(pub.emailConnected,true);assert.doesNotMatch(JSON.stringify(pub),/secret|refreshToken|<p>|Amount due/);
 const follow={...options,microsoftToken:async p=>{assert.equal(p.refresh_token,'rotated-secret');return {access_token:'access-secret'};}};
 await scanMailbox(c,a,follow);assert.equal(a.backlog.length,0);assert.equal(calls.length,5);
 const selected=await refreshSelectedEmail(c,{mailboxId:a.id,id:a.id+':one='},follow);assert.equal(selected.amount,1234);
 await assert.rejects(()=>refreshSelectedEmail({}, {mailboxId:a.id,id:a.id+':one='},follow),/connected account/);
 forgetMailbox(c,a.id);assert.equal(publicMail(c).outlookAccounts.length,0);assert.equal(publicMail(c).gmailAccounts.length,1);assert.equal(c.gmailMessages.length,0);
});
test('Microsoft pagination cannot forward credentials outside Graph messages and query input stays bounded',()=>{
 const next='https://graph.microsoft.com/v1.0/me/messages?$skiptoken=a%2Fb';assert.equal(microsoftMessagesUrl(null,3,next),next);
 for(const url of ['https://evil.example/v1.0/me/messages','https://graph.microsoft.com/v1.0/users/other/messages','http://graph.microsoft.com/v1.0/me/messages','https://user@graph.microsoft.com/v1.0/me/messages'])assert.throws(()=>microsoftMessagesUrl(null,3,url),/Invalid/);
 const url=new URL(microsoftMessagesUrl('Water " OR from:evil',4));assert.equal(url.searchParams.get('$top'),'4');assert.doesNotMatch(url.searchParams.get('$search'),/from:/);assert.match(url.searchParams.get('$search'),/received>=/);
});
test('drafts and mail from the connected address are not imported as received bills',async()=>{
 for(const msg of [{...email(),isDraft:true},{...email(),from:{emailAddress:{address:user.email}}}]){
  const input=await readMicrosoftEmail(async()=>msg,{}, {id:'inbox',email:user.email},'message=');assert.equal(input.text,'');assert.equal(input.subject,'');
 }
});
test('Microsoft reconnect preserves mailbox identity, Gmail, and existing parsed links',()=>{
 const c={},a=connectMicrosoftMailbox(c,user,'a');c.gmailMessages=[{id:a.id+':message',mailboxId:a.id}];
 const again=connectMicrosoftMailbox(c,{...user,email:'alias@outlook.com'},'b');assert.equal(again.id,a.id);assert.equal(c.outlookAccounts.length,1);assert.equal(c.gmailMessages.length,1);
});
