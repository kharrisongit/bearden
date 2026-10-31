import {microsoftMailHeaders,microsoftMessagesUrl,readMicrosoftEmail} from './microsoft.mjs';
import {createHash} from 'node:crypto';
import {messageText,classifyElectricEmail} from './providers.mjs';
import {parseAccountEmail} from './email-parser.mjs';
const safeSenders=senders=>[...new Set((senders||[]).filter(s=>typeof s==='string'&&/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)))].slice(0,40);
export function mailboxWatches(classic,mailboxId){try{return safeSenders(Object.values(JSON.parse(classic?.state?.values?.['income-planner']||'{}').emailLinks||{}).filter(l=>l.mailboxId===mailboxId).map(l=>l.sender));}catch{return [];}}
export const mailQuery='newer_than:180d -in:sent {bill invoice statement payment "amount due" "payment due" "payment submitted" "payment scheduled" "payment processing" "payment received" "payment posted" "payment confirmation" "payment failed" autopay}';
export function mailboxes(c,owner=''){
 if(!Array.isArray(c.gmailAccounts))c.gmailAccounts=c.gmail?[{...c.gmail,id:'gmail-legacy',email:owner}]:[];
 c.gmail=c.gmailAccounts[0]||null;if(!Array.isArray(c.outlookAccounts))c.outlookAccounts=[];return [...c.gmailAccounts,...c.outlookAccounts];
}
export function connectMailbox(c,user,refreshToken,owner){
 mailboxes(c,owner);const accounts=c.gmailAccounts,email=user.email.toLowerCase();let account=accounts.find(a=>a.email===email);
 if(!account){if(accounts.length>=5)throw Error('Up to five Gmail accounts can be connected.');account={id:'gmail-'+createHash('sha256').update(user.sub||email).digest('hex').slice(0,20),email};accounts.push(account);}
 Object.assign(account,{refreshToken,nextSync:0,status:'Connected. Ready to check bills and payments.'});delete account.page;delete account.backlog;mailboxes(c,owner);return account;
}
export function connectMicrosoftMailbox(c,user,refreshToken,owner){
 mailboxes(c,owner);const accounts=c.outlookAccounts;let account=accounts.find(a=>a.microsoftId===user.id);
 if(!account){if(accounts.length>=5)throw Error('Up to five Hotmail / Outlook accounts can be connected.');account={id:'microsoft-'+createHash('sha256').update(user.id).digest('hex').slice(0,20),provider:'microsoft',microsoftId:user.id};accounts.push(account);}
 Object.assign(account,{email:user.email.toLowerCase(),refreshToken,nextSync:0,status:'Connected. Ready to check bills and payments.'});delete account.page;delete account.backlog;return account;
}
export function publicMail(c,owner){const accounts=mailboxes(c,owner),mailAccounts=accounts.map(({id,email,status,updated,provider})=>({id,email,status,updated,provider:provider||'google'}));return {gmail:!!c.gmailAccounts.length,emailConnected:!!accounts.length,mailAccounts,gmailAccounts:mailAccounts.filter(a=>a.provider==='google'),outlookAccounts:mailAccounts.filter(a=>a.provider==='microsoft'),gmailMessages:(c.gmailMessages||[]).filter(m=>accounts.some(a=>a.id===m.mailboxId)),electricStatus:accounts.find(a=>a.billStatus)?.billStatus,gmailUpdated:c.gmailUpdated};}
export function forgetMailbox(c,id,owner){const account=mailboxes(c,owner).find(a=>a.id===id);if(!account)throw Error('Email account not found.');c.gmailAccounts=c.gmailAccounts.filter(a=>a.id!==id);c.outlookAccounts=c.outlookAccounts.filter(a=>a.id!==id);c.gmailMessages=(c.gmailMessages||[]).filter(m=>m.mailboxId!==id);mailboxes(c,owner);return account;}
async function mailboxToken(account,{googleToken,microsoftToken}){
 const microsoft=account.provider==='microsoft',token=await (microsoft?microsoftToken:googleToken)({grant_type:'refresh_token',refresh_token:account.refreshToken});
 if(!token.access_token)throw Error('Inbox access expired. Reconnect this email account.');
 if(microsoft&&token.refresh_token)account.refreshToken=token.refresh_token;
 return microsoft?microsoftMailHeaders(token):{Authorization:'Bearer '+token.access_token};
}
async function readMailboxEmail(account,sourceId,{request,headers}){
 if(account.provider==='microsoft')return readMicrosoftEmail(request,headers,account,sourceId);
 if(!/^[A-Za-z0-9_-]{1,200}$/.test(sourceId))throw Error('Invalid email identifier.');
 const msg=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(sourceId)+'?format=full',{headers}),header=n=>msg.payload?.headers?.find(h=>h.name.toLowerCase()===n)?.value||'';
 const receivedAt=new Date(Number(msg.internalDate)||Date.parse(header('date'))||Date.now()).toISOString();
 return {id:account.id+':'+sourceId,mailboxId:account.id,from:header('from'),subject:header('subject'),text:messageText(msg.payload,{referenceDate:receivedAt}).slice(0,32000),receivedAt};
}
export async function scanMailbox(c,account,{request,googleToken,microsoftToken,query=null,limit=3,watches=[]}){
 account.lastSyncAttempt=Date.now();
 const headers=await mailboxToken(account,{googleToken,microsoftToken});
 if(account.signature!=='all-bills-v7'){account.signature='all-bills-v7';delete account.backlog;delete account.page;account.seen=[];}
 const senders=safeSenders(watches),seenIds=new Set(account.seen||[]),watchSignature=senders.slice().sort().join(',');
 if(account.watchSignature!==undefined&&account.watchSignature!==watchSignature){delete account.page;delete account.backlog;delete account.freshAttempt;}account.watchSignature=watchSignature;
 async function list(pageToken){
  const search=query===null?'':String(query).replace(/[^\p{L}\p{N}\s@.-]/gu,' ').trim().slice(0,100);
  const watchQuery=senders.length?mailQuery.replace(/}$/,senders.map(s=>' from:'+s).join('')+'}'):mailQuery;
  const q=new URLSearchParams({q:watchQuery+(search?' "'+search+'"':''),maxResults:String(query===null?10:limit)});
  if(query===null&&pageToken)q.set('pageToken',pageToken);
  const microsoft=account.provider==='microsoft',result=await request(microsoft?microsoftMessagesUrl(query,limit,pageToken,senders):'https://gmail.googleapis.com/gmail/v1/users/me/messages?'+q,{headers});
  return {ids:(microsoft?result.value||[]:result.messages||[]).map(m=>m.id),page:(microsoft?result['@odata.nextLink']:result.nextPageToken)||''};
 }
 // An older-message backlog must never delay newly arriving linked bills.
 if(query===null&&(account.backlog?.length||account.page)&&(!account.freshAttempt||Date.now()-account.freshAttempt>=6*3600000)){
  const fresh=await list(null);account.freshAttempt=Date.now();
  account.backlog=[...new Set([...fresh.ids.filter(id=>!seenIds.has(id)),...(account.backlog||[])])];
 }
 let queue;
 if(query!==null||!account.backlog?.length){
  const result=await list(query===null?account.page:null);queue=result.ids;
  if(query===null){account.backlog=queue;account.page=result.page;account.freshAttempt??=Date.now();}
 }else queue=account.backlog;
 const seen=new Set(account.seen||[]),electricBills=[];let processed=0;
 for(let i=0;i<limit&&queue.length;i++){
  const sourceId=queue[0],id=account.id+':'+sourceId;
  if(!seen.has(sourceId)||query!==null){
   const input=await readMailboxEmail(account,sourceId,{request,headers});
   const parsed=parseAccountEmail(input);if(parsed){c.gmailMessages=[...(c.gmailMessages||[]).filter(m=>m.id!==id),parsed].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)).slice(0,300);processed++;}
   const electric=parsed?.paymentStatus?{action:'ignore'}:classifyElectricEmail({...input,id:account.id+'-'+sourceId});
   if(electric.action==='add'){electricBills.push({...electric.bill,mailboxId:account.id,accountLast4:parsed?.accountLast4||''});account.billStatus='Consumers Energy bill updated.';}
   else if(electric.action==='review')account.billStatus='Electric bill found, but the amount or due date is unclear. Your estimate is still in use.';
   seen.add(sourceId);
  }
  queue.shift();
 }
 account.seen=[...seen].slice(-1000);account.updated=new Date().toISOString();c.gmailUpdated=account.updated;
 if(query===null)account.nextSync=account.backlog.length||account.page?0:Date.now()+6*3600000;
 account.status='Checked bills and payments'+(query!==null?'; '+processed+' matching email'+(processed===1?'':'s'):'')+'.';
 return electricBills;
}

// Re-read the exact selected message; a bounded background/search cache may still
// contain an older parser result for an email outside the most recent batch.
export async function refreshSelectedEmail(c,{mailboxId,id},{request,googleToken,microsoftToken,owner=''}){
 const account=mailboxes(c,owner).find(a=>a.id===mailboxId);
 if(!account||typeof id!=='string'||!id.startsWith(mailboxId+':'))throw Error('Choose an email from a connected account.');
 const sourceId=id.slice(mailboxId.length+1),headers=await mailboxToken(account,{googleToken,microsoftToken});
 const parsed=parseAccountEmail(await readMailboxEmail(account,sourceId,{request,headers}));
 if(!parsed)throw Error('This email has no readable bill or payment details.');
 c.gmailMessages=[...(c.gmailMessages||[]).filter(m=>m.id!==id),parsed].sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)).slice(0,300);
 return parsed;
}
