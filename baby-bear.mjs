// Private server-only snapshot of BearBudgeter's Baby Bear preset. Never serve as an asset.
import {day,validate} from './public/engine.mjs';
export const babyBearDebts = [
  {
    "name": "Affirm",
    "balance": 60800,
    "apr": 35.89,
    "minimum": 5000,
    "rateAssumption": false
  },
  {
    "name": "Indigo",
    "balance": 25300,
    "apr": 29.9,
    "minimum": 4100,
    "rateAssumption": false
  },
  {
    "name": "Credit One",
    "balance": 17200,
    "apr": 28.74,
    "minimum": 335,
    "rateAssumption": false
  },
  {
    "name": "Elga Credit",
    "balance": 212400,
    "apr": 19.75,
    "minimum": 4100,
    "rateAssumption": false
  },
  {
    "name": "Elga Loan",
    "balance": 70500,
    "apr": 29,
    "minimum": 5000,
    "rateAssumption": true
  },
  {
    "name": "Milestone",
    "balance": 12200,
    "apr": 29,
    "minimum": 5000,
    "rateAssumption": false
  },
  {
    "name": "Credit One Platinum",
    "balance": 59700,
    "apr": 29,
    "minimum": 5000,
    "rateAssumption": false
  },
  {
    "name": "Cap One",
    "balance": 17200,
    "apr": 29,
    "minimum": 5000,
    "rateAssumption": false
  }
];

export const babyBearIncome={name:'Paycheck',hourlyRate:28.85,hoursPerCheck:80,gross:230800,amount:183371,repeat:'biweekly',estimated:true};
export const babyBearBudget=[{name:'Fixed bills',amount:72500},{name:'Medications',amount:30000},{name:'Food',amount:10000},{name:'Gas',amount:5000},{name:'Personal spending',amount:5000}];
export const babyBearPreset={debts:babyBearDebts,income:babyBearIncome,budgetItems:babyBearBudget};
export function importBabyBear(state,date,takeHome=babyBearIncome.amount){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||day(date)!==date)throw Error('Choose a valid first payment date');
 if(!Number.isSafeInteger(takeHome)||takeHome<=0||takeHome>1e12)throw Error('Enter a valid take-home paycheck amount');
 let incomeAdded=0,budgetAdded=0;
 let added=0;const names=new Set(state.debts.map(d=>d.name.trim().toLowerCase()));
 for(const [i,debt] of babyBearDebts.entries()){
  const id='baby-bear-'+i;
  if(names.has(debt.name.toLowerCase())||state.debts.some(d=>d.id===id))continue;
  state.debts.push({...debt,id,date,minimumRepeat:'biweekly',source:'baby-bear'});names.add(debt.name.toLowerCase());added++;
 }
 if(!state.income.length){state.income.push({...babyBearIncome,id:'baby-bear-income',date,amount:takeHome,estimated:takeHome===babyBearIncome.amount,source:'baby-bear'});incomeAdded=1;}
 const billNames=new Set(state.bills.map(b=>b.name.trim().toLowerCase()));
 for(const [i,item] of babyBearBudget.entries()){
  const id='baby-bear-budget-'+i;if(state.bills.some(b=>b.id===id)||billNames.has(item.name.toLowerCase()))continue;
  state.bills.push({...item,id,date,repeat:'biweekly',source:'baby-bear-budget'});billNames.add(item.name.toLowerCase());budgetAdded++;
 }
 validate(state);return {added,skipped:babyBearDebts.length-added,incomeAdded,budgetAdded,changed:added+incomeAdded+budgetAdded>0};
}
