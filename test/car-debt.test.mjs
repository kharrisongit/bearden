import test from 'node:test';
import assert from 'node:assert/strict';
import {carPaymentLoans,combinedDebtForecast,carDebtPeriod} from '../public/car-debt.mjs';
import {billEvents,paycheckBillItems} from '../public/income-model.mjs';
const today='2026-10-26',bill={id:'car',name:'Car payment',billKind:'car-payment',amount:10000,date:'2026-11-12',repeat:'monthly',source:'manual'};
const planner={showCarPaymentsInDebt:true,manual:[bill],carLoanDetails:{car:{balance:25000,apr:0}}};
test('car payments are optional, use remaining principal, and cap the final payment',()=>{
 assert.deepEqual(carPaymentLoans([bill],{},[],today),[]);
 const [loan]=carPaymentLoans([bill],planner,[],today);
 assert.equal(loan.balance,25000);assert.equal(loan.payoffDate,'2027-01-12');assert.equal(loan.finalPayment,5000);assert.equal(loan.interest,0);
});
test('bank balances update the projection without replacing the scheduled payment or manually entered APR',()=>{
 const p={...planner,loanLinks:{car:'simplefin-auto'}};
 const [loan]=carPaymentLoans([bill],p,[{id:'simplefin-auto',type:'loan',balance:15000,currency:'USD',apr:12}],today);
 assert.equal(loan.balance,15000);assert.equal(loan.amount,10000);assert.equal(loan.apr,0);assert.equal(loan.payoffDate,'2026-12-12');
 assert.equal(carPaymentLoans([bill],p,[{id:'simplefin-auto',type:'loan',balance:0}],today)[0].balance,25000);
});
test('already tracked loan accounts and duplicate car bills do not inflate debt totals',()=>{
 assert.equal(carPaymentLoans([bill,bill],planner,[],today).length,1);
 assert.deepEqual(carPaymentLoans([bill],{...planner,loanLinks:{car:'a'},debtAccountLinks:{1:'a'}},[],today),[]);
 assert.equal(carPaymentLoans([bill,{...bill,id:'copy'}],{...planner,loanLinks:{car:'a',copy:'a'}},[],today).length,1);
});
test('APR is used for interest and paid bills are not subtracted again from a current balance',()=>{
 const b={...bill,date:'2026-10-26',amount:100000},p={...planner,paid:['car:2026-10-26'],carLoanDetails:{car:{balance:10000,apr:12}}};
 const [loan]=carPaymentLoans([b],p,[],today);
 assert.equal(loan.payoffDate,'2026-11-26');assert.equal(loan.interest,102);assert.equal(loan.finalPayment,10102);
});
test('missing balances or APRs and non-amortizing loans do not produce fictional payoff dates',()=>{
 for(const detail of [{apr:0},{balance:10000}]){
  const [loan]=carPaymentLoans([bill],{...planner,carLoanDetails:{car:detail}},[],today);
  assert.equal(loan.needsDetails,true);assert.equal(loan.payoffDate,null);assert.equal(loan.interest,null);
 }
 const [loan]=carPaymentLoans([{...bill,amount:1}],{...planner,carLoanDetails:{car:{balance:100000,apr:12}}},[],today);
 assert.equal(loan.needsDetails,false);assert.equal(loan.payoffDate,null);assert.equal(loan.interest,null);
});
test('combined payoff uses the later date and adds interest exactly once',()=>{
 const loans=carPaymentLoans([bill],planner,[],today),base={date:'2026-11-06',interest:10,hasDebt:true};
 assert.deepEqual(combinedDebtForecast(base,loans,today),{date:'2027-01-12',interest:10,needsCarDetails:false});
 assert.equal(combinedDebtForecast({...base,date:null},loans,today).date,null);
 assert.equal(combinedDebtForecast({...base,date:null,hasDebt:false},loans,today).date,'2027-01-12');
 assert.equal(combinedDebtForecast(base,[],today).date,'2026-11-06');
});
test('including the loan keeps one bill deduction, caps the final bill, then stops payments after payoff',()=>{
 const [loan]=carPaymentLoans([bill],planner,[],today),p={...planner,carDebtPayoffs:{car:loan}};
 const events=billEvents({bills:[]},p,{},today,'2027-03-01');
 assert.deepEqual(events.map(e=>[e.date,e.amount]),[['2026-11-12',10000],['2026-12-12',10000],['2027-01-12',5000]]);
 const data={legacy:{bills:[]},planner:p,linked:{},today,plan:{state:{startDate:'2026-11-06'}}};
 assert.equal(paycheckBillItems(data,'2026-11-06',1).reduce((sum,b)=>sum+b.amount,0),10000);
 assert.equal(paycheckBillItems({...data,planner},'2026-11-06',1).reduce((sum,b)=>sum+b.amount,0),10000);
 assert.equal(paycheckBillItems(data,'2027-01-01',5).reduce((sum,b)=>sum+b.amount,0),5000);
 assert.equal(paycheckBillItems(data,'2027-02-01',7).length,0);
});

test('paycheck debt summaries include car principal and interest without duplicating cash allocations',()=>{
 const loans=carPaymentLoans([bill],planner,[],today);
 assert.deepEqual(carDebtPeriod(loans,'2026-11-06','2026-11-19'),{balance:15000,reduction:10000,interest:0});
 assert.deepEqual(carDebtPeriod(loans,'2027-01-01','2027-01-14'),{balance:0,reduction:5000,interest:0});
 assert.deepEqual(carDebtPeriod([],'2026-11-06','2026-11-19'),{balance:0,reduction:0,interest:0});
});
