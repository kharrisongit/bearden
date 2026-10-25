import {normalizeCreditCards,cardPayments} from './public/credit-model.mjs';
export function creditLinkOptions(body,item){
 if(body.itemId&&!item)throw Error('Bank connection not found');
 if(item)return {access_token:item.token,additional_consented_products:['liabilities','transactions'],update:{account_selection_enabled:true}};
 return body.kind==='credit'?{products:['liabilities','transactions'],transactions:{days_requested:180},account_filters:{credit:{account_subtypes:['credit card','paypal']}}}:{products:['transactions'],transactions:{days_requested:180}};
}
export async function syncCredit(c,item,plaid,force=false){
 if(!item.liabilities||!force&&item.liabilitiesAttempt&&Date.now()-item.liabilitiesAttempt<(item.liabilitiesError?900000:86400000))return;
 item.liabilitiesAttempt=Date.now();
 try{
  const response=await plaid('/liabilities/get',{access_token:item.token}),cards=normalizeCreditCards(response,item,c.creditCards||[]);
  c.creditCards=[...(c.creditCards||[]).filter(card=>card.itemId!==item.id),...cards];
  item.liabilitiesUpdated=new Date().toISOString();item.liabilitiesStatus=cards.length?'Card details synced.':'No supported credit cards were returned. Check your account permissions in Plaid.';delete item.liabilitiesError;
 }catch(e){item.liabilitiesError=e.code||e.message;item.liabilitiesStatus='Card details need attention: '+(e.code||e.message)+'. Previous details are kept; retry or update card access in Settings.';}
}
export function publicCredit(c){return (c.creditCards||[]).map(card=>({...card,payments:cardPayments(card,c.transactions),stale:!!c.items.find(i=>i.id===card.itemId)?.liabilitiesError}));}
export const publicItem=i=>({id:i.id,name:i.name,liabilities:!!i.liabilities,liabilitiesStatus:i.liabilitiesStatus,liabilitiesUpdated:i.liabilitiesUpdated});
