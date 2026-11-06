import test from 'node:test';
import assert from 'node:assert/strict';
import {inferredBillPaymentHistory} from '../public/bank-activity.mjs';
import {emailLink} from '../public/email-model.mjs';
import {paymentLink} from '../public/transaction-links.mjs';
const target='debt:card',now=Date.parse('2026-02-12T18:00:00Z');
const receipt={id:'receipt',mailboxId:'box',sender:'alerts@capitalone.com',accountLast4:'1234',paymentStatus:'pending',paymentStage:'submitted',paymentAmount:4545,paymentDate:'2026-02-08',receivedAt:'2026-02-08T09:00:00Z'};
const transaction={transaction_id:'posted',account_id:'cash',itemId:'bank',currency:'USD',amount:45.45,date:'2026-02-10',name:'ACH CAP ONE MOBILE PYMT REF 5279'};
const link=paymentLink({...transaction,name:'CAPITAL ONE ONLINE PAYMENT'});
const options={now,today:'2026-02-12',accounts:['cash','other'].map(id=>({id:'plaid-'+id,type:'depository',currency:'USD'})),messages:[receipt],emailLinks:{[target]:emailLink(receipt)},links:{[target]:link}};
const history=(rows=[transaction],opts={})=>inferredBillPaymentHistory([],rows,{...options,...opts}).get(target)||[];
test('a receipt matches a changed ACH descriptor on the linked funding account without a scheduled minimum',()=>{
 assert.deepEqual(history(),[transaction]);assert.deepEqual(history([transaction,transaction]),[transaction]);
 for(const opts of [{links:{}},{links:{[target]:{...link,targetName:'Platinum'}}}])assert.deepEqual(history([transaction],opts),[transaction]);
 for(const changes of [{account_id:'other'},{itemId:'other'},{pending:true},{currency:'CAD'},{amount:40},{amount:-45.45},{date:'2026-01-08'},{name:'Credit One pmt'},{name:'Cap One Cafe'},{name:'CAP ONE RETURNED PAYMENT'},{name:'Capital One card ending in 4321 pymt'}])assert.deepEqual(history([{...transaction,...changes}]),[]);
});
test('failed or competing receipts, explicit restrictions, ambiguous rows and shared mappings stay unresolved',()=>{
 const second={...receipt,id:'second',accountLast4:'9999'};
 for(const opts of [{messages:[{...receipt,paymentStatus:'failed'}]},{links:{[target]:{...link,sharedMerchant:true}}},{links:{[target]:{...link,amount:55}}},{links:{[target]:link,'debt:other':link}},{messages:[receipt,{...receipt,id:'other'}]},{messages:[receipt,second],emailLinks:{...options.emailLinks,'credit:other':emailLink(second)}}])assert.deepEqual(history([transaction],opts),[],JSON.stringify(opts));
 assert.deepEqual(history([transaction,{...transaction,transaction_id:'another'}]),[]);
 assert.deepEqual(history([transaction,{...transaction,name:'CAPITAL ONE ONLINE PAYMENT',transaction_id:'explicit'}]),[]);
});
