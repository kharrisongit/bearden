// Retire the old bank feeds within the current user's encrypted storage scope.
export const retiredBankAccount=a=>['plaid','simplefin'].includes(a?.source);
const retiredId=id=>typeof id==='string'&&/^(plaid|simplefin)-/.test(id);
export function cleanRetiredBankLinks(state,itemIds=[]){
 const text=state?.values?.['income-planner'];if(!text)return state;
 const planner=JSON.parse(text),before=JSON.stringify(planner),items=new Set(itemIds);
 for(const [debt,id]of Object.entries(planner.debtAccountLinks||{}))if(retiredId(id)){
  const backup=planner.debtBackupLinks?.[debt];
  if(typeof backup==='string'&&backup.startsWith('lunchflow-')){planner.debtAccountLinks[debt]=backup;delete planner.debtBackupLinks[debt];}
  else delete planner.debtAccountLinks[debt];
 }
 for(const key of ['debtBackupLinks','loanLinks'])for(const [target,id]of Object.entries(planner[key]||{}))if(retiredId(id))delete planner[key][target];
 for(const key of ['accountVisibility','hiddenConnectedAccounts','accountNames'])for(const id of Object.keys(planner[key]||{}))if(retiredId(id))delete planner[key][id];
 for(const key of ['personalAccountId','billsAccountId'])if(retiredId(planner.household?.[key]))planner.household[key]='';
 for(const [target,link]of Object.entries(planner.transactionLinks||{}))if(retiredId(link.accountId)||link.itemId==='simplefin'||items.has(link.itemId))delete planner.transactionLinks[target];
 // Keep manual bills, budget rules, debt amounts, due dates, and email links.
 if(JSON.stringify(planner)!==before)return {...state,values:{...state.values,'income-planner':JSON.stringify(planner)}};
 return state;
}
export async function retireLegacyBanks(read,write,removePlaid){
 const c=await read('connections',{items:[],transactions:[],candidates:[]});
 if(!c.bankProvidersRetired){
  const p=await read('plan',null),classic=await read('classic',null),oldAccounts=(p?.state?.accounts||[]).filter(retiredBankAccount),items=c.items||[];
  const itemIds=items.map(i=>i.id),oldTransaction=t=>['plaid','simplefin'].includes(t.source)||t.itemId==='simplefin'||itemIds.includes(t.itemId);
  if((oldAccounts.length||items.length||c.simplefin)&&!await read('retired-bank-data',null))await write('retired-bank-data',{accounts:oldAccounts,transactions:(c.transactions||[]).filter(oldTransaction),creditCards:c.creditCards||[],loanDetails:c.loanDetails||[],planner:classic?.state?.values?.['income-planner']||null});
  if(classic){const state=cleanRetiredBankLinks(classic.state,itemIds);if(state!==classic.state)await write('classic',{...classic,state,revision:classic.revision+1});}
  if(oldAccounts.length)await write('plan',{...p,state:{...p.state,accounts:p.state.accounts.filter(a=>!retiredBankAccount(a))},revision:p.revision+1});
  c.retiredBankItemIds=itemIds;c.pendingBankRemovals=items.filter(i=>i.token).map(i=>({id:i.id,token:i.token}));
  c.items=[];delete c.simplefin;c.creditCards=[];c.loanDetails=[];c.transactions=(c.transactions||[]).filter(t=>!oldTransaction(t));
  c.bankProvidersRetired=1;c.status=c.lunchflow?'Lunch Flow is your bank connection.':'Connect Lunch Flow in Settings.';
  await write('connections',c);
 }
 // Revocation only: these credentials can no longer fetch accounts or transactions.
 // Retry failures in later scheduled batches without blocking Lunch Flow.
 if(c.pendingBankRemovals?.length){
  const batch=c.pendingBankRemovals.slice(0,2),done=new Set();
  await Promise.all(batch.map(async item=>{try{await removePlaid('/item/remove',{access_token:item.token});done.add(item.id);}catch(error){if(['ITEM_NOT_FOUND','INVALID_ACCESS_TOKEN'].includes(error.code||error.message))done.add(item.id);}}));
  c.pendingBankRemovals=c.pendingBankRemovals.filter(i=>!done.has(i.id));if(!c.pendingBankRemovals.length)delete c.pendingBankRemovals;
  await write('connections',c);
 }
 return c;
}
