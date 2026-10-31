import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAccountEmail} from '../email-parser.mjs';
import {mailboxes,connectMailbox,publicMail,forgetMailbox} from '../mailboxes.mjs';
import {emailLink,emailAccountStatus,emailBillUpdate} from '../public/email-model.mjs';
const mail=(changes={})=>parseAccountEmail({id:'g:1',mailboxId:'g',from:'Example Card <alerts@example.com>',subject:'Payment submitted',text:'Your payment of $100.00 is processing. Card ending in 1234. Confirmation number ABC123',receivedAt:'2026-10-25T12:00:00Z',...changes});
test('email parsing separates statement balance, minimum, due date and submitted payment',()=>{
 const m=mail({subject:'Your statement is ready',text:'Statement balance: $2,000.00 Minimum payment due: $35.00 Due date: 11/05/2026 Card ending in 1234. Your payment may be processed in two days.'});
 assert.equal(m.balance,200000);assert.equal(m.minimum,3500);assert.equal(m.dueDate,'2026-11-05');assert.equal(m.paymentStatus,null);assert.equal(m.accountLast4,'1234');
 const pending=mail();assert.equal(pending.paymentStatus,'pending');assert.equal(pending.paymentAmount,10000);assert.equal(pending.reference,'abc123');
});
test('ambiguous amounts and dates never silently override a bill',()=>{
 const m=mail({subject:'Your bill',text:'Amount due: $100.00 Total due: $200.00 Due date: 11/05/2026 Due date: 11/10/2026'});assert.equal(m.amount,null);assert.equal(m.dueDate,null);
 assert.equal(emailBillUpdate({id:'b',amount:12000,date:'2026-11-01'},[m],{'bill:b':emailLink(m)}).amount,12000);
});
test('manual bill email update preserves identity and recurrence without changing saved configuration',()=>{
 const bill={id:'power',name:'Home power',amount:10000,date:'2026-11-01',repeat:'monthly',source:'manual'},m=mail({subject:'Your bill',text:'Amount due: $125.50 Due date: 11/05/2026'});
 const result=emailBillUpdate(bill,[m],{'bill:power':emailLink(m)});assert.equal(result.amount,12550);assert.equal(result.date,'2026-11-05');assert.equal(result.repeat,'monthly');assert.equal(result.id,'power');assert.equal(bill.amount,10000);
});
test('no-Plaid payments remain pending for exactly 48 hours, then show estimated posting',()=>{
 const m=mail(),link=emailLink(m),received=Date.parse(m.receivedAt),state=now=>emailAccountStatus([m],link,{now});
 assert.equal(state(received+48*3600000-1).payments[0].status,'pending');assert.equal(state(received+48*3600000).payments[0].status,'posted');assert.equal(state(received+48*3600000).payments[0].estimated,true);assert.equal(state(received+48*3600000).pending,0);
});
test('a scheduled future payment starts the two-day estimate on its payment date',()=>{
 const m=mail({subject:'Payment scheduled',text:'Payment amount: $100.00 Scheduled for: November 10, 2026. Due date: November 5, 2026.'});assert.equal(m.paymentDate,'2026-11-10');
 assert.equal(emailAccountStatus([m],emailLink(m),{now:Date.parse('2026-11-11T23:59Z')}).payments[0].status,'pending');
 assert.equal(emailAccountStatus([m],emailLink(m),{now:Date.parse('2026-11-12T00:00Z')}).payments[0].estimated,true);
});
test('Plaid-linked payments never use the timer and wait for a matching posted payment',()=>{
 const m=mail(),link=emailLink(m),options={now:Date.parse('2026-10-29T12:00Z'),hasPlaid:true};
 for(const bankPayments of [[],[{id:'pending',pending:true,amount:10000,date:'2026-10-26'}],[{id:'old',amount:10000,date:'2026-10-20'}],[{id:'wrong',amount:5000,date:'2026-10-26'}]])assert.equal(emailAccountStatus([m],link,{...options,bankPayments}).payments[0].status,'pending');
 const paid=emailAccountStatus([m],link,{...options,bankPayments:[{id:'posted',amount:10000,date:'2026-10-26'}]}).payments[0];assert.equal(paid.status,'posted');assert.equal(paid.estimated,false);
});
test('completion or failure emails supersede submitted emails without duplicate payments',()=>{
 const pending=mail(),completed=mail({id:'g:2',subject:'Payment received',receivedAt:'2026-10-26T12:00:00Z'}),failed=mail({id:'g:3',subject:'Payment returned',receivedAt:'2026-10-27T12:00:00Z'}),link=emailLink(pending);
 let result=emailAccountStatus([pending,completed],link,{now:Date.parse('2026-10-26T14:00Z')});assert.equal(result.payments.length,1);assert.equal(result.payments[0].status,'posted');assert.equal(result.payments[0].estimated,false);
 result=emailAccountStatus([pending,completed,failed],link,{now:Date.parse('2026-11-01')});assert.equal(result.payments.length,1);assert.equal(result.payments[0].status,'failed');
});
test('mailbox and account masks separate two cards from the same sender',()=>{
 const first=mail(),second=mail({id:'g:2',text:'Your payment of $200.00 is processing. Card ending in 5678.'}),other={...first,id:'other:1',mailboxId:'other'};
 const result=emailAccountStatus([first,second,other],emailLink(first),{now:Date.parse('2026-10-25T13:00Z')});assert.equal(result.payments.length,1);assert.equal(result.pending,10000);
});
test('one bank transaction cannot settle two distinct submitted payments',()=>{
 const first=mail(),second=mail({id:'g:2',text:'Payment amount: $100.00 Card ending in 1234. Confirmation number DEF456',receivedAt:'2026-10-25T13:00:00Z'});
 const result=emailAccountStatus([first,second],emailLink(first),{now:Date.parse('2026-10-27'),hasPlaid:true,bankPayments:[{id:'p',amount:10000,date:'2026-10-26'}]});assert.equal(result.payments.filter(p=>p.status==='posted').length,1);assert.equal(result.pending,10000);
});
test('legacy Gmail migrates safely, reconnect keeps links, and disconnect removes only that mailbox',()=>{
 const c={gmail:{refreshToken:'private-original'},gmailMessages:[]};assert.equal(mailboxes(c,'owner@example.com')[0].email,'owner@example.com');
 const first=connectMailbox(c,{email:'owner@example.com'},'private-new','owner@example.com'),second=connectMailbox(c,{email:'bills@example.com',sub:'other'},'private-other','owner@example.com');assert.equal(first.id,'gmail-legacy');assert.equal(c.gmailAccounts.length,2);
 c.gmailMessages=[{id:'one',mailboxId:first.id},{id:'two',mailboxId:second.id}];const safe=JSON.stringify(publicMail(c,'owner@example.com'));assert.ok(!safe.includes('private'));assert.ok(!safe.includes('refreshToken'));
 forgetMailbox(c,second.id,'owner@example.com');assert.equal(c.gmailAccounts.length,1);assert.deepEqual(c.gmailMessages,[{id:'one',mailboxId:first.id}]);
});
test('future processing and unsuccessful payment notices are not mistaken for completed payments',()=>{
 for(const subject of ['Your payment will be processed','Your payment is being processed','Payment not yet received'])assert.equal(mail({subject}).paymentStatus,'pending');
 for(const subject of ['Your payment was not successful','Your payment could not be processed'])assert.equal(mail({subject}).paymentStatus,'failed');
 const invoice=mail({subject:'Invoice ready',text:'Amount due: $50.00 Due date: 11/05/2026. A receipt is sent when your payment is received.'});assert.equal(invoice.paymentStatus,null);
});
test('regular bills retain pending notices without a two-day timer; a bank payment records them immediately',()=>{
 const m=mail(),link=emailLink(m),now=Date.parse('2026-10-30');
 assert.equal(emailAccountStatus([m],link,{now,creditCard:false}).payments[0].status,'pending');
 const result=emailAccountStatus([m],link,{now,creditCard:false,hasPlaid:true,bankPayments:[{id:'bank',amount:10000,date:'2026-10-25'}]});assert.equal(result.payments.length,1);assert.equal(result.payments[0].status,'posted');assert.equal(result.payments[0].estimated,false);assert.equal(result.pending,0);
});
test('a completed receipt confirms payment even before Plaid posts the withdrawal',()=>{
 const pending=mail(),receipt=mail({id:'g:2',subject:'Payment received',receivedAt:'2026-10-29T12:00:00Z'}),link=emailLink(pending),options={now:Date.parse('2026-10-30'),hasPlaid:true};
 assert.equal(emailAccountStatus([pending,receipt],link,options).payments[0].status,'posted');
 const posted=emailAccountStatus([pending,receipt],link,{...options,bankPayments:[{id:'bank',amount:10000,date:'2026-10-26'}]}).payments[0];assert.equal(posted.status,'posted');assert.equal(posted.estimated,false);assert.equal(posted.estimated,false);
});
test('duplicate processing emails do not restart the no-Plaid two-day timer',()=>{
 const first=mail(),reminder=mail({id:'g:2',subject:'Payment processing',receivedAt:'2026-10-26T18:00:00Z'});
 const result=emailAccountStatus([first,reminder],emailLink(first),{now:Date.parse('2026-10-27T12:00:00Z')});assert.equal(result.payments.length,1);assert.equal(result.payments[0].status,'posted');assert.equal(result.payments[0].estimated,true);assert.equal(result.payments[0].postedDate,'2026-10-27');
});

test('selected electric bill replaces a bank estimate even with newer incomplete notices and survives a trimmed email cache',()=>{
 const selected=mail({id:'g:electric-october',from:'Consumers Energy <billing@consumersenergy.com>',subject:'Your October bill',receivedAt:'2026-10-20T12:00:00Z',text:'Bill amount: $187.42 Due October 30 Account ending in 4321'});
 const newer={...selected,id:'g:reminder',receivedAt:'2026-10-24T12:00:00Z',subject:'View your statement',amount:null,dueDate:null,balance:null,minimum:null};
 const bill={id:'tracked-power',source:'bank-tracked',name:'Home electric',amount:12000,date:'2026-10-28',repeat:'monthly'},link={...emailLink(selected),selectedAt:'2026-10-25T12:00:00Z'},links={'bill:tracked-power':link};
 assert.equal(selected.amount,18742);assert.equal(selected.dueDate,'2026-10-30');
 for(const messages of [[newer,selected],[newer],[]]){const updated=emailBillUpdate(bill,messages,links);assert.equal(updated.amount,18742);assert.equal(updated.date,'2026-10-30');assert.equal(updated.emailMessageId,selected.id);assert.equal(updated.id,bill.id);}
 const oldLink={mailboxId:link.mailboxId,sender:link.sender,accountLast4:link.accountLast4};assert.equal(emailBillUpdate(bill,[newer,selected],{'bill:tracked-power':oldLink}).amount,18742);
 assert.equal(bill.amount,12000);
});
test('selected bill remains authoritative until a later incoming complete bill, without mixing a different mailbox or account',async()=>{
 const {billStatement}=await import('../public/email-model.mjs');
 const selected=mail({id:'g:october',subject:'Your bill',receivedAt:'2026-10-20T12:00:00Z',text:'Amount due: $100 Due 10/30/26 Account ending in 1234'}),link={...emailLink(selected),selectedAt:'2026-10-25T12:00:00Z'},beforeSelection={...selected,id:'g:old-choice',amount:11100,receivedAt:'2026-10-23T12:00:00Z'},next={...selected,id:'g:november',amount:12500,dueDate:'2026-11-30',receivedAt:'2026-11-18T12:00:00Z'},oldCycle={...selected,id:'g:old-cycle',amount:8000,dueDate:'2026-09-30',receivedAt:'2026-11-20T12:00:00Z'};
 const now=Date.parse('2026-11-21T12:00:00Z');assert.equal(billStatement([beforeSelection,selected],link,{now}).id,selected.id);
 const others=[{...next,mailboxId:'other'},{...next,accountLast4:'5678'},oldCycle];assert.equal(billStatement([...others,selected],link,{now}).id,selected.id);assert.equal(billStatement([next,...others,selected],link,{now}).id,next.id);
});
test('email-confirmed amounts override bank estimates in the calendar and forecast without duplicating the bill',async()=>{
 const {billEvents,cashForecast}=await import('../public/income-model.mjs');
 const m=mail({subject:'Your bill',text:'Amount due: $187.42 Due date: October 30, 2026'}),bill={id:'power',name:'Home electric',source:'bank-tracked',billKind:'electric',amount:12000,date:'2026-10-28',repeat:'monthly'},link=emailLink(m),updated=emailBillUpdate(bill,[m],{'bill:power':link});
 const events=billEvents({bills:[updated]},{manual:[],paid:[],emailLinks:{'bill:power':link},electricBillId:'power'}, {}, '2026-10-25','2026-11-24');assert.equal(events.length,1);assert.equal(events[0].amount,18742);assert.equal(events[0].date,'2026-10-30');assert.equal(events[0].emailConfirmed,true);
 assert.equal(cashForecast([{balance:50000,include:true}],[],events,'2026-10-25').outgoing,18742);
 const next=billEvents({bills:[updated]},{manual:[],paid:[]},{},'2026-11-01','2026-11-30');assert.equal(next[0].emailConfirmed,false);
});

test('October 21 bill for $275 due October 29 replaces September bank amount and carries into November estimate',async()=>{
 const {billEvents}=await import('../public/income-model.mjs');
 const m=mail({subject:'Your Consumers Energy bill is ready',receivedAt:'2026-10-21T12:00:00Z',text:'Amount due: $275.00 Due date: 10/29/2026'});
 const bill={id:'electric',name:'Electric',source:'bank-tracked',amount:35300,date:'2026-10-29',repeat:'monthly'};
 const updated=emailBillUpdate(bill,[m],{'bill:electric':emailLink(m)});assert.equal(updated.amount,27500);assert.equal(updated.date,'2026-10-29');
 const november=billEvents({bills:[updated]},{manual:[]},{},'2026-11-01','2026-11-30');assert.equal(november.length,1);assert.equal(november[0].amount,27500);assert.equal(november[0].date,'2026-11-29');assert.equal(november[0].emailConfirmed,false);
});
test('an explicitly selected email with a readable amount updates the estimate without inventing its missing due date',()=>{
 const m=mail({subject:'Your electric bill',receivedAt:'2026-10-21T12:00:00Z',text:'Bill total is $275.00. Visit your account for the due date.'});
 const bill={id:'electric',amount:35300,date:'2026-11-03'},link=emailLink(m),old={...m,id:'older',receivedAt:'2026-10-10T12:00:00Z',amount:35300,dueDate:'2026-10-29'};
 const updated=emailBillUpdate(bill,[old,m],{'bill:electric':link});assert.equal(updated.amount,27500);assert.equal(updated.date,'2026-11-03');assert.equal(updated.emailConfirmed,false);assert.equal(updated.emailAmountConfirmed,true);
 assert.equal(emailBillUpdate(bill,[],{'bill:electric':link}).amount,27500);
});
test('selecting an email rereads its exact private mailbox message instead of reusing stale parsed cache',async()=>{
 const {refreshSelectedEmail}=await import('../mailboxes.mjs');const c={gmailAccounts:[{id:'mailbox',refreshToken:'private'}],gmailMessages:[{id:'mailbox:abc123',amount:null}]};let calls=0;
 const message=await refreshSelectedEmail(c,{mailboxId:'mailbox',id:'mailbox:abc123'},{googleToken:async()=>({access_token:'token'}),request:async url=>{calls++;assert.match(url,/messages\/abc123\?format=full$/);return {internalDate:String(Date.parse('2026-10-21T12:00:00Z')),payload:{headers:[{name:'From',value:'Consumers Energy <billing@consumersenergy.com>'},{name:'Subject',value:'Your bill is ready'}],mimeType:'text/plain',body:{data:Buffer.from('Amount due: $275.00 Due date: October 29th, 2026').toString('base64url')}}};}});
 assert.equal(calls,1);assert.equal(message.amount,27500);assert.equal(message.dueDate,'2026-10-29');assert.equal(c.gmailMessages.length,1);assert.equal(c.gmailMessages[0].amount,27500);
 await assert.rejects(refreshSelectedEmail(c,{mailboxId:'other',id:'other:abc123'},{googleToken:async()=>{throw Error('Must not access another mailbox');}}),/connected account/);
});


test('debt statements retain a fully read selected due date outside the mail cache, without requiring an amount',()=>{
 const m=mail({subject:'Loan statement ready',text:'Payment due date: November 15, 2026. Account ending in 1234.'}),link=emailLink(m),options={creditCard:false,debtAccount:true,now:Date.parse('2026-10-27')};
 assert.equal(m.amount,null);
 for(const messages of [[],[m],[{...m,dueDate:null}]])assert.equal(emailAccountStatus(messages,link,options).statement.dueDate,'2026-11-15');
 const next={...m,id:'next',receivedAt:'2026-10-26T12:00:00Z',dueDate:'2026-11-20'};assert.equal(emailAccountStatus([next],link,options).statement.dueDate,'2026-11-20');
 assert.equal(emailAccountStatus([{...next,accountLast4:'5678'}],link,options).statement.dueDate,'2026-11-15');
});
test('payment receipts and invalid dates never autofill a debt due date',async()=>{
 const {emailDueDate}=await import('../public/email-model.mjs');
 assert.equal(emailDueDate({dueDate:'2026-11-15',paymentStatus:'posted'}),null);
 assert.equal(emailDueDate({dueDate:'2026-02-30'}),null);assert.equal(emailDueDate({dueDate:'2026-11-15'}),'2026-11-15');
 const m=mail({text:'Payment amount: $50.00 Due date: November 15, 2026.'});assert.equal(emailAccountStatus([],emailLink(m),{debtAccount:true,now:Date.parse('2026-10-27')}).statement,undefined);
});
