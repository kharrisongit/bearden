import {monthlyMinimum,validDueDate} from './debt-payments.mjs?v=connections-audit1';
const cents=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const rate=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100?n:null;
const timestamp=value=>Number.isFinite(Date.parse(value))?Date.parse(value):0;
const field=(value,source,updated=null,stale=false)=>({value,source,updated,stale});
export function purchaseAPR(card){
 const rows=(card?.aprs||[]).filter(a=>/purchase/i.test(a.type)),rates=[...new Set(rows.map(a=>rate(a.rate)).filter(n=>n!==null))];
 return rates.length===1?rates[0]:null;
}
// Only explicitly linked accounts are candidates. Similar names never join debts.
export function resolveDebtDetails({card,primary=null,backup=null,issuers=[],statement=null,items=[],manualLimit=null,automatic=true,now=Date.now()}={}){
 const notes=[],banks=[primary,backup].filter(Boolean),primaryId=primary?.id,manual={
  balance:Math.round((Number(card.balance)||0)*100),monthlyMinimum:Math.round(monthlyMinimum(card)*100),apr:rate(Number(card.apr))??0,dueDate:validDueDate(card.dueDate)?card.dueDate:null,creditLimit:cents(manualLimit)
 };
 const candidates={balance:[],monthlyMinimum:[],apr:[],dueDate:[],creditLimit:[]};
 const push=(key,value,source,updated,stale,rank)=>{if(value!==null&&value!==undefined)candidates[key].push({...field(value,source,updated,stale),rank,time:timestamp(updated)});};
 for(const [i,bank]of banks.entries()){
  if(bank.currency!=='USD')continue;
  const item=items.find(item=>item.id===bank.itemId),updated=bank.balanceUpdated||bank.balanceRetrieved||null;
  const stale=!!bank.balanceUnavailable||!!item?.balanceError||!timestamp(updated)||now-timestamp(updated)>48*3600000;
  const source=(bank.source==='simplefin'?'SimpleFIN':'Plaid')+(i?' backup':'');
  const value=cents(bank.balance);
  // ELGA and other institutions can return an unconfirmed zero during outages.
  const corroboratedZero=manual.balance===0||statement?.balance===0&&!statement.paymentStatus&&timestamp(statement.receivedAt)>now-62*86400000||banks.some(a=>a.id!==bank.id&&!a.balanceUnavailable&&a.balance===0&&a.currency==='USD'&&timestamp(a.balanceUpdated||a.balanceRetrieved)>now-48*3600000);
  if(value!==0||corroboratedZero)push('balance',value,source,updated,stale,stale?4:i?1:0);
  else notes.push(source+' reports zero; keeping another balance until payoff is confirmed.');
  push('creditLimit',cents(bank.creditLimit),source,updated,stale,stale?4:i?1:0);
 }
 const linkedIds=new Set(banks.map(a=>a.id));
 for(const issuer of issuers){
  if(issuer.currency!=='USD'||!linkedIds.has('plaid-'+issuer.accountId))continue;
  const item=items.find(i=>i.id===issuer.itemId),updated=issuer.updated||null;
  const stale=!!issuer.stale||!!item?.liabilitiesError||!timestamp(updated)||now-timestamp(updated)>48*3600000;
  const rank=stale?4:'plaid-'+issuer.accountId===primaryId?0:1;
  for(const [key,original,value]of [['monthlyMinimum','minimum',cents(issuer.minimum)],['dueDate','dueDate',validDueDate(issuer.dueDate)?issuer.dueDate:null],['apr','aprs',purchaseAPR(issuer)],['creditLimit','limit',cents(issuer.limit)]]){
   const at=issuer.fieldUpdated?.[original]||updated,old=stale||now-timestamp(at)>48*3600000;
   push(key,value,'Plaid statement',at,old,old?4:rank);
  }
  if(!banks.some(a=>a.id==='plaid-'+issuer.accountId&&cents(a.balance)!==null&&!a.balanceUnavailable))push('balance',cents(issuer.balance)>0?issuer.balance:null,'Plaid statement',updated,stale,stale?4:1);
 }
 if(statement&&!statement.paymentStatus&&timestamp(statement.receivedAt)<=now){
  const updated=statement.receivedAt,stale=!timestamp(updated)||now-timestamp(updated)>62*86400000;
  const values={balance:cents(statement.balance),monthlyMinimum:cents(statement.minimum)??(card.debtKind&&card.debtKind!=='credit-card'?cents(statement.amount):null),apr:rate(statement.apr),dueDate:validDueDate(statement.dueDate)?statement.dueDate:null,creditLimit:cents(statement.creditLimit)};
  for(const [key,value]of Object.entries(values)){
   // A newer statement can replace an older statement, but not a current bank balance.
   const original=key==='monthlyMinimum'?(statement.minimum!=null?'minimum':'amount'):key,at=statement.fieldUpdated?.[original]||updated,old=stale||now-timestamp(at)>62*86400000;
   const newer=key!=='balance'&&candidates[key].every(c=>timestamp(at)>c.time);
   push(key,value,'Email statement',at,old,old?5:newer?-1:2);
  }
 }
 const resolved={};
 for(const key of Object.keys(candidates)){
  const list=candidates[key].sort((a,b)=>a.rank-b.rank||b.time-a.time);
  resolved[key]=(automatic||key==='balance'||key==='creditLimit')&&list.length?list[0]:field(manual[key],'Entered manually');
  if(resolved[key].stale)notes.push(key==='balance'?'Using the last reported balance; refresh its connection.':'Some payment details use older saved information.');
 }
 return {...resolved,notes:[...new Set(notes)]};
}
export function resolveDebtConnections(planner,accounts,issuers,cards,statements={},items=[],now=Date.now()){
 return Object.fromEntries(cards.map(card=>{
  const mapped=issuers.find(c=>String(planner.creditCards?.[c.id]?.trackerCardId)===String(card.id));
  const primaryId=planner.debtAccountLinks?.[card.id]||(mapped?'plaid-'+mapped.accountId:null);
  const issuer=issuers.find(c=>'plaid-'+c.accountId===primaryId)||mapped;
  const primary=accounts.find(a=>a.id===primaryId)|| (issuer?{id:primaryId,source:'plaid',itemId:issuer.itemId,currency:issuer.currency,balance:issuer.balance,balanceUpdated:issuer.updated,balanceUnavailable:issuer.stale}:null);
  return [card.id,resolveDebtDetails({card,primary,backup:accounts.find(a=>a.id===planner.debtBackupLinks?.[card.id]),issuers,statement:statements[card.id],items,manualLimit:planner.debtCreditLimits?.[card.id],automatic:planner.debtAutoDetails?.[card.id]!==false,now})];
 }));
}
