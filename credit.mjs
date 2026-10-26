import {normalizeCreditCards,cardPayments} from './public/credit-model.mjs';
export function creditLinkOptions(body,item){
 if(body.itemId&&!item)throw Error('Bank connection not found');
 if(item&&body.kind==='bank')return {access_token:item.token,update:{account_selection_enabled:true}};
 if(item)return {access_token:item.token,additional_consented_products:['liabilities','transactions'],update:{account_selection_enabled:true}};
 return body.kind==='credit'?{products:['liabilities','transactions'],transactions:{days_requested:180},account_filters:{credit:{account_subtypes:['credit card','paypal']}}}:{products:['transactions'],transactions:{days_requested:180}};
}
export async function syncCredit(c,item,plaid,force=false){
 if(!item.liabilities||!force&&item.liabilitiesAttempt&&Date.now()-item.liabilitiesAttempt<(item.liabilitiesError?900000:86400000))return;
 item.liabilitiesAttempt=Date.now();
 try{
  const response=await plaid('/liabilities/get',{access_token:item.token}),cards=normalizeCreditCards(response,item,c.creditCards||[]);
  const previous=(c.creditCards||[]).filter(card=>card.itemId===item.id);
  for(const card of cards){const old=previous.find(c=>c.id===card.id);card.fieldUpdated={};for(const key of ['minimum','dueDate','aprs','limit','balance']){
   if(card[key]==null||key==='aprs'&&!card.aprs.length){if(old?.[key]!=null){card[key]=old[key];card.fieldUpdated[key]=old.fieldUpdated?.[key]||old.updated;}}
   else card.fieldUpdated[key]=card.updated;
  }}
  const missing=previous.filter(old=>!cards.some(c=>c.id===old.id)).map(old=>({...old,stale:true}));
  c.creditCards=[...(c.creditCards||[]).filter(card=>card.itemId!==item.id),...cards,...missing];
  item.liabilitiesUpdated=new Date().toISOString();item.liabilitiesStatus=cards.length?'Card details synced.':'No supported credit cards were returned. Check your account permissions in Plaid.';delete item.liabilitiesError;
 }catch(e){item.liabilitiesError=e.code||e.message;item.liabilitiesStatus='Card details need attention: '+(e.code||e.message)+'. Previous details are kept; retry or update card access in Settings.';}
}
export function publicCredit(c){return (c.creditCards||[]).map(card=>({...card,payments:cardPayments(card,c.transactions),stale:!!card.stale||!!c.items.find(i=>i.id===card.itemId)?.liabilitiesError}));}
export const publicItem=i=>({id:i.id,name:i.name,liabilities:!!i.liabilities,liabilitiesStatus:i.liabilitiesStatus,liabilitiesUpdated:i.liabilitiesUpdated,balanceAttempt:i.balanceAttempt,balancesUpdated:i.balancesUpdated,balanceWarning:i.balanceWarning,balanceError:i.balanceError,liabilitiesError:i.liabilitiesError,transactionsError:i.transactionsError,transactionsUpdated:i.transactionsUpdated});
