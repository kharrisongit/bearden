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
test('regular bills never show pending or use a two-day timer; a bank payment records them immediately',()=>{
 const m=mail(),link=emailLink(m),now=Date.parse('2026-10-30');
 assert.equal(emailAccountStatus([m],link,{now,creditCard:false}).payments.length,0);
 const result=emailAccountStatus([m],link,{now,creditCard:false,hasPlaid:true,bankPayments:[{id:'bank',amount:10000,date:'2026-10-25'}]});assert.equal(result.payments.length,1);assert.equal(result.payments[0].status,'posted');assert.equal(result.payments[0].estimated,false);assert.equal(result.pending,0);
});
test('with Plaid, even an email receipt waits for posted bank activity and keeps the original submission date',()=>{
 const pending=mail(),receipt=mail({id:'g:2',subject:'Payment received',receivedAt:'2026-10-29T12:00:00Z'}),link=emailLink(pending),options={now:Date.parse('2026-10-30'),hasPlaid:true};
 assert.equal(emailAccountStatus([pending,receipt],link,options).payments[0].status,'pending');
 const posted=emailAccountStatus([pending,receipt],link,{...options,bankPayments:[{id:'bank',amount:10000,date:'2026-10-26'}]}).payments[0];assert.equal(posted.status,'posted');assert.equal(posted.postedDate,'2026-10-26');assert.equal(posted.estimated,false);
});
test('duplicate processing emails do not restart the no-Plaid two-day timer',()=>{
 const first=mail(),reminder=mail({id:'g:2',subject:'Payment processing',receivedAt:'2026-10-26T18:00:00Z'});
 const result=emailAccountStatus([first,reminder],emailLink(first),{now:Date.parse('2026-10-27T12:00:00Z')});assert.equal(result.payments.length,1);assert.equal(result.payments[0].status,'posted');assert.equal(result.payments[0].estimated,true);assert.equal(result.payments[0].postedDate,'2026-10-27');
});
