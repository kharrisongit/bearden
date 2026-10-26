// Share only the bill template. Provider links, balances, payments and profile
// settings never belong in an invitation or a recipient's imported bill.
const kinds=new Set(['electric','rent','utility','car-payment','insurance','phone-internet','subscription','other']);
const repeats=new Set(['once','weekly','biweekly','monthly']);
export function cleanSharedBill(bill){
 const name=typeof bill?.name==='string'?bill.name.trim():'';
 if(!name||name.length>100)throw Error('Each shared bill needs a name of up to 100 characters.');
 if(!Number.isSafeInteger(bill.amount)||bill.amount<0||bill.amount>100000000000)throw Error('Each shared bill needs a valid amount.');
 if(typeof bill.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(bill.date)||!Number.isFinite(Date.parse(bill.date+'T12:00:00Z'))||new Date(bill.date+'T12:00:00Z').toISOString().slice(0,10)!==bill.date)throw Error('Each shared bill needs a valid due date.');
 const repeat=bill.repeat||'once';if(!repeats.has(repeat))throw Error('Choose a supported bill schedule.');
 if(bill.billKind&& !kinds.has(bill.billKind))throw Error('Share recurring bills here, rather than credit cards or loan balances.');
 return {name,amount:bill.amount,date:bill.date,repeat,billKind:bill.billKind||'other'};
}
export function cleanSharedBills(bills){
 if(!Array.isArray(bills)||bills.length<1||bills.length>100)throw Error('Choose between 1 and 100 bills to share.');
 return bills.map(cleanSharedBill);
}
function sameBill(a,b){
 const name=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();
 if(name(a.name)!==name(b.name)||a.amount!==b.amount||(a.billKind||'other')!==b.billKind||(a.repeat||'once')!==b.repeat)return false;
 if(b.repeat==='monthly')return a.date?.slice(-2)===b.date.slice(-2);
 if(['weekly','biweekly'].includes(b.repeat))return (Date.parse(a.date)-Date.parse(b.date))%(86400000*(b.repeat==='weekly'?7:14))===0;
 return a.date===b.date;
}
export function previewSharedBills(planner,bundle,existing=[]){
 if(typeof bundle?.id!=='string'||!/^[a-f0-9]{64}$/.test(bundle.id))throw Error('Invalid bill share. Ask for a new code.');
 const bills=cleanSharedBills(bundle.bills),all=[...(planner.manual||[]),...existing],imported=planner.billShareImports?.[bundle.id]||{};
 return bills.map((bill,index)=>{const previous=all.find(b=>b.id===imported[index])||all.find(b=>sameBill(b,bill));return {...bill,index,existingId:previous?.id||null};});
}
export function importSharedBills(planner,bundle,selected,existing=[],newId=()=>crypto.randomUUID()){
 if(!Array.isArray(selected)||!selected.length||selected.length>100||selected.some(i=>!Number.isSafeInteger(i)||i<0||i>=bundle.bills?.length)||new Set(selected).size!==selected.length)throw Error('Choose the bills to add.');
 const next=structuredClone(planner),rows=previewSharedBills(next,bundle,existing),added=[],skipped=[];
 next.manual??=[];next.billFunding??={};next.covered??={};next.billShareImports??={};next.billShareImports[bundle.id]??={};
 for(const index of selected){
  const row=rows[index],duplicate=row.existingId||[...next.manual,...existing].find(b=>sameBill(b,row))?.id;
  if(duplicate){skipped.push(row.name);next.billShareImports[bundle.id][index]=duplicate;continue;}
  const id='manual-'+newId(),bill={id,...cleanSharedBill(row),source:'manual'};
  next.manual.push(bill);next.billFunding[id]='shared';next.covered[id]=false;next.billShareImports[bundle.id][index]=id;
  if(bill.billKind==='rent'){next.sunRentDisabled??={};next.sunRentDisabled[id]=true;}
  added.push(bill);
 }
 return {planner:next,added,skipped};
}
