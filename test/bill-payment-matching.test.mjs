import test from 'node:test';
import assert from 'node:assert/strict';
import {inferredBillPaymentHistory} from '../public/bank-activity.mjs';
import {emailAccountStatus,emailLink,emailBillPaymentStatuses} from '../public/email-model.mjs';
import {matchedBillPayments,paymentLink} from '../public/transaction-links.mjs';
const now=Date.parse('2026-11-03T18:00:00Z'),today='2026-11-03';
const events=[{id:'rent',key:'rent:2026-11-01',name:'Rent',billKind:'rent',amount:80000,date:'2026-11-01',repeat:'monthly'},{id:'insurance',key:'insurance:2026-11-01',name:'Renters insurance',billKind:'insurance',amount:1800,date:'2026-11-01',repeat:'monthly'}];
const receipts=events.map(b=>({id:b.id,mailboxId:'mail',sender:b.id+'@example.com',subject:b.name+' payment receipt',paymentStatus:'pending',paymentStage:'submitted',paymentAmount:b.amount,receivedAt:'2026-10-31T14:00:00Z'}));
const emailLinks=Object.fromEntries(receipts.map(p=>['bill:'+p.id,emailLink(p)]));
const accounts=[{id:'plaid-checking',source:'plaid',type:'depository',currency:'USD',balance:150000,balanceUpdated:'2026-11-03T17:00:00Z'}];
const transactions=events.map(b=>({transaction_id:b.id,account_id:'checking',itemId:'bank',name:b.id==='rent'?'ACH SUN COMMUNITIES':'ASSURANT INSURANCE',amount:b.amount/100,date:'2026-11-02',currency:'USD',pending:false}));
const options={messages:receipts,emailLinks,accounts,now,today};
test('unlinked rent and renters insurance receipts reconcile to posted bank payments and refreshed balances',()=>{
 const inferred=inferredBillPaymentHistory(events,transactions,options);
 const statusForTarget=target=>emailAccountStatus(receipts,emailLinks[target],{now,creditCard:false,bankPayments:(inferred.get(target)||[]).map(t=>({...t,id:t.transaction_id,amount:Math.round(t.amount*100),balanceSnapshot:{...accounts[0],updated:accounts[0].balanceUpdated}})),destinations:target==='bill:rent'?[{id:'portal',balance:-100,currency:'USD',updated:'2026-11-03T17:30:00Z'}]:[]});
 const statuses=emailBillPaymentStatuses(events,receipts,emailLinks,{now,statusForTarget});assert.equal(statuses.length,2);assert.ok(statuses.every(p=>p.confirmed&&p.cashReflectedAmount===p.paidAmount));
 assert.deepEqual(matchedBillPayments(events,transactions,{},today,{historyForTarget:t=>inferred.get(t)||[]}).sort(),events.map(b=>b.key).sort());
});
test('pending, wrong amounts, unrelated merchants, missing bank accounts and ambiguous bills cannot auto-match',()=>{
 for(const patch of [{pending:true},{amount:1},{name:'GROCERY STORE'},{account_id:'missing'},{currency:'EUR'}])assert.equal(inferredBillPaymentHistory(events,transactions.map(t=>({...t,...patch})),options).size,0);
 const other={...events[0],id:'other',key:'other:2026-11-01'};
 const otherReceipt={...receipts[0],id:'other',sender:'other@example.com'};
 const ambiguous={...options,messages:[...receipts,otherReceipt],emailLinks:{...emailLinks,'bill:other':emailLink(otherReceipt)}};
 assert.equal(inferredBillPaymentHistory([...events,other],transactions,ambiguous).has('bill:rent'),false);
});
test('explicit assignments and failed receipts prevent fallback; repeat imports cannot pay twice',()=>{
 const links={'bill:other':paymentLink(transactions[0])};assert.equal(inferredBillPaymentHistory(events,transactions,{...options,links}).has('bill:rent'),false);
 const failed={...receipts[0],id:'failed',paymentStatus:'failed',paymentStage:'failed',receivedAt:'2026-11-03T14:00:00Z'};
 assert.equal(inferredBillPaymentHistory(events,transactions,{...options,messages:[...receipts,failed]}).has('bill:rent'),false);
 assert.equal(inferredBillPaymentHistory(events,[...transactions,transactions[0]],options).get('bill:rent').length,1);
});
test('without email a uniquely identified insurance bill can settle from the matching posted amount and cycle',()=>{
 const inferred=inferredBillPaymentHistory(events,transactions,{...options,messages:[],emailLinks:{}});assert.equal(inferred.get('bill:insurance').length,1);
 assert.equal(inferredBillPaymentHistory(events,transactions.map(t=>({...t,date:'2026-09-01'})),{...options,emailLinks:{}}).size,0);
 const statement={...receipts[1],paymentStatus:null,paymentAmount:null,paymentStage:null,amount:1800,dueDate:'2026-11-01'};
 assert.equal(inferredBillPaymentHistory(events,transactions,{...options,messages:[statement],emailLinks:{'bill:insurance':emailLink(statement)}}).get('bill:insurance').length,1);
});

test('a payment with an explicit billing date settles one weekly cycle even if the bank posts the following week',()=>{
 const earlier={...events[1],repeat:'weekly'},later={...earlier,date:'2026-11-08',key:'insurance:2026-11-08'};
 const receipt={...receipts[1],dueDate:earlier.date,paymentDate:earlier.date};
 const tx={...transactions[1],date:later.date},target='bill:insurance',links={[target]:emailLink(receipt)};
 const asOf=Date.parse('2026-11-09T18:00:00Z'),bankPayments=[{id:tx.transaction_id,date:tx.date,amount:earlier.amount,balanceSnapshot:{id:'checking',currency:'USD',balance:50000,updated:asOf}}];
 const cycles=emailBillPaymentStatuses([earlier,later],[receipt],links,{now:asOf,statusForTarget:()=>emailAccountStatus([receipt],links[target],{now:asOf,creditCard:false,bankPayments})});
 assert.equal(cycles.length,1);assert.equal(cycles[0].confirmed,true);
 const receiptCycles=new Map(cycles.flatMap(p=>p.bankPaymentIds.map(id=>[id,p.key])));
 assert.deepEqual(matchedBillPayments([earlier,later],[tx],{[target]:paymentLink(tx)},'2026-11-09',{receiptCycles}),[earlier.key]);
});
