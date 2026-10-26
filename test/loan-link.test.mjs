import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedBillLoan,isDebtPayment} from '../public/income-model.mjs';
test('car bills link separate live loan balances without replacing scheduled payments',()=>{
 const a={id:'a',billKind:'car-payment',amount:22256},b={id:'b',billKind:'car-payment',amount:30000};
 const planner={loanLinks:{a:'loan-a',b:'loan-b'}};
 const accounts=[{id:'loan-a',source:'plaid',type:'loan',name:'ELGA Auto 1',balance:1500000},{id:'loan-b',source:'plaid',type:'loan',name:'ELGA Auto 2',balance:800000}];
 assert.equal(linkedBillLoan(a,planner,accounts).balance,1500000);
 assert.equal(linkedBillLoan(b,planner,accounts).balance,800000);
 accounts[0].balance=1400000;assert.equal(linkedBillLoan(a,planner,accounts).balance,1400000);
 assert.equal(a.amount,22256);assert.equal(isDebtPayment(a),false);
 assert.deepEqual(linkedBillLoan(a,planner,[]),{id:'loan-a',unavailable:true});
 assert.equal(linkedBillLoan({...a,billKind:'electric'},planner,accounts),null);
 assert.equal(linkedBillLoan(a,{loanLinks:{}},accounts),null);
});
