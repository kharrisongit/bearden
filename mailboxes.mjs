import {createHash} from 'node:crypto';
import {messageText,classifyElectricEmail} from './providers.mjs';
import {parseAccountEmail} from './email-parser.mjs';
export const mailQuery='newer_than:180d -in:sent {bill invoice statement payment "amount due" "payment due" "payment submitted" "payment scheduled" "payment processing" "payment received" "payment posted" "payment confirmation" "payment failed" autopay}';
export function mailboxes(c,owner=''){
 if(!Array.isArray(c.gmailAccounts))c.gmailAccounts=c.gmail?[{...c.gmail,id:'gmail-legacy',email:owner}]:[];
 c.gmail=c.gmailAccounts[0]||null;return c.gmailAccounts;
}
export function connectMailbox(c,user,refreshToken,owner){
 const accounts=mailboxes(c,owner),email=user.email.toLowerCase();let account=accounts.find(a=>a.email===email);
 if(!account){if(accounts.length>=5)throw Error('Up to five Gmail accounts can be connected.');account={id:'gmail-'+createHash('sha256').update(user.sub||email).digest('hex').slice(0,20),email};accounts.push(account);}
 Object.assign(account,{refreshToken,nextSync:0,status:'Connected. Ready to check bills and payments.'});delete account.page;delete account.backlog;mailboxes(c,owner);return account;
}
export function publicMail(c,owner){const accounts=mailboxes(c,owner);return {gmail:!!accounts.length,gmailAccounts:accounts.map(({id,email,status,updated})=>({id,email,status,updated})),gmailMessages:(c.gmailMessages||[]).filter(m=>accounts.some(a=>a.id===m.mailboxId)),electricStatus:accounts.find(a=>a.billStatus)?.billStatus,gmailUpdated:c.gmailUpdated};}
export function forgetMailbox(c,id,owner){const account=mailboxes(c,owner).find(a=>a.id===id);if(!account)throw Error('Gmail account not found.');c.gmailAccounts=c.gmailAccounts.filter(a=>a.id!==id);c.gmailMessages=(c.gmailMessages||[]).filter(m=>m.mailboxId!==id);mailboxes(c,owner);return account;}
export async function scanMailbox(c,account,{request,googleToken,query=null,limit=3}){
 account.lastSyncAttempt=Date.now();
 const token=await googleToken({grant_type:'refresh_token',refresh_token:account.refreshToken}),headers={Authorization:'Bearer '+token.access_token};
 if(account.signature!=='all-bills-v4'){account.signature='all-bills-v4';delete account.backlog;delete account.page;account.seen=[];}
 let queue;
 if(query!==null||!account.backlog?.length){
  const search=query===null?'':String(query).replace(/[^\p{L}\p{N}\s@.-]/gu,' ').trim().slice(0,100);
  const q=new URLSearchParams({q:mailQuery+(search?' "'+search+'"':''),maxResults:String(query===null?10:limit)});
  if(query===null&&account.page)q.set('pageToken',account.page);
  const page=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+q,{headers});queue=(page.messages||[]).map(m=>m.id);
  if(query===null){account.backlog=queue;account.page=page.nextPageToken||'';}
 }else queue=account.backlog;
 const seen=new Set(account.seen||[]),electricBills=[];let processed=0;
 for(let i=0;i<limit&&queue.length;i++){
  const sourceId=queue[0],id=account.id+':'+sourceId;
  if(!seen.has(sourceId)||query!==null){
   const msg=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(sourceId)+'?format=full',{headers}),header=n=>msg.payload?.headers?.find(h=>h.name.toLowerCase()===n)?.value||'';
   const input={id,mailboxId:account.id,from:header('from'),subject:header('subject'),text:messageText(msg.payload).slice(0,32000),receivedAt:new Date(Number(msg.internalDate)||Date.parse(header('date'))||Date.now()).toISOString()};
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
