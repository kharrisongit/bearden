import {cents,day} from './public/engine.mjs';
export async function request(url,options={}){const r=await fetch(url,{...options,signal:AbortSignal.timeout(25000)});let d;try{d=await r.json();}catch{throw Error('Provider returned an unreadable response');}if(!r.ok){const e=Error(d.error_code||d.error?.status||'Provider request failed ('+r.status+')');e.code=d.error_code;throw e;}return d;}
export async function plaid(path,data={}){const env=process.env.PLAID_ENV||'sandbox';if(!['sandbox','production'].includes(env))throw Error('Invalid Plaid environment');if(!process.env.PLAID_CLIENT_ID||!process.env.PLAID_SECRET)throw Error('Plaid is not configured');return request(`https://${env}.plaid.com${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:process.env.PLAID_CLIENT_ID,secret:process.env.PLAID_SECRET,...data})});}
export async function transactionSync(item,call=plaid){
 for(let attempt=0;attempt<3;attempt++){let cursor=item.cursor||'',has=true,changes=[];try{let pages=0;while(has){if(++pages>100)throw Error('Transaction history too large for one sync');const d=await call('/transactions/sync',{access_token:item.token,cursor,count:500});changes.push(d);cursor=d.next_cursor;has=d.has_more;}return {cursor,changes};}catch(e){if(e.code!=='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'||attempt===2)throw e;}}
}
export function applyTransactions(existing,changes,itemId){const map=new Map(existing.map(t=>[t.transaction_id,t]));for(const c of changes){for(const t of c.removed)map.delete(t.transaction_id);for(const t of [...c.added,...c.modified])map.set(t.transaction_id,{transaction_id:t.transaction_id,itemId,account_id:t.account_id,name:t.merchant_name||t.name,date:t.date,amount:t.amount,pending:t.pending,currency:t.iso_currency_code,category:t.personal_finance_category?.detailed||t.personal_finance_category?.primary});}return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date));}
export function messageText(payload){let plain=[],html=[];function walk(p){if(p.body?.data){const text=Buffer.from(p.body.data,'base64url').toString('utf8');if(p.mimeType==='text/plain')plain.push(text);else if(p.mimeType==='text/html')html.push(text);}for(const child of p.parts||[])walk(child);}walk(payload||{});return (plain.length?plain.join('\n'):html.join('\n').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&dollar;|&#36;|&#x24;/gi,'$').replace(/&colon;/gi,':')).slice(0,100000);}
export function parseBill(text,{referenceDate}={}){
 // Require bill labels; infer an omitted year only from the email's own timestamp.
 const amounts=[...text.matchAll(/(?<!minimum\s)(?:total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due|(?:total\s+)?bill\s+amount|payment\s+amount)\s*:?\s*\$\s*([\d,]+(?:\.\d{2})?)(?![\d.])/gi)].map(m=>cents(m[1].replaceAll(',','')));
 const dates=[],reference=Date.parse(referenceDate||''),referenceYear=Number.isFinite(reference)?new Date(reference).getUTCFullYear():null;
 function addDate(month,date,year){
  const valid=y=>{const s=`${y}-${String(month).padStart(2,'0')}-${String(date).padStart(2,'0')}`;try{return day(s)===s?s:null;}catch{return null;}};
  if(year){const n=Number(year),y=year.length===2?(referenceYear?Math.floor(referenceYear/100)*100:2000)+n:n;const s=valid(y);if(s)dates.push(s);return;}
  if(referenceYear===null)return;
  const choices=[referenceYear-1,referenceYear,referenceYear+1].map(valid).filter(Boolean).map(s=>({s,distance:Math.abs(Date.parse(s+'T12:00:00Z')-reference)})).filter(x=>x.distance<=183*86400000).sort((a,b)=>a.distance-b.distance);
  if(choices[0])dates.push(choices[0].s);
 }
 for(const m of text.matchAll(/\b(?:payment\s+due(?:\s+date)?|due(?:\s+(?:date|by|on))?)\s*:?\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}|\d{2}))?(?![\d/-])/gi))addDate(Number(m[1]),Number(m[2]),m[3]);
 for(const m of text.matchAll(/\b(?:payment\s+due(?:\s+date)?|due(?:\s+(?:date|by|on))?)\s*:?\s*([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?(?!\d)/gi)){const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase())+1;if(month)addDate(month,Number(m[2]),m[3]);}
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
