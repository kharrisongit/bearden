// SimpleFIN remains retired. Plaid and Lunch Flow are active bank providers.
export const retiredBankAccount=a=>a?.source==='simplefin';
const retiredId=id=>typeof id==='string'&&id.startsWith('simplefin-');
export function cleanRetiredBankLinks(state){
 const text=state?.values?.['income-planner'];if(!text)return state;
 const planner=JSON.parse(text),before=JSON.stringify(planner);
 for(const [debt,id]of Object.entries(planner.debtAccountLinks||{}))if(retiredId(id)){
  const backup=planner.debtBackupLinks?.[debt];
  if(typeof backup==='string'&&/^(plaid|lunchflow)-/.test(backup)){planner.debtAccountLinks[debt]=backup;delete planner.debtBackupLinks[debt];}
  else delete planner.debtAccountLinks[debt];
 }
 for(const key of ['debtBackupLinks','loanLinks'])for(const [target,id]of Object.entries(planner[key]||{}))if(retiredId(id))delete planner[key][target];
 for(const key of ['accountVisibility','hiddenConnectedAccounts','accountNames'])for(const id of Object.keys(planner[key]||{}))if(retiredId(id))delete planner[key][id];
 for(const key of ['personalAccountId','billsAccountId'])if(retiredId(planner.household?.[key]))planner.household[key]='';
 for(const [target,link]of Object.entries(planner.transactionLinks||{}))if(retiredId(link.accountId)||link.itemId==='simplefin')delete planner.transactionLinks[target];
 if(JSON.stringify(planner)!==before)return {...state,values:{...state.values,'income-planner':JSON.stringify(planner)}};
 return state;
}
export async function retireLegacyBanks(read,write,removePlaid){
 const c=await read('connections',{items:[],transactions:[],candidates:[]});
 if(!c.simplefinRetired){
  const p=await read('plan',null),classic=await read('classic',null),oldAccounts=(p?.state?.accounts||[]).filter(retiredBankAccount);
  const oldTransaction=t=>t.source==='simplefin'||t.itemId==='simplefin';
  if((oldAccounts.length||c.simplefin)&&!await read('retired-simplefin-data',null))await write('retired-simplefin-data',{accounts:oldAccounts,transactions:(c.transactions||[]).filter(oldTransaction),planner:classic?.state?.values?.['income-planner']||null});
  if(classic){const state=cleanRetiredBankLinks(classic.state);if(state!==classic.state)await write('classic',{...classic,state,revision:classic.revision+1});}
  if(oldAccounts.length)await write('plan',{...p,state:{...p.state,accounts:p.state.accounts.filter(a=>!retiredBankAccount(a))},revision:p.revision+1});
  delete c.simplefin;c.transactions=(c.transactions||[]).filter(t=>!oldTransaction(t));c.simplefinRetired=1;
  await write('connections',c);
 }
 // Finish only revocations queued by the earlier retirement. Never revoke a
 // currently connected Item, and never restore previously revoked credentials.
 if(c.pendingBankRemovals?.length){
  const active=c.items||[];
  c.pendingBankRemovals=c.pendingBankRemovals.filter(old=>!active.some(item=>item.id===old.id||item.token===old.token));
  const batch=c.pendingBankRemovals.slice(0,2),done=new Set();
  await Promise.all(batch.map(async item=>{try{await removePlaid('/item/remove',{access_token:item.token});done.add(item.id);}catch(error){if(['ITEM_NOT_FOUND','INVALID_ACCESS_TOKEN'].includes(error.code||error.message))done.add(item.id);}}));
  c.pendingBankRemovals=c.pendingBankRemovals.filter(i=>!done.has(i.id));if(!c.pendingBankRemovals.length)delete c.pendingBankRemovals;
  await write('connections',c);
 }
 return c;
}
