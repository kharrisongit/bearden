const targetKey=(kind,id)=>kind+':'+id;
const removeKeys=(object,keys)=>{if(object)for(const key of keys)delete object[key];};

export function removeBillFromPlanner(planner,id){
 const next=structuredClone(planner),target=targetKey('bill',id);
 next.manual=(next.manual||[]).filter(b=>b.id!==id);
 for(const [key,rule]of Object.entries(next.bankRules||{}))if(rule.id===id)delete next.bankRules[key];
 for(const field of ['estimates','covered','billFunding','loanLinks','carLoanDetails','sunRentDisabled'])removeKeys(next[field],[id]);
 removeKeys(next.transactionLinks,[target]);removeKeys(next.emailLinks,[target]);
 next.paid=(next.paid||[]).filter(key=>!key.startsWith(id+':'));
 if(next.sunRent?.billId===id)delete next.sunRent;
 if(next.electricBillId===id)delete next.electricBillId;
 for(const imported of Object.values(next.billShareImports||{}))for(const [key,value]of Object.entries(imported))if(value===id)delete imported[key];
 next.deletedBills={...next.deletedBills,[id]:true};
 return next;
}

export function removeDebtsFromPlanner(planner,ids,creditCards=[],creditIds=[]){
 let next=structuredClone(planner);const removed=new Set(ids.map(String)),accounts=new Set();
 for(const id of removed){
  for(const key of ['debtAccountLinks','debtBackupLinks'])if(next[key]?.[id])accounts.add(next[key][id]);
  for(const key of ['debtAccountLinks','debtBackupLinks','debtAutoDetails','debtCreditLimits','debtFutureMinimums'])removeKeys(next[key],[id]);
  removeKeys(next.transactionLinks,[targetKey('debt',id)]);removeKeys(next.emailLinks,[targetKey('debt',id)]);
 }
 const removedCredits=new Set(creditIds);
 for(const [id,preference]of Object.entries(next.creditCards||{}))if(removed.has(String(preference.trackerCardId)))removedCredits.add(id);
 for(const card of creditCards)if(accounts.has('plaid-'+card.accountId))removedCredits.add(card.id);
 for(const id of removedCredits){
  const replaced=next.creditCards?.[id]?.replaces;if(replaced)next=removeBillFromPlanner(next,replaced);
  const card=creditCards.find(c=>c.id===id);if(card)accounts.add('plaid-'+card.accountId);
  next.creditCards??={};next.creditCards[id]={...next.creditCards[id],tracking:false,trackerCardId:'',replaces:''};
  removeKeys(next.transactionLinks,[targetKey('credit',id)]);removeKeys(next.emailLinks,[targetKey('credit',id)]);
  next.paid=(next.paid||[]).filter(key=>!key.startsWith(id+':'));
 }
 next.hiddenConnectedAccounts={...next.hiddenConnectedAccounts};
 for(const id of accounts)next.hiddenConnectedAccounts[id]=true;
 return next;
}

export function removeDebtsFromState(state,ids){
 const next=structuredClone(state),removed=new Set(ids.map(String));
 next.cards=(next.cards||[]).filter(c=>!removed.has(String(c.id)));
 removeKeys(next.accountPaymentOverrides,removed);
 for(const field of ['paycheckSlices','paycheckSquashes','debtPaymentHistory','debtInterestHistory'])for(const [paycheck,entries]of Object.entries(next[field]||{})){
  removeKeys(entries,removed);if(!Object.keys(entries).length)delete next[field][paycheck];
 }
 for(const [paycheck,expenses]of Object.entries(next.extraExpenses||{})){
  next.extraExpenses[paycheck]=expenses.filter(e=>!removed.has(String(e.autoFromCardId)));
  if(!next.extraExpenses[paycheck].length)delete next.extraExpenses[paycheck];
 }
 return next;
}
