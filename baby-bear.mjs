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

export function importBabyBear(state,date){
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||day(date)!==date)throw Error('Choose a valid first payment date');
 let added=0;const names=new Set(state.debts.map(d=>d.name.trim().toLowerCase()));
 for(const [i,debt] of babyBearDebts.entries()){
  const id='baby-bear-'+i;
  if(names.has(debt.name.toLowerCase())||state.debts.some(d=>d.id===id))continue;
  state.debts.push({...debt,id,date,minimumRepeat:'biweekly',source:'baby-bear'});names.add(debt.name.toLowerCase());added++;
 }
 validate(state);return {added,skipped:babyBearDebts.length-added};
}
