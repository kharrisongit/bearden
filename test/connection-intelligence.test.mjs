import test from 'node:test';import assert from 'node:assert/strict';
import {resolveDebtDetails,resolveDebtConnections,purchaseAPR} from '../public/connection-model.mjs';
import {emailAccountStatus,emailLink} from '../public/email-model.mjs';
import {mergeSimplefinTransactions,simplefinAccountId} from '../simplefin.mjs';
import {transactionAccountId,paymentLink,matchingPayments} from '../public/transaction-links.mjs';
import {parseAccountEmail} from '../email-parser.mjs';
import {scanMailbox,mailboxWatches} from '../mailboxes.mjs';
import {microsoftMessagesUrl} from '../microsoft.mjs';
import {syncCredit,publicCredit,publicItem} from '../credit.mjs';
const now=Date.now(),fresh=new Date(now-3600000).toISOString(),old=new Date(now-5*86400000).toISOString();
const card={id:1,balance:1000,monthlyMinimum:100,min:46.15,apr:20,dueDate:'2026-11-15',debtKind:'credit-card'};
const primary={id:'plaid-a',itemId:'p',source:'plaid',currency:'USD',balance:90000,balanceUpdated:fresh};
const backup={id:'simplefin-b',itemId:'simplefin',source:'simplefin',currency:'USD',balance:85000,balanceUpdated:fresh};
const issuer={id:'credit-a',accountId:'a',itemId:'p',currency:'USD',minimum:8000,dueDate:'2026-11-20',aprs:[{type:'purchase_apr',rate:18},{type:'cash_apr',rate:30}],updated:old};
const statement={receivedAt:fresh,balance:88000,minimum:9500,dueDate:'2026-11-25',apr:19,creditLimit:200000};
test('debt fields use valid primary, explicit backup, email, saved provider, then manual values',()=>{
 const args={card,primary,backup,issuers:[issuer],statement,now};let r=resolveDebtDetails(args);
 assert.equal(r.balance.value,90000);assert.equal(r.monthlyMinimum.value,9500);assert.equal(r.apr.value,19);assert.equal(r.dueDate.value,'2026-11-25');
 r=resolveDebtDetails({...args,items:[{id:'p',balanceError:'outage'}]});assert.equal(r.balance.value,85000);assert.equal(r.balance.source,'SimpleFIN backup');
 r=resolveDebtDetails({...args,primary:{...primary,balanceUnavailable:true},backup:{...backup,balanceUpdated:old}});assert.equal(r.balance.value,88000);
 r=resolveDebtDetails({card,primary:{...primary,balanceUnavailable:true},now});assert.equal(r.balance.value,90000);assert.equal(r.balance.stale,true);
 r=resolveDebtDetails({card,now});assert.equal(r.balance.value,100000);assert.equal(r.monthlyMinimum.value,10000);assert.equal(r.dueDate.source,'Entered manually');
});
test('zero balances need confirmation; non-USD and payment notices cannot replace debt terms',()=>{
 let r=resolveDebtDetails({card,primary:{...primary,balance:0},statement:{...statement,paymentStatus:'posted'},now});assert.equal(r.balance.value,100000);assert.equal(r.monthlyMinimum.value,10000);
 r=resolveDebtDetails({card,primary:{...primary,balance:0},statement:{...statement,balance:0},now});assert.equal(r.balance.value,0);
 r=resolveDebtDetails({card,primary:{...primary,currency:'EUR'},backup,now});assert.equal(r.balance.value,85000);
 assert.equal(purchaseAPR(issuer),18);assert.equal(purchaseAPR({aprs:[{type:'cash_apr',rate:30}]}),null);
});
test('automatic terms can be disabled while bank balances keep updating; loan statements supply monthly amount',()=>{
 let r=resolveDebtDetails({card,primary,statement,automatic:false,now});assert.equal(r.balance.value,90000);assert.equal(r.monthlyMinimum.value,10000);assert.equal(r.apr.value,20);assert.equal(r.dueDate.value,card.dueDate);
 r=resolveDebtDetails({card:{...card,debtKind:'loan'},statement:{receivedAt:fresh,amount:12345},now});assert.equal(r.monthlyMinimum.value,12345);
 r=resolveDebtDetails({card,statement:{receivedAt:fresh,amount:12345},now});assert.equal(r.monthlyMinimum.value,10000);
});
test('explicit issuer link works without a cached balance account and never matches by card name',()=>{
 const r=resolveDebtConnections({debtAccountLinks:{1:'plaid-a'}},[],[issuer],[card],{},[],now);assert.equal(r[1].monthlyMinimum.value,8000);
 assert.equal(resolveDebtConnections({},[],[issuer],[card],{},[],now)[1].monthlyMinimum.value,10000);
});
test('new same-cycle reminders retain missing dated statement fields without using the previous billing cycle',()=>{
 const first={id:'1',mailboxId:'m',sender:'bank@example.com',receivedAt:'2026-10-20T00:00:00Z',balance:50000,minimum:5000,dueDate:'2026-11-15'};
 const reminder={...first,id:'2',receivedAt:'2026-10-25T00:00:00Z',balance:49000,minimum:null,dueDate:null};
 let r=emailAccountStatus([first,reminder],emailLink(first),{now:Date.parse('2026-10-26')});assert.equal(r.statement.minimum,5000);assert.equal(r.statement.dueDate,'2026-11-15');assert.equal(r.statement.fieldUpdated.minimum,first.receivedAt);
 r=emailAccountStatus([first,{...reminder,dueDate:'2026-12-15'}],emailLink(first),{now:Date.parse('2026-10-26')});assert.equal(r.statement.minimum,null);
});
test('SimpleFIN posted transaction signs, corrections, duplicate IDs, errors and pending handling',()=>{
 const posted=Math.floor(now/1000)-86400,a={id:'a',conn_id:'bank',currency:'USD',transactions:[{id:'1',posted,amount:'-50.00',description:'Lender payment'},{id:'2',posted,amount:'10.00',description:'Refund'},{id:'3',posted:0,pending:true,amount:'-20.00',description:'Pending'}]},b={...a,id:'b',transactions:[a.transactions[0]]};
 let rows=mergeSimplefinTransactions([],{accounts:[a,b]},now);assert.equal(rows.length,3);assert.equal(rows.find(t=>t.name==='Refund').amount,-10);assert.equal(new Set(rows.map(t=>t.transaction_id)).size,3);
 const debit=rows.find(t=>t.account_id===simplefinAccountId(a)&&t.amount===50);assert.equal(transactionAccountId(debit),simplefinAccountId(a));
 const link=paymentLink(debit);assert.equal(matchingPayments(rows,link,new Date(now).toISOString().slice(0,10)).length,1);
 assert.deepEqual(mergeSimplefinTransactions(rows,{accounts:[a,b]},now),rows);
 const corrected={...a,transactions:[{...a.transactions[0],amount:'-60.00'}]};rows=mergeSimplefinTransactions(rows,{accounts:[corrected]},now);assert.equal(rows.filter(t=>t.account_id===simplefinAccountId(a)).length,1);assert.equal(rows.find(t=>t.account_id===simplefinAccountId(a)).amount,60);
 assert.deepEqual(mergeSimplefinTransactions(rows,{accounts:[{...a,transactions:[]}],errlist:[{code:'act.missingdata',account_id:'a'}]},now),rows);
 assert.equal(mergeSimplefinTransactions(rows,{accounts:[{...a,transactions:[]}]},now).length,1);
});
test('linked senders are mailbox-scoped and fresh mail gets scanned despite an older backlog',async()=>{
 const values={'income-planner':JSON.stringify({emailLinks:{a:{mailboxId:'m',sender:'bank@example.com'},b:{mailboxId:'other',sender:'other@example.com'},c:{mailboxId:'m',sender:'bad) OR any'}}})};
 assert.deepEqual(mailboxWatches({state:{values}},'m'),['bank@example.com']);
 assert.match(new URL(microsoftMessagesUrl(null,3,null,['bank@example.com','bad OR from:all'])).searchParams.get('$search'),/from:bank@example.com/);
 const account={id:'m',signature:'all-bills-v6',refreshToken:'r',backlog:['old'],page:'next',seen:[],freshAttempt:now-7*3600000},c={},calls=[];
 await scanMailbox(c,account,{watches:['bank@example.com'],limit:1,googleToken:async()=>({access_token:'t'}),request:async url=>{calls.push(url);if(url.includes('messages?')){assert.match(new URL(url).searchParams.get('q'),/from:bank@example.com/);return {messages:[{id:'new'}]};}return {internalDate:String(now),payload:{headers:[{name:'From',value:'bank@example.com'},{name:'Subject',value:'Payment due'}],mimeType:'text/plain',body:{data:Buffer.from('Minimum payment: $25.00 Due date: November 15, 2026.').toString('base64url')}}};}});
 assert.equal(c.gmailMessages[0].id,'m:new');assert.deepEqual(account.backlog,['old']);assert.equal(account.page,'next');assert.equal(calls.length,2);
});
test('clearly labelled email APR and credit limits are read and conflicting rates stay unknown',()=>{
 const input={id:'x',mailboxId:'m',from:'bank@example.com',subject:'Statement ready',receivedAt:fresh,text:'Credit limit: $2,000.00 Purchase APR: 19.99% Minimum payment: $25.00'};
 const m=parseAccountEmail(input);assert.equal(m.creditLimit,200000);assert.equal(m.apr,19.99);
 assert.equal(parseAccountEmail({...input,text:input.text+' Other APR: 29.99%'}).apr,null);
});
test('partial Plaid liabilities retain earlier fields with original timestamps',async()=>{
 const item={id:'p',name:'Bank',token:'t',liabilities:true},previous={...issuer,updated:old},c={items:[item],creditCards:[previous]};
 await syncCredit(c,item,async()=>({accounts:[{account_id:'a',type:'credit',name:'Card',balances:{current:800,iso_currency_code:'USD'}}],liabilities:{credit:[]}}),true);
 const saved=c.creditCards[0];assert.equal(saved.minimum,8000);assert.equal(saved.fieldUpdated.minimum,old);
 const r=resolveDebtDetails({card,primary,issuers:c.creditCards,now});assert.equal(r.monthlyMinimum.stale,true);
 await syncCredit(c,item,async()=>({accounts:[],liabilities:{credit:[]}}),true);assert.equal(c.creditCards.length,1);assert.equal(publicCredit(c)[0].stale,true);
});

test('loan checks expose attempts separately from successful observations',async()=>{
 const item={id:'p',name:'Bank',token:'private-access-token',liabilities:true},c={items:[item]};
 await syncCredit(c,item,async(path,body)=>{
  assert.equal(path,'/liabilities/get');assert.equal(body.access_token,item.token);
  return {request_id:'success-1',accounts:[{account_id:'auto',type:'loan',balances:{current:0,iso_currency_code:'USD'}}],liabilities:{loan:[{account_id:'auto',principal_balance:0}]}};
 },true);
 const success=publicItem(item);assert.ok(Number.isFinite(success.liabilitiesAttempt));assert.equal(success.liabilitiesUpdated,c.loanDetails[0].updated);assert.equal(success.liabilitiesRequestId,'success-1');assert.equal('token' in success,false);
 await syncCredit(c,item,async()=>{throw Object.assign(new Error('Unavailable'),{code:'INSTITUTION_DOWN',requestId:'failed-2'});},true);
 const failed=publicItem(item);assert.ok(failed.liabilitiesAttempt>=success.liabilitiesAttempt);assert.equal(failed.liabilitiesUpdated,success.liabilitiesUpdated);assert.equal(failed.liabilitiesError,'INSTITUTION_DOWN');assert.equal(failed.liabilitiesRequestId,'failed-2');assert.equal(c.loanDetails[0].principal,0);
});

test('an older email cannot replace a more recently reported balance or minimum during an outage',()=>{
 const olderMail={...statement,receivedAt:new Date(now-30*86400000).toISOString()},r=resolveDebtDetails({card,primary:{...primary,balanceUpdated:old},issuers:[issuer],statement:olderMail,now});
 assert.equal(r.balance.value,90000);assert.equal(r.balance.stale,true);assert.equal(r.monthlyMinimum.value,8000);assert.equal(r.monthlyMinimum.stale,true);
 const ancientIssuer={...issuer,updated:new Date(now-90*86400000).toISOString()},lessOldMail={...statement,receivedAt:new Date(now-70*86400000).toISOString()};
 assert.equal(resolveDebtDetails({card,primary,issuers:[ancientIssuer],statement:lessOldMail,now}).monthlyMinimum.value,9500);
});
