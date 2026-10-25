import {cents,day} from './public/engine.mjs';
export async function request(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(25000)});let d;try{d=await r.json();}catch{throw Error('Provider returned an unreadable response');}if(!r.ok){const e=Error(d.error_code||d.error?.status||'Provider request failed ('+r.status+')');e.code=d.error_code;throw e;}return d;}
export async function plaid(path,data={}){const env=process.env.PLAID_ENV||'sandbox';if(!['sandbox','production'].includes(env))throw Error('Invalid Plaid environment');if(!process.env.PLAID_CLIENT_ID||!process.env.PLAID_SECRET)throw Error('Plaid is not configured');return request(`https://${env}.plaid.com${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:process.env.PLAID_CLIENT_ID,secret:process.env.PLAID_SECRET,...data})});}
export async function transactionSync(item,call=plaid){
 for(let attempt=0;attempt<3;attempt++){let cursor=item.cursor||'',has=true,changes=[];try{let pages=0;while(has){if(++pages>100)throw Error('Transaction history too large for one sync');const d=await call('/transactions/sync',{access_token:item.token,cursor,count:500});changes.push(d);cursor=d.next_cursor;has=d.has_more;}return {cursor,changes};}catch(e){if(e.code!=='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'||attempt===2)throw e;}}
}
export function applyTransactions(existing,changes,itemId){const map=new Map(existing.map(t=>[t.transaction_id,t]));for(const c of changes){for(const t of c.removed)map.delete(t.transaction_id);for(const t of [...c.added,...c.modified])map.set(t.transaction_id,{transaction_id:t.transaction_id,itemId,account_id:t.account_id,name:t.merchant_name||t.name,date:t.date,amount:t.amount,pending:t.pending,currency:t.iso_currency_code,category:t.personal_finance_category?.detailed||t.personal_finance_category?.primary});}return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date));}
export function messageText(payload){let plain=[],html=[];function walk(p){if(p.body?.data){const text=Buffer.from(p.body.data,'base64url').toString('utf8');if(p.mimeType==='text/plain')plain.push(text);else if(p.mimeType==='text/html')html.push(text);}for(const child of p.parts||[])walk(child);}walk(payload||{});return (plain.length?plain.join('\n'):html.join('\n').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&')).slice(0,100000);}
export function parseBill(text){
 // Only explicit amount-due and due-date labels. Never guess dates from statement dates.
 const amounts=[...text.matchAll(/(?:total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due|payment\s+amount)\s*:?\s*\$\s*([\d,]+(?:\.\d{2})?)(?![\d.])/gi)].map(m=>cents(m[1].replaceAll(',','')));
 const dates=[];for(const m of text.matchAll(/(?:payment\s+due(?:\s+date)?|due\s+date|due\s+(?:by|on))\s*:?\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/gi)){const s=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;try{if(day(s)===s)dates.push(s);}catch{}}
 for(const m of text.matchAll(/(?:payment\s+due(?:\s+date)?|due\s+date|due\s+(?:by|on))\s*:?\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/gi)){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase())+1;if(month){const s=`${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}`;try{if(day(s)===s)dates.push(s);}catch{}}}
 const a=[...new Set(amounts)],d=[...new Set(dates)];return {amount:a.length===1?a[0]:null,date:d.length===1?d[0]:null};
}


// Gmail is used only to confirm the monthly Consumers Energy bill.
export const billMailQuery = 'newer_than:60d -in:sent "Consumers Energy" {bill statement "amount due" "payment due" autopay}';
export function classifyElectricEmail(input){
 const sender=(input.from?.match(/<([^>]+)>/)?.[1]||input.from||'').trim().toLowerCase();
 if(!/@(?:[a-z0-9-]+\.)*consumersenergy\.com$/.test(sender)&&!/consumers\s+energy/i.test(input.from||''))return {action:'ignore'};
 const result=classifyBillEmail(input);
 if(result.action==='add')Object.assign(result.bill,{name:'Consumers Energy',billKind:'electric'});
 return result;
}
export function classifyBillEmail({id,from,subject='',snippet='',text='',today=new Date().toISOString().slice(0,10)}) {
 const sender=(from.match(/<([^>]+)>/)?.[1]||from).trim().toLowerCase();
 const name=(from.includes('<')?from.split('<')[0].trim().replace(/^"|"$/g,''):sender).slice(0,200)||'Email bill';
 const content=subject+'\n'+text;
 if(/\b(payment (?:received|confirmed|successful|confirmation)|receipt|thank you for (?:your )?payment|paid in full)\b/i.test(subject))return {action:'ignore'};
 if(!/\b(bill|invoice|statement|amount due|payment due|balance due|autopay|automatic payment|payment reminder|renewal)\b/i.test(content))return {action:'ignore'};
 const parsed=parseBill(content),candidate={id,sender,name,subject:subject.slice(0,300),snippet:snippet.slice(0,350),...parsed};
 const account=content.match(/(?:account|card)\s*(?:number|no\.?|#|ending(?: in)?)?\s*[:*xX•-]*\s*(\d{4,})\b/i)?.[1]||'';
 const sourceKey=JSON.stringify([sender,account,parsed.date,parsed.amount]);candidate.sourceKey=sourceKey;
 const paid=/\b(payment (?:has been |was )?(?:received|processed|successful)|paid in full|no payment (?:is )?(?:due|required))\b/i.test(content);
 if(paid||parsed.amount===0)return {action:'ignore'};
 const reason=!Number.isSafeInteger(parsed.amount)||parsed.amount<=0||parsed.amount>1e12?'Amount missing or conflicting':!parsed.date?'Due date missing or conflicting':parsed.date<today?'Past due date: check whether already paid':/\b(minimum payment|minimum amount|credit card|statement balance)\b/i.test(content)?'Check against your debt plan before adding a card payment':null;
 if(reason)return {action:'review',candidate:{...candidate,reason}};
 return {action:'add',candidate,bill:{id:'gmail-'+id,name,amount:parsed.amount,date:parsed.date,repeat:'once',source:'gmail',sourceId:id,sourceKey,sender}};
}
