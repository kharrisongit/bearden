import test from 'node:test';import assert from 'node:assert/strict';import {classifyElectricEmail,classifyBillEmail,parseBill,messageText,transactionSync,applyTransactions} from '../providers.mjs';
test('extract explicit amount due and date',()=>{assert.deepEqual(parseBill('Amount due: $123.45 Due date: 11/05/2026'),{amount:12345,date:'2026-11-05'});assert.equal(parseBill('Payment due: November 5, 2026').date,'2026-11-05');});
test('ambiguous or unrelated bill fields require review',()=>{assert.deepEqual(parseBill('Last payment $90.00 Statement date 11/01/2026'),{amount:null,date:null});assert.equal(parseBill('Amount due: $100.00 Total due: $200.00').amount,null);assert.equal(parseBill('Due date: 02/30/2026').date,null);});
test('decodes nested MIME plain text in preference to HTML',()=>{assert.equal(messageText({parts:[{mimeType:'text/html',body:{data:Buffer.from('<b>wrong</b>').toString('base64url')}},{parts:[{mimeType:'text/plain',body:{data:Buffer.from('Amount due: $2.00').toString('base64url')}}]}]}),'Amount due: $2.00');});
test('sync retries entire pagination from original cursor on mutation',async()=>{const cursors=[];let i=0;const result=await transactionSync({token:'test',cursor:'old'},async(_,b)=>{cursors.push(b.cursor);i++;if(i===2){const e=Error('mutation');e.code='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION';throw e;}return {next_cursor:i===1?'page':'done',has_more:i===1,added:[],modified:[],removed:[]};});assert.deepEqual(cursors,['old','page','old']);assert.equal(result.cursor,'done');assert.equal(result.changes.length,1);});
test('pending replacement and modified transactions are idempotent',()=>{const existing=[{transaction_id:'pending',amount:10}];const updates=[{removed:[{transaction_id:'pending'}],added:[{transaction_id:'posted',amount:11,date:'2026-10-01',name:'Bill'}],modified:[]}];const once=applyTransactions(existing,updates,'bank');assert.equal(once.length,1);assert.equal(once[0].amount,11);assert.deepEqual(applyTransactions(once,updates,'bank'),once);});

test('automatic bill classification distinguishes receipts, unclear and past statements',()=>{
 const input={id:'one',from:'Utility <bill@example.com>',subject:'Monthly bill',text:'Amount due: $100.00 Due date: November 5, 2026',today:'2026-10-23'};
 assert.equal(classifyBillEmail(input).action,'add');
 assert.equal(classifyBillEmail({...input,subject:'Payment confirmation'}).action,'ignore');
 assert.equal(classifyBillEmail({...input,text:'Amount due: $0.00 Due date: November 5, 2026'}).action,'ignore');
 assert.equal(classifyBillEmail({...input,text:'Amount due: $100.00 Total due: $200.00 Due date: November 5, 2026'}).action,'review');
 assert.equal(classifyBillEmail({...input,today:'2026-12-01'}).action,'review');
 assert.equal(classifyBillEmail({...input,text:input.text+' Minimum payment $25.00'}).action,'review');
 assert.equal(classifyBillEmail({...input,subject:'Hello',text:'Lunch tomorrow?'}).action,'ignore');
});
test('whole dollar amounts and due-on labels are recognized',()=>{assert.deepEqual(parseBill('Payment amount: $125 Due on December 1, 2026'),{amount:12500,date:'2026-12-01'});});

test('electric-only scanning excludes unrelated bills and tags Consumers Energy',()=>{
 const input={id:'electric',from:'Consumers Energy <bill@consumersenergy.com>',subject:'Monthly bill',text:'Amount due: $111.25 Due date: November 5, 2026',today:'2026-10-25'};
 const result=classifyElectricEmail(input);assert.equal(result.action,'add');assert.equal(result.bill.name,'Consumers Energy');assert.equal(result.bill.billKind,'electric');
 assert.equal(classifyElectricEmail({...input,from:'Shopping <store@example.com>'}).action,'ignore');
});

test('utility due dates support short years and omitted years using the received email date',()=>{
 const options={referenceDate:'2026-10-20T12:00:00Z'};
 for(const date of ['Due: 10/30/26','Due October 30','Due date: Oct. 30','Payment due: 10/30'])assert.deepEqual(parseBill('Bill amount: $187.42 '+date,options),{amount:18742,date:'2026-10-30'});
 assert.equal(parseBill('Due January 5',{referenceDate:'2026-12-27T12:00:00Z'}).date,'2027-01-05');
 assert.equal(parseBill('Due December 30',{referenceDate:'2027-01-02T12:00:00Z'}).date,'2026-12-30');
 assert.equal(parseBill('Due October 30').date,null);assert.equal(parseBill('Due 02/30',options).date,null);
 assert.equal(parseBill('Due 10/30 Due 10/31',options).date,null);assert.equal(parseBill('Statement date 10/30 Last payment $187.42',options).date,null);
 assert.equal(parseBill('Bill amount: $187.42 Amount due: $200.00',options).amount,null);
});
test('HTML utility labels decode dollar and colon entities',()=>{
 const text=messageText({mimeType:'text/html',body:{data:Buffer.from('<p>Bill amount&colon; &dollar;187.42</p><p>Due date&colon; 10/30/2026</p>').toString('base64url')}});assert.deepEqual(parseBill(text),{amount:18742,date:'2026-10-30'});
});
