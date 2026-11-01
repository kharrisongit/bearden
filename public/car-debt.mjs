import {occurrences,monthly,day,cents} from './engine.mjs';
import {createInterestState,accrueInterest,applyInterestPayment} from './debt-interest.mjs';

// Car payments already reserve cash as bills. Project their remaining loan
// separately so including them in debt totals never deducts a second payment.
export function carPaymentLoans(bills,planner,accounts=[],today){
 if(!planner.showCarPaymentsInDebt)return [];
 const seenBills=new Set(),seenLoans=new Set([...Object.values(planner.debtAccountLinks||{}),...Object.values(planner.debtBackupLinks||{})]);
 return (bills||[]).flatMap(bill=>{
  if(bill.billKind!=='car-payment'||seenBills.has(bill.id))return [];
  seenBills.add(bill.id);
  const accountId=planner.loanLinks?.[bill.id];
  if(accountId&&seenLoans.has(accountId))return [];
  if(accountId)seenLoans.add(accountId);
  const account=accounts.find(a=>a.id===accountId&&a.type==='loan'),details=planner.carLoanDetails?.[bill.id]||{};
  const bankBalance=account&&!account.balanceUnavailable&&Number.isSafeInteger(account.balance)&&account.balance>0?account.balance:null;
  const balance=bankBalance??(Number.isSafeInteger(details.balance)&&details.balance>=0?details.balance:null);
  const apr=Number.isFinite(details.apr)?details.apr:Number.isFinite(account?.apr)?account.apr:null;
  const loan={id:bill.id,name:bill.name,balance,startingBalance:details.startingBalance??balance,currency:account?.currency||'USD',amount:bill.amount,date:bill.date,repeat:bill.repeat||'monthly',apr,accountId,asOf:today,payoffDate:null,interest:null,needsDetails:false,balances:[]};
  if(balance===0)return [{...loan,payoffDate:today,finalPayment:0,interest:0}];
  if(balance===null||apr===null||apr<0||apr>100||loan.currency!=='USD'||!(bill.amount>0)||!bill.date){loan.needsDetails=true;return [loan];}
  const interestCard={apr,interestRules:{...details.interestRules,profileId:'daily-simple',balanceBasis:'principal',grace:'lost'}};
  const interestState=createInterestState(interestCard,balance/100,today);
  let remaining=balance,reportedInterest=0;
  const paid=new Set(planner.paid||[]);
  for(const date of occurrences(bill.date,loan.repeat,today,monthly(today,360))){
   // A current bank balance already reflects posted/confirmed payments.
   if(paid.has(bill.id+':'+date))continue;
   // Unpaid interest stays separate from principal. A payment below accrued
   // interest must not make the next interval accrue interest on that interest.
   accrueInterest(interestState,interestCard,date);
   remaining=cents(interestState.balance);
   const cumulativeInterest=cents(interestState.totalInterest),accrued=cumulativeInterest-reportedInterest;
   reportedInterest=cumulativeInterest;
   const payment=Math.min(remaining,bill.amount);
   applyInterestPayment(interestState,payment===remaining?interestState.balance:payment/100);
   remaining=cents(interestState.balance);
   loan.balances.push({date,balance:remaining,interest:accrued});
   if(remaining<=0){loan.payoffDate=date;loan.finalPayment=payment;loan.interest=cumulativeInterest;break;}
   if(!Number.isSafeInteger(remaining))break;
  }
  return [loan];
 });
}

export function carDebtBalance(loans,date){
 if(loans.some(l=>l.balance===null||l.needsDetails||date<l.asOf))return null;
 return loans.reduce((sum,l)=>sum+(l.balances.filter(b=>b.date<=date).at(-1)?.balance??l.balance),0);
}

export function carDebtPeriod(loans,start,end){
 const balance=carDebtBalance(loans,end),opening=carDebtBalance(loans,day(start,-1));
 return {balance,reduction:balance!==null&&opening!==null?opening-balance:null,interest:balance===null?null:loans.reduce((sum,l)=>sum+l.balances.filter(b=>b.date>=start&&b.date<=end).reduce((sum,b)=>sum+b.interest,0),0)};
}

export function combinedDebtForecast(base,loans=[],today){
 if(!loans.length)return {...base,needsCarDetails:false};
 const needsCarDetails=loans.some(l=>l.needsDetails);
 const complete=(!base.hasDebt||base.date!==null)&&loans.every(l=>l.payoffDate!==null);
 return {
  date:complete?[base.hasDebt?base.date:today,...loans.map(l=>l.payoffDate)].sort().at(-1):null,
  interest:complete?base.interest+loans.reduce((sum,l)=>sum+l.interest/100,0):null,
  needsCarDetails,
 };
}
