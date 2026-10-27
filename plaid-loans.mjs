// Explicit principal fields only: original principal and payment due are never balances.
const cents=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100))?Math.round(value*100):null;
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_:.\-]{1,180}$/.test(value)?value:null;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function normalizePlaidLoans(response,item,now=new Date().toISOString()){
 const details=new Map(['loan','line_of_credit','mortgage','student'].flatMap(kind=>(response.liabilities?.[kind]||[]).map(row=>[row.account_id,{kind,row}])));
 return (response.accounts||[]).filter(a=>a.type==='loan').map(a=>{
  const entry=details.get(a.account_id),d=entry?.row,principal=cents(d?.principal_balance)??(entry?.kind==='mortgage'?cents(d?.current_principal_balance):null);
  return {id:'plaid-'+a.account_id,itemId:item.id,principal,accountCurrent:cents(a.balances?.current),currency:a.balances?.iso_currency_code||null,detailsAvailable:!!d,updated:now,requestId:safeId(response.request_id)};
 });
}
export function applyPlaidLoanBalances(accounts,connections,item,now=Date.now()){
 return accounts.map(a=>{
  if(a.source!=='plaid'||a.itemId!==item.id||a.type!=='loan')return a;
  const loan=connections.loanDetails?.find(l=>l.id===a.id&&l.itemId===item.id);if(!loan)return a;
  const fresh=!loan.stale&&!item.liabilitiesError&&Date.parse(loan.updated)>now-48*3600000;
  const principal=loan.principal??loan.accountCurrent;
  const observation={...a,liabilityPrincipal:loan.principal,liabilityAccountCurrent:loan.accountCurrent,liabilityUpdated:loan.updated,liabilityRequestId:loan.requestId};
  const keepBalance=!a.balanceUnavailable&&a.balance>0&&(a.balanceSource!=='liabilities'||Date.parse(a.balanceUpdated)>Date.parse(loan.updated));
  if(!fresh||loan.currency!==a.currency||!(principal>0)||keepBalance)return observation;
  return {...observation,balance:principal,balanceUnavailable:false,zeroUnconfirmed:false,balanceSource:'liabilities',balanceUpdated:loan.updated,lastPositiveBalance:principal,lastPositiveBalanceUpdated:loan.updated,balanceWarning:'Using the principal reported by Plaid loan details. The general balance response was missing or unconfirmed.'};
 });
}
export async function diagnosePlaid(item,call,now=new Date().toISOString()){
 const response=await call('/item/get',{access_token:item.token}),data=response.item||{},status=response.status||data.status||{};
 const products=value=>(Array.isArray(value)?value:[]).filter(v=>typeof v==='string'&&/^[a-z_]{1,40}$/.test(v));
 const available=products(data.available_products),billed=products(data.billed_products),consented=products(data.consented_products);
 const diagnostic={checkedAt:now,itemId:item.id,institutionId:safeId(data.institution_id),errorCode:safeId(data.error?.error_code),availableProducts:available,billedProducts:billed,consentedProducts:consented,lastTransactionUpdate:timestamp(status.transactions?.last_successful_update),requestId:safeId(response.request_id),loanDetailsSupported:available.includes('liabilities')||billed.includes('liabilities')||consented.includes('liabilities')};
 item.diagnostics=diagnostic;return diagnostic;
}
