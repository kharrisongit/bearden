import {monthlyMinimum,monthlyPaymentSettings,validDueDate} from './debt-payments.mjs?v=credit-rules1';

const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const profiles=new Set(['generic','capital-one','credit-one','milestone','indigo','elga-card','affirm','daily-simple']);
const minimumProfiles=new Set(['saved','credit-one','milestone','elga-card','installment']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const number=(value,label,max=1e9)=>{
 if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>max)throw Error('Enter a valid '+label+'.');
 return Number(value);
};
const money=(value,label)=>Math.round(number(value,label)*100)/100;
const optionalMoney=(value,label)=>value===null||value===''?null:money(value,label);
const choice=(value,allowed,label)=>{if(!allowed.has(value))throw Error('Choose a valid '+label+'.');return value;};

export const MINIMUM_RULE_OPTIONS=[
 {id:'saved',label:'Saved monthly amount'},
 {id:'credit-one',label:'Credit One · 5%, rounded up, $30 minimum'},
 {id:'milestone',label:'Milestone · 5%, nearest dollar, $40 minimum'},
 {id:'elga-card',label:'ELGA card · 2%, $25 minimum'},
 {id:'installment',label:'Fixed loan installment'},
];

function interestRules(previous,patch){
 if(!object(patch))throw Error('Interest rules are unavailable.');
 const next={...(object(previous)?previous:{})};
 if(own(patch,'profileId'))next.profileId=choice(patch.profileId,profiles,'interest method');
 if(own(patch,'closingDay')){
  const value=patch.closingDay;
  if(value===null||value==='')next.closingDay=null;
  else{const day=number(value,'statement closing day',31);if(!Number.isInteger(day)||day<1)throw Error('Statement closing day must be from 1 to 31.');next.closingDay=day;}
 }
 if(own(patch,'grace'))next.grace=choice(patch.grace,new Set(['active','lost','unknown']),'grace status');
 if(own(patch,'graceThrough')){if(patch.graceThrough!==null&&patch.graceThrough!==''&&!validDueDate(patch.graceThrough))throw Error('Enter a valid grace-period end date.');next.graceThrough=patch.graceThrough||null;}
 if(own(patch,'balanceBasis'))next.balanceBasis=choice(patch.balanceBasis,new Set(['principal','scheduled-total','unknown']),'balance type');
 for(const [key,label]of [['financeChargeCap','remaining interest limit'],['knownUnpaidInterest','interest already in the balance'],['minimumInterest','minimum interest charge']])if(own(patch,key))next[key]=optionalMoney(patch[key],label);
 if(own(patch,'fixedFees')){
  if(!Array.isArray(patch.fixedFees)||patch.fixedFees.length>12)throw Error('Add no more than 12 scheduled fees.');
  next.fixedFees=patch.fixedFees.map(fee=>{
   if(!object(fee)||!validDueDate(fee.date))throw Error('Enter a date for each scheduled fee.');
   const amount=money(fee.amount,'fee amount');if(amount<=0)throw Error('Fee amounts must be greater than zero.');
   const name=String(fee.name||'Account fee').trim();if(!name||name.length>80)throw Error('Fee names must be from 1 to 80 characters.');
   return {date:fee.date,amount,repeat:choice(fee.repeat,new Set(['once','monthly','yearly']),'fee schedule'),name};
  });
 }
 return next;
}

/** Apply only account terms. Balances, identity, links and payment history never come from the patch. */
export function applyDebtTerms(card,patch){
 if(!object(card)||card.id===undefined||!object(patch))throw Error('Choose an existing debt account.');
 const next={...card};
 if(own(patch,'apr'))next.apr=number(patch.apr,'APR',100);
 if(own(patch,'monthlyMinimum')){
  const monthly=money(patch.monthlyMinimum,'monthly payment');
  Object.assign(next,monthlyPaymentSettings(card,monthly));
  if(monthly>0)next.lastPositiveMonthlyMinimum=monthly;
  else if(monthlyMinimum(card)>0)next.lastPositiveMonthlyMinimum=monthlyMinimum(card);
 }
 if(own(patch,'interestRules'))next.interestRules=interestRules(card.interestRules,patch.interestRules);
 if(own(patch,'minimumRules')){
  if(!object(patch.minimumRules))throw Error('Minimum payment rules are unavailable.');
  next.minimumRules={...(object(card.minimumRules)?card.minimumRules:{})};
  if(own(patch.minimumRules,'profileId'))next.minimumRules.profileId=choice(patch.minimumRules.profileId,minimumProfiles,'minimum payment method');
 }
 if(own(patch,'termsSource')){
  const source=patch.termsSource;
  if(!object(source)||!validDueDate(source.asOf))throw Error('Enter the date shown on the statement or agreement.');
  const label=String(source.label||'Reviewed statement').trim();
  if(!label||label.length>80)throw Error('Source names must be from 1 to 80 characters.');
  const statementDueDate=own(source,'statementDueDate')?source.statementDueDate||null:card.termsSource?.statementDueDate||null;
  if(statementDueDate!==null&&!validDueDate(statementDueDate))throw Error('Enter a valid statement payment due date.');
  const fields={...(card.termsSource?.fields||{})};
  // Updating one field must not make an older, untouched field look newly verified.
  if(card.termsSource&&!card.termsSource.fields)for(const key of ['apr','monthlyMinimum'])fields[key]={asOf:card.termsSource.asOf,label:card.termsSource.label};
  for(const key of ['apr','monthlyMinimum'])if(own(patch,key))fields[key]={asOf:source.asOf,label,...(key==='monthlyMinimum'&&statementDueDate?{statementDueDate}:{})};
  next.termsSource={asOf:source.asOf,label,...(statementDueDate?{statementDueDate}:{}),fields};
 }
 return next;
}

export function reviewedTermSource(card,key){
 const source=card?.termsSource,entry=source?.fields?source.fields[key]:source;
 return entry&&validDueDate(entry.asOf)?{asOf:entry.asOf,label:String(entry.label||'Reviewed statement')}:null;
}
