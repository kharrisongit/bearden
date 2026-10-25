import {day,occurrences} from './engine.mjs';
export const householdEnabled=h=>!!(h?.enabled&&h.personalAccountId&&h.billsAccountId&&h.personalAccountId!==h.billsAccountId);
export const isSharedBillCandidate=bill=>!['budget','baby-bear-budget','tracker-debt','plaid-credit'].includes(bill.source)&&!['credit-card','loan'].includes(bill.billKind)&&bill.kind!=='household-bills'&&!bill.transfer&&bill.id!=='household-contribution'&&!/^fixed\s+bills$/i.test(String(bill.name||'').trim());
export function householdBillChoices(bills){return [...new Map(bills.filter(isSharedBillCandidate).map(b=>[b.id,b])).values()];}
export function sharedBill(bill,planner){
 if(!householdEnabled(planner.household)||!isSharedBillCandidate(bill))return false;
 const choice=planner.billFunding?.[bill.id];if(choice)return choice==='shared';
 let account=planner.transactionLinks?.['bill:'+bill.id]?.accountId;
 if(!account&&bill.groupKey){try{account=JSON.parse(bill.groupKey)[1];}catch{}}
 return !!account&&'plaid-'+account===planner.household.billsAccountId;
}
export function spouseEvents(h,start,end){
 if(!householdEnabled(h)||!h.spouseStartDate||!(h.spouseAmount>0))return [];
 return occurrences(h.spouseStartDate,h.spouseRepeat||'biweekly',start,end).map(date=>({id:'spouse:'+date,date,name:'Spouse contribution',amount:h.spouseAmount,type:'contribution'}));
}
export function householdForecast(accounts,plan,paydays,bills,start,{household:h,scope='personal',length=30,transactions=[]}={}){
 const end=day(start,length),view=['personal','shared','combined'].includes(scope)?scope:'personal';
 const ids=view==='combined'?[h.personalAccountId,h.billsAccountId]:[view==='shared'?h.billsAccountId:h.personalAccountId];
 const selected=ids.map(id=>accounts.find(a=>a.id===id&&(a.currency||'USD')==='USD'&&!['credit','loan'].includes(a.type)));
 const opening=selected.every(Boolean)?selected.reduce((sum,a)=>sum+a.balance,0):null,events=[];
 if(view!=='shared')for(const p of paydays)events.push({...p,delta:p.amount-p.allocations,incoming:p.amount,outgoing:p.allocations});
 // Checked checks have already been received; their transfers are in the bank balance.
 const ownDates=plan.state?.startDate?occurrences(plan.state.startDate,'biweekly',start,end):[];
 const transfers=ownDates.filter(date=>!plan.state.checkedPaychecks?.[Math.round((Date.parse(date)-Date.parse(plan.state.startDate))/86400000/14)+1]).map(date=>({id:'own-transfer:'+date,date,name:'Fixed Bills transfer',amount:h.personalAmount,type:'transfer'}));
 const contributions=spouseEvents(h,start,end);
 // Scheduled contributions are projections, not inferred income. A posted pair
 // from the two selected accounts can confirm your own transfer. A spouse's
 // equal-sized credit alone cannot safely identify who sent it.
 const used=new Set();
 for(const event of [...transfers,...contributions].sort((a,b)=>a.date.localeCompare(b.date))){
  const own=event.type==='transfer';if(!own&&view==='personal')continue;
  const eligible=t=>!used.has(t.transaction_id)&&!t.pending&&t.currency==='USD'&&t.date===event.date&&t.date<=start;
  const credit=own&&transactions.find(t=>eligible(t)&&'plaid-'+t.account_id===h.billsAccountId&&Math.round(-t.amount*100)===event.amount&&/TRANSFER_IN/.test(t.category||''));
  const debit=credit&&transactions.find(t=>eligible(t)&&'plaid-'+t.account_id===h.personalAccountId&&Math.round(t.amount*100)===event.amount&&/TRANSFER_OUT/.test(t.category||''));
  const bankMatched=!!debit;if(debit){used.add(credit.transaction_id);used.add(debit.transaction_id);}
  if(h.received?.[event.id]||bankMatched){events.push({...event,delta:0,incoming:0,outgoing:0,received:true,bankMatched});continue;}
  const delta=own?(view==='combined'?0:view==='shared'?event.amount:-event.amount):event.amount;
  events.push({...event,delta,incoming:delta>0?delta:0,outgoing:delta<0?-delta:0});
 }
 for(const b of bills)if(!b.covered&&b.date<=end&&(view==='combined'||(view==='shared')===!!b.shared))events.push({...b,date:b.date<start?start:b.date,delta:-b.amount,incoming:0,outgoing:b.amount});
 events.sort((a,b)=>a.date.localeCompare(b.date)||(a.type==='bill'?-1:1));
 let running=opening,low=opening,income=0,outgoing=0;
 const rows=events.map(e=>{income+=e.incoming;outgoing+=e.outgoing;if(running!==null){running+=e.delta;low=Math.min(low,running);}return {...e,balance:running};});
 return {opening,endBalance:running,low,income,outgoing,rows,end,scope:view};
}
