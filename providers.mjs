import {cents,day} from './public/engine.mjs';
export async function request(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(25000)});let d;try{d=await r.json();}catch{throw Error('Provider returned an unreadable response');}if(!r.ok){const e=Error(d.error_code||d.error?.status||'Provider request failed ('+r.status+')');e.code=d.error_code;throw e;}return d;}
export async function plaid(path,data={}){const env=process.env.PLAID_ENV||'sandbox';if(!['sandbox','production'].includes(env))throw Error('Invalid Plaid environment');if(!process.env.PLAID_CLIENT_ID||!process.env.PLAID_SECRET)throw Error('Plaid is not configured');return request(`https://${env}.plaid.com${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:process.env.PLAID_CLIENT_ID,secret:process.env.PLAID_SECRET,...data})});}
export async function transactionSync(item,call=plaid){
 for(let attempt=0;attempt<3;attempt++){let cursor=item.cursor||'',has=true,changes=[];try{let pages=0;while(has){if(++pages>100)throw Error('Transaction history too large for one sync');const d=await call('/transactions/sync',{access_token:item.token,cursor,count:500});changes.push(d);cursor=d.next_cursor;has=d.has_more;}return {cursor,changes};}catch(e){if(e.code!=='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'||attempt===2)throw e;}}
}
export function applyTransactions(existing,changes,itemId){const map=new Map(existing.map(t=>[t.transaction_id,t]));for(const c of changes){for(const t of c.removed)map.delete(t.transaction_id);for(const t of [...c.added,...c.modified])map.set(t.transaction_id,{transaction_id:t.transaction_id,itemId,account_id:t.account_id,name:t.merchant_name||t.name,date:t.date,amount:t.amount,pending:t.pending,currency:t.iso_currency_code,category:t.personal_finance_category?.detailed||t.personal_finance_category?.primary});}return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date));}
export function messageText(payload,{referenceDate}={}){
 const plain=[],html=[];function walk(p){if(p.body?.data){const text=Buffer.from(p.body.data,'base64url').toString('utf8');if(p.mimeType==='text/plain')plain.push(text);else if(p.mimeType==='text/html')html.push(text);}for(const child of p.parts||[])walk(child);}walk(payload||{});
 const rich=html.join('\n').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&dollar;|&#36;|&#x24;/gi,'$').replace(/&colon;/gi,':');
 const text=plain.join('\n');
 // A plain-text fallback may omit details that are visible in the HTML statement.
 const plainBill=parseBill(text,{referenceDate}),richBill=parseBill(rich,{referenceDate});
 const content=plainBill.amount===null&&richBill.amount!==null?rich:plainBill.date===null&&richBill.date!==null?[text,rich].filter(Boolean).join('\n'):text||rich;
 return content.slice(0,100000);
}

export function parseBill(text,{referenceDate}={}){
 // Require bill labels; infer an omitted year only from the email's own timestamp.
 const amounts=[...text.matchAll(/(?<!minimum\s)(?:total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due|(?:total\s+)?bill\s+amount|(?:current\s+bill|bill\s+total)|payment\s+amount)\s*(?:is\s*)?:?\s*\$\s*([\d,]+(?:\.\d{2})?)(?!\d|\.\d)/gi)].map(m=>cents(m[1].replaceAll(',','')));
 const dates=[],reference=Date.parse(referenceDate||''),referenceYear=Number.isFinite(reference)?new Date(reference).getUTCFullYear():null;
 function addDate(month,date,year){
  const valid=y=>{const s=`${y}-${String(month).padStart(2,'0')}-${String(date).padStart(2,'0')}`;try{return day(s)===s?s:null;}catch{return null;}};
  if(year){const n=Number(year),y=year.length===2?(referenceYear?Math.floor(referenceYear/100)*100:2000)+n:n;const s=valid(y);if(s)dates.push(s);return;}
  if(referenceYear===null)return;
  const choices=[referenceYear-1,referenceYear,referenceYear+1].map(valid).filter(Boolean).map(s=>({s,distance:Math.abs(Date.parse(s+'T12:00:00Z')-reference)})).filter(x=>x.distance<=183*86400000).sort((a,b)=>a.distance-b.distance);
  if(choices[0])dates.push(choices[0].s);
 }
 for(const m of text.matchAll(/\b(?:payment\s+due(?:\s+date)?|due(?:\s+(?:date|by|on))?)\s*(?:is\s*)?:?\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?(?![\d/-])/gi))addDate(Number(m[1]),Number(m[2]),m[3]);
 for(const m of text.matchAll(/\b(?:payment\s+due(?:\s+date)?|due(?:\s+(?:date|by|on))?)\s*(?:is\s*)?:?\s*([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?!\d)/gi)){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase())+1;if(month)addDate(month,Number(m[2]),m[3]);}
 const a=[...new Set(amounts)],d=[...new Set(dates)];return {amount:a.length===1?a[0]:null,date:d.length===1?d[0]:null};
}

// Legacy electric-bill import; general statement/payment parsing lives in email-parser.mjs.
export function classifyElectricEmail(input){
 const sender=(input.from?.match(/<([^>]+)>/)?.[1]||input.from||'').trim().toLowerCase();
 if(!/@(?:[a-z0-9-]+\.)*consumersenergy\.com$/.test(sender)&&!/consumers\s+energy/i.test(input.from||''))return {action:'ignore'};
 const result=classifyBillEmail(input);
 if(result.action==='add')Object.assign(result.bill,{name:'Consumers Energy',billKind:'electric'});
 return result;
}
export function classifyBillEmail({id,from,subject='',snippet='',text='',receivedAt,today=new Date().toISOString().slice(0,10)}) {
 const sender=(from.match(/<([^>]+)>/)?.[1]||from).trim().toLowerCase();
 const name=(from.includes('<')?from.split('<')[0].trim().replace(/^"|"$/g,''):sender).slice(0,200)||'Email bill';
 const content=subject+'\n'+text;
 if(/\b(payment (?:received|confirmed|successful|confirmation)|receipt|thank you for (?:your )?payment|paid in full)\b/i.test(subject))return {action:'ignore'};
 if(!/\b(bill|invoice|statement|amount due|payment due|balance due|autopay|automatic payment|payment reminder|renewal)\b/i.test(content))return {action:'ignore'};
 const parsed=parseBill(content,{referenceDate:receivedAt||today}),candidate={id,sender,name,subject:subject.slice(0,300),snippet:snippet.slice(0,350),...parsed};
 const account=content.match(/(?:account|card)\s*(?:number|no\.?|#|ending(?: in)?)?\s*[:*xX•-]*\s*(\d{4,})\b/i)?.[1]||'';
 const sourceKey=JSON.stringify([sender,account,parsed.date,parsed.amount]);candidate.sourceKey=sourceKey;
 const paid=/\b(payment (?:has been |was )?(?:received|processed|successful)|paid in full|no payment (?:is )?(?:due|required))\b/i.test(content);
 if(paid||parsed.amount===0)return {action:'ignore'};
 const reason=!Number.isSafeInteger(parsed.amount)||parsed.amount<=0||parsed.amount>1e12?'Amount missing or conflicting':!parsed.date?'Due date missing or conflicting':parsed.date<today?'Past due date: check whether already paid':/\b(minimum payment|minimum amount|credit card|statement balance)\b/i.test(content)?'Check against your debt plan before adding a card payment':null;
 if(reason)return {action:'review',candidate:{...candidate,reason}};
 return {action:'add',candidate,bill:{id:'gmail-'+id,name,amount:parsed.amount,date:parsed.date,repeat:'once',source:'gmail',sourceId:id,sourceKey,sender}};
}

const validBalance=value=>typeof value==='number'&&Number.isFinite(value)&&Number.isSafeInteger(Math.round(value*100));
const accountAmount=a=>['credit','loan','investment','brokerage'].includes(a.type)?a.balances?.current:(validBalance(a.balances?.available)?a.balances.available:a.balances?.current);
// Missing provider values are not zero balances. Preserve the last known value.
export function plaidAccountEntry(a,item,old,now=new Date().toISOString()){
 const raw=accountAmount(a);
 const known=typeof raw==='number'&&Number.isFinite(raw)&&Number.isSafeInteger(Math.round(raw*100));
 const zeroUnconfirmed=a.type==='loan'&&known&&raw===0;
 const lastPositive=old?.balance>0?old.balance:old?.lastPositiveBalance;
 const saved=zeroUnconfirmed?lastPositive??0:old?.balance??0;
 const usable=known&&!zeroUnconfirmed;
 const eligible=a.type==='depository'&&a.subtype==='checking'&&a.balances?.iso_currency_code==='USD';
 return {id:'plaid-'+a.account_id,itemId:item.id,name:a.name+(a.mask?' •'+a.mask:''),balance:usable?Math.round(raw*100):saved,balanceUnavailable:!usable||!!a.balanceConflict,zeroUnconfirmed,balanceWarning:zeroUnconfirmed?'Plaid returned $0 for this loan. The balance needs verification; this does not confirm payoff.':a.balanceConflict?'Plaid’s live loan balance was $0 but its cached principal was positive. Showing the cached amount until verified.':null,accountMissing:false,balanceSource:usable?(a.balanceSource||'cached'):'saved',balanceUpdated:usable?(a.balances?.last_updated_datetime||now):(zeroUnconfirmed?old?.lastPositiveBalanceUpdated||old?.balanceUpdated||null:old?.balanceUpdated||null),reportedCurrent:validBalance(a.balances?.current)?a.balances.current:null,reportedLiveCurrent:a.reportedLiveCurrent??null,reportedAvailable:validBalance(a.balances?.available)?a.balances.available:null,creditLimit:a.type==='credit'&&validBalance(a.balances?.limit)&&a.balances.limit>=0?Math.round(a.balances.limit*100):old?.creditLimit??null,balanceRetrieved:now,lastPositiveBalance:known&&raw>0?Math.round(raw*100):(old?.lastPositiveBalance??(old?.balance>0?old.balance:null)),lastPositiveBalanceUpdated:known&&raw>0?(a.balances?.last_updated_datetime||now):(old?.lastPositiveBalanceUpdated??(old?.balance>0?old.balanceUpdated:null)),include:eligible?(old?.include??true):false,source:'plaid',type:a.type,subtype:a.subtype,currency:a.balances?.iso_currency_code};
}
export async function bankAccounts(call,item,live=false){
 const read=async path=>{const result=await call(path,{access_token:item.token});if(!Array.isArray(result?.accounts)||result.accounts.some(a=>!a?.account_id))throw Error('Plaid returned an invalid account list');return result;};
 delete item.balanceWarning;
 if(!live)return read('/accounts/get');
 let fresh,cached,liveError,cachedError;
 try{fresh=await read('/accounts/balance/get');}catch(e){liveError=e;}
 // Balance responses can omit accounts or individual fields. Always discover the
 // full authorized inventory too, without restricting the request to known IDs.
 try{cached=await read('/accounts/get');}catch(e){cachedError=e;}
 if(!fresh&&!cached)throw liveError||cachedError;
 const byId=new Map((cached?.accounts||[]).map(a=>[a.account_id,{...a,balanceSource:'cached'}]));
 for(const a of fresh?.accounts||[]){
  const fallback=byId.get(a.account_id),conflict=a.type==='loan'&&a.balances?.current===0&&validBalance(fallback?.balances?.current)&&fallback.balances.current>0,usable=validBalance(accountAmount(a))&&!conflict;
  // Prefer a complete live amount over a cached available balance. For debt,
  // available credit must never stand in for the principal/current amount owed.
  const balances={...fallback?.balances,...a.balances};
  if(usable){balances.current=validBalance(a.balances?.current)?a.balances.current:null;balances.available=validBalance(a.balances?.available)?a.balances.available:null;balances.last_updated_datetime=a.balances?.last_updated_datetime;}
  if(!usable){for(const key of ['current','available'])if(!validBalance(balances[key])&&validBalance(fallback?.balances?.[key]))balances[key]=fallback.balances[key];balances.last_updated_datetime=fallback?.balances?.last_updated_datetime;}
  if(conflict){balances.current=fallback.balances.current;balances.last_updated_datetime=fallback.balances.last_updated_datetime;}
  byId.set(a.account_id,{...fallback,...a,balances,balanceConflict:conflict,reportedLiveCurrent:validBalance(a.balances?.current)?a.balances.current:null,balanceSource:usable?'live':'cached'});
 }
 const accounts=[...byId.values()],fallbacks=accounts.filter(a=>a.balanceSource==='cached').length;
 if(liveError)item.balanceWarning='Live balance refresh unavailable ('+(liveError.code||liveError.message)+'); showing cached bank data.';
 else if(fallbacks)item.balanceWarning=fallbacks+' account(s) use cached bank balances because live data was incomplete.';
 if(cachedError)item.balanceWarning=[item.balanceWarning,'Account discovery could not finish; previously imported accounts are kept.'].filter(Boolean).join(' ');
 return {accounts};
}
export function mergePlaidAccounts(existing,data,item,now=new Date().toISOString()){
 const old=new Map(existing.filter(a=>a.itemId===item.id).map(a=>[a.id,a]));
 const next=data.accounts.map(a=>{const id='plaid-'+a.account_id,previous=old.get(id);old.delete(id);return {...previous,...plaidAccountEntry(a,item,previous,now)};});
 for(const a of old.values())next.push({...a,accountMissing:true,balanceUnavailable:true,balanceSource:'saved',balanceRetrieved:now});
 const missing=old.size,unavailable=next.filter(a=>a.balanceUnavailable&&!a.accountMissing).length;
 if(missing||unavailable)item.balanceWarning=[item.balanceWarning,`${missing} account(s) missing from this response; ${unavailable} returned without a usable balance. Last known amounts and links are kept.`].filter(Boolean).join(' ');
 return [...existing.filter(a=>a.itemId!==item.id),...next];
}

// Called only after the user confirms these are two connections to the same login.
export function combineBankConnections(connections,plan,classic,removeId,keepId){
 const c=structuredClone(connections),p=structuredClone(plan),k=structuredClone(classic);
 const remove=c.items.find(i=>i.id===removeId),keep=c.items.find(i=>i.id===keepId);
 if(!remove||!keep||removeId===keepId||remove.name!==keep.name)throw Error('Choose two connections to the same bank.');
 const from=p.state.accounts.filter(a=>a.itemId===removeId),to=p.state.accounts.filter(a=>a.itemId===keepId);
 const identity=a=>JSON.stringify([a.name,a.type,a.subtype,a.currency]);
 const map=new Map([[removeId,keepId]]),used=new Set();
 if(!from.length||from.length!==to.length)throw Error('Account lists differ. Refresh both connections before combining.');
 for(const a of from){const matches=to.filter(b=>identity(a)===identity(b));if(matches.length!==1||used.has(matches[0].id))throw Error('Accounts cannot be matched safely. Keep both connections until their account lists match.');const b=matches[0];used.add(b.id);map.set(a.id,b.id);map.set(a.id.slice(6),b.id.slice(6));map.set('credit-'+a.id.slice(6),'credit-'+b.id.slice(6));map.set('credit:credit-'+a.id.slice(6),'credit:credit-'+b.id.slice(6));}
 function translate(s){if(map.has(s))return map.get(s);if(s.startsWith('[')){try{const v=JSON.parse(s);if(Array.isArray(v))return JSON.stringify(v.map(x=>typeof x==='string'?translate(x):x));}catch{}}for(const [a,b] of map)if(a.startsWith('credit-')&&s.startsWith(a+':'))return b+s.slice(a.length);return s;}
 function remap(v){if(typeof v==='string')return translate(v);if(Array.isArray(v))return v.map(remap);if(v&&typeof v==='object'){const out={};for(const [key,value] of Object.entries(v)){const dest=translate(key),next=remap(value);if(out[dest]?.id&&next?.id&&out[dest].id!==next.id)throw Error('Both connections track different bills for the same merchant. Resolve those bill links before combining.');if(out[dest]&&typeof out[dest]==='object'&&!Array.isArray(out[dest])&&next&&typeof next==='object'&&!Array.isArray(next))out[dest]={...next,...out[dest]};else if(!(dest in out))out[dest]=next;}return out;}return v;}
 // Retain the redundant connection and its data privately for recovery, but stop syncing it.
 c.archivedDuplicates=[...(c.archivedDuplicates||[]),{item:remove,accounts:from,transactions:c.transactions.filter(t=>t.itemId===removeId),creditCards:(c.creditCards||[]).filter(a=>a.itemId===removeId)}];
 c.items=c.items.filter(i=>i.id!==removeId);c.transactions=c.transactions.filter(t=>t.itemId!==removeId);c.creditCards=(c.creditCards||[]).filter(a=>a.itemId!==removeId);p.state.accounts=p.state.accounts.filter(a=>a.itemId!==removeId);p.revision++;
 // Keep the retained connection's transaction history: do not double-count identical payments.
 if(k?.state?.values){for(const key of ['income-planner','linked-bills'])if(k.state.values[key])k.state.values[key]=JSON.stringify(remap(JSON.parse(k.state.values[key])));k.revision++;}
 c.status='Duplicate connection combined. Bill and debt links moved to the retained connection.';
 return {connections:c,plan:p,classic:k};
}
